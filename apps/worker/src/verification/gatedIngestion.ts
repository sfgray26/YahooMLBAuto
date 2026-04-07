/**
 * Gated Player Ingestion
 *
 * TRUST BOUNDARY: No player enters the database without verified identity.
 *
 * Flow:
 *   1. Verify identity via MLB API
 *   2. Store in VerifiedPlayer registry
 *   3. Only then proceed to ingest game logs
 *
 * Errors are HARD FAILURES - no silent skipping.
 */

import {
  verifyPlayerIdentity,
  upsertVerifiedPlayer,
  type PlayerIdentity,
} from './playerIdentity.js';
import { ingestGameLogs } from '../ingestion/gameLogs.js';
import { ingestPitcherGameLogsForPlayers } from '../pitchers/gameLogs.js';

export interface GatedIngestionResult {
  success: boolean;
  mlbamId: string;
  identity?: PlayerIdentity;
  gamesIngested?: number;
  error?: string;
  traceId: string;
}

/**
 * Ingest a player with mandatory identity verification
 *
 * @throws Error if verification fails (hard failure)
 */
export async function ingestPlayer(
  mlbamId: string,
  season: number = new Date().getFullYear()
): Promise<GatedIngestionResult> {
  const traceId = `ingest-${mlbamId}-${Date.now()}`;
  console.log(`[${traceId}] Starting gated ingestion for: ${mlbamId}`);

  try {
    // =========================================================================
    // STEP 1: Verify identity (GATEKEEPER)
    // =========================================================================
    console.log(`[${traceId}] STEP 1: Verifying player identity...`);
    const verification = await verifyPlayerIdentity(mlbamId);

    if (!verification.valid || !verification.identity) {
      const error = verification.error || 'Identity verification failed';
      console.error(`[${traceId}] GATEKEEPER REJECTED: ${error}`);

      // HARD FAILURE - do not proceed
      return {
        success: false,
        mlbamId,
        error,
        traceId,
      };
    }

    const identity = verification.identity;
    console.log(`[${traceId}] GATEKEEPER PASSED: ${identity.fullName}`);

    if (identity.role !== 'hitter' && identity.role !== 'pitcher') {
      const error = `Player ${identity.fullName} (${mlbamId}) is classified as ${identity.role}; gated ingestion only supports hitters and pitchers.`;
      console.error(`[${traceId}] ROLE GATE REJECTED: ${error}`);
      return {
        success: false,
        mlbamId,
        error,
        traceId,
      };
    }

    // =========================================================================
    // STEP 2: Store verified identity in registry
    // =========================================================================
    console.log(`[${traceId}] STEP 2: Storing verified identity...`);
    await upsertVerifiedPlayer(identity);
    console.log(`[${traceId}] Identity stored in VerifiedPlayer registry`);

    // =========================================================================
    // STEP 3: Now safe to ingest game logs
    // =========================================================================
    console.log(`[${traceId}] STEP 3: Ingesting game logs...`);
    const gamesIngested = identity.role === 'pitcher'
      ? await ingestVerifiedPitcher(mlbamId, season)
      : await ingestVerifiedHitter(mlbamId, season);

    console.log(`[${traceId}] SUCCESS: Ingested ${gamesIngested} games for ${identity.fullName}`);

    return {
      success: true,
      mlbamId,
      identity,
      gamesIngested,
      traceId,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${traceId}] UNEXPECTED ERROR: ${errorMessage}`);

    // HARD FAILURE - any error stops the process
    return {
      success: false,
      mlbamId,
      error: `Ingestion failed: ${errorMessage}`,
      traceId,
    };
  }
}

/**
 * Ingest multiple players with individual error handling
 *
 * Each player is processed independently - one failure doesn't stop others.
 * But each player MUST pass verification.
 */
export async function ingestPlayerBatch(
  mlbamIds: string[],
  season: number = new Date().getFullYear()
): Promise<GatedIngestionResult[]> {
  const traceId = `batch-${Date.now()}`;
  console.log(`[${traceId}] Starting batch ingestion for ${mlbamIds.length} players`);

  const results: GatedIngestionResult[] = [];

  for (const mlbamId of mlbamIds) {
    const result = await ingestPlayer(mlbamId, season);
    results.push(result);

    if (!result.success) {
      console.warn(`[${traceId}] Batch warning: ${mlbamId} failed - ${result.error}`);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[${traceId}] Batch complete: ${successCount}/${mlbamIds.length} succeeded`);

  return results;
}

async function ingestVerifiedHitter(mlbamId: string, season: number): Promise<number> {
  const ingestionResult = await ingestGameLogs(mlbamId, season);
  return ingestionResult.totalGames;
}

async function ingestVerifiedPitcher(
  mlbamId: string,
  season: number
): Promise<number> {
  const result = await ingestPitcherGameLogsForPlayers(
    [{ playerId: `mlbam:${mlbamId}`, mlbamId }],
    season
  );

  if (result.errors.length > 0) {
    throw new Error(result.errors.join('; '));
  }

  return result.totalGames;
}
