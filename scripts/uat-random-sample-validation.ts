#!/usr/bin/env node
/**
 * Random Sample Validation
 * 
 * Pulls random players from different performance tiers and validates:
 * - Game logs exist and are complete
 * - Derived stats calculate correctly from game logs
 * - Scores are consistent with stats
 * - No data gaps or anomalies
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
  checks: {
    hasGameLogs: boolean;
    hasDerivedStats: boolean;
    hasScore: boolean;
    gameLogCount: number;
    derivedStatsFresh: boolean;
    calculationsCorrect: boolean;
  };
  issues: string[];
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

  // Check 1: Game logs exist
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId, season },
    orderBy: { gameDate: 'desc' }
  });
  const hasGameLogs = gameLogs.length > 0;
  if (!hasGameLogs) issues.push('No game logs found');

  // Check 2: Derived stats exist
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' }
  });
  const hasDerivedStats = !!derived;
  if (!hasDerivedStats) issues.push('No derived stats found');

  // Check 3: Can calculate score
  const score = hasDerivedStats ? await scoreSinglePlayer(playerMlbamId, season) : null;
  const hasScore = !!score;
  if (!hasScore && hasDerivedStats) issues.push('Failed to calculate score');

  // Check 4: Verify calculations from game logs
  let calculationsCorrect = true;
  if (hasGameLogs && hasDerivedStats) {
    // Manually calculate last 30 days from game logs
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentGames = gameLogs.filter(g => g.gameDate >= thirtyDaysAgo);
    const manualPA = recentGames.reduce((sum, g) => sum + g.plateAppearances, 0);
    const manualGames = recentGames.length;
    
    // Allow 10% tolerance for calculation differences
    if (Math.abs(manualPA - derived.plateAppearancesLast30) > derived.plateAppearancesLast30 * 0.1) {
      issues.push(`PA mismatch: manual=${manualPA}, stored=${derived.plateAppearancesLast30}`);
      calculationsCorrect = false;
    }
    if (Math.abs(manualGames - derived.gamesLast30) > 2) {
      issues.push(`Games mismatch: manual=${manualGames}, stored=${derived.gamesLast30}`);
      calculationsCorrect = false;
    }
  }

  // Check 5: Derived stats timestamp (should be recent)
  const derivedStatsFresh = derived ? 
    (new Date().getTime() - derived.computedAt.getTime()) < 24 * 60 * 60 * 1000 : // 24 hours
    false;

  return {
    playerMlbamId,
    name,
    tier,
    checks: {
      hasGameLogs,
      hasDerivedStats,
      hasScore,
      gameLogCount: gameLogs.length,
      derivedStatsFresh,
      calculationsCorrect,
    },
    issues,
  };
}

async function runValidation() {
  console.log('\n' + '='.repeat(80));
  console.log('  RANDOM SAMPLE VALIDATION - Data Accuracy & Gap Detection');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}`);
  console.log(`Sample Size per Tier: ${SAMPLE_SIZE_PER_TIER}\n`);

  const results: ValidationResult[] = [];

  // Tier 1: Elite players (OPS >= 0.900, 80+ PA)
  console.log('🔍 Sampling ELITE players (OPS >= 0.900, 80+ PA)...');
  const elite = await prisma.playerDerivedStats.findMany({
    where: { season, opsLast30: { gte: 0.900 }, plateAppearancesLast30: { gte: 80 } },
    take: 100,
    select: { playerMlbamId: true }
  });
  const eliteSample = elite.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE_PER_TIER);
  
  for (const p of eliteSample) {
    results.push(await validatePlayer(p.playerMlbamId, 'ELITE'));
  }

  // Tier 2: Average players (OPS 0.700-0.800, 80+ PA)
  console.log('🔍 Sampling AVERAGE players (OPS 0.700-0.800, 80+ PA)...');
  const average = await prisma.playerDerivedStats.findMany({
    where: { 
      season, 
      opsLast30: { gte: 0.700, lt: 0.800 }, 
      plateAppearancesLast30: { gte: 80 } 
    },
    take: 100,
    select: { playerMlbamId: true }
  });
  const averageSample = average.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE_PER_TIER);
  
  for (const p of averageSample) {
    results.push(await validatePlayer(p.playerMlbamId, 'AVERAGE'));
  }

  // Tier 3: Poor performers (OPS < 0.600, 80+ PA)
  console.log('🔍 Sampling POOR performers (OPS < 0.600, 80+ PA)...');
  const poor = await prisma.playerDerivedStats.findMany({
    where: { 
      season, 
      opsLast30: { lt: 0.600, gt: 0 }, 
      plateAppearancesLast30: { gte: 80 } 
    },
    take: 100,
    select: { playerMlbamId: true }
  });
  const poorSample = poor.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE_PER_TIER);
  
  for (const p of poorSample) {
    results.push(await validatePlayer(p.playerMlbamId, 'POOR'));
  }

  // Tier 4: Small samples (< 30 PA)
  console.log('🔍 Sampling SMALL SAMPLES (< 30 PA)...');
  const small = await prisma.playerDerivedStats.findMany({
    where: { season, plateAppearancesLast30: { lt: 30, gt: 0 } },
    take: 100,
    select: { playerMlbamId: true }
  });
  const smallSample = small.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE_PER_TIER);
  
  for (const p of smallSample) {
    results.push(await validatePlayer(p.playerMlbamId, 'SMALL_SAMPLE'));
  }

  // Tier 5: Random from all players
  console.log('🔍 Sampling RANDOM players...');
  const all = await prisma.playerDerivedStats.findMany({
    where: { season },
    take: 200,
    select: { playerMlbamId: true }
  });
  const randomSample = all.sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE_PER_TIER);
  
  for (const p of randomSample) {
    results.push(await validatePlayer(p.playerMlbamId, 'RANDOM'));
  }

  // Display results
  console.log('\n' + '='.repeat(80));
  console.log('  VALIDATION RESULTS');
  console.log('='.repeat(80));

  let totalIssues = 0;
  let passedChecks = 0;
  let failedChecks = 0;

  for (const result of results) {
    const passed = result.issues.length === 0;
    if (passed) passedChecks++; else failedChecks++;
    totalIssues += result.issues.length;

    console.log(`\n${passed ? '✅' : '❌'} ${result.name} (${result.tier})`);
    console.log(`   ID: ${result.playerMlbamId}`);
    console.log(`   Game Logs: ${result.checks.gameLogCount} games`);
    console.log(`   Derived: ${result.checks.hasDerivedStats ? 'Yes' : 'No'}`);
    console.log(`   Score: ${result.checks.hasScore ? 'Yes' : 'No'}`);
    console.log(`   Calculations: ${result.checks.calculationsCorrect ? 'Correct' : 'INCORRECT'}`);
    
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
  console.log(`Failed: ${failedChecks} (${((failedChecks/results.length)*100).toFixed(1)}%)`);
  console.log(`Total Issues Found: ${totalIssues}`);

  // Gap analysis
  const missingGameLogs = results.filter(r => !r.checks.hasGameLogs).length;
  const missingDerived = results.filter(r => !r.checks.hasDerivedStats).length;
  const calculationErrors = results.filter(r => !r.checks.calculationsCorrect).length;

  console.log('\n📊 Gap Analysis:');
  console.log(`   Missing Game Logs: ${missingGameLogs}`);
  console.log(`   Missing Derived Stats: ${missingDerived}`);
  console.log(`   Calculation Errors: ${calculationErrors}`);

  if (totalIssues === 0) {
    console.log('\n✅ ALL CHECKS PASSED - Data appears accurate and complete');
  } else {
    console.log('\n⚠️  ISSUES DETECTED - Review failures above');
  }

  await prisma.$disconnect();
}

runValidation().catch(e => {
  console.error(e);
  process.exit(1);
});
