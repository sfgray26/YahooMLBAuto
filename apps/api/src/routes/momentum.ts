/**
 * Momentum Detection Routes
 *
 * POST /momentum/analyze - Analyze player momentum (ΔZ, trends, breakouts)
 * GET /momentum/:id - Get momentum for a specific player
 * POST /momentum/batch - Analyze multiple players
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

import { prisma } from '@cbb/infrastructure';
import { calculateMomentum } from '@cbb/worker';
import type { MomentumMetrics } from '@cbb/worker';

// Validation schemas
const MomentumAnalyzeSchema = z.object({
  zScore14d: z.number().describe('Z-score over last 14 days'),
  zScore30d: z.number().describe('Z-score over last 30 days'),
  games14d: z.number().default(12),
  games30d: z.number().default(20),
  playerName: z.string().optional(),
});

const MomentumBatchSchema = z.object({
  players: z.array(z.object({
    playerId: z.string(),
    zScore14d: z.number(),
    zScore30d: z.number(),
    games14d: z.number().default(12),
    games30d: z.number().default(20),
  })),
});

export async function momentumRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // POST /momentum/analyze
  // Analyze momentum from Z-score inputs
  // ==========================================================================
  fastify.post('/analyze', {
    schema: {
      tags: ['Momentum'],
      summary: 'Analyze player momentum',
      description: 'Calculates momentum metrics from Z-scores (ΔZ = Z_14d - Z_30d)',
      body: {
        type: 'object',
        required: ['zScore14d', 'zScore30d'],
        properties: {
          zScore14d: { type: 'number', description: 'Z-score over last 14 days' },
          zScore30d: { type: 'number', description: 'Z-score over last 30 days' },
          games14d: { type: 'number', default: 12 },
          games30d: { type: 'number', default: 20 },
          playerName: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            momentum: {
              type: 'object',
              properties: {
                trend: { type: 'string', enum: ['surging', 'hot', 'stable', 'cold', 'collapsing'] },
                zScoreSlope: { type: 'number' },
                breakoutSignal: { type: 'boolean' },
                collapseWarning: { type: 'boolean' },
                recommendation: { type: 'string', enum: ['buy', 'hold', 'sell', 'avoid'] },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = MomentumAnalyzeSchema.parse(request.body);
    
    try {
      // Calculate momentum (pure function)
      const metrics = calculateMomentum(
        body.zScore14d,
        body.zScore30d,
        body.games14d,
        body.games30d
      );

      return {
        success: true,
        playerName: body.playerName,
        momentum: metrics,
        interpretation: interpretMomentum(metrics),
        fantasyImplications: getFantasyImplications(metrics),
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Momentum calculation failed',
      });
    }
  });

  // ==========================================================================
  // GET /momentum/:playerId
  // Get momentum for a specific player from database
  // ==========================================================================
  fastify.get('/:playerId', {
    schema: {
      tags: ['Momentum'],
      summary: 'Get player momentum from database',
      params: {
        type: 'object',
        required: ['playerId'],
        properties: {
          playerId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { playerId } = request.params as { playerId: string };
    const { season } = request.query as { season?: string };
    
    const targetSeason = season ? parseInt(season) : new Date().getFullYear();

    try {
      // Get derived stats for Z-score calculation
      const derived = await prisma.playerDerivedStats.findFirst({
        where: { playerMlbamId: playerId, season: targetSeason },
        orderBy: { computedAt: 'desc' },
      });

      if (!derived) {
        return reply.status(404).send({
          error: 'Player data not found',
          playerId,
          season: targetSeason,
        });
      }

      // Calculate Z-scores from derived stats
      // Z = (stat - mean) / std, scaled to score
      const z14d = calculateZScore(derived.opsLast30 || 0.750, 0.750, 0.080);
      const z30d = z14d * 0.9; // Approximation - 30d is slightly more stable

      const metrics = calculateMomentum(z14d, z30d, derived.gamesLast14, derived.gamesLast30);

      return {
        success: true,
        playerId,
        season: targetSeason,
        momentum: metrics,
        inputs: {
          zScore14d: z14d,
          zScore30d: z30d,
          games14d: derived.gamesLast14,
          games30d: derived.gamesLast30,
        },
        interpretation: interpretMomentum(metrics),
        fantasyImplications: getFantasyImplications(metrics),
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get momentum',
      });
    }
  });

  // ==========================================================================
  // POST /momentum/batch
  // Analyze momentum for multiple players
  // ==========================================================================
  fastify.post('/batch', async (request, reply) => {
    const body = MomentumBatchSchema.parse(request.body);
    
    try {
      const results = body.players.map(player => {
        const metrics = calculateMomentum(
          player.zScore14d,
          player.zScore30d,
          player.games14d,
          player.games30d
        );

        return {
          playerId: player.playerId,
          momentum: metrics,
          recommendation: metrics.recommendation,
        };
      });

      return {
        success: true,
        count: results.length,
        results,
        summary: {
          buySignals: results.filter(r => r.momentum.recommendation === 'buy').length,
          sellSignals: results.filter(r => r.momentum.recommendation === 'sell').length,
          breakouts: results.filter(r => r.momentum.breakoutSignal).length,
          collapseWarnings: results.filter(r => r.momentum.collapseWarning).length,
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Batch momentum calculation failed',
      });
    }
  });

  // ==========================================================================
  // GET /momentum/leaders/hot
  // Get hottest players (surging momentum)
  // ==========================================================================
  fastify.get('/leaders/hot', {
    schema: {
      tags: ['Momentum'],
      summary: 'Get hottest players',
      description: 'Returns players with strongest positive momentum',
    },
  }, async (request, reply) => {
    const { season, limit = '10' } = request.query as { season?: string; limit?: string };
    const targetSeason = season ? parseInt(season) : new Date().getFullYear();

    try {
      // Get recent derived stats
      const players = await prisma.playerDerivedStats.findMany({
        where: { season: targetSeason },
        distinct: ['playerMlbamId'],
        orderBy: { computedAt: 'desc' },
        take: 100, // Analyze top 100 by OPS
      });

      // Calculate momentum for each
      const withMomentum = players.map((p: { playerMlbamId: string; gamesLast14: number; gamesLast30: number; opsLast30: number | null; hitConsistencyScore: number }) => {
        const z14d = calculateZScore(p.opsLast30 || 0.750, 0.750, 0.080);
        const z30d = z14d * 0.9;
        const metrics = calculateMomentum(z14d, z30d, p.gamesLast14, p.gamesLast30);

        return {
          playerId: p.playerMlbamId,
          zScoreSlope: metrics.zScoreSlope,
          trend: metrics.trend,
          breakoutSignal: metrics.breakoutSignal,
          recommendation: metrics.recommendation,
        };
      });

      // Sort by Z-score slope (hottest first)
      withMomentum.sort((a: { zScoreSlope: number }, b: { zScoreSlope: number }) => b.zScoreSlope - a.zScoreSlope);

      return {
        success: true,
        season: targetSeason,
        hotPlayers: withMomentum.slice(0, parseInt(limit)),
        count: Math.min(parseInt(limit), withMomentum.length),
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get hot players',
      });
    }
  });
}

// Helper functions
function calculateZScore(value: number, mean: number, stdDev: number): number {
  return (value - mean) / stdDev;
}

function interpretMomentum(metrics: MomentumMetrics): string {
  if (metrics.breakoutSignal) {
    return `${metrics.trend.toUpperCase()}: Potential breakout detected. Player is performing well above recent baseline.`;
  }
  if (metrics.collapseWarning) {
    return `${metrics.trend.toUpperCase()}: Collapse warning. Player has dropped significantly from previous performance.`;
  }
  if (metrics.trend === 'surging') {
    return 'Strong upward momentum. Player is heating up significantly.';
  }
  if (metrics.trend === 'hot') {
    return 'Moderate upward trend. Player is performing above recent baseline.';
  }
  if (metrics.trend === 'cold') {
    return 'Moderate downward trend. Player is performing below recent baseline.';
  }
  if (metrics.trend === 'collapsing') {
    return 'Strong downward momentum. Player is struggling significantly.';
  }
  return 'Stable performance. No significant trend detected.';
}

function getFantasyImplications(metrics: MomentumMetrics): {
  action: string;
  confidence: string;
  expectedRegression: string;
} {
  return {
    action: metrics.recommendation.toUpperCase(),
    confidence: metrics.momentumReliability,
    expectedRegression: metrics.expectedRegression,
  };
}
