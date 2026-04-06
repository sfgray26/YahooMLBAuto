#!/usr/bin/env node
/**
 * Simple Database Connection Test
 * Tests Prisma connection to the configured PostgreSQL instance without Redis dependency
 */

import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from './lib/prisma.js';
import { assertValidationEnvironment } from './lib/validation-preflight.js';

async function main() {
  const startTime = Date.now();
  console.log('🧪 Testing Database Connection...\n');

  try {
    const environment = await assertValidationEnvironment({
      requiredTables: [
        'persisted_decisions',
        'lineup_decision_details',
        'waiver_decision_details',
        'player_daily_stats',
        'raw_ingestion_logs',
      ],
    });
    console.log(`Database: ${environment.databaseName} @ ${environment.databaseHost}\n`);

    // Test 1: Basic connection
    console.log('1️⃣ Testing basic connection...');
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('   ✅ Database connection successful\n');

    // Test 2: Count tables
    console.log('2️⃣ Counting records in key tables...');
    const [
      persistedDecisionCount,
      lineupDetailCount,
      waiverDetailCount,
      playerDailyStatsCount,
      rawIngestionLogCount,
    ] = await Promise.all([
      prisma.persistedDecision.count(),
      prisma.lineupDecisionDetail.count(),
      prisma.waiverDecisionDetail.count(),
      prisma.playerDailyStats.count(),
      prisma.rawIngestionLog.count(),
    ]);

    console.log(`   📊 PersistedDecision: ${persistedDecisionCount}`);
    console.log(`   📊 LineupDecisionDetail: ${lineupDetailCount}`);
    console.log(`   📊 WaiverDecisionDetail: ${waiverDetailCount}`);
    console.log(`   📊 PlayerDailyStats: ${playerDailyStatsCount}`);
    console.log(`   📊 RawIngestionLog: ${rawIngestionLogCount}\n`);

    // Test 3: Create a test decision
    console.log('3️⃣ Creating test decision...');
    const testDecision = await prisma.persistedDecision.create({
      data: {
        decisionId: `test-${Date.now()}`,
        decisionType: 'lineup',
        teamId: 'test-team',
        leagueId: 'test-league',
        season: 2025,
        status: 'pending',
        confidence: 0.85,
        confidenceFactors: ['validation:test'],
        teamStateSnapshot: { test: true, source: 'connection-test' },
        scoresSnapshot: {},
        monteCarloData: {},
        decisionPayload: { message: 'Test decision from connection test' },
        traceId: uuidv4(),
        reason: 'Validation smoke test',
      },
    });
    console.log(`   ✅ Created decision: ${testDecision.decisionId}\n`);

    // Test 4: Query the decision back
    console.log('4️⃣ Querying decision back...');
    const queriedDecision = await prisma.persistedDecision.findUnique({
      where: { id: testDecision.id },
    });
    console.log(`   ✅ Found decision: ${queriedDecision?.decisionId}\n`);

    // Test 5: Clean up test data
    console.log('5️⃣ Cleaning up test data...');
    await prisma.persistedDecision.delete({
      where: { id: testDecision.id },
    });
    console.log('   ✅ Test data cleaned up\n');

    const durationMs = Date.now() - startTime;
    console.log('✨ All tests passed!');
    console.log(`⏱️  Duration: ${durationMs}ms`);
    console.log('\n🎯 Database is ready for use!');

    return { success: true, durationMs };
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await prisma.$disconnect();
  }
}

main().then((result) => {
  process.exit(result.success ? 0 : 1);
});
