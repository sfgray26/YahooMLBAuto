#!/usr/bin/env node
/**
 * Daily Ingestion Job
 * 
 * Runs daily to:
 * 1. Fetch latest game logs from balldontlie for all verified players
 * 2. Compute derived stats (7/14/30 day windows)
 * 
 * Designed to run as a cron job in Railway.
 */

import { prisma } from '@cbb/infrastructure';
import { ingestGameLogsForPlayers } from './ingestion/gameLogs.js';
import { batchComputeDerivedStatsFromGameLogs } from './derived/fromGameLogs.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[DAILY-INGEST] ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[DAILY-INGEST ERROR] ${msg}`, meta ? JSON.stringify(meta) : ''),
};

interface IngestResult {
  totalPlayers: number;
  totalGames: number;
  errors: string[];
}

async function runIngestion(
  playerIds: string[],
  season: number
): Promise<IngestResult> {
  logger.info(`Starting ingestion for ${playerIds.length} players, season ${season}`);
  
  const players = playerIds.map((mlbamId) => ({
    playerId: `mlbam:${mlbamId}`,
    mlbamId,
  }));
  
  const result = await ingestGameLogsForPlayers(players, season, `daily-${Date.now()}`);
  
  logger.info(`Ingestion complete`, { 
    totalPlayers: result.totalPlayers, 
    totalGames: result.totalGames, 
    errors: result.errors.length 
  });

  return result;
}

async function runDailyIngestion() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    logger.error('BALLDONTLIE_API_KEY not set');
    process.exit(1);
  }

  const season = Number(process.env.MLB_SEASON ?? new Date().getUTCFullYear());
  const startTime = Date.now();

  logger.info('=== DAILY INGESTION START ===', { season, timestamp: new Date().toISOString() });

  try {
    // Get verified players
    const verifiedPlayers = await prisma.verifiedPlayer.findMany({
      where: { isActive: true }
    });

    const playerIds = verifiedPlayers.map((p: { mlbamId: string }) => p.mlbamId);
    logger.info(`Found ${playerIds.length} verified players`);

    if (playerIds.length === 0) {
      logger.info('No verified players found, skipping ingestion');
      return;
    }

    // Step 1: Ingest game logs
    logger.info('Step 1: Ingesting game logs...');
    const ingestResult = await runIngestion(playerIds, season);

    // Step 2: Compute derived stats
    logger.info('Step 2: Computing derived stats...');
    const traceId = `daily-${Date.now()}`;
    const derivedResult = await batchComputeDerivedStatsFromGameLogs(season, undefined, traceId);

    const totalDurationMs = Date.now() - startTime;

    logger.info('=== DAILY INGESTION COMPLETE ===', {
      season,
      playersProcessed: ingestResult.totalPlayers,
      gamesIngested: ingestResult.totalGames,
      derivedStatsComputed: derivedResult.processed,
      durationMs: totalDurationMs,
      errors: ingestResult.errors.length
    });

    process.exit(0);
  } catch (error) {
    logger.error('Daily ingestion failed', { error: error instanceof Error ? error.message : 'Unknown' });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runDailyIngestion();
