import { describe, expect, it } from 'vitest';
import type { LineupSlot, PlayerIdentity } from '@cbb/core';

import type { PitcherScore } from '../pitchers/index.js';
import type { PlayerScore } from '../scoring/index.js';
import { generateAlternatives } from './lineupAssembly.js';

function makePlayer(id: string, name: string, position: string[]): PlayerIdentity {
  return { id, mlbamId: id, name, team: 'TST', position };
}

function makeHitterScore(overallValue: number, confidence = 0.5): PlayerScore {
  return {
    playerId: 'h',
    playerMlbamId: 'h',
    season: 2026,
    scoredAt: new Date('2026-04-07T00:00:00.000Z'),
    overallValue,
    components: {
      hitting: overallValue,
      power: overallValue,
      speed: overallValue,
      plateDiscipline: overallValue,
      consistency: overallValue,
      opportunity: overallValue,
    },
    confidence,
    reliability: {
      sampleSize: 'adequate',
      gamesToReliable: 0,
      statsReliable: true,
    },
    explanation: {
      summary: 'test',
      strengths: [],
      concerns: [],
      keyStats: {},
    },
    inputs: {
      derivedFeaturesVersion: 'test',
      computedAt: new Date('2026-04-07T00:00:00.000Z'),
    },
  };
}

function makePitcherScore(overallValue: number, confidence = 0.5): PitcherScore {
  return {
    playerId: 'p',
    playerMlbamId: 'p',
    season: 2026,
    scoredAt: new Date('2026-04-07T00:00:00.000Z'),
    domain: 'pitching',
    overallValue,
    components: {
      command: overallValue,
      stuff: overallValue,
      results: overallValue,
      workload: overallValue,
      consistency: overallValue,
      matchup: overallValue,
    },
    confidence,
    reliability: {
      sampleSize: 'adequate',
      battersToReliable: 0,
      statsReliable: true,
    },
    role: {
      currentRole: 'SP',
      isCloser: false,
      holdsEligible: false,
      expectedInningsPerWeek: 6,
      startProbabilityNext7: 1,
    },
    explanation: {
      summary: 'test',
      strengths: [],
      concerns: [],
      keyStats: {},
    },
    inputs: {
      derivedFeaturesVersion: 'test',
      computedAt: new Date('2026-04-07T00:00:00.000Z'),
    },
  };
}

describe('generateAlternatives', () => {
  it('only uses bench players eligible for the target slot', () => {
    const lineup: LineupSlot[] = [
      {
        position: '1B',
        player: makePlayer('1', 'Starter 1B', ['1B']),
        projectedPoints: 12,
        confidence: 'moderate',
        factors: [],
      },
      {
        position: 'OF',
        player: makePlayer('2', 'Starter OF', ['OF']),
        projectedPoints: 14,
        confidence: 'moderate',
        factors: [],
      },
      {
        position: 'SP',
        player: makePlayer('3', 'Starter SP', ['SP']),
        projectedPoints: 18,
        confidence: 'moderate',
        factors: [],
      },
    ];

    const alternatives = generateAlternatives(
      lineup,
      [
        { player: makePlayer('1', 'Starter 1B', ['1B']), score: makeHitterScore(50), overallValue: 50, confidence: 0.5, eligibleSlots: ['1B'] },
        { player: makePlayer('2', 'Starter OF', ['OF']), score: makeHitterScore(60), overallValue: 60, confidence: 0.5, eligibleSlots: ['OF'] },
        { player: makePlayer('4', 'Bench CI', ['1B']), score: makeHitterScore(58), overallValue: 58, confidence: 0.5, eligibleSlots: ['1B'] },
        { player: makePlayer('5', 'Illegal Bench OF', ['OF']), score: makeHitterScore(80), overallValue: 80, confidence: 0.5, eligibleSlots: ['OF'] },
      ],
      [
        { player: makePlayer('3', 'Starter SP', ['SP']), score: makePitcherScore(70), overallValue: 70, confidence: 0.5, eligibleSlots: ['SP'] },
        { player: makePlayer('6', 'Bench SP', ['SP']), score: makePitcherScore(72), overallValue: 72, confidence: 0.5, eligibleSlots: ['SP'] },
      ],
      [{ slotId: '1B' }, { slotId: 'OF' }],
      [{ slotId: 'SP' }]
    );

    expect(alternatives).toHaveLength(3);
    expect(alternatives[0]?.lineup.find((slot) => slot.position === '1B')?.player.id).toBe('4');
    expect(alternatives[1]?.lineup.find((slot) => slot.position === 'OF')?.player.id).toBe('5');
    expect(alternatives[2]?.lineup.find((slot) => slot.position === 'SP')?.player.id).toBe('6');
    for (const alternative of alternatives) {
      const ids = alternative.lineup.map((slot) => slot.player.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
