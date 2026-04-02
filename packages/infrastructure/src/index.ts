// Database
export { prisma } from './database/client.js';
export type * from '@prisma/client';

// Queue
export {
  redisConnection,
  QueueNames,
  decisionQueue,
  dataSyncQueue,
  valuationQueue,
  analyticsQueue,
  alertQueue,
  addDecisionRequest,
  addDataSync,
  addValuationJob,
  addAlert,
  closeQueues,
} from './queue/index.js';

export type {
  DecisionRequestJob,
  DataSyncJob,
  ValuationJob,
  AnalyticsJob,
  AlertJob,
} from './queue/index.js';

// Persistence
export {
  persistLineupDecision,
  persistWaiverDecision,
  updateLineupDecisionWithActualResults,
  updateWaiverDecisionWithActualResults,
  queryDecisions,
  getDecisionById,
  getDecisionPerformanceSummary,
} from './persistence/decision-repository.js';
