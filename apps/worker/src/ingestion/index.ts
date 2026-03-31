/**
 * Data Ingestion Module
 * 
 * One source, one dataset, one cadence.
 * Raw data → Normalized data only.
 * No modeling, no rolling stats, no joins yet.
 */

export { runDailyIngestion, validateIngestion } from './orchestrator.js';
export type { IngestionConfig, IngestionResult } from './orchestrator.js';
