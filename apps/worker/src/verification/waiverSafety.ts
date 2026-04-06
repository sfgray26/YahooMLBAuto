/**
 * Waiver Recommendation Safety
 *
 * TRUST BOUNDARY: No player is recommended unless identity is verified.
 *
 * Safety Checks:
 *   1. Player must exist in VerifiedPlayer registry
 *   2. If not verified, auto-verify before scoring
 *   3. Include verified identity in recommendation for audit
 *
 * This prevents catastrophic recommendations (e.g., recommending a pitcher
 * when expecting a hitter due to ID mismatch).
 */

import { prisma } from '@cbb/infrastructure';
import {
  verifyPlayerIdentity,
  upsertVerifiedPlayer,
  getVerifiedPlayer,
  isPlayerVerified,
  type PlayerIdentity,
} from './playerIdentity.js';
import { computePlayerScore } from '../scoring/playerScore.js';

export interface SafeWaiverRecommendation {
  player: PlayerIdentity;
  score: {
    overallValue: number;
    components: Record<string, number>;
    confidence: number;
  };
  verified: true; // Always true - this is a type-level guarantee
  computedAt: Date;
  traceId: string;
}

export interface WaiverRecommendationError {
  mlbamId: string;
  error: string;
  verified: false;
  traceId: string;
}

export type WaiverRecommendationResult =
  | SafeWaiverRecommendation
  | WaiverRecommendationError;

/**
 * Recommend a waiver pickup with guaranteed identity verification
 *
 * SAFETY: This function will NEVER return a recommendation for an unverified player.
 */
export async function recommendWaiverPickup(
  mlbamId: string
): Promise<WaiverRecommendationResult> {
  const traceId = `waiver-${mlbamId}-${Date.now()}`;
  console.log(`[${traceId}] Processing waiver recommendation: ${mlbamId}`);

  try {
    // =========================================================================
    // STEP 1: Check if player is already verified
    // =========================================================================
    console.log(`[${traceId}] STEP 1: Checking VerifiedPlayer registry...`);
    let identity = await getVerifiedPlayer(mlbamId);

    if (!identity) {
      console.log(`[${traceId}] Player not in registry. Auto-verifying...`);

      // =========================================================================
      // STEP 2: Auto-verify on first recommendation attempt
      // =========================================================================
      console.log(`[${traceId}] STEP 2: Verifying identity via MLB API...`);
      const verification = await verifyPlayerIdentity(mlbamId);

      if (!verification.valid || !verification.identity) {
        const error = verification.error || 'Identity verification failed';
        console.error(`[${traceId}] VERIFICATION FAILED: ${error}`);

        return {
          mlbamId,
          error,
          verified: false,
          traceId,
        };
      }

      // Store verified identity
      identity = verification.identity;
      await upsertVerifiedPlayer(identity);
      console.log(`[${traceId}] Auto-verified and stored: ${identity.fullName}`);
    } else {
      console.log(`[${traceId}] Found verified player: ${identity.fullName}`);
    }

    if (identity.role !== 'hitter') {
      return {
        mlbamId,
        error: `Player ${identity.fullName} is classified as ${identity.role}; hitter scoring is not supported for this role.`,
        verified: false,
        traceId,
      };
    }

    // =========================================================================
    // STEP 3: Now safe to compute score
    // =========================================================================
    console.log(`[${traceId}] STEP 3: Computing player score...`);
    const score = await computePlayerScore(mlbamId);

    console.log(`[${traceId}] SUCCESS: Score ${score.overallValue} for ${identity.fullName}`);

    // Return guaranteed-verified recommendation
    return {
      player: identity,
      score: {
        overallValue: score.overallValue,
        components: score.components,
        confidence: score.confidence,
      },
      verified: true,
      computedAt: new Date(),
      traceId,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${traceId}] UNEXPECTED ERROR: ${errorMessage}`);

    return {
      mlbamId,
      error: `Recommendation failed: ${errorMessage}`,
      verified: false,
      traceId,
    };
  }
}

/**
 * Batch waiver recommendations with safety
 */
export async function recommendWaiverBatch(
  mlbamIds: string[]
): Promise<WaiverRecommendationResult[]> {
  const traceId = `waiver-batch-${Date.now()}`;
  console.log(`[${traceId}] Processing ${mlbamIds.length} waiver recommendations`);

  const results: WaiverRecommendationResult[] = [];

  for (const mlbamId of mlbamIds) {
    const result = await recommendWaiverPickup(mlbamId);
    results.push(result);

    if (!result.verified) {
      console.warn(`[${traceId}] Failed: ${mlbamId} - ${result.error}`);
    }
  }

  const verifiedCount = results.filter(r => r.verified).length;
  console.log(`[${traceId}] Complete: ${verifiedCount}/${mlbamIds.length} verified`);

  return results;
}

/**
 * Filter recommendations to only verified players
 * Useful for pre-filtering waiver wire pool
 */
export async function filterVerifiedPlayers(
  mlbamIds: string[]
): Promise<PlayerIdentity[]> {
  const traceId = `filter-${Date.now()}`;
  console.log(`[${traceId}] Filtering ${mlbamIds.length} players for verified status`);

  const verifiedPlayers: PlayerIdentity[] = [];

  for (const mlbamId of mlbamIds) {
    // Check registry first
    let identity = await getVerifiedPlayer(mlbamId);

    if (!identity) {
      // Try to verify
      const verification = await verifyPlayerIdentity(mlbamId);
      if (verification.valid && verification.identity) {
        identity = verification.identity;
        await upsertVerifiedPlayer(identity);
      }
    }

    if (identity) {
      verifiedPlayers.push(identity);
    }
  }

  console.log(`[${traceId}] Filtered: ${verifiedPlayers.length}/${mlbamIds.length} verified`);
  return verifiedPlayers;
}
