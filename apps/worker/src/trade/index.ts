/**
 * Trade Evaluator Module
 *
 * Entry point for trade evaluation functionality.
 * Provides a clean API for evaluating trade proposals.
 */

export { evaluateTrade } from './evaluator.js';
export { simulateTradeScenarios, quickTradeEstimate } from './simulator.js';
export { formatTradeEvaluation, formatPlayerList, formatOneLine } from './formatter.js';

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
  PositionalBalance,
} from './types.js';
