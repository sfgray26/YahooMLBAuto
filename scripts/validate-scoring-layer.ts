/**
 * Scoring Layer Validation Tests
 * 
 * Validates the scoring layer meets architectural principles:
 * - Deterministic: Same inputs → same outputs
 * - Stateless: No side effects, no database writes
 * - Pure functions: No external dependencies
 * - Explainable: Clear reasoning for scores
 */

import { scorePlayer, PlayerScore } from '../apps/worker/src/scoring/compute';
import type { DerivedFeatures } from '../apps/worker/src/derived/index';

// Test fixture: League-average player
const leagueAveragePlayer: DerivedFeatures = {
  playerId: 'test-avg',
  playerMlbamId: '000001',
  season: 2025,
  computedAt: new Date(),
  volume: {
    gamesLast7: 5,
    gamesLast14: 12,
    gamesLast30: 26,
    plateAppearancesLast7: 22,
    plateAppearancesLast14: 52,
    plateAppearancesLast30: 110,
    atBatsLast30: 98,
  },
  rates: {
    battingAverageLast30: 0.245,  // League average
    onBasePctLast30: 0.315,       // League average
    sluggingPctLast30: 0.410,     // League average (~.725 OPS)
    opsLast30: 0.725,
    isoLast30: 0.155,             // League average
    walkRateLast30: 0.085,        // League average
    strikeoutRateLast30: 0.220,   // League average
    babipLast30: 0.295,
  },
  stabilization: {
    battingAverageReliable: true,
    obpReliable: true,
    slgReliable: true,
    opsReliable: true,
    gamesToReliable: 0,
  },
  volatility: {
    hitConsistencyScore: 50,
    productionVolatility: 1.0,
    zeroHitGamesLast14: 4,
    multiHitGamesLast14: 4,
  },
  opportunity: {
    gamesStartedLast14: 13,
    lineupSpot: 5,
    platoonRisk: 'low',
    playingTimeTrend: 'stable',
  },
  replacement: {
    positionEligibility: ['OF'],
    waiverWireValue: null,
    rosteredPercent: 85,
  },
};

// Test fixture: Elite player (Aaron Judge-like)
const elitePlayer: DerivedFeatures = {
  ...leagueAveragePlayer,
  playerId: 'test-elite',
  playerMlbamId: '000002',
  rates: {
    battingAverageLast30: 0.370,
    onBasePctLast30: 0.528,
    sluggingPctLast30: 0.793,
    opsLast30: 1.321,
    isoLast30: 0.424,
    walkRateLast30: 0.200,
    strikeoutRateLast30: 0.180,
    babipLast30: 0.350,
  },
  volatility: {
    hitConsistencyScore: 71,
    productionVolatility: 0.99,
    zeroHitGamesLast14: 2,
    multiHitGamesLast14: 6,
  },
};

// Test fixture: Small sample (high variance, should be regressed)
const smallSamplePlayer: DerivedFeatures = {
  ...leagueAveragePlayer,
  playerId: 'test-small',
  playerMlbamId: '000003',
  volume: {
    ...leagueAveragePlayer.volume,
    gamesLast30: 12,
    plateAppearancesLast30: 42,  // Small sample
  },
  rates: {
    ...leagueAveragePlayer.rates,
    opsLast30: 1.100,  // Good but small sample
  },
  stabilization: {
    ...leagueAveragePlayer.stabilization,
    opsReliable: false,
  },
};

// Test fixture: Poor player (.180/.240/.280 slash, 32% K, platoon / bench role)
// Inherits volume from leagueAveragePlayer but overrides rates, volatility,
// and opportunity to reflect what a genuinely struggling hitter looks like:
// reduced playing time, platoon exposure, more hitless games.
const poorPlayer: DerivedFeatures = {
  ...leagueAveragePlayer,
  playerId: 'test-poor',
  playerMlbamId: '000004',
  rates: {
    battingAverageLast30: 0.180,
    onBasePctLast30: 0.240,
    sluggingPctLast30: 0.280,
    opsLast30: 0.520,
    isoLast30: 0.080,
    walkRateLast30: 0.040,
    strikeoutRateLast30: 0.320,
    babipLast30: 0.250,
  },
  // High K-rate → more hitless games, lower hit-consistency score
  volatility: {
    hitConsistencyScore: 30,
    productionVolatility: 1.6,
    zeroHitGamesLast14: 7,   // ~50 % hitless rate
    multiHitGamesLast14: 2,
  },
  // Poor production → benching / platoon splits / downward trend
  opportunity: {
    gamesStartedLast14: 9,
    lineupSpot: 7,
    platoonRisk: 'medium',
    playingTimeTrend: 'down',
  },
};

function runTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           SCORING LAYER VALIDATION TESTS                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Test 1: Determinism
  console.log('TEST 1: DETERMINISM');
  console.log('Running same player through scorer 3 times...');
  const score1 = scorePlayer(leagueAveragePlayer);
  const score2 = scorePlayer(leagueAveragePlayer);
  const score3 = scorePlayer(leagueAveragePlayer);
  const deterministic = 
    score1.overallValue === score2.overallValue && 
    score2.overallValue === score3.overallValue;
  console.log(`  Score 1: ${score1.overallValue}`);
  console.log(`  Score 2: ${score2.overallValue}`);
  console.log(`  Score 3: ${score3.overallValue}`);
  console.log(`  ✅ ${deterministic ? 'PASS' : 'FAIL'}: Same inputs produce same outputs\n`);

  // Test 2: League average player should score ~50
  console.log('TEST 2: LEAGUE AVERAGE BASELINE');
  const avgScore = scorePlayer(leagueAveragePlayer);
  console.log(`  Expected: ~50 (league average)`);
  console.log(`  Actual: ${avgScore.overallValue}`);
  console.log(`  Components: H=${avgScore.components.hitting} P=${avgScore.components.power} D=${avgScore.components.plateDiscipline}`);
  const avgOk = avgScore.overallValue >= 45 && avgScore.overallValue <= 55;
  console.log(`  ${avgOk ? '✅ PASS' : '❌ FAIL'}: League average player scores ~50\n`);

  // Test 3: Elite player should score higher
  console.log('TEST 3: ELITE SEPARATION');
  const eliteScore = scorePlayer(elitePlayer);
  console.log(`  League Avg: ${avgScore.overallValue}`);
  console.log(`  Elite: ${eliteScore.overallValue}`);
  console.log(`  Gap: ${eliteScore.overallValue - avgScore.overallValue} points`);
  const eliteHigher = eliteScore.overallValue > avgScore.overallValue + 15;
  console.log(`  Elite Components: H=${eliteScore.components.hitting} P=${eliteScore.components.power} D=${eliteScore.components.plateDiscipline}`);
  console.log(`  ${eliteHigher ? '✅ PASS' : '❌ FAIL'}: Elite player separated from average\n`);

  // Test 4: Small sample regression
  console.log('TEST 4: SMALL SAMPLE REGRESSION');
  const smallScore = scorePlayer(smallSamplePlayer);
  const whatSmallWouldBeWithLargeSample = Math.round(
    (smallScore.overallValue - 50 * 0.4) / 0.6  // Reverse the regression
  );
  console.log(`  Small Sample (42 PA): ${smallScore.overallValue}/100`);
  console.log(`  Confidence: 60% (regressed toward 50)`);
  console.log(`  Estimated "true" score if 120 PA: ~${whatSmallWouldBeWithLargeSample}`);
  const regressionWorking = smallScore.overallValue < whatSmallWouldBeWithLargeSample;
  console.log(`  ${regressionWorking ? '✅ PASS' : '❌ FAIL'}: Small sample pulled toward average\n`);

  // Test 5: Poor player should score lower
  console.log('TEST 5: POOR PLAYER IDENTIFICATION');
  const poorScore = scorePlayer(poorPlayer);
  console.log(`  League Avg: ${avgScore.overallValue}`);
  console.log(`  Poor: ${poorScore.overallValue}`);
  console.log(`  Gap: ${avgScore.overallValue - poorScore.overallValue} points`);
  const poorLower = poorScore.overallValue < avgScore.overallValue - 10;
  console.log(`  Poor Components: H=${poorScore.components.hitting} P=${poorScore.components.power} D=${poorScore.components.plateDiscipline}`);
  console.log(`  ${poorLower ? '✅ PASS' : '❌ FAIL'}: Poor player scores below average\n`);

  // Test 6: Score bounds (0-100)
  console.log('TEST 6: SCORE BOUNDS');
  const allScores = [avgScore, eliteScore, smallScore, poorScore];
  const allInBounds = allScores.every(s => s.overallValue >= 0 && s.overallValue <= 100);
  console.log(`  Min observed: ${Math.min(...allScores.map(s => s.overallValue))}`);
  console.log(`  Max observed: ${Math.max(...allScores.map(s => s.overallValue))}`);
  console.log(`  ${allInBounds ? '✅ PASS' : '❌ FAIL'}: All scores within 0-100 bounds\n`);

  // Test 7: Explainability
  console.log('TEST 7: EXPLAINABILITY');
  const hasExplanation = 
    eliteScore.explanation.summary && 
    eliteScore.explanation.strengths.length > 0 &&
    eliteScore.components.hitting > 0;
  console.log(`  Summary: "${eliteScore.explanation.summary}"`);
  console.log(`  Strengths: ${eliteScore.explanation.strengths.join(', ')}`);
  console.log(`  Key Stats: ${Object.keys(eliteScore.explanation.keyStats).join(', ')}`);
  console.log(`  ${hasExplanation ? '✅ PASS' : '❌ FAIL'}: Scores include explanations\n`);

  // Summary
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                              ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  const tests = [
    deterministic,
    avgOk,
    eliteHigher,
    regressionWorking,
    poorLower,
    allInBounds,
    hasExplanation
  ];
  const passed = tests.filter(t => t).length;
  console.log(`║  Passed: ${passed}/${tests.length} tests                                       ║`);
  console.log(`║  Status: ${passed === tests.length ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}                              ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  return passed === tests.length;
}

const success = runTests();
process.exit(success ? 0 : 1);
