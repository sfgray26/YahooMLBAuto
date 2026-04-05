/**
 * Waiver Routes
 * 
 * POST /waiver/recommendations - Request waiver recommendations
 * GET /waiver/:id/result - Get waiver recommendation result
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { prisma, addDecisionRequest } from '@cbb/infrastructure';
import type { WaiverRecommendationRequest, WaiverRecommendationResult, ScoringRules } from '@cbb/core';

const WaiverRequestSchema = z.object({
  leagueId: z.string(),
  platform: z.enum(['yahoo', 'espn', 'fantrax', 'sleeper', 'custom']),
  format: z.enum(['h2h', 'roto', 'points']),
  scope: z.enum(['add_only', 'drop_only', 'add_drop', 'full_optimization']).default('add_drop'),
  rosterNeeds: z.object({
    positionalNeeds: z.record(z.enum(['none', 'moderate', 'high', 'critical'])).optional(),
    preferredUpside: z.boolean().optional(),
  }).optional(),
});

type WaiverRequestBody = z.infer<typeof WaiverRequestSchema>;

export async function waiverRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // POST /waiver/recommendations
  // Request waiver wire recommendations
  // ==========================================================================
  fastify.post('/recommendations', async (request, reply) => {
    const traceId = uuidv4();
    const body = WaiverRequestSchema.parse(request.body);
    
    const now = new Date();
    
    const decisionRequest: WaiverRecommendationRequest = {
      id: uuidv4(),
      version: 'v1',
      createdAt: now.toISOString(),
      leagueConfig: {
        platform: body.platform,
        format: body.format,
        leagueSize: 12,
        scoringRules: getDefaultScoringRules(body.format),
        rosterPositions: getDefaultRosterPositions(),
      },
      currentRoster: [], // Populated by worker
      availablePlayers: {
        players: [],
        lastUpdated: now.toISOString(),
      },
      recommendationScope: body.scope,
      rosterNeeds: body.rosterNeeds ? {
        positionalNeeds: body.rosterNeeds.positionalNeeds || {},
        preferredUpside: body.rosterNeeds.preferredUpside,
      } : undefined,
    };

    await prisma.decisionRequest.create({
      data: {
        id: decisionRequest.id,
        version: decisionRequest.version,
        type: 'waiver_recommendation',
        createdAt: now,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: decisionRequest as any,
        status: 'pending',
        traceId,
      },
    });

    await addDecisionRequest(
      'waiver_recommendation',
      decisionRequest,
      traceId,
      8
    );

    return {
      success: true,
      message: 'Waiver recommendation request queued',
      requestId: decisionRequest.id,
      traceId,
      status: 'pending',
      checkResultAt: `/waiver/${decisionRequest.id}/result`,
    };
  });

  // ==========================================================================
  // GET /waiver/:id/result
  // Get waiver recommendation result
  // ==========================================================================
  fastify.get('/:id/result', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const decisionRequest = await prisma.decisionRequest.findUnique({
      where: { id },
      include: { result: true },
    });

    if (!decisionRequest) {
      return reply.status(404).send({
        error: 'Waiver recommendation request not found',
        requestId: id,
      });
    }

    if (decisionRequest.status === 'pending' || decisionRequest.status === 'processing') {
      return {
        requestId: id,
        status: decisionRequest.status,
        createdAt: decisionRequest.createdAt,
        message: 'Recommendation in progress, check back shortly',
      };
    }

    if (decisionRequest.status === 'failed') {
      return reply.status(500).send({
        requestId: id,
        status: 'failed',
        error: 'Recommendation failed. Please try again.',
      });
    }

    const result = decisionRequest.result?.payload as unknown as WaiverRecommendationResult;
    
    return {
      requestId: id,
      status: 'completed',
      generatedAt: decisionRequest.result?.createdAt,
      recommendations: result?.recommendations || [],
      rosterAnalysis: result?.rosterAnalysis || null,
    };
  });

  // ==========================================================================
  // GET /waiver/recommendations
  // List recent waiver recommendation requests
  // ==========================================================================
  fastify.get('/recommendations', async (request, reply) => {
    const { limit = '10', offset = '0' } = request.query as { limit?: string; offset?: string };
    
    const recommendations = await prisma.decisionRequest.findMany({
      where: { type: 'waiver_recommendation' },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      select: {
        id: true,
        status: true,
        createdAt: true,
        result: {
          select: {
            createdAt: true,
          },
        },
      },
    });

    return {
      recommendations: recommendations.map((rec: { id: string; status: string; createdAt: Date; result: { createdAt: Date } | null }) => ({
        requestId: rec.id,
        status: rec.status,
        createdAt: rec.createdAt,
        completedAt: rec.result?.createdAt,
      })),
    };
  });
}

function getDefaultScoringRules(format: string): ScoringRules {
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
    { slot: '1B', maxCount: 1, eligiblePositions: ['1B'] },
    { slot: '2B', maxCount: 1, eligiblePositions: ['2B'] },
    { slot: '3B', maxCount: 1, eligiblePositions: ['3B'] },
    { slot: 'SS', maxCount: 1, eligiblePositions: ['SS'] },
    { slot: 'OF', maxCount: 3, eligiblePositions: ['OF'] },
    { slot: 'UTIL', maxCount: 1, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF'] },
    { slot: 'SP', maxCount: 2, eligiblePositions: ['SP'] },
    { slot: 'RP', maxCount: 2, eligiblePositions: ['RP'] },
    { slot: 'P', maxCount: 3, eligiblePositions: ['SP', 'RP'] },
    { slot: 'BN', maxCount: 5, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'] },
  ];
}
