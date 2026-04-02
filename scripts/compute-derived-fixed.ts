#!/usr/bin/env node
/**
 * Fixed Derived Features Computation (No Redis)
 * Handles hitters and pitchers correctly
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SEASON = 2025;

/**
 * Calculate derived features for HITTERS
 */
function computeHitterFeatures(stats: any[]) {
  // Sort by date descending
  const sorted = [...stats].sort((a, b) =>
    new Date(b.statDate).getTime() - new Date(a.statDate).getTime()
  );

  const last7 = sorted.slice(0, 7);
  const last14 = sorted.slice(0, 14);
  const last30 = sorted.slice(0, 30);

  // Calculate totals
  const sum = (games: any[]) => games.reduce((acc, g) => ({
    atBats: acc.atBats + (g.atBats || 0),
    hits: acc.hits + (g.hits || 0),
    strikeouts: acc.strikeouts + (g.strikeouts || 0),
    walks: acc.walks + (g.walks || 0),
    games: acc.games + 1,
  }), { atBats: 0, hits: 0, strikeouts: 0, walks: 0, games: 0 });

  const s7 = sum(last7);
  const s14 = sum(last14);
  const s30 = sum(last30);

  // Calculate plate appearances (AB + BB for hitters)
  const pa7 = s7.atBats + s7.walks;
  const pa14 = s14.atBats + s14.walks;
  const pa30 = s30.atBats + s30.walks;

  return {
    gamesLast7: s7.games,
    gamesLast14: s14.games,
    gamesLast30: s30.games,
    plateAppearancesLast7: pa7,
    plateAppearancesLast14: pa14,
    plateAppearancesLast30: pa30,
    atBatsLast30: s30.atBats,
    battingAverageLast30: s30.atBats > 0 ? s30.hits / s30.atBats : null,
    strikeoutRateLast30: pa30 > 0 ? s30.strikeouts / pa30 : null,
    walkRateLast30: pa30 > 0 ? s30.walks / pa30 : null,
    battingAverageReliable: pa30 >= 100,
    productionVolatility: 0,
  };
}

/**
 * Calculate derived features for PITCHERS
 * Uses battersFaced instead of atBats
 */
function computePitcherFeatures(stats: any[]) {
  // Sort by date descending
  const sorted = [...stats].sort((a, b) =>
    new Date(b.statDate).getTime() - new Date(a.statDate).getTime()
  );

  const last7 = sorted.slice(0, 7);
  const last14 = sorted.slice(0, 14);
  const last30 = sorted.slice(0, 30);

  // Calculate totals - use battersFaced for pitchers
  const sum = (games: any[]) => games.reduce((acc, g) => ({
    battersFaced: acc.battersFaced + (g.atBats || 0) + (g.walks || 0), // Approximate BF
    strikeouts: acc.strikeouts + (g.strikeouts || 0),
    walks: acc.walks + (g.walks || 0),
    games: acc.games + 1,
  }), { battersFaced: 0, strikeouts: 0, walks: 0, games: 0 });

  const s7 = sum(last7);
  const s14 = sum(last14);
  const s30 = sum(last30);

  // For pitchers, use batters faced as denominator
  const bf7 = s7.battersFaced;
  const bf14 = s14.battersFaced;
  const bf30 = s30.battersFaced;

  return {
    gamesLast7: s7.games,
    gamesLast14: s14.games,
    gamesLast30: s30.games,
    plateAppearancesLast7: bf7,
    plateAppearancesLast14: bf14,
    plateAppearancesLast30: bf30,
    atBatsLast30: bf30, // Store BF here for pitchers
    battingAverageLast30: null, // N/A for pitchers
    strikeoutRateLast30: bf30 > 0 ? s30.strikeouts / bf30 : null,
    walkRateLast30: bf30 > 0 ? s30.walks / bf30 : null,
    battingAverageReliable: false, // N/A for pitchers
    productionVolatility: 0,
  };
}

async function main() {
  console.log(`🚀 Computing derived features for season ${SEASON}\n`);

  // Get all unique players
  const players = await prisma.playerDailyStats.findMany({
    where: { season: SEASON },
    select: { playerMlbamId: true, playerId: true },
    distinct: ['playerMlbamId'],
  });

  console.log(`Found ${players.length} unique players\n`);

  let computed = 0;
  let errors = 0;

  for (const player of players) {
    try {
      // Get HITTING stats for this player
      const hittingStats = await prisma.playerDailyStats.findMany({
        where: {
          playerMlbamId: player.playerMlbamId,
          season: SEASON,
          id: { endsWith: '-hitting' },
        },
      });

      // Get PITCHING stats for this player
      const pitchingStats = await prisma.playerDailyStats.findMany({
        where: {
          playerMlbamId: player.playerMlbamId,
          season: SEASON,
          id: { endsWith: '-pitching' },
        },
      });

      // Compute hitter features if data exists
      if (hittingStats.length > 0) {
        const features = computeHitterFeatures(hittingStats);
        await storeDerived(player, 'hitting', features, hittingStats.length);
        computed++;
      }

      // Compute pitcher features if data exists
      if (pitchingStats.length > 0) {
        const features = computePitcherFeatures(pitchingStats);
        await storeDerived(player, 'pitching', features, pitchingStats.length);
        computed++;
      }

      if (computed % 50 === 0) {
        process.stdout.write(`  ${computed}/${players.length * 2}\r`);
      }
    } catch (error) {
      errors++;
      console.log(`\n  ⚠️ Error for ${player.playerMlbamId}: ${error.message}`);
    }
  }

  console.log(`\n✅ Computed features for ${computed} player/variant combos`);
  if (errors > 0) {
    console.log(`⚠️ ${errors} errors`);
  }

  await prisma.$disconnect();
}

async function storeDerived(
  player: { playerMlbamId: string; playerId: string },
  variant: 'hitting' | 'pitching',
  features: any,
  rawStatsCount: number
) {
  await prisma.playerDerivedStats.upsert({
    where: {
      playerMlbamId_season_computedDate: {
        playerMlbamId: player.playerMlbamId,
        season: SEASON,
        computedDate: new Date(),
      },
    },
    update: {
      ...features,
      traceId: `compute-${variant}-${Date.now()}`,
      updatedAt: new Date(),
    },
    create: {
      playerMlbamId: player.playerMlbamId,
      playerId: player.playerId,
      season: SEASON,
      ...features,
      traceId: `compute-${variant}-${Date.now()}`,
      computedAt: new Date(),
      computedDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
