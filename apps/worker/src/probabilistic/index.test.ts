import { describe, expect, it } from 'vitest';
import { simulatePlayerOutcomes } from './index.js';
import type { PlayerScore } from '../scoring/compute.js';

const baseScore: PlayerScore = {
  playerId: 'player-1',
  playerMlbamId: '123456',
  season: 2025,
  scoredAt: new Date('2025-08-01T00:00:00.000Z'),
  overallValue: 68,
  components: {
    hitting: 72,
    power: 66,
    speed: 50,
    plateDiscipline: 61,
    consistency: 64,
    opportunity: 70,
  },
  confidence: 0.82,
  reliability: {
    sampleSize: 'large',
    gamesToReliable: 0,
    statsReliable: true,
  },
  explanation: {
    summary: 'Test score',
    strengths: ['Strong bat'],
    concerns: [],
    keyStats: {},
  },
  inputs: {
    derivedFeaturesVersion: 'v1',
    computedAt: new Date('2025-08-01T00:00:00.000Z'),
  },
};

describe('simulatePlayerOutcomes', () => {
  it('is deterministic for the same explicit seed', () => {
    const run1 = simulatePlayerOutcomes(baseScore, { simulations: 800, randomSeed: 4242 });
    const run2 = simulatePlayerOutcomes(baseScore, { simulations: 800, randomSeed: 4242 });

    expect(run1.rosScore.p50).toBe(run2.rosScore.p50);
    expect(run1.rosScore.p90).toBe(run2.rosScore.p90);
    expect(run1.confidenceInterval).toEqual(run2.confidenceInterval);
  });

  it('produces different distributions for different seeds', () => {
    const run1 = simulatePlayerOutcomes(baseScore, { simulations: 800, randomSeed: 1111 });
    const run2 = simulatePlayerOutcomes(baseScore, { simulations: 800, randomSeed: 2222 });

    expect(
      run1.rosScore.p50 !== run2.rosScore.p50 ||
      run1.rosScore.p90 !== run2.rosScore.p90 ||
      run1.confidenceInterval[0] !== run2.confidenceInterval[0] ||
      run1.confidenceInterval[1] !== run2.confidenceInterval[1]
    ).toBe(true);
  });

  it('orders percentiles correctly and keeps the CI bounded', () => {
    const outcome = simulatePlayerOutcomes(baseScore, { simulations: 1200, randomSeed: 1234 });

    expect(outcome.rosScore.p10).toBeLessThan(outcome.rosScore.p25);
    expect(outcome.rosScore.p25).toBeLessThan(outcome.rosScore.p50);
    expect(outcome.rosScore.p50).toBeLessThan(outcome.rosScore.p75);
    expect(outcome.rosScore.p75).toBeLessThan(outcome.rosScore.p90);
    expect(outcome.confidenceInterval[0]).toBeLessThanOrEqual(outcome.rosScore.p50);
    expect(outcome.confidenceInterval[1]).toBeGreaterThanOrEqual(outcome.rosScore.p50);
  });

  it('widens intervals and lowers convergence for lower-confidence players', () => {
    const highConfidence = simulatePlayerOutcomes(baseScore, { simulations: 1500, randomSeed: 7777 });
    const lowConfidence = simulatePlayerOutcomes(
      {
        ...baseScore,
        playerId: 'player-2',
        playerMlbamId: '654321',
        confidence: 0.42,
        overallValue: 64,
        reliability: {
          ...baseScore.reliability,
          sampleSize: 'small',
          gamesToReliable: 14,
          statsReliable: false,
        },
      },
      { simulations: 1500, randomSeed: 7777 }
    );

    const highWidth = highConfidence.confidenceInterval[1] - highConfidence.confidenceInterval[0];
    const lowWidth = lowConfidence.confidenceInterval[1] - lowConfidence.confidenceInterval[0];

    expect(lowWidth).toBeGreaterThan(highWidth);
    expect(lowConfidence.convergenceScore).toBeLessThan(highConfidence.convergenceScore);
  });
});
