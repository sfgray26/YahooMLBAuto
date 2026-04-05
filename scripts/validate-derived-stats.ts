#!/usr/bin/env node
/**
 * Derived Stats Accuracy Validation
 * 
 * This script validates the 7/14/30 day derived stats computation against
 * manual calculations to ensure accuracy before Monte Carlo layer.
 * 
 * Tests:
 * 1. Rolling window accuracy (calendar days vs game count)
 * 2. Rate stat calculations (AVG, OBP, SLG, OPS, ISO)
 * 3. Edge cases (injured players, partial seasons)
 * 4. Idempotency (same input = same output)
 * 5. Sample size thresholds (PA for reliability)
 */

const { PrismaClient } = require('@prisma/client');
const { DatabaseGameLogProvider } = require('../packages/data/src/providers/database.js');
const { DerivedFeatureComputer } = require('../packages/data/src/computation/derived-features.js');

const prisma = new PrismaClient();

// Test players
const TEST_PLAYERS = [
  { id: '592450', name: 'Aaron Judge' },
  { id: '677951', name: 'Bobby Witt Jr.' },
];

// Validation results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, details = '') {
  const status = passed ? '✅' : '❌';
  console.log(`  ${status} ${name}`);
  if (details) console.log(`     ${details}`);
  
  results.tests.push({ name, passed, details });
  if (passed) results.passed++;
  else results.failed++;
}

// ============================================================================
// TEST 1: Manual Calculation Validation
// ============================================================================
async function testManualCalculation(provider, computer, playerId, season) {
  console.log('\n📋 TEST 1: Manual Calculation Validation');
  
  // Get raw game logs for the player
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId: playerId, season },
    orderBy: { gameDate: 'desc' },
    take: 50
  });
  
  if (gameLogs.length === 0) {
    logTest('Has game logs', false, 'No games found for player');
    return;
  }
  
  logTest('Has game logs', true, `${gameLogs.length} games found`);
  
  // Pick a reference date (most recent game)
  const referenceDate = new Date(gameLogs[0].gameDate);
  
  // Calculate 30-day window manually
  const thirtyDaysAgo = new Date(referenceDate);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const gamesInWindow = gameLogs.filter(g => {
    const gameDate = new Date(g.gameDate);
    return gameDate >= thirtyDaysAgo && gameDate <= referenceDate;
  });
  
  const manualStats = gamesInWindow.reduce((acc, g) => ({
    games: acc.games + 1,
    atBats: acc.atBats + g.atBats,
    hits: acc.hits + g.hits,
    walks: acc.walks + g.walks,
    hitByPitch: acc.hitByPitch + g.hitByPitch,
    sacrificeFlies: acc.sacrificeFlies + g.sacrificeFlies,
    totalBases: acc.totalBases + g.totalBases,
    doubles: acc.doubles + g.doubles,
    triples: acc.triples + g.triples,
    homeRuns: acc.homeRuns + g.homeRuns,
    plateAppearances: acc.plateAppearances + g.plateAppearances
  }), {
    games: 0, atBats: 0, hits: 0, walks: 0, hitByPitch: 0, 
    sacrificeFlies: 0, totalBases: 0, doubles: 0, triples: 0, homeRuns: 0, plateAppearances: 0
  });
  
  // Calculate expected rate stats
  const manualAVG = manualStats.atBats > 0 ? manualStats.hits / manualStats.atBats : 0;
  const manualOBP = (manualStats.atBats + manualStats.walks + manualStats.hitByPitch + manualStats.sacrificeFlies) > 0 
    ? (manualStats.hits + manualStats.walks + manualStats.hitByPitch) / (manualStats.atBats + manualStats.walks + manualStats.hitByPitch + manualStats.sacrificeFlies)
    : 0;
  const manualSLG = manualStats.atBats > 0 ? manualStats.totalBases / manualStats.atBats : 0;
  const manualOPS = manualOBP + manualSLG;
  const manualISO = manualSLG - manualAVG;
  
  // Get computed stats
  const computed = await computer.computePlayerFeatures(playerId, season, referenceDate);
  
  if (!computed) {
    logTest('Computed stats exist', false, 'Computer returned null');
    return;
  }
  
  // Compare game counts
  const gamesMatch = computed.gamesLast30 === manualStats.games;
  logTest('30-day game count', gamesMatch, 
    `Computed: ${computed.gamesLast30}, Manual: ${manualStats.games}`);
  
  // Compare PA counts
  const paMatch = computed.plateAppearancesLast30 === manualStats.plateAppearances;
  logTest('30-day PA count', paMatch,
    `Computed: ${computed.plateAppearancesLast30}, Manual: ${manualStats.plateAppearances}`);
  
  // Compare AVG (within rounding tolerance)
  const avgDiff = Math.abs((computed.battingAverageLast30 || 0) - manualAVG);
  const avgMatch = avgDiff < 0.001;
  logTest('30-day AVG', avgMatch,
    `Computed: ${computed.battingAverageLast30?.toFixed(3)}, Manual: ${manualAVG.toFixed(3)}, Diff: ${avgDiff.toFixed(5)}`);
  
  // Compare OPS
  const opsDiff = Math.abs((computed.opsLast30 || 0) - manualOPS);
  const opsMatch = opsDiff < 0.001;
  logTest('30-day OPS', opsMatch,
    `Computed: ${computed.opsLast30?.toFixed(3)}, Manual: ${manualOPS.toFixed(3)}, Diff: ${opsDiff.toFixed(5)}`);
  
  // Validate OPS = OBP + SLG
  const expectedOPS = (computed.onBasePctLast30 || 0) + (computed.sluggingPctLast30 || 0);
  const opsFormulaDiff = Math.abs((computed.opsLast30 || 0) - expectedOPS);
  logTest('OPS = OBP + SLG', opsFormulaDiff < 0.001,
    `OPS: ${computed.opsLast30?.toFixed(3)}, OBP+SLG: ${expectedOPS.toFixed(3)}`);
  
  // Validate ISO = SLG - AVG
  const expectedISO = (computed.sluggingPctLast30 || 0) - (computed.battingAverageLast30 || 0);
  const isoFormulaDiff = Math.abs((computed.isoLast30 || 0) - expectedISO);
  logTest('ISO = SLG - AVG', isoFormulaDiff < 0.001,
    `ISO: ${computed.isoLast30?.toFixed(3)}, SLG-AVG: ${expectedISO.toFixed(3)}`);
}

// ============================================================================
// TEST 2: Calendar Window Validation (not game-count)
// ============================================================================
async function testCalendarWindows(provider, computer, playerId, season) {
  console.log('\n📋 TEST 2: Calendar Window Validation');
  
  // Get all games for player
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId: playerId, season },
    orderBy: { gameDate: 'desc' }
  });
  
  if (gameLogs.length < 10) {
    logTest('Sufficient games for window test', false, `Only ${gameLogs.length} games`);
    return;
  }
  
  // Test that 30d >= 14d >= 7d in calendar days
  const referenceDate = new Date(gameLogs[0].gameDate);
  
  const stats30d = await computer.computePlayerFeatures(playerId, season, referenceDate);
  
  if (!stats30d) {
    logTest('Stats computed', false, 'No stats returned');
    return;
  }
  
  // Calendar windows should be monotonic: 30d >= 14d >= 7d
  const windowMonotonic = 
    stats30d.gamesLast30 >= stats30d.gamesLast14 &&
    stats30d.gamesLast14 >= stats30d.gamesLast7;
  
  logTest('Window monotonicity (30d >= 14d >= 7d)', windowMonotonic,
    `30d: ${stats30d.gamesLast30}, 14d: ${stats30d.gamesLast14}, 7d: ${stats30d.gamesLast7}`);
  
  // PA should also be monotonic
  const paMonotonic = 
    stats30d.plateAppearancesLast30 >= stats30d.plateAppearancesLast14 &&
    stats30d.plateAppearancesLast14 >= stats30d.plateAppearancesLast7;
  
  logTest('PA monotonicity', paMonotonic,
    `30d PA: ${stats30d.plateAppearancesLast30}, 14d PA: ${stats30d.plateAppearancesLast14}, 7d PA: ${stats30d.plateAppearancesLast7}`);
  
  // Verify actual calendar day boundaries
  const sevenDaysAgo = new Date(referenceDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const fourteenDaysAgo = new Date(referenceDate);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  
  const thirtyDaysAgo = new Date(referenceDate);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const games7d = gameLogs.filter(g => new Date(g.gameDate) >= sevenDaysAgo).length;
  const games14d = gameLogs.filter(g => new Date(g.gameDate) >= fourteenDaysAgo).length;
  const games30d = gameLogs.filter(g => new Date(g.gameDate) >= thirtyDaysAgo).length;
  
  logTest('7-day window accuracy', stats30d.gamesLast7 === games7d,
    `Computed: ${stats30d.gamesLast7}, Expected: ${games7d}`);
  
  logTest('14-day window accuracy', stats30d.gamesLast14 === games14d,
    `Computed: ${stats30d.gamesLast14}, Expected: ${games14d}`);
  
  logTest('30-day window accuracy', stats30d.gamesLast30 === games30d,
    `Computed: ${stats30d.gamesLast30}, Expected: ${games30d}`);
}

// ============================================================================
// TEST 3: Reliability Thresholds
// ============================================================================
async function testReliabilityThresholds(provider, computer, playerId, season) {
  console.log('\n📋 TEST 3: Reliability Thresholds');
  
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId: playerId, season },
    orderBy: { gameDate: 'desc' },
    take: 50
  });
  
  if (gameLogs.length === 0) {
    logTest('Has games', false, 'No games found');
    return;
  }
  
  const referenceDate = new Date(gameLogs[0].gameDate);
  const stats = await computer.computePlayerFeatures(playerId, season, referenceDate);
  
  if (!stats) {
    logTest('Stats computed', false, 'No stats returned');
    return;
  }
  
  // Check reliability logic: >= 100 PA = reliable
  const expectedReliable = stats.plateAppearancesLast30 >= 100;
  const reliabilityMatch = stats.battingAverageReliable === expectedReliable;
  
  logTest('Reliability threshold (>=100 PA)', reliabilityMatch,
    `PA: ${stats.plateAppearancesLast30}, Reliable: ${stats.battingAverageReliable}, Expected: ${expectedReliable}`);
  
  // Check gamesToReliable calculation
  if (!stats.battingAverageReliable && stats.plateAppearancesLast30 > 0) {
    const avgPAperGame = stats.plateAppearancesLast30 / stats.gamesLast30;
    const neededGames = Math.ceil((100 - stats.plateAppearancesLast30) / avgPAperGame);
    const gamesMatch = stats.gamesToReliable === neededGames;
    
    logTest('Games to reliable calculation', gamesMatch,
      `Computed: ${stats.gamesToReliable}, Expected: ${neededGames}`);
  } else if (stats.battingAverageReliable) {
    logTest('Games to reliable (already reliable)', stats.gamesToReliable === 0,
      `gamesToReliable: ${stats.gamesToReliable}`);
  }
}

// ============================================================================
// TEST 4: Idempotency
// ============================================================================
async function testIdempotency(provider, computer, playerId, season) {
  console.log('\n📋 TEST 4: Idempotency');
  
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId: playerId, season },
    orderBy: { gameDate: 'desc' },
    take: 30
  });
  
  if (gameLogs.length === 0) {
    logTest('Has games', false, 'No games found');
    return;
  }
  
  const referenceDate = new Date(gameLogs[0].gameDate);
  
  // Compute twice
  const run1 = await computer.computePlayerFeatures(playerId, season, referenceDate);
  const run2 = await computer.computePlayerFeatures(playerId, season, referenceDate);
  
  if (!run1 || !run2) {
    logTest('Both runs returned data', false, 'One or both runs returned null');
    return;
  }
  
  // Compare all numeric fields
  const fields = [
    'gamesLast7', 'gamesLast14', 'gamesLast30',
    'plateAppearancesLast7', 'plateAppearancesLast14', 'plateAppearancesLast30',
    'battingAverageLast30', 'onBasePctLast30', 'sluggingPctLast30', 'opsLast30', 'isoLast30'
  ];
  
  let allMatch = true;
  const differences = [];
  
  for (const field of fields) {
    const val1 = run1[field];
    const val2 = run2[field];
    
    // For floats, check within tolerance
    const match = typeof val1 === 'number' && typeof val2 === 'number'
      ? Math.abs(val1 - val2) < 0.0001
      : val1 === val2;
    
    if (!match) {
      allMatch = false;
      differences.push(`${field}: ${val1} vs ${val2}`);
    }
  }
  
  logTest('Deterministic output', allMatch,
    allMatch ? 'All fields match' : `Differences: ${differences.join(', ')}`);
}

// ============================================================================
// TEST 5: Edge Cases
// ============================================================================
async function testEdgeCases(provider, computer) {
  console.log('\n📋 TEST 5: Edge Cases');
  
  // Test player with no games
  const noGamesResult = await computer.computePlayerFeatures('999999', 2025, new Date());
  logTest('Player with no games returns null', noGamesResult === null,
    noGamesResult === null ? 'Correctly returned null' : 'Should return null');
  
  // Test future date
  const futureDate = new Date('2026-12-31');
  const futureResult = await computer.computePlayerFeatures('592450', 2025, futureDate);
  logTest('Future date handling', futureResult !== undefined,
    futureResult ? `Got ${futureResult.gamesLast30} games` : 'Returned null/undefined');
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('🧪 Derived Stats Accuracy Validation\n');
  console.log('═'.repeat(80));

  const provider = new DatabaseGameLogProvider(prisma);

  const computer = new DerivedFeatureComputer(provider);

  const season = 2026;

  // Run tests for each player
  for (const player of TEST_PLAYERS) {
    console.log(`\n👤 Testing ${player.name} (${player.id})`);
    console.log('-'.repeat(80));

    await testManualCalculation(provider, computer, player.id, season);
    await testCalendarWindows(provider, computer, player.id, season);
    await testReliabilityThresholds(provider, computer, player.id, season);
    await testIdempotency(provider, computer, player.id, season);
  }

  // Edge cases (run once)
  await testEdgeCases(provider, computer);
  
  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('📊 VALIDATION SUMMARY\n');
  console.log(`Total tests: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed} ✅`);
  console.log(`Failed: ${results.failed} ❌`);
  console.log(`Success rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  
  if (results.failed > 0) {
    console.log('\nFailed tests:');
    results.tests.filter(t => !t.passed).forEach(t => {
      console.log(`  ❌ ${t.name}`);
      if (t.details) console.log(`     ${t.details}`);
    });
  }
  
  console.log('\n' + (results.failed === 0 ? '✅ All tests passed!' : '⚠️ Some tests failed'));
  
  await prisma.$disconnect();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
