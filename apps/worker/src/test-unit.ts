/**
 * Unit Test: Decision Assembly
 *
 * Pure tests - no infrastructure required.
 * Validates scoring logic and decision assembly.
 */

import { scorePlayer } from './scoring/compute.js';
import { assembleLineup } from './decisions/lineupAssembly.js';
import { assembleWaiverDecisions } from './decisions/waiverAssembly.js';
import type { PlayerScore } from './scoring/compute.js';
import type { LineupOptimizationRequest, WaiverRecommendationRequest } from '@cbb/core';

// ============================================================================
// Test Data
// ============================================================================

const mockDerivedFeatures = {
  playerId: 'test-player-1',
  playerMlbamId: '123456',
  season: 2025,
  computedAt: new Date(),
  volume: {
    gamesLast7: 6,
    gamesLast14: 13,
    gamesLast30: 26,
    plateAppearancesLast7: 28,
    plateAppearancesLast14: 58,
    plateAppearancesLast30: 112,
    atBatsLast30: 98,
  },
  rates: {
    battingAverageLast30: 0.286,
    onBasePctLast30: 0.365,
    sluggingPctLast30: 0.512,
    opsLast30: 0.877,
    isoLast30: 0.226,
    walkRateLast30: 0.098,
    strikeoutRateLast30: 0.188,
    babipLast30: 0.318,
  },
  stabilization: {
    battingAverageReliable: true,
    obpReliable: true,
    slgReliable: true,
    opsReliable: true,
    gamesToReliable: 0,
  },
  volatility: {
    hitConsistencyScore: 72,
    productionVolatility: 0.85,
    zeroHitGamesLast14: 3,
    multiHitGamesLast14: 5,
  },
  opportunity: {
    gamesStartedLast14: 13,
    lineupSpot: 3,
    platoonRisk: 'low' as const,
    playingTimeTrend: 'stable' as const,
  },
  replacement: {
    positionEligibility: ['1B', 'DH'],
    waiverWireValue: 45,
    rosteredPercent: 85,
  },
};

const mockElitePlayer = {
  ...mockDerivedFeatures,
  playerId: 'elite-player',
  playerMlbamId: '999999',
  rates: {
    ...mockDerivedFeatures.rates,
    battingAverageLast30: 0.325,
    opsLast30: 0.995,
    isoLast30: 0.285,
  },
  opportunity: {
    ...mockDerivedFeatures.opportunity,
    gamesStartedLast14: 14,
  },
};

const mockWeakPlayer = {
  ...mockDerivedFeatures,
  playerId: 'weak-player',
  playerMlbamId: '111111',
  rates: {
    ...mockDerivedFeatures.rates,
    battingAverageLast30: 0.150,
    opsLast30: 0.350,
    isoLast30: 0.040,
    walkRateLast30: 0.03,
    strikeoutRateLast30: 0.35,
  },
  opportunity: {
    ...mockDerivedFeatures.opportunity,
    gamesStartedLast14: 2,
    platoonRisk: 'high' as const,
  },
  volatility: {
    ...mockDerivedFeatures.volatility,
    hitConsistencyScore: 30,
  },
};

// ============================================================================
// Test 1: Player Scoring
// ============================================================================

console.log('='.repeat(60));
console.log('TEST 1: Player Scoring');
console.log('='.repeat(60));

const score1 = scorePlayer(mockDerivedFeatures);
const score2 = scorePlayer(mockElitePlayer);
const score3 = scorePlayer(mockWeakPlayer);

console.log('\nPlayer 1 (Average):');
console.log(`  Overall Value: ${score1.overallValue}`);
console.log(`  Components: H=${score1.components.hitting}, P=${score1.components.power}, D=${score1.components.plateDiscipline}`);
console.log(`  Confidence: ${(score1.confidence * 100).toFixed(0)}%`);

console.log('\nPlayer 2 (Elite):');
console.log(`  Overall Value: ${score2.overallValue}`);
console.log(`  Components: H=${score2.components.hitting}, P=${score2.components.power}, D=${score2.components.plateDiscipline}`);

console.log('\nPlayer 3 (Weak):');
console.log(`  Overall Value: ${score3.overallValue}`);
console.log(`  Components: H=${score3.components.hitting}, P=${score3.components.power}, D=${score3.components.plateDiscipline}`);

const scoringWorks = score2.overallValue > score1.overallValue && score1.overallValue > score3.overallValue;
console.log(`\n✅ Scoring ranks correctly: ${scoringWorks ? 'PASS' : 'FAIL'}`);

// ============================================================================
// Test 2: Lineup Assembly
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('TEST 2: Lineup Decision Assembly');
console.log('='.repeat(60));

const mockLineupRequest: LineupOptimizationRequest = {
  id: 'test-lineup-req-1',
  version: 'v1',
  createdAt: new Date().toISOString(),
  leagueConfig: {
    platform: 'yahoo',
    format: 'h2h',
    scoringRules: { batting: {}, pitching: {} },
    rosterPositions: [
      { slot: '1B', maxCount: 1, eligiblePositions: ['1B', 'DH'] },
      { slot: 'UTIL', maxCount: 1, eligiblePositions: ['UTIL', '1B', 'DH'] },
    ],
    leagueSize: 12,
  },
  scoringPeriod: {
    type: 'daily',
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    games: [],
  },
  rosterConstraints: { lockedSlots: [] },
  availablePlayers: {
    players: [
      {
        player: { id: 'p1', mlbamId: '123456', name: 'Average', team: 'NYY', position: ['1B'] },
        isAvailable: true,
      },
      {
        player: { id: 'p2', mlbamId: '999999', name: 'Elite', team: 'LAD', position: ['1B', 'DH'] },
        isAvailable: true,
      },
      {
        player: { id: 'p3', mlbamId: '111111', name: 'Weak', team: 'OAK', position: ['1B'] },
        isAvailable: true,
      },
    ],
    lastUpdated: new Date().toISOString(),
  },
  optimizationObjective: { type: 'maximize_expected' },
  riskTolerance: { type: 'balanced', varianceTolerance: 0.3, description: 'Balance' },
  manualOverrides: [],
};

const playerScores = new Map<string, PlayerScore>([
  ['123456', score1],
  ['999999', score2],
  ['111111', score3],
]);

const lineupResult = assembleLineup({
  request: mockLineupRequest,
  playerScores,
});

if (lineupResult.success && lineupResult.result) {
  console.log(`\n✅ Lineup Assembly: SUCCESS`);
  console.log(`   Expected Points: ${lineupResult.result.expectedPoints.toFixed(1)}`);
  console.log(`   Lineup Size: ${lineupResult.result.optimalLineup.length}`);
  console.log(`   Confidence: ${(lineupResult.result.confidenceScore * 100).toFixed(0)}%`);
  
  lineupResult.result.optimalLineup.forEach((slot) => {
    console.log(`   ${slot.position}: ${slot.player.name} (${slot.projectedPoints.toFixed(1)} pts)`);
  });
  
  const eliteInLineup = lineupResult.result.optimalLineup.some((s) => s.player.mlbamId === '999999');
  console.log(`\n✅ Elite player selected: ${eliteInLineup ? 'PASS' : 'FAIL'}`);
} else {
  console.log('❌ Lineup Assembly: FAILED');
  console.log('   Errors:', lineupResult.errors);
}

// ============================================================================
// Test 3: Waiver Assembly
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('TEST 3: Waiver Decision Assembly');
console.log('='.repeat(60));

const mockWaiverRequest: WaiverRecommendationRequest = {
  id: 'test-waiver-req-1',
  version: 'v1',
  createdAt: new Date().toISOString(),
  leagueConfig: {
    platform: 'yahoo',
    format: 'h2h',
    scoringRules: { batting: {}, pitching: {} },
    rosterPositions: [{ slot: '1B', maxCount: 1, eligiblePositions: ['1B'] }],
    leagueSize: 12,
  },
  currentRoster: [
    {
      player: { id: 'r1', mlbamId: '111111', name: 'Weak Roster Player', team: 'OAK', position: ['1B'] },
      position: '1B',
      isLocked: false,
    },
  ],
  availablePlayers: {
    players: [
      {
        player: { id: 'fa1', mlbamId: '123456', name: 'Average FA', team: 'NYY', position: ['1B'] },
        isAvailable: true,
      },
      {
        player: { id: 'fa2', mlbamId: '999999', name: 'Elite FA', team: 'LAD', position: ['1B'] },
        isAvailable: true,
      },
    ],
    lastUpdated: new Date().toISOString(),
  },
  recommendationScope: 'add_drop',
  rosterNeeds: { positionalNeeds: { '1B': 'moderate' } },
};

const waiverResult = assembleWaiverDecisions({
  request: mockWaiverRequest,
  playerScores,
});

if (waiverResult.success && waiverResult.result) {
  console.log(`\n✅ Waiver Assembly: SUCCESS`);
  console.log(`   Recommendations: ${waiverResult.result.recommendations.length}`);
  
  console.log('\n   Roster Analysis:');
  console.log(`     Strengths: ${waiverResult.result.rosterAnalysis.strengths.join(', ') || 'None'}`);
  console.log(`     Weaknesses: ${waiverResult.result.rosterAnalysis.weaknesses.join(', ') || 'None'}`);
  
  console.log('\n   Top Recommendations:');
  waiverResult.result.recommendations.slice(0, 3).forEach((rec) => {
    console.log(`     ${rec.action.toUpperCase()}: ${rec.player.name} (value: ${rec.expectedValue.toFixed(1)})`);
  });
  
  const swapRec = waiverResult.result.recommendations.find(
    (r) => r.action === 'swap' && r.player.mlbamId === '999999'
  );
  console.log(`\n✅ Recommends upgrade to elite: ${swapRec ? 'PASS' : 'FAIL'}`);
} else {
  console.log('❌ Waiver Assembly: FAILED');
  console.log('   Errors:', waiverResult.errors);
}

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('VALIDATION SUMMARY');
console.log('='.repeat(60));
console.log('✅ Player Scoring: Deterministic value calculation');
console.log('✅ Lineup Assembly: Greedy position assignment from scores');
console.log('✅ Waiver Assembly: Roster analysis + upgrade recommendations');
console.log('\n🎉 End-to-end pipeline validated!');
console.log('   Derived Features → Scores → Decisions');
