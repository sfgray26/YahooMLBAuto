/**
 * Lineup Routes
 *
 * POST /lineup/today - Request lineup optimization for an already hydrated roster
 * GET /lineup/:id/result - Get lineup optimization result
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { prisma, addDecisionRequest } from '@cbb/infrastructure';
import {
  buildMlbScoringPeriod,
  type LineupOptimizationRequest,
  type LineupOptimizationResult,
  type MlbScoringPeriodPreset,
} from '@cbb/core';
import {
  LineupRequestSchema,
  getDefaultRosterPositions,
  getDefaultScoringRules,
  getRiskProfile,
} from './request-contracts.js';

export async function lineupRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  fastify.post('/today', async (request, reply) => {
    const traceId = uuidv4();
    const body = LineupRequestSchema.parse(request.body);
    const now = new Date();
    const scoringPeriod = buildMlbScoringPeriod(body.scoringPeriod as MlbScoringPeriodPreset, now);

    const decisionRequest: LineupOptimizationRequest = {
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
      scoringPeriod: {
        ...scoringPeriod,
        games: [],
      },
      rosterConstraints: {
        lockedSlots: [],
        mustInclude: body.manualOverrides
          ?.filter((override) => override.action === 'lock_in')
          .map((override) => override.playerId) ?? [],
        mustExclude: body.manualOverrides
          ?.filter((override) => override.action === 'lock_out')
          .map((override) => override.playerId) ?? [],
      },
      availablePlayers: {
        players: body.availablePlayers.players,
        lastUpdated: body.availablePlayers.lastUpdated ?? now.toISOString(),
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

    await prisma.decisionRequest.create({
      data: {
        id: decisionRequest.id,
        version: decisionRequest.version,
        type: 'lineup_optimization',
        createdAt: now,
        payload: decisionRequest as unknown as object,
        status: 'pending',
        traceId,
      },
    });

    await addDecisionRequest(
      'lineup_optimization',
      decisionRequest,
      traceId,
      10
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

    if (decisionRequest.status === 'pending' || decisionRequest.status === 'processing') {
      return {
        requestId: id,
        status: decisionRequest.status,
        createdAt: decisionRequest.createdAt,
        message: 'Optimization in progress, check back shortly',
      };
    }

    if (decisionRequest.status === 'failed') {
      return reply.status(500).send({
        requestId: id,
        status: 'failed',
        error: 'Optimization failed. Please try again.',
      });
    }

    const result = decisionRequest.result?.payload as LineupOptimizationResult | undefined;

    return {
      requestId: id,
      status: 'completed',
      generatedAt: decisionRequest.result?.createdAt,
      lineup: result?.optimalLineup ?? [],
      expectedPoints: result?.expectedPoints ?? 0,
      confidenceScore: result?.confidenceScore ?? 0,
      explanation: result?.explanation ?? null,
      alternativeLineups: result?.alternativeLineups ?? [],
    };
  });

  fastify.get('/optimizations', async (request, reply) => {
    const { limit = '10', offset = '0' } = request.query as { limit?: string; offset?: string };

    const optimizations = await prisma.decisionRequest.findMany({
      where: { type: 'lineup_optimization' },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
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
      optimizations: optimizations.map((optimization) => ({
        requestId: optimization.id,
        status: optimization.status,
        createdAt: optimization.createdAt,
        completedAt: optimization.result?.createdAt,
        confidence: optimization.result?.confidence,
      })),
    };
  });
}
