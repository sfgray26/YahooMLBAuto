import { describe, expect, it } from 'vitest';
import {
  validateIngestionResult,
  validateDerivedStatsResult,
  validateDerivedRates,
  validatePipelineRun,
  type DerivedRateSample,
  type IngestionRunStats,
  type DerivedRunStats,
} from './pipeline.js';

// ============================================================================
// Helpers
// ============================================================================

const goodHitterIngestion: IngestionRunStats = {
  totalPlayers: 200,
  totalGames: 1400,
  errors: [],
};

const goodDerived: DerivedRunStats = {
  processed: 190,
  errors: [],
};

const baseSample: DerivedRateSample = {
  playerMlbamId: '592450',
  battingAverageLast30: 0.310,
  onBasePctLast30: 0.390,
  sluggingPctLast30: 0.600,
  opsLast30: 0.990,
  isoLast30: 0.290,
  walkRateLast30: 0.110,
  strikeoutRateLast30: 0.185,
  gamesLast7: 6,
  gamesLast14: 12,
  gamesLast30: 24,
  plateAppearancesLast7: 26,
  plateAppearancesLast14: 52,
  plateAppearancesLast30: 104,
};

// ============================================================================
// validateIngestionResult
// ============================================================================

describe('validateIngestionResult', () => {
  it('passes when ingestion has players and games with no errors', () => {
    const result = validateIngestionResult(goodHitterIngestion);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when zero players were processed', () => {
    const result = validateIngestionResult({ totalPlayers: 0, totalGames: 0, errors: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No players processed during ingestion');
  });

  it('warns when players exist but no games are stored (pre-season)', () => {
    const result = validateIngestionResult({ totalPlayers: 5, totalGames: 0, errors: [] });
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('No game logs stored'))).toBe(true);
  });

  it('fails when error rate exceeds 50%', () => {
    const result = validateIngestionResult({
      totalPlayers: 10,
      totalGames: 30,
      errors: Array(6).fill('API error'),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('High ingestion error rate'))).toBe(true);
  });

  it('warns when error rate is between 10% and 50%', () => {
    const result = validateIngestionResult({
      totalPlayers: 10,
      totalGames: 50,
      errors: Array(2).fill('API error'),
    });
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('Elevated ingestion error rate'))).toBe(true);
  });

  it('uses the provided label in the stage name', () => {
    const result = validateIngestionResult(goodHitterIngestion, 'pitcher_ingestion');
    expect(result.stage).toBe('pitcher_ingestion');
  });
});

// ============================================================================
// validateDerivedStatsResult
// ============================================================================

describe('validateDerivedStatsResult', () => {
  it('passes when derived stats are computed with no errors', () => {
    const result = validateDerivedStatsResult(goodDerived);
    expect(result.valid).toBe(true);
  });

  it('fails when nothing was processed', () => {
    const result = validateDerivedStatsResult({ processed: 0, errors: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No derived stats were computed');
  });

  it('fails when error rate exceeds 50%', () => {
    const result = validateDerivedStatsResult({
      processed: 10,
      errors: Array(6).fill('compute error'),
    });
    expect(result.valid).toBe(false);
  });

  it('warns when error rate is between 10% and 50%', () => {
    const result = validateDerivedStatsResult({
      processed: 10,
      errors: Array(2).fill('compute error'),
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Elevated'))).toBe(true);
  });
});

// ============================================================================
// validateDerivedRates
// ============================================================================

describe('validateDerivedRates', () => {
  it('passes for a well-formed sample', () => {
    const result = validateDerivedRates([baseSample]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid with a warning when given an empty sample list', () => {
    const result = validateDerivedRates([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('No derived stats samples'))).toBe(true);
  });

  it('fails when a rate stat is out of range', () => {
    const bad: DerivedRateSample = { ...baseSample, battingAverageLast30: 1.5 };
    const result = validateDerivedRates([bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('battingAverageLast30'))).toBe(true);
  });

  it('fails when OPS does not equal OBP + SLG', () => {
    const bad: DerivedRateSample = {
      ...baseSample,
      opsLast30: 0.800, // expected ≈ 0.390 + 0.600 = 0.990
    };
    const result = validateDerivedRates([bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OPS'))).toBe(true);
  });

  it('fails when ISO does not equal SLG - AVG', () => {
    const bad: DerivedRateSample = {
      ...baseSample,
      isoLast30: 0.100, // expected ≈ 0.600 - 0.310 = 0.290
    };
    const result = validateDerivedRates([bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ISO'))).toBe(true);
  });

  it('fails when game windows are not monotonic', () => {
    const bad: DerivedRateSample = {
      ...baseSample,
      gamesLast30: 10,
      gamesLast14: 12, // 14d > 30d – invalid
      gamesLast7: 6,
    };
    const result = validateDerivedRates([bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-monotonic game windows'))).toBe(true);
  });

  it('fails when PA windows are not monotonic', () => {
    const bad: DerivedRateSample = {
      ...baseSample,
      plateAppearancesLast30: 40,
      plateAppearancesLast14: 52, // 14d > 30d – invalid
      plateAppearancesLast7: 26,
    };
    const result = validateDerivedRates([bad]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-monotonic PA windows'))).toBe(true);
  });

  it('tolerates null rate fields', () => {
    const nullRates: DerivedRateSample = {
      ...baseSample,
      battingAverageLast30: null,
      onBasePctLast30: null,
      sluggingPctLast30: null,
      opsLast30: null,
      isoLast30: null,
      walkRateLast30: null,
      strikeoutRateLast30: null,
    };
    const result = validateDerivedRates([nullRates]);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// validatePipelineRun
// ============================================================================

describe('validatePipelineRun', () => {
  const goodRun = {
    hitterIngestion: goodHitterIngestion,
    pitcherIngestion: { totalPlayers: 80, totalGames: 400, errors: [] },
    hitterDerived: goodDerived,
    pitcherDerived: { processed: 75, errors: [] },
  };

  it('returns valid when all stages pass', () => {
    const result = validatePipelineRun(goodRun);
    expect(result.valid).toBe(true);
    expect(result.summary).toMatch(/All \d+ pipeline stages passed/);
  });

  it('returns invalid when any stage fails', () => {
    const run = {
      ...goodRun,
      hitterIngestion: { totalPlayers: 0, totalGames: 0, errors: [] },
    };
    const result = validatePipelineRun(run);
    expect(result.valid).toBe(false);
    expect(result.summary).toMatch(/failed/);
  });

  it('includes derived rate validation when samples are provided', () => {
    const result = validatePipelineRun({ ...goodRun, derivedSamples: [baseSample] });
    const rateStage = result.stages.find((s) => s.stage === 'derived_rates');
    expect(rateStage).toBeDefined();
    expect(rateStage!.valid).toBe(true);
  });

  it('skips derived rate validation when no samples are provided', () => {
    const result = validatePipelineRun({ ...goodRun });
    const rateStage = result.stages.find((s) => s.stage === 'derived_rates');
    expect(rateStage).toBeUndefined();
  });

  it('exposes failing stage details', () => {
    const run = {
      ...goodRun,
      hitterDerived: { processed: 0, errors: [] },
    };
    const result = validatePipelineRun(run);
    const failedStage = result.stages.find((s) => s.stage === 'hitter_derived_stats');
    expect(failedStage?.valid).toBe(false);
    expect(failedStage?.errors).toContain('No derived stats were computed');
  });
});
