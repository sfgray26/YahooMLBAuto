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

/** Minimal derived stat shape needed for rate validation. */
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

// ============================================================================
// Top-Level Orchestrator
// ============================================================================

export interface PipelineRunInputs {
  hitterIngestion: IngestionRunStats;
  pitcherIngestion: IngestionRunStats;
  hitterDerived: DerivedRunStats;
  pitcherDerived: DerivedRunStats;
  derivedSamples?: DerivedRateSample[];
}

/**
 * Validate the full automated pipeline run.
 *
 * Runs all stage validators and returns a consolidated result.
 * A run is "valid" only when every stage passes (no errors).
 */
export function validatePipelineRun(inputs: PipelineRunInputs): PipelineValidationResult {
  const stages: PipelineStageResult[] = [
    validateIngestionResult(inputs.hitterIngestion, 'hitter_ingestion'),
    validateIngestionResult(inputs.pitcherIngestion, 'pitcher_ingestion'),
    validateDerivedStatsResult(inputs.hitterDerived, 'hitter_derived_stats'),
    validateDerivedStatsResult(inputs.pitcherDerived, 'pitcher_derived_stats'),
  ];

  if (inputs.derivedSamples && inputs.derivedSamples.length > 0) {
    stages.push(validateDerivedRates(inputs.derivedSamples));
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
