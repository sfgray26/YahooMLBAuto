/**
 * Redis Queue Configuration
 * Uses BullMQ for reliable job processing
 */

import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

// Redis connection (shared across all queues)
export const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Queue names
export const QueueNames = {
  DECISION_REQUESTS: 'decision-requests',
  DATA_SYNC: 'data-sync',
  VALUATION_GENERATION: 'valuation-generation',
  ANALYTICS_JOBS: 'analytics-jobs',
  ALERTS: 'alerts',
} as const;

// ============================================================================
// Queue Type Definitions
// ============================================================================

export interface DecisionRequestJob {
  type: 'lineup_optimization' | 'waiver_recommendation' | 'player_valuation';
  payload: unknown;
  traceId: string;
  priority: number;
}

export interface DataSyncJob {
  type: 'player_data' | 'schedule' | 'weather' | 'scores';
  date?: string;
  forceRefresh?: boolean;
}

export interface ValuationJob {
  playerIds: string[];
  scoringPeriod: { start: string; end: string };
  traceId: string;
}

export interface AnalyticsJob {
  type: 'monte_carlo_sim' | 'factor_update' | 'model_retrain';
  parameters: Record<string, unknown>;
}

export interface AlertJob {
  type: 'high_confidence_decision' | 'manual_review_required' | 'daily_digest';
  decisionId?: string;
  message: string;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Queue Instances
// ============================================================================

export const decisionQueue = new Queue<DecisionRequestJob>(QueueNames.DECISION_REQUESTS, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const dataSyncQueue = new Queue<DataSyncJob>(QueueNames.DATA_SYNC, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export const valuationQueue = new Queue<ValuationJob>(QueueNames.VALUATION_GENERATION, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
  },
});

export const analyticsQueue = new Queue<AnalyticsJob>(QueueNames.ANALYTICS_JOBS, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
  },
});

export const alertQueue = new Queue<AlertJob>(QueueNames.ALERTS, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// ============================================================================
// Queue Utilities
// ============================================================================

export async function addDecisionRequest(
  type: DecisionRequestJob['type'],
  payload: unknown,
  traceId: string,
  priority = 5
): Promise<Job> {
  return decisionQueue.add(type, {
    type,
    payload,
    traceId,
    priority,
  }, {
    priority,
    jobId: traceId,
  });
}

export async function addDataSync(
  type: DataSyncJob['type'],
  options: { date?: string; forceRefresh?: boolean } = {}
): Promise<Job> {
  return dataSyncQueue.add(type, {
    type,
    date: options.date,
    forceRefresh: options.forceRefresh,
  });
}

export async function addValuationJob(
  playerIds: string[],
  scoringPeriod: { start: string; end: string },
  traceId: string
): Promise<Job> {
  return valuationQueue.add('generate-valuations', {
    playerIds,
    scoringPeriod,
    traceId,
  });
}

export async function addAlert(
  type: AlertJob['type'],
  message: string,
  metadata: Record<string, unknown> = {},
  decisionId?: string
): Promise<Job> {
  return alertQueue.add(type, {
    type,
    message,
    metadata,
    decisionId,
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export async function closeQueues(): Promise<void> {
  await Promise.all([
    decisionQueue.close(),
    dataSyncQueue.close(),
    valuationQueue.close(),
    analyticsQueue.close(),
    alertQueue.close(),
  ]);
  await redisConnection.quit();
}
