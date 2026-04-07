#!/usr/bin/env node
/**
 * Daily Ingestion Job
 *
 * Runs daily to:
 * 1. Fetch latest hitter and pitcher game logs for all verified players
 * 2. Compute derived stats
 * 3. Validate the pipeline results automatically
 *
 * Designed to run as a cron job in Railway or be invoked via the API admin route.
 */

import { pathToFileURL } from 'node:url';

import { prisma } from '@cbb/infrastructure';

import { batchComputeDerivedStatsFromGameLogs } from './derived/fromGameLogs.js';
import { ingestGameLogsForPlayers } from './ingestion/gameLogs.js';
import { batchComputePitcherDerivedStatsFromGameLogs } from './pitchers/fromGameLogs.js';
import { ingestPitcherGameLogsForPlayers } from './pitchers/gameLogs.js';
import { type DerivedRateSample, type PitcherDerivedRateSample, validatePipelineRun } from './validation/pipeline.js';
import { classifyPlayerRole } from './verification/playerIdentity.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[DAILY-INGEST] ${msg}`, meta ? JSON.stringify(meta) : ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[DAILY-INGEST ERROR] ${msg}`, meta ? JSON.stringify(meta) : ''),
};

interface IngestResult {
  totalPlayers: number;
  totalGames: number;
  errors: string[];
}

export interface DailyIngestionRunResult {
  success: boolean;
  season: number;
  hitterPlayersProcessed: number;
  pitcherPlayersProcessed: number;
  hitterGamesIngested: number;
  pitcherGamesIngested: number;
  derivedStatsComputed: number;
  pitcherDerivedStatsComputed: number;
  unsupportedPlayersSkipped: number;
  validation: ReturnType<typeof validatePipelineRun>;
  durationMs: number;
  errors: string[];
}

async function runHitterIngestion(playerIds: string[], season: number): Promise<IngestResult> {
  logger.info(`Starting hitter ingestion for ${playerIds.length} players`, { season });

  const players = playerIds.map((mlbamId) => ({
    playerId: `mlbam:${mlbamId}`,
    mlbamId,
  }));

  return ingestGameLogsForPlayers(players, season, `daily-${Date.now()}`);
}

async function loadDerivedSamples(season: number): Promise<DerivedRateSample[]> {
  const rawSamples = await prisma.playerDerivedStats.findMany({
    where: { season },
    orderBy: { computedAt: 'desc' },
    take: 50,
    select: {
      playerMlbamId: true,
      battingAverageLast30: true,
      onBasePctLast30: true,
      sluggingPctLast30: true,
      opsLast30: true,
      isoLast30: true,
      walkRateLast30: true,
      strikeoutRateLast30: true,
      gamesLast7: true,
      gamesLast14: true,
      gamesLast30: true,
      plateAppearancesLast7: true,
      plateAppearancesLast14: true,
      plateAppearancesLast30: true,
    },
  });

  return rawSamples as DerivedRateSample[];
}

async function loadPitcherDerivedSamples(season: number): Promise<PitcherDerivedRateSample[]> {
  const rawSamples = await prisma.pitcherDerivedStats.findMany({
    where: { season },
    orderBy: { computedAt: 'desc' },
    take: 50,
    select: {
      playerMlbamId: true,
      eraLast30: true,
      whipLast30: true,
      strikeoutRateLast30: true,
      walkRateLast30: true,
      kToBBRatioLast30: true,
      appearancesLast7: true,
      appearancesLast14: true,
      appearancesLast30: true,
      inningsPitchedLast7: true,
      inningsPitchedLast14: true,
      inningsPitchedLast30: true,
      battersFacedLast7: true,
      battersFacedLast14: true,
      battersFacedLast30: true,
    },
  });

  return rawSamples as PitcherDerivedRateSample[];
}

export async function runVerifiedPlayersDailyIngestion(
  season: number = Number(process.env.MLB_SEASON ?? new Date().getUTCFullYear())
): Promise<DailyIngestionRunResult> {
  const startTime = Date.now();
  logger.info('=== DAILY INGESTION START ===', { season, timestamp: new Date().toISOString() });

  const errors: string[] = [];

  const verifiedPlayers = await prisma.verifiedPlayer.findMany({
    where: { isActive: true },
  });

  const hitterPlayers = verifiedPlayers.filter(
    (player: { position: string | null }) => classifyPlayerRole(player.position) === 'hitter'
  );
  const pitcherPlayers = verifiedPlayers.filter(
    (player: { position: string | null }) => classifyPlayerRole(player.position) === 'pitcher'
  );
  const unsupportedPlayersSkipped = verifiedPlayers.filter((player: { position: string | null }) => {
    const role = classifyPlayerRole(player.position);
    return role === 'two_way' || role === 'unknown';
  }).length;

  const hitterIds = hitterPlayers.map((player: { mlbamId: string }) => player.mlbamId);
  const pitcherIds = pitcherPlayers.map((player: { mlbamId: string }) => player.mlbamId);

  logger.info('Prepared verified players for ingestion', {
    totalVerifiedPlayers: verifiedPlayers.length,
    hitterPlayers: hitterIds.length,
    pitcherPlayers: pitcherIds.length,
    unsupportedSkipped: unsupportedPlayersSkipped,
  });

  let hitterIngestResult: IngestResult = { totalPlayers: 0, totalGames: 0, errors: [] };
  if (hitterIds.length > 0) {
    logger.info('Step 1a: Ingesting hitter game logs...');
    hitterIngestResult = await runHitterIngestion(hitterIds, season);
    errors.push(...hitterIngestResult.errors);
  }

  let pitcherIngestResult: IngestResult = { totalPlayers: 0, totalGames: 0, errors: [] };
  if (pitcherIds.length > 0) {
    logger.info('Step 1b: Ingesting pitcher game logs...');
    const players = pitcherIds.map((mlbamId) => ({
      playerId: `mlbam:${mlbamId}`,
      mlbamId,
    }));
    const result = await ingestPitcherGameLogsForPlayers(players, season);
    pitcherIngestResult = {
      totalPlayers: result.totalPlayers,
      totalGames: result.totalGames,
      errors: result.errors,
    };
    errors.push(...pitcherIngestResult.errors);
  }

  const traceId = `daily-${Date.now()}`;
  logger.info('Step 2a: Computing hitter derived stats...');
  const hitterDerived = await batchComputeDerivedStatsFromGameLogs(season, undefined, traceId);
  logger.info('Step 2b: Computing pitcher derived stats...');
  const pitcherDerived = await batchComputePitcherDerivedStatsFromGameLogs(season, undefined, traceId);
  errors.push(...hitterDerived.errors, ...pitcherDerived.errors);

  logger.info('Step 3: Validating pipeline results...');

  let derivedSamples: DerivedRateSample[] = [];
  try {
    derivedSamples = await loadDerivedSamples(season);
  } catch (error) {
    logger.error('Could not fetch derived stats samples for validation', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  let pitcherDerivedSamples: PitcherDerivedRateSample[] = [];
  try {
    pitcherDerivedSamples = await loadPitcherDerivedSamples(season);
  } catch (error) {
    logger.error('Could not fetch pitcher derived stats samples for validation', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  const validation = validatePipelineRun({
    hitterIngestion: hitterIngestResult,
    pitcherIngestion: pitcherIngestResult,
    hitterDerived,
    pitcherDerived,
    derivedSamples,
    pitcherDerivedSamples,
  });

  logger.info('Pipeline validation complete', {
    valid: validation.valid,
    summary: validation.summary,
  });

  for (const stage of validation.stages) {
    if (!stage.valid) {
      logger.error(`Validation stage FAILED: ${stage.stage}`, {
        errors: stage.errors,
        warnings: stage.warnings,
      });
    } else if (stage.warnings.length > 0) {
      logger.info(`Validation stage passed with warnings: ${stage.stage}`, {
        warnings: stage.warnings,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const success = validation.valid && errors.length === 0;

  logger.info('=== DAILY INGESTION COMPLETE ===', {
    season,
    hitterPlayersProcessed: hitterIngestResult.totalPlayers,
    pitcherPlayersProcessed: pitcherIngestResult.totalPlayers,
    hitterGamesIngested: hitterIngestResult.totalGames,
    pitcherGamesIngested: pitcherIngestResult.totalGames,
    derivedStatsComputed: hitterDerived.processed,
    pitcherDerivedStatsComputed: pitcherDerived.processed,
    pipelineValid: validation.valid,
    validationSummary: validation.summary,
    unsupportedPlayersSkipped,
    durationMs,
    errors: errors.length,
  });

  return {
    success,
    season,
    hitterPlayersProcessed: hitterIngestResult.totalPlayers,
    pitcherPlayersProcessed: pitcherIngestResult.totalPlayers,
    hitterGamesIngested: hitterIngestResult.totalGames,
    pitcherGamesIngested: pitcherIngestResult.totalGames,
    derivedStatsComputed: hitterDerived.processed,
    pitcherDerivedStatsComputed: pitcherDerived.processed,
    unsupportedPlayersSkipped,
    validation,
    durationMs,
    errors,
  };
}

async function main() {
  try {
    const result = await runVerifiedPlayersDailyIngestion();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    logger.error('Daily ingestion failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main();
}
