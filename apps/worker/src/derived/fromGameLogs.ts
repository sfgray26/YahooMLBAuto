/**
 * Derived Stats from Game Logs
 *
 * Computes rolling 7/14/30 day stats from actual game-by-game data
 * No shortcuts, no mock data, real calculations from stored game logs
 */

import { prisma } from '@cbb/infrastructure';

interface RollingStats {
  games: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  stolenBases: number;
  caughtStealing: number;
  hitByPitch: number;
  sacrificeFlies: number;
  totalBases: number;
}

interface ComputedDerivedStats {
  gamesLast7: number;
  gamesLast14: number;
  gamesLast30: number;
  plateAppearancesLast7: number;
  plateAppearancesLast14: number;
  plateAppearancesLast30: number;
  atBatsLast30: number;

  // Rates
  battingAverageLast30: number;
  onBasePctLast30: number;
  sluggingPctLast30: number;
  opsLast30: number;
  isoLast30: number;
  walkRateLast30: number;
  strikeoutRateLast30: number;

  // Reliability
  battingAverageReliable: boolean;
  obpReliable: boolean;
  slgReliable: boolean;
  opsReliable: boolean;
  gamesToReliable: number;

  // Volatility
  hitConsistencyScore: number;
  productionVolatility: number;
  zeroHitGamesLast14: number;
  multiHitGamesLast14: number;
}

/**
 * Compute rolling stats from game logs for a date range
 */
async function computeRollingStats(
  playerMlbamId: string,
  season: number,
  daysBack: number,
  asOfDate: Date
): Promise<RollingStats> {
  const cutoffDate = new Date(asOfDate);
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const games = await prisma.playerGameLog.findMany({
    where: {
      playerMlbamId,
      season,
      gameDate: {
        gte: cutoffDate,
        lte: asOfDate,
      },
    },
    orderBy: { gameDate: 'desc' },
  });

  return games.reduce(
    (acc, game) => ({
      games: acc.games + game.gamesPlayed,
      plateAppearances: acc.plateAppearances + game.plateAppearances,
      atBats: acc.atBats + game.atBats,
      hits: acc.hits + game.hits,
      doubles: acc.doubles + game.doubles,
      triples: acc.triples + game.triples,
      homeRuns: acc.homeRuns + game.homeRuns,
      runs: acc.runs + game.runs,
      rbi: acc.rbi + game.rbi,
      walks: acc.walks + game.walks,
      strikeouts: acc.strikeouts + game.strikeouts,
      stolenBases: acc.stolenBases + game.stolenBases,
      caughtStealing: acc.caughtStealing + game.caughtStealing,
      hitByPitch: acc.hitByPitch + game.hitByPitch,
      sacrificeFlies: acc.sacrificeFlies + game.sacrificeFlies,
      totalBases: acc.totalBases + game.totalBases,
    }),
    {
      games: 0,
      plateAppearances: 0,
      atBats: 0,
      hits: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      runs: 0,
      rbi: 0,
      walks: 0,
      strikeouts: 0,
      stolenBases: 0,
      caughtStealing: 0,
      hitByPitch: 0,
      sacrificeFlies: 0,
      totalBases: 0,
    }
  );
}

/**
 * Count games with specific hit outcomes in last 14 days
 */
async function countHitOutcomes(
  playerMlbamId: string,
  season: number,
  asOfDate: Date
): Promise<{ zeroHitGames: number; multiHitGames: number }> {
  const cutoffDate = new Date(asOfDate);
  cutoffDate.setDate(cutoffDate.getDate() - 14);

  const games = await prisma.playerGameLog.findMany({
    where: {
      playerMlbamId,
      season,
      gameDate: {
        gte: cutoffDate,
        lte: asOfDate,
      },
    },
    select: { hits: true },
  });

  let zeroHitGames = 0;
  let multiHitGames = 0;

  for (const game of games) {
    if (game.hits === 0) zeroHitGames++;
    if (game.hits >= 2) multiHitGames++;
  }

  return { zeroHitGames, multiHitGames };
}

/**
 * Compute volatility metrics from game log variance
 */
async function computeVolatilityMetrics(
  playerMlbamId: string,
  season: number,
  asOfDate: Date
): Promise<{ productionVolatility: number; hitConsistencyScore: number }> {
  const cutoffDate = new Date(asOfDate);
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  const games = await prisma.playerGameLog.findMany({
    where: {
      playerMlbamId,
      season,
      gameDate: {
        gte: cutoffDate,
        lte: asOfDate,
      },
    },
    select: {
      hits: true,
      totalBases: true,
      plateAppearances: true,
    },
  });

  if (games.length < 5) {
    return { productionVolatility: 0, hitConsistencyScore: 50 };
  }

  // Calculate wOBA proxy per game (simplified)
  const gameValues = games.map((g) => {
    const tb = g.totalBases;
    const pa = Math.max(1, g.plateAppearances);
    return tb / pa; // Total bases per PA as a proxy
  });

  // Calculate mean and standard deviation
  const mean = gameValues.reduce((a, b) => a + b, 0) / gameValues.length;
  const variance =
    gameValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
    gameValues.length;
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation (volatility relative to mean)
  const cv = mean > 0 ? stdDev / mean : 0;

  // Normalize to 0-1 scale (higher = more volatile)
  const productionVolatility = Math.min(1, cv);

  // Hit consistency score (0-100, higher = more consistent)
  // Based on percentage of games with at least 1 hit
  const gamesWithHits = games.filter((g) => g.hits > 0).length;
  const hitRate = gamesWithHits / games.length;
  const hitConsistencyScore = Math.round(hitRate * 100);

  return { productionVolatility, hitConsistencyScore };
}

/**
 * Compute all derived stats from game logs for a player
 */
export async function computeDerivedStatsFromGameLogs(
  playerId: string,
  playerMlbamId: string,
  season: number,
  asOfDate: Date = new Date()
): Promise<ComputedDerivedStats | null> {
  // Get rolling stats for each window
  const [stats7, stats14, stats30] = await Promise.all([
    computeRollingStats(playerMlbamId, season, 7, asOfDate),
    computeRollingStats(playerMlbamId, season, 14, asOfDate),
    computeRollingStats(playerMlbamId, season, 30, asOfDate),
  ]);

  // Need at least some games
  if (stats30.games === 0) {
    return null;
  }

  // Count hit outcomes from last 14 days
  const { zeroHitGames, multiHitGames } = await countHitOutcomes(
    playerMlbamId,
    season,
    asOfDate
  );

  // Compute volatility
  const { productionVolatility, hitConsistencyScore } = await computeVolatilityMetrics(
    playerMlbamId,
    season,
    asOfDate
  );

  // Calculate rates from 30-day window
  const pa = stats30.plateAppearances;
  const ab = stats30.atBats;

  const battingAverageLast30 = ab > 0 ? stats30.hits / ab : 0;
  const onBasePctLast30 = pa > 0 ? (stats30.hits + stats30.walks + stats30.hitByPitch) / pa : 0;
  const sluggingPctLast30 = ab > 0 ? stats30.totalBases / ab : 0;
  const opsLast30 = onBasePctLast30 + sluggingPctLast30;
  const isoLast30 = battingAverageLast30 > 0 ? sluggingPctLast30 - battingAverageLast30 : 0;
  const walkRateLast30 = pa > 0 ? stats30.walks / pa : 0;
  const strikeoutRateLast30 = pa > 0 ? stats30.strikeouts / pa : 0;

  // Reliability flags (standard stabilization thresholds)
  const battingAverageReliable = stats30.games >= 50 || stats30.atBats >= 200;
  const obpReliable = stats30.games >= 50 || stats30.plateAppearances >= 250;
  const slgReliable = stats30.games >= 50 || stats30.atBats >= 200;
  const opsReliable = obpReliable && slgReliable;

  // Games needed to reach reliable sample (assuming 4 PA/game)
  const gamesToReliable = Math.max(0, Math.ceil((250 - stats30.plateAppearances) / 4));

  return {
    gamesLast7: stats7.games,
    gamesLast14: stats14.games,
    gamesLast30: stats30.games,
    plateAppearancesLast7: stats7.plateAppearances,
    plateAppearancesLast14: stats14.plateAppearances,
    plateAppearancesLast30: stats30.plateAppearances,
    atBatsLast30: stats30.atBats,

    battingAverageLast30,
    onBasePctLast30,
    sluggingPctLast30,
    opsLast30,
    isoLast30,
    walkRateLast30,
    strikeoutRateLast30,

    battingAverageReliable,
    obpReliable,
    slgReliable,
    opsReliable,
    gamesToReliable,

    hitConsistencyScore,
    productionVolatility,
    zeroHitGamesLast14: zeroHitGames,
    multiHitGamesLast14: multiHitGames,
  };
}

/**
 * Batch compute derived stats for all players with game logs
 */
export async function batchComputeDerivedStatsFromGameLogs(
  season: number,
  asOfDate: Date = new Date(),
  traceId: string
): Promise<{
  processed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processed = 0;

  // Get all unique players with game logs for this season
  const players = await prisma.playerGameLog.groupBy({
    by: ['playerId', 'playerMlbamId'],
    where: { season },
  });

  for (const { playerId, playerMlbamId } of players) {
    try {
      const stats = await computeDerivedStatsFromGameLogs(
        playerId,
        playerMlbamId,
        season,
        asOfDate
      );

      if (!stats) {
        errors.push(`Player ${playerMlbamId}: No games in last 30 days`);
        continue;
      }

      // Store in database
      const computedDate = new Date(asOfDate);
      computedDate.setHours(0, 0, 0, 0);

      await prisma.playerDerivedStats.upsert({
        where: {
          playerMlbamId_season_computedDate: {
            playerMlbamId,
            season,
            computedDate,
          },
        },
        update: {
          ...stats,
          computedAt: new Date(),
          traceId,
        },
        create: {
          playerId,
          playerMlbamId,
          season,
          computedDate,
          ...stats,
          traceId,
        },
      });

      processed++;
    } catch (error) {
      errors.push(`Player ${playerMlbamId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { processed, errors };
}
