/**
 * Player Scoring Orchestrator
 *
 * Batch scores all players after derived features are computed.
 * Stateless, deterministic, no persistence.
 */

import { prisma } from '@cbb/infrastructure';
import { v4 as uuidv4 } from 'uuid';
import { scorePlayer, type PlayerScore } from './compute.js';
import type { DerivedFeatures } from '../derived/index.js';

interface BatchScoreInput {
  season: number;
  dryRun?: boolean;
}

interface BatchScoreResult {
  success: boolean;
  traceId: string;
  playersScored: number;
  scores: PlayerScore[];
  errors: string[];
  durationMs: number;
}

/**
 * Batch score all players for a season.
 * Runs after derived features are computed.
 */
export async function batchScorePlayers(
  input: BatchScoreInput
): Promise<BatchScoreResult> {
  const startTime = Date.now();
  const traceId = uuidv4();
  const errors: string[] = [];

  const { season, dryRun = false } = input;

  console.log(`[SCORING] Starting batch scoring for season ${season}`, {
    traceId,
    dryRun,
  });

  try {
    // Get all derived features for this season
    const derivedRecords = await prisma.playerDerivedStats.findMany({
      where: { season },
      distinct: ['playerMlbamId'],
      orderBy: { computedAt: 'desc' },
    });

    console.log(`[SCORING] Found ${derivedRecords.length} players with derived features`);

    if (derivedRecords.length === 0) {
      return {
        success: false,
        traceId,
        playersScored: 0,
        scores: [],
        errors: ['No derived features found. Run derived feature computation first.'],
        durationMs: Date.now() - startTime,
      };
    }

    // Convert to DerivedFeatures format
    const featuresList: DerivedFeatures[] = derivedRecords.map((record: { playerId: string; playerMlbamId: string; season: number; computedAt: Date; gamesLast7: number; gamesLast14: number; gamesLast30: number; plateAppearancesLast7: number; plateAppearancesLast14: number; plateAppearancesLast30: number; atBatsLast30: number; battingAverageLast30: number | null; onBasePctLast30: number | null; sluggingPctLast30: number | null; opsLast30: number | null; isoLast30: number | null; walkRateLast30: number | null; strikeoutRateLast30: number | null; babipLast30: number | null; battingAverageReliable: boolean; obpReliable: boolean; slgReliable: boolean; opsReliable: boolean; gamesToReliable: number; hitConsistencyScore: number; productionVolatility: number; zeroHitGamesLast14: number; multiHitGamesLast14: number; gamesStartedLast14: number; lineupSpot: number | null; platoonRisk: string | null; playingTimeTrend: string | null; positionEligibility: string[]; waiverWireValue: number | null; rosteredPercent: number | null }) => ({
      playerId: record.playerId,
      playerMlbamId: record.playerMlbamId,
      season: record.season,
      computedAt: record.computedAt,

      volume: {
        gamesLast7: record.gamesLast7,
        gamesLast14: record.gamesLast14,
        gamesLast30: record.gamesLast30,
        plateAppearancesLast7: record.plateAppearancesLast7,
        plateAppearancesLast14: record.plateAppearancesLast14,
        plateAppearancesLast30: record.plateAppearancesLast30,
        atBatsLast30: record.atBatsLast30,
      },

      rates: {
        battingAverageLast30: record.battingAverageLast30,
        onBasePctLast30: record.onBasePctLast30,
        sluggingPctLast30: record.sluggingPctLast30,
        opsLast30: record.opsLast30,
        isoLast30: record.isoLast30,
        walkRateLast30: record.walkRateLast30,
        strikeoutRateLast30: record.strikeoutRateLast30,
        babipLast30: record.babipLast30,
      },

      stabilization: {
        battingAverageReliable: record.battingAverageReliable,
        obpReliable: record.obpReliable,
        slgReliable: record.slgReliable,
        opsReliable: record.opsReliable,
        gamesToReliable: record.gamesToReliable,
      },

      volatility: {
        hitConsistencyScore: record.hitConsistencyScore,
        productionVolatility: record.productionVolatility,
        zeroHitGamesLast14: record.zeroHitGamesLast14,
        multiHitGamesLast14: record.multiHitGamesLast14,
      },

      opportunity: {
        gamesStartedLast14: record.gamesStartedLast14,
        lineupSpot: record.lineupSpot,
        platoonRisk: record.platoonRisk as 'low' | 'medium' | 'high' | null,
        playingTimeTrend: record.playingTimeTrend as 'up' | 'stable' | 'down' | null,
      },

      replacement: {
        positionEligibility: record.positionEligibility,
        waiverWireValue: record.waiverWireValue,
        rosteredPercent: record.rosteredPercent,
      },
    }));

    // Score all players, but keep unsupported records from aborting the batch.
    console.log(`[SCORING] Computing scores for ${featuresList.length} players...`);

    const scores: PlayerScore[] = [];
    for (const features of featuresList) {
      try {
        scores.push(scorePlayer(features));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${features.playerMlbamId}: ${message}`);
      }
    }

    if (scores.length === 0) {
      return {
        success: false,
        traceId,
        playersScored: 0,
        scores: [],
        errors: errors.length > 0 ? errors : ['No supported hitters available for scoring.'],
        durationMs: Date.now() - startTime,
      };
    }

    // Log summary statistics
    const avgScore = scores.reduce((sum, s) => sum + s.overallValue, 0) / scores.length;
    const elitePlayers = scores.filter((s) => s.overallValue >= 70).length;
    const poorPlayers = scores.filter((s) => s.overallValue < 40).length;

    console.log(`[SCORING] Summary:`, {
      total: scores.length,
      average: avgScore.toFixed(1),
      elite: elitePlayers,
      poor: poorPlayers,
    });

    const durationMs = Date.now() - startTime;

    console.log(`[SCORING] Complete: ${scores.length} players scored in ${durationMs}ms`, {
      skipped: errors.length,
    });

    return {
      success: true,
      traceId,
      playersScored: scores.length,
      scores,
      errors,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error(`[SCORING] Fatal error: ${errorMsg}`);

    return {
      success: false,
      traceId,
      playersScored: 0,
      scores: [],
      errors: [errorMsg],
      durationMs,
    };
  }
}

/**
 * Score a single player on-demand.
 */
export async function scoreSinglePlayer(
  playerMlbamId: string,
  season: number,
  fallbackPositionEligibility?: string[]
): Promise<PlayerScore | null> {
  const record = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' },
  });

  if (!record) return null;

  const features: DerivedFeatures = {
    playerId: record.playerId,
    playerMlbamId: record.playerMlbamId,
    season: record.season,
    computedAt: record.computedAt,

    volume: {
      gamesLast7: record.gamesLast7,
      gamesLast14: record.gamesLast14,
      gamesLast30: record.gamesLast30,
      plateAppearancesLast7: record.plateAppearancesLast7,
      plateAppearancesLast14: record.plateAppearancesLast14,
      plateAppearancesLast30: record.plateAppearancesLast30,
      atBatsLast30: record.atBatsLast30,
    },

    rates: {
      battingAverageLast30: record.battingAverageLast30,
      onBasePctLast30: record.onBasePctLast30,
      sluggingPctLast30: record.sluggingPctLast30,
      opsLast30: record.opsLast30,
      isoLast30: record.isoLast30,
      walkRateLast30: record.walkRateLast30,
      strikeoutRateLast30: record.strikeoutRateLast30,
      babipLast30: record.babipLast30,
    },

    stabilization: {
      battingAverageReliable: record.battingAverageReliable,
      obpReliable: record.obpReliable,
      slgReliable: record.slgReliable,
      opsReliable: record.opsReliable,
      gamesToReliable: record.gamesToReliable,
    },

    volatility: {
      hitConsistencyScore: record.hitConsistencyScore,
      productionVolatility: record.productionVolatility,
      zeroHitGamesLast14: record.zeroHitGamesLast14,
      multiHitGamesLast14: record.multiHitGamesLast14,
    },

    opportunity: {
      gamesStartedLast14: record.gamesStartedLast14,
      lineupSpot: record.lineupSpot,
      platoonRisk: record.platoonRisk as 'low' | 'medium' | 'high' | null,
      playingTimeTrend: record.playingTimeTrend as 'up' | 'stable' | 'down' | null,
    },

    replacement: {
      positionEligibility: resolvePositionEligibility(record.positionEligibility, fallbackPositionEligibility),
      waiverWireValue: record.waiverWireValue,
      rosteredPercent: record.rosteredPercent,
    },
  };

  return scorePlayer(features);
}

export function resolvePositionEligibility(
  storedPositionEligibility: string[],
  fallbackPositionEligibility?: string[]
): string[] {
  const normalize = (positions: string[] | undefined): string[] =>
    (positions ?? [])
      .map((position) => position.trim().toUpperCase())
      .filter(Boolean);

  const persisted = normalize(storedPositionEligibility);
  if (persisted.length > 0) {
    return persisted;
  }

  return normalize(fallbackPositionEligibility);
}
