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
// League Statistics (for Z-score calculations)
// ============================================================================

const LEAGUE_AVG_2025 = {
  wOBA: 0.320,
  wOBA_std: 0.050,
  ISO: 0.155,
  ISO_std: 0.080,
  AVG: 0.245,
  AVG_std: 0.035,
  BB_rate: 0.085,
  BB_rate_std: 0.040,
  K_rate: 0.220,
  K_rate_std: 0.060,
};

// ============================================================================
// Position-Adjusted Scoring (Dual-Context Z-Scores)
// ============================================================================

/**
 * Position groups for scarcity calculations
 * Some positions are grouped (e.g., corner OF) if scarcity is similar
 */
export type PositionGroup = 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH';

/**
 * Position-specific means and standard deviations
 * These represent the distribution of players AT EACH POSITION
 * 
 * Key insight: A catcher with 0.750 OPS is elite at C but average overall
 */
const POSITION_STATS_2025: Record<PositionGroup, {
  wOBA_mean: number; wOBA_std: number;
  ISO_mean: number; ISO_std: number;
  AVG_mean: number; AVG_std: number;
}> = {
  // Premium defensive positions = lower offensive bar
  'C':  { wOBA_mean: 0.295, wOBA_std: 0.045, ISO_mean: 0.135, ISO_std: 0.070, AVG_mean: 0.230, AVG_std: 0.030 },
  'SS': { wOBA_mean: 0.305, wOBA_std: 0.050, ISO_mean: 0.145, ISO_std: 0.075, AVG_mean: 0.240, AVG_std: 0.035 },
  '2B': { wOBA_mean: 0.310, wOBA_std: 0.050, ISO_mean: 0.150, ISO_std: 0.075, AVG_mean: 0.250, AVG_std: 0.035 },
  
  // Corner infield
  '3B': { wOBA_mean: 0.325, wOBA_std: 0.055, ISO_mean: 0.175, ISO_std: 0.080, AVG_mean: 0.255, AVG_std: 0.035 },
  '1B': { wOBA_mean: 0.335, wOBA_std: 0.055, ISO_mean: 0.195, ISO_std: 0.085, AVG_mean: 0.260, AVG_std: 0.035 },
  
  // OF and DH - highest offensive bars
  'OF': { wOBA_mean: 0.325, wOBA_std: 0.050, ISO_mean: 0.175, ISO_std: 0.080, AVG_mean: 0.255, AVG_std: 0.035 },
  'DH': { wOBA_mean: 0.340, wOBA_std: 0.050, ISO_mean: 0.200, ISO_std: 0.080, AVG_mean: 0.265, AVG_std: 0.035 },
};

/**
 * Blend factor: how much to weight position context vs league context
 * α = 0.7 means 70% league, 30% position
 * 
 * Rationale: League context keeps absolute value (bad hitters are bad),
 * Position context adds scarcity premium (C with decent bat is valuable)
 */
const POSITION_BLEND_FACTOR = 0.7; // 70% league, 30% position

/**
 * Determine primary position group from player positions
 */
function getPositionGroup(positions: string[]): PositionGroup {
  // Priority: C > SS > 2B > 3B > 1B > OF > DH
  const posSet = new Set(positions.map(p => p.toUpperCase()));
  
  if (posSet.has('C') || posSet.has('CATCHER')) return 'C';
  if (posSet.has('SS') || posSet.has('SHORTSTOP')) return 'SS';
  if (posSet.has('2B') || posSet.has('SECOND BASE')) return '2B';
  if (posSet.has('3B') || posSet.has('THIRD BASE')) return '3B';
  if (posSet.has('1B') || posSet.has('FIRST BASE')) return '1B';
  if (posSet.has('OF') || posSet.has('LF') || posSet.has('CF') || posSet.has('RF') || posSet.has('OUTFIELD')) return 'OF';
  if (posSet.has('DH') || posSet.has('DESIGNATED HITTER')) return 'DH';
  
  return 'OF'; // Default fallback
}

/**
 * Calculate position-adjusted Z-score
 * Combines league Z-score (absolute value) with position Z-score (scarcity)
 * 
 * Formula: Z_adj = α × Z_league + (1-α) × Z_position
 */
function positionAdjustedZScore(
  stat: number,
  leagueMean: number,
  leagueStd: number,
  position: PositionGroup,
  statType: 'wOBA' | 'ISO' | 'AVG'
): number {
  // League Z-score (absolute context)
  const zLeague = zScore(stat, leagueMean, leagueStd);
  
  // Position Z-score (scarcity context)
  const posStats = POSITION_STATS_2025[position];
  let posMean: number;
  let posStd: number;
  
  switch (statType) {
    case 'wOBA':
      posMean = posStats.wOBA_mean;
      posStd = posStats.wOBA_std;
      break;
    case 'ISO':
      posMean = posStats.ISO_mean;
      posStd = posStats.ISO_std;
      break;
    case 'AVG':
      posMean = posStats.AVG_mean;
      posStd = posStats.AVG_std;
      break;
    default:
      posMean = leagueMean;
      posStd = leagueStd;
  }
  
  const zPosition = zScore(stat, posMean, posStd);
  
  // Blend: 70% league, 30% position
  return (POSITION_BLEND_FACTOR * zLeague) + ((1 - POSITION_BLEND_FACTOR) * zPosition);
}

/**
 * Calculate Z-score: (value - mean) / std_dev
 * Returns standard deviations above/below league average
 */
function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Convert Z-score to 0-100 scale
 * Z = 0 → 50 (league average)
 * Each 1.0 Z = 10 points (so Z=2.0 → 70, Z=-2.0 → 30)
 * Capped at 0-100
 */
function zScoreTo100(z: number, scaleFactor: number = 10): number {
  return Math.max(0, Math.min(100, 50 + z * scaleFactor));
}

// ============================================================================
// Pure Scoring Functions (Z-Score Based)
// ============================================================================

/**
 * Calculate hitting component score using POSITION-ADJUSTED Z-scores.
 * Based on wOBA with dual context: league (70%) + position (30%)
 * 
 * This gives catchers/shortstops credit for scarcity while keeping
 * absolute standards (bad hitters are still bad even at premium positions)
 */
function scoreHitting(
  features: DerivedFeatures['rates'],
  positionGroup: PositionGroup
): number {
  // Calculate wOBA
  let wOBA: number | null = null;
  
  if (features.opsLast30 !== null && features.onBasePctLast30 !== null) {
    const obp = features.onBasePctLast30;
    const slg = features.sluggingPctLast30 || 0;
    wOBA = 0.59 * obp + 0.41 * slg;
  } else if (features.battingAverageLast30 !== null) {
    // Fallback to batting average with position adjustment
    const avg = features.battingAverageLast30;
    const zAdj = positionAdjustedZScore(
      avg, 
      LEAGUE_AVG_2025.AVG, 
      LEAGUE_AVG_2025.AVG_std,
      positionGroup,
      'AVG'
    );
    return zScoreTo100(zAdj, 12);
  }
  
  if (wOBA === null) return 50;
  
  // Position-adjusted Z-score for wOBA
  const zAdj = positionAdjustedZScore(
    wOBA,
    LEAGUE_AVG_2025.wOBA,
    LEAGUE_AVG_2025.wOBA_std,
    positionGroup,
    'wOBA'
  );
  
  return zScoreTo100(zAdj, 10);
}

/**
 * Calculate power component score using POSITION-ADJUSTED Z-scores.
 * Based on ISO (isolated power) with dual context.
 * 
 * Power is less position-dependent than overall hitting, but still:
 * - 1B/DH are expected to have more power
 * - C/SS get credit for unexpected power
 */
function scorePower(
  features: DerivedFeatures['rates'],
  positionGroup: PositionGroup
): number {
  if (features.isoLast30 === null) return 50;
  
  const iso = features.isoLast30;
  const zAdj = positionAdjustedZScore(
    iso,
    LEAGUE_AVG_2025.ISO,
    LEAGUE_AVG_2025.ISO_std,
    positionGroup,
    'ISO'
  );
  
  // Power varies more, so use higher scale
  return zScoreTo100(zAdj, 12);
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
 * Calculate plate discipline component score using Z-scores.
 * Combines BB% (positive) and K% (negative, inverted).
 * Formula: Score = 50 + 10 * (Z(BB%) - Z(K%)) / 2
 */
function scorePlateDiscipline(features: DerivedFeatures['rates']): number {
  let bbZ = 0;
  let kZ = 0;
  let components = 0;
  
  // Walk rate (higher is better)
  if (features.walkRateLast30 !== null) {
    bbZ = zScore(features.walkRateLast30, LEAGUE_AVG_2025.BB_rate, LEAGUE_AVG_2025.BB_rate_std);
    components++;
  }
  
  // Strikeout rate (lower is better, so invert)
  if (features.strikeoutRateLast30 !== null) {
    kZ = -zScore(features.strikeoutRateLast30, LEAGUE_AVG_2025.K_rate, LEAGUE_AVG_2025.K_rate_std);
    components++;
  }
  
  if (components === 0) return 50;
  
  // Average the two Z-scores
  const combinedZ = (bbZ + kZ) / components;
  return zScoreTo100(combinedZ, 10);
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
 * Now includes position context for scarcity awareness.
 */
function generateExplanation(
  components: PlayerScore['components'],
  rates: DerivedFeatures['rates'],
  opportunity: DerivedFeatures['opportunity'],
  positionGroup: PositionGroup
): PlayerScore['explanation'] {
  const strengths: string[] = [];
  const concerns: string[] = [];

  // Position scarcity premium indicator
  const scarcityPositions: PositionGroup[] = ['C', 'SS', '2B'];
  const isScarcityPosition = scarcityPositions.includes(positionGroup);

  // Identify strengths
  if (components.hitting >= 75) {
    if (isScarcityPosition) {
      strengths.push(`Elite hitting for ${positionGroup} (scarcity premium)`);
    } else {
      strengths.push('Elite contact ability');
    }
  } else if (components.hitting >= 65) {
    strengths.push(isScarcityPosition ? `Strong bat for ${positionGroup}` : 'Above-average hitter');
  }

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

  // Position-aware summary
  if (avgComponent >= 70) {
    summary = isScarcityPosition 
      ? `Elite ${positionGroup} - rare combination of defense and offense` 
      : 'Elite fantasy asset across multiple categories';
  } else if (avgComponent >= 60) {
    summary = isScarcityPosition
      ? `Strong ${positionGroup} with offensive value`
      : 'Solid fantasy contributor with defined strengths';
  } else if (avgComponent >= 50) {
    summary = 'Average fantasy value, situational use';
  } else if (avgComponent >= 40) {
    summary = 'Limited fantasy value, high risk';
  } else {
    summary = 'Not currently fantasy relevant';
  }

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
      position: positionGroup,
      positionScarcity: isScarcityPosition ? 'high' : 'standard',
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

  // Determine primary position for scarcity calculations
  const positionGroup = getPositionGroup(features.replacement?.positionEligibility || ['OF']);

  // Calculate component scores with POSITION-ADJUSTED Z-scores
  const components: PlayerScore['components'] = {
    hitting: Math.round(scoreHitting(features.rates, positionGroup)),
    power: Math.round(scorePower(features.rates, positionGroup)),
    speed: Math.round(scoreSpeed(features.volume)),
    plateDiscipline: Math.round(scorePlateDiscipline(features.rates)),
    consistency: Math.round(scoreConsistency(features.volatility)),
    opportunity: Math.round(scoreOpportunity(features.opportunity, features.volume)),
  };
  
  // Store position context for explanation
  const positionContext = positionGroup;

  // Calculate weighted overall value (component scores are already 0-100)
  const rawOverallValue = Math.round(
    components.hitting * weights.hitting +
    components.power * weights.power +
    components.speed * weights.speed +
    components.plateDiscipline * weights.plateDiscipline +
    components.consistency * weights.consistency +
    components.opportunity * weights.opportunity
  );

  // Apply confidence-based regression to the mean
  // Small samples are regressed toward league average (50), not capped
  // Formula: score = (raw × confidence) + (50 × (1 - confidence))
  const pa = features.volume.plateAppearancesLast30;
  let sampleConfidence: number;
  if (pa >= 120) sampleConfidence = 1.0;      // Full confidence
  else if (pa >= 80) sampleConfidence = 0.90; // High confidence
  else if (pa >= 50) sampleConfidence = 0.75; // Good confidence
  else if (pa >= 30) sampleConfidence = 0.60; // Moderate confidence
  else sampleConfidence = 0.45;               // Low confidence - heavily regressed

  // Regress toward league average (50) based on sample size
  const leagueAverage = 50;
  const overallValue = Math.round(
    (rawOverallValue * sampleConfidence) + (leagueAverage * (1 - sampleConfidence))
  );

  // Calculate confidence for display/explanation purposes
  const { confidence: statConfidence, sampleSize } = calculateConfidence(
    features.stabilization,
    features.volume
  );

  // Combined confidence includes both statistical reliability and sample size
  const confidence = Math.round((statConfidence + sampleConfidence) / 2 * 100) / 100;

  // Generate explanation with position context
  const explanation = generateExplanation(components, features.rates, features.opportunity, positionGroup);

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
