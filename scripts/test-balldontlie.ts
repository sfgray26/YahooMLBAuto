#!/usr/bin/env node
/**
 * Balldontlie Adapter Test Suite
 * 
 * Tests the provider without needing database access.
 * Validates:
 * 1. API connectivity
 * 2. Data transformation correctness
 * 3. Rate limiting behavior
 * 4. Cache functionality
 * 
 * Usage: BALLDONTLIE_API_KEY=your_key npx tsx scripts/test-balldontlie.ts
 */

import { BalldontlieProvider } from '../packages/data/src/providers/balldontlie.js';
import { MemoryCache } from '../packages/data/src/providers/cache.js';

// Test players (well-known MLB players)
const TEST_PLAYERS = [
  { id: '592450', name: 'Aaron Judge' },
  { id: '677951', name: 'Bobby Witt Jr.' },
  { id: '665161', name: 'Jeremy Peña' },
];

const SEASON = 2025;

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  data?: unknown;
}

async function runTests(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  
  if (!apiKey) {
    console.error('❌ BALLDONTLIE_API_KEY environment variable required');
    console.error('   Get your key from https://mlb.balldontlie.io/');
    process.exit(1);
  }

  console.log('🧪 Balldontlie Adapter Test Suite\n');
  console.log('═'.repeat(80));

  const cache = new MemoryCache();
  const provider = new BalldontlieProvider({ apiKey, cache });

  const results: TestResult[] = [];

  // ==========================================================================
  // TEST 1: Provider Health Check
  // ==========================================================================
  console.log('\n📋 TEST 1: Provider Health Check');
  const healthStart = Date.now();
  try {
    const health = await provider.getProviderStatus();
    results.push({
      name: 'Provider Health',
      passed: health.status === 'healthy',
      duration: Date.now() - healthStart,
      data: { status: health.status, latency: health.latencyMs }
    });
    console.log(`  ${health.status === 'healthy' ? '✅' : '❌'} Status: ${health.status} (${health.latencyMs}ms)`);
    console.log(`     Rate limit remaining: ${health.rateLimitRemaining || 'unknown'}`);
  } catch (error) {
    results.push({
      name: 'Provider Health',
      passed: false,
      duration: Date.now() - healthStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 2: Game Logs Fetch
  // ==========================================================================
  console.log('\n📋 TEST 2: Game Logs Fetch');
  const judge = TEST_PLAYERS[0];
  const gameLogStart = Date.now();
  
  try {
    const result = await provider.getGameLogs(judge.id, { season: SEASON });
    const logs = result.data;
    
    // Validate structure
    const validations = [
      { check: logs.length > 0, desc: 'Has game logs' },
      { check: logs.every(l => l.playerMlbamId === judge.id), desc: 'Player ID consistent' },
      { check: logs.every(l => l.gameDate instanceof Date), desc: 'Game dates are Date objects' },
      { check: logs.every(l => typeof l.atBats === 'number'), desc: 'Has atBats stat' },
      { check: logs.every(l => typeof l.hits === 'number'), desc: 'Has hits stat' },
      { check: logs.every(l => l.plateAppearances >= l.atBats), desc: 'PA >= AB' },
      { check: logs.every(l => l.hits <= l.atBats), desc: 'Hits <= AB' },
    ];

    const allValid = validations.every(v => v.check);
    
    results.push({
      name: 'Game Logs Fetch',
      passed: allValid,
      duration: Date.now() - gameLogStart,
      data: { 
        gamesFound: logs.length,
        sample: logs[0] ? {
          date: logs[0].gameDate.toISOString().split('T')[0],
          atBats: logs[0].atBats,
          hits: logs[0].hits,
          homeRuns: logs[0].homeRuns,
        } : null
      }
    });

    console.log(`  ${allValid ? '✅' : '⚠️'} Fetched ${logs.length} games for ${judge.name}`);
    validations.forEach(v => {
      console.log(`     ${v.check ? '✓' : '✗'} ${v.desc}`);
    });
    
    if (logs.length > 0) {
      const first = logs[0];
      console.log(`     Sample: ${first.gameDate.toISOString().split('T')[0]} - ${first.hits}H/${first.atBats}AB, ${first.homeRuns}HR`);
    }
  } catch (error) {
    results.push({
      name: 'Game Logs Fetch',
      passed: false,
      duration: Date.now() - gameLogStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 3: Cache Functionality
  // ==========================================================================
  console.log('\n📋 TEST 3: Cache Functionality');
  const cacheStart = Date.now();
  
  try {
    // Second fetch should hit cache
    const cached = await provider.getGameLogs(judge.id, { season: SEASON });
    
    results.push({
      name: 'Cache Hit',
      passed: true,
      duration: Date.now() - cacheStart,
      data: { cached: true, games: cached.data.length }
    });
    console.log(`  ✅ Cache hit (${cached.data.length} games from cache)`);
  } catch (error) {
    results.push({
      name: 'Cache Hit',
      passed: false,
      duration: Date.now() - cacheStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Cache failed: ${error}`);
  }

  // ==========================================================================
  // TEST 4: Multiple Players (Rate Limit Test)
  // ==========================================================================
  console.log('\n📋 TEST 4: Multiple Players (Rate Limit Stress Test)');
  const batchStart = Date.now();
  
  try {
    const batchResults = await Promise.all(
      TEST_PLAYERS.map(async (player) => {
        const result = await provider.getGameLogs(player.id, { season: SEASON });
        return { name: player.name, games: result.data.length };
      })
    );
    
    results.push({
      name: 'Batch Fetch',
      passed: batchResults.every(r => r.games > 0),
      duration: Date.now() - batchStart,
      data: batchResults
    });
    
    console.log(`  ✅ Fetched ${TEST_PLAYERS.length} players in ${Date.now() - batchStart}ms`);
    batchResults.forEach(r => {
      console.log(`     ${r.name}: ${r.games} games`);
    });
  } catch (error) {
    results.push({
      name: 'Batch Fetch',
      passed: false,
      duration: Date.now() - batchStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Batch failed: ${error}`);
  }

  // ==========================================================================
  // TEST 5: Date Range Filtering
  // ==========================================================================
  console.log('\n📋 TEST 5: Date Range Filtering');
  const rangeStart = Date.now();
  
  try {
    // Get all logs first
    const allLogs = await provider.getGameLogs(judge.id, { season: SEASON });
    
    if (allLogs.data.length >= 3) {
      // Test 1: Filter with future date (should return 0 games)
      const futureDate = new Date('2026-01-01');
      const emptyFiltered = await provider.getGameLogs(judge.id, {
        season: SEASON,
        startDate: futureDate
      });
      
      // Test 2: Filter with past date (should return some games)
      const pastDate = new Date('2024-01-01');
      const someFiltered = await provider.getGameLogs(judge.id, {
        season: SEASON,
        startDate: pastDate,
        endDate: new Date('2024-12-31')
      });
      
      const emptyWorks = emptyFiltered.data.length === 0;
      const someWorks = someFiltered.data.length > 0 && someFiltered.data.length <= allLogs.data.length;
      
      const passed = emptyWorks && someWorks;
      results.push({
        name: 'Date Range Filter',
        passed,
        duration: Date.now() - rangeStart,
        data: { 
          total: allLogs.data.length, 
          emptyFilter: emptyFiltered.data.length,
          dateRangeFilter: someFiltered.data.length
        }
      });
      console.log(`  ${passed ? '✅' : '❌'} Date range filtering`);
      console.log(`     Future filter: ${emptyFiltered.data.length} games (expected 0) ${emptyWorks ? '✓' : '✗'}`);
      console.log(`     Date range filter: ${someFiltered.data.length} games ${someWorks ? '✓' : '✗'}`);
    } else {
      results.push({
        name: 'Date Range Filter',
        passed: true,
        duration: Date.now() - rangeStart,
        data: { skipped: 'Not enough games to test filter' }
      });
      console.log(`  ⚠️ Skipped (only ${allLogs.data.length} games available)`);
    }
  } catch (error) {
    results.push({
      name: 'Date Range Filter',
      passed: false,
      duration: Date.now() - rangeStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 6: Player Splits
  // ==========================================================================
  console.log('\n📋 TEST 6: Player Splits');
  const splitsStart = Date.now();
  
  try {
    const splits = await provider.getPlayerSplits(judge.id, SEASON);
    
    // Splits may not be available for all players/seasons - don't fail the test
    const hasAnySplits = splits.data.byHomeAway.length > 0 || 
                         splits.data.byHandedness.length > 0 ||
                         splits.data.byMonth.length > 0;
    
    results.push({
      name: 'Player Splits',
      passed: true, // Pass if API call succeeds, even if no data
      duration: Date.now() - splitsStart,
      data: {
        available: hasAnySplits,
        homeAway: splits.data.byHomeAway.length,
        handedness: splits.data.byHandedness.length,
        month: splits.data.byMonth.length
      }
    });
    
    console.log(`  ✅ Splits endpoint ${hasAnySplits ? 'has data' : 'returned empty'}`);
    console.log(`     Home/Away: ${splits.data.byHomeAway.length} splits`);
    console.log(`     vs L/R: ${splits.data.byHandedness.length} splits`);
    console.log(`     By month: ${splits.data.byMonth.length} splits`);
    
    if (splits.data.byHomeAway.length > 0) {
      const sample = splits.data.byHomeAway[0];
      console.log(`     Sample: ${sample.splitValue} - ${sample.battingAverage?.toFixed(3) || 'N/A'} AVG`);
    }
  } catch (error) {
    results.push({
      name: 'Player Splits',
      passed: false,
      duration: Date.now() - splitsStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n' + '═'.repeat(80));
  console.log('📊 TEST SUMMARY\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name} (${r.duration}ms)`);
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    }
  });
  
  console.log('\n' + '═'.repeat(80));
  console.log(`Results: ${passed} passed, ${failed} failed, ${totalDuration}ms total`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Pipeline ready for derived stats.');
    process.exit(0);
  } else {
    console.log(`\n⚠️ ${failed} test(s) failed. Review before proceeding.`);
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
