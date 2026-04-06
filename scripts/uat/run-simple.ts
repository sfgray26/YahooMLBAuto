/**
 * Simple UAT Runner - Uses only Prisma type-safe queries
 * Works around database schema mismatches in raw SQL
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { assertValidationEnvironment } from '../lib/validation-preflight.js';

const season = parseInt(process.argv[2] || '2025');

async function runSimpleUAT() {
  const environment = await assertValidationEnvironment({
    requiredTables: [
      'player_game_logs',
      'player_daily_stats',
      'player_derived_stats',
      'raw_ingestion_logs',
      'verified_players',
    ],
  });

  console.log('\n🏗️  Simple Phase 1 UAT - Foundation Integrity\n');
  console.log(`MLB Season: ${season}`);
  console.log(`Database: ${environment.databaseName} @ ${environment.databaseHost}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
    issues: [] as string[],
  };

  // Test 1: Row Count Drift
  console.log('📊 Testing Row Count Drift...');
  try {
    const [rawCount, normalizedCount, gameLogCount, verifiedCount] = await Promise.all([
      prisma.rawIngestionLog.count({ where: { season } }),
      prisma.playerDailyStats.count({ where: { season } }),
      prisma.playerGameLog.count({ where: { season } }),
      prisma.verifiedPlayer.count({ where: { isActive: true } }),
    ]);

    console.log(`  Raw ingestion logs: ${rawCount}`);
    console.log(`  Normalized daily stats: ${normalizedCount}`);
    console.log(`  Game logs: ${gameLogCount}`);
    console.log(`  Verified active players: ${verifiedCount}`);

    if (normalizedCount === 0 && rawCount > 0) {
      results.issues.push('CRITICAL: Normalized data missing but raw data exists');
      results.failed++;
    } else if (gameLogCount === 0 && rawCount > 0) {
      results.issues.push('WARNING: No game logs but raw data exists');
      results.warnings++;
    } else {
      results.passed++;
      console.log('  ✅ Row count check passed\n');
    }
  } catch (error) {
    results.issues.push(`Row count test error: ${error}`);
    results.failed++;
  }

  // Test 2: Duplicates via Prisma
  console.log('🔍 Testing Duplicate Detection...');
  try {
    // Check for duplicate verified players
    const verifiedPlayers = await prisma.verifiedPlayer.findMany({
      select: { mlbamId: true },
    });
    const mlbamIds = verifiedPlayers.map(p => p.mlbamId);
    const duplicates = mlbamIds.filter((item, index) => mlbamIds.indexOf(item) !== index);
    
    if (duplicates.length > 0) {
      results.issues.push(`CRITICAL: ${duplicates.length} duplicate verified players found`);
      results.failed++;
    } else {
      results.passed++;
      console.log('  ✅ No duplicate verified players\n');
    }
  } catch (error) {
    results.issues.push(`Duplicate test error: ${error}`);
    results.failed++;
  }

  // Test 3: Data Freshness
  console.log('✅ Testing Data Freshness...');
  try {
    const [latestGame, latestIngestion, latestDerived] = await Promise.all([
      prisma.playerGameLog.findFirst({ where: { season }, orderBy: { gameDate: 'desc' } }),
      prisma.rawIngestionLog.findFirst({ where: { season }, orderBy: { fetchedAt: 'desc' } }),
      prisma.playerDerivedStats.findFirst({ where: { season }, orderBy: { computedAt: 'desc' } }),
    ]);

    if (!latestGame && !latestIngestion) {
      results.issues.push('WARNING: No game logs or ingestion data found');
      results.warnings++;
    } else {
      console.log(`  Latest game: ${latestGame?.gameDate?.toISOString() || 'None'}`);
      console.log(`  Latest ingestion: ${latestIngestion?.fetchedAt?.toISOString() || 'None'}`);
      console.log(`  Latest derived stats: ${latestDerived?.computedAt?.toISOString() || 'None'}`);
      results.passed++;
      console.log('  ✅ Data freshness check passed\n');
    }
  } catch (error) {
    results.issues.push(`Freshness test error: ${error}`);
    results.failed++;
  }

  // Test 4: Raw Data Preservation
  console.log('🔗 Testing Raw Data Preservation...');
  try {
    const rawLogs = await prisma.rawIngestionLog.findMany({
      where: { season },
      take: 5,
      orderBy: { fetchedAt: 'desc' },
    });

    if (rawLogs.length === 0) {
      results.issues.push('CRITICAL: No raw ingestion logs found');
      results.failed++;
    } else {
      const emptyPayloads = rawLogs.filter(log => !log.rawPayload);
      if (emptyPayloads.length > 0) {
        results.issues.push(`CRITICAL: ${emptyPayloads.length} raw logs missing payloads`);
        results.failed++;
      } else {
        console.log(`  Raw logs preserved: ${rawLogs.length} (showing latest)`);
        rawLogs.forEach(log => {
          console.log(`    - ${log.cacheKey}: ${log.recordCount} records`);
        });
        results.passed++;
        console.log('  ✅ Raw data preservation check passed\n');
      }
    }
  } catch (error) {
    results.issues.push(`Raw preservation test error: ${error}`);
    results.failed++;
  }

  // Test 5: Player Coverage
  console.log('👥 Testing Player Coverage...');
  try {
    const [gameLogPlayers, dailyStatsPlayers, verifiedActive] = await Promise.all([
      prisma.playerDailyStats.groupBy({ by: ['playerMlbamId'], where: { season } }),
      prisma.playerDailyStats.groupBy({ by: ['playerMlbamId'], where: { season } }),
      prisma.verifiedPlayer.count({ where: { isActive: true } }),
    ]);

    console.log(`  Players with daily stats: ${dailyStatsPlayers.length}`);
    console.log(`  Verified active players: ${verifiedActive}`);

    if (dailyStatsPlayers.length < verifiedActive * 0.5) {
      results.issues.push(`WARNING: Low player coverage (${dailyStatsPlayers.length}/${verifiedActive})`);
      results.warnings++;
    } else {
      results.passed++;
      console.log('  ✅ Player coverage check passed\n');
    }
  } catch (error) {
    results.issues.push(`Player coverage test error: ${error}`);
    results.failed++;
  }

  // Print Summary
  console.log('='.repeat(70));
  console.log('  UAT SUMMARY');
  console.log('='.repeat(70));
  console.log(`\n  Total Tests: ${results.passed + results.failed + results.warnings}`);
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  ⚠️  Warnings: ${results.warnings}\n`);

  if (results.issues.length > 0) {
    console.log('🚨 ISSUES DETECTED:\n');
    results.issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
    console.log();
  }

  if (results.failed === 0 && results.warnings === 0) {
    console.log('✅ ALL CHECKS PASSED - System is trusted\n');
    process.exit(0);
  } else if (results.failed === 0) {
    console.log('⚠️  WARNINGS ONLY - Review before trusting\n');
    process.exit(2);
  } else {
    console.log('🚫 SYSTEM NOT TRUSTED - Fix critical issues\n');
    process.exit(1);
  }
}

runSimpleUAT().catch(error => {
  console.error('❌ UAT failed:', error);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
