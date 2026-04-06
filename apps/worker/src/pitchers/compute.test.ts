import { describe, expect, it } from 'vitest';
import { computePitcherDerivedFeatures, type PitcherDerivedFeatures, type RawPitcherStats } from './derived.js';
import { scorePitcher } from './compute.js';
import { simulatePitcherOutcome } from './monte-carlo.js';
import { parseInningsPitched } from './gameLogs.js';

const referenceDate = new Date('2025-08-10T00:00:00.000Z');

const baseRawStats: RawPitcherStats[] = [
  {
    statDate: new Date('2025-08-08T00:00:00.000Z'),
    gamesPlayed: 1,
    gamesStarted: 1,
    gamesFinished: 0,
    gamesSaved: 0,
    holds: 0,
    inningsPitched: 6 + (2 / 3),
    battersFaced: 26,
    hitsAllowed: 4,
    runsAllowed: 2,
    earnedRuns: 2,
    walks: 1,
    strikeouts: 7,
    homeRunsAllowed: 1,
    hitByPitch: 0,
    pitches: null,
    strikes: null,
    firstPitchStrikes: null,
    swingingStrikes: null,
    groundBalls: null,
    flyBalls: null,
  },
  {
    statDate: new Date('2025-08-03T00:00:00.000Z'),
    gamesPlayed: 1,
    gamesStarted: 1,
    gamesFinished: 0,
    gamesSaved: 0,
    holds: 0,
    inningsPitched: 5 + (1 / 3),
    battersFaced: 24,
    hitsAllowed: 5,
    runsAllowed: 1,
    earnedRuns: 1,
    walks: 2,
    strikeouts: 6,
    homeRunsAllowed: 0,
    hitByPitch: 0,
    pitches: null,
    strikes: null,
    firstPitchStrikes: null,
    swingingStrikes: null,
    groundBalls: null,
    flyBalls: null,
  },
];

function makeFeatures(overrides: Partial<PitcherDerivedFeatures> = {}): PitcherDerivedFeatures {
  return {
    playerId: 'pitcher-1',
    playerMlbamId: '123456',
    season: 2025,
    computedAt: new Date('2025-08-10T00:00:00.000Z'),
    volume: {
      appearancesLast7: 2,
      appearancesLast14: 4,
      appearancesLast30: 5,
      inningsPitchedLast7: 12,
      inningsPitchedLast14: 24,
      inningsPitchedLast30: 30,
      battersFacedLast7: 48,
      battersFacedLast14: 96,
      battersFacedLast30: 120,
      gamesSavedLast30: 0,
      gamesStartedLast30: 5,
      pitchesPerInning: 15.5,
      daysSinceLastAppearance: 2,
    },
    rates: {
      eraLast30: 3.1,
      whipLast30: 1.05,
      fipLast30: 3.3,
      xfipLast30: 3.45,
      strikeoutRateLast30: 0.285,
      walkRateLast30: 0.065,
      kToBBRatioLast30: 4.4,
      swingingStrikeRate: 0.13,
      firstPitchStrikeRate: 0.64,
      avgVelocity: null,
      gbRatio: 1.2,
      hrPer9: 0.8,
    },
    stabilization: {
      eraReliable: true,
      whipReliable: true,
      fipReliable: true,
      kRateReliable: true,
      bbRateReliable: false,
      battersToReliable: 30,
    },
    volatility: {
      qualityStartRate: 0.6,
      blowUpRate: 0.1,
      eraVolatility: 1.1,
      consistencyScore: 72,
    },
    context: {
      opponentOps: null,
      parkFactor: null,
      isHome: null,
      isCloser: false,
      scheduledStartNext7: false,
      opponentNextStart: null,
    },
    ...overrides,
  };
}

describe('pitcher pipeline helpers', () => {
  it('parses baseball innings notation correctly', () => {
    expect(parseInningsPitched('5.1')).toBeCloseTo(5 + (1 / 3), 5);
    expect(parseInningsPitched('5.2')).toBeCloseTo(5 + (2 / 3), 5);
    expect(parseInningsPitched(6.1)).toBeCloseTo(6 + (1 / 3), 5);
  });

  it('preserves null advanced metrics and uses the provided reference date', () => {
    const derived = computePitcherDerivedFeatures(
      'pitcher-1',
      '123456',
      2025,
      baseRawStats,
      referenceDate
    );

    expect(derived.volume.daysSinceLastAppearance).toBe(2);
    expect(derived.volume.pitchesPerInning).toBeNull();
    expect(derived.rates.swingingStrikeRate).toBeNull();
    expect(derived.rates.firstPitchStrikeRate).toBeNull();
    expect(derived.rates.gbRatio).toBeNull();
  });

  it('classifies closer roles correctly and produces deterministic simulations for the same seed', () => {
    const closerFeatures = makeFeatures({
      volume: {
        ...makeFeatures().volume,
        appearancesLast30: 10,
        inningsPitchedLast30: 11,
        battersFacedLast30: 44,
        gamesSavedLast30: 8,
        gamesStartedLast30: 0,
      },
      context: {
        ...makeFeatures().context,
        isCloser: true,
      },
    });

    const closerScore = scorePitcher(closerFeatures);
    expect(closerScore.role.currentRole).toBe('CL');
    expect(closerScore.role.isCloser).toBe(true);

    const sim1 = simulatePitcherOutcome(closerFeatures, closerScore, {
      runs: 600,
      horizon: 'week',
      randomSeed: 4242,
    });
    const sim2 = simulatePitcherOutcome(closerFeatures, closerScore, {
      runs: 600,
      horizon: 'week',
      randomSeed: 4242,
    });

    expect(sim1.expectedValue).toBe(sim2.expectedValue);
    expect(sim1.p50).toBe(sim2.p50);
    expect(sim1.p90).toBe(sim2.p90);
  });
});
