/**
 * Automated Pipeline Validation
 *
 * Validates the data pipeline results after each automated fetch run.
 *
 * Covers:
 * - Ingestion completeness (player count, game count, error rate)
 * - Derived stats computation (processed count, error rate)
 * - Derived rate sanity (AVG, OBP, SLG within valid ranges)
 * - Window monotonicity (30d >= 14d >= 7d)
 */

// ============================================================================
// Types
// ============================================================================

export interface IngestionRunStats {
  totalPlayers: number;
  totalGames: number;
  errors: string[];
}

export interface DerivedRunStats {
  processed: number;
  errors: string[];
}

/** Minimal derived stat shape needed for hitter rate validation. */
export interface DerivedRateSample {
  playerMlbamId: string;
  battingAverageLast30: number | null;
  onBasePctLast30: number | null;
  sluggingPctLast30: number | null;
  opsLast30: number | null;
  isoLast30: number | null;
  walkRateLast30: number | null;
  strikeoutRateLast30: number | null;
  gamesLast7: number;
  gamesLast14: number;
  gamesLast30: number;
  plateAppearancesLast7: number;
  plateAppearancesLast14: number;
  plateAppearancesLast30: number;
}

/** Minimal pitcher derived stat shape needed for rate validation. */
export interface PitcherDerivedRateSample {
  playerMlbamId: string;
  eraLast30: number | null;
  whipLast30: number | null;
  strikeoutRateLast30: number | null;
  walkRateLast30: number | null;
  kToBBRatioLast30: number | null;
  appearancesLast7: number;
  appearancesLast14: number;
  appearancesLast30: number;
  inningsPitchedLast7: number;
  inningsPitchedLast14: number;
  inningsPitchedLast30: number;
  battersFacedLast7: number;
  battersFacedLast14: number;
  battersFacedLast30: number;
}

export interface PipelineStageResult {
  stage: string;
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface PipelineValidationResult {
  valid: boolean;
  stages: PipelineStageResult[];
  summary: string;
}

// ============================================================================
// Stage Validators
// ============================================================================

/**
 * Validate hitter game-log ingestion output.
 *
 * Thresholds are intentionally conservative – they catch complete failures
 * (zero players, zero games) while tolerating normal API variability.
 */
export function validateIngestionResult(
  result: IngestionRunStats,
  label: string = 'ingestion'
): PipelineStageResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (result.totalPlayers === 0) {
    errors.push('No players processed during ingestion');
  }

  if (result.totalGames === 0 && result.totalPlayers > 0) {
    // Could be start of season – warn rather than error
    warnings.push('No game logs stored (pre-season or API lag)');
  }

  const errorRate =
    result.totalPlayers > 0 ? result.errors.length / result.totalPlayers : 0;

  if (errorRate > 0.5) {
    errors.push(
      `High ingestion error rate: ${result.errors.length} errors for ${result.totalPlayers} players (${(errorRate * 100).toFixed(1)}%)`
    );
  } else if (errorRate > 0.1) {
    warnings.push(
      `Elevated ingestion error rate: ${result.errors.length} errors for ${result.totalPlayers} players (${(errorRate * 100).toFixed(1)}%)`
    );
  }

  return {
    stage: label,
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Validate derived stats computation output.
 */
export function validateDerivedStatsResult(
  result: DerivedRunStats,
  label: string = 'derived_stats'
): PipelineStageResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (result.processed === 0) {
    errors.push('No derived stats were computed');
  }

  const errorRate =
    result.processed > 0
      ? result.errors.length / result.processed
      : result.errors.length > 0
        ? 1
        : 0;

  if (errorRate > 0.5) {
    errors.push(
      `High derived-stats error rate: ${result.errors.length} errors for ${result.processed} players`
    );
  } else if (errorRate > 0.1) {
    warnings.push(
      `Elevated derived-stats error rate: ${result.errors.length} errors for ${result.processed} players`
    );
  }

  return {
    stage: label,
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Validate a sample of derived rate stats for sanity.
 *
 * Checks:
 * - Rate stats are within valid numeric ranges (0–1 for percentages, etc.)
 * - OPS is close to OBP + SLG
 * - ISO is close to SLG – AVG
 * - Window monotonicity: 30d >= 14d >= 7d
 *
 * Returns a stage result summarising any invalid records found.
 */
export function validateDerivedRates(
  samples: DerivedRateSample[]
): PipelineStageResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (samples.length === 0) {
    warnings.push('No derived stats samples provided for rate validation');
    return { stage: 'derived_rates', valid: true, warnings, errors };
  }

  let rateOutOfRange = 0;
  let formulaMismatch = 0;
  let windowNotMonotonic = 0;

  for (const s of samples) {
    const id = s.playerMlbamId;

    // Rate range checks (when non-null)
    const rateFields: Array<[string, number | null, number, number]> = [
      ['battingAverageLast30', s.battingAverageLast30, 0, 1],
      ['onBasePctLast30', s.onBasePctLast30, 0, 1],
      ['sluggingPctLast30', s.sluggingPctLast30, 0, 4],
      ['opsLast30', s.opsLast30, 0, 5],
      ['isoLast30', s.isoLast30, 0, 3],
      ['walkRateLast30', s.walkRateLast30, 0, 1],
      ['strikeoutRateLast30', s.strikeoutRateLast30, 0, 1],
    ];

    for (const [field, value, min, max] of rateFields) {
      if (value !== null && (value < min || value > max)) {
        errors.push(`Player ${id}: ${field} = ${value} is out of range [${min}, ${max}]`);
        rateOutOfRange++;
      }
    }

    // OPS ≈ OBP + SLG
    if (
      s.opsLast30 !== null &&
      s.onBasePctLast30 !== null &&
      s.sluggingPctLast30 !== null
    ) {
      const expectedOps = s.onBasePctLast30 + s.sluggingPctLast30;
      if (Math.abs(s.opsLast30 - expectedOps) > 0.005) {
        errors.push(
          `Player ${id}: OPS (${s.opsLast30.toFixed(3)}) ≠ OBP + SLG (${expectedOps.toFixed(3)})`
        );
        formulaMismatch++;
      }
    }

    // ISO ≈ SLG – AVG
    if (
      s.isoLast30 !== null &&
      s.sluggingPctLast30 !== null &&
      s.battingAverageLast30 !== null
    ) {
      const expectedIso = s.sluggingPctLast30 - s.battingAverageLast30;
      if (Math.abs(s.isoLast30 - expectedIso) > 0.005) {
        errors.push(
          `Player ${id}: ISO (${s.isoLast30.toFixed(3)}) ≠ SLG – AVG (${expectedIso.toFixed(3)})`
        );
        formulaMismatch++;
      }
    }

    // Window monotonicity
    if (
      s.gamesLast30 < s.gamesLast14 ||
      s.gamesLast14 < s.gamesLast7
    ) {
      errors.push(
        `Player ${id}: non-monotonic game windows: 30d=${s.gamesLast30}, 14d=${s.gamesLast14}, 7d=${s.gamesLast7}`
      );
      windowNotMonotonic++;
    }

    if (
      s.plateAppearancesLast30 < s.plateAppearancesLast14 ||
      s.plateAppearancesLast14 < s.plateAppearancesLast7
    ) {
      errors.push(
        `Player ${id}: non-monotonic PA windows: 30d=${s.plateAppearancesLast30}, 14d=${s.plateAppearancesLast14}, 7d=${s.plateAppearancesLast7}`
      );
      windowNotMonotonic++;
    }
  }

  if (rateOutOfRange > 0) {
    warnings.push(`${rateOutOfRange} rate-out-of-range issue(s) detected`);
  }
  if (formulaMismatch > 0) {
    warnings.push(`${formulaMismatch} formula mismatch(es) detected`);
  }
  if (windowNotMonotonic > 0) {
    warnings.push(`${windowNotMonotonic} window monotonicity violation(s) detected`);
  }

  return {
    stage: 'derived_rates',
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Validate a sample of pitcher derived rate stats for sanity.
 *
 * Checks:
 * - Rate stats are within valid numeric ranges (ERA ≥ 0, rates 0–1, etc.)
 * - K/BB ratio is consistent with strikeout and walk rates
 * - Window monotonicity: 30d >= 14d >= 7d for appearances, IP, and batters faced
 *
 * Returns a stage result summarising any invalid records found.
 */
export function validatePitcherDerivedRates(
  samples: PitcherDerivedRateSample[]
): PipelineStageResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (samples.length === 0) {
    warnings.push('No pitcher derived stats samples provided for rate validation');
    return { stage: 'pitcher_derived_rates', valid: true, warnings, errors };
  }

  let rateOutOfRange = 0;
  let formulaMismatch = 0;
  let windowNotMonotonic = 0;

  for (const s of samples) {
    const id = s.playerMlbamId;
    const lowVolumeSample = s.inningsPitchedLast30 < 5 || s.battersFacedLast30 < 50;

    // Rate range checks (when non-null)
    const rateFields: Array<[string, number | null, number, number]> = [
      ['eraLast30', s.eraLast30, 0, 20],
      ['whipLast30', s.whipLast30, 0, 6],
      ['strikeoutRateLast30', s.strikeoutRateLast30, 0, 1],
      ['walkRateLast30', s.walkRateLast30, 0, 1],
      // K/BB ratio: capped at 20 to catch obvious data errors while accommodating
      // elite pitchers who rarely walk batters (historical record is ~15 for starters).
      ['kToBBRatioLast30', s.kToBBRatioLast30, 0, 20],
    ];

    for (const [field, value, min, max] of rateFields) {
      if (value !== null && (value < min || value > max)) {
        const tolerateLowVolumeUpperBound =
          lowVolumeSample &&
          value > max &&
          (field === 'eraLast30' || field === 'whipLast30');

        if (tolerateLowVolumeUpperBound) {
          warnings.push(
            `Pitcher ${id}: ${field} = ${value} exceeds nominal range [${min}, ${max}] but is tolerated for low-volume sample (IP30=${s.inningsPitchedLast30}, BF30=${s.battersFacedLast30})`
          );
          rateOutOfRange++;
          continue;
        }

        errors.push(`Pitcher ${id}: ${field} = ${value} is out of range [${min}, ${max}]`);
        rateOutOfRange++;
      }
    }

    // K/BB ratio should equal strikeoutRate / walkRate (when both are non-null and walkRate > 0).
    // Tolerance of 0.05 accounts for floating-point rounding in upstream calculations
    // (e.g. rates stored as rounded percentages before computing the ratio).
    if (
      s.kToBBRatioLast30 !== null &&
      s.strikeoutRateLast30 !== null &&
      s.walkRateLast30 !== null &&
      s.walkRateLast30 > 0
    ) {
      const expectedKBB = s.strikeoutRateLast30 / s.walkRateLast30;
      if (Math.abs(s.kToBBRatioLast30 - expectedKBB) > 0.05) {
        errors.push(
          `Pitcher ${id}: K/BB (${s.kToBBRatioLast30.toFixed(2)}) ≠ K% / BB% (${expectedKBB.toFixed(2)})`
        );
        formulaMismatch++;
      }
    }

    // Window monotonicity for appearances
    if (
      s.appearancesLast30 < s.appearancesLast14 ||
      s.appearancesLast14 < s.appearancesLast7
    ) {
      errors.push(
        `Pitcher ${id}: non-monotonic appearance windows: 30d=${s.appearancesLast30}, 14d=${s.appearancesLast14}, 7d=${s.appearancesLast7}`
      );
      windowNotMonotonic++;
    }

    // Window monotonicity for innings pitched
    if (
      s.inningsPitchedLast30 < s.inningsPitchedLast14 ||
      s.inningsPitchedLast14 < s.inningsPitchedLast7
    ) {
      errors.push(
        `Pitcher ${id}: non-monotonic IP windows: 30d=${s.inningsPitchedLast30}, 14d=${s.inningsPitchedLast14}, 7d=${s.inningsPitchedLast7}`
      );
      windowNotMonotonic++;
    }

    // Window monotonicity for batters faced
    if (
      s.battersFacedLast30 < s.battersFacedLast14 ||
      s.battersFacedLast14 < s.battersFacedLast7
    ) {
      errors.push(
        `Pitcher ${id}: non-monotonic BF windows: 30d=${s.battersFacedLast30}, 14d=${s.battersFacedLast14}, 7d=${s.battersFacedLast7}`
      );
      windowNotMonotonic++;
    }
  }

  if (rateOutOfRange > 0) {
    warnings.push(`${rateOutOfRange} pitcher rate-out-of-range issue(s) detected`);
  }
  if (formulaMismatch > 0) {
    warnings.push(`${formulaMismatch} pitcher K/BB formula mismatch(es) detected`);
  }
  if (windowNotMonotonic > 0) {
    warnings.push(`${windowNotMonotonic} pitcher window monotonicity violation(s) detected`);
  }

  return {
    stage: 'pitcher_derived_rates',
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

// ============================================================================
// Top-Level Orchestrator
// ============================================================================

export interface PipelineRunInputs {
  hitterIngestion: IngestionRunStats;
  pitcherIngestion: IngestionRunStats;
  hitterDerived: DerivedRunStats;
  pitcherDerived: DerivedRunStats;
  derivedSamples?: DerivedRateSample[];
  pitcherDerivedSamples?: PitcherDerivedRateSample[];
  /** Set to true when no verified hitters exist – skips hitter validation stages. */
  skipHitterStages?: boolean;
  /** Set to true when no verified pitchers exist – skips pitcher validation stages. */
  skipPitcherStages?: boolean;
}

/**
 * Validate the full automated pipeline run.
 *
 * Runs all stage validators and returns a consolidated result.
 * A run is "valid" only when every stage passes (no errors).
 */
export function validatePipelineRun(inputs: PipelineRunInputs): PipelineValidationResult {
  const stages: PipelineStageResult[] = [];

  if (inputs.skipHitterStages) {
    stages.push({ stage: 'hitter_ingestion', valid: true, warnings: ['Skipped: no verified hitters in the system'], errors: [] });
    stages.push({ stage: 'hitter_derived_stats', valid: true, warnings: ['Skipped: no verified hitters in the system'], errors: [] });
  } else {
    stages.push(validateIngestionResult(inputs.hitterIngestion, 'hitter_ingestion'));
    stages.push(validateDerivedStatsResult(inputs.hitterDerived, 'hitter_derived_stats'));
  }

  if (inputs.skipPitcherStages) {
    stages.push({ stage: 'pitcher_ingestion', valid: true, warnings: ['Skipped: no verified pitchers in the system'], errors: [] });
    stages.push({ stage: 'pitcher_derived_stats', valid: true, warnings: ['Skipped: no verified pitchers in the system'], errors: [] });
  } else {
    stages.push(validateIngestionResult(inputs.pitcherIngestion, 'pitcher_ingestion'));
    stages.push(validateDerivedStatsResult(inputs.pitcherDerived, 'pitcher_derived_stats'));
  }

  if (inputs.derivedSamples && inputs.derivedSamples.length > 0) {
    stages.push(validateDerivedRates(inputs.derivedSamples));
  }

  if (inputs.pitcherDerivedSamples && inputs.pitcherDerivedSamples.length > 0) {
    stages.push(validatePitcherDerivedRates(inputs.pitcherDerivedSamples));
  }

  const valid = stages.every((s) => s.valid);

  const passCount = stages.filter((s) => s.valid).length;
  const failCount = stages.filter((s) => !s.valid).length;
  const warnCount = stages.reduce((n, s) => n + s.warnings.length, 0);

  const summary = valid
    ? `All ${passCount} pipeline stages passed${warnCount > 0 ? ` (${warnCount} warning(s))` : ''}`
    : `${failCount} of ${stages.length} pipeline stage(s) failed`;

  return { valid, stages, summary };
}
