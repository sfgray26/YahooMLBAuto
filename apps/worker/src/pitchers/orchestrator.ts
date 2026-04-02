/**
 * Pitcher Scoring Orchestrator (Parallel to hitters/orchestrator.ts)
 *
 * Batch scores all pitchers after derived features are computed.
 * Stateless, deterministic, no persistence.
 */

import { prisma } from '@cbb/infrastructure';
import { v4 as uuidv4 } from 'uuid';
import { scorePitcher, scorePitchers, type PitcherScore } from './compute.js';
import type { PitcherDerivedFeatures } from './derived.js';

interface BatchScorePitchersInput {
  season: number;
  dryRun?: boolean;
}

interface BatchScorePitchersResult {
  success: boolean;
  traceId: string;
  pitchersScored: number;
  scores: PitcherScore[];
  errors: string[];
  durationMs: number;
}

/**
 * Batch score all pitchers for a season.
 * Runs after derived features are computed.
 */
export async function batchScorePitchers(
  input: BatchScorePitchersInput
): Promise<BatchScorePitchersResult> {
  const startTime = Date.now();
  const traceId = uuidv4();
  const errors: string[] = [];

  const { season, dryRun = false } = input;

  console.log(`[PITCHER SCORING] Starting batch scoring for season ${season}`, {
    traceId,
    dryRun,
  });

  try {
    // Get all pitcher derived features for this season
    // Note: Using a hypothetical pitcherDerivedStats table
    // In practice, this would query the actual database table
    const derivedRecords = await prisma.pitcherDerivedStats?.findMany({
      where: { season },
      distinct: ['playerMlbamId'],
      orderBy: { computedAt: 'desc' },
    }) || [];

    console.log(`[PITCHER SCORING] Found ${derivedRecords.length} pitchers with derived features`);

    if (derivedRecords.length === 0) {
      return {
        success: false,
        traceId,
        pitchersScored: 0,
        scores: [],
        errors: ['No pitcher derived features found. Run pitcher feature computation first.'],
        durationMs: Date.now() - startTime,
      };
    }

    // Convert to PitcherDerivedFeatures format
    const featuresList: PitcherDerivedFeatures[] = derivedRecords.map((record: unknown) => {
      const r = record as Record<string, unknown>;
      return {
        playerId: String(r.playerId),
        playerMlbamId: String(r.playerMlbamId),
        season: Number(r.season),
        computedAt: new Date(String(r.computedAt)),

        volume: {
          appearancesLast7: Number(r.appearancesLast7) || 0,
          appearancesLast14: Number(r.appearancesLast14) || 0,
          appearancesLast30: Number(r.appearancesLast30) || 0,
          inningsPitchedLast7: Number(r.inningsPitchedLast7) || 0,
          inningsPitchedLast14: Number(r.inningsPitchedLast14) || 0,
          inningsPitchedLast30: Number(r.inningsPitchedLast30) || 0,
          battersFacedLast7: Number(r.battersFacedLast7) || 0,
          battersFacedLast14: Number(r.battersFacedLast14) || 0,
          battersFacedLast30: Number(r.battersFacedLast30) || 0,
          gamesSavedLast30: Number(r.gamesSavedLast30) || 0,
          gamesStartedLast30: Number(r.gamesStartedLast30) || 0,
          pitchesPerInning: r.pitchesPerInning != null ? Number(r.pitchesPerInning) : null,
          daysSinceLastAppearance: r.daysSinceLastAppearance != null ? Number(r.daysSinceLastAppearance) : null,
        },

        rates: {
          eraLast30: r.eraLast30 != null ? Number(r.eraLast30) : null,
          whipLast30: r.whipLast30 != null ? Number(r.whipLast30) : null,
          fipLast30: r.fipLast30 != null ? Number(r.fipLast30) : null,
          xfipLast30: r.xfipLast30 != null ? Number(r.xfipLast30) : null,
          strikeoutRateLast30: r.strikeoutRateLast30 != null ? Number(r.strikeoutRateLast30) : null,
          walkRateLast30: r.walkRateLast30 != null ? Number(r.walkRateLast30) : null,
          kToBBRatioLast30: r.kToBBRatioLast30 != null ? Number(r.kToBBRatioLast30) : null,
          swingingStrikeRate: r.swingingStrikeRate != null ? Number(r.swingingStrikeRate) : null,
          firstPitchStrikeRate: r.firstPitchStrikeRate != null ? Number(r.firstPitchStrikeRate) : null,
          avgVelocity: r.avgVelocity != null ? Number(r.avgVelocity) : null,
          gbRatio: r.gbRatio != null ? Number(r.gbRatio) : null,
          hrPer9: r.hrPer9 != null ? Number(r.hrPer9) : null,
        },

        stabilization: {
          eraReliable: Boolean(r.eraReliable),
          whipReliable: Boolean(r.whipReliable),
          fipReliable: Boolean(r.fipReliable),
          kRateReliable: Boolean(r.kRateReliable),
          bbRateReliable: Boolean(r.bbRateReliable),
          battersToReliable: Number(r.battersToReliable) || 0,
        },

        volatility: {
          qualityStartRate: r.qualityStartRate != null ? Number(r.qualityStartRate) : null,
          blowUpRate: r.blowUpRate != null ? Number(r.blowUpRate) : null,
          eraVolatility: r.eraVolatility != null ? Number(r.eraVolatility) : null,
          consistencyScore: Number(r.consistencyScore) || 0,
        },

        context: {
          opponentOps: r.opponentOps != null ? Number(r.opponentOps) : null,
          parkFactor: r.parkFactor != null ? Number(r.parkFactor) : null,
          isHome: r.isHome != null ? Boolean(r.isHome) : null,
          isCloser: r.isCloser != null ? Boolean(r.isCloser) : null,
          scheduledStartNext7: Boolean(r.scheduledStartNext7),
          opponentNextStart: r.opponentNextStart != null ? String(r.opponentNextStart) : null,
        },
      };
    });

    // Score all pitchers
    console.log(`[PITCHER SCORING] Computing scores for ${featuresList.length} pitchers...`);

    const scores = scorePitchers(featuresList);

    // Log summary statistics
    const avgScore = scores.reduce((sum, s) => sum + s.overallValue, 0) / scores.length;
    const elitePitchers = scores.filter((s) => s.overallValue >= 70).length;
    const poorPitchers = scores.filter((s) => s.overallValue < 40).length;
    const closers = scores.filter((s) => s.role.isCloser).length;

    console.log(`[PITCHER SCORING] Summary:`, {
      total: scores.length,
      average: avgScore.toFixed(1),
      elite: elitePitchers,
      poor: poorPitchers,
      closers,
    });

    const durationMs = Date.now() - startTime;

    console.log(`[PITCHER SCORING] Complete: ${scores.length} pitchers scored in ${durationMs}ms`);

    return {
      success: true,
      traceId,
      pitchersScored: scores.length,
      scores,
      errors,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error(`[PITCHER SCORING] Fatal error: ${errorMsg}`);

    return {
      success: false,
      traceId,
      pitchersScored: 0,
      scores: [],
      errors: [errorMsg],
      durationMs,
    };
  }
}

/**
 * Score a single pitcher on-demand.
 */
export async function scoreSinglePitcher(
  playerMlbamId: string,
  season: number
): Promise<PitcherScore | null> {
  // Note: This would query the actual pitcherDerivedStats table
  const record = await (prisma.pitcherDerivedStats as unknown as { findFirst: (args: unknown) => Promise<unknown> })?.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' },
  });

  if (!record) return null;

  const r = record as Record<string, unknown>;
  
  const features: PitcherDerivedFeatures = {
    playerId: String(r.playerId),
    playerMlbamId: String(r.playerMlbamId),
    season: Number(r.season),
    computedAt: new Date(String(r.computedAt)),

    volume: {
      appearancesLast7: Number(r.appearancesLast7) || 0,
      appearancesLast14: Number(r.appearancesLast14) || 0,
      appearancesLast30: Number(r.appearancesLast30) || 0,
      inningsPitchedLast7: Number(r.inningsPitchedLast7) || 0,
      inningsPitchedLast14: Number(r.inningsPitchedLast14) || 0,
      inningsPitchedLast30: Number(r.inningsPitchedLast30) || 0,
      battersFacedLast7: Number(r.battersFacedLast7) || 0,
      battersFacedLast14: Number(r.battersFacedLast14) || 0,
      battersFacedLast30: Number(r.battersFacedLast30) || 0,
      gamesSavedLast30: Number(r.gamesSavedLast30) || 0,
      gamesStartedLast30: Number(r.gamesStartedLast30) || 0,
      pitchesPerInning: r.pitchesPerInning != null ? Number(r.pitchesPerInning) : null,
      daysSinceLastAppearance: r.daysSinceLastAppearance != null ? Number(r.daysSinceLastAppearance) : null,
    },

    rates: {
      eraLast30: r.eraLast30 != null ? Number(r.eraLast30) : null,
      whipLast30: r.whipLast30 != null ? Number(r.whipLast30) : null,
      fipLast30: r.fipLast30 != null ? Number(r.fipLast30) : null,
      xfipLast30: r.xfipLast30 != null ? Number(r.xfipLast30) : null,
      strikeoutRateLast30: r.strikeoutRateLast30 != null ? Number(r.strikeoutRateLast30) : null,
      walkRateLast30: r.walkRateLast30 != null ? Number(r.walkRateLast30) : null,
      kToBBRatioLast30: r.kToBBRatioLast30 != null ? Number(r.kToBBRatioLast30) : null,
      swingingStrikeRate: r.swingingStrikeRate != null ? Number(r.swingingStrikeRate) : null,
      firstPitchStrikeRate: r.firstPitchStrikeRate != null ? Number(r.firstPitchStrikeRate) : null,
      avgVelocity: r.avgVelocity != null ? Number(r.avgVelocity) : null,
      gbRatio: r.gbRatio != null ? Number(r.gbRatio) : null,
      hrPer9: r.hrPer9 != null ? Number(r.hrPer9) : null,
    },

    stabilization: {
      eraReliable: Boolean(r.eraReliable),
      whipReliable: Boolean(r.whipReliable),
      fipReliable: Boolean(r.fipReliable),
      kRateReliable: Boolean(r.kRateReliable),
      bbRateReliable: Boolean(r.bbRateReliable),
      battersToReliable: Number(r.battersToReliable) || 0,
    },

    volatility: {
      qualityStartRate: r.qualityStartRate != null ? Number(r.qualityStartRate) : null,
      blowUpRate: r.blowUpRate != null ? Number(r.blowUpRate) : null,
      eraVolatility: r.eraVolatility != null ? Number(r.eraVolatility) : null,
      consistencyScore: Number(r.consistencyScore) || 0,
    },

    context: {
      opponentOps: r.opponentOps != null ? Number(r.opponentOps) : null,
      parkFactor: r.parkFactor != null ? Number(r.parkFactor) : null,
      isHome: r.isHome != null ? Boolean(r.isHome) : null,
      isCloser: r.isCloser != null ? Boolean(r.isCloser) : null,
      scheduledStartNext7: Boolean(r.scheduledStartNext7),
      opponentNextStart: r.opponentNextStart != null ? String(r.opponentNextStart) : null,
    },
  };

  return scorePitcher(features);
}
