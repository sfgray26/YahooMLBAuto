/**
 * Waiver Routes
 *
 * POST /waiver/recommendations - Request waiver recommendations for a hydrated roster
 * GET /waiver/:id/result - Get waiver recommendation result
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { prisma, addDecisionRequest } from '@cbb/infrastructure';
import type { WaiverRecommendationRequest, WaiverRecommendationResult } from '@cbb/core';
import {
  WaiverRequestSchema,
  getDefaultRosterPositions,
  getDefaultScoringRules,
} from './request-contracts.js';

export async function waiverRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
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
        leagueSize: body.leagueSize ?? 12,
        scoringRules: body.scoringRules ?? getDefaultScoringRules(body.format),
        rosterPositions: body.rosterPositions ?? getDefaultRosterPositions(),
      },
      currentRoster: body.currentRoster,
      availablePlayers: {
        players: body.availablePlayers.players,
        lastUpdated: body.availablePlayers.lastUpdated ?? now.toISOString(),
      },
      recommendationScope: body.scope,
      rosterNeeds: body.rosterNeeds ? {
        positionalNeeds: body.rosterNeeds.positionalNeeds ?? {},
        preferredUpside: body.rosterNeeds.preferredUpside,
      } : undefined,
    };

    await prisma.decisionRequest.create({
      data: {
        id: decisionRequest.id,
        version: decisionRequest.version,
        type: 'waiver_recommendation',
        createdAt: now,
        payload: decisionRequest as unknown as object,
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

    const result = decisionRequest.result?.payload as WaiverRecommendationResult | undefined;

    return {
      requestId: id,
      status: 'completed',
      generatedAt: decisionRequest.result?.createdAt,
      recommendations: result?.recommendations ?? [],
      rosterAnalysis: result?.rosterAnalysis ?? null,
    };
  });

  fastify.get('/recommendations', async (request, reply) => {
    const { limit = '10', offset = '0' } = request.query as { limit?: string; offset?: string };

    const recommendations = await prisma.decisionRequest.findMany({
      where: { type: 'waiver_recommendation' },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
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
      recommendations: recommendations.map((recommendation) => ({
        requestId: recommendation.id,
        status: recommendation.status,
        createdAt: recommendation.createdAt,
        completedAt: recommendation.result?.createdAt,
      })),
    };
  });
}
