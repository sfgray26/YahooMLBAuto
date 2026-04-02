/**
 * Decision Persistence Module
 * 
 * Non-negotiable for elite systems.
 * Every decision stored with full metadata for backtesting and auditing.
 */

// Contract types only - repository implementation is in @cbb/infrastructure
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
