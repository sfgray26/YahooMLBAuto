/**
 * Momentum & Streak Detection Layer
 *
 * Detects hot/cold streaks, breakouts, and collapse warnings using
 * Z-score slope: ΔZ = Z_14d - Z_30d
 *
 * This is the intelligence layer on top of time-decayed stats.
 */

import type { PlayerScore } from '../scoring/compute.js';
import type { PitcherScore } from '../pitchers/compute.js';

// ============================================================================
// Types
// ============================================================================

export interface MomentumMetrics {
  // Core momentum metric: Z-score slope
  zScoreSlope: number;           // ΔZ = Z_14d - Z_30d
  
  // Trend classification
  trend: 'surging' | 'hot' | 'stable' | 'cold' | 'collapsing';
  
  // Breakout/collapse detection
  breakoutSignal: boolean;       // Recent surge + low previous baseline
  collapseWarning: boolean;      // Recent drop + previously high
  
  // Volatility-adjusted momentum
  momentumReliability: 'high' | 'medium' | 'low'; // Based on sample size
  
  // Fantasy implications
  expectedRegression: 'up' | 'stable' | 'down';
  recommendation: 'buy' | 'hold' | 'sell' | 'avoid';
  
  // Raw context
  zScore14d: number;
  zScore30d: number;
  games14d: number;
  games30d: number;
}

export interface StreakInfo {
  isOnStreak: boolean;
  streakType: 'hot' | 'cold' | null;
  streakLength: number;          // Games
  streakDescription: string;
}

// ============================================================================
// Configuration
// ============================================================================

// Z-score slope thresholds
const MOMENTUM_THRESHOLDS = {
  surging: 0.8,      // Strong upward trend
  hot: 0.4,          // Moderate upward trend
  cold: -0.4,        // Moderate downward trend
  collapsing: -0.8,  // Strong downward trend
};

// Breakout detection: recent surge from low baseline
const BREAKOUT_CONFIG = {
  minZScoreSlope: 0.6,      // Must be trending up
  maxZScore30d: 0.5,        // Previous performance was mediocre
  minZScore14d: 0.8,        // Now performing well
};

// Collapse detection: recent drop from high baseline
const COLLAPSE_CONFIG = {
  minZScoreSlope: -0.6,     // Must be trending down (negative)
  minZScore30d: 0.8,        // Previous performance was strong
  maxZScore14d: 0.3,        // Now performing poorly
};

// ============================================================================
// Core Momentum Calculation
// ============================================================================

/**
 * Calculate Z-score slope (momentum)
 * 
 * Formula: ΔZ = Z_14d - Z_30d
 * 
 * Interpretation:
 * - Positive ΔZ: Improving (hot streak)
 * - Negative ΔZ: Declining (cold streak)
 * - Near zero: Stable
 */
export function calculateMomentum(
  zScore14d: number,
  zScore30d: number,
  games14d: number,
  games30d: number
): MomentumMetrics {
  // Calculate slope
  const zScoreSlope = zScore14d - zScore30d;
  
  // Determine trend
  let trend: MomentumMetrics['trend'];
  if (zScoreSlope >= MOMENTUM_THRESHOLDS.surging) {
    trend = 'surging';
  } else if (zScoreSlope >= MOMENTUM_THRESHOLDS.hot) {
    trend = 'hot';
  } else if (zScoreSlope <= MOMENTUM_THRESHOLDS.collapsing) {
    trend = 'collapsing';
  } else if (zScoreSlope <= MOMENTUM_THRESHOLDS.cold) {
    trend = 'cold';
  } else {
    trend = 'stable';
  }
  
  // Detect breakout (surge from mediocrity)
  const breakoutSignal = 
    zScoreSlope >= BREAKOUT_CONFIG.minZScoreSlope &&
    zScore30d <= BREAKOUT_CONFIG.maxZScore30d &&
    zScore14d >= BREAKOUT_CONFIG.minZScore14d;
  
  // Detect collapse (drop from excellence)
  const collapseWarning = 
    zScoreSlope <= -COLLAPSE_CONFIG.minZScoreSlope &&
    zScore30d >= COLLAPSE_CONFIG.minZScore30d &&
    zScore14d <= COLLAPSE_CONFIG.maxZScore14d;
  
  // Reliability based on sample size
  let momentumReliability: MomentumMetrics['momentumReliability'];
  if (games14d >= 12 && games30d >= 20) {
    momentumReliability = 'high';
  } else if (games14d >= 8 && games30d >= 15) {
    momentumReliability = 'medium';
  } else {
    momentumReliability = 'low';
  }
  
  // Expected regression direction
  let expectedRegression: MomentumMetrics['expectedRegression'];
  if (zScore14d > 1.5 && zScoreSlope > 0.3) {
    // Very hot and still rising - likely to cool off
    expectedRegression = 'down';
  } else if (zScore14d < -1.0 && zScoreSlope < -0.3) {
    // Very cold and falling - likely to bounce back
    expectedRegression = 'up';
  } else {
    expectedRegression = 'stable';
  }
  
  // Generate recommendation
  let recommendation: MomentumMetrics['recommendation'];
  if (breakoutSignal && momentumReliability !== 'low') {
    recommendation = 'buy';      // Breakout + reliable sample = buy
  } else if (collapseWarning) {
    recommendation = 'sell';     // Collapse warning = sell
  } else if (trend === 'surging' || trend === 'hot') {
    recommendation = 'hold';     // Riding the hot hand
  } else if (trend === 'collapsing') {
    recommendation = 'avoid';    // Stay away
  } else {
    recommendation = 'hold';     // Default
  }
  
  return {
    zScoreSlope,
    trend,
    breakoutSignal,
    collapseWarning,
    momentumReliability,
    expectedRegression,
    recommendation,
    zScore14d,
    zScore30d,
    games14d,
    games30d,
  };
}

// ============================================================================
// Streak Detection
// ============================================================================

/**
 * Detect if player is on a hot/cold streak
 * Based on recent game-to-game performance
 */
export function detectStreak(
  last10Games: { date: Date; woba: number; hits: number; pa: number }[],
  playerZScore: number
): StreakInfo {
  if (last10Games.length < 5) {
    return {
      isOnStreak: false,
      streakType: null,
      streakLength: 0,
      streakDescription: 'Insufficient games',
    };
  }
  
  // Count consecutive good/bad games
  let hotStreak = 0;
  let coldStreak = 0;
  let maxHot = 0;
  let maxCold = 0;
  
  for (const game of last10Games) {
    const gameValue = game.pa > 0 ? game.woba : 0;
    
    // Good game: wOBA > 0.350 (above average)
    if (gameValue > 0.350) {
      hotStreak++;
      coldStreak = 0;
      maxHot = Math.max(maxHot, hotStreak);
    }
    // Bad game: wOBA < 0.250 (below average)
    else if (gameValue < 0.250) {
      coldStreak++;
      hotStreak = 0;
      maxCold = Math.max(maxCold, coldStreak);
    }
    else {
      // Neutral game - reset both
      hotStreak = 0;
      coldStreak = 0;
    }
  }
  
  // Determine current streak
  const isHot = maxHot >= 3 && hotStreak >= 2;
  const isCold = maxCold >= 3 && coldStreak >= 2;
  
  if (isHot) {
    return {
      isOnStreak: true,
      streakType: 'hot',
      streakLength: hotStreak,
      streakDescription: `${hotStreak} game hot streak (${maxHot} of last 10 good)`,
    };
  }
  
  if (isCold) {
    return {
      isOnStreak: true,
      streakType: 'cold',
      streakLength: coldStreak,
      streakDescription: `${coldStreak} game cold streak (${maxCold} of last 10 poor)`,
    };
  }
  
  return {
    isOnStreak: false,
    streakType: null,
    streakLength: 0,
    streakDescription: 'No active streak',
  };
}

// ============================================================================
// Integration Helpers
// ============================================================================

/**
 * Extract Z-scores from PlayerScore for momentum calculation
 */
export function extractZScoresFromPlayerScore(score: PlayerScore): {
  zScore14d: number;
  zScore30d: number;
} {
  // Convert component scores back to Z-scores
  // Score = 50 + 10 * Z  =>  Z = (Score - 50) / 10
  const hittingZ = (score.components.hitting - 50) / 10;
  const powerZ = (score.components.power - 50) / 10;
  
  // Weighted average (hitting more important than power for overall)
  const zScore14d = hittingZ * 0.6 + powerZ * 0.4;
  
  // For now, estimate 30d Z from overall
  // In production, you'd store both 14d and 30d separately
  const overallZ = (score.overallValue - 50) / 10;
  const zScore30d = overallZ * 0.7; // 30d is slightly less volatile
  
  return { zScore14d, zScore30d };
}

/**
 * Format momentum for display
 */
export function formatMomentum(metrics: MomentumMetrics): string {
  const emoji = {
    surging: '🚀',
    hot: '🔥',
    stable: '➡️',
    cold: '❄️',
    collapsing: '📉',
  };
  
  const parts: string[] = [
    `${emoji[metrics.trend]} ${metrics.trend.toUpperCase()}`,
    `ΔZ=${metrics.zScoreSlope > 0 ? '+' : ''}${metrics.zScoreSlope.toFixed(2)}`,
    `[${metrics.momentumReliability} confidence]`,
  ];
  
  if (metrics.breakoutSignal) {
    parts.push('🚨 BREAKOUT');
  }
  if (metrics.collapseWarning) {
    parts.push('⚠️ COLLAPSE WARNING');
  }
  
  parts.push(`→ ${metrics.recommendation.toUpperCase()}`);
  
  return parts.join(' ');
}
