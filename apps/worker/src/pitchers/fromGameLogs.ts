/**
 * Pitcher Derived Stats from Game Logs
 *
 * Uses stored pitcher game logs as the source of truth for rolling features.
 */

import { prisma } from '@cbb/infrastructure';
import { computePitcherDerivedFeatures, type RawPitcherStats } from './derived.js';
import { storePitcherDerivedFeatures } from './storage.js';

function mapPitcherGameLogToRaw(log: {
  gameDate: Date;
  gamesPlayed: number;
  gamesStarted: number;
  gamesFinished: number;
  gamesSaved: number;
  holds: number;
  inningsPitched: number;
  battersFaced: number;
  hitsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRunsAllowed: number;
  hitByPitch: number;
  pitches: number | null;
  strikes: number | null;
  firstPitchStrikes: number | null;
  swingingStrikes: number | null;
  groundBalls: number | null;
  flyBalls: number | null;
}): RawPitcherStats {
  return {
    statDate: log.gameDate,
    gamesPlayed: log.gamesPlayed,
    gamesStarted: log.gamesStarted,
    gamesFinished: log.gamesFinished,
    gamesSaved: log.gamesSaved,
    holds: log.holds,
    inningsPitched: log.inningsPitched,
    battersFaced: log.battersFaced,
    hitsAllowed: log.hitsAllowed,
    runsAllowed: log.runsAllowed,
    earnedRuns: log.earnedRuns,
    walks: log.walks,
    strikeouts: log.strikeouts,
    homeRunsAllowed: log.homeRunsAllowed,
    hitByPitch: log.hitByPitch,
    pitches: log.pitches,
    strikes: log.strikes,
    firstPitchStrikes: log.firstPitchStrikes,
    swingingStrikes: log.swingingStrikes,
    groundBalls: log.groundBalls,
    flyBalls: log.flyBalls,
  };
}

export async function computePitcherDerivedStatsFromGameLogs(
  playerId: string,
  playerMlbamId: string,
  season: number,
  referenceDate?: Date
) {
  const logs = await prisma.pitcherGameLog.findMany({
    where: { playerMlbamId, season },
    orderBy: { gameDate: 'desc' },
  });

  if (logs.length === 0) {
    return null;
  }

  const rawStats = logs.map(mapPitcherGameLogToRaw);
  const asOfDate = referenceDate ?? logs[0].gameDate;

  return computePitcherDerivedFeatures(
    playerId,
    playerMlbamId,
    season,
    rawStats,
    asOfDate,
  );
}

export async function batchComputePitcherDerivedStatsFromGameLogs(
  season: number,
  referenceDate?: Date,
  traceId: string = `pitcher-derived-${Date.now()}`
): Promise<{ processed: number; errors: string[] }> {
  const players = await prisma.pitcherGameLog.groupBy({
    by: ['playerId', 'playerMlbamId'],
    where: { season },
  });

  const errors: string[] = [];
  let processed = 0;

  for (const { playerId, playerMlbamId } of players) {
    try {
      const features = await computePitcherDerivedStatsFromGameLogs(
        playerId,
        playerMlbamId,
        season,
        referenceDate
      );

      if (!features) {
        continue;
      }

      await storePitcherDerivedFeatures(features, traceId);
      processed++;
    } catch (error) {
      errors.push(`Player ${playerMlbamId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { processed, errors };
}
