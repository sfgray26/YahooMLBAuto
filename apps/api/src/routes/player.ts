/**
 * Player Routes
 * 
 * GET /players/:id/valuation - Get player valuation
 * GET /players/search - Search players
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

import { prisma } from '@cbb/infrastructure';
import type { PlayerValuationReport } from '@cbb/core';

export async function playerRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // GET /players/:id/valuation
  // Get current valuation for a player
  // ==========================================================================
  fastify.get('/:id/valuation', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date } = request.query as { date?: string };
    
    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0];
    
    // Find most recent valid valuation for this player
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

    if (!valuation) {
      return reply.status(404).send({
        error: 'No valuation found for player',
        playerId: id,
        date: dateStr,
        message: 'Valuation may still be processing or player not found',
      });
    }

    const report = valuation as unknown as PlayerValuationReport;
    
    return {
      player: {
        id: valuation.playerId,
        mlbamId: valuation.playerMlbamId,
        name: valuation.playerName,
        team: valuation.playerTeam,
        positions: valuation.playerPositions,
      },
      valuation: {
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
        factors: report.factors,
        methodology: {
          modelType: valuation.modelType,
          modelVersion: valuation.modelVersion,
          featuresUsed: valuation.featuresUsed,
        },
      },
    };
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
      players: players.map(p => ({
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
      players: players.map(p => ({
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
