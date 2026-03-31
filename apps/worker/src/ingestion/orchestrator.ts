/**
 * Ingestion Orchestrator
 * 
 * Phase 4: Worker runs on schedule, fetches fresh data,
 * stores raw and normalized, exits cleanly.
 * 
 * - One source: MLB Stats API
 * - One dataset: Player season stats
 * - One cadence: Daily
 * - Idempotent: Yes (upserts based on natural keys)
 * - Observable: Yes (logs everything)
 * - Boring: Yes (no side effects, no triggers)
 */

import { v4 as uuidv4 } from 'uuid';
import { fetchPlayerStats } from './adapters/mlbStatsApi.js';
import { storeRawStats, logIngestionEvent } from './storage/raw.js';
import { normalizePlayerStats } from './normalization/stats.js';

export interface IngestionConfig {
  season: number;
  gameType?: 'R' | 'S' | 'E';
  dryRun?: boolean;
}

export interface IngestionResult {
  success: boolean;
  traceId: string;
  stats: {
    rawRecordsFetched: number;
    rawStored: boolean;
    normalizedCreated: number;
    normalizedUpdated: number;
    durationMs: number;
  };
  errors: string[];
}

/**
 * Run daily ingestion.
 * Fetches fresh data, stores raw, normalizes, exits cleanly.
 */
export async function runDailyIngestion(
  config: IngestionConfig
): Promise<IngestionResult> {
  const startTime = Date.now();
  const traceId = uuidv4();
  const errors: string[] = [];
  
  const { season, gameType = 'R', dryRun = false } = config;
  
  console.log(`[INGESTION] Starting daily ingestion`, {
    season,
    gameType,
    traceId,
    dryRun,
  });
  
  try {
    // ==========================================================================
    // Step 1: Fetch data exactly as provided
    // ==========================================================================
    console.log(`[INGESTION] Fetching player stats from MLB Stats API...`);
    
    const rawStats = await fetchPlayerStats({ season, gameType });
    const rawRecordCount = rawStats.length;
    
    console.log(`[INGESTION] Fetched ${rawRecordCount} player stat records`);
    
    if (rawRecordCount === 0) {
      errors.push('No data returned from API');
    }
    
    // ==========================================================================
    // Step 2: Store raw data immediately (before any transformation)
    // ==========================================================================
    let rawStored = false;
    
    if (!dryRun && rawRecordCount > 0) {
      try {
        await storeRawStats({
          source: 'mlb_stats_api',
          endpoint: `/stats?stats=season&group=hitting&season=${season}&gameType=${gameType}`,
          season,
          gameType,
          fetchedAt: new Date(),
          rawPayload: rawStats,
          recordCount: rawRecordCount,
          traceId,
        });
        
        rawStored = true;
        console.log(`[INGESTION] Raw data stored successfully`);
      } catch (error) {
        const errorMsg = `Failed to store raw data: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[INGESTION] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
    
    // ==========================================================================
    // Step 3: Normalize into domain tables
    // ==========================================================================
    let normalizedCreated = 0;
    let normalizedUpdated = 0;
    
    if (!dryRun && rawRecordCount > 0) {
      try {
        console.log(`[INGESTION] Normalizing ${rawRecordCount} records...`);
        
        const result = await normalizePlayerStats({
          rawStats,
          season,
          traceId,
        });
        
        normalizedCreated = result.created;
        normalizedUpdated = result.updated;
        
        console.log(`[INGESTION] Normalization complete`, {
          created: normalizedCreated,
          updated: normalizedUpdated,
        });
      } catch (error) {
        const errorMsg = `Failed to normalize data: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[INGESTION] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
    
    // ==========================================================================
    // Step 5: Observe and log everything
    // ==========================================================================
    const durationMs = Date.now() - startTime;
    
    await logIngestionEvent('daily_ingestion_complete', {
      season,
      gameType,
      rawRecordsFetched: rawRecordCount,
      rawStored,
      normalizedCreated,
      normalizedUpdated,
      durationMs,
      errors,
      dryRun,
    }, traceId);
    
    console.log(`[INGESTION] Complete in ${durationMs}ms`, {
      rawRecordsFetched: rawRecordCount,
      rawStored,
      normalizedCreated,
      normalizedUpdated,
      errorCount: errors.length,
    });
    
    // ==========================================================================
    // Exit cleanly - no side effects, no triggers
    // ==========================================================================
    return {
      success: errors.length === 0,
      traceId,
      stats: {
        rawRecordsFetched: rawRecordCount,
        rawStored,
        normalizedCreated,
        normalizedUpdated,
        durationMs,
      },
      errors,
    };
    
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    console.error(`[INGESTION] Fatal error after ${durationMs}ms:`, errorMsg);
    
    await logIngestionEvent('daily_ingestion_failed', {
      season,
      gameType,
      error: errorMsg,
      durationMs,
    }, traceId);
    
    return {
      success: false,
      traceId,
      stats: {
        rawRecordsFetched: 0,
        rawStored: false,
        normalizedCreated: 0,
        normalizedUpdated: 0,
        durationMs,
      },
      errors: [errorMsg],
    };
  }
}

/**
 * Validate ingestion before moving on.
 * Checks that data exists for expected window.
 */
export async function validateIngestion(season: number): Promise<{
  valid: boolean;
  playerCount: number;
  dateRange: { min: Date | null; max: Date | null };
  issues: string[];
}> {
  const { prisma } = await import('@cbb/infrastructure');
  
  const issues: string[] = [];
  
  // Count players with stats
  const playerCount = await prisma.playerDailyStats.count({
    where: { season },
  });
  
  if (playerCount === 0) {
    issues.push('No player stats found for season');
  } else if (playerCount < 100) {
    issues.push(`Low player count (${playerCount}), expected 500+`);
  }
  
  // Check date range
  const dateRange = await prisma.playerDailyStats.aggregate({
    where: { season },
    _min: { statDate: true },
    _max: { statDate: true },
  });
  
  return {
    valid: issues.length === 0,
    playerCount,
    dateRange: {
      min: dateRange._min.statDate,
      max: dateRange._max.statDate,
    },
    issues,
  };
}
