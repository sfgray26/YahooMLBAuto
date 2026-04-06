/**
 * Probabilistic Outcomes Layer (Monte Carlo)
 *
 * Simulates rest-of-season outcomes to produce:
 * - Percentile projections (10th, 25th, 50th, 75th, 90th)
 * - Risk profiles
 * - Probability of top-X value
 * - Confidence intervals
 *
 * Built on top of the stable Z-score foundation.
 */

import type { PlayerScore } from '../scoring/compute.js';
import type { PitcherScore } from '../pitchers/compute.js';

// ============================================================================
// Types
// ============================================================================

export interface SimulationConfig {
  simulations: number;           // Number of Monte Carlo runs (default: 1000)
  weeksRemaining: number;        // Weeks left in season
  gamesPerWeek: number;          // Expected games per week
  confidenceLevel: number;       // For confidence intervals (default: 0.9)
  regressionToMean: boolean;     // Apply regression toward league average
  regressionStrength: number;    // How strong (0-1, default: 0.3)
  randomSeed?: number;           // Optional explicit seed for reproducibility
}

export interface PercentileOutcomes {
  p10: number;                   // 10th percentile (floor)
  p25: number;                   // 25th percentile
  p50: number;                   // 50th percentile (median)
  p75: number;                   // 75th percentile
  p90: number;                   // 90th percentile (ceiling)
  mean: number;
  stdDev: number;
}

export interface RiskProfile {
  volatility: 'low' | 'medium' | 'high' | 'extreme';
  downsideRisk: number;          // Probability of sub-replacement value
  upsidePotential: number;       // Probability of top-50 value
  consistencyRating: number;     // 0-100, higher = more predictable
}

export interface ProbabilisticOutcome {
  // Core projections
  rosScore: PercentileOutcomes;  // Rest-of-season score distribution
  
  // Probability thresholds
  probTop10: number;             // % chance of top-10 player
  probTop25: number;             // % chance of top-25 player
  probTop50: number;             // % chance of top-50 player
  probTop100: number;            // % chance of top-100 player
  probReplacement: number;       // % chance of waiver-wire value
  
  // Risk analysis
  riskProfile: RiskProfile;
  
  // Value at Risk (VaR) - fantasy equivalent
  valueAtRisk: {
    worstCase: number;           // 5th percentile outcome
    expectedCase: number;        // 50th percentile
    bestCase: number;            // 95th percentile
  };
  
  // Confidence interval
  confidenceInterval: [number, number]; // e.g., [45, 75] for 90% CI
  
  // Simulation metadata
  simulationCount: number;
  convergenceScore: number;      // How stable the simulation is (0-1)
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: SimulationConfig = {
  simulations: 1000,
  weeksRemaining: 12,
  gamesPerWeek: 6,
  confidenceLevel: 0.9,
  regressionToMean: true,
  regressionStrength: 0.3,
};

// League distributions (for benchmarking)
const LEAGUE_DISTRIBUTION = {
  mean: 50,
  stdDev: 15,
  top10Threshold: 80,
  top25Threshold: 72,
  top50Threshold: 65,
  top100Threshold: 58,
  replacementThreshold: 45,
};

function hashToSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) || 1;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveSimulationSeed(
  currentScore: PlayerScore | PitcherScore,
  cfg: SimulationConfig
): number {
  if (typeof cfg.randomSeed === 'number') {
    return cfg.randomSeed;
  }

  return hashToSeed([
    'playerId' in currentScore ? currentScore.playerId : '',
    'playerMlbamId' in currentScore ? currentScore.playerMlbamId : '',
    currentScore.overallValue,
    currentScore.confidence,
    cfg.simulations,
    cfg.weeksRemaining,
    cfg.gamesPerWeek,
    cfg.confidenceLevel,
    cfg.regressionToMean,
    cfg.regressionStrength,
  ].join('|'));
}

function randomNormal(rng: () => number, mean: number, stdDev: number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

// ============================================================================
// Monte Carlo Simulation
// ============================================================================

/**
 * Run Monte Carlo simulation for a player
 * 
 * Model assumptions:
 * 1. Current Z-score is the starting point
 * 2. Performance regresses toward mean over time (regressionToMean)
 * 3. Weekly variance based on sample size and volatility
 * 4. Injury risk factored into games played
 */
export function simulatePlayerOutcomes(
  currentScore: PlayerScore | PitcherScore,
  config: Partial<SimulationConfig> = {}
): ProbabilisticOutcome {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const resolvedSeed = resolveSimulationSeed(currentScore, cfg);
  const rng = createRng(resolvedSeed);
  
  // Extract current performance level (Z-score)
  const currentZ = Math.max(-3, Math.min(3, (currentScore.overallValue - 50) / 10));
  const confidence = currentScore.confidence;
  
  // Calculate true talent estimate (regressed toward mean)
  const trueTalentZ = cfg.regressionToMean
    ? currentZ * (1 - cfg.regressionStrength)  // Regress toward 0 (mean)
    : currentZ;
  
  // Calculate weekly volatility
  // Higher confidence = lower variance
  // Sample sizes:
  // - Large (conf > 0.8): stdDev = 0.3 per week
  // - Medium (conf 0.6-0.8): stdDev = 0.5 per week
  // - Small (conf < 0.6): stdDev = 0.8 per week
  let weeklyStdDev: number;
  if (confidence > 0.8) weeklyStdDev = 0.3;
  else if (confidence > 0.6) weeklyStdDev = 0.5;
  else weeklyStdDev = 0.8;
  
  // Run simulations
  const outcomes: number[] = [];
  
  for (let sim = 0; sim < cfg.simulations; sim++) {
    let cumulativeZ = 0;
    let totalGames = 0;
    
    // Simulate each week
    for (let week = 0; week < cfg.weeksRemaining; week++) {
      // Injury risk: 5% chance of missing week entirely
      if (rng() < 0.05) continue;
      
      // Games this week (with variance)
      const games = Math.max(0, cfg.gamesPerWeek + randomNormal(rng, 0, 1));
      
      // Weekly performance (random walk around true talent)
      const weeklyZ = trueTalentZ + randomNormal(rng, 0, weeklyStdDev);
      
      // Accumulate
      cumulativeZ += weeklyZ * games;
      totalGames += games;
    }
    
    // Average Z-score over remaining season
    const avgZ = totalGames > 0 ? cumulativeZ / totalGames : 0;
    
    // Convert to 0-100 scale
    const finalScore = Math.max(0, Math.min(100, 50 + avgZ * 10));
    
    outcomes.push(finalScore);
  }
  
  // Sort for percentile calculations
  outcomes.sort((a, b) => a - b);
  
  // Calculate percentiles
  const percentiles = calculatePercentiles(outcomes);
  
  // Calculate probability thresholds
  const probTop10 = outcomes.filter(s => s >= LEAGUE_DISTRIBUTION.top10Threshold).length / outcomes.length;
  const probTop25 = outcomes.filter(s => s >= LEAGUE_DISTRIBUTION.top25Threshold).length / outcomes.length;
  const probTop50 = outcomes.filter(s => s >= LEAGUE_DISTRIBUTION.top50Threshold).length / outcomes.length;
  const probTop100 = outcomes.filter(s => s >= LEAGUE_DISTRIBUTION.top100Threshold).length / outcomes.length;
  const probReplacement = outcomes.filter(s => s <= LEAGUE_DISTRIBUTION.replacementThreshold).length / outcomes.length;
  
  // Risk profile
  const riskProfile = calculateRiskProfile(outcomes, currentScore.confidence);
  
  // Value at Risk
  const valueAtRisk = {
    worstCase: percentile(outcomes, 0.05),
    expectedCase: percentile(outcomes, 0.50),
    bestCase: percentile(outcomes, 0.95),
  };
  
  // Confidence interval
  const alpha = (1 - cfg.confidenceLevel) / 2;
  const confidenceInterval: [number, number] = [
    percentile(outcomes, alpha),
    percentile(outcomes, 1 - alpha),
  ];
  
  const convergenceScore = calculateConvergenceScore(percentiles.stdDev, confidenceInterval, cfg.simulations);
  
  return {
    rosScore: percentiles,
    probTop10,
    probTop25,
    probTop50,
    probTop100,
    probReplacement,
    riskProfile,
    valueAtRisk,
    confidenceInterval,
    simulationCount: cfg.simulations,
    convergenceScore,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get percentile from sorted array
 */
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

/**
 * Calculate all percentiles
 */
function calculatePercentiles(outcomes: number[]): PercentileOutcomes {
  const mean = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
  const variance = outcomes.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / outcomes.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    p10: percentile(outcomes, 0.10),
    p25: percentile(outcomes, 0.25),
    p50: percentile(outcomes, 0.50),
    p75: percentile(outcomes, 0.75),
    p90: percentile(outcomes, 0.90),
    mean,
    stdDev,
  };
}

/**
 * Calculate risk profile
 */
function calculateRiskProfile(
  outcomes: number[],
  confidence: number
): RiskProfile {
  const stdDev = calculatePercentiles(outcomes).stdDev;
  
  // Volatility classification
  let volatility: RiskProfile['volatility'];
  if (stdDev > 20) volatility = 'extreme';
  else if (stdDev > 12) volatility = 'high';
  else if (stdDev > 6) volatility = 'medium';
  else volatility = 'low';
  
  // Downside risk: probability of replacement-level or worse
  const downsideRisk = outcomes.filter(s => s <= 45).length / outcomes.length;
  
  // Upside potential: probability of top-50
  const upsidePotential = outcomes.filter(s => s >= 65).length / outcomes.length;
  
  // Consistency: inverse of CV, scaled to 0-100
  const mean = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
  const cv = mean > 0 ? stdDev / mean : 0;
  const consistencyRating = Math.max(0, Math.min(100, 100 - cv * 100));
  
  return {
    volatility,
    downsideRisk,
    upsidePotential,
    consistencyRating,
  };
}

/**
 * Estimate convergence using CI width and simulation count.
 */
function calculateConvergenceScore(
  stdDev: number,
  confidenceInterval: [number, number],
  simulations: number
): number {
  const ciWidth = Math.max(0, confidenceInterval[1] - confidenceInterval[0]);
  const widthPenalty = Math.min(1, ciWidth / 35);
  const variancePenalty = Math.min(1, stdDev / 20);
  const runBonus = Math.min(1, Math.sqrt(simulations / 1000));

  return Math.max(0, Math.min(1, runBonus * (1 - ((widthPenalty * 0.7) + (variancePenalty * 0.3)))));
}

// ============================================================================
// Display Helpers
// ============================================================================

export function formatProbabilities(outcome: ProbabilisticOutcome): string {
  const lines: string[] = [
    '🎯 REST-OF-SEASON PROJECTIONS',
    `  Floor (10th):  ${Math.round(outcome.rosScore.p10)}/100`,
    `  Median (50th): ${Math.round(outcome.rosScore.p50)}/100`,
    `  Ceiling (90th):${Math.round(outcome.rosScore.p90)}/100`,
    '',
    '📊 PROBABILITY OF VALUE TIER',
    `  Top 10:  ${(outcome.probTop10 * 100).toFixed(1)}%`,
    `  Top 25:  ${(outcome.probTop25 * 100).toFixed(1)}%`,
    `  Top 50:  ${(outcome.probTop50 * 100).toFixed(1)}%`,
    `  Top 100: ${(outcome.probTop100 * 100).toFixed(1)}%`,
    '',
    '⚠️ RISK PROFILE',
    `  Volatility: ${outcome.riskProfile.volatility}`,
    `  Downside:   ${(outcome.riskProfile.downsideRisk * 100).toFixed(1)}% chance of waiver-wire value`,
    `  Upside:     ${(outcome.riskProfile.upsidePotential * 100).toFixed(1)}% chance of top-50`,
  ];
  
  return lines.join('\n');
}

/**
 * Compare two players probabilistically
 */
export function comparePlayersProbabilistic(
  playerA: { name: string; outcome: ProbabilisticOutcome },
  playerB: { name: string; outcome: ProbabilisticOutcome }
): string {
  const aBetter = playerA.outcome.rosScore.p50 > playerB.outcome.rosScore.p50;
  const favorite = aBetter ? playerA : playerB;
  const underdog = aBetter ? playerB : playerA;
  
  const medianDiff = Math.abs(playerA.outcome.rosScore.p50 - playerB.outcome.rosScore.p50);
  
  // Calculate probability that favorite is actually better
  const overlap = calculateOverlap(
    playerA.outcome.rosScore,
    playerB.outcome.rosScore
  );
  
  return `${favorite.name} is favored by ${medianDiff.toFixed(1)} points (${(overlap * 100).toFixed(0)}% confidence)`;
}

/**
 * Calculate overlap between two distributions (simplified)
 */
function calculateOverlap(a: PercentileOutcomes, b: PercentileOutcomes): number {
  // Use mean and stdDev for normal approximation
  const aMean = a.mean;
  const bMean = b.mean;
  const aSD = a.stdDev;
  const bSD = b.stdDev;
  
  // Pooled standard deviation
  const pooledSD = Math.sqrt((aSD * aSD + bSD * bSD) / 2);
  
  // Cohen's d
  const cohenD = Math.abs(aMean - bMean) / pooledSD;
  
  // Convert to probability (rough approximation)
  // d = 0.2 -> ~55% confidence
  // d = 0.5 -> ~70% confidence
  // d = 1.0 -> ~85% confidence
  // d = 2.0 -> ~98% confidence
  return Math.min(0.99, 0.5 + 0.25 * cohenD);
}
