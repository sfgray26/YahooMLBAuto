#!/usr/bin/env node
/**
 * Data Gap Analysis
 * 
 * Comprehensive check for missing or incomplete data across all layers:
 * - Players with daily stats but no game logs
 * - Players with game logs but no derived stats
 * - Players with derived stats but no scores
 * - Orphaned records
 * - Incomplete game log coverage
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

const season = 2025;

async function checkDataGaps() {
  console.log('\n' + '='.repeat(80));
  console.log('  DATA GAP ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}\n`);

  // Get all IDs from each layer
  console.log('📊 Collecting data from all layers...\n');

  const [dailyStatsPlayers, gameLogPlayers, derivedStatsPlayers] = await Promise.all([
    // Layer 1: Daily Stats
    prisma.playerDailyStats.findMany({
      where: { season },
      distinct: ['playerMlbamId'],
      select: { playerMlbamId: true, playerId: true }
    }),
    // Layer 2: Game Logs
    prisma.playerGameLog.groupBy({
      by: ['playerMlbamId'],
      where: { season }
    }),
    // Layer 3: Derived Stats
    prisma.playerDerivedStats.findMany({
      where: { season },
      distinct: ['playerMlbamId'],
      select: { playerMlbamId: true, computedAt: true }
    })
  ]);

  const dailyIds = new Set(dailyStatsPlayers.map(p => p.playerMlbamId));
  const gameLogIds = new Set(gameLogPlayers.map(p => p.playerMlbamId));
  const derivedIds = new Set(derivedStatsPlayers.map(p => p.playerMlbamId));

  console.log(`Layer 1 (Daily Stats): ${dailyIds.size} players`);
  console.log(`Layer 2 (Game Logs):   ${gameLogIds.size} players`);
  console.log(`Layer 3 (Derived):     ${derivedIds.size} players`);

  // Check 1: Players with daily stats but NO game logs
  const dailyButNoGameLogs = dailyStatsPlayers.filter(p => !gameLogIds.has(p.playerMlbamId));
  console.log(`\n🚫 GAP 1: Players with Daily Stats but NO Game Logs: ${dailyButNoGameLogs.length}`);
  if (dailyButNoGameLogs.length > 0) {
    console.log('   Sample (first 10):');
    for (const p of dailyButNoGameLogs.slice(0, 10)) {
      console.log(`      - ${p.playerMlbamId} (${p.playerId})`);
    }
  }

  // Check 2: Players with game logs but NO derived stats
  const gameLogsButNoDerived = gameLogPlayers.filter(p => !derivedIds.has(p.playerMlbamId));
  console.log(`\n🚫 GAP 2: Players with Game Logs but NO Derived Stats: ${gameLogsButNoDerived.length}`);
  if (gameLogsButNoDerived.length > 0) {
    console.log('   Sample (first 10):');
    for (const p of gameLogsButNoDerived.slice(0, 10)) {
      console.log(`      - ${p.playerMlbamId}`);
    }
  }

  // Check 3: Players with derived stats but NO game logs (shouldn't happen)
  const derivedButNoGameLogs = derivedStatsPlayers.filter(p => !gameLogIds.has(p.playerMlbamId));
  console.log(`\n🚫 GAP 3: Players with Derived Stats but NO Game Logs: ${derivedButNoGameLogs.length}`);
  if (derivedButNoGameLogs.length > 0) {
    console.log('   This indicates a data integrity issue!');
    for (const p of derivedButNoGameLogs.slice(0, 10)) {
      console.log(`      - ${p.playerMlbamId}`);
    }
  }

  // Check 4: Game log completeness (do players have reasonable game counts?)
  console.log('\n📊 Checking Game Log Completeness...');
  const gameLogCounts = await prisma.playerGameLog.groupBy({
    by: ['playerMlbamId'],
    where: { season },
    _count: { gamePk: true }
  });
  
  const lowGameCount = gameLogCounts.filter(g => g._count.gamePk < 10);
  const highGameCount = gameLogCounts.filter(g => g._count.gamePk > 30);
  
  console.log(`   Players with < 10 games: ${lowGameCount.length}`);
  console.log(`   Players with > 30 games: ${highGameCount.length} (possible double-counting?)`);

  // Check 5: Verified Player Registry coverage
  console.log('\n📊 Checking Verified Player Registry...');
  const verifiedPlayers = await prisma.verifiedPlayer.findMany({
    select: { mlbamId: true, fullName: true }
  });
  const verifiedIds = new Set(verifiedPlayers.map(p => p.mlbamId));
  
  const unverifiedInDerived = derivedStatsPlayers.filter(p => !verifiedIds.has(p.playerMlbamId));
  console.log(`   Players in Derived Stats but NOT in Verified Registry: ${unverifiedInDerived.length}`);

  // Check 6: Name quality in Verified Registry
  const badNames = verifiedPlayers.filter(p => 
    p.fullName.startsWith('mlbam:') || 
    p.fullName.startsWith('Unknown') ||
    p.fullName.includes('mlbam:')
  );
  console.log(`   Players with malformed names: ${badNames.length}`);

  // Check 7: Stale derived stats (older than 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleDerived = derivedStatsPlayers.filter(p => p.computedAt < oneDayAgo);
  console.log(`   Players with stale derived stats (> 24h old): ${staleDerived.length}`);

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('  GAP SUMMARY');
  console.log('='.repeat(80));
  
  const totalGaps = dailyButNoGameLogs.length + 
                    gameLogsButNoDerived.length + 
                    derivedButNoGameLogs.length +
                    unverifiedInDerived.length;

  if (totalGaps === 0) {
    console.log('\n✅ NO SIGNIFICANT GAPS DETECTED');
    console.log('   Data appears complete across all layers');
  } else {
    console.log(`\n⚠️  ${totalGaps} GAPS DETECTED`);
    console.log('   Action required to ensure data completeness');
  }

  await prisma.$disconnect();
}

checkDataGaps().catch(e => {
  console.error(e);
  process.exit(1);
});
