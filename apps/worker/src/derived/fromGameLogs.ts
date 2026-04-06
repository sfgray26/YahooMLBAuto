/**
 * Derived Stats from Game Logs
 *
 * Computes time-decayed rolling stats from actual game-by-game data
 * 
 * TIME DECAY ARCHITECTURE:
 * - Each game's contribution decays exponentially with age
 * - Formula: weight = λ^Δt where λ = 0.95 (14-day half-life)
 * - Stats are weighted averages, not simple sums
 * - Applied BEFORE Z-scores in the pipeline
 * 
 * This makes the system responsive to recent form without overreacting
 * to small samples.
 */

import { prisma } from '@cbb/infrastructure';

// ============================================================================
// Time Decay Configuration
// ============================================================================

/**
 * Decay constant λ (lambda)
 * 0.95 = ~14 day half-life
 * Meaning: a game 14 days ago counts half as much as today's game
 */
const DECAY_LAMBDA = 0.95;

/**
 * Half-life lookup for different responsiveness levels
 */
export const DECAY_HALFLIVES = {
  responsive: 0.90,   // 7-day half-life (hot/cold streaks)
  balanced: 0.93,     // 10-day half-life (default)
  stable: 0.95,       // 14-day half-life (reliable trends)
  very_stable: 0.97,  // 21-day half-life (season-long view)
} as const;

/**
 * Calculate time-decayed weight for a game
 * weight = λ^daysAgo
 */
function calculateDecayWeight(gameDate: Date, referenceDate: Date, lambda: number = DECAY_LAMBDA): number {
  const daysAgo = Math.floor((referenceDate.getTime() - gameDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.pow(lambda, Math.max(0, daysAgo));
}

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
  babipLast30: number | null;

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

  // Opportunity signals (not yet computed from game logs)
  gamesStartedLast14: number;
  lineupSpot: number | null;
  platoonRisk: string | null;
  playingTimeTrend: string | null;

  // Context (requires external data)
  positionEligibility: string[];
  waiverWireValue: number | null;
  rosteredPercent: number | null;
}

/**
 * Compute simple rolling stats (unweighted) from game logs
 * Kept for backward compatibility
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
    (acc: RollingStats, game: { gamesPlayed: number; plateAppearances: number; atBats: number; hits: number; doubles: number; triples: number; homeRuns: number; runs: number; rbi: number; walks: number; strikeouts: number; stolenBases: number; caughtStealing: number; hitByPitch: number; sacrificeFlies: number; totalBases: number }) => ({
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

// ============================================================================
// Time-Decayed Rolling Stats
// ============================================================================

interface TimeDecayedStats {
  games: number;              // Count (not weighted)
  totalWeight: number;        // Sum of all weights (for normalization)
  plateAppearances: number;   // Weighted
  atBats: number;             // Weighted
  hits: number;               // Weighted
  doubles: number;            // Weighted
  triples: number;            // Weighted
  homeRuns: number;           // Weighted
  walks: number;              // Weighted
  strikeouts: number;         // Weighted
  hitByPitch: number;         // Weighted
  sacrificeFlies: number;     // Weighted
  totalBases: number;         // Weighted
}

/**
 * Compute TIME-DECAYED rolling stats
 * 
 * Formula: weighted_stat = Σ(stat_i × λ^Δt_i) / Σ(λ^Δt_i)
 * 
 * This gives more weight to recent games while maintaining scale.
 */
async function computeTimeDecayedStats(
  playerMlbamId: string,
  season: number,
  daysBack: number,
  asOfDate: Date,
  lambda: number = DECAY_LAMBDA
): Promise<TimeDecayedStats | null> {
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

  if (games.length === 0) {
    return null;
  }

  // Calculate weights and weighted sums
  let totalWeight = 0;
  
  const weighted = games.reduce(
    (acc, game) => {
      const weight = calculateDecayWeight(game.gameDate, asOfDate, lambda);
      totalWeight += weight;
      
      return {
        plateAppearances: acc.plateAppearances + (game.plateAppearances * weight),
        atBats: acc.atBats + (game.atBats * weight),
        hits: acc.hits + (game.hits * weight),
        doubles: acc.doubles + (game.doubles * weight),
        triples: acc.triples + (game.triples * weight),
        homeRuns: acc.homeRuns + (game.homeRuns * weight),
        walks: acc.walks + (game.walks * weight),
        strikeouts: acc.strikeouts + (game.strikeouts * weight),
        hitByPitch: acc.hitByPitch + (game.hitByPitch * weight),
        sacrificeFlies: acc.sacrificeFlies + (game.sacrificeFlies * weight),
        totalBases: acc.totalBases + (game.totalBases * weight),
      };
    },
    {
      plateAppearances: 0,
      atBats: 0,
      hits: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      walks: 0,
      strikeouts: 0,
      hitByPitch: 0,
      sacrificeFlies: 0,
      totalBases: 0,
    }
  );

  // Normalize by total weight to get weighted averages
  return {
    games: games.length,
    totalWeight,
    plateAppearances: totalWeight > 0 ? weighted.plateAppearances / totalWeight : 0,
    atBats: totalWeight > 0 ? weighted.atBats / totalWeight : 0,
    hits: totalWeight > 0 ? weighted.hits / totalWeight : 0,
    doubles: totalWeight > 0 ? weighted.doubles / totalWeight : 0,
    triples: totalWeight > 0 ? weighted.triples / totalWeight : 0,
    homeRuns: totalWeight > 0 ? weighted.homeRuns / totalWeight : 0,
    walks: totalWeight > 0 ? weighted.walks / totalWeight : 0,
    strikeouts: totalWeight > 0 ? weighted.strikeouts / totalWeight : 0,
    hitByPitch: totalWeight > 0 ? weighted.hitByPitch / totalWeight : 0,
    sacrificeFlies: totalWeight > 0 ? weighted.sacrificeFlies / totalWeight : 0,
    totalBases: totalWeight > 0 ? weighted.totalBases / totalWeight : 0,
  };
}

/**
 * Calculate rates from time-decayed stats
 */
function calculateDecayedRates(stats: TimeDecayedStats): {
  battingAverage: number;
  onBasePct: number;
  sluggingPct: number;
  ops: number;
  iso: number;
  walkRate: number;
  strikeoutRate: number;
  babip: number | null;
} {
  const pa = stats.plateAppearances;
  const ab = stats.atBats;
  
  if (pa === 0) {
    return {
      battingAverage: 0,
      onBasePct: 0,
      sluggingPct: 0,
      ops: 0,
      iso: 0,
      walkRate: 0,
      strikeoutRate: 0,
      babip: null,
    };
  }

  // Time at bats (for BIP calculation)
  const bip = ab - stats.strikeouts + stats.sacrificeFlies; // Balls in play
  
  return {
    battingAverage: ab > 0 ? stats.hits / ab : 0,
    onBasePct: pa > 0 ? (stats.hits + stats.walks + stats.hitByPitch) / pa : 0,
    sluggingPct: ab > 0 ? stats.totalBases / ab : 0,
    ops: 0, // Will compute below
    iso: ab > 0 ? (stats.totalBases - stats.hits) / ab : 0,
    walkRate: pa > 0 ? stats.walks / pa : 0,
    strikeoutRate: pa > 0 ? stats.strikeouts / pa : 0,
    babip: bip > 0 ? (stats.hits - stats.homeRuns) / bip : null,
  };
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
  const gameValues = games.map((g: { totalBases: number; plateAppearances: number }) => {
    const tb = g.totalBases;
    const pa = Math.max(1, g.plateAppearances);
    return tb / pa; // Total bases per PA as a proxy
  });

  // Calculate mean and standard deviation
  const mean = gameValues.reduce((a: number, b: number) => a + b, 0) / gameValues.length;
  const variance =
    gameValues.reduce((acc: number, val: number) => acc + Math.pow(val - mean, 2), 0) /
    gameValues.length;
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation (volatility relative to mean)
  const cv = mean > 0 ? stdDev / mean : 0;

  // Normalize to 0-1 scale (higher = more volatile)
  const productionVolatility = Math.min(1, cv);

  // Hit consistency score (0-100, higher = more consistent)
  // Based on percentage of games with at least 1 hit
  const gamesWithHits = games.filter((g: { hits: number }) => g.hits > 0).length;
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
  asOfDate?: Date
): Promise<ComputedDerivedStats | null> {
  // Determine the reference date for rolling calculations
  // If not provided, use the latest game date for this player/season
  let referenceDate: Date;
  
  if (asOfDate) {
    referenceDate = asOfDate;
  } else {
    const latestGame = await prisma.playerGameLog.findFirst({
      where: { playerMlbamId, season },
      orderBy: { gameDate: 'desc' },
      select: { gameDate: true },
    });
    
    if (!latestGame) {
      return null;
    }
    
    referenceDate = latestGame.gameDate;
  }

  // Get rolling stats for each window
  const [stats7, stats14, stats30] = await Promise.all([
    computeRollingStats(playerMlbamId, season, 7, referenceDate),
    computeRollingStats(playerMlbamId, season, 14, referenceDate),
    computeRollingStats(playerMlbamId, season, 30, referenceDate),
  ]);

  // Need at least some games
  if (stats30.games === 0) {
    return null;
  }

  // Count hit outcomes from last 14 days
  const { zeroHitGames, multiHitGames } = await countHitOutcomes(
    playerMlbamId,
    season,
    referenceDate
  );

  // Compute volatility
  const { productionVolatility, hitConsistencyScore } = await computeVolatilityMetrics(
    playerMlbamId,
    season,
    referenceDate
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

  // BABIP = (H - HR) / (AB - K - HR + SF)
  // Balls in play that were hits / Total balls in play
  const hitsMinusHR = stats30.hits - stats30.homeRuns;
  const ballsInPlay = stats30.atBats - stats30.strikeouts - stats30.homeRuns + stats30.sacrificeFlies;
  const babipLast30 = ballsInPlay > 0 ? hitsMinusHR / ballsInPlay : null;
  
  // DEBUG: Log calculation details
  if (process.env.DEBUG_DERIVED_STATS === 'true') {
    console.log(`[DERIVED DEBUG] ${playerMlbamId}: hits=${stats30.hits}, HR=${stats30.homeRuns}, AB=${stats30.atBats}, K=${stats30.strikeouts}, SF=${stats30.sacrificeFlies}`);
    console.log(`[DERIVED DEBUG] ${playerMlbamId}: hitsMinusHR=${hitsMinusHR}, ballsInPlay=${ballsInPlay}, BABIP=${babipLast30}`);
  }

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
    babipLast30,

    battingAverageReliable,
    obpReliable,
    slgReliable,
    opsReliable,
    gamesToReliable,

    hitConsistencyScore,
    productionVolatility,
    zeroHitGamesLast14: zeroHitGames,
    multiHitGamesLast14: multiHitGames,

    // Opportunity signals - not yet computed from game logs
    gamesStartedLast14: 0,
    lineupSpot: null,
    platoonRisk: null,
    playingTimeTrend: null,

    // Context - requires external data sources
    positionEligibility: [],
    waiverWireValue: null,
    rosteredPercent: null,
  };
}

/**
 * Batch compute derived stats for all players with game logs
 */
export async function batchComputeDerivedStatsFromGameLogs(
  season: number,
  asOfDate: Date | undefined,
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

      // Store in database - use the reference date or today
      const computedDate = asOfDate ? new Date(asOfDate) : new Date();
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
