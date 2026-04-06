#!/usr/bin/env node
/**
 * Debug Aaron Judge Game Logs
 * 
 * Investigates if Aaron Judge has game logs and why derived stats are zeros.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

const season = 2025;

async function debugJudge() {
  console.log('\n' + '='.repeat(80));
  console.log('  DEBUGGING: Aaron Judge Game Logs & Derived Stats');
  console.log('='.repeat(80));

  // Check 1: Does Judge have game logs?
  console.log('\n1️⃣ CHECKING GAME LOGS...\n');
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId: '592450', season },
    orderBy: { gameDate: 'desc' }
  });

  console.log(`Found ${gameLogs.length} game logs`);
  
  if (gameLogs.length > 0) {
    console.log('\nLast 5 games:');
    gameLogs.slice(0, 5).forEach((g, i) => {
      console.log(`  ${i+1}. ${g.gameDate.toISOString().split('T')[0]}: ${g.atBats} AB, ${g.hits} H, ${g.plateAppearances} PA`);
    });
    
    // Calculate totals manually
    const totalPA = gameLogs.reduce((sum, g) => sum + g.plateAppearances, 0);
    const totalGames = gameLogs.length;
    console.log(`\nTotals from game logs:`);
    console.log(`  Total Games: ${totalGames}`);
    console.log(`  Total PA: ${totalPA}`);
  } else {
    console.log('❌ NO GAME LOGS FOUND!');
  }

  // Check 2: Look at ALL derived stats for Judge
  console.log('\n2️⃣ CHECKING DERIVED STATS RECORDS...\n');
  const allDerived = await prisma.playerDerivedStats.findMany({
    where: { playerMlbamId: '592450', season },
    orderBy: { computedAt: 'desc' }
  });

  console.log(`Found ${allDerived.length} derived stat records`);
  
  for (let i = 0; i < Math.min(allDerived.length, 3); i++) {
    const d = allDerived[i];
    console.log(`\nRecord ${i+1} (computed: ${d.computedAt.toISOString()}):`);
    console.log(`  Games: ${d.gamesLast30} | PA: ${d.plateAppearancesLast30}`);
    console.log(`  AVG: ${d.battingAverageLast30} | OPS: ${d.opsLast30}`);
    console.log(`  Status: ${d.plateAppearancesLast30 === 0 ? '❌ ZERO DATA' : '✅ Has data'}`);
  }

  // Check 3: Compare with working player (Juan Soto)
  console.log('\n3️⃣ COMPARISON WITH JUAN SOTO (working)...\n');
  const sotoGameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId: '665742', season },
    take: 1
  });
  
  const sotoDerived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId: '665742', season },
    orderBy: { computedAt: 'desc' }
  });

  console.log(`Juan Soto:`);
  console.log(`  Game logs: ${sotoGameLogs.length} found`);
  console.log(`  Derived: ${sotoDerived ? `${sotoDerived.plateAppearancesLast30} PA, ${sotoDerived.opsLast30} OPS` : 'None'}`);

  // Check 4: Look at player identity
  console.log('\n4️⃣ CHECKING PLAYER IDENTITY...\n');
  const verified = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId: '592450' },
    select: { fullName: true, position: true }
  });
  
  console.log(`Verified Player Record:`);
  console.log(`  Name: ${verified?.fullName || 'NOT FOUND'}`);
  console.log(`  Position: ${verified?.position || 'NOT FOUND'}`);

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('  DIAGNOSIS');
  console.log('='.repeat(80));
  
  if (gameLogs.length === 0) {
    console.log('\n❌ ROOT CAUSE: Aaron Judge has NO GAME LOGS');
    console.log('   This is why derived stats are all zeros');
    console.log('   Need to re-fetch game logs from MLB API');
  } else if (gameLogs.length > 0 && allDerived.length > 0 && allDerived[0].plateAppearancesLast30 === 0) {
    console.log('\n❌ ROOT CAUSE: Game logs exist but derived stats calculation failed');
    console.log(`   Game logs: ${gameLogs.length} games`);
    console.log(`   Latest derived: ${allDerived[0].computedAt.toISOString()}`);
    console.log('   The recompute script created a corrupt record');
    console.log('   Need to delete and recompute derived stats');
  }

  await prisma.$disconnect();
}

debugJudge().catch(e => {
  console.error(e);
  process.exit(1);
});
