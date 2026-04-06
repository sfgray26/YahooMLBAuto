/**
 * Momentum + Monte Carlo Demonstration
 * 
 * Shows how the two new intelligence layers work together:
 * 1. Momentum detection (Z-score slope)
 * 2. Probabilistic outcomes (Monte Carlo)
 */

import { calculateMomentum, formatMomentum, type MomentumMetrics } from '../apps/worker/src/momentum';
import { simulatePlayerOutcomes, formatProbabilities, type ProbabilisticOutcome } from '../apps/worker/src/probabilistic';
import type { PlayerScore } from '../apps/worker/src/scoring/compute';

// Helper to create a PlayerScore for testing
function createTestScore(
  overallValue: number,
  hitting: number,
  power: number,
  confidence: number,
  games14d: number,
  games30d: number
): PlayerScore & { games14d: number; games30d: number } {
  return {
    playerId: 'test',
    playerMlbamId: 'TEST001',
    season: 2025,
    scoredAt: new Date(),
    overallValue,
    components: {
      hitting,
      power,
      speed: 55,
      plateDiscipline: 60,
      consistency: 65,
      opportunity: 70,
    },
    confidence,
    reliability: {
      sampleSize: confidence > 0.8 ? 'large' : confidence > 0.6 ? 'adequate' : 'small',
      gamesToReliable: 0,
      statsReliable: confidence > 0.7,
    },
    explanation: {
      summary: 'Test player',
      strengths: [],
      concerns: [],
      keyStats: {},
    },
    inputs: {
      derivedFeaturesVersion: 'v1',
      computedAt: new Date(),
    },
    games14d,
    games30d,
  } as any;
}

// Test scenarios
const scenarios = [
  {
    name: '🔥 Breakout Candidate',
    description: 'Mediocre 30d, surging 14d',
    score: createTestScore(68, 75, 70, 0.75, 12, 25),
    z14: 1.2,   // Hot recently
    z30: 0.2,   // But was mediocre
  },
  {
    name: '📉 Collapse Warning',
    description: 'Elite 30d, struggling 14d',
    score: createTestScore(62, 55, 50, 0.85, 10, 28),
    z14: 0.1,   // Cold recently
    z30: 1.5,   // But was elite
  },
  {
    name: '➡️ Stable Star',
    description: 'Consistently elite',
    score: createTestScore(82, 88, 85, 0.92, 14, 26),
    z14: 3.2,   // Elite
    z30: 3.0,   // Always elite
  },
  {
    name: '❄️ Cold But Reliable',
    description: 'Slumping but large sample',
    score: createTestScore(48, 45, 42, 0.88, 13, 27),
    z14: -0.5,  // Cold
    z30: 0.0,   // Was average
  },
  {
    name: '🎲 High Variance',
    description: 'Small sample, uncertain',
    score: createTestScore(72, 78, 75, 0.45, 6, 12),
    z14: 2.2,   // Hot in small sample
    z30: 1.5,   // But only 12 games
  },
];

function runDemo() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  MOMENTUM + MONTE CARLO INTELLIGENCE LAYER DEMO                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  for (const scenario of scenarios) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${scenario.name}`);
    console.log(`  ${scenario.description}`);
    console.log(`  Current Score: ${scenario.score.overallValue}/100 (conf: ${scenario.score.confidence})`);
    console.log('─'.repeat(70));

    // 1. Momentum Analysis
    console.log('\n📈 MOMENTUM ANALYSIS');
    const momentum = calculateMomentum(
      scenario.z14,
      scenario.z30,
      scenario.score.games14d,
      scenario.score.games30d
    );
    
    console.log(`  Z-Score 14d: ${scenario.z14.toFixed(2)}`);
    console.log(`  Z-Score 30d: ${scenario.z30.toFixed(2)}`);
    console.log(`  ΔZ (slope):  ${momentum.zScoreSlope > 0 ? '+' : ''}${momentum.zScoreSlope.toFixed(2)}`);
    console.log(`  Trend:       ${formatMomentum(momentum)}`);
    
    if (momentum.breakoutSignal) {
      console.log('  🚨 BREAKOUT DETECTED: Recent surge from low baseline');
    }
    if (momentum.collapseWarning) {
      console.log('  ⚠️ COLLAPSE WARNING: Drop from previously high performance');
    }

    // 2. Monte Carlo Simulation
    console.log('\n🎲 MONTE CARLO SIMULATION (1000 runs)');
    const outcome = simulatePlayerOutcomes(scenario.score, {
      simulations: 1000,
      weeksRemaining: 12,
      gamesPerWeek: 6,
    });
    
    console.log(`  ROS Projection: ${Math.round(outcome.rosScore.p50)}/100 (median)`);
    console.log(`  Range: ${Math.round(outcome.rosScore.p10)} - ${Math.round(outcome.rosScore.p90)}/100`);
    console.log(`  Volatility: ${outcome.riskProfile.volatility}`);
    
    console.log('\n  📊 Probability Tiers:');
    console.log(`    Top 10:  ${(outcome.probTop10 * 100).toFixed(1)}%`);
    console.log(`    Top 25:  ${(outcome.probTop25 * 100).toFixed(1)}%`);
    console.log(`    Top 50:  ${(outcome.probTop50 * 100).toFixed(1)}%`);
    console.log(`    Waiver:  ${(outcome.probReplacement * 100).toFixed(1)}%`);
    
    // 3. Combined Recommendation
    console.log('\n🎯 COMBINED INTELLIGENCE');
    console.log(`  Momentum says: ${momentum.recommendation.toUpperCase()}`);
    console.log(`  Monte Carlo says: ${outcome.probTop50 > 0.5 ? 'LIKELY TOP-50' : 'UNCERTAIN'}`);
    
    const combinedRec = combineRecommendations(momentum, outcome);
    console.log(`  🏆 FINAL: ${combinedRec}`);
  }

  // Comparison example
  console.log('\n\n' + '='.repeat(70));
  console.log('HEAD-TO-HEAD COMPARISON');
  console.log('='.repeat(70));
  
  const playerA = {
    name: 'Breakout Candidate',
    outcome: simulatePlayerOutcomes(scenarios[0].score, { simulations: 500 }),
  };
  const playerB = {
    name: 'Stable Star',
    outcome: simulatePlayerOutcomes(scenarios[2].score, { simulations: 500 }),
  };
  
  console.log(`\nBreakout:  ${Math.round(playerA.outcome.rosScore.p50)}/100 median, ${(playerA.outcome.probTop25 * 100).toFixed(0)}% top-25`);
  console.log(`Stable Star: ${Math.round(playerB.outcome.rosScore.p50)}/100 median, ${(playerB.outcome.probTop25 * 100).toFixed(0)}% top-25`);
  
  const diff = playerB.outcome.rosScore.p50 - playerA.outcome.rosScore.p50;
  console.log(`\nStable Star favored by ${diff.toFixed(1)} points`);
  console.log('But Breakout has momentum - monitor for continued surge');

  console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    ARCHITECTURE COMPLETE                       ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  ✅ Time-Decayed Stats (λ=0.95)                               ║');
  console.log('║  ✅ Position-Adjusted Z-Scores (70/30 blend)                  ║');
  console.log('║  ✅ Confidence Regression (sample-size aware)                 ║');
  console.log('║  ✅ Momentum Detection (Z-slope ΔZ)                           ║');
  console.log('║  ✅ Monte Carlo Simulation (1000 runs)                        ║');
  console.log('║  ✅ Probabilistic Outcomes (percentiles + risk)               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
}

function combineRecommendations(
  momentum: MomentumMetrics,
  outcome: ProbabilisticOutcome
): string {
  // High upside + momentum = aggressive add
  if (outcome.probTop25 > 0.3 && momentum.trend === 'surging') {
    return 'AGGRESSIVE ADD - High upside with momentum';
  }
  
  // High floor + stable = safe hold
  if (outcome.probReplacement < 0.1 && momentum.trend === 'stable') {
    return 'SAFE HOLD - Reliable producer';
  }
  
  // Collapse warning + high waiver risk = sell
  if (momentum.collapseWarning && outcome.probReplacement > 0.2) {
    return 'SELL NOW - Collapse likely';
  }
  
  // Breakout + high uncertainty = speculative add
  if (momentum.breakoutSignal && outcome.riskProfile.volatility === 'high') {
    return 'SPECULATIVE ADD - High reward, high risk';
  }
  
  // Cold + low upside = avoid
  if (momentum.trend === 'cold' && outcome.probTop50 < 0.3) {
    return 'AVOID - No upside, cold trend';
  }
  
  return 'HOLD - Monitor situation';
}

runDemo();
