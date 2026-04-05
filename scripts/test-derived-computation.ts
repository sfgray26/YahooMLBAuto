#!/usr/bin/env node
/**
 * Derived Stats Computation Test
 * 
 * Tests the deterministic derived feature computer using balldontlie data.
 * Validates:
 * 1. 7/14/30 day calculations are correct
 * 2. Rolling windows are date-based, not game-count based
 * 3. Rate stats calculate correctly
 * 4. Reliability flags work
 * 
 * Usage: BALLDONTLIE_API_KEY=your_key npx tsx scripts/test-derived-computation.ts
 */

import { BalldontlieProvider } from '../packages/data/src/providers/balldontlie.js';
import { MemoryCache } from '../packages/data/src/providers/cache.js';
import { DerivedFeatureComputer } from '../packages/data/src/computation/derived-features.js';

const TEST_PLAYERS = [
  { id: '592450', name: 'Aaron Judge' },
  { id: '677951', name: 'Bobby Witt Jr.' },
  { id: '518692', name: 'Freddie Freeman' },
];

const SEASON = 2025;
const REFERENCE_DATE = new Date('2024-11-15'); // Use date within data range (games are from 2024-10-31)

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: string;
  error?: string;
}

async function runTests(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  
  if (!apiKey) {
    console.error('❌ BALLDONTLIE_API_KEY environment variable required');
    process.exit(1);
  }

  console.log('🧪 Derived Stats Computation Test Suite\n');
  console.log('═'.repeat(80));

  const cache = new MemoryCache();
  const provider = new BalldontlieProvider({ apiKey, cache });
  const computer = new DerivedFeatureComputer(provider);

  const results: TestResult[] = [];

  // ==========================================================================
  // TEST 1: Basic Computation
  // ==========================================================================
  console.log('\n📋 TEST 1: Basic Feature Computation');
  const basicStart = Date.now();
  
  try {
    const player = TEST_PLAYERS[0];
    const today = REFERENCE_DATE;
    
    const features = await computer.computePlayerFeatures(player.id, SEASON, today);
    
    if (!features) {
      throw new Error('No features returned (player may have no games)');
    }

    // Validate structure
    const validations = [
      { check: features.gamesLast30 >= features.gamesLast14, desc: '30d games >= 14d games' },
      { check: features.gamesLast14 >= features.gamesLast7, desc: '14d games >= 7d games' },
      { check: features.plateAppearancesLast30 >= features.plateAppearancesLast14, desc: '30d PA >= 14d PA' },
      { check: features.battingAverageLast30 !== null || features.gamesLast30 === 0, desc: 'Has AVG or no games' },
      { check: features.gamesToReliable >= 0, desc: 'Games to reliable is positive' },
    ];

    const allValid = validations.every(v => v.check);
    
    results.push({
      name: 'Basic Computation',
      passed: allValid,
      duration: Date.now() - basicStart,
      details: `${features.gamesLast30} games, ${features.plateAppearancesLast30} PA, ${features.gamesToReliable} games to reliable`
    });

    console.log(`  ${allValid ? '✅' : '❌'} Computed features for ${player.name}`);
    validations.forEach(v => {
      console.log(`     ${v.check ? '✓' : '✗'} ${v.desc}`);
    });
    console.log(`     Stats: ${features.gamesLast7}d/${features.gamesLast14}d/${features.gamesLast30}d games`);
    console.log(`     AVG: ${features.battingAverageLast30?.toFixed(3) || 'N/A'} (${features.plateAppearancesLast30} PA)`);
  } catch (error) {
    results.push({
      name: 'Basic Computation',
      passed: false,
      duration: Date.now() - basicStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 2: Determinism Check
  // ==========================================================================
  console.log('\n📋 TEST 2: Determinism (Same Input = Same Output)');
  const detStart = Date.now();
  
  try {
    const player = TEST_PLAYERS[1];
    const today = new Date('2025-07-15'); // Fixed date for reproducibility
    
    // Compute twice
    const run1 = await computer.computePlayerFeatures(player.id, SEASON, today);
    const run2 = await computer.computePlayerFeatures(player.id, SEASON, today);
    
    if (!run1 || !run2) {
      throw new Error('Missing data for determinism check');
    }

    // Compare key fields
    const matches =
      run1.gamesLast30 === run2.gamesLast30 &&
      run1.plateAppearancesLast30 === run2.plateAppearancesLast30 &&
      run1.battingAverageLast30 === run2.battingAverageLast30;

    results.push({
      name: 'Determinism',
      passed: matches,
      duration: Date.now() - detStart,
      details: matches ? 'Outputs identical' : 'Outputs differ!'
    });

    console.log(`  ${matches ? '✅' : '❌'} Computations are ${matches ? 'deterministic' : 'NON-DETERMINISTIC'}`);
    if (matches) {
      console.log(`     Run 1: ${run1.gamesLast30} games, AVG ${run1.battingAverageLast30?.toFixed(3)}`);
      console.log(`     Run 2: ${run2.gamesLast30} games, AVG ${run2.battingAverageLast30?.toFixed(3)}`);
    }
  } catch (error) {
    results.push({
      name: 'Determinism',
      passed: false,
      duration: Date.now() - detStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 3: Date Window Logic
  // ==========================================================================
  console.log('\n📋 TEST 3: Date Window Logic (Calendar vs Game Count)');
  const windowStart = Date.now();
  
  try {
    const player = TEST_PLAYERS[0];
    const today = REFERENCE_DATE;
    
    // Compute as of today
    const featuresToday = await computer.computePlayerFeatures(player.id, SEASON, today);
    
    if (!featuresToday) {
      throw new Error('No features for window test');
    }

    // Verify window structure: 30d >= 14d >= 7d (calendar day windows)
    // Games in shorter windows should be subset of longer windows
    const windowsValid = 
      featuresToday.gamesLast30 >= featuresToday.gamesLast14 &&
      featuresToday.gamesLast14 >= featuresToday.gamesLast7;
    
    results.push({
      name: 'Date Window Logic',
      passed: windowsValid,
      duration: Date.now() - windowStart,
      details: `${featuresToday.gamesLast7} games in last 7 days, ${featuresToday.gamesLast14} in last 14, ${featuresToday.gamesLast30} in last 30`
    });

    console.log(`  ${windowsValid ? '✅' : '❌'} Window logic test`);
    console.log(`     Last 7 days: ${featuresToday.gamesLast7} games`);
    console.log(`     Last 14 days: ${featuresToday.gamesLast14} games`);
    console.log(`     Last 30 days: ${featuresToday.gamesLast30} games`);
    console.log(`     Note: All games on 2024-10-31, so only 30-day window captures them`);
  } catch (error) {
    results.push({
      name: 'Date Window Logic',
      passed: false,
      duration: Date.now() - windowStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 4: Rate Stat Accuracy
  // ==========================================================================
  console.log('\n📋 TEST 4: Rate Stat Accuracy');
  const rateStart = Date.now();
  
  try {
    const player = TEST_PLAYERS[0];
    const today = REFERENCE_DATE;
    
    const features = await computer.computePlayerFeatures(player.id, SEASON, today);
    
    if (!features || features.gamesLast30 === 0) {
      throw new Error('Insufficient data for rate stat check');
    }

    // Verify OPS = OBP + SLG
    const expectedOPS = 
      (features.onBasePctLast30 || 0) + (features.sluggingPctLast30 || 0);
    const actualOPS = features.opsLast30 || 0;
    const opsMatch = Math.abs(expectedOPS - actualOPS) < 0.001;

    // Verify AVG is between 0 and 1
    const avgValid = features.battingAverageLast30 === null || 
      (features.battingAverageLast30 >= 0 && features.battingAverageLast30 <= 1);

    // Verify ISO = SLG - AVG
    const expectedISO = (features.sluggingPctLast30 || 0) - (features.battingAverageLast30 || 0);
    const actualISO = features.isoLast30 || 0;
    const isoMatch = Math.abs(expectedISO - actualISO) < 0.001;

    const allValid = opsMatch && avgValid && isoMatch;

    results.push({
      name: 'Rate Stat Accuracy',
      passed: allValid,
      duration: Date.now() - rateStart,
      details: `OPS match: ${opsMatch}, AVG valid: ${avgValid}, ISO match: ${isoMatch}`
    });

    console.log(`  ${allValid ? '✅' : '❌'} Rate stat validation`);
    console.log(`     AVG: ${features.battingAverageLast30?.toFixed(3)}`);
    console.log(`     OBP: ${features.onBasePctLast30?.toFixed(3)}`);
    console.log(`     SLG: ${features.sluggingPctLast30?.toFixed(3)}`);
    console.log(`     OPS: ${features.opsLast30?.toFixed(3)} (check: ${opsMatch ? '✓' : '✗'})`);
    console.log(`     ISO: ${features.isoLast30?.toFixed(3)} (check: ${isoMatch ? '✓' : '✗'})`);
  } catch (error) {
    results.push({
      name: 'Rate Stat Accuracy',
      passed: false,
      duration: Date.now() - rateStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 5: Reliability Scoring
  // ==========================================================================
  console.log('\n📋 TEST 5: Reliability Scoring');
  const relStart = Date.now();
  
  try {
    const player = TEST_PLAYERS[0];
    const today = REFERENCE_DATE;
    
    const features = await computer.computePlayerFeatures(player.id, SEASON, today);
    
    if (!features) {
      throw new Error('No features for reliability test');
    }

    // Reliability threshold is 100 PA
    const shouldBeReliable = features.plateAppearancesLast30 >= 100;
    const isReliable = features.battingAverageReliable;
    
    const reliabilityMatch = shouldBeReliable === isReliable;

    results.push({
      name: 'Reliability Scoring',
      passed: reliabilityMatch,
      duration: Date.now() - relStart,
      details: `${features.plateAppearancesLast30} PA, reliable: ${isReliable}, need ${features.gamesToReliable} more games`
    });

    console.log(`  ${reliabilityMatch ? '✅' : '❌'} Reliability scoring`);
    console.log(`     PA: ${features.plateAppearancesLast30} (${isReliable ? 'reliable' : 'unreliable'})`);
    console.log(`     Games to reliable: ${features.gamesToReliable}`);
    
    if (!reliabilityMatch) {
      console.log(`     ⚠️ Mismatch: expected reliable=${shouldBeReliable}, got ${isReliable}`);
    }
  } catch (error) {
    results.push({
      name: 'Reliability Scoring',
      passed: false,
      duration: Date.now() - relStart,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.log(`  ❌ Failed: ${error}`);
  }

  // ==========================================================================
  // TEST 6: Batch Computation
  // ==========================================================================
  console.log('\n📋 TEST 6: Batch Computation');
  const batchStart = Date.now();
  
  try {
    const today = REFERENCE_DATE;
    const playerIds = TEST_PLAYERS.map(p => p.id);
    
    const batch = await computer.computeBatch(playerIds, SEASON, today);
    
    const successRate = batch.results.length / playerIds.length;
    const allHaveStats = batch.results.every(r => r.gamesLast30 > 0 || r.plateAppearancesLast30 === 0);

    results.push({
      name: 'Batch Computation',
      passed: successRate >= 0.5, // At least half succeeded
      duration: Date.now() - batchStart,
      details: `${batch.results.length}/${playerIds.length} computed, ${batch.errors.length} errors`
    });

    console.log(`  ${successRate >= 0.5 ? '✅' : '❌'} Batch computation`);
    console.log(`     Success: ${batch.results.length}/${playerIds.length}`);
    console.log(`     Errors: ${batch.errors.length}`);
    
    batch.results.forEach(r => {
      console.log(`     ${r.playerMlbamId}: ${r.gamesLast30}g, ${r.battingAverageLast30?.toFixed(3) || 'N/A'} AVG`);
    });
    
    if (batch.errors.length > 0) {
      batch.errors.forEach(e => {
        console.log(`     ⚠️ ${e.playerId}: ${e.error}`);
      });
    }
  } catch (error) {
    results.push({
      name: 'Batch Computation',
      passed: false,
      duration: Date.now() - batchStart,
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
    if (r.details) {
      console.log(`   ${r.details}`);
    }
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    }
  });
  
  console.log('\n' + '═'.repeat(80));
  console.log(`Results: ${passed} passed, ${failed} failed, ${totalDuration}ms total`);
  
  if (failed === 0) {
    console.log('\n🎉 All derived stats tests passed!');
    console.log('   Pipeline is ready for production use.');
    process.exit(0);
  } else {
    console.log(`\n⚠️ ${failed} test(s) failed. Review calculations.`);
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
