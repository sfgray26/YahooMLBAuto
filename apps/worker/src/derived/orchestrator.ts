/**
 * Derived Features Orchestrator
 *
 * Computes and stores derived features for all players.
 * Deterministic, idempotent, reproducible.
 */

import { prisma } from '@cbb/infrastructure';
import { v4 as uuidv4 } from 'uuid';
import {
  batchComputeDerivedStatsFromGameLogs,
  computeDerivedStatsFromGameLogs,
} from './fromGameLogs.js';

interface ComputeAllFeaturesInput {
  season: number;
  dryRun?: boolean;
}

interface ComputeAllFeaturesResult {
  success: boolean;
  traceId: string;
  playersComputed: number;
  errors: string[];
  durationMs: number;
}

/**
 * Compute derived features for all players in a season.
 */
export async function computeAllDerivedFeatures(
  input: ComputeAllFeaturesInput
): Promise<ComputeAllFeaturesResult> {
  const startTime = Date.now();
  const traceId = uuidv4();
  const { season, dryRun = false } = input;

  console.log(`[DERIVED] Starting feature computation for season ${season}`, {
    traceId,
    dryRun,
  });

  try {
    // The normalized daily stats table stores season-cumulative snapshots,
    // which cannot be summed into 7/14/30-day windows without inflating counts.
    // Use the per-game source of truth instead.
    const players = await prisma.playerGameLog.groupBy({
      by: ['playerMlbamId'],
      where: { season },
    });

    console.log(`[DERIVED] Found ${players.length} unique players`);

    if (players.length === 0) {
      return {
        success: false,
        traceId,
        playersComputed: 0,
        errors: ['No players found with game logs'],
        durationMs: Date.now() - startTime,
      };
    }

    const result = dryRun
      ? await simulateDerivedStatsFromGameLogs(season)
      : await batchComputeDerivedStatsFromGameLogs(season, undefined, traceId);

    const durationMs = Date.now() - startTime;

    console.log(`[DERIVED] Complete: ${result.processed} players in ${durationMs}ms`, {
      errors: result.errors.length,
    });

    return {
      success: result.errors.length === 0,
      traceId,
      playersComputed: result.processed,
      errors: result.errors,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error(`[DERIVED] Fatal error: ${errorMsg}`);

    return {
      success: false,
      traceId,
      playersComputed: 0,
      errors: [errorMsg],
      durationMs,
    };
  }
}

/**
 * Compute features for a single player.
 */
export async function computePlayerDerivedFeatures(
  playerMlbamId: string,
  season: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const latestGameLog = await prisma.playerGameLog.findFirst({
      where: { playerMlbamId, season },
      orderBy: { gameDate: 'desc' },
      select: { playerId: true },
    });

    if (!latestGameLog) {
      return { success: false, error: 'Player not found' };
    }

    const result = await computeDerivedStatsFromGameLogs(
      latestGameLog.playerId,
      playerMlbamId,
      season
    );

    if (!result) {
      return { success: false, error: 'No recent game logs found for player' };
    }

    const computedDate = new Date();
    computedDate.setHours(0, 0, 0, 0);

    await prisma.playerDerivedStats.upsert({
      where: {
        playerMlbamId_season_computedDate: {
          playerMlbamId,
          season,
          computedDate,
        },
      },
      create: {
        playerId: latestGameLog.playerId,
        playerMlbamId,
        season,
        computedDate,
        gamesLast7: result.gamesLast7,
        gamesLast14: result.gamesLast14,
        gamesLast30: result.gamesLast30,
        plateAppearancesLast7: Math.round(result.plateAppearancesLast7),
        plateAppearancesLast14: Math.round(result.plateAppearancesLast14),
        plateAppearancesLast30: Math.round(result.plateAppearancesLast30),
        atBatsLast30: Math.round(result.atBatsLast30),
        battingAverageLast30: result.battingAverageLast30,
        onBasePctLast30: result.onBasePctLast30,
        sluggingPctLast30: result.sluggingPctLast30,
        opsLast30: result.opsLast30,
        isoLast30: result.isoLast30,
        walkRateLast30: result.walkRateLast30,
        strikeoutRateLast30: result.strikeoutRateLast30,
        babipLast30: result.babipLast30,
        battingAverageReliable: result.battingAverageReliable,
        obpReliable: result.obpReliable,
        slgReliable: result.slgReliable,
        opsReliable: result.opsReliable,
        gamesToReliable: result.gamesToReliable,
        hitConsistencyScore: result.hitConsistencyScore,
        productionVolatility: result.productionVolatility,
        zeroHitGamesLast14: result.zeroHitGamesLast14,
        multiHitGamesLast14: result.multiHitGamesLast14,
        gamesStartedLast14: result.gamesStartedLast14,
        lineupSpot: result.lineupSpot,
        platoonRisk: result.platoonRisk,
        playingTimeTrend: result.playingTimeTrend,
        positionEligibility: result.positionEligibility,
        waiverWireValue: result.waiverWireValue,
        rosteredPercent: result.rosteredPercent,
        traceId: uuidv4(),
      },
      update: {
        computedAt: new Date(),
        gamesLast7: result.gamesLast7,
        gamesLast14: result.gamesLast14,
        gamesLast30: result.gamesLast30,
        plateAppearancesLast7: Math.round(result.plateAppearancesLast7),
        plateAppearancesLast14: Math.round(result.plateAppearancesLast14),
        plateAppearancesLast30: Math.round(result.plateAppearancesLast30),
        atBatsLast30: Math.round(result.atBatsLast30),
        battingAverageLast30: result.battingAverageLast30,
        onBasePctLast30: result.onBasePctLast30,
        sluggingPctLast30: result.sluggingPctLast30,
        opsLast30: result.opsLast30,
        isoLast30: result.isoLast30,
        walkRateLast30: result.walkRateLast30,
        strikeoutRateLast30: result.strikeoutRateLast30,
        babipLast30: result.babipLast30,
        battingAverageReliable: result.battingAverageReliable,
        obpReliable: result.obpReliable,
        slgReliable: result.slgReliable,
        opsReliable: result.opsReliable,
        gamesToReliable: result.gamesToReliable,
        hitConsistencyScore: result.hitConsistencyScore,
        productionVolatility: result.productionVolatility,
        zeroHitGamesLast14: result.zeroHitGamesLast14,
        multiHitGamesLast14: result.multiHitGamesLast14,
        gamesStartedLast14: result.gamesStartedLast14,
        lineupSpot: result.lineupSpot,
        platoonRisk: result.platoonRisk,
        playingTimeTrend: result.playingTimeTrend,
        positionEligibility: result.positionEligibility,
        waiverWireValue: result.waiverWireValue,
        rosteredPercent: result.rosteredPercent,
        traceId: uuidv4(),
      },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function simulateDerivedStatsFromGameLogs(
  season: number
): Promise<{ processed: number; errors: string[] }> {
  const players = await prisma.playerGameLog.groupBy({
    by: ['playerId', 'playerMlbamId'],
    where: { season },
  });

  const errors: string[] = [];
  let processed = 0;

  for (const { playerId, playerMlbamId } of players) {
    try {
      const result = await computeDerivedStatsFromGameLogs(
        playerId,
        playerMlbamId,
        season
      );

      if (result) {
        processed++;
      }
    } catch (error) {
      errors.push(
        `Player ${playerMlbamId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return { processed, errors };
}
