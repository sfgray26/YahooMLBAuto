#!/usr/bin/env node
/**
 * Find Corrupt Derived Stats Records
 * 
 * Finds all players with zero PA/null OPS in their latest derived stats.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

const season = 2025;

async function findCorruptRecords() {
  console.log('\n' + '='.repeat(80));
  console.log('  FINDING CORRUPT DERIVED STATS RECORDS');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}\n`);

  // Get the latest derived record for each player
  const allDerived = await prisma.playerDerivedStats.findMany({
    where: { season },
    orderBy: { computedAt: 'desc' }
  });

  // Group by player and get latest
  const byPlayer = new Map<string, typeof allDerived[0]>();
  for (const record of allDerived) {
    if (!byPlayer.has(record.playerMlbamId)) {
      byPlayer.set(record.playerMlbamId, record);
    }
  }

  console.log(`Total unique players: ${byPlayer.size}\n`);

  // Find corrupt records
  const corruptRecords = [];
  const zeroPA = [];
  const nullOPS = [];
  const zeroGames = [];

  for (const [playerId, record] of byPlayer) {
    if (record.plateAppearancesLast30 === 0) {
      zeroPA.push({ playerId, record });
    }
    if (record.opsLast30 === null) {
      nullOPS.push({ playerId, record });
    }
    if (record.gamesLast30 === 0) {
      zeroGames.push({ playerId, record });
    }
  }

  console.log('📊 CORRUPT RECORD ANALYSIS:');
  console.log(`  Players with 0 PA: ${zeroPA.length}`);
  console.log(`  Players with null OPS: ${nullOPS.length}`);
  console.log(`  Players with 0 games: ${zeroGames.length}`);

  // Get names for corrupt players
  if (zeroPA.length > 0) {
    console.log('\n🔴 Players with ZERO PA in latest derived record:');
    console.log('-'.repeat(80));
    
    for (const { playerId, record } of zeroPA.slice(0, 20)) {
      const vp = await prisma.verifiedPlayer.findUnique({
        where: { mlbamId: playerId },
        select: { fullName: true }
      });
      const name = vp?.fullName || playerId;
      
      // Check if they have game logs
      const gameLogCount = await prisma.playerGameLog.count({
        where: { playerMlbamId: playerId, season }
      });
      
      console.log(`  ${name.padEnd(25)} | ${playerId} | Games: ${record.gamesLast30} | PA: ${record.plateAppearancesLast30} | Has Game Logs: ${gameLogCount > 0 ? 'YES' : 'NO'}`);
    }
    
    if (zeroPA.length > 20) {
      console.log(`  ... and ${zeroPA.length - 20} more`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  
  if (zeroPA.length === 0) {
    console.log('\n✅ NO CORRUPT RECORDS FOUND');
  } else {
    console.log(`\n⚠️  ${zeroPA.length} players have corrupt (zero PA) derived records`);
    console.log('   These need to be fixed by recomputing derived stats');
  }

  await prisma.$disconnect();
}

findCorruptRecords().catch(e => {
  console.error(e);
  process.exit(1);
});
