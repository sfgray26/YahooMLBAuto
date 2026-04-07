import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyPlayerIdentityMock, upsertVerifiedPlayerMock, ingestGameLogsMock } = vi.hoisted(() => ({
  verifyPlayerIdentityMock: vi.fn(),
  upsertVerifiedPlayerMock: vi.fn(),
  ingestGameLogsMock: vi.fn(),
}));

vi.mock('./playerIdentity.js', () => ({
  verifyPlayerIdentity: verifyPlayerIdentityMock,
  upsertVerifiedPlayer: upsertVerifiedPlayerMock,
}));

vi.mock('../ingestion/gameLogs.js', () => ({
  ingestGameLogs: ingestGameLogsMock,
}));

import { ingestPlayer } from './gatedIngestion.js';

describe('ingestPlayer', () => {
  beforeEach(() => {
    verifyPlayerIdentityMock.mockReset();
    upsertVerifiedPlayerMock.mockReset();
    ingestGameLogsMock.mockReset();

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
  });

  it('passes the requested season through to game-log ingestion', async () => {
    const result = await ingestPlayer('665742', 2026);

    expect(result.success).toBe(true);
    expect(ingestGameLogsMock).toHaveBeenCalledWith('665742', 2026);
  });
});
