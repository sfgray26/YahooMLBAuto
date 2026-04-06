#!/usr/bin/env node
/**
 * Calculation Verification
 * 
 * Manually recalculates derived statistics from raw game logs
 * and compares against stored values to ensure accuracy.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

const season = 2025;
const TOLERANCE = 0.02; // 2% tolerance for floating point

interface CalculationCheck {
  playerMlbamId: string;
  name: string;
  checks: Array<{
    metric: string;
    stored: number;
    calculated: number;
    diff: number;
    passed: boolean;
  }>;
}

async function getPlayerName(mlbamId: string): Promise<string> {
  const vp = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
    select: { fullName: true }
  });
  return vp?.fullName || mlbamId;
}

async function verifyCalculationsForPlayer(playerMlbamId: string): Promise<CalculationCheck> {
  const name = await getPlayerName(playerMlbamId);
  
  // Get game logs
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId, season },
    orderBy: { gameDate: 'desc' }
  });

  // Get stored derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' }
  });

  if (!derived || gameLogs.length === 0) {
    return {
      playerMlbamId,
      name,
      checks: [{
        metric: 'Data Availability',
        stored: 0,
        calculated: 0,
        diff: 0,
        passed: false
      }]
    };
  }

  // Calculate cutoff dates
  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const d14 = new Date(now); d14.setDate(d14.getDate() - 14);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

  // Filter games
  const games7 = gameLogs.filter(g => g.gameDate >= d7);
  const games14 = gameLogs.filter(g => g.gameDate >= d14);
  const games30 = gameLogs.filter(g => g.gameDate >= d30);

  // Manual calculations for 30-day window
  const totals30 = games30.reduce((acc, g) => ({
    games: acc.games + g.gamesPlayed,
    pa: acc.pa + g.plateAppearances,
    ab: acc.ab + g.atBats,
    hits: acc.hits + g.hits,
    doubles: acc.doubles + (g.doubles || 0),
    triples: acc.triples + (g.triples || 0),
    hr: acc.hr + (g.homeRuns || 0),
    walks: acc.walks + (g.walks || 0),
    strikeouts: acc.strikeouts + (g.strikeouts || 0),
    tb: acc.tb + (g.totalBases || 0),
  }), { games: 0, pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, walks: 0, strikeouts: 0, tb: 0 });

  // Calculate rates
  const calcAvg = totals30.ab > 0 ? totals30.hits / totals30.ab : 0;
  const calcObp = totals30.pa > 0 ? (totals30.hits + totals30.walks) / totals30.pa : 0;
  const calcSlg = totals30.ab > 0 ? totals30.tb / totals30.ab : 0;
  const calcOps = calcObp + calcSlg;
  const calcIso = calcSlg - calcAvg;
  const calcBbRate = totals30.pa > 0 ? totals30.walks / totals30.pa : 0;
  const calcKRate = totals30.pa > 0 ? totals30.strikeouts / totals30.pa : 0;

  // Compare with stored values
  const checks = [
    {
      metric: 'Games (30d)',
      stored: derived.gamesLast30,
      calculated: totals30.games,
      diff: Math.abs(derived.gamesLast30 - totals30.games),
      passed: Math.abs(derived.gamesLast30 - totals30.games) <= 1
    },
    {
      metric: 'PA (30d)',
      stored: derived.plateAppearancesLast30,
      calculated: totals30.pa,
      diff: Math.abs(derived.plateAppearancesLast30 - totals30.pa),
      passed: Math.abs(derived.plateAppearancesLast30 - totals30.pa) <= 2
    },
    {
      metric: 'AVG',
      stored: derived.battingAverageLast30 || 0,
      calculated: calcAvg,
      diff: Math.abs((derived.battingAverageLast30 || 0) - calcAvg),
      passed: Math.abs((derived.battingAverageLast30 || 0) - calcAvg) <= TOLERANCE
    },
    {
      metric: 'OBP',
      stored: derived.onBasePctLast30 || 0,
      calculated: calcObp,
      diff: Math.abs((derived.onBasePctLast30 || 0) - calcObp),
      passed: Math.abs((derived.onBasePctLast30 || 0) - calcObp) <= TOLERANCE
    },
    {
      metric: 'SLG',
      stored: derived.sluggingPctLast30 || 0,
      calculated: calcSlg,
      diff: Math.abs((derived.sluggingPctLast30 || 0) - calcSlg),
      passed: Math.abs((derived.sluggingPctLast30 || 0) - calcSlg) <= TOLERANCE
    },
    {
      metric: 'OPS',
      stored: derived.opsLast30 || 0,
      calculated: calcOps,
      diff: Math.abs((derived.opsLast30 || 0) - calcOps),
      passed: Math.abs((derived.opsLast30 || 0) - calcOps) <= TOLERANCE
    },
    {
      metric: 'ISO',
      stored: derived.isoLast30 || 0,
      calculated: calcIso,
      diff: Math.abs((derived.isoLast30 || 0) - calcIso),
      passed: Math.abs((derived.isoLast30 || 0) - calcIso) <= TOLERANCE
    },
    {
      metric: 'BB%',
      stored: derived.walkRateLast30 || 0,
      calculated: calcBbRate,
      diff: Math.abs((derived.walkRateLast30 || 0) - calcBbRate),
      passed: Math.abs((derived.walkRateLast30 || 0) - calcBbRate) <= TOLERANCE
    },
    {
      metric: 'K%',
      stored: derived.strikeoutRateLast30 || 0,
      calculated: calcKRate,
      diff: Math.abs((derived.strikeoutRateLast30 || 0) - calcKRate),
      passed: Math.abs((derived.strikeoutRateLast30 || 0) - calcKRate) <= TOLERANCE
    }
  ];

  return { playerMlbamId, name, checks };
}

async function runVerification() {
  console.log('\n' + '='.repeat(80));
  console.log('  CALCULATION VERIFICATION');
  console.log('  Manually verifying derived stats from game logs');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}`);
  console.log(`Tolerance: ${(TOLERANCE * 100).toFixed(0)}%\n`);

  // Sample players from different tiers
  const samplePlayers = [
    '592450', // Aaron Judge
    '665742', // Juan Soto
    '605141', // Mookie Betts
    '650490', // Yandy Díaz
    '600869', // Jeimer Candelario
  ];

  console.log('Verifying calculations for sample players...\n');

  let totalChecks = 0;
  let passedChecks = 0;
  let failedPlayers = 0;

  for (const playerId of samplePlayers) {
    const result = await verifyCalculationsForPlayer(playerId);
    const playerPassed = result.checks.every(c => c.passed);
    if (!playerPassed) failedPlayers++;

    console.log(`${playerPassed ? '✅' : '❌'} ${result.name} (${result.playerMlbamId})`);
    
    for (const check of result.checks) {
      totalChecks++;
      if (check.passed) passedChecks++;
      
      const status = check.passed ? '✓' : '✗';
      console.log(`   ${status} ${check.metric}: stored=${check.stored.toFixed(3)}, calc=${check.calculated.toFixed(3)}, diff=${check.diff.toFixed(3)}`);
    }
    console.log();
  }

  // Summary
  console.log('='.repeat(80));
  console.log('  VERIFICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Checks: ${totalChecks}`);
  console.log(`Passed: ${passedChecks} (${((passedChecks/totalChecks)*100).toFixed(1)}%)`);
  console.log(`Failed: ${totalChecks - passedChecks} (${(((totalChecks-passedChecks)/totalChecks)*100).toFixed(1)}%)`);
  console.log(`Players with Errors: ${failedPlayers}/${samplePlayers.length}`);

  if (failedPlayers === 0) {
    console.log('\n✅ ALL CALCULATIONS VERIFIED');
  } else {
    console.log('\n⚠️  CALCULATION ERRORS DETECTED');
  }

  await prisma.$disconnect();
}

runVerification().catch(e => {
  console.error(e);
  process.exit(1);
});
