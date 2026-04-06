#!/usr/bin/env node
/**
 * Random Sample Validation (Fixed)
 * 
 * Uses correct reference date (latest game date) for calculations.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { scoreSinglePlayer } from '../apps/worker/src/scoring/orchestrator';

const season = 2025;
const SAMPLE_SIZE_PER_TIER = 5;

interface ValidationResult {
  playerMlbamId: string;
  name: string;
  tier: string;
  issues: string[];
  data: {
    gameLogs: number;
    pa: number;
    avg: number;
    ops: number;
    score: number;
  };
}

async function getPlayerName(mlbamId: string): Promise<string> {
  const vp = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
    select: { fullName: true }
  });
  return vp?.fullName || `Unknown (${mlbamId})`;
}

async function validatePlayer(playerMlbamId: string, tier: string): Promise<ValidationResult> {
  const issues: string[] = [];
  const name = await getPlayerName(playerMlbamId);

  // Get game logs
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId, season },
    orderBy: { gameDate: 'desc' }
  });

  if (gameLogs.length === 0) {
    issues.push('No game logs found');
    return {
      playerMlbamId, name, tier, issues,
      data: { gameLogs: 0, pa: 0, avg: 0, ops: 0, score: 0 }
    };
  }

  // Get derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' }
  });

  if (!derived) {
    issues.push('No derived stats found');
    return {
      playerMlbamId, name, tier, issues,
      data: { gameLogs: gameLogs.length, pa: 0, avg: 0, ops: 0, score: 0 }
    };
  }

  // Get score
  const score = await scoreSinglePlayer(playerMlbamId, season);

  // Basic sanity checks
  if (derived.plateAppearancesLast30 === 0 && gameLogs.length > 0) {
    issues.push('PA is 0 despite having game logs');
  }

  if (derived.gamesLast30 === 0 && gameLogs.length > 0) {
    issues.push('Games is 0 despite having game logs');
  }

  // Check for impossible values
  if (derived.battingAverageLast30 !== null && derived.battingAverageLast30 > 0.500 && derived.plateAppearancesLast30 > 20) {
    issues.push(`Suspicious AVG: ${derived.battingAverageLast30.toFixed(3)} with ${derived.plateAppearancesLast30} PA`);
  }

  if (derived.opsLast30 !== null && derived.opsLast30 > 1.500 && derived.plateAppearancesLast30 > 20) {
    issues.push(`Suspicious OPS: ${derived.opsLast30.toFixed(3)} with ${derived.plateAppearancesLast30} PA`);
  }

  if (derived.gamesLast30 > 30) {
    issues.push(`Impossible games count: ${derived.gamesLast30} in 30 days`);
  }

  // Score alignment check
  if (score) {
    const expectedLevel = derived.opsLast30 && derived.opsLast30 > 0.850 ? 'high' :
                          derived.opsLast30 && derived.opsLast30 > 0.700 ? 'medium' : 'low';
    const actualLevel = score.overallValue >= 65 ? 'high' :
                        score.overallValue >= 50 ? 'medium' : 'low';
    
    if (expectedLevel === 'high' && actualLevel === 'low') {
      issues.push(`Score ${score.overallValue} too low for OPS ${derived.opsLast30?.toFixed(3)}`);
    }
    if (expectedLevel === 'low' && actualLevel === 'high') {
      issues.push(`Score ${score.overallValue} too high for OPS ${derived.opsLast30?.toFixed(3)}`);
    }
  }

  return {
    playerMlbamId,
    name,
    tier,
    issues,
    data: {
      gameLogs: gameLogs.length,
      pa: derived.plateAppearancesLast30,
      avg: derived.battingAverageLast30 || 0,
      ops: derived.opsLast30 || 0,
      score: score?.overallValue || 0,
    }
  };
}

async function runValidation() {
  console.log('\n' + '='.repeat(80));
  console.log('  RANDOM SAMPLE VALIDATION - Data Accuracy & Gap Detection');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}`);
  console.log(`Sample Size per Tier: ${SAMPLE_SIZE_PER_TIER}\n`);

  const results: ValidationResult[] = [];

  // Sample from different tiers
  const tiers = [
    { name: 'ELITE', filter: { opsLast30: { gte: 0.900 }, plateAppearancesLast30: { gte: 80 } } },
    { name: 'AVERAGE', filter: { opsLast30: { gte: 0.700, lt: 0.800 }, plateAppearancesLast30: { gte: 80 } } },
    { name: 'POOR', filter: { opsLast30: { lt: 0.600, gt: 0 }, plateAppearancesLast30: { gte: 80 } } },
    { name: 'SMALL_SAMPLE', filter: { plateAppearancesLast30: { lt: 30, gt: 0 } } },
  ];

  for (const tier of tiers) {
    console.log(`🔍 Sampling ${tier.name} players...`);
    const players = await prisma.playerDerivedStats.findMany({
      where: { season, ...tier.filter },
      take: 100,
      select: { playerMlbamId: true }
    });
    const sample = players.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE_PER_TIER);
    
    for (const p of sample) {
      results.push(await validatePlayer(p.playerMlbamId, tier.name));
    }
  }

  // Display results
  console.log('\n' + '='.repeat(80));
  console.log('  VALIDATION RESULTS');
  console.log('='.repeat(80));

  let totalIssues = 0;
  let passedChecks = 0;

  for (const result of results) {
    const passed = result.issues.length === 0;
    if (passed) passedChecks++; 
    totalIssues += result.issues.length;

    console.log(`\n${passed ? '✅' : '❌'} ${result.name} (${result.tier})`);
    console.log(`   ID: ${result.playerMlbamId}`);
    console.log(`   Game Logs: ${result.data.gameLogs} games | ${result.data.pa} PA`);
    console.log(`   Stats: ${result.data.avg.toFixed(3)} AVG | ${result.data.ops.toFixed(3)} OPS`);
    console.log(`   Score: ${result.data.score}/100`);
    
    if (result.issues.length > 0) {
      console.log(`   Issues:`);
      result.issues.forEach(issue => console.log(`      - ${issue}`));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Players Validated: ${results.length}`);
  console.log(`Passed: ${passedChecks} (${((passedChecks/results.length)*100).toFixed(1)}%)`);
  console.log(`Failed: ${results.length - passedChecks} (${(((results.length-passedChecks)/results.length)*100).toFixed(1)}%)`);
  console.log(`Total Issues Found: ${totalIssues}`);

  await prisma.$disconnect();
}

runValidation().catch(e => {
  console.error(e);
  process.exit(1);
});
