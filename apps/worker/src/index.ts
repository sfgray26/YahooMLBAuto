/**
 * Worker Package Exports
 * 
 * Exports for use by other packages (e.g., API admin routes)
 */

// Ingestion
export { runDailyIngestion, validateIngestion } from './ingestion/index.js';
export { fetchPlayerGameLogsFromApi, storeGameLogs, ingestGameLogsForPlayers, ingestGameLogsWithValidation, ingestGameLogs } from './ingestion/gameLogs.js';

// Derived Stats
export {
  computeDerivedStatsFromGameLogs,
  batchComputeDerivedStatsFromGameLogs,
} from './derived/fromGameLogs.js';

// Monte Carlo (legacy - use probabilistic instead)
export { simulatePlayerOutcome, comparePlayers } from './monte-carlo/index.js';

// Validation (legacy - name-based validation)
export {
  validatePlayerIdentity,
  validatePlayerBatch,
  lookupPlayerByName,
  suggestCorrectId,
} from './validation/playerIdentity.js';
export type { PlayerIdentity, ValidationResult } from './validation/playerIdentity.js';

// Verification (Phase 1: Trust Boundary with VerifiedPlayer registry)
export {
  verifyPlayerIdentity,
  isPlayerVerified,
  getVerifiedPlayer,
  upsertVerifiedPlayer,
} from './verification/playerIdentity.js';
export type { PlayerIdentity as VerifiedIdentity } from './verification/playerIdentity.js';

// Gated Ingestion (hard boundary - no player enters without verification)
export {
  ingestPlayer,
  ingestPlayerBatch,
  type GatedIngestionResult,
} from './verification/gatedIngestion.js';

// Waiver Safety (guaranteed verified recommendations)
export {
  recommendWaiverPickup,
  recommendWaiverBatch,
  filterVerifiedPlayers,
  type SafeWaiverRecommendation,
  type WaiverRecommendationError,
  type WaiverRecommendationResult,
} from './verification/waiverSafety.js';

// Scoring
export { computePlayerScore } from './scoring/playerScore.js';
export type { PlayerScore as PlayerScoreReport } from './scoring/playerScore.js';
export type { PlayerScore } from './scoring/compute.js';

// Momentum
export { calculateMomentum } from './momentum/index.js';
export type { MomentumMetrics } from './momentum/index.js';

// Probabilistic / Monte Carlo
export { simulatePlayerOutcomes } from './probabilistic/index.js';
export type { ProbabilisticOutcome, PercentileOutcomes, RiskProfile } from './probabilistic/index.js';

// Trade Evaluator
export { evaluateTrade } from './trade/evaluator.js';
export { simulateTradeScenarios, quickTradeEstimate } from './trade/simulator.js';
export { formatTradeEvaluation, formatPlayerList, formatOneLine } from './trade/formatter.js';
export type {
  TradeProposal,
  TradeEvaluation,
  TradePlayer,
  TradeRecommendation,
  TradeEvaluatorConfig,
  TradeSideAnalysis,
  CategoryImpact,
  RiskImpact,
  RosterImpact,
  WorldProjection,
  WorldDelta,
  TradeExplanation,
  TeamState,
} from './trade/types.js';
