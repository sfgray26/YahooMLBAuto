/**
 * UAT Validators Index
 * Export all validation functions for Foundation Integrity Tests
 */

// Row Count Drift
export {
  checkRawToNormalizedDrift,
  checkIngestionStability,
  checkPlayerCoverage,
} from './row-count-drift.js';

// Duplicate Detection
export {
  checkDuplicateGameLogs,
  checkDuplicateDailyStats,
  checkDuplicateRawIngestion,
  checkDuplicateVerifiedPlayers,
  checkDuplicateDerivedStats,
} from './duplicate-detection.js';

// Stat Inflation
export {
  checkGameLogAggregation,
  checkDerivedStatsAccuracy,
  checkAnomalousStats,
} from './stat-inflation.js';

// Completeness
export {
  checkDateGaps,
  checkMissingPlayers,
  checkDataFreshness,
  checkTeamScheduleCompleteness,
} from './completeness.js';

// Reconciliation
export {
  checkRawToNormalizedReconciliation,
  checkGameLogTraceability,
  checkDerivedFeatureReconciliation,
  checkRawDataPreservation,
} from './reconciliation.js';
