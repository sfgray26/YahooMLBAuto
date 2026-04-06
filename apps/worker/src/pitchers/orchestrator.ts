/**
 * Pitcher Scoring Orchestrator (Parallel to hitters/orchestrator.ts)
 *
 * Batch scores all pitchers after derived features are computed.
 * Stateless, deterministic, no persistence.
 */

import { prisma } from '@cbb/infrastructure';
import { v4 as uuidv4 } from 'uuid';
import { scorePitcher, scorePitchers, type PitcherScore } from './compute.js';
import { getAllPitcherDerivedFeatures, getPitcherDerivedFeatures, storePitcherDerivedFeatures } from './storage.js';
import { computePitcherDerivedStatsFromGameLogs } from './fromGameLogs.js';

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
    const featuresList = await getAllPitcherDerivedFeatures(season);

    console.log(`[PITCHER SCORING] Found ${featuresList.length} pitchers with derived features`);

    if (featuresList.length === 0) {
      return {
        success: false,
        traceId,
        pitchersScored: 0,
        scores: [],
        errors: ['No pitcher derived features found. Run pitcher feature computation first.'],
        durationMs: Date.now() - startTime,
      };
    }

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
  let features = await getPitcherDerivedFeatures(playerMlbamId, season);

  if (!features) {
    const latestLog = await prisma.pitcherGameLog.findFirst({
      where: { playerMlbamId, season },
      orderBy: { gameDate: 'desc' },
      select: { playerId: true },
    });

    if (!latestLog) {
      return null;
    }

    features = await computePitcherDerivedStatsFromGameLogs(
      latestLog.playerId,
      playerMlbamId,
      season
    );

    if (!features) {
      return null;
    }

    await storePitcherDerivedFeatures(features, uuidv4());
  }

  return scorePitcher(features);
}
