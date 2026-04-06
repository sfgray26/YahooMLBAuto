/**
 * Centralized Season Configuration
 * 
 * Single source of truth for the current MLB season.
 * Update this file when migrating to a new season.
 */

/**
 * Primary season for data ingestion and analysis.
 */
export const CURRENT_SEASON = 2026;

/**
 * Season for ROS (Rest of Season) projections.
 * Typically matches CURRENT_SEASON unless doing historical analysis.
 */
export const ROS_SEASON = CURRENT_SEASON;

/**
 * Historical seasons available for backtesting.
 */
export const AVAILABLE_HISTORICAL_SEASONS = [2024, 2025] as const;

/**
 * Check if a season has data available from the API.
 * Use this to validate before running ingestion.
 */
export function isValidIngestionSeason(season: number): boolean {
  // Valid seasons from 2022 to current
  return season >= 2022 && season <= CURRENT_SEASON;
}

/**
 * Get the recommended season for new ingestion runs.
 */
export function getRecommendedIngestionSeason(): number {
  return CURRENT_SEASON;
}
