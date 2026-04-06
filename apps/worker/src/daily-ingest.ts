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
import { classifyPlayerRole } from './verification/playerIdentity.js';
import { ingestPitcherGameLogsForPlayers } from './pitchers/gameLogs.js';
import { batchComputePitcherDerivedStatsFromGameLogs } from './pitchers/fromGameLogs.js';

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

    const hitterPlayers = verifiedPlayers.filter((player: { position: string | null }) => classifyPlayerRole(player.position) === 'hitter');
    const pitcherPlayers = verifiedPlayers.filter((player: { position: string | null }) => classifyPlayerRole(player.position) === 'pitcher');
    const unsupportedCount = verifiedPlayers.filter((player: { position: string | null }) => {
      const role = classifyPlayerRole(player.position);
      return role === 'two_way' || role === 'unknown';
    }).length;

    const hitterIds = hitterPlayers.map((p: { mlbamId: string }) => p.mlbamId);
    const pitcherIds = pitcherPlayers.map((p: { mlbamId: string }) => p.mlbamId);
    logger.info('Prepared verified players for ingestion', {
      totalVerifiedPlayers: verifiedPlayers.length,
      hitterPlayers: hitterIds.length,
      pitcherPlayers: pitcherIds.length,
      unsupportedSkipped: unsupportedCount,
    });

    if (hitterIds.length === 0 && pitcherIds.length === 0) {
      logger.info('No supported verified players found, skipping ingestion');
      return;
    }

    let hitterIngestResult: IngestResult = { totalPlayers: 0, totalGames: 0, errors: [] };
    if (hitterIds.length > 0) {
      logger.info('Step 1a: Ingesting hitter game logs...');
      hitterIngestResult = await runIngestion(hitterIds, season);
    }

    let pitcherIngestResult: IngestResult = { totalPlayers: 0, totalGames: 0, errors: [] };
    if (pitcherIds.length > 0) {
      logger.info('Step 1b: Ingesting pitcher game logs...');
      const pitcherPlayersForIngest = pitcherIds.map((mlbamId) => ({
        playerId: `mlbam:${mlbamId}`,
        mlbamId,
      }));
      const pitcherResult = await ingestPitcherGameLogsForPlayers(pitcherPlayersForIngest, season);
      pitcherIngestResult = {
        totalPlayers: pitcherResult.totalPlayers,
        totalGames: pitcherResult.totalGames,
        errors: pitcherResult.errors,
      };
    }

    // Step 2: Compute derived stats
    logger.info('Step 2a: Computing hitter derived stats...');
    const traceId = `daily-${Date.now()}`;
    const derivedResult = await batchComputeDerivedStatsFromGameLogs(season, undefined, traceId);
    logger.info('Step 2b: Computing pitcher derived stats...');
    const pitcherDerivedResult = await batchComputePitcherDerivedStatsFromGameLogs(season, undefined, traceId);

    const totalDurationMs = Date.now() - startTime;

    logger.info('=== DAILY INGESTION COMPLETE ===', {
      season,
      hitterPlayersProcessed: hitterIngestResult.totalPlayers,
      pitcherPlayersProcessed: pitcherIngestResult.totalPlayers,
      hitterGamesIngested: hitterIngestResult.totalGames,
      pitcherGamesIngested: pitcherIngestResult.totalGames,
      derivedStatsComputed: derivedResult.processed,
      pitcherDerivedStatsComputed: pitcherDerivedResult.processed,
      durationMs: totalDurationMs,
      errors: hitterIngestResult.errors.length + pitcherIngestResult.errors.length + derivedResult.errors.length + pitcherDerivedResult.errors.length
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
