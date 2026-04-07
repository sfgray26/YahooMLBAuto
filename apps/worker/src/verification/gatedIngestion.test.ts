import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyPlayerIdentityMock,
  upsertVerifiedPlayerMock,
  ingestGameLogsMock,
  ingestPitcherGameLogsForPlayersMock,
} = vi.hoisted(() => ({
  verifyPlayerIdentityMock: vi.fn(),
  upsertVerifiedPlayerMock: vi.fn(),
  ingestGameLogsMock: vi.fn(),
  ingestPitcherGameLogsForPlayersMock: vi.fn(),
}));

vi.mock('./playerIdentity.js', () => ({
  verifyPlayerIdentity: verifyPlayerIdentityMock,
  upsertVerifiedPlayer: upsertVerifiedPlayerMock,
}));

vi.mock('../ingestion/gameLogs.js', () => ({
  ingestGameLogs: ingestGameLogsMock,
}));

vi.mock('../pitchers/gameLogs.js', () => ({
  ingestPitcherGameLogsForPlayers: ingestPitcherGameLogsForPlayersMock,
}));

import { ingestPlayer } from './gatedIngestion.js';

describe('ingestPlayer', () => {
  beforeEach(() => {
    verifyPlayerIdentityMock.mockReset();
    upsertVerifiedPlayerMock.mockReset();
    ingestGameLogsMock.mockReset();
    ingestPitcherGameLogsForPlayersMock.mockReset();

    verifyPlayerIdentityMock.mockResolvedValue({
      valid: true,
      identity: {
        mlbamId: '665742',
        fullName: 'Juan Soto',
        role: 'hitter',
      },
    });
    upsertVerifiedPlayerMock.mockResolvedValue(undefined);
    ingestGameLogsMock.mockResolvedValue({
      success: true,
      totalGames: 8,
      errors: [],
    });
    ingestPitcherGameLogsForPlayersMock.mockResolvedValue({
      totalPlayers: 1,
      totalGames: 3,
      errors: [],
    });
  });

  it('passes the requested season through to game-log ingestion', async () => {
    const result = await ingestPlayer('665742', 2026);

    expect(result.success).toBe(true);
    expect(ingestGameLogsMock).toHaveBeenCalledWith('665742', 2026);
  });

  it('ingests verified pitchers through the pitcher game-log path', async () => {
    verifyPlayerIdentityMock.mockResolvedValue({
      valid: true,
      identity: {
        mlbamId: '605447',
        fullName: 'Jordan Romano',
        role: 'pitcher',
      },
    });

    const result = await ingestPlayer('605447', 2026);

    expect(result.success).toBe(true);
    expect(result.gamesIngested).toBe(3);
    expect(ingestPitcherGameLogsForPlayersMock).toHaveBeenCalledWith(
      [{ playerId: 'mlbam:605447', mlbamId: '605447' }],
      2026
    );
    expect(ingestGameLogsMock).not.toHaveBeenCalled();
  });
});
