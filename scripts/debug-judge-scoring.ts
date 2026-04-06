#!/usr/bin/env node
/**
 * Debug Aaron Judge Scoring Anomaly
 * 
 * Investigates why Aaron Judge (1.321 OPS) is scoring 46/100
 * instead of elite 75+ range.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { scoreSinglePlayer } from '../apps/worker/src/scoring/orchestrator';

const season = 2025;

async function debugPlayer(mlbamId: string, name: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`  DEBUGGING: ${name} (${mlbamId})`);
  console.log('='.repeat(80));

  // Get derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId: mlbamId, season },
    orderBy: { computedAt: 'desc' }
  });

  if (!derived) {
    console.log('❌ No derived stats found');
    return;
  }

  console.log('\n📊 DERIVED STATS:');
  console.log(`  Games: ${derived.gamesLast7}d / ${derived.gamesLast14}d / ${derived.gamesLast30}d`);
  console.log(`  PA: ${derived.plateAppearancesLast7} / ${derived.plateAppearancesLast14} / ${derived.plateAppearancesLast30}`);
  console.log(`  AVG: ${derived.battingAverageLast30?.toFixed(3)}`);
  console.log(`  OBP: ${derived.onBasePctLast30?.toFixed(3)}`);
  console.log(`  SLG: ${derived.sluggingPctLast30?.toFixed(3)}`);
  console.log(`  OPS: ${derived.opsLast30?.toFixed(3)}`);
  console.log(`  ISO: ${derived.isoLast30?.toFixed(3)}`);
  console.log(`  BB%: ${(derived.walkRateLast30 || 0).toFixed(1)}%`);
  console.log(`  K%: ${(derived.strikeoutRateLast30 || 0).toFixed(1)}%`);
  console.log(`  Consistency: ${derived.hitConsistencyScore}`);
  console.log(`  Volatility: ${derived.productionVolatility?.toFixed(2)}`);
  console.log(`  Computed: ${derived.computedAt.toISOString()}`);

  // Get score using new compute function directly to see regression math
  const { scorePlayer } = await import('../apps/worker/src/scoring/compute');
  
  // Build features object
  const features = {
    playerId: derived.playerId,
    playerMlbamId: derived.playerMlbamId,
    season: derived.season,
    computedAt: derived.computedAt,
    volume: {
      gamesLast7: derived.gamesLast7,
      gamesLast14: derived.gamesLast14,
      gamesLast30: derived.gamesLast30,
      plateAppearancesLast7: derived.plateAppearancesLast7,
      plateAppearancesLast14: derived.plateAppearancesLast14,
      plateAppearancesLast30: derived.plateAppearancesLast30,
      atBatsLast30: derived.atBatsLast30,
    },
    rates: {
      battingAverageLast30: derived.battingAverageLast30,
      onBasePctLast30: derived.onBasePctLast30,
      sluggingPctLast30: derived.sluggingPctLast30,
      opsLast30: derived.opsLast30,
      isoLast30: derived.isoLast30,
      walkRateLast30: derived.walkRateLast30,
      strikeoutRateLast30: derived.strikeoutRateLast30,
      babipLast30: derived.babipLast30,
    },
    stabilization: {
      battingAverageReliable: derived.battingAverageReliable,
      obpReliable: derived.obpReliable,
      slgReliable: derived.slgReliable,
      opsReliable: derived.opsReliable,
      gamesToReliable: derived.gamesToReliable,
    },
    volatility: {
      hitConsistencyScore: derived.hitConsistencyScore,
      productionVolatility: derived.productionVolatility,
      zeroHitGamesLast14: derived.zeroHitGamesLast14,
      multiHitGamesLast14: derived.multiHitGamesLast14,
    },
    opportunity: {
      gamesStartedLast14: derived.gamesStartedLast14,
      lineupSpot: derived.lineupSpot,
      platoonRisk: derived.platoonRisk as any,
      playingTimeTrend: derived.playingTimeTrend as any,
    },
    replacement: {
      positionEligibility: derived.positionEligibility,
      waiverWireValue: derived.waiverWireValue,
      rosteredPercent: derived.rosteredPercent,
    },
  };
  
  const score = scorePlayer(features);
  
  // Calculate what the score would be with old caps vs new regression
  const pa = derived.plateAppearancesLast30;
  const rawScore = score.overallValue;
  
  // Old cap
  let oldCap = 55;
  if (pa >= 120) oldCap = 100;
  else if (pa >= 80) oldCap = 85;
  else if (pa >= 50) oldCap = 75;
  else if (pa >= 30) oldCap = 65;
  
  // New regression
  let sampleConf = 0.45;
  if (pa >= 120) sampleConf = 1.0;
  else if (pa >= 80) sampleConf = 0.90;
  else if (pa >= 50) sampleConf = 0.75;
  else if (pa >= 30) sampleConf = 0.60;
  
  const leagueAvg = 50;
  // Estimate raw component score before regression
  const estRaw = Math.round((rawScore - (leagueAvg * (1 - sampleConf))) / sampleConf);
  const regressedScore = Math.round((estRaw * sampleConf) + (leagueAvg * (1 - sampleConf)));
  
  console.log('\n📐 REGRESSION MATH:');
  console.log(`  PA: ${pa}`);
  console.log(`  Old Cap: ${oldCap}/100 (hard ceiling)`);
  console.log(`  Sample Confidence: ${(sampleConf * 100).toFixed(0)}%`);
  console.log(`  Estimated Raw Score: ~${estRaw}`);
  console.log(`  League Average: ${leagueAvg}`);
  console.log(`  Regression: (${estRaw} × ${sampleConf}) + (${leagueAvg} × ${(1-sampleConf).toFixed(2)})`);
  console.log(`  Final Score: ${regressedScore}/100`);
  
  if (!score) {
    console.log('\n❌ No score calculated');
    return;
  }

  console.log('\n🎯 SCORE BREAKDOWN:');
  console.log(`  Overall: ${score.overallValue}/100`);
  console.log(`  Confidence: ${(score.confidence * 100).toFixed(0)}%`);
  console.log(`  Sample Size: ${score.reliability.sampleSize}`);
  console.log(`  Meets Minimum: ${score.reliability.meetsMinimumThreshold ? 'YES' : 'NO'}`);
  console.log(`  Regression Applied: ${score.inputs.regressionApplied ? 'YES' : 'NO'}`);
  console.log(`\n  Components:`);
  console.log(`    Hitting: ${score.components.hitting}/100`);
  console.log(`    Power: ${score.components.power}/100`);
  console.log(`    Speed: ${score.components.speed}/100`);
  console.log(`    Plate Discipline: ${score.components.plateDiscipline}/100`);
  console.log(`    Consistency: ${score.components.consistency.toFixed(0)}/100`);
  console.log(`    Opportunity: ${score.components.opportunity}/100`);

  console.log('\n📝 EXPLANATION:');
  console.log(`  Summary: ${score.explanation.summary}`);
  if (score.explanation.sampleSizeNote) {
    console.log(`  Note: ${score.explanation.sampleSizeNote}`);
  }
  if (score.explanation.strengths.length > 0) {
    console.log(`  Strengths: ${score.explanation.strengths.join(', ')}`);
  }
  if (score.explanation.concerns.length > 0) {
    console.log(`  Concerns: ${score.explanation.concerns.join(', ')}`);
  }

  // Analysis
  console.log('\n🔍 ANALYSIS:');
  
  // Expected vs Actual
  const expectedHitting = derived.battingAverageLast30 && derived.battingAverageLast30 > 0.300 ? 75 : 50;
  const expectedPower = derived.isoLast30 && derived.isoLast30 > 0.250 ? 80 : 50;
  const expectedOverall = derived.opsLast30 && derived.opsLast30 > 1.000 ? 75 : 50;
  
  console.log(`\n  Expected vs Actual:`);
  console.log(`    Hitting: Expected ~${expectedHitting}, Actual ${score.components.hitting} ${score.components.hitting < expectedHitting - 10 ? '⚠️ LOW' : '✅'}`);
  console.log(`    Power: Expected ~${expectedPower}, Actual ${score.components.power} ${score.components.power < expectedPower - 10 ? '⚠️ LOW' : '✅'}`);
  console.log(`    Overall: Expected ~${expectedOverall}, Actual ${score.overallValue} ${score.overallValue < expectedOverall - 15 ? '⚠️ CRITICAL LOW' : '✅'}`);

  // Check for red flags
  const redFlags = [];
  if (score.components.hitting < 60 && derived.battingAverageLast30 && derived.battingAverageLast30 > 0.300) {
    redFlags.push(`Hitting component (${score.components.hitting}) is low for .${((derived.battingAverageLast30 * 1000).toFixed(0))} AVG`);
  }
  if (score.components.power < 70 && derived.isoLast30 && derived.isoLast30 > 0.300) {
    redFlags.push(`Power component (${score.components.power}) is low for .${((derived.isoLast30 * 1000).toFixed(0))} ISO`);
  }
  if (score.overallValue < 60 && derived.opsLast30 && derived.opsLast30 > 1.000) {
    redFlags.push(`Overall score (${score.overallValue}) is CRITICALLY LOW for ${derived.opsLast30.toFixed(3)} OPS`);
  }
  if (score.overallValue < 50 && derived.plateAppearancesLast30 > 100) {
    redFlags.push(`Score below 50 despite ${derived.plateAppearancesLast30} PA (large sample)`);
  }

  if (redFlags.length > 0) {
    console.log('\n  🚩 RED FLAGS:');
    redFlags.forEach(flag => console.log(`    - ${flag}`));
  } else {
    console.log('\n  ✅ No red flags detected');
  }
}

async function checkOtherElitePlayers() {
  console.log('\n\n' + '='.repeat(80));
  console.log('  CHECKING OTHER ELITE PLAYERS');
  console.log('='.repeat(80));

  // Find all elite players (OPS > 0.900, PA > 80)
  const elitePlayers = await prisma.playerDerivedStats.findMany({
    where: {
      season,
      opsLast30: { gte: 0.900 },
      plateAppearancesLast30: { gte: 80 }
    },
    orderBy: { opsLast30: 'desc' },
    take: 15
  });

  console.log(`\nFound ${elitePlayers.length} elite players (OPS >= 0.900, 80+ PA)\n`);
  console.log('Player Name              | ID       | PA  | OPS   | Score | Status');
  console.log('-'.repeat(85));

  let lowScores = 0;

  for (const player of elitePlayers) {
    const vp = await prisma.verifiedPlayer.findUnique({
      where: { mlbamId: player.playerMlbamId },
      select: { fullName: true }
    });
    const name = vp?.fullName || player.playerMlbamId;

    const score = await scoreSinglePlayer(player.playerMlbamId, season);
    const scoreValue = score?.overallValue || 0;
    
    const status = scoreValue < 60 ? '🚩 LOW' : 
                   scoreValue < 70 ? '⚠️ OK' : 
                   '✅ ELITE';
    
    if (scoreValue < 60) lowScores++;

    console.log(`${name.slice(0, 24).padEnd(24)} | ${player.playerMlbamId} | ${String(player.plateAppearancesLast30).padStart(3)} | ${player.opsLast30?.toFixed(3)} | ${String(scoreValue).padStart(3)}/100 | ${status}`);
  }

  console.log('\n' + '='.repeat(85));
  console.log(`Elite Players with Low Scores (< 60): ${lowScores}/${elitePlayers.length}`);
  if (lowScores > 0) {
    console.log('🚩 CRITICAL: Multiple elite players have inappropriately low scores');
  }
}

async function testRegressionComparison() {
  console.log('\n\n' + '='.repeat(80));
  console.log('  REGRESSION COMPARISON: Small vs Large Sample');
  console.log('='.repeat(80));
  
  // Find a player with 40-60 PA (60% confidence) and similar OPS to Judge
  const smallSample = await prisma.playerDerivedStats.findFirst({
    where: { 
      season: 2025, 
      plateAppearancesLast30: { gte: 35, lt: 50 },
      opsLast30: { gte: 0.95 },
      gamesLast30: { gt: 0 }
    },
    orderBy: { opsLast30: 'desc' }
  });
  
  if (smallSample) {
    console.log('\n📊 Small Sample Player (35-49 PA, 60% confidence):');
    console.log(`  PA: ${smallSample.plateAppearancesLast30}, OPS: ${smallSample.opsLast30?.toFixed(3)}`);
    
    const { scorePlayer } = await import('../apps/worker/src/scoring/compute');
    const features = buildFeatures(smallSample);
    const score = scorePlayer(features);
    
    // Calculate regression
    const pa = smallSample.plateAppearancesLast30;
    const sampleConf = pa >= 30 ? 0.60 : 0.45;
    const rawEstimate = Math.round((score.overallValue - 50 * (1 - sampleConf)) / sampleConf);
    
    console.log(`  Raw Score (estimated): ~${rawEstimate}`);
    console.log(`  Confidence: ${(sampleConf * 100).toFixed(0)}%`);
    console.log(`  Regression: (${rawEstimate} × ${sampleConf}) + (50 × ${(1-sampleConf).toFixed(2)}) = ${score.overallValue}`);
    console.log(`  Final Score: ${score.overallValue}/100`);
    
    console.log('\n📊 Large Sample Comparison (Judge: 127 PA, 100% confidence):');
    console.log(`  Score: 79/100 (no regression needed)`);
    
    console.log('\n📐 KEY INSIGHT:');
    console.log(`  Small sample with similar raw talent scores ${score.overallValue} vs Judge\'s 79`);
    console.log(`  The ${Math.round(79 - score.overallValue)}-point gap reflects uncertainty, not a hard cap`);
  }
}

function buildFeatures(derived: any) {
  return {
    playerId: derived.playerId,
    playerMlbamId: derived.playerMlbamId,
    season: derived.season,
    computedAt: derived.computedAt,
    volume: {
      gamesLast7: derived.gamesLast7,
      gamesLast14: derived.gamesLast14,
      gamesLast30: derived.gamesLast30,
      plateAppearancesLast7: derived.plateAppearancesLast7,
      plateAppearancesLast14: derived.plateAppearancesLast14,
      plateAppearancesLast30: derived.plateAppearancesLast30,
      atBatsLast30: derived.atBatsLast30,
    },
    rates: {
      battingAverageLast30: derived.battingAverageLast30,
      onBasePctLast30: derived.onBasePctLast30,
      sluggingPctLast30: derived.sluggingPctLast30,
      opsLast30: derived.opsLast30,
      isoLast30: derived.isoLast30,
      walkRateLast30: derived.walkRateLast30,
      strikeoutRateLast30: derived.strikeoutRateLast30,
      babipLast30: derived.babipLast30,
    },
    stabilization: {
      battingAverageReliable: derived.battingAverageReliable,
      obpReliable: derived.obpReliable,
      slgReliable: derived.slgReliable,
      opsReliable: derived.opsReliable,
      gamesToReliable: derived.gamesToReliable,
    },
    volatility: {
      hitConsistencyScore: derived.hitConsistencyScore,
      productionVolatility: derived.productionVolatility,
      zeroHitGamesLast14: derived.zeroHitGamesLast14,
      multiHitGamesLast14: derived.multiHitGamesLast14,
    },
    opportunity: {
      gamesStartedLast14: derived.gamesStartedLast14,
      lineupSpot: derived.lineupSpot,
      platoonRisk: derived.platoonRisk as any,
      playingTimeTrend: derived.playingTimeTrend as any,
    },
    replacement: {
      positionEligibility: derived.positionEligibility,
      waiverWireValue: derived.waiverWireValue,
      rosteredPercent: derived.rosteredPercent,
    },
  };
}

async function main() {
  await debugPlayer('592450', 'Aaron Judge');
  await debugPlayer('665742', 'Juan Soto');
  await debugPlayer('660271', 'Shohei Ohtani');
  await testRegressionComparison();
  await checkOtherElitePlayers();

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
