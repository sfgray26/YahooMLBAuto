/**
 * Background Worker
 * 
 * Processes jobs from the queue:
 * - Decision requests (lineup optimization, waiver recommendations)
 * - Data sync (player data, schedules, weather)
 * - Valuation generation
 * - Analytics jobs
 * - Alerts
 */

import { Worker } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

import { 
  redisConnection, 
  QueueNames, 
  prisma, 
  addAlert,
  closeQueues 
} from '@cbb/infrastructure';

import { handleLineupOptimization } from './handlers/lineup.js';
import { handleWaiverRecommendation } from './handlers/waiver.js';
import { handleDataSync } from './handlers/dataSync.js';
import { handleValuation } from './handlers/valuation.js';
import { mapConfidenceLabel } from './decisions/confidence.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractConfidenceScore(result: unknown): number | null {
  if (!isRecord(result)) {
    return null;
  }

  const confidenceScore = result.confidenceScore;
  return typeof confidenceScore === 'number' ? confidenceScore : null;
}

function toConfidenceLabel(confidenceScore: number | null): string | null {
  if (confidenceScore === null) {
    return null;
  }

  return mapConfidenceLabel(confidenceScore);
}

function assertDecisionPayload(type: string, payload: unknown): void {
  if (!isRecord(payload)) {
    throw new Error(`Invalid ${type} payload: expected an object`);
  }

  switch (type) {
    case 'lineup_optimization':
      {
        const players = isRecord(payload.availablePlayers) ? payload.availablePlayers.players : null;
        if (!Array.isArray(players) || players.length === 0) {
          throw new Error('Invalid lineup_optimization payload: availablePlayers.players must be present');
        }
      }
      return;
    case 'waiver_recommendation': {
      const currentRoster = payload.currentRoster;
      const availablePlayers = isRecord(payload.availablePlayers) ? payload.availablePlayers.players : null;
      if (!Array.isArray(currentRoster) || currentRoster.length === 0) {
        throw new Error('Invalid waiver_recommendation payload: currentRoster must be present');
      }
      if (!Array.isArray(availablePlayers) || availablePlayers.length === 0) {
        throw new Error('Invalid waiver_recommendation payload: availablePlayers.players must be present');
      }
      return;
    }
    case 'player_valuation':
      if (typeof payload.playerId !== 'string' || !isRecord(payload.scoringPeriod)) {
        throw new Error('Invalid player_valuation payload: playerId and scoringPeriod are required');
      }
      return;
    default:
      throw new Error(`Unknown decision type: ${type}`);
  }
}

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[INFO] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[ERROR] ${msg}`, meta || ''),
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[DEBUG] ${msg}`, meta || '');
    }
  },
};

// ============================================================================
// Decision Request Worker
// ============================================================================

const decisionWorker = new Worker(
  QueueNames.DECISION_REQUESTS,
  async (job) => {
    const { type, payload, traceId } = job.data;
    
    logger.info(`Processing decision request: ${type}`, { jobId: job.id, traceId });
    
    const startTime = Date.now();
    
    try {
      const decisionRequest = await prisma.decisionRequest.update({
        where: { traceId },
        data: { status: 'processing' },
      });

      assertDecisionPayload(type, payload);
      
      let result;
      
      switch (type) {
        case 'lineup_optimization':
          result = await handleLineupOptimization(payload, traceId);
          break;
          
        case 'waiver_recommendation':
          result = await handleWaiverRecommendation(payload, traceId);
          break;
          
        case 'player_valuation':
          // Handle single player valuation
          result = await handleValuation([payload.playerId], payload.scoringPeriod, traceId);
          break;
          
        default:
          throw new Error(`Unknown decision type: ${type}`);
      }
      
      const confidenceScore = extractConfidenceScore(result);
      const confidenceLabel = toConfidenceLabel(confidenceScore);
      
      await prisma.decisionResult.create({
        data: {
          id: uuidv4(),
          requestId: decisionRequest.id,
          type: `${type}_result`,
          payload: result as unknown as object,
          completedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
          confidence: confidenceLabel,
        },
      });
      
      // Update request status to completed
      await prisma.decisionRequest.update({
        where: { traceId },
        data: { status: 'completed' },
      });
      
      // Trigger alert for high-confidence decisions
      if (confidenceScore !== null && confidenceScore >= 0.85) {
        await addAlert(
          'high_confidence_decision',
          `High confidence ${type} completed`,
          { requestId: decisionRequest.id, confidence: confidenceScore },
          decisionRequest.id
        );
      }
      
      logger.info(`Decision request completed: ${type}`, { 
        jobId: job.id, 
        traceId,
        processingTimeMs: Date.now() - startTime,
      });
      
      return result;
      
    } catch (error) {
      logger.error(`Decision request failed: ${type}`, { 
        jobId: job.id, 
        traceId, 
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      // Update request status to failed
      await prisma.decisionRequest.update({
        where: { traceId },
        data: { status: 'failed' },
      });
      
      throw error;
    }
  },
  { 
    connection: redisConnection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  }
);

// ============================================================================
// Data Sync Worker
// ============================================================================

const dataSyncWorker = new Worker(
  QueueNames.DATA_SYNC,
  async (job) => {
    const { type, date, forceRefresh } = job.data;
    
    logger.info(`Processing data sync: ${type}`, { jobId: job.id, date });
    
    try {
      const result = await handleDataSync(type, { date, forceRefresh });
      
      logger.info(`Data sync completed: ${type}`, { jobId: job.id });
      
      return result;
    } catch (error) {
      logger.error(`Data sync failed: ${type}`, { 
        jobId: job.id, 
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  },
  { 
    connection: redisConnection,
    concurrency: 2, // Lower concurrency for data sync to avoid rate limits
  }
);

// ============================================================================
// Valuation Worker
// ============================================================================

const valuationWorker = new Worker(
  QueueNames.VALUATION_GENERATION,
  async (job) => {
    const { playerIds, scoringPeriod, traceId } = job.data;
    
    logger.info(`Processing valuation job`, { 
      jobId: job.id, 
      playerCount: playerIds.length,
      traceId,
    });
    
    try {
      const valuations = await handleValuation(playerIds, scoringPeriod, traceId);
      
      logger.info(`Valuation job completed`, { 
        jobId: job.id, 
        valuationCount: valuations.length,
      });
      
      return valuations;
    } catch (error) {
      logger.error(`Valuation job failed`, { 
        jobId: job.id, 
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  },
  { 
    connection: redisConnection,
    concurrency: 3,
  }
);

// ============================================================================
// Analytics Worker
// ============================================================================

const analyticsWorker = new Worker(
  QueueNames.ANALYTICS_JOBS,
  async (job) => {
    const { type, parameters } = job.data;
    
    logger.info(`Processing analytics job: ${type}`, { jobId: job.id });
    
    // Placeholder for analytics jobs (Monte Carlo, model retraining, etc.)
    // These would be implemented in packages/analytics
    
    logger.info(`Analytics job completed: ${type}`, { jobId: job.id });
    
    return { type, completed: true };
  },
  { 
    connection: redisConnection,
    concurrency: 1, // Analytics jobs are resource-intensive
  }
);

// ============================================================================
// Alert Worker
// ============================================================================

const alertWorker = new Worker(
  QueueNames.ALERTS,
  async (job) => {
    const { type, message, metadata, decisionId } = job.data;
    
    logger.info(`Processing alert: ${type}`, { jobId: job.id, message });
    
    // Placeholder for alert handling
    // In production, this would send emails, webhooks, etc.
    // For now, just log the alert
    
    // Store alert in database for audit
    await prisma.systemEvent.create({
      data: {
        eventId: uuidv4(),
        eventType: 'alert_triggered',
        payload: {
          type,
          message,
          metadata,
          decisionId,
        },
        metadata: {
          source: 'worker',
          traceId: uuidv4(),
        },
      },
    });
    
    logger.info(`Alert processed: ${type}`, { jobId: job.id });
    
    return { alerted: true };
  },
  { 
    connection: redisConnection,
    concurrency: 5,
  }
);

// ============================================================================
// Event Handlers
// ============================================================================

decisionWorker.on('completed', (job) => {
  logger.debug(`Job completed`, { jobId: job.id });
});

decisionWorker.on('failed', (job, error) => {
  logger.error(`Job failed`, { jobId: job?.id, error: error.message });
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing workers...');
  
  await decisionWorker.close();
  await dataSyncWorker.close();
  await valuationWorker.close();
  await analyticsWorker.close();
  await alertWorker.close();
  
  await closeQueues();
  await prisma.$disconnect();
  
  logger.info('Workers closed, exiting');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing workers...');
  
  await decisionWorker.close();
  await dataSyncWorker.close();
  await valuationWorker.close();
  await analyticsWorker.close();
  await alertWorker.close();
  
  await closeQueues();
  await prisma.$disconnect();
  
  logger.info('Workers closed, exiting');
  process.exit(0);
});

logger.info('Worker started', { 
  concurrency: process.env.WORKER_CONCURRENCY || '5',
  queues: Object.values(QueueNames),
});
