/**
 * Player Identity Verification (Phase 1: Trust Boundary)
 *
 * Guarantees: No player enters the database without verified identity.
 * Every MLBAM ID is validated against the MLB Stats API before ingestion.
 */

import { prisma } from '@cbb/infrastructure';

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

export interface PlayerIdentity {
  mlbamId: string;
  fullName: string;
  team: string | null;
  position: string | null;
  active: boolean;
}

export interface VerificationResult {
  valid: boolean;
  identity?: PlayerIdentity;
  error?: string;
}

/**
 * Verify a player's identity against the MLB Stats API
 * This is the GATEKEEPER - no player passes without valid identity
 */
export async function verifyPlayerIdentity(mlbamId: string): Promise<VerificationResult> {
  const traceId = `verify-${mlbamId}-${Date.now()}`;
  console.log(`[${traceId}] Verifying player identity: ${mlbamId}`);

  try {
    // Step 1: Call MLB Stats API
    const url = `${MLB_STATS_BASE_URL}/people/${mlbamId}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.error(`[${traceId}] Player not found: ${mlbamId}`);
        return {
          valid: false,
          error: `Player ID ${mlbamId} not found in MLB database`,
        };
      }
      throw new Error(`MLB API error: ${response.status} ${response.statusText}`);
    }

    // Step 2: Parse response with type safety
    const data = await response.json() as {
      people?: Array<{
        id: number;
        fullName: string;
        active?: boolean;
        currentTeam?: { name: string };
        primaryPosition?: { abbreviation: string };
      }>;
    };

    const person = data.people?.[0];

    if (!person) {
      console.error(`[${traceId}] Empty response for player: ${mlbamId}`);
      return {
        valid: false,
        error: `No player data returned for ID ${mlbamId}`,
      };
    }

    // Step 3: Validate player is active
    if (!person.active) {
      console.warn(`[${traceId}] Player inactive: ${person.fullName} (${mlbamId})`);
      // Still valid - we track inactive players, just warn
    }

    // Step 4: Construct verified identity
    const identity: PlayerIdentity = {
      mlbamId: String(person.id),
      fullName: person.fullName,
      team: person.currentTeam?.name || null,
      position: person.primaryPosition?.abbreviation || null,
      active: person.active || false,
    };

    console.log(`[${traceId}] Identity verified: ${identity.fullName} (${mlbamId})`);
    return {
      valid: true,
      identity,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${traceId}] Verification failed: ${errorMessage}`);
    return {
      valid: false,
      error: `Verification failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if a player exists in the VerifiedPlayer registry
 */
export async function isPlayerVerified(mlbamId: string): Promise<boolean> {
  const verified = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
    select: { mlbamId: true },
  });
  return !!verified;
}

/**
 * Get verified player from registry, or null if not found
 */
export async function getVerifiedPlayer(mlbamId: string): Promise<PlayerIdentity | null> {
  const verified = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
  });

  if (!verified) return null;

  return {
    mlbamId: verified.mlbamId,
    fullName: verified.fullName,
    team: verified.team,
    position: verified.position,
    active: verified.isActive,
  };
}

/**
 * Store or update verified player in registry
 * This is the TRUSTED SOURCE - only called after successful API verification
 */
export async function upsertVerifiedPlayer(
  identity: PlayerIdentity
): Promise<void> {
  const traceId = `upsert-${identity.mlbamId}-${Date.now()}`;
  console.log(`[${traceId}] Upserting verified player: ${identity.fullName}`);

  await prisma.verifiedPlayer.upsert({
    where: { mlbamId: identity.mlbamId },
    create: {
      mlbamId: identity.mlbamId,
      fullName: identity.fullName,
      team: identity.team,
      position: identity.position,
      isActive: identity.active,
      verifiedAt: new Date(),
      lastChecked: new Date(),
      verificationSource: 'mlb_api',
    },
    update: {
      fullName: identity.fullName,
      team: identity.team,
      position: identity.position,
      isActive: identity.active,
      lastChecked: new Date(),
    },
  });

  console.log(`[${traceId}] Verified player stored: ${identity.fullName}`);
}
