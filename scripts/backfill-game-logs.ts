/**
 * Backfill Game Logs
 * 
 * This script ingests game logs for all players that already have season stats.
 * Use this to populate the game_log table if it was missed during initial ingestion.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { ingestGameLogsForPlayers } from '../apps/worker/src/ingestion/index.js';

const season = parseInt(process.argv[2] || '2025');
const batchSize = parseInt(process.argv[3] || '100');

async function backfillGameLogs() {
  console.log(`\n📊 Backfilling Game Logs for Season ${season}\n`);

  // Get all players with season stats but potentially missing game logs
  const players = await prisma.playerDailyStats.findMany({
    where: { 
      season,
      rawDataSource: 'mlb_stats_api',
    },
    distinct: ['playerMlbamId'],
    select: {
      playerId: true,
      playerMlbamId: true,
    },
  });

  console.log(`Found ${players.length} players with season stats`);

  // Check how many already have game logs
  const playersWithGameLogs = await prisma.playerGameLog.groupBy({
    by: ['playerMlbamId'],
    where: { season },
  });
  const playersWithLogsSet = new Set(playersWithGameLogs.map(p => p.playerMlbamId));

  // Filter to players missing game logs
  const playersNeedingLogs = players.filter(p => !playersWithLogsSet.has(p.playerMlbamId));
  
  console.log(`Players already with game logs: ${playersWithGameLogs.length}`);
  console.log(`Players needing game logs: ${playersNeedingLogs.length}\n`);

  if (playersNeedingLogs.length === 0) {
    console.log('✅ All players already have game logs!');
    return;
  }

  // Process in batches
  const traceId = `backfill-${season}-${Date.now()}`;
  let totalProcessed = 0;
  let totalGames = 0;
  const errors: string[] = [];

  for (let i = 0; i < playersNeedingLogs.length; i += batchSize) {
    const batch = playersNeedingLogs.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(playersNeedingLogs.length / batchSize)} (${batch.length} players)...`);

    const result = await ingestGameLogsForPlayers(
      batch.map(p => ({ playerId: p.playerId, mlbamId: p.playerMlbamId })),
      season,
      traceId
    );

    totalProcessed += result.totalPlayers;
    totalGames += result.totalGames;
    errors.push(...result.errors);

    console.log(`  ✅ ${result.totalGames} games ingested`);
    
    if (result.errors.length > 0) {
      console.log(`  ⚠️  ${result.errors.length} errors (showing first 3):`);
      result.errors.slice(0, 3).forEach(e => console.log(`     - ${e}`));
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < playersNeedingLogs.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`\nTotal players processed: ${totalProcessed}`);
  console.log(`Total games ingested: ${totalGames}`);
  console.log(`Total errors: ${errors.length}\n`);

  // Final count
  const finalGameLogCount = await prisma.playerGameLog.count({ where: { season } });
  console.log(`Final game log count: ${finalGameLogCount}\n`);
}

backfillGameLogs()
  .catch(error => {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
