#!/usr/bin/env node
/**
 * Quick DB Status Check
 */

import 'dotenv/config';
import { prisma } from './lib/prisma.js';
import { assertValidationEnvironment } from './lib/validation-preflight.js';

async function main() {
  const environment = await assertValidationEnvironment({
    requiredTables: ['player_daily_stats', 'player_derived_stats', 'raw_ingestion_logs', 'persisted_decisions'],
  });

  console.log('📊 Database Status\n');
  console.log(`Database: ${environment.databaseName} @ ${environment.databaseHost}\n`);

  const [
    playerDailyStats,
    playerDerivedStats,
    rawIngestionLog,
    persistedDecision,
  ] = await Promise.all([
    prisma.playerDailyStats.count(),
    prisma.playerDerivedStats.count(),
    prisma.rawIngestionLog.count(),
    prisma.persistedDecision.count(),
  ]);

  console.log(`PlayerDailyStats: ${playerDailyStats}`);
  console.log(`PlayerDerivedStats: ${playerDerivedStats}`);
  console.log(`RawIngestionLog: ${rawIngestionLog}`);
  console.log(`PersistedDecision: ${persistedDecision}`);

  // Check derived stats sample
  if (playerDerivedStats > 0) {
    console.log('\n📈 Sample Derived Stats:');
    const derived = await prisma.playerDerivedStats.findFirst({
      where: { season: 2025 },
      select: {
        playerMlbamId: true,
        season: true,
        gamesLast7: true,
        battingAverageLast30: true,
        strikeoutRateLast30: true,
        battingAverageReliable: true,
      },
    });
    console.log(JSON.stringify(derived, null, 2));
  }

  await prisma.$disconnect();
}

main();
