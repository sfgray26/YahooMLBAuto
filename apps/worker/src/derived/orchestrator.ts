/**
 * Derived Features Orchestrator
 *
 * Computes and stores derived features for all players.
 * Deterministic, idempotent, reproducible.
 */

import { prisma } from '@cbb/infrastructure';
import { v4 as uuidv4 } from 'uuid';
import { computeDerivedFeatures } from './compute.js';
import { storeDerivedFeatures } from './storage.js';

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
  const errors: string[] = [];

  const { season, dryRun = false } = input;

  console.log(`[DERIVED] Starting feature computation for season ${season}`, {
    traceId,
    dryRun,
  });

  try {
    // Get all unique players with raw stats for this season
    const players = await prisma.playerDailyStats.findMany({
      where: { season },
      select: {
        playerId: true,
        playerMlbamId: true,
      },
      distinct: ['playerMlbamId'],
    });

    console.log(`[DERIVED] Found ${players.length} unique players`);

    if (players.length === 0) {
      return {
        success: false,
        traceId,
        playersComputed: 0,
        errors: ['No players found with raw stats'],
        durationMs: Date.now() - startTime,
      };
    }

    let playersComputed = 0;

    // Compute features for each player
    for (const player of players) {
      try {
        // Get all raw stats for this player
        const rawStats = await prisma.playerDailyStats.findMany({
          where: {
            playerMlbamId: player.playerMlbamId,
            season,
          },
          orderBy: { statDate: 'desc' },
        });

        if (rawStats.length === 0) continue;

        // Compute derived features
        const features = computeDerivedFeatures(
          player.playerId,
          player.playerMlbamId,
          season,
          rawStats.map((s: { statDate: Date; gamesPlayed: number; atBats: number; hits: number; doubles: number; triples: number; homeRuns: number; walks: number; strikeouts: number; battingAvg: string | null; onBasePct: string | null; sluggingPct: string | null }) => ({
            statDate: s.statDate,
            gamesPlayed: s.gamesPlayed,
            atBats: s.atBats,
            plateAppearances: undefined, // Not stored separately
            hits: s.hits,
            doubles: s.doubles,
            triples: s.triples,
            homeRuns: s.homeRuns,
            walks: s.walks,
            strikeouts: s.strikeouts,
            battingAvg: s.battingAvg || undefined,
            onBasePct: s.onBasePct || undefined,
            sluggingPct: s.sluggingPct || undefined,
          }))
        );

        // Store features (unless dry run)
        if (!dryRun) {
          await storeDerivedFeatures({ features, traceId });
        }

        playersComputed++;

        // Log progress every 100 players
        if (playersComputed % 100 === 0) {
          console.log(`[DERIVED] Computed ${playersComputed}/${players.length} players`);
        }
      } catch (error) {
        const errorMsg = `Failed to compute features for ${player.playerMlbamId}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[DERIVED] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    const durationMs = Date.now() - startTime;

    console.log(`[DERIVED] Complete: ${playersComputed} players in ${durationMs}ms`, {
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      traceId,
      playersComputed,
      errors,
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
    const player = await prisma.playerDailyStats.findFirst({
      where: { playerMlbamId, season },
      select: { playerId: true },
    });

    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    const rawStats = await prisma.playerDailyStats.findMany({
      where: { playerMlbamId, season },
      orderBy: { statDate: 'desc' },
    });

    const features = computeDerivedFeatures(
      player.playerId,
      playerMlbamId,
      season,
      rawStats.map((s: { statDate: Date; gamesPlayed: number; atBats: number; hits: number; doubles: number; triples: number; homeRuns: number; walks: number; strikeouts: number; battingAvg: string | null; onBasePct: string | null; sluggingPct: string | null }) => ({
        statDate: s.statDate,
        gamesPlayed: s.gamesPlayed,
        atBats: s.atBats,
        plateAppearances: undefined,
        hits: s.hits,
        doubles: s.doubles,
        triples: s.triples,
        homeRuns: s.homeRuns,
        walks: s.walks,
        strikeouts: s.strikeouts,
        battingAvg: s.battingAvg || undefined,
        onBasePct: s.onBasePct || undefined,
        sluggingPct: s.sluggingPct || undefined,
      }))
    );

    await storeDerivedFeatures({
      features,
      traceId: uuidv4(),
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
