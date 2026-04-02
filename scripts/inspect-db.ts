#!/usr/bin/env node
/**
 * Database Data Inspection
 * Shows what's already in the Railway database
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Railway Database Contents\n');

  try {
    // Count all tables
    const counts = await Promise.all([
      prisma.persistedDecision.count(),
      prisma.lineupDecisionDetail.count(),
      prisma.waiverDecisionDetail.count(),
      prisma.playerDailyStats.count(),
      prisma.playerDerivedStats.count(),
      prisma.rawIngestionLog.count(),
      prisma.executionDecision.count(),
    ]);

    console.log('📊 Table Counts:');
    console.log(`   PersistedDecision: ${counts[0]}`);
    console.log(`   LineupDecisionDetail: ${counts[1]}`);
    console.log(`   WaiverDecisionDetail: ${counts[2]}`);
    console.log(`   PlayerDailyStats: ${counts[3]}`);
    console.log(`   PlayerDerivedStats: ${counts[4]}`);
    console.log(`   RawIngestionLog: ${counts[5]}`);
    console.log(`   ExecutionDecision: ${counts[6]}\n`);

    // Show sample player data
    if (counts[3] > 0) {
      console.log('🧢 Sample PlayerDailyStats:');
      const players = await prisma.playerDailyStats.findMany({
        take: 5,
        select: {
          playerMlbamId: true,
          playerName: true,
          team: true,
          season: true,
          gamesPlayed: true,
          battingAverage: true,
          homeRuns: true,
        },
      });
      players.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.playerName} (${p.team}) - ${p.gamesPlayed} G, ${p.battingAverage} AVG, ${p.homeRuns} HR`);
      });
      console.log('');
    }

    // Show raw ingestion logs
    if (counts[5] > 0) {
      console.log('📥 Raw Ingestion Logs:');
      const logs = await prisma.rawIngestionLog.findMany({
        take: 3,
        orderBy: { fetchedAt: 'desc' },
        select: {
          source: true,
          endpoint: true,
          season: true,
          recordCount: true,
          fetchedAt: true,
        },
      });
      logs.forEach((log, i) => {
        console.log(`   ${i + 1}. ${log.source} (${log.season}) - ${log.recordCount} records at ${log.fetchedAt.toISOString()}`);
      });
      console.log('');
    }

    // Show decisions
    if (counts[0] > 0) {
      console.log('🎯 Persisted Decisions:');
      const decisions = await prisma.persistedDecision.findMany({
        take: 3,
        select: {
          decisionType: true,
          teamId: true,
          status: true,
          confidence: true,
          createdAt: true,
        },
      });
      decisions.forEach((d, i) => {
        console.log(`   ${i + 1}. ${d.decisionType} - ${d.status} (confidence: ${d.confidence})`);
      });
    }

    console.log('\n✅ Database inspection complete!');
    return { success: true };
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    return { success: false, error };
  } finally {
    await prisma.$disconnect();
  }
}

main().then((result) => {
  process.exit(result.success ? 0 : 1);
});
