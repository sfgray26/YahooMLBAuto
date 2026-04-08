/**
 * Player Identity Verification (Phase 1: Trust Boundary)
 *
 * Guarantees: No player enters the database without verified identity.
 * Every MLBAM ID is validated against the MLB Stats API before ingestion.
 */

import { prisma } from '@cbb/infrastructure';

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

export type PlayerRole = 'hitter' | 'pitcher' | 'two_way' | 'unknown';

export interface PlayerIdentity {
  mlbamId: string;
  fullName: string;
  team: string | null;
  position: string | null;
  active: boolean;
  role: PlayerRole;
}

export interface VerificationResult {
  valid: boolean;
  identity?: PlayerIdentity;
  error?: string;
}

const PITCHER_POSITIONS = new Set(['P', 'SP', 'RP', 'CL', 'CP']);
const HITTER_POSITIONS = new Set([
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'IF',
  'INF',
  'LF',
  'CF',
  'RF',
  'OF',
  'DH',
  'UT',
  'UTIL',
]);
const TWO_WAY_POSITIONS = new Set(['TWP', 'TWO-WAY PLAYER', 'TWO WAY PLAYER']);

export function classifyPlayerRole(position: string | null | undefined): PlayerRole {
  if (!position) {
    return 'unknown';
  }

  const normalized = position.trim().toUpperCase();

  if (TWO_WAY_POSITIONS.has(normalized)) {
    return 'two_way';
  }

  if (normalized.includes('/') || normalized.includes(',')) {
    const parts = normalized
      .split(/[\/,]/)
      .map((part) => part.trim())
      .filter(Boolean);

    const hasPitcherRole = parts.some((part) => PITCHER_POSITIONS.has(part));
    const hasHitterRole = parts.some((part) => HITTER_POSITIONS.has(part));

    if (hasPitcherRole && hasHitterRole) {
      return 'two_way';
    }

    if (hasPitcherRole) {
      return 'pitcher';
    }

    if (hasHitterRole) {
      return 'hitter';
    }

    return 'unknown';
  }

  if (PITCHER_POSITIONS.has(normalized)) {
    return 'pitcher';
  }

  if (HITTER_POSITIONS.has(normalized)) {
    return 'hitter';
  }

  return 'unknown';
}

export function supportsHitterGameLogSourcing(position: string | null | undefined): boolean {
  const role = classifyPlayerRole(position);
  return role === 'hitter' || role === 'two_way';
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
        primaryPosition?: {
          abbreviation?: string;
          type?: string;
          name?: string;
        };
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
    const position =
      person.primaryPosition?.abbreviation ||
      person.primaryPosition?.type ||
      person.primaryPosition?.name ||
      null;

    const identity: PlayerIdentity = {
      mlbamId: String(person.id),
      fullName: person.fullName,
      team: person.currentTeam?.name || null,
      position,
      active: person.active || false,
      role: classifyPlayerRole(position),
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
    role: classifyPlayerRole(verified.position),
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
