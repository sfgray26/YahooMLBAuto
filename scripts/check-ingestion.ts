#!/usr/bin/env node
/**
 * Check Ingestion Log Details
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('📥 Checking Ingestion Log\n');

  try {
    const logs = await prisma.rawIngestionLog.findMany({
      orderBy: { fetchedAt: 'desc' },
    });

    console.log(`Found ${logs.length} ingestion log(s)\n`);

    for (const log of logs) {
      console.log('─'.repeat(60));
      console.log(`Source: ${log.source}`);
      console.log(`Endpoint: ${log.endpoint}`);
      console.log(`Season: ${log.season}`);
      console.log(`Game Type: ${log.gameType}`);
      console.log(`Record Count: ${log.recordCount}`);
      console.log(`Fetched At: ${log.fetchedAt.toISOString()}`);
      console.log(`Trace ID: ${log.traceId}`);
      console.log('');
    }

    // Count players by season
    console.log('\n📊 Players by Season:');
    const seasonCounts = await prisma.playerDailyStats.groupBy({
      by: ['season'],
      _count: { playerMlbamId: true },
    });
    seasonCounts.forEach((s) => {
      console.log(`   Season ${s.season}: ${s._count.playerMlbamId} players`);
    });

    // Sample players
    console.log('\n📊 Sample Players:');
    const players = await prisma.playerDailyStats.findMany({
      take: 10,
      select: {
        playerMlbamId: true,
        teamId: true,
        season: true,
        gamesPlayed: true,
        battingAvg: true,
        ops: true,
      },
    });
    players.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.playerMlbamId} (${p.teamId}) - ${p.gamesPlayed} G, ${p.battingAvg} AVG, ${p.ops} OPS`);
    });

    // Check for duplicate player IDs
    console.log('\n📊 Unique Players:');
    const uniquePlayers = await prisma.playerDailyStats.groupBy({
      by: ['playerMlbamId'],
      _count: { playerMlbamId: true },
    });
    console.log(`   Total unique playerMlbamIds: ${uniquePlayers.length}`);

    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
