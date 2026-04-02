/**
 * Pitcher Scoring Layer (Parallel to hitters/compute.ts)
 *
 * Deterministic, stateless transformation of pitcher derived features → value scores.
 * Pure function: same inputs always produce same outputs.
 * 
 * PITCHER-SPECIFIC COMPONENTS:
 * - command: Control (BB%, K/BB ratio)
 * - stuff: Raw ability (velocity, movement, whiff%)  
 * - results: Outcome quality (ERA, WHIP, FIP)
 * - workload: Innings, rest, pitch count trends
 * - consistency: Variance in performance
 * - matchup: Opponent quality, park factors
 */

import type { PitcherDerivedFeatures } from './derived.js';

// ============================================================================
// Types
// ============================================================================

export interface PitcherScore {
  // Identity (shared with hitters - same player_id/mlbamId)
  playerId: string;
  playerMlbamId: string;
  season: number;
  scoredAt: Date;

  // Domain discriminator
  domain: 'pitching';

  // Overall value (0-100 scale)
  overallValue: number;

  // Component scores (0-100 scale) - PITCHER SPECIFIC
  components: {
    command: number;      // Control, BB%, K/BB
    stuff: number;        // Velocity, movement, whiff ability
    results: number;      // ERA, WHIP, FIP quality
    workload: number;     // Innings capacity, rest, durability
    consistency: number;  // Low volatility in performance
    matchup: number;      // Opponent quality, park factors
  };

  // Role context (critical for fantasy)
  role: {
    currentRole: 'SP' | 'RP' | 'CL' | 'SWING';
    isCloser: boolean;
    holdsEligible: boolean;
    expectedInningsPerWeek: number;
    startProbabilityNext7: number; // For SP/RP swingmen
  };

  // Confidence in the score (0-1)
  confidence: number;

  // Statistical reliability
  reliability: {
    sampleSize: 'insufficient' | 'small' | 'adequate' | 'large';
    battersToReliable: number; // How many more BF until reliable
    statsReliable: boolean;
  };

  // Explainability
  explanation: {
    summary: string;
    strengths: string[];
    concerns: string[];
    keyStats: Record<string, number | string>;
  };

  // Raw inputs (for transparency)
  inputs: {
    derivedFeaturesVersion: string;
    computedAt: Date;
  };
}

// ============================================================================
// Scoring Configuration
// ============================================================================

interface PitcherScoringWeights {
  command: number;
  stuff: number;
  results: number;
  workload: number;
  consistency: number;
  matchup: number;
}

// Slightly different weights than hitters - results matter more for pitchers
const DEFAULT_WEIGHTS: PitcherScoringWeights = {
  command: 0.20,
  stuff: 0.20,
  results: 0.25,      // Higher weight - outcomes matter
  workload: 0.15,
  consistency: 0.15,
  matchup: 0.05,      // Lower weight - matchup dependent
};

// Closer weights - different priorities
const CLOSER_WEIGHTS: PitcherScoringWeights = {
  command: 0.15,
  stuff: 0.30,        // Stuff matters more for RPs
  results: 0.30,      // ERA/WHIP critical
  workload: 0.05,     // Less important for closers
  consistency: 0.15,
  matchup: 0.05,
};

// ============================================================================
// Pure Scoring Functions
// ============================================================================

/**
 * Calculate command component score.
 * Based on BB%, K/BB ratio, control metrics.
 */
function scoreCommand(rates: PitcherDerivedFeatures['rates']): number {
  let score = 50;

  // BB% contribution (inverse - lower is better)
  if (rates.walkRateLast30 !== null) {
    const bbRate = rates.walkRateLast30;
    if (bbRate <= 0.05) score += 20;      // Elite control
    else if (bbRate <= 0.06) score += 15;
    else if (bbRate <= 0.07) score += 10;
    else if (bbRate <= 0.08) score += 5;
    else if (bbRate >= 0.12) score -= 15;  // Poor control
    else if (bbRate >= 0.10) score -= 10;
  }

  // K/BB ratio contribution
  if (rates.kToBBRatioLast30 !== null) {
    const ratio = rates.kToBBRatioLast30;
    if (ratio >= 5.0) score += 15;        // Elite
    else if (ratio >= 4.0) score += 12;
    else if (ratio >= 3.0) score += 8;
    else if (ratio >= 2.5) score += 5;
    else if (ratio < 1.5) score -= 15;     // Poor
    else if (ratio < 2.0) score -= 10;
  }

  // First pitch strike %
  if (rates.firstPitchStrikeRate !== null) {
    const fps = rates.firstPitchStrikeRate;
    if (fps >= 0.65) score += 10;
    else if (fps >= 0.62) score += 5;
    else if (fps < 0.58) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate stuff component score.
 * Based on velocity, whiff%, K%, movement metrics.
 */
function scoreStuff(rates: PitcherDerivedFeatures['rates']): number {
  let score = 50;

  // K% contribution
  if (rates.strikeoutRateLast30 !== null) {
    const kRate = rates.strikeoutRateLast30;
    if (kRate >= 0.30) score += 25;       // Elite
    else if (kRate >= 0.27) score += 20;
    else if (kRate >= 0.25) score += 15;
    else if (kRate >= 0.22) score += 10;
    else if (kRate >= 0.20) score += 5;
    else if (kRate < 0.15) score -= 15;    // Poor
    else if (kRate < 0.18) score -= 10;
  }

  // Swinging strike % (whiff ability)
  if (rates.swingingStrikeRate !== null) {
    const swStr = rates.swingingStrikeRate;
    if (swStr >= 0.14) score += 15;
    else if (swStr >= 0.12) score += 10;
    else if (swStr >= 0.10) score += 5;
    else if (swStr < 0.08) score -= 10;
  }

  // Velocity (if available)
  if (rates.avgVelocity !== null) {
    const velo = rates.avgVelocity;
    if (velo >= 96) score += 10;
    else if (velo >= 94) score += 5;
    else if (velo < 90) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate results component score.
 * Based on ERA, WHIP, FIP, xFIP.
 */
function scoreResults(rates: PitcherDerivedFeatures['rates']): number {
  let score = 50;

  // ERA contribution
  if (rates.eraLast30 !== null) {
    const era = rates.eraLast30;
    if (era <= 2.50) score += 30;         // Elite
    else if (era <= 3.00) score += 25;
    else if (era <= 3.50) score += 20;
    else if (era <= 4.00) score += 15;
    else if (era <= 4.50) score += 10;
    else if (era >= 6.00) score -= 25;     // Disastrous
    else if (era >= 5.50) score -= 20;
    else if (era >= 5.00) score -= 15;
  }

  // WHIP contribution
  if (rates.whipLast30 !== null) {
    const whip = rates.whipLast30;
    if (whip <= 1.00) score += 20;
    else if (whip <= 1.10) score += 15;
    else if (whip <= 1.20) score += 10;
    else if (whip <= 1.30) score += 5;
    else if (whip >= 1.60) score -= 20;
    else if (whip >= 1.50) score -= 15;
    else if (whip >= 1.40) score -= 10;
  }

  // FIP vs ERA gap (luck indicator)
  if (rates.fipLast30 !== null && rates.eraLast30 !== null) {
    const gap = rates.eraLast30 - rates.fipLast30;
    if (gap > 1.0) score -= 10;           // ERA likely to regress up
    else if (gap < -1.0) score += 5;      // ERA likely to regress down
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate workload component score.
 * Based on innings pitched, rest patterns, pitch counts.
 */
function scoreWorkload(volume: PitcherDerivedFeatures['volume']): number {
  let score = 50;

  // Innings per start/appearance
  const ipPerApp = volume.appearancesLast30 > 0
    ? volume.inningsPitchedLast30 / volume.appearancesLast30
    : 0;

  if (ipPerApp >= 6.0) score += 20;       // Workhorse
  else if (ipPerApp >= 5.5) score += 15;
  else if (ipPerApp >= 5.0) score += 10;
  else if (ipPerApp >= 4.0) score += 5;
  else if (ipPerApp < 3.0) score -= 15;   // Can't get deep

  // Total innings volume
  if (volume.inningsPitchedLast30 >= 40) score += 10;
  else if (volume.inningsPitchedLast30 >= 30) score += 5;
  else if (volume.inningsPitchedLast30 < 15) score -= 10;

  // Pitch count efficiency
  if (volume.pitchesPerInning !== null) {
    const ppi = volume.pitchesPerInning;
    if (ppi <= 15) score += 10;           // Efficient
    else if (ppi >= 20) score -= 10;      // Inefficient
  }

  // Rest patterns
  if (volume.daysSinceLastAppearance !== null) {
    const rest = volume.daysSinceLastAppearance;
    if (rest >= 4 && rest <= 6) score += 5;  // Ideal rest
    else if (rest < 3) score -= 10;          // Short rest risk
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate consistency component score.
 * Based on volatility in performance.
 */
function scoreConsistency(volatility: PitcherDerivedFeatures['volatility']): number {
  let score = 50;

  // Quality start rate
  if (volatility.qualityStartRate !== null) {
    const qsRate = volatility.qualityStartRate;
    if (qsRate >= 0.70) score += 20;
    else if (qsRate >= 0.60) score += 15;
    else if (qsRate >= 0.50) score += 10;
    else if (qsRate >= 0.40) score += 5;
    else if (qsRate < 0.30) score -= 15;
  }

  // Blow-up rate (inverse - lower is better)
  if (volatility.blowUpRate !== null) {
    const buRate = volatility.blowUpRate;
    if (buRate <= 0.10) score += 15;      // Rare blow-ups
    else if (buRate <= 0.20) score += 10;
    else if (buRate >= 0.40) score -= 20;  // Frequent blow-ups
    else if (buRate >= 0.30) score -= 15;
  }

  // ERA volatility
  if (volatility.eraVolatility !== null) {
    const eraVol = volatility.eraVolatility;
    if (eraVol <= 1.5) score += 10;
    else if (eraVol >= 3.0) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate matchup component score.
 * Based on opponent quality, park factors, etc.
 */
function scoreMatchup(context: PitcherDerivedFeatures['context']): number {
  let score = 50;

  // Opponent quality (OPP OPS)
  if (context.opponentOps !== null) {
    const ops = context.opponentOps;
    if (ops <= 0.650) score += 15;        // Weak opponent
    else if (ops <= 0.700) score += 10;
    else if (ops >= 0.800) score -= 15;   // Strong opponent
    else if (ops >= 0.750) score -= 10;
  }

  // Park factor (100 = neutral)
  if (context.parkFactor !== null) {
    const pf = context.parkFactor;
    if (pf <= 95) score += 10;            // Pitcher-friendly park
    else if (pf >= 110) score -= 10;      // Hitter-friendly park
  }

  // Home/away (slight edge for home)
  if (context.isHome !== null) {
    if (context.isHome) score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Determine pitcher role and related metrics.
 */
function determineRole(
  volume: PitcherDerivedFeatures['volume'],
  context: PitcherDerivedFeatures['context']
): PitcherScore['role'] {
  const appearances = volume.appearancesLast30;
  const gamesSaved = volume.gamesSavedLast30;
  const inningsPerApp = appearances > 0
    ? volume.inningsPitchedLast30 / appearances
    : 0;

  let currentRole: PitcherScore['role']['currentRole'] = 'SP';
  let isCloser = false;
  let holdsEligible = false;

  // Role determination logic
  if (gamesSaved >= 5 || context.isCloser === true) {
    currentRole = 'CL';
    isCloser = true;
  } else if (appearances > 0 && inningsPerApp < 2.0) {
    currentRole = 'RP';
    holdsEligible = true;
  } else if (inningsPerApp >= 3.0 && appearances >= 4) {
    currentRole = 'SP';
  } else if (appearances >= 4) {
    currentRole = 'SWING';
  }

  // Expected innings per week (based on role)
  let expectedInningsPerWeek = 0;
  if (currentRole === 'SP') {
    expectedInningsPerWeek = 12;  // ~2 starts × 6 innings
  } else if (currentRole === 'RP' || currentRole === 'CL') {
    expectedInningsPerWeek = 3;   // ~3-4 appearances
  } else if (currentRole === 'SWING') {
    expectedInningsPerWeek = 6;   // Mixed usage
  }

  // Start probability (for swingmen)
  const startProbabilityNext7 = context.scheduledStartNext7 ? 1.0 :
    currentRole === 'SP' ? 0.9 :
    currentRole === 'SWING' ? 0.3 : 0.0;

  return {
    currentRole,
    isCloser,
    holdsEligible,
    expectedInningsPerWeek,
    startProbabilityNext7,
  };
}

/**
 * Calculate overall confidence in the pitcher score.
 */
function calculateConfidence(
  volume: PitcherDerivedFeatures['volume'],
  stabilization: PitcherDerivedFeatures['stabilization']
): { confidence: number; sampleSize: PitcherScore['reliability']['sampleSize'] } {
  let confidence = 0.5;

  // Based on batters faced
  const bf = volume.battersFacedLast30;
  if (bf >= 200) confidence += 0.2;
  else if (bf >= 150) confidence += 0.15;
  else if (bf >= 100) confidence += 0.1;
  else if (bf < 50) confidence -= 0.2;

  // Based on appearances
  if (volume.appearancesLast30 >= 6) confidence += 0.1;
  else if (volume.appearancesLast30 < 3) confidence -= 0.1;

  // Based on stat reliability
  if (stabilization.eraReliable) confidence += 0.15;
  else if (stabilization.whipReliable) confidence += 0.1;

  // Determine sample size category
  let sampleSize: PitcherScore['reliability']['sampleSize'];
  if (bf < 50) sampleSize = 'insufficient';
  else if (bf < 100) sampleSize = 'small';
  else if (bf < 175) sampleSize = 'adequate';
  else sampleSize = 'large';

  return {
    confidence: Math.max(0, Math.min(1, confidence)),
    sampleSize,
  };
}

/**
 * Generate explanation for the pitcher score.
 */
function generateExplanation(
  components: PitcherScore['components'],
  rates: PitcherDerivedFeatures['rates'],
  role: PitcherScore['role']
): PitcherScore['explanation'] {
  const strengths: string[] = [];
  const concerns: string[] = [];

  // Identify strengths
  if (components.command >= 75) strengths.push('Elite control');
  else if (components.command >= 65) strengths.push('Good command');

  if (components.stuff >= 75) strengths.push('Dominant stuff');
  else if (components.stuff >= 65) strengths.push('Above-average stuff');

  if (components.results >= 75) strengths.push('Excellent results');
  else if (components.results >= 65) strengths.push('Solid outcomes');

  if (components.workload >= 75) strengths.push('Workhorse workload');
  if (components.consistency >= 75) strengths.push('Highly consistent');

  // Role-specific strengths
  if (role.isCloser) strengths.push('Closer role - save opportunities');
  else if (role.holdsEligible && components.stuff >= 65) {
    strengths.push('Setup role with strikeout upside');
  }

  // Identify concerns
  if (components.command <= 40) concerns.push('Control issues');
  if (components.stuff <= 40) concerns.push('Limited stuff');
  if (components.results <= 40) concerns.push('Poor results');
  if (components.workload <= 40) concerns.push('Workload concerns');
  if (components.consistency <= 40) concerns.push('High volatility');

  // Summary based on overall profile
  let summary = '';
  const avgComponent = Object.values(components).reduce((a, b) => a + b, 0) / 6;

  if (avgComponent >= 70) {
    summary = role.isCloser
      ? 'Elite closer with dominant ratios and save volume'
      : role.currentRole === 'SP'
      ? 'Ace-level starter with workhorse potential'
      : 'Elite reliever with multi-inning upside';
  } else if (avgComponent >= 60) {
    summary = 'Reliable fantasy contributor with defined strengths';
  } else if (avgComponent >= 50) {
    summary = 'Average fantasy value, situational streaming candidate';
  } else if (avgComponent >= 40) {
    summary = 'Limited fantasy value, high risk streamer';
  } else {
    summary = 'Not currently fantasy relevant';
  }

  return {
    summary,
    strengths: strengths.slice(0, 3),
    concerns: concerns.slice(0, 3),
    keyStats: {
      era: rates.eraLast30?.toFixed(2) ?? 'N/A',
      whip: rates.whipLast30?.toFixed(2) ?? 'N/A',
      kPer9: rates.strikeoutRateLast30 ? (rates.strikeoutRateLast30 * 27).toFixed(1) : 'N/A',
      bbPer9: rates.walkRateLast30 ? (rates.walkRateLast30 * 27).toFixed(1) : 'N/A',
      role: role.currentRole,
      expectedIP: role.expectedInningsPerWeek,
    },
  };
}

// ============================================================================
// Main Scoring Function
// ============================================================================

/**
 * Score a pitcher based on derived features.
 * Pure function - same inputs always produce same outputs.
 */
export function scorePitcher(
  features: PitcherDerivedFeatures,
  options: {
    weights?: Partial<PitcherScoringWeights>;
  } = {}
): PitcherScore {
  // Determine role first (affects weights)
  const role = determineRole(features.volume, features.context);
  
  // Select appropriate weights
  const baseWeights = role.isCloser ? CLOSER_WEIGHTS : DEFAULT_WEIGHTS;
  const weights = { ...baseWeights, ...options.weights };

  // Calculate component scores
  const components: PitcherScore['components'] = {
    command: scoreCommand(features.rates),
    stuff: scoreStuff(features.rates),
    results: scoreResults(features.rates),
    workload: scoreWorkload(features.volume),
    consistency: scoreConsistency(features.volatility),
    matchup: scoreMatchup(features.context),
  };

  // Calculate weighted overall value
  const overallValue = Math.round(
    components.command * weights.command +
    components.stuff * weights.stuff +
    components.results * weights.results +
    components.workload * weights.workload +
    components.consistency * weights.consistency +
    components.matchup * weights.matchup
  );

  // Calculate confidence
  const { confidence, sampleSize } = calculateConfidence(
    features.volume,
    features.stabilization
  );

  // Generate explanation
  const explanation = generateExplanation(components, features.rates, role);

  return {
    playerId: features.playerId,
    playerMlbamId: features.playerMlbamId,
    season: features.season,
    scoredAt: new Date(),
    domain: 'pitching',
    overallValue: Math.max(0, Math.min(100, overallValue)),
    components,
    role,
    confidence,
    reliability: {
      sampleSize,
      battersToReliable: features.stabilization.battersToReliable,
      statsReliable: features.stabilization.eraReliable,
    },
    explanation,
    inputs: {
      derivedFeaturesVersion: 'v1',
      computedAt: features.computedAt,
    },
  };
}

/**
 * Batch score multiple pitchers.
 */
export function scorePitchers(
  featuresList: PitcherDerivedFeatures[],
  options: {
    weights?: Partial<PitcherScoringWeights>;
  } = {}
): PitcherScore[] {
  return featuresList.map(features => scorePitcher(features, options));
}
