#!/usr/bin/env node
/**
 * Cross-Layer Consistency Validation
 * 
 * Ensures data is consistent across all layers:
 * - Player identity matches across layers
 * - Stats flow correctly: Game Logs → Derived → Scores
 * - No contradictions between layers
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { scoreSinglePlayer } from '../apps/worker/src/scoring/orchestrator';

const season = 2025;

interface ConsistencyIssue {
  playerMlbamId: string;
  name: string;
  layer: string;
  issue: string;
  expected: string;
  actual: string;
}

async function getPlayerName(mlbamId: string): Promise<string> {
  const vp = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
    select: { fullName: true }
  });
  return vp?.fullName || mlbamId;
}

async function checkCrossLayerConsistency(): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];

  // Get sample of players with all layers
  const derivedPlayers = await prisma.playerDerivedStats.findMany({
    where: { season, plateAppearancesLast30: { gte: 50 } },
    take: 50
  });

  console.log(`Checking cross-layer consistency for ${derivedPlayers.length} players...\n`);

  for (const derived of derivedPlayers) {
    const name = await getPlayerName(derived.playerMlbamId);

    // Check Layer 1: Game Logs
    const gameLogs = await prisma.playerGameLog.findMany({
      where: { playerMlbamId: derived.playerMlbamId, season }
    });

    if (gameLogs.length === 0) {
      issues.push({
        playerMlbamId: derived.playerMlbamId,
        name,
        layer: 'Game Logs',
        issue: 'Missing game logs',
        expected: 'Should have game logs (has derived stats)',
        actual: 'No game logs found'
      });
      continue;
    }

    // Verify player ID consistency
    const gameLogPlayerIds = new Set(gameLogs.map(g => g.playerId));
    if (gameLogPlayerIds.size > 1) {
      issues.push({
        playerMlbamId: derived.playerMlbamId,
        name,
        layer: 'Identity',
        issue: 'Multiple player IDs in game logs',
        expected: 'Single consistent playerId',
        actual: `${gameLogPlayerIds.size} different IDs`
      });
    }

    // Check Layer 3: Scoring
    const score = await scoreSinglePlayer(derived.playerMlbamId, season);
    if (!score) {
      issues.push({
        playerMlbamId: derived.playerMlbamId,
        name,
        layer: 'Scoring',
        issue: 'Cannot calculate score',
        expected: 'Valid score',
        actual: 'Score calculation failed'
      });
      continue;
    }

    // Consistency Check 1: Score should reflect OPS
    if (derived.opsLast30 !== null) {
      const expectedScoreRange = derived.opsLast30 > 0.900 ? 'high' : 
                                 derived.opsLast30 > 0.750 ? 'medium' : 'low';
      const actualScoreLevel = score.overallValue >= 70 ? 'high' :
                               score.overallValue >= 55 ? 'medium' : 'low';
      
      if (expectedScoreRange === 'high' && actualScoreLevel === 'low') {
        issues.push({
          playerMlbamId: derived.playerMlbamId,
          name,
          layer: 'Scoring Logic',
          issue: 'Score too low for OPS',
          expected: `High score (${derived.opsLast30.toFixed(3)} OPS)`,
          actual: `${score.overallValue}/100`
        });
      }
      if (expectedScoreRange === 'low' && actualScoreLevel === 'high') {
        issues.push({
          playerMlbamId: derived.playerMlbamId,
          name,
          layer: 'Scoring Logic',
          issue: 'Score too high for OPS',
          expected: `Low score (${derived.opsLast30.toFixed(3)} OPS)`,
          actual: `${score.overallValue}/100`
        });
      }
    }

    // Consistency Check 2: Confidence should match sample size
    if (score.reliability.sampleSize === 'large' && score.confidence < 0.7) {
      issues.push({
        playerMlbamId: derived.playerMlbamId,
        name,
        layer: 'Confidence',
        issue: 'Low confidence despite large sample',
        expected: 'High confidence (large sample)',
        actual: `${(score.confidence * 100).toFixed(0)}%`
      });
    }
    if (score.reliability.sampleSize === 'insufficient' && score.confidence > 0.5) {
      issues.push({
        playerMlbamId: derived.playerMlbamId,
        name,
        layer: 'Confidence',
        issue: 'High confidence despite insufficient sample',
        expected: 'Low confidence (insufficient sample)',
        actual: `${(score.confidence * 100).toFixed(0)}%`
      });
    }

    // Consistency Check 3: Components should align with raw stats
    if (derived.battingAverageLast30 !== null) {
      if (derived.battingAverageLast30 > 0.300 && score.components.hitting < 70) {
        issues.push({
          playerMlbamId: derived.playerMlbamId,
          name,
          layer: 'Component Scoring',
          issue: 'Hitting score too low for AVG',
          expected: 'High hitting score (> 0.300 AVG)',
          actual: `${score.components.hitting}`
        });
      }
      if (derived.battingAverageLast30 < 0.200 && score.components.hitting > 50) {
        issues.push({
          playerMlbamId: derived.playerMlbamId,
          name,
          layer: 'Component Scoring',
          issue: 'Hitting score too high for AVG',
          expected: 'Low hitting score (< 0.200 AVG)',
          actual: `${score.components.hitting}`
        });
      }
    }

    // Consistency Check 4: Explanation should match scores
    if (score.explanation.strengths.length > 0 && score.overallValue < 50) {
      issues.push({
        playerMlbamId: derived.playerMlbamId,
        name,
        layer: 'Explanation',
        issue: 'Strengths listed despite low score',
        expected: 'No strengths (score < 50)',
        actual: `${score.explanation.strengths.length} strengths listed`
      });
    }
  }

  return issues;
}

async function runCrossLayerValidation() {
  console.log('\n' + '='.repeat(80));
  console.log('  CROSS-LAYER CONSISTENCY VALIDATION');
  console.log('  Ensuring data integrity across all layers');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}\n`);

  const issues = await checkCrossLayerConsistency();

  console.log('='.repeat(80));
  console.log('  CONSISTENCY CHECK RESULTS');
  console.log('='.repeat(80));

  if (issues.length === 0) {
    console.log('\n✅ NO CONSISTENCY ISSUES FOUND');
    console.log('   All layers are properly aligned');
  } else {
    console.log(`\n⚠️  ${issues.length} CONSISTENCY ISSUES DETECTED\n`);

    // Group by layer
    const byLayer = issues.reduce((acc, issue) => {
      acc[issue.layer] = acc[issue.layer] || [];
      acc[issue.layer].push(issue);
      return acc;
    }, {} as Record<string, ConsistencyIssue[]>);

    for (const [layer, layerIssues] of Object.entries(byLayer)) {
      console.log(`\n📋 ${layer} (${layerIssues.length} issues):`);
      console.log('-'.repeat(80));
      for (const issue of layerIssues.slice(0, 10)) {
        console.log(`  ${issue.name} (${issue.playerMlbamId})`);
        console.log(`     Issue: ${issue.issue}`);
        console.log(`     Expected: ${issue.expected}`);
        console.log(`     Actual: ${issue.actual}`);
        console.log();
      }
      if (layerIssues.length > 10) {
        console.log(`  ... and ${layerIssues.length - 10} more`);
      }
    }
  }

  // Summary
  console.log('='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  console.log(`Players Checked: 50`);
  console.log(`Issues Found: ${issues.length}`);
  console.log(`Consistency Rate: ${((50 - issues.length) / 50 * 100).toFixed(1)}%`);

  await prisma.$disconnect();
}

runCrossLayerValidation().catch(e => {
  console.error(e);
  process.exit(1);
});
