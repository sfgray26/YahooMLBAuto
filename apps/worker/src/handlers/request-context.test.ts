import { describe, expect, it } from 'vitest';

import type { LineupOptimizationRequest, WaiverRecommendationRequest } from '@cbb/core';

import {
  buildTeamStateFromLineupRequest,
  buildTeamStateFromWaiverRequest,
  getSeasonFromTimestamp,
} from './request-context.js';

describe('request-context', () => {
  it('uses the scoring period year for lineup season', () => {
    expect(getSeasonFromTimestamp('2026-04-07T00:00:00.000Z')).toBe(2026);
  });

  it('preserves multi-position players when seeding lineup assignments', () => {
    const request: LineupOptimizationRequest = {
      id: 'req-1',
      version: 'v1',
      createdAt: '2026-04-07T00:00:00.000Z',
      leagueConfig: {
        platform: 'espn',
        format: 'points',
        leagueSize: 12,
        scoringRules: { batting: { R: 1, HR: 4, RBI: 1, SB: 2, BB: 1 }, pitching: { IP: 3, SO: 1, W: 5, SV: 5, ER: -1 } },
        rosterPositions: [
          { slot: '2B', eligiblePositions: ['2B'], maxCount: 1 },
          { slot: 'BN', eligiblePositions: ['UTIL'], maxCount: 2 },
        ],
      },
      scoringPeriod: {
        type: 'daily',
        startDate: '2026-04-07T00:00:00.000Z',
        endDate: '2026-04-07T23:59:59.000Z',
        games: [],
      },
      rosterConstraints: { lockedSlots: [] },
      availablePlayers: {
        lastUpdated: '2026-04-07T00:00:00.000Z',
        players: [
          {
            player: { id: 'p1', mlbamId: '1', name: 'Flex Guy', team: 'NYM', position: ['SS', '2B'] },
            isAvailable: true,
            currentRosterStatus: 'starting',
          },
        ],
      },
      optimizationObjective: { type: 'maximize_expected' },
      riskTolerance: { type: 'balanced', varianceTolerance: 0.3, description: 'Balance risk and reward' },
    };

    const teamState = buildTeamStateFromLineupRequest(request);
    expect(teamState.currentLineup.assignments[0]?.slotId).toBe('2B');
  });

  it('uses request createdAt year for waiver season', () => {
    const request: WaiverRecommendationRequest = {
      id: 'waiver-1',
      version: 'v1',
      createdAt: '2027-01-15T12:00:00.000Z',
      leagueConfig: {
        platform: 'espn',
        format: 'points',
        leagueSize: 12,
        scoringRules: { batting: { R: 1, HR: 4, RBI: 1, SB: 2, BB: 1 }, pitching: { IP: 3, SO: 1, W: 5, SV: 5, ER: -1 } },
        rosterPositions: [{ slot: 'BN', eligiblePositions: ['UTIL'], maxCount: 3 }],
      },
      currentRoster: [
        {
          player: { id: 'p1', mlbamId: '1', name: 'Bench Guy', team: 'ATL', position: ['OF'] },
          position: 'BN',
          isLocked: false,
        },
      ],
      availablePlayers: { lastUpdated: '2027-01-15T12:00:00.000Z', players: [] },
      recommendationScope: 'add_only',
    };

    const teamState = buildTeamStateFromWaiverRequest(request);
    expect(teamState.identity.season).toBe(2027);
  });
});
