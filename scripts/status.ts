#!/usr/bin/env node
/**
 * Quick DB Status Check
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('📊 Database Status\n');

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
