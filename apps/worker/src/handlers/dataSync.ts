/**
 * Data Sync Handler
 *
 * Handles data synchronization from external sources.
 * Pipeline: Ingestion → Derived Features → Scoring
 */

import { runDailyIngestion, ingestGameLogsForPlayers } from '../ingestion/index.js';
import { computeAllDerivedFeatures } from '../derived/index.js';
import { batchScorePlayers } from '../scoring/index.js';
import { prisma } from '@cbb/infrastructure';

interface DataSyncOptions {
  date?: string;
  forceRefresh?: boolean;
}

export async function handleDataSync(
  type: 'player_data' | 'schedule' | 'weather' | 'scores',
  options: DataSyncOptions
): Promise<{ synced: boolean; count?: number; traceId?: string; scoresComputed?: number }> {

  switch (type) {
    case 'player_data':
      return syncPlayerDataPipeline(options);

    case 'schedule':
      return { synced: false, count: 0, traceId: 'not-implemented' };

    case 'weather':
      return { synced: false, count: 0, traceId: 'not-implemented' };

    case 'scores':
      return { synced: false, count: 0, traceId: 'not-implemented' };

    default:
      throw new Error(`Unknown sync type: ${type}`);
  }
}

async function syncPlayerDataPipeline(
  options: DataSyncOptions
): Promise<{ synced: boolean; count: number; traceId: string; scoresComputed: number; gameLogsIngested?: number }> {
  console.log('[DATA_SYNC] Starting full pipeline...');

  const season = options.date
    ? parseInt(options.date.split('-')[0])
    : new Date().getFullYear();

  // Step 1: Ingestion (Season Stats)
  console.log('[DATA_SYNC] Step 1: Ingesting season stats...');
  const ingestionResult = await runDailyIngestion({
    season,
    gameType: 'R',
    dryRun: false,
  });

  if (!ingestionResult.success) {
    console.error('[DATA_SYNC] Ingestion failed:', ingestionResult.errors);
    return {
      synced: false,
      count: 0,
      traceId: ingestionResult.traceId,
      scoresComputed: 0,
    };
  }

  // Step 1b: Ingest Game Logs for all players with season stats
  console.log('[DATA_SYNC] Step 1b: Ingesting game logs...');
  let gameLogsIngested = 0;
  try {
    // Get players that were just ingested
    const players = await prisma.playerDailyStats.findMany({
      where: { 
        season,
        rawDataSource: 'mlb_stats_api',
      },
      distinct: ['playerMlbamId'],
      select: {
        playerId: true,
        playerMlbamId: true,
      },
      take: 1000, // Limit to avoid overwhelming the API
    });

    if (players.length > 0) {
      const gameLogResult = await ingestGameLogsForPlayers(
        players.map(p => ({ playerId: p.playerId, mlbamId: p.playerMlbamId })),
        season,
        ingestionResult.traceId
      );
      gameLogsIngested = gameLogResult.totalGames;
      console.log(`[DATA_SYNC] Game logs ingested: ${gameLogsIngested} games for ${gameLogResult.totalPlayers} players`);
      
      if (gameLogResult.errors.length > 0) {
        console.warn('[DATA_SYNC] Game log errors:', gameLogResult.errors.slice(0, 5));
      }
    }
  } catch (error) {
    console.error('[DATA_SYNC] Game log ingestion failed:', error);
    // Continue - season stats are still valuable
  }

  // Step 2: Derived Features
  console.log('[DATA_SYNC] Step 2: Computing derived features...');
  const derivedResult = await computeAllDerivedFeatures({
    season,
    dryRun: false,
  });

  if (!derivedResult.success) {
    console.error('[DATA_SYNC] Derived features failed:', derivedResult.errors);
    // Continue anyway - we have ingestion data
  }

  // Step 3: Scoring
  console.log('[DATA_SYNC] Step 3: Computing player scores...');
  const scoringResult = await batchScorePlayers({
    season,
    dryRun: false,
  });

  if (!scoringResult.success) {
    console.error('[DATA_SYNC] Scoring failed:', scoringResult.errors);
  }

  console.log('[DATA_SYNC] Pipeline complete:', {
    ingested: ingestionResult.stats.normalizedCreated,
    gameLogs: gameLogsIngested,
    derived: derivedResult.playersComputed,
    scored: scoringResult.playersScored,
  });

  return {
    synced: true,
    count: ingestionResult.stats.normalizedCreated,
    traceId: ingestionResult.traceId,
    scoresComputed: scoringResult.playersScored,
    gameLogsIngested,
  };
}

async function syncSchedule(options: DataSyncOptions): Promise<{ synced: boolean; count: number; traceId: string; scoresComputed: number }> {
  console.log('[DATA_SYNC] Schedule sync not implemented');
  return { synced: false, count: 0, traceId: 'not-implemented', scoresComputed: 0 };
}

async function syncWeather(options: DataSyncOptions): Promise<{ synced: boolean; count: number; traceId: string; scoresComputed: number }> {
  console.log('[DATA_SYNC] Weather sync not implemented');
  return { synced: false, count: 0, traceId: 'not-implemented', scoresComputed: 0 };
}

async function syncScores(options: DataSyncOptions): Promise<{ synced: boolean; count: number; traceId: string; scoresComputed: number }> {
  console.log('[DATA_SYNC] Scores sync not implemented');
  return { synced: false, count: 0, traceId: 'not-implemented', scoresComputed: 0 };
}
