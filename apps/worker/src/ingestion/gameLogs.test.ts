import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upsertMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
}));

vi.mock('@cbb/infrastructure', () => ({
  prisma: {
    playerGameLog: {
      upsert: upsertMock,
    },
  },
}));

import { ingestGameLogs } from './gameLogs.js';

describe('ingestGameLogs', () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          stats: [
            {
              splits: [
                {
                  date: '2026-04-01',
                  game: {
                    gamePk: 123456,
                    teams: {
                      home: { team: { id: 121 } },
                      away: { team: { id: 147 } },
                    },
                  },
                  team: { id: 121 },
                  opponent: { id: 147 },
                  isHome: true,
                  stat: {
                    gamesPlayed: 1,
                    atBats: 4,
                    runs: 1,
                    hits: 2,
                    doubles: 1,
                    triples: 0,
                    homeRuns: 0,
                    rbi: 1,
                    stolenBases: 0,
                    caughtStealing: 0,
                    baseOnBalls: 1,
                    strikeOuts: 0,
                    hitByPitch: 0,
                    sacrificeFlies: 0,
                    groundIntoDoublePlay: 0,
                    leftOnBase: 1,
                    plateAppearances: 5,
                    totalBases: 3,
                  },
                  position: { code: 'RF' },
                },
              ],
            },
          ],
        }),
      })
    );
  });

  it('stores single-player ingests under canonical mlbam ids', async () => {
    await ingestGameLogs('592450', 2026);

    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0]?.[0]?.create?.playerId).toBe('mlbam:592450');
  });
});
