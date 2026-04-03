/**
 * Player Identity Validation
 *
 * Ensures MLBAM IDs match expected player names before ingestion.
 * Prevents silent data corruption from ID mismatches.
 */

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

export interface PlayerIdentity {
  mlbamId: string;
  fullName: string;
  active: boolean;
  currentTeam: string | null;
  primaryPosition: string | null;
}

export interface ValidationResult {
  valid: boolean;
  expectedName: string;
  actualIdentity: PlayerIdentity | null;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that an MLBAM ID matches the expected player name
 */
export async function validatePlayerIdentity(
  mlbamId: string,
  expectedName: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const response = await fetch(
      `${MLB_STATS_BASE_URL}/people/${mlbamId}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        errors.push(`Player ID ${mlbamId} not found in MLB API`);
      } else {
        errors.push(`MLB API error: ${response.status} ${response.statusText}`);
      }
      return {
        valid: false,
        expectedName,
        actualIdentity: null,
        errors,
        warnings,
      };
    }

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
      errors.push(`No player data returned for ID ${mlbamId}`);
      return {
        valid: false,
        expectedName,
        actualIdentity: null,
        errors,
        warnings,
      };
    }

    const actualIdentity: PlayerIdentity = {
      mlbamId,
      fullName: person.fullName,
      active: person.active || false,
      currentTeam: person.currentTeam?.name || null,
      primaryPosition: person.primaryPosition?.abbreviation || null,
    };

    // Name matching - case insensitive, trim whitespace
    const normalizedExpected = expectedName.trim().toLowerCase();
    const normalizedActual = actualIdentity.fullName.trim().toLowerCase();

    if (normalizedActual !== normalizedExpected) {
      errors.push(
        `ID MISMATCH: Expected "${expectedName}", got "${actualIdentity.fullName}"`
      );
    }

    // Check if player is active
    if (!actualIdentity.active) {
      warnings.push(
        `Player ${actualIdentity.fullName} is INACTIVE (may be retired, minor leagues, or injured)`
      );
    }

    // Check if player has a current team
    if (!actualIdentity.currentTeam) {
      warnings.push(
        `Player ${actualIdentity.fullName} has no current team assignment`
      );
    }

    return {
      valid: errors.length === 0,
      expectedName,
      actualIdentity,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `Validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      valid: false,
      expectedName,
      actualIdentity: null,
      errors,
      warnings,
    };
  }
}

/**
 * Batch validate multiple player IDs
 */
export async function validatePlayerBatch(
  players: Array<{ mlbamId: string; name: string }>
): Promise<ValidationResult[]> {
  return Promise.all(
    players.map((p) => validatePlayerIdentity(p.mlbamId, p.name))
  );
}

/**
 * Lookup player by name (returns best match from search)
 */
export async function lookupPlayerByName(
  name: string
): Promise<PlayerIdentity | null> {
  try {
    const url = new URL(`${MLB_STATS_BASE_URL}/people/search`);
    url.searchParams.append('names', name);

    const response = await fetch(url.toString());

    if (!response.ok) {
      return null;
    }

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
      return null;
    }

    return {
      mlbamId: String(person.id),
      fullName: person.fullName,
      active: person.active || false,
      currentTeam: person.currentTeam?.name || null,
      primaryPosition: person.primaryPosition?.abbreviation || null,
    };
  } catch {
    return null;
  }
}

/**
 * Verify ID by checking it returns the expected player
 * Returns suggested ID if mismatch found
 */
export async function suggestCorrectId(
  expectedName: string
): Promise<{ mlbamId: string; confidence: 'high' | 'medium' | 'low' } | null> {
  const lookup = await lookupPlayerByName(expectedName);

  if (!lookup) {
    return null;
  }

  // Confidence based on exact name match
  const normalizedExpected = expectedName.trim().toLowerCase();
  const normalizedActual = lookup.fullName.trim().toLowerCase();

  let confidence: 'high' | 'medium' | 'low' = 'medium';

  if (normalizedActual === normalizedExpected) {
    confidence = lookup.active ? 'high' : 'medium';
  } else if (normalizedActual.includes(normalizedExpected) ||
             normalizedExpected.includes(normalizedActual)) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    mlbamId: lookup.mlbamId,
    confidence,
  };
}
