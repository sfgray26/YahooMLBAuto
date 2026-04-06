/**
 * Full Pipeline Integration Test
 * 
 * Validates the complete flow from raw data → decision
 * Uses real database data but mock TeamState
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { scoreSinglePlayer } from '../apps/worker/src/scoring/orchestrator';
import { assembleWaiverDecisionsFromTeamState } from '../apps/worker/src/decisions/waiverAssembly';
import type { TeamState } from '@cbb/core';

async function runIntegrationTest() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     FULL PIPELINE INTEGRATION TEST                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Fetch real players with derived stats
  console.log('STEP 1: Fetching real player data from database...');
  
  const derivedStats = await prisma.playerDerivedStats.findMany({
    where: { 
      season: 2025, 
      gamesLast30: { gt: 0 },
      plateAppearancesLast30: { gte: 50 }  // Reliable sample
    },
    orderBy: { opsLast30: 'desc' },
    take: 20,
    distinct: ['playerMlbamId']
  });

  console.log(`  Found ${derivedStats.length} players with derived stats`);

  // Step 2: Score players (Layer 6)
  console.log('\nSTEP 2: Computing player scores...');
  
  const hitterScores = new Map();
  const availablePlayers: any[] = [];

  for (const stat of derivedStats.slice(0, 10)) {
    const score = await scoreSinglePlayer(stat.playerMlbamId, 2025);
    if (score) {
      hitterScores.set(stat.playerMlbamId, score);
      
      const playerInfo = await prisma.verifiedPlayer.findUnique({
        where: { mlbamId: stat.playerMlbamId },
        select: { fullName: true, team: true }
      });
      
      availablePlayers.push({
        playerId: stat.playerId,
        mlbamId: stat.playerMlbamId,
        name: playerInfo?.fullName || stat.playerMlbamId,
        team: playerInfo?.team || 'UNK',
        positions: ['OF'],  // Simplified
        percentOwned: 75,
        percentStarted: 60,
      });
    }
  }

  console.log(`  Scored ${hitterScores.size} players`);
  
  // Show top 5
  const sortedScores = Array.from(hitterScores.entries())
    .sort((a, b) => b[1].overallValue - a[1].overallValue)
    .slice(0, 5);
  
  console.log('\n  Top 5 Scored Players:');
  for (const [mlbamId, score] of sortedScores) {
    const player = availablePlayers.find(p => p.mlbamId === mlbamId);
    console.log(`    ${player?.name?.slice(0, 20).padEnd(20)} | ${score.overallValue}/100 | H=${score.components.hitting} P=${score.components.power}`);
  }

  // Step 3: Create mock TeamState (Layer 7 input)
  console.log('\nSTEP 3: Creating mock TeamState...');
  
  const mockTeamState: TeamState = {
    teamId: 'test-team-001',
    leagueId: 'test-league-001',
    lastUpdated: new Date().toISOString(),
    
    roster: {
      players: [
        // Roster has some weak hitters that should be dropped
        {
          playerId: 'weak-1',
          mlbamId: '000001',
          name: 'Weak Hitter 1',
          team: 'TB',
          positions: ['OF'],
          lineupStatus: 'bench',
          isInjured: false,
        },
        {
          playerId: 'weak-2',
          mlbamId: '000002', 
          name: 'Weak Hitter 2',
          team: 'KC',
          positions: ['1B'],
          lineupStatus: 'bench',
          isInjured: false,
        }
      ] as any[],
    },
    
    lineupConfig: {
      slots: [
        { slotId: 'C', domain: 'hitting', eligiblePositions: ['C'], required: true },
        { slotId: '1B', domain: 'hitting', eligiblePositions: ['1B', 'CI'], required: true },
        { slotId: 'OF1', domain: 'hitting', eligiblePositions: ['OF'], required: true },
        { slotId: 'OF2', domain: 'hitting', eligiblePositions: ['OF'], required: true },
        { slotId: 'SP1', domain: 'pitching', eligiblePositions: ['SP', 'P'], required: true },
      ],
      benchSlots: 5,
      maxPlayers: 15,
    },
    
    currentLineup: {
      assignments: [],
      benchAssignments: ['weak-1', 'weak-2'],
      locked: false,
    },
    
    waiverState: {
      budgetRemaining: 75,
      budgetTotal: 100,
      claimsThisWeek: 1,
      maxClaimsPerWeek: 3,
      nextClaimResetsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  };

  console.log('  TeamState created with 2 weak bench players');
  console.log('  FAAB Budget: $75/$100');

  // Step 4: Run waiver assembly (Layer 7)
  console.log('\nSTEP 4: Running waiver decision assembly...');
  
  const result = assembleWaiverDecisionsFromTeamState({
    teamState: mockTeamState,
    hitterScores,
    pitcherScores: new Map(),  // No pitchers in this test
    availablePlayers,
  });

  // Step 5: Validate results
  console.log('\nSTEP 5: Validating recommendations...');
  
  if (!result.success) {
    console.log('  ❌ FAILED:', result.errors);
    await prisma.$disconnect();
    return false;
  }

  const recommendations = result.result?.recommendations || [];
  console.log(`  Generated ${recommendations.length} recommendations`);
  
  if (recommendations.length === 0) {
    console.log('  ⚠️ WARNING: No recommendations generated');
  } else {
    console.log('\n  Top Recommendations:');
    recommendations.slice(0, 5).forEach((rec, i) => {
      console.log(`\n  #${rec.rank}: ${rec.player.name}`);
      console.log(`    Action: ${rec.action}`);
      console.log(`    Expected Value: +${rec.expectedValue}`);
      console.log(`    Confidence: ${rec.confidence}`);
      console.log(`    Reasoning: ${rec.reasoning.slice(0, 80)}...`);
      if (rec.dropCandidate) {
        console.log(`    Drop: ${rec.dropCandidate.name}`);
      }
    });
  }

  // Validate roster analysis
  const analysis = result.result?.rosterAnalysis;
  if (analysis) {
    console.log('\n  Roster Analysis:');
    console.log(`    Strengths: ${analysis.strengths.length > 0 ? analysis.strengths.join(', ') : 'None'}`);
    console.log(`    Weaknesses: ${analysis.weaknesses.length > 0 ? analysis.weaknesses.join(', ') : 'None'}`);
    console.log(`    Opportunities: ${analysis.opportunities.length > 0 ? analysis.opportunities.join(', ') : 'None'}`);
  }

  // Final validation
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST RESULTS                                ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  
  const checks = [
    { name: 'Database connection', pass: derivedStats.length > 0 },
    { name: 'Scoring layer', pass: hitterScores.size > 0 },
    { name: 'Decision assembly', pass: result.success },
    { name: 'Recommendations generated', pass: recommendations.length > 0 },
    { name: 'Roster analysis', pass: !!analysis },
  ];
  
  checks.forEach(c => {
    console.log(`║  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(45)} ║`);
  });
  
  const allPassed = checks.every(c => c.pass);
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Overall: ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}${' '.repeat(33)}║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  await prisma.$disconnect();
  return allPassed;
}

runIntegrationTest()
  .then(success => process.exit(success ? 0 : 1))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
