/**
 * Decision Persistence Module
 * 
 * Non-negotiable for elite systems.
 * Every decision stored with full metadata for backtesting and auditing.
 */

// Contract types
export type {
  LineupDecisionRecord,
  WaiverDecisionRecord,
  TeamStateSnapshot,
  SlotDecision,
  BenchDecision,
  PlayerSnapshot,
  RosterAnalysisSnapshot,
  DecisionQuery,
  DecisionPerformanceSummary,
  LineupAccuracyMetrics,
  WaiverActualResult,
} from './contract.js';

// Repository functions
export {
  persistLineupDecision,
  persistWaiverDecision,
  updateLineupDecisionWithActualResults,
  updateWaiverDecisionWithActualResults,
  queryDecisions,
  getDecisionById,
  getDecisionPerformanceSummary,
} from '../../infrastructure/src/persistence/decision-repository.js';
