/**
 * ROS Simulation Routes
 *
 * POST /simulate/ros - Run Monte Carlo ROS projections
 * POST /simulate/compare - Compare multiple players probabilistically
 * GET /simulate/:playerId/distribution - Get percentile distribution for a player
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

import { prisma } from '@cbb/infrastructure';
import { simulatePlayerOutcomes } from '@cbb/worker';
import type { ProbabilisticOutcome, PlayerScore } from '@cbb/worker';

// Validation schemas
const SimulateROSSchema = z.object({
  playerId: z.string(),
  season: z.number().optional(),
  config: z.object({
    simulations: z.number().default(1000),
    weeksRemaining: z.number().default(12),
    gamesPerWeek: z.number().default(6),
    confidenceLevel: z.number().default(0.9),
    regressionToMean: z.boolean().default(true),
  }).optional(),
});

const SimulateBatchSchema = z.object({
  players: z.array(z.object({
    playerId: z.string(),
    name: z.string().optional(),
  })),
  config: z.object({
    simulations: z.number().default(500),
    weeksRemaining: z.number().default(12),
  }).optional(),
});

const ComparePlayersSchema = z.object({
  players: z.array(z.object({
    playerId: z.string(),
    name: z.string(),
    currentScore: z.number(), // 0-100 score
    confidence: z.number().default(0.8),
  })).min(2).max(5),
  config: z.object({
    simulations: z.number().default(1000),
  }).optional(),
});

export async function simulationRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // POST /simulate/ros
  // Run Monte Carlo ROS projection for a player
  // ==========================================================================
  fastify.post('/ros', async (request, reply) => {
    const body = SimulateROSSchema.parse(request.body);
    
    try {
      const targetSeason = body.season || new Date().getFullYear();
      
      // Get player derived stats
      const derived = await prisma.playerDerivedStats.findFirst({
        where: { playerMlbamId: body.playerId, season: targetSeason },
        orderBy: { computedAt: 'desc' },
      });

      if (!derived) {
        return reply.status(404).send({
          error: 'Player data not found',
          playerId: body.playerId,
          season: targetSeason,
        });
      }

      // Build PlayerScore from derived stats
      const playerScore = buildPlayerScoreFromDerived(derived);

      // Run Monte Carlo simulation
      const startTime = Date.now();
      const outcome = simulatePlayerOutcomes(playerScore, {
        simulations: body.config?.simulations || 1000,
        weeksRemaining: body.config?.weeksRemaining || 12,
        gamesPerWeek: body.config?.gamesPerWeek || 6,
        confidenceLevel: body.config?.confidenceLevel || 0.9,
        regressionToMean: body.config?.regressionToMean ?? true,
        regressionStrength: 0.3,
      });
      const duration = Date.now() - startTime;

      return {
        success: true,
        playerId: body.playerId,
        season: targetSeason,
        projection: {
          rosScore: outcome.rosScore,
          probabilities: {
            top10: outcome.probTop10,
            top25: outcome.probTop25,
            top50: outcome.probTop50,
            top100: outcome.probTop100,
            replacement: outcome.probReplacement,
          },
          riskProfile: outcome.riskProfile,
          valueAtRisk: outcome.valueAtRisk,
          confidenceInterval: outcome.confidenceInterval,
        },
        meta: {
          simulationCount: outcome.simulationCount,
          convergenceScore: outcome.convergenceScore,
          duration,
          simulatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Simulation failed',
      });
    }
  });

  // ==========================================================================
  // POST /simulate/batch
  // Run ROS projections for multiple players
  // ==========================================================================
  fastify.post('/batch', async (request, reply) => {
    const body = SimulateBatchSchema.parse(request.body);
    
    try {
      const targetSeason = new Date().getFullYear();
      const results: Array<{
        playerId: string;
        name?: string;
        projection: ProbabilisticOutcome | null;
        duration: number;
        error?: string;
      }> = [];

      for (const player of body.players) {
        const derived = await prisma.playerDerivedStats.findFirst({
          where: { playerMlbamId: player.playerId, season: targetSeason },
          orderBy: { computedAt: 'desc' },
        });

        if (!derived) {
          results.push({
            playerId: player.playerId,
            name: player.name,
            projection: null,
            duration: 0,
            error: 'Player data not found',
          });
          continue;
        }

        const playerScore = buildPlayerScoreFromDerived(derived);
        const startTime = Date.now();
        
        try {
          const outcome = simulatePlayerOutcomes(playerScore, {
            simulations: body.config?.simulations || 500, // Reduced for batch
            weeksRemaining: body.config?.weeksRemaining || 12,
            gamesPerWeek: 6,
            confidenceLevel: 0.9,
            regressionToMean: true,
            regressionStrength: 0.3,
          });

          results.push({
            playerId: player.playerId,
            name: player.name,
            projection: outcome,
            duration: Date.now() - startTime,
          });
        } catch (simError) {
          results.push({
            playerId: player.playerId,
            name: player.name,
            projection: null,
            duration: Date.now() - startTime,
            error: simError instanceof Error ? simError.message : 'Simulation failed',
          });
        }
      }

      return {
        success: true,
        count: results.length,
        results,
        meta: {
          totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
          simulatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Batch simulation failed',
      });
    }
  });

  // ==========================================================================
  // POST /simulate/compare
  // Compare multiple players probabilistically
  // ==========================================================================
  fastify.post('/compare', async (request, reply) => {
    const body = ComparePlayersSchema.parse(request.body);
    
    try {
      const simulations = body.config?.simulations || 1000;
      
      // Run simulations for each player
      const outcomes = body.players.map(player => {
        // Build PlayerScore from input
        const playerScore: PlayerScore = {
          playerId: player.playerId,
          playerMlbamId: player.playerId,
          season: new Date().getFullYear(),
          scoredAt: new Date(),
          overallValue: player.currentScore,
          components: {
            hitting: player.currentScore,
            power: player.currentScore - 5,
            speed: player.currentScore - 10,
            plateDiscipline: player.currentScore + 5,
            consistency: player.currentScore,
            opportunity: player.currentScore - 2,
          },
          confidence: player.confidence,
          reliability: {
            sampleSize: player.confidence > 0.8 ? 'large' : 'adequate',
            gamesToReliable: 0,
            statsReliable: player.confidence > 0.7,
          },
          explanation: {
            summary: 'Input score',
            strengths: [],
            concerns: [],
            keyStats: {},
          },
          inputs: {
            derivedFeaturesVersion: '1.0',
            computedAt: new Date(),
          },
        };

        return {
          name: player.name,
          playerId: player.playerId,
          outcome: simulatePlayerOutcomes(playerScore, {
            simulations,
            weeksRemaining: 12,
            gamesPerWeek: 6,
            confidenceLevel: 0.9,
            regressionToMean: true,
            regressionStrength: 0.3,
          }),
        };
      });

      // Calculate pairwise comparisons
      const comparisons: Array<{
        playerA: string;
        playerB: string;
        aBetterProbability: number;
        medianDifference: number;
        overlap: number;
      }> = [];

      for (let i = 0; i < outcomes.length; i++) {
        for (let j = i + 1; j < outcomes.length; j++) {
          const a = outcomes[i];
          const b = outcomes[j];
          const comparison = compareTwoPlayers(a.outcome, b.outcome);
          
          comparisons.push({
            playerA: a.name,
            playerB: b.name,
            aBetterProbability: comparison.aBetterProb,
            medianDifference: comparison.medianDiff,
            overlap: comparison.overlap,
          });
        }
      }

      // Rank by expected value
      const rankings = outcomes
        .map(o => ({
          name: o.name,
          playerId: o.playerId,
          expectedValue: o.outcome.rosScore.mean,
          floor: o.outcome.rosScore.p10,
          ceiling: o.outcome.rosScore.p90,
          risk: o.outcome.riskProfile.volatility,
        }))
        .sort((a, b) => b.expectedValue - a.expectedValue);

      return {
        success: true,
        players: outcomes.map(o => ({
          name: o.name,
          playerId: o.playerId,
          rosScore: o.outcome.rosScore,
          riskProfile: o.outcome.riskProfile,
        })),
        comparisons,
        rankings,
        meta: {
          simulations,
          comparedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Comparison failed',
      });
    }
  });

  // ==========================================================================
  // GET /simulate/:playerId/distribution
  // Get just the percentile distribution for a player
  // ==========================================================================
  fastify.get('/:playerId/distribution', async (request, reply) => {
    const { playerId } = request.params as { playerId: string };
    const { season } = request.query as { season?: string };
    
    const targetSeason = season ? parseInt(season) : new Date().getFullYear();

    try {
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

      const playerScore = buildPlayerScoreFromDerived(derived);
      const outcome = simulatePlayerOutcomes(playerScore, {
        simulations: 1000,
        weeksRemaining: 12,
        gamesPerWeek: 6,
        confidenceLevel: 0.9,
        regressionToMean: true,
        regressionStrength: 0.3,
      });

      return {
        success: true,
        playerId,
        distribution: outcome.rosScore,
        probabilities: {
          top10: outcome.probTop10,
          top25: outcome.probTop25,
          top50: outcome.probTop50,
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get distribution',
      });
    }
  });
}

// Helper functions
function buildPlayerScoreFromDerived(derived: any): PlayerScore {
  // Calculate overall value from OPS (simplified)
  const ops = derived.opsLast30 || 0.750;
  let overallValue = 50;
  if (ops >= 0.900) overallValue = 75;
  else if (ops >= 0.800) overallValue = 65;
  else if (ops >= 0.750) overallValue = 55;
  else if (ops >= 0.700) overallValue = 45;
  else overallValue = 35;

  // Adjust for games played
  const gamesRate = derived.gamesLast30 / 30;
  if (gamesRate >= 0.9) overallValue += 10;
  else if (gamesRate >= 0.8) overallValue += 5;
  else if (gamesRate < 0.5) overallValue -= 10;

  overallValue = Math.max(0, Math.min(100, overallValue));

  return {
    playerId: derived.playerId,
    playerMlbamId: derived.playerMlbamId,
    season: derived.season,
    scoredAt: derived.computedAt,
    overallValue,
    components: {
      hitting: overallValue + (Math.random() * 10 - 5),
      power: overallValue + (Math.random() * 10 - 5),
      speed: overallValue + (Math.random() * 10 - 5),
      plateDiscipline: overallValue + (Math.random() * 10 - 5),
      consistency: derived.hitConsistencyScore || 50,
      opportunity: overallValue + (Math.random() * 10 - 5),
    },
    confidence: derived.opsReliable ? 0.85 : 0.6,
    reliability: {
      sampleSize: derived.plateAppearancesLast30 >= 100 ? 'large' : 
                  derived.plateAppearancesLast30 >= 60 ? 'adequate' : 'small',
      gamesToReliable: derived.gamesToReliable,
      statsReliable: derived.opsReliable,
    },
    explanation: {
      summary: 'Derived from game logs',
      strengths: [],
      concerns: [],
      keyStats: {
        ops: derived.opsLast30,
        gamesLast30: derived.gamesLast30,
      },
    },
    inputs: {
      derivedFeaturesVersion: '1.0',
      computedAt: derived.computedAt,
    },
  };
}

function compareTwoPlayers(
  a: ProbabilisticOutcome,
  b: ProbabilisticOutcome
): {
  aBetterProb: number;
  medianDiff: number;
  overlap: number;
} {
  const meanA = a.rosScore.mean;
  const meanB = b.rosScore.mean;
  const stdA = a.rosScore.stdDev;
  const stdB = b.rosScore.stdDev;

  // Pooled standard deviation
  const pooledSD = Math.sqrt((stdA * stdA + stdB * stdB) / 2);

  // Cohen's d (effect size)
  const cohenD = Math.abs(meanA - meanB) / (pooledSD || 1);

  // Approximate probability A is better than B
  // Based on normal distribution overlap
  const aBetterProb = meanA > meanB 
    ? 0.5 + 0.25 * cohenD 
    : 0.5 - 0.25 * cohenD;

  return {
    aBetterProb: Math.min(0.99, Math.max(0.01, aBetterProb)),
    medianDiff: a.rosScore.p50 - b.rosScore.p50,
    overlap: Math.max(0, 1 - cohenD * 0.3),
  };
}
