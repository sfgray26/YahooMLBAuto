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

function hashToSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) || 1;
}

function resolveSimulationSeed(
  derived: PlayerDerivedStats,
  score: PlayerScore,
  config: SimulationConfig
): number {
  if (typeof config.randomSeed === 'number') {
    return config.randomSeed;
  }

  return hashToSeed([
    derived.playerMlbamId,
    derived.playerId,
    config.horizon,
    config.runs,
    score.overallValue,
    score.confidence,
  ].join('|'));
}

function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) {
    return 0;
  }

  if (sortedArray.length === 1) {
    return sortedArray[0];
  }

  const boundedP = Math.max(0, Math.min(1, p));
  const index = boundedP * (sortedArray.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedArray[lowerIndex];
  const upperValue = sortedArray[upperIndex];

  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  const weight = index - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * weight;
}

function randomNormal(rng: () => number, mean: number, stdDev: number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const rates = derived.rates as Record<string, number>;
  const volume = derived.volume as Record<string, number>;
  const ops = rates.opsLast30 ?? 0.720;
  const obp = rates.onBasePctLast30 ?? 0.320;
  const iso = rates.isoLast30 ?? 0.150;
  const strikeoutRate = rates.strikeoutRateLast30 ?? 0.220;
  const gamesLast7 = Math.max(1, volume.gamesLast7 ?? 5);
  const plateAppearances = volume.plateAppearancesLast7 ?? volume.plateAppearancesLast30 ?? 28;
  const paPerGame = plateAppearances / gamesLast7;

  const opportunityFactor = clamp(paPerGame / 4.2, 0.75, 1.15);
  const opportunityAdjustment = (opportunityFactor - 1) * 15;
  const skillAdjustment =
    ((ops - 0.720) / 0.180) * 3 +
    ((iso - 0.160) / 0.080) * 2 +
    ((obp - 0.320) / 0.060) * 1.5;

  const baseline = clamp(score.overallValue + opportunityAdjustment + skillAdjustment, 0, 100);

  const volatility = (derived.volatility as { productionVolatility?: number })?.productionVolatility ?? 1.0;
  const consistency = (derived.volatility as { hitConsistencyScore?: number })?.hitConsistencyScore ?? 50;
  const downsidePenalty = Math.max(0, strikeoutRate - 0.24) * 15;
  const standardDeviation = Math.max(
    4,
    5 + volatility * 6 + Math.max(0, 60 - consistency) / 8 + downsidePenalty
  );

  let outcome = baseline + randomNormal(rng, 0, standardDeviation);

  const ceilingEventProbability = clamp(Math.max(0, iso - 0.14) * 1.5 + Math.max(0, volatility - 1) * 0.15, 0, 0.18);
  if (rng() < ceilingEventProbability) {
    outcome += 8 + rng() * 8;
  }

  const downsideEventProbability = clamp(Math.max(0, 0.30 - obp) * 1.2 + Math.max(0, 55 - consistency) / 200, 0, 0.2);
  if (rng() < downsideEventProbability) {
    outcome -= 8 + rng() * 10;
  }

  return clamp(outcome, 0, 100);
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
  const resolvedSeed = resolveSimulationSeed(derived, score, config);
  const rng = createRNG(resolvedSeed);
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

  const p10 = percentile(outcomes, 0.10);
  const p25 = percentile(outcomes, 0.25);
  const p50 = percentile(outcomes, 0.50);
  const p75 = percentile(outcomes, 0.75);
  const p90 = percentile(outcomes, 0.90);

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

  if (standardDeviation >= 12 || ceilingFloorSpread >= 30 || floorQuality < 0.55) {
    // High variance or weak floor = risky
    confidenceImpact = 'decrease';
    confidenceDelta = -0.1;
  } else if (standardDeviation <= 9 && floorQuality > 0.72 && ceilingQuality > 1.05) {
    // High floor, good ceiling = reliable with upside
    confidenceImpact = 'increase';
    confidenceDelta = 0.05;
  }

  // Build notes for explainability
  const notes: string[] = [];
  notes.push(`Simulated ${config.runs.toLocaleString()} ${config.horizon} outcomes`);
  notes.push(`Seed: ${resolvedSeed}`);
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

  for (const [index, { derived, score }] of inputs.entries()) {
    const result = simulatePlayerOutcome(derived, score, {
      ...config,
      randomSeed: typeof config.randomSeed === 'number'
        ? hashToSeed(`${config.randomSeed}|${derived.playerMlbamId}|${index}`)
        : undefined,
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
