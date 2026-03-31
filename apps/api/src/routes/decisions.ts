/**
 * Decision Routes
 * 
 * GET /decisions/pending - Get pending decisions requiring review
 * GET /decisions/:id - Get specific decision
 * POST /decisions/:id/approve - Approve a decision
 * POST /decisions/:id/reject - Reject a decision
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';

import { prisma } from '@cbb/infrastructure';
import type { ExecutionDecision } from '@cbb/core';

export async function decisionRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // GET /decisions/pending
  // Get pending decisions requiring human review
  // ==========================================================================
  fastify.get('/pending', async (request, reply) => {
    const { limit = '20', type } = request.query as { 
      limit?: string;
      type?: string;
    };
    
    const where: Record<string, unknown> = {
      status: 'pending',
      humanReviewRequired: true,
    };
    
    if (type) {
      where.decisionType = type;
    }

    const decisions = await prisma.executionDecision.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: parseInt(limit),
    });

    return {
      decisions: decisions.map(d => {
        const payload = d as unknown as ExecutionDecision;
        return {
          decisionId: d.id,
          type: d.decisionType,
          createdAt: d.createdAt,
          target: d.targetId,
          confidence: d.confidence,
          executionMode: d.executionMode,
          recommendedAction: payload.recommendedAction,
          reasoning: payload.reasoning,
        };
      }),
    };
  });

  // ==========================================================================
  // GET /decisions/:id
  // Get specific decision details
  // ==========================================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const decision = await prisma.executionDecision.findUnique({
      where: { id },
    });

    if (!decision) {
      return reply.status(404).send({
        error: 'Decision not found',
        decisionId: id,
      });
    }

    const payload = decision as unknown as ExecutionDecision;

    return {
      decisionId: decision.id,
      version: decision.version,
      createdAt: decision.createdAt,
      type: decision.decisionType,
      status: decision.status,
      target: {
        type: decision.targetType,
        id: decision.targetId,
      },
      recommendedAction: payload.recommendedAction,
      reasoning: payload.reasoning,
      confidence: decision.confidence,
      alternativeActions: payload.alternativeActions,
      executionMode: payload.executionMode,
      humanReviewRequired: decision.humanReviewRequired,
      decidedAt: decision.decidedAt,
      decidedBy: decision.decidedBy,
    };
  });

  // ==========================================================================
  // GET /decisions
  // List all decisions
  // ==========================================================================
  fastify.get('/', async (request, reply) => {
    const { limit = '20', offset = '0', status, type } = request.query as { 
      limit?: string;
      offset?: string;
      status?: string;
      type?: string;
    };
    
    const where: Record<string, unknown> = {};
    
    if (status) {
      where.status = status;
    }
    
    if (type) {
      where.decisionType = type;
    }

    const decisions = await prisma.executionDecision.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: parseInt(limit),
      skip: parseInt(offset),
      select: {
        id: true,
        decisionType: true,
        status: true,
        createdAt: true,
        decidedAt: true,
        targetId: true,
        confidence: true,
        executionMode: true,
      },
    });

    return {
      decisions: decisions.map(d => ({
        decisionId: d.id,
        type: d.decisionType,
        status: d.status,
        createdAt: d.createdAt,
        decidedAt: d.decidedAt,
        targetId: d.targetId,
        confidence: d.confidence,
        executionMode: d.executionMode,
      })),
    };
  });

  // ==========================================================================
  // POST /decisions/:id/approve
  // Approve a decision for execution
  // ==========================================================================
  fastify.post('/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const decision = await prisma.executionDecision.findUnique({
      where: { id },
    });

    if (!decision) {
      return reply.status(404).send({
        error: 'Decision not found',
        decisionId: id,
      });
    }

    if (decision.status !== 'pending') {
      return reply.status(400).send({
        error: 'Decision is not in pending status',
        decisionId: id,
        currentStatus: decision.status,
      });
    }

    await prisma.executionDecision.update({
      where: { id },
      data: {
        status: 'approved',
        decidedAt: new Date(),
        decidedBy: 'user',
      },
    });

    return {
      success: true,
      message: 'Decision approved',
      decisionId: id,
      status: 'approved',
    };
  });

  // ==========================================================================
  // POST /decisions/:id/reject
  // Reject a decision
  // ==========================================================================
  fastify.post('/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };
    
    const decision = await prisma.executionDecision.findUnique({
      where: { id },
    });

    if (!decision) {
      return reply.status(404).send({
        error: 'Decision not found',
        decisionId: id,
      });
    }

    if (decision.status !== 'pending') {
      return reply.status(400).send({
        error: 'Decision is not in pending status',
        decisionId: id,
        currentStatus: decision.status,
      });
    }

    await prisma.executionDecision.update({
      where: { id },
      data: {
        status: 'rejected',
        decidedAt: new Date(),
        decidedBy: 'user',
      },
    });

    return {
      success: true,
      message: 'Decision rejected',
      decisionId: id,
      status: 'rejected',
      reason: reason || null,
    };
  });
}
