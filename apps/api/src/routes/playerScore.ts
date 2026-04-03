/**
 * Player Score Routes
 *
 * GET /players/:id/score - Get player value score
 * GET /players/scores/top - Get top scored players
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { prisma } from '@cbb/infrastructure';

export async function playerScoreRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // GET /players/:id/score
  // Get current value score for a player (returns derived features for now)
  // ==========================================================================
  fastify.get('/:id/score', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { season } = request.query as { season?: string };

    const targetSeason = season
      ? parseInt(season)
      : new Date().getFullYear();

    // Get derived features
    const derived = await prisma.playerDerivedStats.findFirst({
      where: { playerMlbamId: id, season: targetSeason },
      orderBy: { computedAt: 'desc' },
    });

    if (!derived) {
      return reply.status(404).send({
        error: 'Player score not available',
        playerId: id,
        season: targetSeason,
        message: 'Player data may still be processing. Run data sync first.',
      });
    }

    // Simple scoring calculation (matches worker logic)
    const overallValue = calculateSimpleScore(derived);

    return {
      player: {
        id: derived.playerId,
        mlbamId: derived.playerMlbamId,
      },
      score: {
        overallValue,
        components: {
          hitting: calculateHittingScore(derived),
          power: calculatePowerScore(derived),
          speed: 50, // Placeholder
          plateDiscipline: calculateDisciplineScore(derived),
          consistency: derived.hitConsistencyScore,
          opportunity: calculateOpportunityScore(derived),
        },
        confidence: derived.opsReliable ? 0.85 : 0.6,
        reliability: {
          sampleSize: derived.plateAppearancesLast30 >= 100 ? 'large' : 
                      derived.plateAppearancesLast30 >= 60 ? 'adequate' : 'small',
          gamesToReliable: derived.gamesToReliable,
          statsReliable: derived.opsReliable,
        },
      },
      features: {
        volume: {
          gamesLast7: derived.gamesLast7,
          gamesLast14: derived.gamesLast14,
          gamesLast30: derived.gamesLast30,
          plateAppearancesLast30: derived.plateAppearancesLast30,
        },
        rates: {
          battingAverage: derived.battingAverageLast30,
          ops: derived.opsLast30,
          iso: derived.isoLast30,
        },
      },
      meta: {
        computedAt: derived.computedAt,
        season: derived.season,
      },
    };
  });

  // ==========================================================================
  // GET /players/scores/top
  // Get top scored players
  // ==========================================================================
  fastify.get('/scores/top', async (request, reply) => {
    const { season, limit = '20' } = request.query as {
      season?: string;
      limit?: string;
    };

    const targetSeason = season
      ? parseInt(season)
      : new Date().getFullYear();

    const derivedRecords = await prisma.playerDerivedStats.findMany({
      where: { season: targetSeason },
      distinct: ['playerMlbamId'],
      orderBy: { computedAt: 'desc' },
      take: parseInt(limit),
    });

    if (derivedRecords.length === 0) {
      return reply.status(404).send({
        error: 'No player data available',
        message: 'Run data sync first to populate player scores.',
      });
    }

    // Calculate scores and sort
    const players = derivedRecords.map((d: { playerId: string; playerMlbamId: string; battingAverageLast30: number | null; opsLast30: number | null; gamesLast30: number; plateAppearancesLast30: number; hitConsistencyScore: number; gamesStartedLast14: number }) => ({
      id: d.playerId,
      mlbamId: d.playerMlbamId,
      score: {
        overallValue: calculateSimpleScore(d),
        ops: d.opsLast30,
        gamesPlayed: d.gamesLast30,
      },
    }));

    // Sort by overall value
    players.sort((a: { score: { overallValue: number } }, b: { score: { overallValue: number } }) => b.score.overallValue - a.score.overallValue);

    return {
      players,
      meta: {
        season: targetSeason,
        count: players.length,
        scoredAt: new Date().toISOString(),
      },
    };
  });
}

// Simple scoring functions (deterministic, same as worker)
function calculateSimpleScore(d: {
  battingAverageLast30: number | null;
  opsLast30: number | null;
  gamesLast30: number;
  plateAppearancesLast30: number;
  hitConsistencyScore: number;
  gamesStartedLast14: number;
}): number {
  let score = 50;

  // OPS contribution
  if (d.opsLast30 !== null) {
    if (d.opsLast30 >= 0.900) score += 20;
    else if (d.opsLast30 >= 0.800) score += 15;
    else if (d.opsLast30 >= 0.750) score += 10;
    else if (d.opsLast30 >= 0.700) score += 5;
    else if (d.opsLast30 < 0.650) score -= 10;
  }

  // Games played contribution
  const gamesRate = d.gamesLast30 / 30;
  if (gamesRate >= 0.9) score += 10;
  else if (gamesRate >= 0.8) score += 5;
  else if (gamesRate < 0.5) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function calculateHittingScore(d: { battingAverageLast30: number | null }): number {
  let score = 50;
  if (d.battingAverageLast30 !== null) {
    if (d.battingAverageLast30 >= 0.300) score += 20;
    else if (d.battingAverageLast30 >= 0.280) score += 15;
    else if (d.battingAverageLast30 >= 0.260) score += 10;
    else if (d.battingAverageLast30 < 0.220) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}

function calculatePowerScore(d: { isoLast30: number | null }): number {
  let score = 50;
  if (d.isoLast30 !== null) {
    if (d.isoLast30 >= 0.200) score += 20;
    else if (d.isoLast30 >= 0.180) score += 15;
    else if (d.isoLast30 >= 0.150) score += 10;
    else if (d.isoLast30 < 0.100) score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

function calculateDisciplineScore(d: { 
  walkRateLast30: number | null; 
  strikeoutRateLast30: number | null;
}): number {
  let score = 50;
  if (d.walkRateLast30 !== null) {
    if (d.walkRateLast30 >= 0.10) score += 10;
    else if (d.walkRateLast30 < 0.05) score -= 5;
  }
  if (d.strikeoutRateLast30 !== null) {
    if (d.strikeoutRateLast30 <= 0.18) score += 10;
    else if (d.strikeoutRateLast30 >= 0.28) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}

function calculateOpportunityScore(d: { gamesStartedLast14: number }): number {
  let score = 50;
  const rate = d.gamesStartedLast14 / 14;
  if (rate >= 0.9) score += 20;
  else if (rate >= 0.8) score += 15;
  else if (rate >= 0.7) score += 10;
  else if (rate < 0.5) score -= 10;
  return Math.max(0, Math.min(100, score));
}
