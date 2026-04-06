/**
 * Backtesting Harness
 *
 * Complete historical backtesting system for validating the fantasy
 * baseball intelligence stack.
 *
 * Usage:
 * ```typescript
 * import { runBacktest, loadHistoricalSeason } from './backtest';
 *
 * // Load historical data
 * const worldStates = await loadHistoricalSeason(2024, 'my-team', 'my-league');
 *
 * // Run backtest
 * const results = await runBacktest(worldStates, {
 *   season: 2024,
 *   baselines: [NaiveBaseline, HumanHeuristicBaseline],
 * });
 *
 * // View report
 * console.log(results.report);
 * ```
 */

// Core exports
export { HistoricalDataLoader, loadHistoricalSeason } from './dataLoader.js';
export { BacktestSimulator, runBacktest } from './simulator.js';
export { FantasyOutcomeCalculator } from './outcomeCalculator.js';
export { MetricsCalculator } from './metrics.js';
export { ReportGenerator, GoldenBaselineManager } from './reportGenerator.js';

// Baselines
export {
  NaiveBaseline,
  HumanHeuristicBaseline,
  PositionOnlyBaseline,
  createHistoricalBaseline,
  AllBaselines,
} from './baselines.js';

// Types
export type {
  WorldState,
  HistoricalRoster,
  HistoricalPlayer,
  HistoricalGame,
  SimulationStep,
  OptimizerDecision,
  FantasyOutcome,
  CategoryStats,
  BacktestMetrics,
  BacktestReport,
  BaselineStrategy,
  GoldenBaseline,
} from './types.js';

// Configuration helper
export interface BacktestConfig {
  season: number;
  teamId: string;
  leagueId: string;
  weeklyMode?: boolean;
  baselines?: string[]; // 'naive', 'human', 'position', etc.
  verbose?: boolean;
}

/**
 * Quick backtest with minimal configuration
 */
export async function quickBacktest(config: BacktestConfig) {
  const { loadHistoricalSeason } = await import('./dataLoader.js');
  const { runBacktest } = await import('./simulator.js');
  const { AllBaselines } = await import('./baselines.js');
  
  // Load data
  const worldStates = await loadHistoricalSeason(
    config.season,
    config.teamId,
    config.leagueId,
    config.weeklyMode ?? true
  );
  
  // Select baselines
  const selectedBaselines = config.baselines 
    ? AllBaselines.filter(b => config.baselines?.includes(b.name))
    : AllBaselines;
  
  // Run simulation
  return runBacktest(worldStates, {
    season: config.season,
    teamId: config.teamId,
    leagueId: config.leagueId,
    weeklyMode: config.weeklyMode ?? true,
    baselines: selectedBaselines,
    verbose: config.verbose ?? true,
  });
}
