/**
 * Pitcher Scoring Layer (Parallel to hitters/compute.ts)
 *
 * Deterministic, stateless transformation of pitcher derived features → value scores.
 * Pure function: same inputs always produce same outputs.
 * 
 * ARCHITECTURAL PARITY WITH HITTERS:
 * - Z-score based component scoring
 * - Confidence-based regression to mean
 * - League-relative, not fixed thresholds
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
// League Statistics (for Z-score calculations)
// ============================================================================

const LEAGUE_PITCHING_2025 = {
  // Command (lower BB% is better, higher K/BB is better)
  walkRate: 0.085,
  walkRate_std: 0.025,
  kToBB: 3.0,
  kToBB_std: 1.2,
  
  // Stuff
  kRate: 0.220,
  kRate_std: 0.045,
  swingingStrike: 0.105,
  swingingStrike_std: 0.025,
  
  // Results (lower is better, so Z-scores are inverted)
  era: 4.20,
  era_std: 1.50,
  whip: 1.30,
  whip_std: 0.20,
  fip: 4.20,
  fip_std: 1.20,
  
  // Workload (higher IP is better)
  ipPerApp: 5.2,
  ipPerApp_std: 1.0,
};

/**
 * Calculate Z-score: (value - mean) / std_dev
 */
function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Convert Z-score to 0-100 scale
 * Z = 0 → 50 (league average)
 * Positive Z = above average (higher score)
 */
function zScoreTo100(z: number, scaleFactor: number = 10): number {
  return Math.max(0, Math.min(100, 50 + z * scaleFactor));
}

// ============================================================================
// Types
// ============================================================================

export interface PitcherScore {
  // Identity (shared with hitters)
  playerId: string;
  playerMlbamId: string;
  season: number;
  scoredAt: Date;

  // Domain discriminator
  domain: 'pitching';

  // Overall value (0-100 scale)
  overallValue: number;

  // Component scores (0-100 scale)
  components: {
    command: number;
    stuff: number;
    results: number;
    workload: number;
    consistency: number;
    matchup: number;
  };

  // Role context
  role: {
    currentRole: 'SP' | 'RP' | 'CL' | 'SWING';
    isCloser: boolean;
    holdsEligible: boolean;
    expectedInningsPerWeek: number;
    startProbabilityNext7: number;
  };

  // Confidence in the score (0-1)
  confidence: number;

  // Statistical reliability
  reliability: {
    sampleSize: 'insufficient' | 'small' | 'adequate' | 'large';
    battersToReliable: number;
    statsReliable: boolean;
  };

  // Explainability
  explanation: {
    summary: string;
    strengths: string[];
    concerns: string[];
    keyStats: Record<string, number | string>;
  };

  // Raw inputs
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

const DEFAULT_WEIGHTS: PitcherScoringWeights = {
  command: 0.20,
  stuff: 0.20,
  results: 0.25,
  workload: 0.15,
  consistency: 0.15,
  matchup: 0.05,
};

const CLOSER_WEIGHTS: PitcherScoringWeights = {
  command: 0.15,
  stuff: 0.30,
  results: 0.30,
  workload: 0.05,
  consistency: 0.15,
  matchup: 0.05,
};

// ============================================================================
// Z-Score Based Scoring Functions
// ============================================================================

/**
 * Command: Control metrics (BB%, K/BB)
 * Lower BB% is better (invert), higher K/BB is better
 */
function scoreCommand(rates: PitcherDerivedFeatures['rates']): number {
  let bbZ = 0;
  let kbbZ = 0;
  let components = 0;
  
  // Walk rate (lower is better, so invert Z)
  if (rates.walkRateLast30 !== null) {
    bbZ = -zScore(rates.walkRateLast30, LEAGUE_PITCHING_2025.walkRate, LEAGUE_PITCHING_2025.walkRate_std);
    components++;
  }
  
  // K/BB ratio (higher is better)
  if (rates.kToBBRatioLast30 !== null) {
    kbbZ = zScore(rates.kToBBRatioLast30, LEAGUE_PITCHING_2025.kToBB, LEAGUE_PITCHING_2025.kToBB_std);
    components++;
  }
  
  if (components === 0) return 50;
  
  // Average the Z-scores
  const combinedZ = (bbZ + kbbZ) / components;
  return zScoreTo100(combinedZ, 12);
}

/**
 * Stuff: Raw ability (K%, swinging strike%)
 * Higher is better
 */
function scoreStuff(rates: PitcherDerivedFeatures['rates']): number {
  let kZ = 0;
  let swStrZ = 0;
  let components = 0;
  
  // K% (higher is better)
  if (rates.strikeoutRateLast30 !== null) {
    kZ = zScore(rates.strikeoutRateLast30, LEAGUE_PITCHING_2025.kRate, LEAGUE_PITCHING_2025.kRate_std);
    components++;
  }
  
  // Swinging strike % (higher is better)
  if (rates.swingingStrikeRate !== null) {
    swStrZ = zScore(rates.swingingStrikeRate, LEAGUE_PITCHING_2025.swingingStrike, LEAGUE_PITCHING_2025.swingingStrike_std);
    components++;
  }
  
  if (components === 0) return 50;
  
  const combinedZ = (kZ + swStrZ) / components;
  // Stuff varies more, so use higher scale
  return zScoreTo100(combinedZ, 15);
}

/**
 * Results: Outcome quality (ERA, WHIP, FIP)
 * Lower is better for all, so invert Z
 */
function scoreResults(rates: PitcherDerivedFeatures['rates']): number {
  let eraZ = 0;
  let whipZ = 0;
  let fipZ = 0;
  let components = 0;
  
  // ERA (lower is better, invert)
  if (rates.eraLast30 !== null) {
    eraZ = -zScore(rates.eraLast30, LEAGUE_PITCHING_2025.era, LEAGUE_PITCHING_2025.era_std);
    components++;
  }
  
  // WHIP (lower is better, invert)
  if (rates.whipLast30 !== null) {
    whipZ = -zScore(rates.whipLast30, LEAGUE_PITCHING_2025.whip, LEAGUE_PITCHING_2025.whip_std);
    components++;
  }
  
  // FIP (lower is better, invert)
  if (rates.fipLast30 !== null) {
    fipZ = -zScore(rates.fipLast30, LEAGUE_PITCHING_2025.fip, LEAGUE_PITCHING_2025.fip_std);
    components++;
  }
  
  if (components === 0) return 50;
  
  const combinedZ = (eraZ + whipZ + fipZ) / components;
  return zScoreTo100(combinedZ, 12);
}

/**
 * Workload: Innings capacity
 * Higher IP per appearance is better
 */
function scoreWorkload(volume: PitcherDerivedFeatures['volume']): number {
  const ipPerApp = volume.appearancesLast30 > 0
    ? volume.inningsPitchedLast30 / volume.appearancesLast30
    : 0;
  
  if (ipPerApp === 0) return 50;
  
  const z = zScore(ipPerApp, LEAGUE_PITCHING_2025.ipPerApp, LEAGUE_PITCHING_2025.ipPerApp_std);
  return zScoreTo100(z, 10);
}

/**
 * Consistency: Performance variance
 * Higher quality start rate, lower blow-up rate is better
 */
function scoreConsistency(volatility: PitcherDerivedFeatures['volatility']): number {
  // Start with league average (50)
  let score = 50;
  
  // Quality start rate (higher is better)
  if (volatility.qualityStartRate !== null) {
    const qsZ = zScore(volatility.qualityStartRate, 0.40, 0.15);
    score += qsZ * 10;
  }
  
  // Blow-up rate (lower is better, invert)
  if (volatility.blowUpRate !== null) {
    const buZ = -zScore(volatility.blowUpRate, 0.25, 0.10);
    score += buZ * 10;
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Matchup: Opponent quality, park factors
 * Lower opponent OPS is better (invert)
 */
function scoreMatchup(context: PitcherDerivedFeatures['context']): number {
  let score = 50;
  
  // Opponent quality (lower OPS is better for pitcher, so invert)
  if (context.opponentOps !== null) {
    const opsZ = -zScore(context.opponentOps, 0.725, 0.050);
    score += opsZ * 10;
  }
  
  // Park factor (lower is better for pitcher, invert)
  if (context.parkFactor !== null) {
    // Park factor: 100 = neutral, <100 favors pitchers
    const pfZ = -zScore(context.parkFactor, 100, 10);
    score += pfZ * 5;
  }
  
  return Math.max(0, Math.min(100, score));
}

// ============================================================================
// Role Determination (Unchanged - still accurate)
// ============================================================================

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

  if (gamesSaved >= 2 || context.isCloser === true) {
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

  let expectedInningsPerWeek = 0;
  if (currentRole === 'SP') {
    expectedInningsPerWeek = 12;
  } else if (currentRole === 'RP' || currentRole === 'CL') {
    expectedInningsPerWeek = 3;
  } else if (currentRole === 'SWING') {
    expectedInningsPerWeek = 6;
  }

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

// ============================================================================
// Confidence Calculation (Aligned with hitters)
// ============================================================================

function calculateSampleConfidence(battersFaced: number): number {
  // Aligned with hitter PA thresholds
  if (battersFaced >= 200) return 1.0;      // Full confidence
  else if (battersFaced >= 150) return 0.90; // High
  else if (battersFaced >= 100) return 0.75; // Good
  else if (battersFaced >= 50) return 0.60;  // Moderate
  else return 0.45;                          // Low
}

function calculateConfidence(
  volume: PitcherDerivedFeatures['volume'],
  stabilization: PitcherDerivedFeatures['stabilization']
): { confidence: number; sampleSize: PitcherScore['reliability']['sampleSize'] } {
  const sampleConfidence = calculateSampleConfidence(volume.battersFacedLast30);
  
  // Additional reliability from stabilization
  let statConfidence = 0.5;
  if (stabilization.eraReliable) statConfidence += 0.15;
  if (stabilization.whipReliable) statConfidence += 0.1;
  if (volume.appearancesLast30 >= 6) statConfidence += 0.1;
  
  // Combined confidence
  const confidence = Math.round((sampleConfidence + statConfidence) / 2 * 100) / 100;
  
  // Sample size category
  let sampleSize: PitcherScore['reliability']['sampleSize'];
  if (volume.battersFacedLast30 < 50) sampleSize = 'insufficient';
  else if (volume.battersFacedLast30 < 100) sampleSize = 'small';
  else if (volume.battersFacedLast30 < 175) sampleSize = 'adequate';
  else sampleSize = 'large';
  
  return { confidence, sampleSize };
}

// ============================================================================
// Explanation Generation
// ============================================================================

function generateExplanation(
  components: PitcherScore['components'],
  rates: PitcherDerivedFeatures['rates'],
  role: PitcherScore['role']
): PitcherScore['explanation'] {
  const strengths: string[] = [];
  const concerns: string[] = [];

  if (components.command >= 75) strengths.push('Elite control');
  else if (components.command >= 65) strengths.push('Good command');

  if (components.stuff >= 75) strengths.push('Dominant stuff');
  else if (components.stuff >= 65) strengths.push('Above-average stuff');

  if (components.results >= 75) strengths.push('Excellent results');
  else if (components.results >= 65) strengths.push('Solid outcomes');

  if (components.workload >= 75) strengths.push('Workhorse workload');
  if (components.consistency >= 75) strengths.push('Highly consistent');

  if (role.isCloser) strengths.push('Closer role - save opportunities');
  else if (role.holdsEligible && components.stuff >= 65) {
    strengths.push('Setup role with strikeout upside');
  }

  if (components.command <= 40) concerns.push('Control issues');
  if (components.stuff <= 40) concerns.push('Limited stuff');
  if (components.results <= 40) concerns.push('Poor results');
  if (components.workload <= 40) concerns.push('Workload concerns');
  if (components.consistency <= 40) concerns.push('High volatility');

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

export function scorePitcher(
  features: PitcherDerivedFeatures,
  options: {
    weights?: Partial<PitcherScoringWeights>;
  } = {}
): PitcherScore {
  const role = determineRole(features.volume, features.context);
  
  const baseWeights = role.isCloser ? CLOSER_WEIGHTS : DEFAULT_WEIGHTS;
  const weights = { ...baseWeights, ...options.weights };

  // Calculate component scores (Z-score based)
  const components: PitcherScore['components'] = {
    command: Math.round(scoreCommand(features.rates)),
    stuff: Math.round(scoreStuff(features.rates)),
    results: Math.round(scoreResults(features.rates)),
    workload: Math.round(scoreWorkload(features.volume)),
    consistency: Math.round(scoreConsistency(features.volatility)),
    matchup: Math.round(scoreMatchup(features.context)),
  };

  // Calculate raw weighted overall value
  const rawOverallValue = Math.round(
    components.command * weights.command +
    components.stuff * weights.stuff +
    components.results * weights.results +
    components.workload * weights.workload +
    components.consistency * weights.consistency +
    components.matchup * weights.matchup
  );

  // Apply confidence-based regression to the mean (PARITY WITH HITTERS)
  const pa = features.volume.battersFacedLast30;
  const sampleConfidence = calculateSampleConfidence(pa);
  
  const leagueAverage = 50;
  const overallValue = Math.round(
    (rawOverallValue * sampleConfidence) + (leagueAverage * (1 - sampleConfidence))
  );

  // Calculate confidence for display
  const { confidence, sampleSize } = calculateConfidence(
    features.volume,
    features.stabilization
  );

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

export function scorePitchers(
  featuresList: PitcherDerivedFeatures[],
  options: {
    weights?: Partial<PitcherScoringWeights>;
  } = {}
): PitcherScore[] {
  return featuresList.map(features => scorePitcher(features, options));
}
