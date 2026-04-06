import { describe, expect, it } from 'vitest';
import { scorePlayer } from './compute.js';
import type { DerivedFeatures } from '../derived/index.js';

const baseFeatures: DerivedFeatures = {
  playerId: 'test-player-1',
  playerMlbamId: '123456',
  season: 2025,
  computedAt: new Date('2025-08-01T00:00:00.000Z'),
  volume: {
    gamesLast7: 6,
    gamesLast14: 13,
    gamesLast30: 26,
    plateAppearancesLast7: 28,
    plateAppearancesLast14: 58,
    plateAppearancesLast30: 112,
    atBatsLast30: 98,
  },
  rates: {
    battingAverageLast30: 0.286,
    onBasePctLast30: 0.365,
    sluggingPctLast30: 0.512,
    opsLast30: 0.877,
    isoLast30: 0.226,
    walkRateLast30: 0.098,
    strikeoutRateLast30: 0.188,
    babipLast30: 0.318,
  },
  stabilization: {
    battingAverageReliable: true,
    obpReliable: true,
    slgReliable: true,
    opsReliable: true,
    gamesToReliable: 0,
  },
  volatility: {
    hitConsistencyScore: 72,
    productionVolatility: 0.85,
    zeroHitGamesLast14: 3,
    multiHitGamesLast14: 5,
  },
  opportunity: {
    gamesStartedLast14: 13,
    lineupSpot: 3,
    platoonRisk: 'low',
    playingTimeTrend: 'stable',
  },
  replacement: {
    positionEligibility: ['1B', 'DH'],
    waiverWireValue: 45,
    rosteredPercent: 85,
  },
};

describe('scorePlayer', () => {
  it('ranks stronger hitters above weaker hitters', () => {
    const averageScore = scorePlayer(baseFeatures);
    const eliteScore = scorePlayer({
      ...baseFeatures,
      playerId: 'elite-player',
      playerMlbamId: '999999',
      rates: {
        ...baseFeatures.rates,
        battingAverageLast30: 0.325,
        onBasePctLast30: 0.402,
        sluggingPctLast30: 0.593,
        opsLast30: 0.995,
        isoLast30: 0.285,
      },
      opportunity: {
        ...baseFeatures.opportunity,
        gamesStartedLast14: 14,
      },
    });
    const weakScore = scorePlayer({
      ...baseFeatures,
      playerId: 'weak-player',
      playerMlbamId: '111111',
      rates: {
        ...baseFeatures.rates,
        battingAverageLast30: 0.215,
        onBasePctLast30: 0.280,
        sluggingPctLast30: 0.378,
        opsLast30: 0.658,
        isoLast30: 0.095,
        walkRateLast30: 0.03,
        strikeoutRateLast30: 0.35,
      },
      opportunity: {
        ...baseFeatures.opportunity,
        gamesStartedLast14: 8,
        platoonRisk: 'high',
      },
      volatility: {
        ...baseFeatures.volatility,
        hitConsistencyScore: 30,
      },
    });

    expect(eliteScore.overallValue).toBeGreaterThan(averageScore.overallValue);
    expect(averageScore.overallValue).toBeGreaterThan(weakScore.overallValue);
  });

  it('rejects pitcher-only eligibility', () => {
    expect(() =>
      scorePlayer({
        ...baseFeatures,
        replacement: {
          ...baseFeatures.replacement,
          positionEligibility: ['SP'],
        },
      })
    ).toThrow(/Pitcher eligibility/i);
  });

  it('rejects mixed hitter and pitcher eligibility', () => {
    expect(() =>
      scorePlayer({
        ...baseFeatures,
        replacement: {
          ...baseFeatures.replacement,
          positionEligibility: ['SS', 'P'],
        },
      })
    ).toThrow(/Two-way eligibility/i);
  });

  it('regresses small samples and caps displayed confidence to the weakest signal', () => {
    const largeSample = scorePlayer(baseFeatures);
    const smallSample = scorePlayer({
      ...baseFeatures,
      volume: {
        ...baseFeatures.volume,
        gamesLast30: 9,
        plateAppearancesLast30: 28,
        atBatsLast30: 25,
      },
      stabilization: {
        ...baseFeatures.stabilization,
        battingAverageReliable: false,
        obpReliable: false,
        slgReliable: false,
        opsReliable: false,
        gamesToReliable: 18,
      },
    });

    expect(smallSample.overallValue).toBeLessThan(largeSample.overallValue);
    expect(smallSample.confidence).toBeLessThan(largeSample.confidence);
    expect(smallSample.confidence).toBeLessThanOrEqual(0.45);
  });

  it('downgrades reliability when production is riding an extreme unstable BABIP', () => {
    const babipRiskScore = scorePlayer({
      ...baseFeatures,
      rates: {
        ...baseFeatures.rates,
        babipLast30: 0.43,
      },
      stabilization: {
        ...baseFeatures.stabilization,
        battingAverageReliable: false,
        opsReliable: true,
      },
    });

    expect(babipRiskScore.reliability.statsReliable).toBe(false);
    expect(babipRiskScore.confidence).toBeLessThan(0.9);
    expect(babipRiskScore.explanation.concerns).toContain('Recent production may be BABIP-driven');
  });
});
