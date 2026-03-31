/**
 * Redis Queue Configuration
 * Uses BullMQ for reliable job processing
 */
import { Queue } from 'bullmq';
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
};
// ============================================================================
// Queue Instances
// ============================================================================
export const decisionQueue = new Queue(QueueNames.DECISION_REQUESTS, {
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
export const dataSyncQueue = new Queue(QueueNames.DATA_SYNC, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
    },
});
export const valuationQueue = new Queue(QueueNames.VALUATION_GENERATION, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: {
            type: 'fixed',
            delay: 5000,
        },
    },
});
export const analyticsQueue = new Queue(QueueNames.ANALYTICS_JOBS, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 1,
    },
});
export const alertQueue = new Queue(QueueNames.ALERTS, {
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
export async function addDecisionRequest(type, payload, traceId, priority = 5) {
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
export async function addDataSync(type, options = {}) {
    return dataSyncQueue.add(type, {
        type,
        date: options.date,
        forceRefresh: options.forceRefresh,
    });
}
export async function addValuationJob(playerIds, scoringPeriod, traceId) {
    return valuationQueue.add('generate-valuations', {
        playerIds,
        scoringPeriod,
        traceId,
    });
}
export async function addAlert(type, message, metadata = {}, decisionId) {
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
export async function closeQueues() {
    await Promise.all([
        decisionQueue.close(),
        dataSyncQueue.close(),
        valuationQueue.close(),
        analyticsQueue.close(),
        alertQueue.close(),
    ]);
    await redisConnection.quit();
}
//# sourceMappingURL=index.js.map