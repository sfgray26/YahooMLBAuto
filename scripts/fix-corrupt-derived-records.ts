#!/usr/bin/env node
/**
 * Fix Corrupt Derived Stats Records
 * 
 * Deletes corrupt zero-PA records and recomputes derived stats properly.
 * Only recomputes for players with actual hitting game logs.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { computeDerivedStatsFromGameLogs } from '../apps/worker/src/derived/fromGameLogs';

const season = 2025;

async function fixCorruptRecords() {
  console.log('\n' + '='.repeat(80));
  console.log('  FIXING CORRUPT DERIVED STATS RECORDS');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}\n`);

  // Find all players with zero PA in their latest derived record
  const allDerived = await prisma.playerDerivedStats.findMany({
    where: { season },
    orderBy: { computedAt: 'desc' }
  });

  const byPlayer = new Map<string, typeof allDerived[0][]>();
  for (const record of allDerived) {
    if (!byPlayer.has(record.playerMlbamId)) {
      byPlayer.set(record.playerMlbamId, []);
    }
    byPlayer.get(record.playerMlbamId)!.push(record);
  }

  // Find players with corrupt latest record
  const corruptPlayers = [];
  for (const [playerId, records] of byPlayer) {
    const latest = records[0]; // Most recent
    if (latest.plateAppearancesLast30 === 0) {
      corruptPlayers.push({ 
        playerId, 
        latestRecord: latest,
        allRecords: records
      });
    }
  }

  console.log(`Found ${corruptPlayers.length} players with corrupt records\n`);

  let fixedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const { playerId, latestRecord, allRecords } of corruptPlayers) {
    process.stdout.write(`  ${playerId}: `);

    // Check if player has hitting game logs
    const gameLogs = await prisma.playerGameLog.findMany({
      where: { playerMlbamId: playerId, season },
      orderBy: { gameDate: 'desc' }
    });

    if (gameLogs.length === 0) {
      console.log('No game logs - deleting corrupt record');
      await prisma.playerDerivedStats.delete({
        where: { id: latestRecord.id }
      });
      skippedCount++;
      continue;
    }

    // Check total PA from game logs
    const totalPA = gameLogs.reduce((sum, g) => sum + g.plateAppearances, 0);
    
    if (totalPA === 0) {
      console.log('No PA in game logs (pitcher?) - deleting corrupt record');
      await prisma.playerDerivedStats.delete({
        where: { id: latestRecord.id }
      });
      skippedCount++;
      continue;
    }

    // Has hitting data - recompute derived stats
    try {
      // Delete corrupt record
      await prisma.playerDerivedStats.delete({
        where: { id: latestRecord.id }
      });

      // Recompute
      const result = await computeDerivedStatsFromGameLogs(
        latestRecord.playerId,
        playerId,
        season,
        undefined // Use latest game date
      );

      if (result) {
        console.log(`✅ Recomputed - ${result.gamesLast30}G, ${result.plateAppearancesLast30}PA`);
        fixedCount++;
      } else {
        console.log('⚠️ Recompute returned null');
        errorCount++;
      }
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  console.log(`Fixed: ${fixedCount}`);
  console.log(`Skipped (no hitting data): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);

  await prisma.$disconnect();
}

fixCorruptRecords().catch(e => {
  console.error(e);
  process.exit(1);
});
