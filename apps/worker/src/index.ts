/**
 * Worker Package Exports
 * 
 * Exports for use by other packages (e.g., API admin routes)
 */

// Ingestion
export { runDailyIngestion, validateIngestion } from './ingestion/index.js';
export { fetchPlayerGameLogsFromApi, storeGameLogs, ingestGameLogsForPlayers } from './ingestion/gameLogs.js';

// Derived Stats
export {
  computeDerivedStatsFromGameLogs,
  batchComputeDerivedStatsFromGameLogs,
} from './derived/fromGameLogs.js';

// Monte Carlo
export { simulatePlayerOutcome, simulatePlayerOutcomes, comparePlayers } from './monte-carlo/index.js';
