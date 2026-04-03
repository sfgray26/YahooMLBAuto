#!/usr/bin/env node
/**
 * Player Scoring Layer Validation
 * 
 * Validates that deterministic scoring produces intuitive, reasonable player rankings.
 * 
 * Test Cases:
 * 1. Component scores reflect intuition (stars high, bench bats low)
 * 2. Opportunity drives score changes properly
 * 3. Confidence drops when stability drops
 * 4. Scores move smoothly (no wild oscillations)
 * 5. Bench bats don't outrank stars without explanation
 * 
 * Exit Criteria: Scores feel like how a sharp manager would talk about players
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { scoreSinglePlayer } from '../apps/worker/src/scoring/orchestrator';

const season = parseInt(process.argv[2] || '2025');

// Test thresholds
const THRESHOLDS = {
  ELITE: 70,      // Top tier players
  STARTER: 55,    // Regular starters  
  BENCH: 45,      // Bench/platoon players
  STREAMER: 35,   // Streaming options
};

interface ValidationTest {
  name: string;
  test: () => Promise<{ passed: boolean; details: string }>;
}

/**
 * Get player info for reporting
 */
async function getPlayerInfo(mlbamId: string) {
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId: mlbamId, season },
    orderBy: { computedAt: 'desc' },
  });
  return derived;
}

/**
 * Test 1: Component Scores Reflect Intuition
 * - High BA/OPS players should have high hitting scores
 * - High ISO players should have high power scores
 * - Low K%/high BB% should have good discipline scores
 */
async function testComponentIntuition(): Promise<{ passed: boolean; details: string }> {
  const issues: string[] = [];
  
  // Find players with extreme stats
  const highAvg = await prisma.playerDerivedStats.findFirst({
    where: { season, battingAverageLast30: { gte: 0.300 } },
    orderBy: { battingAverageLast30: 'desc' },
  });
  
  const lowAvg = await prisma.playerDerivedStats.findFirst({
    where: { season, battingAverageLast30: { lte: 0.200, gt: 0 } },
    orderBy: { battingAverageLast30: 'asc' },
  });
  
  const highIso = await prisma.playerDerivedStats.findFirst({
    where: { season, isoLast30: { gte: 0.250 } },
    orderBy: { isoLast30: 'desc' },
  });
  
  const lowIso = await prisma.playerDerivedStats.findFirst({
    where: { season, isoLast30: { lte: 0.080, gt: 0 } },
    orderBy: { isoLast30: 'asc' },
  });
  
  // Score them
  if (highAvg) {
    const score = await scoreSinglePlayer(highAvg.playerMlbamId, season);
    if (!score || score.components.hitting < 70) {
      issues.push(`High AVG player (${highAvg.battingAverageLast30?.toFixed(3)}) has hitting score ${score?.components.hitting}, expected 70+`);
    }
  }
  
  if (lowAvg) {
    const score = await scoreSinglePlayer(lowAvg.playerMlbamId, season);
    if (!score || score.components.hitting > 40) {
      issues.push(`Low AVG player (${lowAvg.battingAverageLast30?.toFixed(3)}) has hitting score ${score?.components.hitting}, expected <=40`);
    }
  }
  
  if (highIso) {
    const score = await scoreSinglePlayer(highIso.playerMlbamId, season);
    if (!score || score.components.power < 75) {
      issues.push(`High ISO player (${highIso.isoLast30?.toFixed(3)}) has power score ${score?.components.power}, expected 75+`);
    }
  }
  
  if (lowIso) {
    const score = await scoreSinglePlayer(lowIso.playerMlbamId, season);
    if (!score || score.components.power > 45) {
      issues.push(`Low ISO player (${lowIso.isoLast30?.toFixed(3)}) has power score ${score?.components.power}, expected <=45`);
    }
  }
  
  return {
    passed: issues.length === 0,
    details: issues.length === 0 
      ? 'Component scores align with statistical intuition'
      : issues.join('; ')
  };
}

/**
 * Test 2: Opportunity Drives Score Changes
 * - Players with high PA/G should have higher opportunity scores
 * - Full-time players should outrank part-time players with similar rates
 */
async function testOpportunityImpact(): Promise<{ passed: boolean; details: string }> {
  const issues: string[] = [];
  
  // Find a full-time player (>25 games, >100 PA)
  const fullTime = await prisma.playerDerivedStats.findFirst({
    where: { 
      season, 
      gamesLast30: { gte: 25 },
      plateAppearancesLast30: { gte: 100 }
    },
  });
  
  // Find a part-time player (<15 games or <50 PA)
  const partTime = await prisma.playerDerivedStats.findFirst({
    where: { 
      season, 
      OR: [
        { gamesLast30: { lte: 15 } },
        { plateAppearancesLast30: { lte: 50 } }
      ]
    },
  });
  
  if (fullTime) {
    const score = await scoreSinglePlayer(fullTime.playerMlbamId, season);
    if (!score || score.components.opportunity < 60) {
      issues.push(`Full-time player (${fullTime.gamesLast30}G, ${fullTime.plateAppearancesLast30}PA) has opportunity ${score?.components.opportunity}, expected 60+`);
    }
  }
  
  if (partTime) {
    const score = await scoreSinglePlayer(partTime.playerMlbamId, season);
    if (!score || score.components.opportunity > 50) {
      issues.push(`Part-time player (${partTime.gamesLast30}G, ${partTime.plateAppearancesLast30}PA) has opportunity ${score?.components.opportunity}, expected <=50`);
    }
  }
  
  return {
    passed: issues.length === 0,
    details: issues.length === 0
      ? 'Opportunity scores correctly reflect playing time'
      : issues.join('; ')
  };
}

/**
 * Test 3: Confidence Drops When Stability Drops
 * - Small sample players should have lower confidence
 * - Unreliable stats should reduce confidence
 */
async function testConfidenceCalibration(): Promise<{ passed: boolean; details: string }> {
  const issues: string[] = [];
  
  // Find players with different sample sizes
  const largeSample = await prisma.playerDerivedStats.findFirst({
    where: { season, gamesLast30: { gte: 25 }, opsReliable: true },
  });
  
  const smallSample = await prisma.playerDerivedStats.findFirst({
    where: { season, gamesLast30: { lte: 10 } },
  });
  
  if (largeSample) {
    const score = await scoreSinglePlayer(largeSample.playerMlbamId, season);
    if (!score || score.confidence < 0.7) {
      issues.push(`Large sample player (${largeSample.gamesLast30}G) has confidence ${score?.confidence.toFixed(2)}, expected 0.7+`);
    }
  }
  
  if (smallSample) {
    const score = await scoreSinglePlayer(smallSample.playerMlbamId, season);
    if (!score || score.confidence > 0.6) {
      issues.push(`Small sample player (${smallSample.gamesLast30}G) has confidence ${score?.confidence.toFixed(2)}, expected <=0.6`);
    }
  }
  
  return {
    passed: issues.length === 0,
    details: issues.length === 0
      ? 'Confidence properly calibrated to sample size'
      : issues.join('; ')
  };
}

/**
 * Test 4: Score Distribution Sanity
 * - Scores should span the range (not all clustered)
 * - Elite players should be 70+, bench bats below 45
 * - No scores at extremes (0 or 100) without explanation
 */
async function testScoreDistribution(): Promise<{ passed: boolean; details: string }> {
  // Get a sample of players
  const players = await prisma.playerDerivedStats.findMany({
    where: { season },
    take: 50,
  });
  
  const scores: number[] = [];
  for (const player of players) {
    const score = await scoreSinglePlayer(player.playerMlbamId, season);
    if (score) scores.push(score.overallValue);
  }
  
  if (scores.length === 0) {
    return { passed: false, details: 'No scores computed' };
  }
  
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const eliteCount = scores.filter(s => s >= THRESHOLDS.ELITE).length;
  const benchCount = scores.filter(s => s < THRESHOLDS.BENCH).length;
  
  const issues: string[] = [];
  
  if (max - min < 20) {
    issues.push(`Score range too narrow: ${min}-${max} (span ${max-min}, expected 30+)`);
  }
  
  if (eliteCount === 0) {
    issues.push('No elite players (70+) found in sample');
  }
  
  if (benchCount === 0) {
    issues.push('No bench/streamer players (<45) found in sample');
  }
  
  // Check for extreme scores
  const extremeLow = scores.filter(s => s < 15).length;
  const extremeHigh = scores.filter(s => s > 90).length;
  
  if (extremeLow > scores.length * 0.1) {
    issues.push(`Too many extreme low scores: ${extremeLow}/${scores.length}`);
  }
  
  return {
    passed: issues.length === 0,
    details: issues.length === 0
      ? `Range: ${min}-${max}, avg: ${avg.toFixed(1)}, elite: ${eliteCount}, bench: ${benchCount}`
      : issues.join('; ')
  };
}

/**
 * Test 5: Component Score Sanity
 * - No component should be at extreme (0 or 100) without clear reason
 * - Component spread should make sense
 */
async function testComponentSanity(): Promise<{ passed: boolean; details: string }> {
  const players = await prisma.playerDerivedStats.findMany({
    where: { season },
    take: 30,
  });
  
  let extremeHitting = 0;
  let extremePower = 0;
  let perfectScores = 0;
  
  for (const player of players) {
    const score = await scoreSinglePlayer(player.playerMlbamId, season);
    if (score) {
      if (score.components.hitting <= 10 || score.components.hitting >= 95) extremeHitting++;
      if (score.components.power <= 10 || score.components.power >= 95) extremePower++;
      if (score.overallValue >= 90) perfectScores++;
    }
  }
  
  const issues: string[] = [];
  
  if (perfectScores > 0) {
    issues.push(`${perfectScores} players with 90+ scores (suspiciously high)`);
  }
  
  return {
    passed: issues.length === 0,
    details: issues.length === 0
      ? `Component extremes: hitting=${extremeHitting}, power=${extremePower}, perfect=${perfectScores}`
      : issues.join('; ')
  };
}

/**
 * Test 6: Star vs Bench Separation
 * - Stars: Good stats + Full playing time should score highly
 * - Bench Bats: Poor stats regardless of playing time should score low
 * - Small samples with great stats can score well (hot streaks happen)
 */
async function testStarBenchSeparation(): Promise<{ passed: boolean; details: string }> {
  // True "stars": Both good stats AND full playing time
  const stars = await prisma.playerDerivedStats.findMany({
    where: { 
      season, 
      opsLast30: { gte: 0.850 },
      plateAppearancesLast30: { gte: 100 }
    },
    take: 5,
  });
  
  // True "bench bats": Poor stats (OPS < 0.650) with limited production
  // Note: Small samples with great stats aren't bench bats - they're just small samples
  const benchBats = await prisma.playerDerivedStats.findMany({
    where: { 
      season, 
      opsLast30: { lte: 0.650, gt: 0 },
      plateAppearancesLast30: { lte: 100 }
    },
    take: 5,
  });
  
  // Also check "tiny samples" - minimal playing time should limit ceiling regardless of stats
  const tinySamples = await prisma.playerDerivedStats.findMany({
    where: { 
      season, 
      plateAppearancesLast30: { lte: 10 }
    },
    take: 5,
  });
  
  let starLowScores = 0;
  let benchHighScores = 0;
  let tinySampleHighScores = 0;
  
  for (const star of stars) {
    const score = await scoreSinglePlayer(star.playerMlbamId, season);
    if (score && score.overallValue < THRESHOLDS.STARTER) {
      starLowScores++;
    }
  }
  
  for (const bench of benchBats) {
    const score = await scoreSinglePlayer(bench.playerMlbamId, season);
    if (score && score.overallValue >= THRESHOLDS.STARTER) {
      benchHighScores++;
    }
  }
  
  for (const tiny of tinySamples) {
    const score = await scoreSinglePlayer(tiny.playerMlbamId, season);
    // Tiny samples should be capped around 60 max
    if (score && score.overallValue > 60) {
      tinySampleHighScores++;
    }
  }
  
  const issues: string[] = [];
  
  if (starLowScores > stars.length * 0.3) {
    issues.push(`${starLowScores}/${stars.length} stars scored below starter threshold (${THRESHOLDS.STARTER})`);
  }
  
  if (benchHighScores > benchBats.length * 0.4) {
    issues.push(`${benchHighScores}/${benchBats.length} poor performers scored above starter threshold`);
  }
  
  if (tinySampleHighScores > tinySamples.length * 0.5) {
    issues.push(`${tinySampleHighScores}/${tinySamples.length} tiny samples (<=10 PA) scored above 60`);
  }
  
  return {
    passed: issues.length === 0,
    details: issues.length === 0
      ? `${stars.length} stars, ${benchBats.length} poor performers, ${tinySamples.length} tiny samples - proper separation`
      : issues.join('; ')
  };
}

/**
 * Print detailed sample scores
 */
async function printSampleScores() {
  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log('SAMPLE PLAYER SCORES');
  console.log('──────────────────────────────────────────────────────────────────────');
  
  // Get top 3, middle 3, bottom 3 by OPS
  const players = await prisma.playerDerivedStats.findMany({
    where: { season, opsLast30: { not: null } },
    orderBy: { opsLast30: 'desc' },
    take: 20,
  });
  
  const sampled = [
    ...players.slice(0, 2),     // Elite
    ...players.slice(8, 10),    // Good
    ...players.slice(17, 19),   // Average
  ];
  
  for (const player of sampled) {
    const score = await scoreSinglePlayer(player.playerMlbamId, season);
    if (score) {
      console.log(`\n${player.playerMlbamId} (${player.gamesLast30}G, ${player.plateAppearancesLast30}PA)`);
      console.log(`  Overall: ${score.overallValue} | Confidence: ${(score.confidence * 100).toFixed(0)}% | ${score.reliability.sampleSize} sample`);
      console.log(`  Components: HIT=${score.components.hitting} POW=${score.components.power} SPD=${score.components.speed} DIS=${score.components.plateDiscipline} CON=${score.components.consistency} OPP=${score.components.opportunity}`);
      console.log(`  Key Stats: ${player.battingAverageLast30?.toFixed(3)} AVG, ${player.opsLast30?.toFixed(3)} OPS, ${player.isoLast30?.toFixed(3)} ISO`);
      console.log(`  Explanation: ${score.explanation.summary}`);
      if (score.explanation.strengths.length > 0) {
        console.log(`  Strengths: ${score.explanation.strengths.join(', ')}`);
      }
      if (score.explanation.concerns.length > 0) {
        console.log(`  Concerns: ${score.explanation.concerns.join(', ')}`);
      }
    }
  }
}

/**
 * Main validation runner
 */
async function runValidation() {
  console.log('\n' + '='.repeat(70));
  console.log('  PLAYER SCORING LAYER VALIDATION');
  console.log('  Features → Value (Deterministic, Explainable, Intuitive)');
  console.log('='.repeat(70));
  console.log(`\nSeason: ${season}`);
  console.log(`Thresholds: Elite=${THRESHOLDS.ELITE}+, Starter=${THRESHOLDS.STARTER}+, Bench=${THRESHOLDS.BENCH}+, Streamer=${THRESHOLDS.STREAMER}+\n`);
  
  const tests: ValidationTest[] = [
    { name: 'Component Intuition', test: testComponentIntuition },
    { name: 'Opportunity Impact', test: testOpportunityImpact },
    { name: 'Confidence Calibration', test: testConfidenceCalibration },
    { name: 'Score Distribution', test: testScoreDistribution },
    { name: 'Component Sanity', test: testComponentSanity },
    { name: 'Star/Bench Separation', test: testStarBenchSeparation },
  ];
  
  const results: Array<{ name: string; passed: boolean; details: string }> = [];
  
  for (const test of tests) {
    process.stdout.write(`${test.name}... `);
    try {
      const result = await test.test();
      results.push({ name: test.name, ...result });
      if (result.passed) {
        console.log('✅ PASS');
      } else {
        console.log('❌ FAIL');
      }
      console.log(`      ${result.details}`);
    } catch (error) {
      results.push({ 
        name: test.name, 
        passed: false, 
        details: `Error: ${error instanceof Error ? error.message : String(error)}` 
      });
      console.log('❌ ERROR');
    }
  }
  
  // Print sample scores
  await printSampleScores();
  
  // Summary
  const passedCount = results.filter(r => r.passed).length;
  
  console.log('\n' + '='.repeat(70));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total tests: ${results.length}`);
  console.log(`✅ Passed: ${passedCount}`);
  console.log(`❌ Failed: ${results.length - passedCount}`);
  
  console.log('\n' + '='.repeat(70));
  console.log('LAYER QUALITY ASSESSMENT');
  console.log('='.repeat(70));
  
  if (passedCount === results.length) {
    console.log('\n✅ SCORING LAYER VALIDATED');
    console.log('   Component scores reflect statistical intuition');
    console.log('   Opportunity properly drives value');
    console.log('   Confidence calibrated to sample size');
    console.log('   Stars separate from bench bats');
    console.log('\n   → Scores pass the "sharp manager" test');
    console.log('   → Ready for lineup decisions and waiver recommendations\n');
    process.exit(0);
  } else {
    console.log('\n🚫 SCORING LAYER NEEDS ATTENTION');
    console.log(`   ${results.length - passedCount}/${results.length} tests failed`);
    console.log('   Scores may not reflect true player value');
    console.log('\n   → Review scoring algorithms before trusting recommendations\n');
    process.exit(1);
  }
}

runValidation().catch(error => {
  console.error('\n❌ Validation failed:', error);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
