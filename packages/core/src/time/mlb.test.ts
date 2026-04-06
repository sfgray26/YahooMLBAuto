import { describe, expect, it } from 'vitest';

import { buildMlbScoringPeriod, getMlbWallClock } from './mlb.js';

describe('MLB time helpers', () => {
  it('reads wall clock values in Eastern Time', () => {
    const wallClock = getMlbWallClock(new Date('2026-04-06T15:49:10.000Z'));

    expect(wallClock.isoDate).toBe('2026-04-06');
    expect(wallClock.hour).toBe(11);
    expect(wallClock.minute).toBe(49);
    expect(wallClock.offset).toBe('-04:00');
  });

  it('builds weekly scoring periods on Monday-Sunday boundaries', () => {
    const scoringPeriod = buildMlbScoringPeriod('week', new Date('2026-04-08T12:00:00.000Z'));

    expect(scoringPeriod.type).toBe('weekly');
    expect(scoringPeriod.startDate.startsWith('2026-04-06T00:00:00')).toBe(true);
    expect(scoringPeriod.endDate.startsWith('2026-04-12T23:59:59')).toBe(true);
  });
});
