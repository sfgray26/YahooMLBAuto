/**
 * Lineup Routes
 * 
 * POST /lineup/today - Request lineup optimization for today
 * GET /lineup/:id/result - Get lineup optimization result
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { prisma, addDecisionRequest } from '@cbb/infrastructure';
import type { LineupOptimizationRequest, LineupOptimizationResult, ScoringRules, RiskProfile } from '@cbb/core';

// Validation schemas
const LineupRequestSchema = z.object({
  leagueId: z.string(),
  platform: z.enum(['yahoo', 'espn', 'fantrax', 'sleeper', 'custom']),
  format: z.enum(['h2h', 'roto', 'points']),
  scoringPeriod: z.enum(['today', 'tomorrow', 'week']).default('today'),
  riskTolerance: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  weatherSensitivity: z.object({
    rainThreshold: z.number().min(0).max(1).optional(),
    windThreshold: z.number().optional(),
  }).optional(),
  manualOverrides: z.array(z.object({
    playerId: z.string(),
    action: z.enum(['lock_in', 'lock_out']),
  })).optional(),
});

type LineupRequestBody = z.infer<typeof LineupRequestSchema>;

export async function lineupRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // POST /lineup/today
  // Request lineup optimization for today's games
  // ==========================================================================
  fastify.post('/today', async (request, reply) => {
    const traceId = uuidv4();
    const body = LineupRequestSchema.parse(request.body);
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Build the decision request contract
    const decisionRequest: LineupOptimizationRequest = {
      id: uuidv4(),
      version: 'v1',
      createdAt: now.toISOString(),
      leagueConfig: {
        platform: body.platform,
        format: body.format,
        leagueSize: 12, // Default, would be fetched from league config
        scoringRules: getDefaultScoringRules(body.format),
        rosterPositions: getDefaultRosterPositions(),
      },
      scoringPeriod: {
        type: 'daily',
        startDate: `${today}T00:00:00Z`,
        endDate: `${today}T23:59:59Z`,
        games: [], // Will be populated by worker
      },
      rosterConstraints: {
        lockedSlots: [],
        mustInclude: body.manualOverrides
          ?.filter(o => o.action === 'lock_in')
          .map(o => o.playerId) || [],
        mustExclude: body.manualOverrides
          ?.filter(o => o.action === 'lock_out')
          .map(o => o.playerId) || [],
      },
      availablePlayers: {
        players: [], // Will be populated by worker from roster
        lastUpdated: now.toISOString(),
      },
      optimizationObjective: {
        type: 'maximize_expected',
      },
      riskTolerance: getRiskProfile(body.riskTolerance),
      weatherSensitivity: body.weatherSensitivity ? {
        rainThreshold: body.weatherSensitivity.rainThreshold ?? 0.5,
        windThreshold: body.weatherSensitivity.windThreshold ?? 15,
        temperatureThreshold: { min: 40, max: 95 },
      } : undefined,
    };

    // Store request in database
    await prisma.decisionRequest.create({
      data: {
        id: decisionRequest.id,
        version: decisionRequest.version,
        type: 'lineup_optimization',
        createdAt: now,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: decisionRequest as any,
        status: 'pending',
        traceId,
      },
    });

    // Queue the job for processing
    await addDecisionRequest(
      'lineup_optimization',
      decisionRequest,
      traceId,
      10 // High priority
    );

    return {
      success: true,
      message: 'Lineup optimization request queued',
      requestId: decisionRequest.id,
      traceId,
      status: 'pending',
      checkResultAt: `/lineup/${decisionRequest.id}/result`,
    };
  });

  // ==========================================================================
  // GET /lineup/:id/result
  // Get lineup optimization result
  // ==========================================================================
  fastify.get('/:id/result', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const decisionRequest = await prisma.decisionRequest.findUnique({
      where: { id },
      include: { result: true },
    });

    if (!decisionRequest) {
      return reply.status(404).send({
        error: 'Lineup optimization request not found',
        requestId: id,
      });
    }

    // If still processing, return status
    if (decisionRequest.status === 'pending' || decisionRequest.status === 'processing') {
      return {
        requestId: id,
        status: decisionRequest.status,
        createdAt: decisionRequest.createdAt,
        message: 'Optimization in progress, check back shortly',
      };
    }

    // If failed, return error
    if (decisionRequest.status === 'failed') {
      return reply.status(500).send({
        requestId: id,
        status: 'failed',
        error: 'Optimization failed. Please try again.',
      });
    }

    // Return completed result
    const result = decisionRequest.result?.payload as unknown as LineupOptimizationResult;
    
    return {
      requestId: id,
      status: 'completed',
      generatedAt: decisionRequest.result?.createdAt,
      lineup: result?.optimalLineup || [],
      expectedPoints: result?.expectedPoints || 0,
      confidenceScore: result?.confidenceScore || 0,
      explanation: result?.explanation || null,
      alternativeLineups: result?.alternativeLineups || [],
    };
  });

  // ==========================================================================
  // GET /lineup/optimizations
  // List recent lineup optimizations
  // ==========================================================================
  fastify.get('/optimizations', async (request, reply) => {
    const { limit = '10', offset = '0' } = request.query as { limit?: string; offset?: string };
    
    const optimizations = await prisma.decisionRequest.findMany({
      where: { type: 'lineup_optimization' },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: {
        result: {
          select: {
            createdAt: true,
            confidence: true,
          },
        },
      },
    });

    return {
      optimizations: optimizations.map((opt: { id: string; status: string; createdAt: Date; result: { createdAt: Date; confidence: string | null } | null }) => ({
        requestId: opt.id,
        status: opt.status,
        createdAt: opt.createdAt,
        completedAt: opt.result?.createdAt,
        confidence: opt.result?.confidence,
      })),
    };
  });
}

// ============================================================================
// Helpers
// ============================================================================

function getDefaultScoringRules(format: string): ScoringRules {
  // Standard 5x5 roto or points league defaults
  const batting: Record<string, number> = format === 'points'
    ? { R: 1, HR: 4, RBI: 1, SB: 2, BB: 1, H: 1, '2B': 2, '3B': 3, AVG: 0 }
    : { AVG: 1, HR: 1, RBI: 1, R: 1, SB: 1, BB: 0, H: 0, '2B': 0, '3B': 0 };

  const pitching: Record<string, number> = format === 'points'
    ? { IP: 3, SO: 1, W: 5, SV: 5, ER: -1, H: -0.5, BB: -0.5, ERA: 0, WHIP: 0, K: 0 }
    : { ERA: 1, WHIP: 1, K: 1, W: 1, SV: 1, IP: 0, SO: 0, ER: 0, H: 0, BB: 0 };

  return { batting, pitching };
}

function getDefaultRosterPositions() {
  return [
    { slot: 'C', maxCount: 1, eligiblePositions: ['C'] },
    { slot: '1B', maxCount: 1, eligiblePositions: ['1B', 'CI'] },
    { slot: '2B', maxCount: 1, eligiblePositions: ['2B', 'MI'] },
    { slot: '3B', maxCount: 1, eligiblePositions: ['3B', 'CI'] },
    { slot: 'SS', maxCount: 1, eligiblePositions: ['SS', 'MI'] },
    { slot: 'OF', maxCount: 3, eligiblePositions: ['OF', 'LF', 'CF', 'RF'] },
    { slot: 'UTIL', maxCount: 1, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF'] },
    { slot: 'SP', maxCount: 2, eligiblePositions: ['SP'] },
    { slot: 'RP', maxCount: 2, eligiblePositions: ['RP'] },
    { slot: 'P', maxCount: 3, eligiblePositions: ['SP', 'RP', 'P'] },
    { slot: 'BN', maxCount: 5, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'] },
  ];
}

function getRiskProfile(tolerance: string): RiskProfile {
  switch (tolerance) {
    case 'conservative':
      return { type: 'conservative', varianceTolerance: 0.1 as const, description: 'Minimize downside' };
    case 'aggressive':
      return { type: 'aggressive', varianceTolerance: 0.5 as const, description: 'Maximize upside potential' };
    default:
      return { type: 'balanced', varianceTolerance: 0.3 as const, description: 'Balance risk and reward' };
  }
}
