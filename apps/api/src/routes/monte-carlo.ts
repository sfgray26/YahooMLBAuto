/**
 * Monte Carlo Test Route
 * Tests the Monte Carlo simulation layer
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { prisma } from '@cbb/infrastructure';
import { simulatePlayerOutcome, simulatePlayerOutcomes, comparePlayers } from '@cbb/worker';

export async function monteCarloTestRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // GET /monte-carlo/test/:mlbamId - Run Monte Carlo for a single player
  fastify.get('/test/:mlbamId', async (request, reply) => {
    const { mlbamId } = request.params as { mlbamId: string };
    const { runs = 10000, horizon = 'daily' } = request.query as { runs?: string; horizon?: 'daily' | 'weekly' };
    
    try {
      // Get player derived stats
      const derivedRecord = await prisma.playerDerivedStats.findFirst({
        where: { playerMlbamId: mlbamId, season: 2025 },
        orderBy: { computedAt: 'desc' },
      });

      if (!derivedRecord) {
        return reply.status(404).send({
          error: 'Player not found',
          mlbamId,
          message: 'No derived stats available for this player',
        });
      }

      // Get player name from roster if available
      const dailyStats = await prisma.playerDailyStats.findFirst({
        where: { playerMlbamId: mlbamId, season: 2025 },
      });

      // Build derived stats object
      const derived = {
        playerId: derivedRecord.playerId,
        playerMlbamId: derivedRecord.playerMlbamId,
        season: derivedRecord.season,
        volume: {
          plateAppearancesLast7: derivedRecord.plateAppearancesLast7 ?? undefined,
          plateAppearancesLast14: derivedRecord.plateAppearancesLast14 ?? undefined,
          plateAppearancesLast30: derivedRecord.plateAppearancesLast30 ?? undefined,
          gamesLast7: derivedRecord.gamesLast7 ?? undefined,
          gamesLast14: derivedRecord.gamesLast14 ?? undefined,
          gamesLast30: derivedRecord.gamesLast30 ?? undefined,
        },
        rates: {
          opsLast30: derivedRecord.opsLast30 ?? undefined,
          onBasePctLast30: derivedRecord.onBasePctLast30 ?? undefined,
          isoLast30: derivedRecord.isoLast30 ?? undefined,
          battingAverageLast30: derivedRecord.battingAverageLast30 ?? undefined,
          walkRateLast30: derivedRecord.walkRateLast30 ?? undefined,
          strikeoutRateLast30: derivedRecord.strikeoutRateLast30 ?? undefined,
        },
        volatility: {
          productionVolatility: derivedRecord.productionVolatility ?? undefined,
          hitConsistencyScore: derivedRecord.hitConsistencyScore ?? undefined,
        },
      };

      // Build score object
      const score = {
        playerId: derivedRecord.playerId,
        playerMlbamId: derivedRecord.playerMlbamId,
        season: derivedRecord.season,
        scoredAt: new Date(),
        overallValue: derivedRecord.waiverWireValue ?? 50,
        components: {
          hitting: derivedRecord.hitConsistencyScore ?? 50,
          power: Math.min(100, Math.max(0, (derivedRecord.isoLast30 ?? 0.150) * 400)),
          speed: 50,
          plateDiscipline: 50,
          consistency: derivedRecord.hitConsistencyScore ?? 50,
          opportunity: Math.min(100, (derivedRecord.gamesLast30 ?? 20) * 3),
        },
        confidence: 0.7,
        reliability: {
          sampleSize: (derivedRecord.plateAppearancesLast30 && derivedRecord.plateAppearancesLast30 >= 100 ? 'large' : 'adequate') as 'large' | 'adequate',
          gamesToReliable: derivedRecord.gamesToReliable ?? 0,
          statsReliable: derivedRecord.opsReliable ?? false,
        },
        explanation: {
          summary: `Value: ${derivedRecord.waiverWireValue ?? 50}`,
          strengths: [],
          concerns: [],
          keyStats: {
            ops: (derivedRecord.opsLast30 ?? 0.700).toFixed(3),
            avg: (derivedRecord.battingAverageLast30 ?? 0.250).toFixed(3),
          },
        },
        inputs: {
          derivedFeaturesVersion: 'v1',
          computedAt: derivedRecord.computedAt,
        },
      };

      // Run Monte Carlo simulation
      const result = simulatePlayerOutcome(derived, score, {
        runs: parseInt(String(runs), 10),
        horizon,
      });

      return {
        player: {
          mlbamId,
          name: dailyStats?.rawDataSource === 'uat_seed' ? 
            ['Yainer Diaz', 'Vinnie Pasquantino', 'Marcus Semien', 'Matt Chapman', 'Geraldo Perdomo'][Math.floor(Math.random() * 5)] :
            mlbamId,
        },
        simulation: {
          runs: result.runs,
          horizon: result.horizon,
          expectedValue: Math.round(result.expectedValue * 10) / 10,
          median: Math.round(result.median * 10) / 10,
          variance: Math.round(result.variance * 10) / 10,
          standardDeviation: Math.round(result.standardDeviation * 10) / 10,
          percentiles: {
            p10: Math.round(result.p10 * 10) / 10,
            p25: Math.round(result.p25 * 10) / 10,
            p50: Math.round(result.p50 * 10) / 10,
            p75: Math.round(result.p75 * 10) / 10,
            p90: Math.round(result.p90 * 10) / 10,
          },
          riskMetrics: {
            downsideRisk: Math.round(result.downsideRisk * 100) / 100,
            upsidePotential: Math.round(result.upsidePotential * 100) / 100,
            riskAdjustedValue: Math.round(result.riskAdjustedValue * 10) / 10,
          },
          confidence: {
            impact: result.confidenceImpact,
            delta: result.confidenceDelta,
          },
          notes: result.simulationNotes,
        },
        derivedInputs: {
          gamesLast7: derivedRecord.gamesLast7,
          gamesLast14: derivedRecord.gamesLast14,
          gamesLast30: derivedRecord.gamesLast30,
          plateAppearancesLast7: derivedRecord.plateAppearancesLast7,
          plateAppearancesLast14: derivedRecord.plateAppearancesLast14,
          plateAppearancesLast30: derivedRecord.plateAppearancesLast30,
          opsLast30: derivedRecord.opsLast30,
        },
      };
    } catch (error) {
      console.error('[MONTE_CARLO] Error:', error);
      return reply.status(500).send({
        error: 'Simulation failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /monte-carlo/compare - Compare two players
  fastify.get('/compare', async (request, reply) => {
    const { playerA, playerB, runs = 10000 } = request.query as { 
      playerA: string; 
      playerB: string; 
      runs?: string;
    };

    if (!playerA || !playerB) {
      return reply.status(400).send({
        error: 'Missing parameters',
        message: 'playerA and playerB are required',
      });
    }

    try {
      const [derivedA, derivedB] = await Promise.all([
        prisma.playerDerivedStats.findFirst({
          where: { playerMlbamId: playerA, season: 2025 },
          orderBy: { computedAt: 'desc' },
        }),
        prisma.playerDerivedStats.findFirst({
          where: { playerMlbamId: playerB, season: 2025 },
          orderBy: { computedAt: 'desc' },
        }),
      ]);

      if (!derivedA || !derivedB) {
        return reply.status(404).send({
          error: 'Player not found',
          playerA: derivedA ? 'found' : 'not found',
          playerB: derivedB ? 'found' : 'not found',
        });
      }

      const buildDerived = (record: typeof derivedA) => ({
        playerId: record.playerId,
        playerMlbamId: record.playerMlbamId,
        season: record.season,
        volume: {
          plateAppearancesLast7: record.plateAppearancesLast7 ?? undefined,
          plateAppearancesLast14: record.plateAppearancesLast14 ?? undefined,
          plateAppearancesLast30: record.plateAppearancesLast30 ?? undefined,
          gamesLast7: record.gamesLast7 ?? undefined,
          gamesLast14: record.gamesLast14 ?? undefined,
          gamesLast30: record.gamesLast30 ?? undefined,
        },
        rates: {
          opsLast30: record.opsLast30 ?? undefined,
          onBasePctLast30: record.onBasePctLast30 ?? undefined,
          isoLast30: record.isoLast30 ?? undefined,
          battingAverageLast30: record.battingAverageLast30 ?? undefined,
        },
        volatility: {
          productionVolatility: record.productionVolatility ?? undefined,
          hitConsistencyScore: record.hitConsistencyScore ?? undefined,
        },
      });

      const buildScore = (record: typeof derivedA) => ({
        playerId: record.playerId,
        playerMlbamId: record.playerMlbamId,
        season: record.season,
        scoredAt: new Date(),
        overallValue: record.waiverWireValue ?? 50,
        components: {
          hitting: record.hitConsistencyScore ?? 50,
          power: Math.min(100, Math.max(0, (record.isoLast30 ?? 0.150) * 400)),
          speed: 50,
          plateDiscipline: 50,
          consistency: record.hitConsistencyScore ?? 50,
          opportunity: Math.min(100, (record.gamesLast30 ?? 20) * 3),
        },
        confidence: 0.7,
        reliability: {
          sampleSize: (record.plateAppearancesLast30 && record.plateAppearancesLast30 >= 100 ? 'large' : 'adequate') as 'large' | 'adequate',
          gamesToReliable: record.gamesToReliable ?? 0,
          statsReliable: record.opsReliable ?? false,
        },
        explanation: {
          summary: `Value: ${record.waiverWireValue ?? 50}`,
          strengths: [],
          concerns: [],
          keyStats: {
            ops: (record.opsLast30 ?? 0.700).toFixed(3),
            avg: (record.battingAverageLast30 ?? 0.250).toFixed(3),
          },
        },
        inputs: {
          derivedFeaturesVersion: 'v1',
          computedAt: record.computedAt,
        },
      });

      const result = comparePlayers(
        buildDerived(derivedA),
        buildScore(derivedA),
        buildDerived(derivedB),
        buildScore(derivedB),
        { runs: parseInt(String(runs), 10), horizon: 'daily' }
      );

      return {
        playerA: { mlbamId: playerA },
        playerB: { mlbamId: playerB },
        comparison: {
          probAOutperformsB: Math.round(result.probAOutperformsB * 1000) / 1000,
          probBOutperformsA: Math.round(result.probBOutperformsA * 1000) / 1000,
          expectedDelta: Math.round(result.expectedDelta * 10) / 10,
          notes: result.notes,
        },
      };
    } catch (error) {
      console.error('[MONTE_CARLO] Compare error:', error);
      return reply.status(500).send({
        error: 'Comparison failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
