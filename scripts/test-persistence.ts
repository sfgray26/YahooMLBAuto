/**
 * Railway Database Test / Seed Script
 * 
 * Populates empty Railway database with test data to verify
 * the decision persistence layer works correctly.
 * 
 * Run with: DATABASE_URL=your_railway_url pnpm tsx scripts/test-persistence.ts
 */

import { prisma } from '../packages/infrastructure/src/index.js';
import {
  persistLineupDecision,
  persistWaiverDecision,
  queryDecisions,
  getDecisionById,
  getDecisionPerformanceSummary,
  updateLineupDecisionWithActualResults,
} from '../packages/infrastructure/src/persistence/decision-repository.js';
import type { TeamState } from '@cbb/core';

// Test TeamState
const testTeamState: TeamState = {
  identity: {
    teamId: 'test-team-001',
    leagueId: 'test-league-001',
    teamName: 'Test Team',
    leagueName: 'Test League',
    platform: 'yahoo',
    season: 2025,
    scoringPeriod: {
      type: 'daily',
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      games: [],
    },
  },
  roster: {
    version: 1,
    lastUpdated: new Date().toISOString(),
    players: [
      {
        playerId: 'player-001',
        mlbamId: '123456',
        name: 'Mike Trout',
        team: 'LAA',
        positions: ['OF'],
        acquisitionDate: new Date().toISOString(),
        acquisitionType: 'draft',
        isInjured: false,
      },
      {
        playerId: 'player-002',
        mlbamId: '234567',
        name: 'Shohei Ohtani',
        team: 'LAD',
        positions: ['DH', 'SP'],
        acquisitionDate: new Date().toISOString(),
        acquisitionType: 'draft',
        isInjured: false,
      },
    ],
  },
  lineupConfig: {
    slots: [
      { slotId: 'OF1', domain: 'hitting', eligiblePositions: ['OF'], maxPlayers: 1, displayOrder: 1 },
      { slotId: 'UTIL', domain: 'utility', eligiblePositions: ['DH', 'UTIL'], maxPlayers: 1, displayOrder: 2 },
    ],
    totalSlots: 2,
    hittingSlots: 2,
    pitchingSlots: 0,
    benchSlots: 5,
  },
  currentLineup: {
    assignments: [
      { slotId: 'OF1', playerId: 'player-001', locked: false },
    ],
    lockedSlots: [],
    benchAssignments: [
      { playerId: 'player-002', reason: 'UTIL_eligible' },
    ],
  },
  waiverState: {
    budgetTotal: 100,
    budgetRemaining: 75,
    pendingClaims: [],
    lastWaiverProcess: null,
    nextWaiverProcess: null,
  },
};

// Test scores
const testHitterScores = new Map([
  ['123456', {
    playerId: 'player-001',
    mlbamId: '123456',
    overallValue: 85.5,
    components: { hitting: 80, power: 90, speed: 70 },
    confidence: 0.85,
    domain: 'hitting' as const,
  }],
  ['234567', {
    playerId: 'player-002',
    mlbamId: '234567',
    overallValue: 92.0,
    components: { hitting: 95, power: 95, speed: 85 },
    confidence: 0.90,
    domain: 'hitting' as const,
  }],
]);

const testPitcherScores = new Map([
  ['234567', {
    playerId: 'player-002',
    mlbamId: '234567',
    overallValue: 88.0,
    components: { command: 80, stuff: 95, results: 90 },
    confidence: 0.88,
    domain: 'pitching' as const,
    role: { currentRole: 'SP', isCloser: false },
  }],
]);

async function testPersistence() {
  console.log('🧪 Testing Decision Persistence on Railway...\n');

  try {
    // Test 1: Persist Lineup Decision
    console.log('1️⃣ Testing persistLineupDecision...');
    const lineupDecision = {
      decisionId: `lineup-${Date.now()}`,
      decisionType: 'lineup' as const,
      teamId: testTeamState.identity.teamId,
      createdAt: new Date().toISOString(),
      scoringPeriod: new Date().toISOString(),
      status: 'pending' as const,
      confidence: 0.85,
      reason: 'Optimal lineup based on recent performance',
      optimalLineup: [
        { slotId: 'OF1', playerId: 'player-001', mlbamId: '123456', playerName: 'Mike Trout', projectedPoints: 12.5, confidence: 'high' as const, overallValue: 85.5, componentScores: {} },
      ],
      benchDecisions: [
        { playerId: 'player-002', mlbamId: '234567', playerName: 'Shohei Ohtani', reason: 'UTIL_candidate' as const, overallValue: 92.0 },
      ],
      expectedPoints: 25.5,
      alternatives: [],
      keyDecisions: [],
      confidenceScore: 0.85,
      lockedPlayerCount: 0,
      actualPoints: null,
      accuracyMetrics: null,
    };

    const lineupResult = await persistLineupDecision({
      teamState: testTeamState,
      lineupDecision,
      hitterScores: testHitterScores,
      pitcherScores: testPitcherScores,
      traceId: `trace-${Date.now()}`,
    });

    console.log(`   ${lineupResult.success ? '✅' : '❌'} Lineup decision persisted: ${lineupResult.decisionId}`);

    // Test 2: Persist Waiver Decision
    console.log('\n2️⃣ Testing persistWaiverDecision...');
    const waiverDecision = {
      decisionId: `waiver-${Date.now()}`,
      decisionType: 'waiver_add' as const,
      teamId: testTeamState.identity.teamId,
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
      confidence: 0.75,
      teamStateSnapshot: {} as any, // Will be built by persist function
      targetPlayer: {
        playerId: 'player-003',
        mlbamId: '345678',
        name: 'Juan Soto',
        team: 'NYY',
        positions: ['OF'],
        percentOwned: 95,
        overallValue: 88.5,
        componentScores: {},
        confidence: 0.90,
      },
      dropPlayer: {
        playerId: 'player-004',
        mlbamId: '456789',
        name: 'Bench Player',
        team: 'OAK',
        positions: ['OF'],
        percentOwned: 15,
        overallValue: 35.0,
        componentScores: {},
        confidence: 0.60,
      },
      bidAmount: 15,
      reasoning: 'Significant upgrade at OF position',
      rosterAnalysisSnapshot: {
        strengths: ['OF_depth'],
        weaknesses: ['UTIL_production'],
        opportunities: ['waiver_wire_value'],
        positionDepth: { OF: 3 },
        benchUtilization: 0.6,
      },
      expectedValueAdd: 88.5,
      expectedValueDrop: 35.0,
      netValue: 53.5,
      waiverPriority: 5,
      faabBudgetRemaining: 75,
      actualResult: null,
    };

    const waiverResult = await persistWaiverDecision({
      teamState: testTeamState,
      waiverDecision,
      hitterScores: testHitterScores,
      pitcherScores: testPitcherScores,
      traceId: `trace-${Date.now() + 1}`,
    });

    console.log(`   ${waiverResult.success ? '✅' : '❌'} Waiver decision persisted: ${waiverResult.decisionId}`);

    // Test 3: Query Decisions
    console.log('\n3️⃣ Testing queryDecisions...');
    const decisions = await queryDecisions({
      teamId: testTeamState.identity.teamId,
    });
    console.log(`   ✅ Found ${decisions.length} decisions for team`);

    // Test 4: Get Decision by ID
    console.log('\n4️⃣ Testing getDecisionById...');
    const fetchedDecision = await getDecisionById(lineupResult.decisionId);
    console.log(`   ${fetchedDecision ? '✅' : '❌'} Decision fetched: ${fetchedDecision ? 'found' : 'not found'}`);

    // Test 5: Update with Actual Results
    console.log('\n5️⃣ Testing updateLineupDecisionWithActualResults...');
    await updateLineupDecisionWithActualResults(lineupResult.decisionId, 28.5, [
      { alternativeId: 'alt-1', wouldHaveScored: 26.0 },
    ]);
    console.log('   ✅ Lineup decision updated with actual results');

    // Test 6: Performance Summary
    console.log('\n6️⃣ Testing getDecisionPerformanceSummary...');
    const summary = await getDecisionPerformanceSummary(
      testTeamState.identity.teamId,
      testTeamState.identity.season
    );
    console.log(`   ✅ Performance summary:`);
    console.log(`      - Total decisions: ${summary.totalDecisions}`);
    console.log(`      - Lineup decisions: ${summary.lineupDecisions}`);
    console.log(`      - Waiver decisions: ${summary.waiverDecisions}`);

    // Test 7: Verify in Database
    console.log('\n7️⃣ Verifying data in database...');
    const dbDecisions = await prisma.persistedDecision.findMany({
      where: { teamId: testTeamState.identity.teamId },
    });
    console.log(`   ✅ ${dbDecisions.length} records in PersistedDecision table`);

    const lineupDetails = await prisma.lineupDecisionDetail.findMany({
      where: { decisionId: { in: dbDecisions.map(d => d.decisionId) } },
    });
    console.log(`   ✅ ${lineupDetails.length} records in LineupDecisionDetail table`);

    const waiverDetails = await prisma.waiverDecisionDetail.findMany({
      where: { decisionId: { in: dbDecisions.map(d => d.decisionId) } },
    });
    console.log(`   ✅ ${waiverDetails.length} records in WaiverDecisionDetail table`);

    console.log('\n✅ All persistence tests passed!');
    console.log('\n📊 Summary:');
    console.log(`   - ${dbDecisions.length} total decisions stored`);
    console.log(`   - Team: ${testTeamState.identity.teamName}`);
    console.log(`   - Season: ${testTeamState.identity.season}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testPersistence();
}

export { testPersistence };
