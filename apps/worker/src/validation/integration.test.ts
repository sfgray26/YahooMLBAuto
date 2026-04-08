/**
 * Pipeline Integration Test
 *
 * Validates the full validation pipeline end-to-end using a minimal fixture
 * dataset.  Every test is pure (no DB, no network) and runs in CI.
 *
 * Goals:
 * 1. Invalid inputs fail fast with clear, actionable error messages.
 * 2. Valid inputs pass every validation stage and produce outputs that contain
 *    all required fields (seed, provenance, percentiles, etc.).
 * 3. Monte Carlo simulation produces deterministic, reproducible results when
 *    a fixed seed is supplied.
 */

import { describe, expect, it } from 'vitest';
import {
  validateGameLogRow,
  detectDuplicateGameLogs,
  validatePlayerRecord,
  validateSlate,
  validateDerivedFeatures,
  detectMismatchedJoins,
  validateMonteCarloInputs,
  validateMonteCarloOutputs,
  type GameLogRowInput,
  type DerivedFeaturesInput,
} from './schema.js';
import { validatePipelineRun, type PipelineRunInputs } from './pipeline.js';
import { simulatePlayerOutcome } from '../monte-carlo/simulate.js';
import type { PlayerScore } from '../scoring/compute.js';

// ============================================================================
// Minimal fixture dataset
// ============================================================================

const FIXTURE_PLAYERS = [
  { playerId: 'mlbam:660271', playerMlbamId: '660271', name: 'Mookie Betts', positions: ['OF'] },
  { playerId: 'mlbam:592450', playerMlbamId: '592450', name: 'William Contreras', positions: ['C'] },
  { playerId: 'mlbam:605447', playerMlbamId: '605447', name: 'Corbin Carroll', positions: ['OF'] },
];

const FIXTURE_GAME_LOGS: GameLogRowInput[] = [
  {
    playerMlbamId: '660271',
    gamePk: 'gp-001',
    gameDate: new Date('2025-06-10T19:00:00Z'),
    season: 2025,
    stats: {
      atBats: 4, runs: 1, hits: 2, doubles: 1, triples: 0, homeRuns: 0,
      rbi: 1, stolenBases: 0, caughtStealing: 0, walks: 1, strikeouts: 1,
      hitByPitch: 0, sacrificeFlies: 0, plateAppearances: 5, totalBases: 3, gamesPlayed: 1,
    },
  },
  {
    playerMlbamId: '592450',
    gamePk: 'gp-002',
    gameDate: new Date('2025-06-10T20:00:00Z'),
    season: 2025,
    stats: {
      atBats: 3, runs: 0, hits: 1, doubles: 0, triples: 0, homeRuns: 0,
      rbi: 0, stolenBases: 0, caughtStealing: 0, walks: 0, strikeouts: 2,
      hitByPitch: 0, sacrificeFlies: 0, plateAppearances: 3, totalBases: 1, gamesPlayed: 1,
    },
  },
  {
    playerMlbamId: '605447',
    gamePk: 'gp-003',
    gameDate: new Date('2025-06-10T18:00:00Z'),
    season: 2025,
    stats: {
      atBats: 4, runs: 2, hits: 3, doubles: 1, triples: 1, homeRuns: 0,
      rbi: 2, stolenBases: 1, caughtStealing: 0, walks: 0, strikeouts: 0,
      hitByPitch: 0, sacrificeFlies: 0, plateAppearances: 4, totalBases: 6, gamesPlayed: 1,
    },
  },
];

const FIXTURE_DERIVED: DerivedFeaturesInput[] = [
  {
    playerId: 'mlbam:660271',
    playerMlbamId: '660271',
    season: 2025,
    volume: { gamesLast7: 6, gamesLast14: 13, gamesLast30: 26, plateAppearancesLast7: 26, plateAppearancesLast14: 56, plateAppearancesLast30: 110, atBatsLast30: 95 },
    rates: { battingAverageLast30: 0.305, onBasePctLast30: 0.385, sluggingPctLast30: 0.580, opsLast30: 0.965, isoLast30: 0.275, walkRateLast30: 0.105, strikeoutRateLast30: 0.190, babipLast30: 0.335 },
  },
  {
    playerId: 'mlbam:592450',
    playerMlbamId: '592450',
    season: 2025,
    volume: { gamesLast7: 5, gamesLast14: 11, gamesLast30: 22, plateAppearancesLast7: 20, plateAppearancesLast14: 44, plateAppearancesLast30: 88, atBatsLast30: 78 },
    rates: { battingAverageLast30: 0.282, onBasePctLast30: 0.340, sluggingPctLast30: 0.450, opsLast30: 0.790, isoLast30: 0.168, walkRateLast30: 0.082, strikeoutRateLast30: 0.215, babipLast30: 0.305 },
  },
  {
    playerId: 'mlbam:605447',
    playerMlbamId: '605447',
    season: 2025,
    volume: { gamesLast7: 7, gamesLast14: 14, gamesLast30: 27, plateAppearancesLast7: 30, plateAppearancesLast14: 62, plateAppearancesLast30: 118, atBatsLast30: 105 },
    rates: { battingAverageLast30: 0.295, onBasePctLast30: 0.362, sluggingPctLast30: 0.486, opsLast30: 0.848, isoLast30: 0.191, walkRateLast30: 0.093, strikeoutRateLast30: 0.178, babipLast30: 0.318 },
  },
];

// ============================================================================
// Helper: mock PlayerScore for MC simulation
// ============================================================================

function makeMockScore(overallValue: number): PlayerScore {
  return {
    playerId: 'test',
    playerMlbamId: 'test',
    season: 2025,
    scoredAt: new Date(),
    overallValue,
    components: {
      hitting: overallValue,
      power: overallValue,
      speed: 55,
      plateDiscipline: 60,
      consistency: 65,
      opportunity: 70,
    },
    confidence: 0.85,
    reliability: { sampleSize: 'adequate', gamesToReliable: 0, statsReliable: true },
    explanation: { summary: '', strengths: [], concerns: [], keyStats: {} },
    inputs: { derivedFeaturesVersion: '1', computedAt: new Date() },
  };
}

// ============================================================================
// Integration Test: Invalid inputs fail fast
// ============================================================================

describe('Integration: invalid inputs fail fast', () => {
  it('game log with negative home runs produces a validation error', () => {
    const badLog: GameLogRowInput = {
      ...FIXTURE_GAME_LOGS[0],
      stats: { ...FIXTURE_GAME_LOGS[0].stats, homeRuns: -5 },
    };
    const result = validateGameLogRow(badLog);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('homeRuns'))).toBe(true);
  });

  it('game log with plateAppearances < atBats produces a validation error', () => {
    const badLog: GameLogRowInput = {
      ...FIXTURE_GAME_LOGS[0],
      stats: { ...FIXTURE_GAME_LOGS[0].stats, atBats: 10, plateAppearances: 5 },
    };
    const result = validateGameLogRow(badLog);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('plateAppearances'))).toBe(true);
  });

  it('duplicated game log entry is detected', () => {
    const duplicates = [FIXTURE_GAME_LOGS[0], FIXTURE_GAME_LOGS[0]];
    const result = detectDuplicateGameLogs(duplicates);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('player record with non-numeric MLBAM ID fails validation', () => {
    const result = validatePlayerRecord({
      playerId: 'mlbam:abc',
      playerMlbamId: 'abc',
      name: 'Ghost Player',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('numeric'))).toBe(true);
  });

  it('derived features record with non-monotonic windows fails', () => {
    const bad: DerivedFeaturesInput = {
      ...FIXTURE_DERIVED[0],
      volume: {
        ...FIXTURE_DERIVED[0].volume,
        gamesLast30: 5,  // 30d < 14d — invalid
        gamesLast14: 13,
      },
    };
    const result = validateDerivedFeatures(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-monotonic games'))).toBe(true);
  });

  it('derived features record with invalid BA rate fails', () => {
    const bad: DerivedFeaturesInput = {
      ...FIXTURE_DERIVED[0],
      rates: { ...FIXTURE_DERIVED[0].rates, battingAverageLast30: 1.8 },
    };
    const result = validateDerivedFeatures(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('battingAverageLast30'))).toBe(true);
  });

  it('slate with start > end fails', () => {
    const result = validateSlate({ startDate: '2025-06-20', endDate: '2025-06-10' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('after'))).toBe(true);
  });
});

// ============================================================================
// Integration Test: Valid inputs pass all stages
// ============================================================================

describe('Integration: valid fixture dataset passes all stages', () => {
  it('all fixture game logs pass row-level validation', () => {
    for (const log of FIXTURE_GAME_LOGS) {
      const result = validateGameLogRow(log);
      expect(result.valid).toBe(true);
    }
  });

  it('no duplicate game logs in fixture set', () => {
    const result = detectDuplicateGameLogs(FIXTURE_GAME_LOGS);
    expect(result.valid).toBe(true);
  });

  it('all fixture players pass player record validation', () => {
    for (const p of FIXTURE_PLAYERS) {
      const result = validatePlayerRecord(p);
      expect(result.valid).toBe(true);
    }
  });

  it('all fixture derived records pass derived features validation', () => {
    for (const d of FIXTURE_DERIVED) {
      const result = validateDerivedFeatures(d);
      expect(result.valid).toBe(true);
    }
  });

  it('no join mismatches between game logs and derived features', () => {
    const result = detectMismatchedJoins(
      FIXTURE_GAME_LOGS,
      FIXTURE_DERIVED,
      'game_logs',
      'derived_features'
    );
    expect(result.valid).toBe(true);
  });

  it('valid slate for the fixture week', () => {
    const result = validateSlate({
      startDate: '2025-06-09',
      endDate: '2025-06-15',
      timezone: 'America/New_York',
    });
    expect(result.valid).toBe(true);
  });

  it('pipeline-level validation passes on good aggregate stats', () => {
    const inputs: PipelineRunInputs = {
      hitterIngestion: { totalPlayers: 3, totalGames: 9, errors: [] },
      pitcherIngestion: { totalPlayers: 1, totalGames: 1, errors: [] },
      hitterDerived: { processed: 3, errors: [] },
      pitcherDerived: { processed: 1, errors: [] },
    };
    const result = validatePipelineRun(inputs);
    expect(result.valid).toBe(true);
    expect(result.summary).toMatch(/All \d+ pipeline stages passed/);
  });
});

// ============================================================================
// Integration Test: Monte Carlo reproducibility & output fields
// ============================================================================

describe('Integration: Monte Carlo simulation', () => {
  const mockDerived = {
    playerId: 'mlbam:660271',
    playerMlbamId: '660271',
    season: 2025,
    volume: { plateAppearancesLast7: 26, plateAppearancesLast30: 110, gamesLast7: 6, gamesLast30: 26 },
    rates: { opsLast30: 0.965, onBasePctLast30: 0.385, isoLast30: 0.275, battingAverageLast30: 0.305, walkRateLast30: 0.105, strikeoutRateLast30: 0.190 },
    volatility: { productionVolatility: 0.85, hitConsistencyScore: 72 },
  } as Parameters<typeof simulatePlayerOutcome>[0];

  it('returns deterministic results with a fixed seed', () => {
    const config = { runs: 1_000, horizon: 'daily' as const, randomSeed: 42 };
    const r1 = simulatePlayerOutcome(mockDerived, makeMockScore(72), config);
    const r2 = simulatePlayerOutcome(mockDerived, makeMockScore(72), config);
    expect(r1.expectedValue).toBeCloseTo(r2.expectedValue, 10);
    expect(r1.p10).toBeCloseTo(r2.p10, 10);
    expect(r1.p90).toBeCloseTo(r2.p90, 10);
  });

  it('output contains all required distribution fields', () => {
    const result = simulatePlayerOutcome(mockDerived, makeMockScore(72), {
      runs: 500,
      horizon: 'daily',
      randomSeed: 99,
    });
    expect(result).toHaveProperty('playerId');
    expect(result).toHaveProperty('playerMlbamId');
    expect(result).toHaveProperty('expectedValue');
    expect(result).toHaveProperty('median');
    expect(result).toHaveProperty('p10');
    expect(result).toHaveProperty('p25');
    expect(result).toHaveProperty('p50');
    expect(result).toHaveProperty('p75');
    expect(result).toHaveProperty('p90');
    expect(result).toHaveProperty('downsideRisk');
    expect(result).toHaveProperty('upsidePotential');
    expect(result).toHaveProperty('simulationNotes');
    expect(result).toHaveProperty('runMetadata');
  });

  it('runMetadata contains seed, trialCount, horizon, and timestamp', () => {
    const result = simulatePlayerOutcome(mockDerived, makeMockScore(72), {
      runs: 500,
      horizon: 'daily',
      randomSeed: 77,
    });
    const meta = result.runMetadata;
    expect(meta.seed).toBe(77);
    expect(meta.trialCount).toBe(500);
    expect(meta.horizon).toBe('daily');
    expect(typeof meta.runTimestamp).toBe('string');
    expect(() => new Date(meta.runTimestamp)).not.toThrow();
  });

  it('simulationNotes includes a run-metadata line', () => {
    const result = simulatePlayerOutcome(mockDerived, makeMockScore(72), {
      runs: 500,
      horizon: 'daily',
      randomSeed: 42,
    });
    const metaNote = result.simulationNotes.find((n) => n.startsWith('Run metadata:'));
    expect(metaNote).toBeDefined();
    expect(metaNote).toContain('seed=42');
    expect(metaNote).toContain('trials=500');
  });

  it('percentiles are ordered: p10 ≤ p50 ≤ p90', () => {
    const result = simulatePlayerOutcome(mockDerived, makeMockScore(72), {
      runs: 2_000,
      horizon: 'daily',
      randomSeed: 1234,
    });
    expect(result.p10).toBeLessThanOrEqual(result.p50);
    expect(result.p50).toBeLessThanOrEqual(result.p90);
  });

  it('MC output validation passes for well-formed simulation output', () => {
    const result = simulatePlayerOutcome(mockDerived, makeMockScore(72), {
      runs: 1_000,
      horizon: 'daily',
      randomSeed: 42,
    });
    const validationResult = validateMonteCarloOutputs([
      {
        playerId: result.playerId,
        playerMlbamId: result.playerMlbamId,
        runs: result.runs,
        expectedValue: result.expectedValue,
        p10: result.p10,
        p50: result.p50,
        p90: result.p90,
        seed: result.runMetadata.seed,
      },
    ]);
    expect(validationResult.valid).toBe(true);
  });
});
