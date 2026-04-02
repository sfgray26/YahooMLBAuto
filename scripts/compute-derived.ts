#!/usr/bin/env node
/**
 * Standalone Derived Features Computation (No Redis)
 * Computes derived features for all players with raw stats
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SEASON = 2025;

interface PlayerRawStats {
  playerMlbamId: string;
  playerId: string;
  stats: any[];
}

/**
 * Calculate rolling averages and derived features
 */
function computeFeatures(stats: any[]) {
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
  
  // Calculate rates
  const pa7 = s7.atBats + s7.walks;
  const pa14 = s14.atBats + s14.walks;
  const pa30 = s30.atBats + s30.walks;
  
  return {
    // Volume
    games7d: s7.games,
    games14d: s14.games,
    games30d: s30.games,
    plateAppearances7d: pa7,
    plateAppearances14d: pa14,
    plateAppearances30d: pa30,
    
    // Performance
    battingAverage7d: s7.atBats > 0 ? s7.hits / s7.atBats : null,
    battingAverage14d: s14.atBats > 0 ? s14.hits / s14.atBats : null,
    battingAverage30d: s30.atBats > 0 ? s30.hits / s30.atBats : null,
    
    // Discipline
    kRate7d: pa7 > 0 ? s7.strikeouts / pa7 : null,
    kRate14d: pa14 > 0 ? s14.strikeouts / pa14 : null,
    kRate30d: pa30 > 0 ? s30.strikeouts / pa30 : null,
    bbRate7d: pa7 > 0 ? s7.walks / pa7 : null,
    bbRate14d: pa14 > 0 ? s14.walks / pa14 : null,
    bbRate30d: pa30 > 0 ? s30.walks / pa30 : null,
    
    // Stabilization flags (rough thresholds)
    stabilizationFlags: {
      battingAverage: pa30 >= 100,
      kRate: pa30 >= 60,
      bbRate: pa30 >= 60,
    },
    
    // Volatility (coefficient of variation over 7d vs 30d)
    volatility: {
      battingAverage: s7.atBats > 10 && s30.atBats > 50 
        ? Math.abs((s7.hits/s7.atBats) - (s30.hits/s30.atBats)) 
        : null,
    },
    
    computedAt: new Date(),
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
      // Get all stats for this player
      const stats = await prisma.playerDailyStats.findMany({
        where: {
          playerMlbamId: player.playerMlbamId,
          season: SEASON,
        },
      });
      
      if (stats.length === 0) continue;
      
      // Compute features
      const features = computeFeatures(stats);
      
      // Store in database
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
          rawStatsUsed: stats.length,
          computedDate: new Date(),
          updatedAt: new Date(),
        },
        create: {
          playerMlbamId: player.playerMlbamId,
          playerId: player.playerId,
          season: SEASON,
          ...features,
          rawStatsUsed: stats.length,
          computedDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      
      computed++;
      if (computed % 50 === 0) {
        process.stdout.write(`  ${computed}/${players.length}\r`);
      }
    } catch (error) {
      errors++;
      console.log(`\n  ⚠️ Error for ${player.playerMlbamId}: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Computed features for ${computed} players`);
  if (errors > 0) {
    console.log(`⚠️ ${errors} errors`);
  }
  
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
