import { describe, expect, it } from 'vitest';
import {
  validateGameLogRow,
  validatePlayerRecord,
  validateSlate,
  validateDerivedFeatures,
  detectDuplicateGameLogs,
  detectMismatchedJoins,
  validateMonteCarloInputs,
  validateMonteCarloOutputs,
  type GameLogRowInput,
  type PlayerRecordInput,
  type DerivedFeaturesInput,
  type MonteCarloInputRecord,
  type MonteCarloOutputRecord,
} from './schema.js';

// ============================================================================
// Helpers
// ============================================================================

function goodGameLog(overrides: Partial<GameLogRowInput> = {}): GameLogRowInput {
  return {
    playerMlbamId: '592450',
    gamePk: 'gp-001',
    gameDate: new Date('2025-06-15T19:00:00Z'),
    season: 2025,
    stats: {
      atBats: 4,
      runs: 1,
      hits: 2,
      doubles: 1,
      triples: 0,
      homeRuns: 0,
      rbi: 1,
      stolenBases: 0,
      caughtStealing: 0,
      walks: 1,
      strikeouts: 1,
      hitByPitch: 0,
      sacrificeFlies: 0,
      plateAppearances: 5,
      totalBases: 3,
      gamesPlayed: 1,
    },
    ...overrides,
  };
}

function goodPlayer(overrides: Partial<PlayerRecordInput> = {}): PlayerRecordInput {
  return {
    playerId: 'mlbam:592450',
    playerMlbamId: '592450',
    name: 'Mookie Betts',
    positions: ['OF'],
    ...overrides,
  };
}

function goodDerived(overrides: Partial<DerivedFeaturesInput> = {}): DerivedFeaturesInput {
  return {
    playerId: 'mlbam:592450',
    playerMlbamId: '592450',
    season: 2025,
    volume: {
      gamesLast7: 6,
      gamesLast14: 13,
      gamesLast30: 26,
      plateAppearancesLast7: 26,
      plateAppearancesLast14: 56,
      plateAppearancesLast30: 110,
      atBatsLast30: 96,
    },
    rates: {
      battingAverageLast30: 0.310,
      onBasePctLast30: 0.390,
      sluggingPctLast30: 0.600,
      opsLast30: 0.990,
      isoLast30: 0.290,
      walkRateLast30: 0.110,
      strikeoutRateLast30: 0.185,
      babipLast30: 0.320,
    },
    ...overrides,
  };
}

function goodMCInput(overrides: Partial<MonteCarloInputRecord> = {}): MonteCarloInputRecord {
  return {
    playerId: 'mlbam:592450',
    playerMlbamId: '592450',
    overallValue: 72,
    confidence: 0.85,
    ...overrides,
  };
}

function goodMCOutput(overrides: Partial<MonteCarloOutputRecord> = {}): MonteCarloOutputRecord {
  return {
    playerId: 'mlbam:592450',
    playerMlbamId: '592450',
    runs: 10_000,
    expectedValue: 68.5,
    p10: 52.0,
    p50: 68.0,
    p90: 84.0,
    seed: 42,
    ...overrides,
  };
}

// ============================================================================
// validateGameLogRow
// ============================================================================

describe('validateGameLogRow', () => {
  it('passes for a well-formed game log', () => {
    const result = validateGameLogRow(goodGameLog());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when playerMlbamId is missing', () => {
    const result = validateGameLogRow(goodGameLog({ playerMlbamId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('playerMlbamId'))).toBe(true);
  });

  it('fails when gamePk is missing', () => {
    const result = validateGameLogRow(goodGameLog({ gamePk: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('gamePk'))).toBe(true);
  });

  it('fails when gameDate is invalid', () => {
    const result = validateGameLogRow(goodGameLog({ gameDate: 'not-a-date' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('gameDate'))).toBe(true);
  });

  it('fails when season is implausible (too old)', () => {
    const result = validateGameLogRow(goodGameLog({ season: 1800 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('season'))).toBe(true);
  });

  it('fails when a counting stat is negative', () => {
    const result = validateGameLogRow(
      goodGameLog({ stats: { ...goodGameLog().stats, homeRuns: -1 } })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('homeRuns'))).toBe(true);
  });

  it('fails when plateAppearances < atBats', () => {
    const result = validateGameLogRow(
      goodGameLog({ stats: { ...goodGameLog().stats, atBats: 5, plateAppearances: 3 } })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('plateAppearances'))).toBe(true);
  });

  it('fails when totalBases < hits', () => {
    const result = validateGameLogRow(
      goodGameLog({ stats: { ...goodGameLog().stats, hits: 4, totalBases: 2 } })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('totalBases'))).toBe(true);
  });

  it('fails when XBH exceeds total hits', () => {
    const result = validateGameLogRow(
      goodGameLog({
        stats: {
          ...goodGameLog().stats,
          hits: 1,
          doubles: 1,
          triples: 1, // doubles + triples + HR = 3 > hits
          homeRuns: 1,
        },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('XBH'))).toBe(true);
  });

  it('warns when gamesPlayed > 1 in a single game log', () => {
    const result = validateGameLogRow(
      goodGameLog({ stats: { ...goodGameLog().stats, gamesPlayed: 2 } })
    );
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('gamesPlayed'))).toBe(true);
  });

  it('tolerates a string gameDate in ISO format', () => {
    const result = validateGameLogRow(goodGameLog({ gameDate: '2025-06-15' }));
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// detectDuplicateGameLogs
// ============================================================================

describe('detectDuplicateGameLogs', () => {
  it('passes when all (playerMlbamId, gamePk) pairs are unique', () => {
    const rows = [
      { playerMlbamId: '111', gamePk: 'gp-1' },
      { playerMlbamId: '111', gamePk: 'gp-2' },
      { playerMlbamId: '222', gamePk: 'gp-1' },
    ];
    const result = detectDuplicateGameLogs(rows);
    expect(result.valid).toBe(true);
  });

  it('fails when duplicate (playerMlbamId, gamePk) pair is found', () => {
    const rows = [
      { playerMlbamId: '111', gamePk: 'gp-1' },
      { playerMlbamId: '111', gamePk: 'gp-1' }, // duplicate
    ];
    const result = detectDuplicateGameLogs(rows);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('111:gp-1'))).toBe(true);
  });
});

// ============================================================================
// validatePlayerRecord
// ============================================================================

describe('validatePlayerRecord', () => {
  it('passes for a well-formed player record', () => {
    const result = validatePlayerRecord(goodPlayer());
    expect(result.valid).toBe(true);
  });

  it('fails when playerId is missing', () => {
    const result = validatePlayerRecord(goodPlayer({ playerId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('playerId'))).toBe(true);
  });

  it('fails when playerMlbamId is missing', () => {
    const result = validatePlayerRecord(goodPlayer({ playerMlbamId: '' }));
    expect(result.valid).toBe(false);
  });

  it('fails when playerMlbamId is non-numeric', () => {
    const result = validatePlayerRecord(goodPlayer({ playerMlbamId: 'abc123' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('numeric'))).toBe(true);
  });

  it('warns when name is missing', () => {
    const result = validatePlayerRecord(goodPlayer({ name: '' }));
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('name'))).toBe(true);
  });

  it('warns on unrecognized position code', () => {
    const result = validatePlayerRecord(goodPlayer({ positions: ['ZZ'] }));
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('ZZ'))).toBe(true);
  });

  it('warns when positions array is empty', () => {
    const result = validatePlayerRecord(goodPlayer({ positions: [] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('empty'))).toBe(true);
  });

  it('accepts all standard position codes without warnings', () => {
    const positions = ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH'];
    for (const pos of positions) {
      const result = validatePlayerRecord(goodPlayer({ positions: [pos] }));
      expect(result.warnings.filter((w) => w.includes('position'))).toHaveLength(0);
    }
  });
});

// ============================================================================
// validateSlate
// ============================================================================

describe('validateSlate', () => {
  it('passes for a valid one-week slate', () => {
    const result = validateSlate({
      startDate: '2025-06-09',
      endDate: '2025-06-15',
      timezone: 'America/New_York',
    });
    expect(result.valid).toBe(true);
  });

  it('fails when startDate is invalid', () => {
    const result = validateSlate({ startDate: 'bad', endDate: '2025-06-15' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('startDate'))).toBe(true);
  });

  it('fails when endDate is invalid', () => {
    const result = validateSlate({ startDate: '2025-06-09', endDate: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('endDate'))).toBe(true);
  });

  it('fails when startDate is after endDate', () => {
    const result = validateSlate({ startDate: '2025-06-15', endDate: '2025-06-09' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('after'))).toBe(true);
  });

  it('warns when slate span exceeds 30 days', () => {
    const result = validateSlate({ startDate: '2025-01-01', endDate: '2025-04-01' });
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('unusually long'))).toBe(true);
  });

  it('fails on an unknown timezone', () => {
    const result = validateSlate({
      startDate: '2025-06-09',
      endDate: '2025-06-15',
      timezone: 'Not/AZone',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('timezone'))).toBe(true);
  });

  it('passes when no timezone is provided (UTC default)', () => {
    const result = validateSlate({ startDate: '2025-06-09', endDate: '2025-06-15' });
    expect(result.valid).toBe(true);
  });

  it('accepts Date objects as well as strings', () => {
    const result = validateSlate({
      startDate: new Date('2025-06-09'),
      endDate: new Date('2025-06-15'),
    });
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// validateDerivedFeatures
// ============================================================================

describe('validateDerivedFeatures', () => {
  it('passes for a well-formed derived features record', () => {
    const result = validateDerivedFeatures(goodDerived());
    expect(result.valid).toBe(true);
  });

  it('fails when playerId is missing', () => {
    const result = validateDerivedFeatures(goodDerived({ playerId: '' }));
    expect(result.valid).toBe(false);
  });

  it('fails when a volume field is negative', () => {
    const result = validateDerivedFeatures(
      goodDerived({
        volume: { ...goodDerived().volume, gamesLast7: -1 },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('gamesLast7'))).toBe(true);
  });

  it('fails when game windows are not monotonic', () => {
    const result = validateDerivedFeatures(
      goodDerived({
        volume: { ...goodDerived().volume, gamesLast30: 10, gamesLast14: 12 },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-monotonic games'))).toBe(true);
  });

  it('fails when PA windows are not monotonic', () => {
    const result = validateDerivedFeatures(
      goodDerived({
        volume: {
          ...goodDerived().volume,
          plateAppearancesLast30: 40,
          plateAppearancesLast14: 56,
        },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-monotonic PA'))).toBe(true);
  });

  it('fails when atBatsLast30 > plateAppearancesLast30', () => {
    const result = validateDerivedFeatures(
      goodDerived({
        volume: { ...goodDerived().volume, atBatsLast30: 200, plateAppearancesLast30: 110 },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('atBatsLast30'))).toBe(true);
  });

  it('fails when a rate stat is out of range', () => {
    const result = validateDerivedFeatures(
      goodDerived({
        rates: { ...goodDerived().rates, battingAverageLast30: 1.5 },
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('battingAverageLast30'))).toBe(true);
  });

  it('tolerates null rate fields', () => {
    const result = validateDerivedFeatures(
      goodDerived({
        rates: {
          battingAverageLast30: null,
          onBasePctLast30: null,
          sluggingPctLast30: null,
          opsLast30: null,
          isoLast30: null,
          walkRateLast30: null,
          strikeoutRateLast30: null,
          babipLast30: null,
        },
      })
    );
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// detectMismatchedJoins
// ============================================================================

describe('detectMismatchedJoins', () => {
  it('passes when every setB ID has a matching setA entry', () => {
    const setA = [{ playerMlbamId: '111' }, { playerMlbamId: '222' }];
    const setB = [{ playerMlbamId: '111' }, { playerMlbamId: '222' }];
    const result = detectMismatchedJoins(setA, setB, 'game_logs', 'derived');
    expect(result.valid).toBe(true);
  });

  it('fails when setB has an ID not present in setA', () => {
    const setA = [{ playerMlbamId: '111' }];
    const setB = [{ playerMlbamId: '111' }, { playerMlbamId: '999' }];
    const result = detectMismatchedJoins(setA, setB, 'game_logs', 'derived');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('999'))).toBe(true);
  });

  it('warns when setA has an ID not present in setB', () => {
    const setA = [{ playerMlbamId: '111' }, { playerMlbamId: '222' }];
    const setB = [{ playerMlbamId: '111' }];
    const result = detectMismatchedJoins(setA, setB, 'game_logs', 'derived');
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('222'))).toBe(true);
  });
});

// ============================================================================
// validateMonteCarloInputs
// ============================================================================

describe('validateMonteCarloInputs', () => {
  it('passes for valid MC inputs', () => {
    const result = validateMonteCarloInputs([goodMCInput()]);
    expect(result.valid).toBe(true);
  });

  it('warns when no records are provided', () => {
    const result = validateMonteCarloInputs([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('no input records'))).toBe(true);
  });

  it('fails when overallValue is out of range', () => {
    const result = validateMonteCarloInputs([goodMCInput({ overallValue: 150 })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('overallValue'))).toBe(true);
  });

  it('fails when confidence is out of range', () => {
    const result = validateMonteCarloInputs([goodMCInput({ confidence: 2.0 })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('fails when playerId is missing', () => {
    const result = validateMonteCarloInputs([goodMCInput({ playerId: '' })]);
    expect(result.valid).toBe(false);
  });
});

// ============================================================================
// validateMonteCarloOutputs
// ============================================================================

describe('validateMonteCarloOutputs', () => {
  it('passes for valid MC outputs', () => {
    const result = validateMonteCarloOutputs([goodMCOutput()]);
    expect(result.valid).toBe(true);
  });

  it('warns when no records are provided', () => {
    const result = validateMonteCarloOutputs([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('no output records'))).toBe(true);
  });

  it('fails when p10 > p50', () => {
    const result = validateMonteCarloOutputs([goodMCOutput({ p10: 80, p50: 68 })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('p10'))).toBe(true);
  });

  it('fails when p50 > p90', () => {
    const result = validateMonteCarloOutputs([goodMCOutput({ p50: 90, p90: 84 })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('p50'))).toBe(true);
  });

  it('fails when runs is less than 1', () => {
    const result = validateMonteCarloOutputs([goodMCOutput({ runs: 0 })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('runs'))).toBe(true);
  });

  it('warns when seed is 0', () => {
    const result = validateMonteCarloOutputs([goodMCOutput({ seed: 0 })]);
    expect(result.valid).toBe(true); // warning only
    expect(result.warnings.some((w) => w.includes('seed'))).toBe(true);
  });

  it('fails when expectedValue is negative', () => {
    const result = validateMonteCarloOutputs([goodMCOutput({ expectedValue: -5 })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('expectedValue'))).toBe(true);
  });
});
