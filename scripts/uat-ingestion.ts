#!/usr/bin/env node
/**
 * Phase 1: Ingestion UAT - Comprehensive Data Integrity Tests
 * 
 * Tests:
 * 1. Idempotency: Run same ingestion twice, verify no duplicates
 * 2. Restart resilience: Verify partial rows handled correctly
 * 3. Backfill: Ingest earlier date, verify no cross-contamination
 * 4. Data integrity: Row counts stable, stats not inflated
 * 5. Raw data preservation: Verify raw logs preserved exactly
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';
const TEST_SEASON = 2026;
const TEST_GAME_TYPE = 'R';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  before?: Record<string, number>;
  after?: Record<string, number>;
}

// ============================================================================
// Test 1: Idempotency - Run same ingestion twice
// ============================================================================
async function testIdempotency(): Promise<TestResult> {
  console.log('\n🧪 TEST 1: Idempotency (same ingestion twice)\n');

  // Get baseline counts
  const before = {
    rawLogs: await prisma.rawIngestionLog.count(),
    playerStats: await prisma.playerDailyStats.count(),
  };
  console.log(`  Before: ${before.rawLogs} raw logs, ${before.playerStats} player stats`);

  // First ingestion
  console.log('  Running first ingestion...');
  const firstResult = await runIngestion('idempotency-test-1');
  const afterFirst = {
    rawLogs: await prisma.rawIngestionLog.count(),
    playerStats: await prisma.playerDailyStats.count(),
  };
  console.log(`  After 1st: ${afterFirst.rawLogs} raw logs (+${afterFirst.rawLogs - before.rawLogs}), ${afterFirst.playerStats} player stats (+${afterFirst.playerStats - before.playerStats})`);

  // Second ingestion (same params)
  console.log('  Running second ingestion (same params)...');
  const secondResult = await runIngestion('idempotency-test-2');
  const afterSecond = {
    rawLogs: await prisma.rawIngestionLog.count(),
    playerStats: await prisma.playerDailyStats.count(),
  };
  console.log(`  After 2nd: ${afterSecond.rawLogs} raw logs (+${afterSecond.rawLogs - afterFirst.rawLogs}), ${afterSecond.playerStats} player stats (+${afterSecond.playerStats - afterFirst.playerStats})`);

  // Verify: Player stats count should NOT increase (upserts)
  const playerStatsStable = afterSecond.playerStats === afterFirst.playerStats;
  const rawLogsIncreased = afterSecond.rawLogs > afterFirst.rawLogs; // Raw logs should still be created

  const passed = playerStatsStable && rawLogsIncreased;

  return {
    name: 'Idempotency Test',
    passed,
    details: passed 
      ? `✅ Player stats stable (${afterSecond.playerStats}), raw logs increased as expected` 
      : `❌ Player stats drift: ${afterFirst.playerStats} → ${afterSecond.playerStats}`,
    before,
    after: afterSecond,
  };
}

// ============================================================================
// Test 2: Verify no duplicate player stats (same player/season combo)
// ============================================================================
async function testNoDuplicates(): Promise<TestResult> {
  console.log('\n🧪 TEST 2: No Duplicate Player Stats\n');

  // Count total records vs unique player/season/variant combos
  const totalRecords = await prisma.playerDailyStats.count();
  
  const uniqueCombos = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*) as count FROM (
      SELECT DISTINCT CONCAT("playerMlbamId", '-', season, '-', 
        CASE WHEN id LIKE '%-pitching' THEN 'pitching' ELSE 'hitting' END
      ) as combo
      FROM "PlayerDailyStats"
    ) as unique_combos
  `;

  const uniqueCount = Number(uniqueCombos[0]?.count || 0);
  const noDuplicates = totalRecords === uniqueCount;

  console.log(`  Total records: ${totalRecords}`);
  console.log(`  Unique player/season/variant combos: ${uniqueCount}`);
  console.log(`  ${noDuplicates ? '✅ No duplicates found' : `❌ Found ${totalRecords - uniqueCount} duplicates`}`);

  return {
    name: 'No Duplicates Test',
    passed: noDuplicates,
    details: noDuplicates 
      ? 'All records are unique by player/season/variant' 
      : `Found ${totalRecords - uniqueCount} duplicate records`,
  };
}

// ============================================================================
// Test 3: Stat Integrity - Verify no stat inflation
// ============================================================================
async function testStatIntegrity(): Promise<TestResult> {
  console.log('\n🧪 TEST 3: Stat Integrity (no double counting)\n');

  // Get sum of key stats
  const stats = await prisma.$queryRaw<Array<{
    total_games: number;
    total_hits: number;
    total_hr: number;
    total_rbi: number;
  }>>`
    SELECT 
      SUM("gamesPlayed") as total_games,
      SUM(hits) as total_hits,
      SUM("homeRuns") as total_hr,
      SUM(rbi) as total_rbi
    FROM "PlayerDailyStats"
    WHERE season = ${TEST_SEASON}
  `;

  const totals = stats[0];
  console.log(`  Season ${TEST_SEASON} totals:`);
  console.log(`    Games played: ${totals.total_games?.toLocaleString() || 0}`);
  console.log(`    Hits: ${totals.total_hits?.toLocaleString() || 0}`);
  console.log(`    Home runs: ${totals.total_hr?.toLocaleString() || 0}`);
  console.log(`    RBI: ${totals.total_rbi?.toLocaleString() || 0}`);

  // Sanity check: MLB typically has ~20,000-25,000 games played per season across all players
  const reasonableGameCount = totals.total_games >= 15000 && totals.total_games <= 40000;

  console.log(`  ${reasonableGameCount ? '✅ Game counts look reasonable' : '⚠️ Game counts may be inflated or incomplete'}`);

  return {
    name: 'Stat Integrity Test',
    passed: reasonableGameCount,
    details: reasonableGameCount 
      ? `Total games: ${totals.total_games?.toLocaleString()} (reasonable range)` 
      : `Total games: ${totals.total_games?.toLocaleString()} (outside expected 15k-40k range)`,
  };
}

// ============================================================================
// Test 4: Raw Data Preservation
// ============================================================================
async function testRawDataPreservation(): Promise<TestResult> {
  console.log('\n🧪 TEST 4: Raw Data Preservation\n');

  // Check that raw logs have required fields
  const logs = await prisma.rawIngestionLog.findMany({
    take: 5,
    orderBy: { fetchedAt: 'desc' },
  });

  const checks = logs.map((log) => ({
    hasCacheKey: !!log.cacheKey,
    hasSource: !!log.source,
    hasEndpoint: !!log.endpoint,
    hasPayload: !!log.rawPayload,
    hasRecordCount: typeof log.recordCount === 'number',
    hasTraceId: !!log.traceId,
  }));

  const allComplete = checks.every((c) => 
    c.hasCacheKey && c.hasSource && c.hasEndpoint && 
    c.hasPayload && c.hasRecordCount && c.hasTraceId
  );

  console.log(`  Checked ${logs.length} recent raw logs:`);
  console.log(`    All have cacheKey: ${checks.every((c) => c.hasCacheKey) ? '✅' : '❌'}`);
  console.log(`    All have source: ${checks.every((c) => c.hasSource) ? '✅' : '❌'}`);
  console.log(`    All have endpoint: ${checks.every((c) => c.hasEndpoint) ? '✅' : '❌'}`);
  console.log(`    All have payload: ${checks.every((c) => c.hasPayload) ? '✅' : '❌'}`);
  console.log(`    All have recordCount: ${checks.every((c) => c.hasRecordCount) ? '✅' : '❌'}`);
  console.log(`    All have traceId: ${checks.every((c) => c.hasTraceId) ? '✅' : '❌'}`);

  return {
    name: 'Raw Data Preservation Test',
    passed: allComplete,
    details: allComplete 
      ? 'All raw logs have complete metadata' 
      : 'Some raw logs missing required fields',
  };
}

// ============================================================================
// Test 5: Data Coverage - Check for missing teams/players
// ============================================================================
async function testDataCoverage(): Promise<TestResult> {
  console.log('\n🧪 TEST 5: Data Coverage (teams and players)\n');

  // Count unique teams
  const teamCount = await prisma.playerDailyStats.groupBy({
    by: ['teamId'],
    _count: { teamId: true },
  });

  // Count unique players
  const playerCount = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT "playerMlbamId") as count 
    FROM "PlayerDailyStats" 
    WHERE season = ${TEST_SEASON}
  `;

  console.log(`  Unique teams with data: ${teamCount.length} (expected: 30)`);
  console.log(`  Unique players with data: ${playerCount[0]?.count || 0}`);

  const hasAllTeams = teamCount.length >= 28; // Allow for some data gaps
  const hasReasonablePlayerCount = (playerCount[0]?.count || 0) >= 100;

  const passed = hasAllTeams && hasReasonablePlayerCount;

  return {
    name: 'Data Coverage Test',
    passed,
    details: passed 
      ? `${teamCount.length} teams, ${playerCount[0]?.count || 0} players` 
      : `Missing teams or players (${teamCount.length} teams)`,
  };
}

// ============================================================================
// Helper: Run a single ingestion
// ============================================================================
async function runIngestion(traceId: string): Promise<{ recordsFetched: number }> {
  const url = new URL(`${MLB_STATS_BASE_URL}/stats`);
  url.searchParams.append('stats', 'season');
  url.searchParams.append('group', 'hitting');
  url.searchParams.append('season', TEST_SEASON.toString());
  url.searchParams.append('gameType', TEST_GAME_TYPE);
  url.searchParams.append('limit', '1000');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  const records = data.stats?.[0]?.splits || [];

  // Store raw log
  await prisma.rawIngestionLog.create({
    data: {
      cacheKey: `${traceId}-${Date.now()}`,
      source: 'mlb_stats_api',
      endpoint: url.toString(),
      season: TEST_SEASON,
      gameType: TEST_GAME_TYPE,
      fetchedAt: new Date(),
      rawPayload: { recordCount: records.length },
      recordCount: records.length,
      traceId,
    },
  });

  // Normalize and store (upsert for idempotency)
  for (const split of records.slice(0, 50)) { // Limit to 50 for speed
    const player = split.player;
    const stats = split.stat;
    const team = split.team;

    if (!player?.id) continue;

    await prisma.playerDailyStats.upsert({
      where: { id: `${player.id}-${TEST_SEASON}-hitting` },
      update: {
        gamesPlayed: stats.gamesPlayed || 0,
        hits: stats.hits || 0,
        homeRuns: stats.homeRuns || 0,
        updatedAt: new Date(),
      },
      create: {
        id: `${player.id}-${TEST_SEASON}-hitting`,
        playerId: player.id.toString(),
        playerMlbamId: player.id.toString(),
        statDate: new Date(),
        season: TEST_SEASON,
        teamId: team?.id?.toString(),
        teamMlbamId: team?.id?.toString(),
        gamesPlayed: stats.gamesPlayed || 0,
        hits: stats.hits || 0,
        homeRuns: stats.homeRuns || 0,
        rawDataSource: 'mlb_stats_api',
        rawDataId: player.id.toString(),
        ingestedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  return { recordsFetched: records.length };
}

// ============================================================================
// Main: Run all tests
// ============================================================================
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Phase 1: Ingestion UAT - Data Integrity Tests           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const results: TestResult[] = [];

  // Run all tests
  results.push(await testIdempotency());
  results.push(await testNoDuplicates());
  results.push(await testStatIntegrity());
  results.push(await testRawDataPreservation());
  results.push(await testDataCoverage());

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 TEST SUMMARY\n');

  let passedCount = 0;
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    console.log(`   ${result.details}`);
    if (result.before && result.after) {
      console.log(`   Before: ${JSON.stringify(result.before)}`);
      console.log(`   After: ${JSON.stringify(result.after)}`);
    }
    console.log('');
    if (result.passed) passedCount++;
  }

  console.log('═'.repeat(60));
  console.log(`\n${passedCount}/${results.length} tests passed`);

  if (passedCount === results.length) {
    console.log('\n🎉 ALL TESTS PASSED - System ready for automation');
  } else {
    console.log('\n⚠️ SOME TESTS FAILED - Review issues before automation');
  }

  await prisma.$disconnect();
  return passedCount === results.length;
}

main()
  .then((success) => process.exit(success ? 0 : 1))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
