/**
 * Schema Validation Utilities
 *
 * Row-level data-quality checks for every layer of the pipeline:
 *   Ingestion → Normalization → Derived Features → Scoring → Monte Carlo
 *
 * Design principles:
 * - Pure functions: no I/O, no side effects
 * - Fail-fast: invalid inputs are surfaced immediately with clear messages
 * - Composable: each validator returns a SchemaValidationResult that callers
 *   can accumulate and act on
 */

// ============================================================================
// Shared Result Type
// ============================================================================

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function makeResult(errors: string[], warnings: string[] = []): SchemaValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Game Log Row Validation
// ============================================================================

/** Minimal shape of a game-log record expected from the ingestion layer. */
export interface GameLogRowInput {
  playerMlbamId: string;
  gamePk: string;
  gameDate: Date | string;
  season: number;
  stats: {
    atBats?: number;
    runs?: number;
    hits?: number;
    doubles?: number;
    triples?: number;
    homeRuns?: number;
    rbi?: number;
    stolenBases?: number;
    caughtStealing?: number;
    walks?: number;
    strikeouts?: number;
    hitByPitch?: number;
    sacrificeFlies?: number;
    plateAppearances?: number;
    totalBases?: number;
    gamesPlayed?: number;
  };
}

/**
 * Validate a single game-log row.
 *
 * Checks:
 * - Required fields are present and non-empty
 * - gameDate is a valid, parseable date
 * - No counting stat is negative
 * - Plate-appearance arithmetic consistency (PA ≥ AB)
 * - totalBases ≥ hits
 * - season is a plausible MLB year
 */
export function validateGameLogRow(row: GameLogRowInput): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required string IDs
  if (!row.playerMlbamId || row.playerMlbamId.trim() === '') {
    errors.push('gameLog: playerMlbamId is required');
  }
  if (!row.gamePk || row.gamePk.trim() === '') {
    errors.push('gameLog: gamePk is required');
  }

  // gameDate must be parseable
  const gameDateTs = row.gameDate instanceof Date
    ? row.gameDate.getTime()
    : new Date(row.gameDate).getTime();
  if (Number.isNaN(gameDateTs)) {
    errors.push(`gameLog [${row.playerMlbamId}/${row.gamePk}]: gameDate "${row.gameDate}" is not a valid date`);
  }

  // Season plausibility (MLB started in 1876; allow up to 5 years into the future)
  const currentYear = new Date().getFullYear();
  if (row.season < 1876 || row.season > currentYear + 5) {
    errors.push(`gameLog [${row.playerMlbamId}/${row.gamePk}]: season ${row.season} is implausible`);
  }

  // Counting stats must be non-negative
  const s = row.stats;
  const countingFields: Array<[string, number | undefined]> = [
    ['atBats', s.atBats],
    ['runs', s.runs],
    ['hits', s.hits],
    ['doubles', s.doubles],
    ['triples', s.triples],
    ['homeRuns', s.homeRuns],
    ['rbi', s.rbi],
    ['stolenBases', s.stolenBases],
    ['caughtStealing', s.caughtStealing],
    ['walks', s.walks],
    ['strikeouts', s.strikeouts],
    ['hitByPitch', s.hitByPitch],
    ['sacrificeFlies', s.sacrificeFlies],
    ['plateAppearances', s.plateAppearances],
    ['totalBases', s.totalBases],
    ['gamesPlayed', s.gamesPlayed],
  ];
  for (const [field, value] of countingFields) {
    if (value !== undefined && value < 0) {
      errors.push(
        `gameLog [${row.playerMlbamId}/${row.gamePk}]: stats.${field} = ${value} cannot be negative`
      );
    }
  }

  // PA ≥ AB when both are present
  if (s.plateAppearances !== undefined && s.atBats !== undefined && s.plateAppearances < s.atBats) {
    errors.push(
      `gameLog [${row.playerMlbamId}/${row.gamePk}]: plateAppearances (${s.plateAppearances}) < atBats (${s.atBats})`
    );
  }

  // totalBases ≥ hits (a single is 1 base)
  if (s.totalBases !== undefined && s.hits !== undefined && s.totalBases < s.hits) {
    errors.push(
      `gameLog [${row.playerMlbamId}/${row.gamePk}]: totalBases (${s.totalBases}) < hits (${s.hits})`
    );
  }

  // Hits decomposition: doubles + triples + HR ≤ hits
  if (
    s.hits !== undefined &&
    s.doubles !== undefined &&
    s.triples !== undefined &&
    s.homeRuns !== undefined
  ) {
    const xbh = s.doubles + s.triples + s.homeRuns;
    if (xbh > s.hits) {
      errors.push(
        `gameLog [${row.playerMlbamId}/${row.gamePk}]: XBH (${xbh}) > hits (${s.hits}); decomposition is inconsistent`
      );
    }
  }

  // gamesPlayed should be 0 or 1 for a single-game log
  if (s.gamesPlayed !== undefined && s.gamesPlayed > 1) {
    warnings.push(
      `gameLog [${row.playerMlbamId}/${row.gamePk}]: gamesPlayed = ${s.gamesPlayed} in a single game log row (expected 0 or 1)`
    );
  }

  return makeResult(errors, warnings);
}

// ============================================================================
// Duplicate Detection
// ============================================================================

/**
 * Detect duplicate game-log rows within a batch.
 *
 * A duplicate is defined as two rows sharing the same (playerMlbamId, gamePk) pair.
 * Returns a result with an error for each duplicate key found.
 */
export function detectDuplicateGameLogs(
  rows: Array<Pick<GameLogRowInput, 'playerMlbamId' | 'gamePk'>>
): SchemaValidationResult {
  const errors: string[] = [];
  const seen = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.playerMlbamId}:${row.gamePk}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  for (const [key, count] of seen) {
    if (count > 1) {
      errors.push(`Duplicate game log detected: (${key}) appears ${count} times`);
    }
  }

  return makeResult(errors);
}

// ============================================================================
// Player Record Validation
// ============================================================================

/** Minimal player record shape used across pipeline layers. */
export interface PlayerRecordInput {
  playerId: string;
  playerMlbamId: string;
  name?: string;
  positions?: string[];
}

const VALID_MLB_POSITIONS = new Set([
  'P', 'SP', 'RP', 'CL',
  'C', '1B', '2B', '3B', 'SS',
  'OF', 'LF', 'CF', 'RF',
  'DH', 'PH', 'PR',
  'IF', 'CI', 'MI',
]);

/**
 * Validate a player record.
 *
 * Checks:
 * - playerId and playerMlbamId are non-empty
 * - playerMlbamId looks like a numeric MLBAM ID
 * - positions (if provided) are known MLB position codes
 */
export function validatePlayerRecord(player: PlayerRecordInput): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!player.playerId || player.playerId.trim() === '') {
    errors.push('player: playerId is required');
  }
  if (!player.playerMlbamId || player.playerMlbamId.trim() === '') {
    errors.push('player: playerMlbamId is required');
  } else if (!/^\d+$/.test(player.playerMlbamId.trim())) {
    errors.push(
      `player [${player.playerMlbamId}]: playerMlbamId must be a numeric string; got "${player.playerMlbamId}"`
    );
  }

  if (!player.name || player.name.trim() === '') {
    warnings.push(`player [${player.playerMlbamId}]: name is missing or empty`);
  }

  if (player.positions) {
    for (const pos of player.positions) {
      if (!VALID_MLB_POSITIONS.has(pos)) {
        warnings.push(
          `player [${player.playerMlbamId}]: unrecognised position code "${pos}"`
        );
      }
    }
    if (player.positions.length === 0) {
      warnings.push(`player [${player.playerMlbamId}]: positions array is empty`);
    }
  }

  return makeResult(errors, warnings);
}

// ============================================================================
// Slate / Date Boundary Validation
// ============================================================================

export interface SlateInput {
  /** ISO-8601 string or Date for the slate start (inclusive) */
  startDate: Date | string;
  /** ISO-8601 string or Date for the slate end (inclusive) */
  endDate: Date | string;
  /** Optional IANA timezone identifier; if omitted, UTC is assumed */
  timezone?: string;
}

/**
 * Validate a slate date range.
 *
 * Checks:
 * - Both dates are valid
 * - startDate ≤ endDate
 * - The span is ≤ 30 days (a single matchup period, not a whole season)
 * - If timezone is provided, it is a known IANA identifier
 */
export function validateSlate(slate: SlateInput): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const start = slate.startDate instanceof Date
    ? slate.startDate
    : new Date(slate.startDate);
  const end = slate.endDate instanceof Date
    ? slate.endDate
    : new Date(slate.endDate);

  if (Number.isNaN(start.getTime())) {
    errors.push(`slate: startDate "${slate.startDate}" is not a valid date`);
  }
  if (Number.isNaN(end.getTime())) {
    errors.push(`slate: endDate "${slate.endDate}" is not a valid date`);
  }

  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    if (start > end) {
      errors.push(
        `slate: startDate (${start.toISOString()}) is after endDate (${end.toISOString()})`
      );
    } else {
      const spanDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (spanDays > 30) {
        warnings.push(
          `slate: span of ${spanDays.toFixed(1)} days is unusually long (>30 days)`
        );
      }
    }
  }

  if (slate.timezone) {
    try {
      // Intl.DateTimeFormat throws on unknown timezones in V8
      Intl.DateTimeFormat('en-US', { timeZone: slate.timezone });
    } catch {
      errors.push(`slate: unknown IANA timezone "${slate.timezone}"`);
    }
  }

  return makeResult(errors, warnings);
}

// ============================================================================
// Derived Features Validation
// ============================================================================

/** Subset of DerivedFeatures fields that can be validated without the DB type. */
export interface DerivedFeaturesInput {
  playerId: string;
  playerMlbamId: string;
  season: number;
  volume: {
    gamesLast7: number;
    gamesLast14: number;
    gamesLast30: number;
    plateAppearancesLast7: number;
    plateAppearancesLast14: number;
    plateAppearancesLast30: number;
    atBatsLast30: number;
  };
  rates: {
    battingAverageLast30?: number | null;
    onBasePctLast30?: number | null;
    sluggingPctLast30?: number | null;
    opsLast30?: number | null;
    isoLast30?: number | null;
    walkRateLast30?: number | null;
    strikeoutRateLast30?: number | null;
    babipLast30?: number | null;
  };
}

/**
 * Validate a derived features record.
 *
 * Checks:
 * - Identity fields present
 * - Volume counts are non-negative integers
 * - Rolling windows are monotonic (30d ≥ 14d ≥ 7d)
 * - atBatsLast30 ≤ plateAppearancesLast30
 * - Rate stats are within physically plausible ranges
 */
export function validateDerivedFeatures(record: DerivedFeaturesInput): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const id = record.playerMlbamId || record.playerId || '<unknown>';

  // Identity
  if (!record.playerId) errors.push(`derived [${id}]: playerId is required`);
  if (!record.playerMlbamId) errors.push(`derived [${id}]: playerMlbamId is required`);

  const { volume, rates } = record;

  // Volume: non-negative
  const volumeFields: Array<[string, number]> = [
    ['gamesLast7', volume.gamesLast7],
    ['gamesLast14', volume.gamesLast14],
    ['gamesLast30', volume.gamesLast30],
    ['plateAppearancesLast7', volume.plateAppearancesLast7],
    ['plateAppearancesLast14', volume.plateAppearancesLast14],
    ['plateAppearancesLast30', volume.plateAppearancesLast30],
    ['atBatsLast30', volume.atBatsLast30],
  ];
  for (const [field, value] of volumeFields) {
    if (value < 0) {
      errors.push(`derived [${id}]: volume.${field} = ${value} cannot be negative`);
    }
  }

  // Window monotonicity
  if (volume.gamesLast30 < volume.gamesLast14) {
    errors.push(
      `derived [${id}]: non-monotonic games windows: 30d=${volume.gamesLast30} < 14d=${volume.gamesLast14}`
    );
  }
  if (volume.gamesLast14 < volume.gamesLast7) {
    errors.push(
      `derived [${id}]: non-monotonic games windows: 14d=${volume.gamesLast14} < 7d=${volume.gamesLast7}`
    );
  }
  if (volume.plateAppearancesLast30 < volume.plateAppearancesLast14) {
    errors.push(
      `derived [${id}]: non-monotonic PA windows: 30d=${volume.plateAppearancesLast30} < 14d=${volume.plateAppearancesLast14}`
    );
  }
  if (volume.plateAppearancesLast14 < volume.plateAppearancesLast7) {
    errors.push(
      `derived [${id}]: non-monotonic PA windows: 14d=${volume.plateAppearancesLast14} < 7d=${volume.plateAppearancesLast7}`
    );
  }

  // atBatsLast30 ≤ plateAppearancesLast30
  if (volume.atBatsLast30 > volume.plateAppearancesLast30) {
    errors.push(
      `derived [${id}]: atBatsLast30 (${volume.atBatsLast30}) > plateAppearancesLast30 (${volume.plateAppearancesLast30})`
    );
  }

  // Rate ranges
  const rateChecks: Array<[string, number | null | undefined, number, number]> = [
    ['battingAverageLast30', rates.battingAverageLast30, 0, 1],
    ['onBasePctLast30', rates.onBasePctLast30, 0, 1],
    ['sluggingPctLast30', rates.sluggingPctLast30, 0, 4],
    ['opsLast30', rates.opsLast30, 0, 5],
    ['isoLast30', rates.isoLast30, 0, 3],
    ['walkRateLast30', rates.walkRateLast30, 0, 1],
    ['strikeoutRateLast30', rates.strikeoutRateLast30, 0, 1],
    ['babipLast30', rates.babipLast30, 0, 1],
  ];
  for (const [field, value, min, max] of rateChecks) {
    if (value !== null && value !== undefined && (value < min || value > max)) {
      errors.push(
        `derived [${id}]: rates.${field} = ${value} is out of range [${min}, ${max}]`
      );
    }
  }

  return makeResult(errors, warnings);
}

// ============================================================================
// Mismatched Join Detection
// ============================================================================

/**
 * Detect player records in `setB` that have no matching entry in `setA`
 * (by playerMlbamId). Useful for catching join failures between game logs
 * and derived features, or derived features and scores.
 *
 * @param setA - Source set (e.g. game logs)
 * @param setB - Target set (e.g. derived features)
 * @param labelA - Human-readable name for setA
 * @param labelB - Human-readable name for setB
 */
export function detectMismatchedJoins(
  setA: Array<{ playerMlbamId: string }>,
  setB: Array<{ playerMlbamId: string }>,
  labelA: string = 'setA',
  labelB: string = 'setB'
): SchemaValidationResult {
  const errors: string[] = [];
  const idsA = new Set(setA.map((r) => r.playerMlbamId));
  const idsB = new Set(setB.map((r) => r.playerMlbamId));

  // Records in B missing from A
  for (const id of idsB) {
    if (!idsA.has(id)) {
      errors.push(
        `Join mismatch: playerMlbamId "${id}" is present in ${labelB} but missing from ${labelA}`
      );
    }
  }

  // Records in A missing from B (surface as warnings — may be expected for pitchers, etc.)
  const warnings: string[] = [];
  for (const id of idsA) {
    if (!idsB.has(id)) {
      warnings.push(
        `Join gap: playerMlbamId "${id}" is present in ${labelA} but has no entry in ${labelB}`
      );
    }
  }

  return makeResult(errors, warnings);
}

// ============================================================================
// Monte Carlo Input / Output Validation
// ============================================================================

export interface MonteCarloInputRecord {
  playerId: string;
  playerMlbamId: string;
  overallValue: number;
  confidence: number;
}

/**
 * Validate Monte Carlo input records.
 *
 * Checks:
 * - Identity fields present
 * - overallValue in [0, 100]
 * - confidence in [0, 1]
 */
export function validateMonteCarloInputs(
  records: MonteCarloInputRecord[]
): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (records.length === 0) {
    warnings.push('Monte Carlo: no input records provided');
    return makeResult(errors, warnings);
  }

  for (const r of records) {
    const id = r.playerMlbamId || r.playerId || '<unknown>';
    if (!r.playerId) errors.push(`MC input [${id}]: playerId is required`);
    if (!r.playerMlbamId) errors.push(`MC input [${id}]: playerMlbamId is required`);

    if (r.overallValue < 0 || r.overallValue > 100) {
      errors.push(
        `MC input [${id}]: overallValue = ${r.overallValue} is out of range [0, 100]`
      );
    }
    if (r.confidence < 0 || r.confidence > 1) {
      errors.push(
        `MC input [${id}]: confidence = ${r.confidence} is out of range [0, 1]`
      );
    }
  }

  return makeResult(errors, warnings);
}

export interface MonteCarloOutputRecord {
  playerId: string;
  playerMlbamId: string;
  runs: number;
  expectedValue: number;
  p10: number;
  p50: number;
  p90: number;
  seed: number;
}

/**
 * Validate Monte Carlo output records.
 *
 * Checks:
 * - Identity and required fields present
 * - runs ≥ 1
 * - Percentiles are ordered: p10 ≤ p50 ≤ p90
 * - expectedValue is within [0, 200] (daily or weekly horizon)
 * - seed is recorded (for reproducibility)
 */
export function validateMonteCarloOutputs(
  records: MonteCarloOutputRecord[]
): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (records.length === 0) {
    warnings.push('Monte Carlo: no output records provided');
    return makeResult(errors, warnings);
  }

  for (const r of records) {
    const id = r.playerMlbamId || r.playerId || '<unknown>';

    if (!r.playerId) errors.push(`MC output [${id}]: playerId is required`);
    if (!r.playerMlbamId) errors.push(`MC output [${id}]: playerMlbamId is required`);

    if (!r.seed || r.seed === 0) {
      warnings.push(`MC output [${id}]: seed is 0 or missing – reproducibility may be compromised`);
    }

    if (r.runs < 1) {
      errors.push(`MC output [${id}]: runs = ${r.runs} must be ≥ 1`);
    }

    if (r.expectedValue < 0 || r.expectedValue > 200) {
      errors.push(
        `MC output [${id}]: expectedValue = ${r.expectedValue} is out of range [0, 200]`
      );
    }

    if (r.p10 > r.p50) {
      errors.push(`MC output [${id}]: p10 (${r.p10}) > p50 (${r.p50}); percentiles must be ordered`);
    }
    if (r.p50 > r.p90) {
      errors.push(`MC output [${id}]: p50 (${r.p50}) > p90 (${r.p90}); percentiles must be ordered`);
    }
  }

  return makeResult(errors, warnings);
}
