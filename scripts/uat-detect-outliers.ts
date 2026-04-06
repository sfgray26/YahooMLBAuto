#!/usr/bin/env node
/**
 * Outlier Detection
 * 
 * Identifies suspicious data points that may indicate:
 * - Data entry errors
 * - Calculation bugs
 * - API anomalies
 * - Impossible statistics
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

const season = 2025;

interface Outlier {
  playerMlbamId: string;
  name: string;
  type: string;
  value: number | string;
  reason: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

async function getPlayerName(mlbamId: string): Promise<string> {
  const vp = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
    select: { fullName: true }
  });
  return vp?.fullName || mlbamId;
}

async function detectOutliers(): Promise<Outlier[]> {
  const outliers: Outlier[] = [];

  // Get all derived stats
  const allStats = await prisma.playerDerivedStats.findMany({
    where: { season }
  });

  console.log(`Analyzing ${allStats.length} players for outliers...\n`);

  for (const stat of allStats) {
    const name = await getPlayerName(stat.playerMlbamId);

    // Check 1: Impossible AVG (> .500 or < .050 with significant PA)
    if (stat.battingAverageLast30 !== null) {
      if (stat.battingAverageLast30 > 0.500 && stat.plateAppearancesLast30 > 20) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'AVG',
          value: stat.battingAverageLast30.toFixed(3),
          reason: `AVG > .500 with ${stat.plateAppearancesLast30} PA (possible error)`,
          severity: 'HIGH'
        });
      }
      if (stat.battingAverageLast30 < 0.050 && stat.plateAppearancesLast30 > 50) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'AVG',
          value: stat.battingAverageLast30.toFixed(3),
          reason: `AVG < .050 with ${stat.plateAppearancesLast30} PA (possible error)`,
          severity: 'HIGH'
        });
      }
    }

    // Check 2: Impossible OPS (> 1.500 or < .300 with significant PA)
    if (stat.opsLast30 !== null) {
      if (stat.opsLast30 > 1.500 && stat.plateAppearancesLast30 > 20) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'OPS',
          value: stat.opsLast30.toFixed(3),
          reason: `OPS > 1.500 with ${stat.plateAppearancesLast30} PA (likely small sample)`,
          severity: stat.plateAppearancesLast30 < 10 ? 'LOW' : 'HIGH'
        });
      }
      if (stat.opsLast30 < 0.300 && stat.plateAppearancesLast30 > 50) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'OPS',
          value: stat.opsLast30.toFixed(3),
          reason: `OPS < .300 with ${stat.plateAppearancesLast30} PA (severe struggles)`,
          severity: 'MEDIUM'
        });
      }
    }

    // Check 3: Impossible BB% or K%
    if (stat.walkRateLast30 !== null && stat.walkRateLast30 > 0.30 && stat.plateAppearancesLast30 > 30) {
      outliers.push({
        playerMlbamId: stat.playerMlbamId,
        name,
        type: 'BB%',
        value: `${(stat.walkRateLast30 * 100).toFixed(1)}%`,
        reason: `BB% > 30% with ${stat.plateAppearancesLast30} PA (extreme)`,
        severity: 'MEDIUM'
      });
    }
    if (stat.strikeoutRateLast30 !== null && stat.strikeoutRateLast30 > 0.45 && stat.plateAppearancesLast30 > 30) {
      outliers.push({
        playerMlbamId: stat.playerMlbamId,
        name,
        type: 'K%',
        value: `${(stat.strikeoutRateLast30 * 100).toFixed(1)}%`,
        reason: `K% > 45% with ${stat.plateAppearancesLast30} PA (extreme)`,
        severity: 'MEDIUM'
      });
    }

    // Check 4: More games than possible (30-day window should max at ~27-28 games)
    if (stat.gamesLast30 > 30) {
      outliers.push({
        playerMlbamId: stat.playerMlbamId,
        name,
        type: 'GAMES',
        value: stat.gamesLast30,
        reason: `${stat.gamesLast30} games in 30-day window (impossible - double counting?)`,
        severity: 'HIGH'
      });
    }

    // Check 5: Extreme ISO (> .500 or negative)
    if (stat.isoLast30 !== null) {
      if (stat.isoLast30 > 0.500 && stat.plateAppearancesLast30 > 20) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'ISO',
          value: stat.isoLast30.toFixed(3),
          reason: `ISO > .500 with ${stat.plateAppearancesLast30} PA (extreme power)`,
          severity: 'MEDIUM'
        });
      }
      if (stat.isoLast30 < 0) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'ISO',
          value: stat.isoLast30.toFixed(3),
          reason: 'Negative ISO (calculation error)',
          severity: 'HIGH'
        });
      }
    }

    // Check 6: PA/G ratio anomalies
    if (stat.gamesLast30 > 0) {
      const paPerGame = stat.plateAppearancesLast30 / stat.gamesLast30;
      if (paPerGame > 6) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'PA/G',
          value: paPerGame.toFixed(1),
          reason: `${paPerGame.toFixed(1)} PA per game (too high - data error?)`,
          severity: 'HIGH'
        });
      }
      if (paPerGame < 2 && stat.gamesLast30 > 10) {
        outliers.push({
          playerMlbamId: stat.playerMlbamId,
          name,
          type: 'PA/G',
          value: paPerGame.toFixed(1),
          reason: `${paPerGame.toFixed(1)} PA per game (pinch hitter/platoon player)`,
          severity: 'LOW'
        });
      }
    }

    // Check 7: Consistency score outliers
    if (stat.hitConsistencyScore > 95) {
      outliers.push({
        playerMlbamId: stat.playerMlbamId,
        name,
        type: 'CONSISTENCY',
        value: stat.hitConsistencyScore,
        reason: `Consistency score ${stat.hitConsistencyScore} (nearly perfect - verify)`,
        severity: 'LOW'
      });
    }
  }

  return outliers;
}

async function runOutlierDetection() {
  console.log('\n' + '='.repeat(80));
  console.log('  OUTLIER DETECTION');
  console.log('  Identifying suspicious data points');
  console.log('='.repeat(80));
  console.log(`\nSeason: ${season}\n`);

  const outliers = await detectOutliers();

  // Group by severity
  const highSeverity = outliers.filter(o => o.severity === 'HIGH');
  const mediumSeverity = outliers.filter(o => o.severity === 'MEDIUM');
  const lowSeverity = outliers.filter(o => o.severity === 'LOW');

  console.log(`Total Outliers Found: ${outliers.length}\n`);

  if (highSeverity.length > 0) {
    console.log('🔴 HIGH SEVERITY (Require immediate attention):');
    console.log('-'.repeat(80));
    for (const o of highSeverity.slice(0, 20)) {
      console.log(`  ${o.name} (${o.playerMlbamId})`);
      console.log(`     ${o.type}: ${o.value}`);
      console.log(`     Reason: ${o.reason}`);
      console.log();
    }
    if (highSeverity.length > 20) {
      console.log(`  ... and ${highSeverity.length - 20} more`);
    }
  }

  if (mediumSeverity.length > 0) {
    console.log('\n🟡 MEDIUM SEVERITY (Review recommended):');
    console.log('-'.repeat(80));
    for (const o of mediumSeverity.slice(0, 15)) {
      console.log(`  ${o.name}: ${o.type}=${o.value} - ${o.reason}`);
    }
    if (mediumSeverity.length > 15) {
      console.log(`  ... and ${mediumSeverity.length - 15} more`);
    }
  }

  if (lowSeverity.length > 0) {
    console.log('\n🟢 LOW SEVERITY (Informational):');
    console.log('-'.repeat(80));
    console.log(`  ${lowSeverity.length} low-severity outliers found`);
    console.log('  (Extreme but possible values)');
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('  OUTLIER SUMMARY');
  console.log('='.repeat(80));
  console.log(`High Severity:   ${highSeverity.length}`);
  console.log(`Medium Severity: ${mediumSeverity.length}`);
  console.log(`Low Severity:    ${lowSeverity.length}`);
  console.log(`Total:           ${outliers.length}`);

  if (highSeverity.length === 0) {
    console.log('\n✅ NO HIGH-SEVERITY OUTLIERS DETECTED');
  } else {
    console.log(`\n⚠️  ${highSeverity.length} HIGH-SEVERITY ISSUES REQUIRE ATTENTION`);
  }

  await prisma.$disconnect();
}

runOutlierDetection().catch(e => {
  console.error(e);
  process.exit(1);
});
