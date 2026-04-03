/**
 * Backfill Game Logs (Small Batch)
 * 
 * Processes game logs in small batches with progress tracking.
 * Use this to continue backfilling after initial run.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { ingestGameLogsForPlayers } from '../apps/worker/src/ingestion/index.js';

const season = parseInt(process.argv[2] || '2025');
const limit = parseInt(process.argv[3] || '50'); // Default to 50 players

async function backfillGameLogsSmall() {
  console.log(`\n📊 Backfilling Game Logs (Small Batch)`);
  console.log(`Season: ${season}, Limit: ${limit} players\n`);

  // Get players still needing game logs
  const [allPlayers, playersWithLogs] = await Promise.all([
    prisma.playerDailyStats.findMany({
      where: { season, rawDataSource: 'mlb_stats_api' },
      distinct: ['playerMlbamId'],
      select: { playerId: true, playerMlbamId: true },
    }),
    prisma.playerGameLog.groupBy({
      by: ['playerMlbamId'],
      where: { season },
    }),
  ]);

  const playersWithLogsSet = new Set(playersWithLogs.map(p => p.playerMlbamId));
  const playersNeedingLogs = allPlayers
    .filter(p => !playersWithLogsSet.has(p.playerMlbamId))
    .slice(0, limit);

  console.log(`Total players: ${allPlayers.length}`);
  console.log(`With game logs: ${playersWithLogs.length}`);
  console.log(`Needing logs: ${allPlayers.length - playersWithLogs.length}`);
  console.log(`This batch: ${playersNeedingLogs.length}\n`);

  if (playersNeedingLogs.length === 0) {
    console.log('✅ All players have game logs!');
    return;
  }

  const traceId = `backfill-${season}-${Date.now()}`;
  console.log('Processing...\n');

  const result = await ingestGameLogsForPlayers(
    playersNeedingLogs.map(p => ({ playerId: p.playerId, mlbamId: p.playerMlbamId })),
    season,
    traceId
  );

  console.log(`✅ Batch complete!`);
  console.log(`   Players: ${result.totalPlayers}`);
  console.log(`   Games: ${result.totalGames}`);
  
  if (result.errors.length > 0) {
    console.log(`   Errors: ${result.errors.length} (showing first 3)`);
    result.errors.slice(0, 3).forEach(e => console.log(`     - ${e}`));
  }

  // Show updated counts
  const finalCount = await prisma.playerGameLog.count({ where: { season } });
  const finalPlayers = await prisma.playerGameLog.groupBy({
    by: ['playerMlbamId'],
    where: { season },
  });

  console.log(`\n📊 Updated totals:`);
  console.log(`   Total game logs: ${finalCount}`);
  console.log(`   Players with logs: ${finalPlayers.length}`);
  console.log(`   Remaining: ${allPlayers.length - finalPlayers.length}\n`);
}

backfillGameLogsSmall()
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
