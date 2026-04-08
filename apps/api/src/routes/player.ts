/**
 * Player Routes
 *
 * GET /players/:id/valuation - Get player valuation with derived features
 * GET /players/search - Search players
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

import { prisma } from '@cbb/infrastructure';
import { loadVerifiedPlayerIdentity, normalizeTeamLabel } from './player-identity.js';
export async function playerRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // GET /players/:id/valuation
  // Get current valuation for a player WITH derived features
  // ==========================================================================
  fastify.get('/:id/valuation', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date } = request.query as { date?: string };

    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    // Get derived features first (these always exist if ingestion ran)
    const derivedFeatures = await prisma.playerDerivedStats.findFirst({
      where: {
        playerMlbamId: id,
      },
      orderBy: {
        computedAt: 'desc',
      },
    });

    // Get valuation (may be empty until analytics layer is built)
    const valuation = await prisma.playerValuation.findFirst({
      where: {
        playerId: id,
        validUntil: {
          gte: targetDate,
        },
      },
      orderBy: {
        generatedAt: 'desc',
      },
    });

    const verifiedIdentity = await loadVerifiedPlayerIdentity(id);

    // If no derived features and no valuation, player not found
    if (!derivedFeatures && !valuation) {
      return reply.status(404).send({
        error: 'Player not found',
        playerId: id,
        date: dateStr,
        message: 'Player data may still be processing',
      });
    }

    // Build feature-rich response
    const response: Record<string, unknown> = {
      player: {
        id: id,
        mlbamId: derivedFeatures?.playerMlbamId || valuation?.playerMlbamId,
        name: verifiedIdentity?.fullName || valuation?.playerName || `Player ${id}`,
        team: normalizeTeamLabel(verifiedIdentity?.team || valuation?.playerTeam || null),
        positions: derivedFeatures?.positionEligibility?.length
          ? derivedFeatures.positionEligibility
          : valuation?.playerPositions?.length
            ? valuation.playerPositions
            : verifiedIdentity?.position
              ? [verifiedIdentity.position]
              : [],
      },
      features: derivedFeatures ? {
        computedAt: derivedFeatures.computedAt,
        volume: {
          gamesLast7: derivedFeatures.gamesLast7,
          gamesLast14: derivedFeatures.gamesLast14,
          gamesLast30: derivedFeatures.gamesLast30,
          plateAppearancesLast7: derivedFeatures.plateAppearancesLast7,
          plateAppearancesLast14: derivedFeatures.plateAppearancesLast14,
          plateAppearancesLast30: derivedFeatures.plateAppearancesLast30,
          atBatsLast30: derivedFeatures.atBatsLast30,
        },
        rates: {
          battingAverage: derivedFeatures.battingAverageLast30,
          onBasePct: derivedFeatures.onBasePctLast30,
          sluggingPct: derivedFeatures.sluggingPctLast30,
          ops: derivedFeatures.opsLast30,
          iso: derivedFeatures.isoLast30,
          walkRate: derivedFeatures.walkRateLast30,
          strikeoutRate: derivedFeatures.strikeoutRateLast30,
          babip: derivedFeatures.babipLast30,
        },
        stabilization: {
          battingAverageReliable: derivedFeatures.battingAverageReliable,
          obpReliable: derivedFeatures.obpReliable,
          slgReliable: derivedFeatures.slgReliable,
          opsReliable: derivedFeatures.opsReliable,
          gamesToReliable: derivedFeatures.gamesToReliable,
        },
        volatility: {
          hitConsistencyScore: derivedFeatures.hitConsistencyScore,
          productionVolatility: derivedFeatures.productionVolatility,
          zeroHitGamesLast14: derivedFeatures.zeroHitGamesLast14,
          multiHitGamesLast14: derivedFeatures.multiHitGamesLast14,
        },
        opportunity: {
          gamesStartedLast14: derivedFeatures.gamesStartedLast14,
          lineupSpot: derivedFeatures.lineupSpot,
          platoonRisk: derivedFeatures.platoonRisk,
          playingTimeTrend: derivedFeatures.playingTimeTrend,
        },
        replacement: {
          positionEligibility: derivedFeatures.positionEligibility,
          waiverWireValue: derivedFeatures.waiverWireValue,
          rosteredPercent: derivedFeatures.rosteredPercent,
        },
      } : null,
    };

    // Add valuation if exists (analytics layer)
    if (valuation) {
      const factors = Array.isArray(valuation.factors) ? valuation.factors : [];
      const isMock = valuation.modelType === 'mock';
      response.valuation = {
        generatedAt: valuation.generatedAt,
        validUntil: valuation.validUntil,
        pointProjection: valuation.pointProjection,
        valueOverReplacement: valuation.valueOverReplacement,
        floorProjection: valuation.floorProjection,
        ceilingProjection: valuation.ceilingProjection,
        riskProfile: {
          overall: valuation.overallRisk,
          injury: valuation.injuryRisk,
          playingTime: valuation.playingTimeRisk,
          performance: valuation.performanceVariance,
        },
        factors,
        methodology: {
          modelType: valuation.modelType,
          modelVersion: valuation.modelVersion,
          featuresUsed: valuation.featuresUsed,
        },
        isMock,
        suitableForAutomation: !isMock,
        warning: isMock
          ? 'This valuation was generated by the development mock engine and should not drive production fantasy decisions.'
          : undefined,
      };
    }

    return response;
  });

  // ==========================================================================
  // GET /players/search
  // Search for players
  // ==========================================================================
  fastify.get('/search', async (request, reply) => {
    const { q, team, position, limit = '20' } = request.query as {
      q?: string;
      team?: string;
      position?: string;
      limit?: string;
    };

    const where: Record<string, unknown> = {};

    if (q) {
      where.playerName = {
        contains: q,
        mode: 'insensitive',
      };
    }

    if (team) {
      where.playerTeam = {
        equals: team,
        mode: 'insensitive',
      };
    }

    if (position) {
      where.playerPositions = {
        has: position.toUpperCase(),
      };
    }

    const players = await prisma.playerValuation.findMany({
      where,
      distinct: ['playerId'],
      take: parseInt(limit),
      orderBy: {
        valueOverReplacement: 'desc',
      },
      select: {
        playerId: true,
        playerMlbamId: true,
        playerName: true,
        playerTeam: true,
        playerPositions: true,
        valueOverReplacement: true,
        overallRisk: true,
      },
    });

    return {
      players: players.map((p: { playerId: string; playerMlbamId: string; playerName: string; playerTeam: string | null; playerPositions: string[]; valueOverReplacement: number; overallRisk: string }) => ({
        id: p.playerId,
        mlbamId: p.playerMlbamId,
        name: p.playerName,
        team: p.playerTeam,
        positions: p.playerPositions,
        valueOverReplacement: p.valueOverReplacement,
        risk: p.overallRisk,
      })),
    };
  });

  // ==========================================================================
  // GET /players/top
  // Get top valued players
  // ==========================================================================
  fastify.get('/top', async (request, reply) => {
    const { position, limit = '50' } = request.query as {
      position?: string;
      limit?: string;
    };

    const where: Record<string, unknown> = {};

    if (position) {
      where.playerPositions = {
        has: position.toUpperCase(),
      };
    }

    const players = await prisma.playerValuation.findMany({
      where,
      distinct: ['playerId'],
      take: parseInt(limit),
      orderBy: {
        valueOverReplacement: 'desc',
      },
      select: {
        playerId: true,
        playerMlbamId: true,
        playerName: true,
        playerTeam: true,
        playerPositions: true,
        valueOverReplacement: true,
        overallRisk: true,
        pointProjection: true,
      },
    });

    return {
      players: players.map((p: { playerId: string; playerMlbamId: string; playerName: string; playerTeam: string | null; playerPositions: string[]; valueOverReplacement: number; overallRisk: string; pointProjection: unknown }) => ({
        id: p.playerId,
        mlbamId: p.playerMlbamId,
        name: p.playerName,
        team: p.playerTeam,
        positions: p.playerPositions,
        valueOverReplacement: p.valueOverReplacement,
        risk: p.overallRisk,
        projection: p.pointProjection,
      })),
    };
  });
}
