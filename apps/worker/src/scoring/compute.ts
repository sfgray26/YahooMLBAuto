/**
 * Player Scoring Layer
 *
 * Deterministic, stateless transformation of derived features → value scores.
 * Pure function: same inputs always produce same outputs.
 * No persistence, no side effects, no league context.
 *
 * Outputs:
 * - Overall value score (0-100)
 * - Component scores (hitting, power, speed, plate discipline, consistency)
 * - Confidence level (how reliable the score is)
 * - Explanation (why this score)
 */

import type { DerivedFeatures } from '../derived/index.js';

// ============================================================================
// Types
// ============================================================================

export interface PlayerScore {
  // Identity
  playerId: string;
  playerMlbamId: string;
  season: number;
  scoredAt: Date;

  // Overall value (0-100 scale)
  overallValue: number;

  // Component scores (0-100 scale)
  components: {
    hitting: number;      // Contact ability
    power: number;        // Extra base power
    speed: number;        // Baserunning
    plateDiscipline: number; // BB/K ratio, selectivity
    consistency: number;  // Low volatility, reliable stats
    opportunity: number;  // Playing time, lineup spot
  };

  // Confidence in the score (0-1)
  confidence: number;

  // Statistical reliability
  reliability: {
    sampleSize: 'insufficient' | 'small' | 'adequate' | 'large';
    gamesToReliable: number;
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

interface ScoringWeights {
  hitting: number;
  power: number;
  speed: number;
  plateDiscipline: number;
  consistency: number;
  opportunity: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  hitting: 0.20,
  power: 0.20,
  speed: 0.15,
  plateDiscipline: 0.15,
  consistency: 0.15,
  opportunity: 0.15,
};

// ============================================================================
// Pure Scoring Functions
// ============================================================================

/**
 * Calculate hitting component score.
 * Based on batting average, BABIP, contact ability.
 */
function scoreHitting(features: DerivedFeatures['rates']): number {
  let score = 50; // Base score

  // Batting average contribution (max 25 points)
  if (features.battingAverageLast30 !== null) {
    const avg = features.battingAverageLast30;
    if (avg >= 0.300) score += 25;
    else if (avg >= 0.280) score += 20;
    else if (avg >= 0.260) score += 15;
    else if (avg >= 0.250) score += 10;
    else if (avg >= 0.240) score += 5;
    else if (avg < 0.220) score -= 10;
    else if (avg < 0.200) score -= 20;
  }

  // BABIP contribution (max 10 points)
  if (features.babipLast30 !== null) {
    const babip = features.babipLast30;
    if (babip >= 0.330) score += 10;
    else if (babip >= 0.310) score += 5;
    else if (babip < 0.280) score -= 5;
    else if (babip < 0.260) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate power component score.
 * Based on ISO, SLG, HR rate.
 */
function scorePower(features: DerivedFeatures['rates']): number {
  let score = 50;

  // ISO contribution (max 30 points)
  if (features.isoLast30 !== null) {
    const iso = features.isoLast30;
    if (iso >= 0.250) score += 30;
    else if (iso >= 0.200) score += 25;
    else if (iso >= 0.180) score += 20;
    else if (iso >= 0.160) score += 15;
    else if (iso >= 0.140) score += 10;
    else if (iso >= 0.120) score += 5;
    else if (iso < 0.100) score -= 5;
    else if (iso < 0.080) score -= 10;
  }

  // SLG contribution (max 15 points)
  if (features.sluggingPctLast30 !== null) {
    const slg = features.sluggingPctLast30;
    if (slg >= 0.500) score += 15;
    else if (slg >= 0.450) score += 10;
    else if (slg >= 0.420) score += 5;
    else if (slg < 0.380) score -= 5;
    else if (slg < 0.350) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate speed component score.
 * Based on stolen bases, caught stealing efficiency.
 */
function scoreSpeed(volume: DerivedFeatures['volume']): number {
  let score = 50;

  const sbPerGame = volume.plateAppearancesLast30 > 0
    ? 0 // Would need SB data in derived features
    : 0;

  // For now, base on volume/opportunity as proxy
  if (volume.gamesLast30 >= 25) score += 5;
  if (volume.plateAppearancesLast30 >= 100) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate plate discipline component score.
 * Based on BB%, K%, BB/K ratio.
 */
function scorePlateDiscipline(features: DerivedFeatures['rates']): number {
  let score = 50;

  // Walk rate contribution (max 15 points)
  if (features.walkRateLast30 !== null) {
    const bbRate = features.walkRateLast30;
    if (bbRate >= 0.12) score += 15;
    else if (bbRate >= 0.10) score += 12;
    else if (bbRate >= 0.09) score += 10;
    else if (bbRate >= 0.08) score += 7;
    else if (bbRate >= 0.07) score += 5;
    else if (bbRate < 0.05) score -= 5;
    else if (bbRate < 0.04) score -= 10;
  }

  // Strikeout rate contribution (inverse - lower is better)
  if (features.strikeoutRateLast30 !== null) {
    const kRate = features.strikeoutRateLast30;
    if (kRate <= 0.15) score += 15;
    else if (kRate <= 0.18) score += 12;
    else if (kRate <= 0.20) score += 8;
    else if (kRate <= 0.22) score += 5;
    else if (kRate <= 0.25) score += 0;
    else if (kRate <= 0.28) score -= 5;
    else if (kRate <= 0.32) score -= 10;
    else score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate consistency component score.
 * Based on volatility metrics, hit consistency.
 */
function scoreConsistency(volatility: DerivedFeatures['volatility']): number {
  let score = 50;

  // Hit consistency score contribution
  score += (volatility.hitConsistencyScore - 50) * 0.4;

  // Production volatility (inverse)
  const vol = volatility.productionVolatility;
  if (vol < 0.5) score += 10;
  else if (vol < 0.8) score += 5;
  else if (vol > 1.5) score -= 10;
  else if (vol > 2.0) score -= 15;

  // Zero hit games (penalty)
  const zeroHitRate = volatility.zeroHitGamesLast14 / 14;
  if (zeroHitRate <= 0.2) score += 5;
  else if (zeroHitRate >= 0.5) score -= 10;
  else if (zeroHitRate >= 0.6) score -= 15;

  // Multi-hit games (bonus)
  const multiHitRate = volatility.multiHitGamesLast14 / 14;
  if (multiHitRate >= 0.25) score += 10;
  else if (multiHitRate >= 0.20) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate opportunity component score.
 * Based on playing time, trend, platoon risk.
 */
function scoreOpportunity(
  opportunity: DerivedFeatures['opportunity'],
  volume: DerivedFeatures['volume']
): number {
  let score = 50;

  // Games started - use gamesStartedLast14 if available, fallback to gamesLast14
  // Games played in last 14 days / 14 = playing time rate
  const gamesStarted = opportunity.gamesStartedLast14 > 0 
    ? opportunity.gamesStartedLast14 
    : volume.gamesLast14;
  const gamesRate = gamesStarted / 14;
  
  if (gamesRate >= 0.9) score += 20;
  else if (gamesRate >= 0.8) score += 15;
  else if (gamesRate >= 0.7) score += 10;
  else if (gamesRate >= 0.6) score += 5;
  else if (gamesRate < 0.4) score -= 20;
  else if (gamesRate < 0.5) score -= 10;

  // Also consider 30-day volume for additional context
  const paPerGame = volume.gamesLast30 > 0 
    ? volume.plateAppearancesLast30 / volume.gamesLast30 
    : 0;
  if (paPerGame >= 4.5) score += 5;
  else if (paPerGame < 3.0) score -= 5;

  // Platoon risk (penalty)
  if (opportunity.platoonRisk === 'low') score += 5;
  else if (opportunity.platoonRisk === 'medium') score -= 5;
  else if (opportunity.platoonRisk === 'high') score -= 15;

  // Playing time trend
  if (opportunity.playingTimeTrend === 'up') score += 5;
  else if (opportunity.playingTimeTrend === 'down') score -= 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate overall confidence in the score.
 * Based on sample size, stabilization status.
 */
function calculateConfidence(
  stabilization: DerivedFeatures['stabilization'],
  volume: DerivedFeatures['volume']
): { confidence: number; sampleSize: PlayerScore['reliability']['sampleSize'] } {
  let confidence = 0.5;

  // Based on games played
  if (volume.gamesLast30 >= 25) confidence += 0.2;
  else if (volume.gamesLast30 >= 20) confidence += 0.15;
  else if (volume.gamesLast30 >= 15) confidence += 0.1;
  else if (volume.gamesLast30 < 10) confidence -= 0.2;

  // Based on PA
  if (volume.plateAppearancesLast30 >= 100) confidence += 0.15;
  else if (volume.plateAppearancesLast30 >= 80) confidence += 0.1;
  else if (volume.plateAppearancesLast30 < 50) confidence -= 0.15;

  // Based on stat reliability
  if (stabilization.opsReliable) confidence += 0.15;
  else if (stabilization.slgReliable) confidence += 0.1;

  // Determine sample size category
  let sampleSize: PlayerScore['reliability']['sampleSize'];
  if (volume.plateAppearancesLast30 < 30) sampleSize = 'insufficient';
  else if (volume.plateAppearancesLast30 < 60) sampleSize = 'small';
  else if (volume.plateAppearancesLast30 < 120) sampleSize = 'adequate';
  else sampleSize = 'large';

  return {
    confidence: Math.max(0, Math.min(1, confidence)),
    sampleSize,
  };
}

/**
 * Generate explanation for the score.
 */
function generateExplanation(
  components: PlayerScore['components'],
  rates: DerivedFeatures['rates'],
  opportunity: DerivedFeatures['opportunity']
): PlayerScore['explanation'] {
  const strengths: string[] = [];
  const concerns: string[] = [];

  // Identify strengths
  if (components.hitting >= 75) strengths.push('Elite contact ability');
  else if (components.hitting >= 65) strengths.push('Above-average hitter');

  if (components.power >= 75) strengths.push('Significant power');
  else if (components.power >= 65) strengths.push('Good power');

  if (components.plateDiscipline >= 75) strengths.push('Excellent plate discipline');
  else if (components.plateDiscipline >= 65) strengths.push('Good approach');

  if (components.consistency >= 75) strengths.push('Highly consistent producer');

  if (components.opportunity >= 75) strengths.push('Full-time regular');

  // Identify concerns
  if (components.hitting <= 40) concerns.push('Struggling to make contact');
  if (components.power <= 40) concerns.push('Limited power output');
  if (components.plateDiscipline <= 40) concerns.push('Poor plate discipline');
  if (components.consistency <= 40) concerns.push('High volatility');
  if (components.opportunity <= 40) concerns.push('Playing time concerns');

  // Summary based on overall profile
  let summary = '';
  const avgComponent = (components.hitting + components.power + components.plateDiscipline + components.consistency + components.opportunity) / 5;

  if (avgComponent >= 70) summary = 'Elite fantasy asset across multiple categories';
  else if (avgComponent >= 60) summary = 'Solid fantasy contributor with defined strengths';
  else if (avgComponent >= 50) summary = 'Average fantasy value, situational use';
  else if (avgComponent >= 40) summary = 'Limited fantasy value, high risk';
  else summary = 'Not currently fantasy relevant';

  return {
    summary,
    strengths: strengths.slice(0, 3),
    concerns: concerns.slice(0, 3),
    keyStats: {
      battingAverage: rates.battingAverageLast30?.toFixed(3) ?? 'N/A',
      ops: rates.opsLast30?.toFixed(3) ?? 'N/A',
      iso: rates.isoLast30?.toFixed(3) ?? 'N/A',
      bbRate: rates.walkRateLast30 ? `${(rates.walkRateLast30 * 100).toFixed(1)}%` : 'N/A',
      kRate: rates.strikeoutRateLast30 ? `${(rates.strikeoutRateLast30 * 100).toFixed(1)}%` : 'N/A',
      gamesStarted14d: opportunity.gamesStartedLast14,
    },
  };
}

// ============================================================================
// Main Scoring Function
// ============================================================================

/**
 * Score a player based on derived features.
 * Pure function - same inputs always produce same outputs.
 */
export function scorePlayer(
  features: DerivedFeatures,
  options: {
    weights?: Partial<ScoringWeights>;
  } = {}
): PlayerScore {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };

  // Calculate component scores
  const components: PlayerScore['components'] = {
    hitting: scoreHitting(features.rates),
    power: scorePower(features.rates),
    speed: scoreSpeed(features.volume),
    plateDiscipline: scorePlateDiscipline(features.rates),
    consistency: scoreConsistency(features.volatility),
    opportunity: scoreOpportunity(features.opportunity, features.volume),
  };

  // Calculate weighted overall value
  const rawOverallValue = Math.round(
    components.hitting * weights.hitting +
    components.power * weights.power +
    components.speed * weights.speed +
    components.plateDiscipline * weights.plateDiscipline +
    components.consistency * weights.consistency +
    components.opportunity * weights.opportunity
  );

  // Apply sample size cap to prevent small-sample extremes from dominating
  // Sharp managers don't trust 45 PA samples over 500 PA track records
  let sampleSizeCap = 100;
  const pa = features.volume.plateAppearancesLast30;
  if (pa >= 120) sampleSizeCap = 100;        // Large sample - no cap
  else if (pa >= 80) sampleSizeCap = 85;     // Good sample
  else if (pa >= 50) sampleSizeCap = 75;     // Adequate sample
  else if (pa >= 30) sampleSizeCap = 65;     // Small sample
  else sampleSizeCap = 55;                   // Insufficient sample
  
  const overallValue = Math.min(rawOverallValue, sampleSizeCap);

  // Calculate confidence
  const { confidence, sampleSize } = calculateConfidence(
    features.stabilization,
    features.volume
  );

  // Generate explanation
  const explanation = generateExplanation(components, features.rates, features.opportunity);

  return {
    playerId: features.playerId,
    playerMlbamId: features.playerMlbamId,
    season: features.season,
    scoredAt: new Date(),
    overallValue: Math.max(0, Math.min(100, overallValue)),
    components,
    confidence,
    reliability: {
      sampleSize,
      gamesToReliable: features.stabilization.gamesToReliable,
      statsReliable: features.stabilization.opsReliable,
    },
    explanation,
    inputs: {
      derivedFeaturesVersion: 'v1',
      computedAt: features.computedAt,
    },
  };
}

/**
 * Batch score multiple players.
 */
export function scorePlayers(
  featuresList: DerivedFeatures[],
  options: {
    weights?: Partial<ScoringWeights>;
  } = {}
): PlayerScore[] {
  return featuresList.map(features => scorePlayer(features, options));
}
