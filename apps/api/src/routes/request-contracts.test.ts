import { describe, expect, it } from 'vitest';

import { LineupRequestSchema, WaiverRequestSchema } from './request-contracts.js';

const hydratedPlayer = {
  id: 'player-1',
  mlbamId: '660271',
  name: 'Mookie Betts',
  team: 'LAD',
  position: ['OF'],
};

describe('request contract validation', () => {
  it('requires hydrated lineup players', () => {
    expect(() => LineupRequestSchema.parse({
      leagueId: 'league-1',
      platform: 'yahoo',
      format: 'h2h',
      availablePlayers: { players: [] },
    })).toThrow(/at least 1/i);

    const parsed = LineupRequestSchema.parse({
      leagueId: 'league-1',
      platform: 'yahoo',
      format: 'h2h',
      availablePlayers: {
        players: [
          {
            player: hydratedPlayer,
            isAvailable: true,
            currentRosterStatus: 'starting',
          },
        ],
      },
    });

    expect(parsed.availablePlayers.players).toHaveLength(1);
  });

  it('requires hydrated waiver roster and player pool', () => {
    expect(() => WaiverRequestSchema.parse({
      leagueId: 'league-1',
      platform: 'yahoo',
      format: 'h2h',
      currentRoster: [],
      availablePlayers: { players: [] },
    })).toThrow();

    const parsed = WaiverRequestSchema.parse({
      leagueId: 'league-1',
      platform: 'yahoo',
      format: 'h2h',
      currentRoster: [
        {
          player: hydratedPlayer,
          position: 'OF',
          isLocked: false,
        },
      ],
      availablePlayers: {
        players: [
          {
            player: {
              id: 'player-2',
              mlbamId: '592450',
              name: 'William Contreras',
              team: 'MIL',
              position: ['C'],
            },
            isAvailable: true,
          },
        ],
      },
    });

    expect(parsed.currentRoster).toHaveLength(1);
    expect(parsed.availablePlayers.players).toHaveLength(1);
  });
});
