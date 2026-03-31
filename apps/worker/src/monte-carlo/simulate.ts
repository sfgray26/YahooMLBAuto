/**
 * Monte Carlo Simulation Layer - Phase 1
 *
 * Pure function: simulates player outcomes using distribution assumptions.
 * No decisions, no side effects, no Yahoo knowledge.
 *
 * Pipeline position:
 *   Derived Features -> Player Scoring -> [Monte Carlo] -> Decision Assembly
 *
 * Inputs: PlayerDerivedStats, PlayerScore
 * Outputs: Distribution metrics (EV, variance, percentiles)
 * Purpose: Augment confidence, explain risk, distinguish ceiling vs floor
 */

import type { PlayerScore } from '../scoring/compute.js';

// Inline type for derived stats (avoiding Prisma client import issues)
interface PlayerDerivedStats {
  playerId: string;
  playerMlbamId: string;
  season: number;
  volume: {
    plateAppearancesLast7?: number;
    plateAppearancesLast14?: number;
    plateAppearancesLast30?: number;
    gamesLast7?: number;
    gamesLast14?: number;
    gamesLast30?: number;
  };
  rates: {
    opsLast30?: number;
    onBasePctLast30?: number;
    isoLast30?: number;
    battingAverageLast30?: number;
    walkRateLast30?: number;
    strikeoutRateLast30?: number;
  };
  volatility: {
    productionVolatility?: number;
    hitConsistencyScore?: number;
  };
}

export interface SimulationConfig {
  runs: number;
  horizon: 'daily' | 'weekly';
  randomSeed?: number;
}

export interface PlayerOutcomeDistribution {
  playerId: string;
  playerMlbamId: string;
  horizon: 'daily' | 'weekly';
  runs: number;

  // Central tendencies
  expectedValue: number;
  median: number;
  mode: number;

  // Spread
  variance: number;
  standardDeviation: number;

  // Percentiles
  p10: number; // Floor (10th percentile)
  p25: number; // Lower quartile
  p50: number; // Median
  p75: number; // Upper quartile
  p90: number; // Ceiling (90th percentile)

  // Risk metrics
  downsideRisk: number; // Probability of negative outcome
  upsidePotential: number; // Probability of top-quartile outcome
  riskAdjustedValue: number; // EV - risk penalty

  // Context
  vsReplacementDelta: number; // Risk-adjusted vs league average replacement
  confidenceImpact: 'increase' | 'decrease' | 'neutral';
  confidenceDelta: number; // How much to adjust base confidence

  // Explainability
  simulationNotes: string[];
}

// Seeded random number generator for reproducibility (Mulberry32)
function createRNG(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate a single daily outcome using Poisson for counting stats,
 * Beta distribution for rate-based contributions.
 *
 * Returns fantasy points (0-100 scale, consistent with PlayerScore)
 */
function simulateDailyOutcome(
  derived: PlayerDerivedStats,
  score: PlayerScore,
  rng: () => number
): number {
  // Extract key rates from derived features
  const rates = derived.rates as Record<string, number>;
  const volume = derived.volume as Record<string, number>;
  const ops = rates.opsLast30 ?? 0.700;
  const plateAppearances = volume.plateAppearancesLast7 ?? 4;

  // Base fantasy contribution scaled to roughly match PlayerScore (0-100)
  // OPS ~ 1.000 = elite (~25 pts/day), ~ 0.700 = replacement (~15 pts/day)
  const opsComponent = (ops - 0.500) * 25; // 0.500 OPS = 0 pts, 1.000 OPS = 12.5 pts
  const paComponent = plateAppearances * 0.5; // 4 PA = 2 pts, 6 PA = 3 pts
  const baseContribution = opsComponent + paComponent;

  // Poisson simulation for counting stats variance (hits, runs, etc.)
  // Lambda derived from expected hits+walks based on OBP
  const obp = rates.onBasePctLast30 ?? 0.320;
  const lambda = Math.max(0.5, plateAppearances * obp * 0.5); // Expected times on base
  let poissonOutcome = 0;
  let p = 1.0;
  const L = Math.exp(-lambda);
  while (p > L) {
    poissonOutcome++;
    p *= rng();
  }
  poissonOutcome--; // Adjust for algorithm

  // Binomial for HR probability (power component)
  const iso = rates.isoLast30 ?? 0.150;
  const hrRate = Math.min(0.08, iso * 0.15); // ISO ~0.200 = 3% HR rate per PA
  let hrs = 0;
  for (let i = 0; i < plateAppearances; i++) {
    if (rng() < hrRate) hrs++;
  }

  // Combine components with volatility
  const volatility = (derived.volatility as { productionVolatility?: number })?.productionVolatility ?? 1.0;
  const varianceFactor = 1.0 + (rng() - 0.5) * 0.4 * volatility; // ±20% variance scaled by volatility

  const outcome = (baseContribution * varianceFactor) +
                  (poissonOutcome * 1.5) +  // Getting on base
                  (hrs * 4);                 // Home runs

  // Normalize to 0-100 scale (consistent with PlayerScore)
  // Daily scores typically range 0-40 for hitters
  const normalized = outcome * 2.5; // Scale up to 0-100 range
  return Math.max(0, Math.min(100, normalized));
}

/**
 * Simulate weekly outcome by aggregating 7 daily simulations
 */
function simulateWeeklyOutcome(
  derived: PlayerDerivedStats,
  score: PlayerScore,
  rng: () => number
): number {
  // Simulate 7 days, but account for rest days (~20% chance no game)
  let total = 0;
  let gamesPlayed = 0;

  for (let day = 0; day < 7; day++) {
    // 80% chance of playing (accounting for rest/off days)
    if (rng() < 0.8) {
      const daily = simulateDailyOutcome(derived, score, rng);
      total += daily;
      gamesPlayed++;
    }
  }

  // If no games simulated (rare), use expected value
  if (gamesPlayed === 0) {
    return simulateDailyOutcome(derived, score, rng) * 5; // Assume 5 games
  }

  return total;
}

/**
 * Core Monte Carlo simulation function.
 *
 * Pure function - no side effects, deterministic with seed.
 * Returns distribution metrics for a single player over specified horizon.
 */
export function simulatePlayerOutcome(
  derived: PlayerDerivedStats,
  score: PlayerScore,
  config: SimulationConfig = { runs: 10_000, horizon: 'daily' }
): PlayerOutcomeDistribution {
  const rng = createRNG(config.randomSeed ?? 12345);
  const outcomes: number[] = [];

  // Run simulations
  for (let i = 0; i < config.runs; i++) {
    const outcome = config.horizon === 'daily'
      ? simulateDailyOutcome(derived, score, rng)
      : simulateWeeklyOutcome(derived, score, rng);
    outcomes.push(outcome);
  }

  // Sort for percentile calculations
  outcomes.sort((a, b) => a - b);

  // Calculate statistics
  const sum = outcomes.reduce((a, b) => a + b, 0);
  const expectedValue = sum / outcomes.length;

  const variance = outcomes.reduce((acc, val) => acc + Math.pow(val - expectedValue, 2), 0) / outcomes.length;
  const standardDeviation = Math.sqrt(variance);

  const p10 = outcomes[Math.floor(outcomes.length * 0.10)];
  const p25 = outcomes[Math.floor(outcomes.length * 0.25)];
  const p50 = outcomes[Math.floor(outcomes.length * 0.50)];
  const p75 = outcomes[Math.floor(outcomes.length * 0.75)];
  const p90 = outcomes[Math.floor(outcomes.length * 0.90)];

  const median = p50;

  // Mode: find most common value (bucketed)
  const buckets = new Map<number, number>();
  for (const o of outcomes) {
    const bucket = Math.floor(o / 5) * 5; // 5-point buckets
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let mode = expectedValue;
  let maxCount = 0;
  for (const [bucket, count] of buckets) {
    if (count > maxCount) {
      maxCount = count;
      mode = bucket;
    }
  }

  // Risk metrics
  const downsideRisk = outcomes.filter(o => o < p25).length / outcomes.length;
  const upsidePotential = outcomes.filter(o => o > p75).length / outcomes.length;

  // Risk-adjusted value: penalize high variance
  const riskPenalty = variance * 0.001; // Small penalty for volatility
  const riskAdjustedValue = expectedValue - riskPenalty;

  // vs Replacement (approximate replacement level as 40 for daily, 200 for weekly)
  const replacementLevel = config.horizon === 'daily' ? 40 : 200;
  const vsReplacementDelta = riskAdjustedValue - replacementLevel;

  // Confidence impact: high variance with low ceiling = decrease confidence
  // Low variance with high floor = increase confidence
  const ceilingFloorSpread = p90 - p10;
  const floorQuality = p10 / Math.max(1, expectedValue);
  const ceilingQuality = p90 / Math.max(1, expectedValue);

  let confidenceImpact: 'increase' | 'decrease' | 'neutral' = 'neutral';
  let confidenceDelta = 0;

  if (ceilingFloorSpread > standardDeviation * 2.5 && floorQuality < 0.5) {
    // High variance, low floor = risky
    confidenceImpact = 'decrease';
    confidenceDelta = -0.1;
  } else if (floorQuality > 0.7 && ceilingQuality > 1.1) {
    // High floor, good ceiling = reliable with upside
    confidenceImpact = 'increase';
    confidenceDelta = 0.05;
  }

  // Build notes for explainability
  const notes: string[] = [];
  notes.push(`Simulated ${config.runs.toLocaleString()} ${config.horizon} outcomes`);
  notes.push(`Expected value: ${expectedValue.toFixed(1)}, StdDev: ${standardDeviation.toFixed(1)}`);
  notes.push(`Floor (p10): ${p10.toFixed(1)}, Ceiling (p90): ${p90.toFixed(1)}`);
  notes.push(`Spread ${ceilingFloorSpread.toFixed(1)} indicates ${ceilingFloorSpread > 30 ? 'high' : 'moderate'} volatility`);

  if (confidenceImpact !== 'neutral') {
    notes.push(`Confidence ${confidenceImpact === 'increase' ? 'boosted' : 'reduced'} due to ${confidenceImpact === 'increase' ? 'reliable floor' : 'high downside risk'}`);
  }

  return {
    playerId: derived.playerId,
    playerMlbamId: derived.playerMlbamId,
    horizon: config.horizon,
    runs: config.runs,
    expectedValue,
    median,
    mode,
    variance,
    standardDeviation,
    p10,
    p25,
    p50,
    p75,
    p90,
    downsideRisk,
    upsidePotential,
    riskAdjustedValue,
    vsReplacementDelta,
    confidenceImpact,
    confidenceDelta,
    simulationNotes: notes,
  };
}

/**
 * Batch simulation for multiple players.
 * Useful for comparing distributions across a roster.
 */
export function simulatePlayerOutcomes(
  inputs: Array<{ derived: PlayerDerivedStats; score: PlayerScore }>,
  config: Omit<SimulationConfig, 'randomSeed'> & { randomSeed?: number }
): Map<string, PlayerOutcomeDistribution> {
  const results = new Map<string, PlayerOutcomeDistribution>();
  let seed = config.randomSeed ?? 12345;

  for (const { derived, score } of inputs) {
    const result = simulatePlayerOutcome(derived, score, {
      ...config,
      randomSeed: seed++,
    });
    results.set(derived.playerMlbamId, result);
  }

  return results;
}

/**
 * Compare two players using Monte Carlo.
 * Returns probability that playerA outperforms playerB.
 */
export function comparePlayers(
  derivedA: PlayerDerivedStats,
  scoreA: PlayerScore,
  derivedB: PlayerDerivedStats,
  scoreB: PlayerScore,
  config: Omit<SimulationConfig, 'randomSeed'> = { runs: 10_000, horizon: 'daily' }
): {
  probAOutperformsB: number;
  probBOutperformsA: number;
  probTie: number;
  expectedDelta: number;
  notes: string[];
} {
  const distA = simulatePlayerOutcome(derivedA, scoreA, { ...config, randomSeed: 11111 });
  const distB = simulatePlayerOutcome(derivedB, scoreB, { ...config, randomSeed: 22222 });

  // Simple comparison using EV and variance
  const evDelta = distA.expectedValue - distB.expectedValue;
  const combinedVariance = distA.variance + distB.variance;

  // Probability A > B (assuming normal approximation)
  const zScore = evDelta / Math.sqrt(combinedVariance + 0.001); // Avoid div by zero
  const probAOutperformsB = 1 / (1 + Math.exp(-zScore * 1.702)); // Logistic approximation

  const notes: string[] = [];
  notes.push(`${distA.playerMlbamId} EV: ${distA.expectedValue.toFixed(1)} vs ${distB.expectedValue.toFixed(1)}`);
  notes.push(`A outperforms B with ${(probAOutperformsB * 100).toFixed(1)}% probability`);

  if (distA.variance > distB.variance * 1.5) {
    notes.push('Player A has significantly higher volatility');
  }

  return {
    probAOutperformsB,
    probBOutperformsA: 1 - probAOutperformsB,
    probTie: 0, // Continuous distribution
    expectedDelta: evDelta,
    notes,
  };
}