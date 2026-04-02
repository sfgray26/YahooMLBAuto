/**
 * Pitcher Monte Carlo Simulation Layer
 * 
 * COMPONENT-BASED MODEL (Not binomial like hitters!)
 * 
 * Simulates pitcher outcomes by modeling:
 * 1. Innings volatility (how deep they go)
 * 2. Plate appearance outcomes (K, BB, GB, FB, HR)
 * 3. Fantasy points emerge naturally from the sequence
 * 
 * Key insight: Pitchers accumulate points through a sequence of discrete events.
 * We simulate the sequence, not assume the outcome.
 */

import type { PitcherScore } from './compute.js';
import type { PitcherDerivedFeatures } from './derived.js';

// ============================================================================
// Types
// ============================================================================

export interface PitcherSimulationConfig {
  runs: number;
  horizon: 'start' | 'week';  // Single start or weekly total
  randomSeed?: number;
}

export interface PitcherOutcomeDistribution {
  playerId: string;
  playerMlbamId: string;
  horizon: 'start' | 'week';
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

  // Pitcher-specific risk metrics
  blowUpRisk: number;        // Probability of disaster start (>5 ER)
  qualityStartRate: number;  // Probability of QS (6+ IP, 3- ER)
  winProbability: number;    // Probability of getting a win
  saveProbability: number;   // Probability of getting a save (closers)
  
  // Component breakdowns
  componentStats: {
    avgInnings: number;
    avgStrikeouts: number;
    avgWalks: number;
    avgHits: number;
    avgRuns: number;
    avgEarnedRuns: number;
  };

  // Risk metrics
  riskAdjustedValue: number;
  vsReplacementDelta: number;
  confidenceImpact: 'increase' | 'decrease' | 'neutral';
  confidenceDelta: number;

  // Explainability
  simulationNotes: string[];
}

// Component state for a single plate appearance outcome
interface PAOutcome {
  type: 'K' | 'BB' | 'HBP' | 'GB' | 'FB' | 'LD' | 'HR';
  baseAdvances: number;  // How many bases the batter got
  runsScored: number;    // Runs scored on this PA
}

// State of a single simulated appearance/start
interface PitcherAppearance {
  innings: number;
  battersFaced: number;
  strikeouts: number;
  walks: number;
  hits: number;
  homeRuns: number;
  runs: number;
  earnedRuns: number;
  pitches: number;
  qualityStart: boolean;
  blowUp: boolean;
  win: boolean;
  save: boolean;
  fantasyPoints: number;
}

// ============================================================================
// Seeded RNG
// ============================================================================

function createRNG(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Component Models
// ============================================================================

/**
 * Model innings pitched distribution.
 * Based on pitcher's workload score and recent patterns.
 * Returns innings pitched (can be fractional like 5.1 = 5 1/3)
 */
function simulateInnings(
  features: PitcherDerivedFeatures,
  score: PitcherScore,
  rng: () => number
): number {
  // Base innings from workload score
  const workloadFactor = score.components.workload / 100;  // 0-1
  
  // Expected innings based on role
  let baseInnings = score.role.currentRole === 'SP' ? 5.5 :
                    score.role.currentRole === 'SWING' ? 4.0 :
                    score.role.currentRole === 'CL' ? 1.0 : 1.5;
  
  // Adjust for workload (workhorses go deeper)
  baseInnings *= (0.8 + workloadFactor * 0.4);  // 0.8x to 1.2x multiplier
  
  // Volatility in innings (some starts are short)
  const volatility = 1.0 + (rng() - 0.5) * 0.5;  // ±25% variance
  let innings = baseInnings * volatility;
  
  // Hard floors/ceilings based on role
  if (score.role.currentRole === 'SP') {
    innings = Math.max(3.0, Math.min(8.0, innings));
  } else if (score.role.currentRole === 'CL') {
    innings = Math.max(0.1, Math.min(1.5, innings));
  }
  
  return Math.round(innings * 3) / 3;  // Round to thirds
}

/**
 * Generate per-PA outcome probabilities based on pitcher's rates.
 */
function getPAOutcomeProbabilities(
  features: PitcherDerivedFeatures
): Map<string, number> {
  const rates = features.rates;
  
  // Base probabilities (MLB averages as fallback)
  const kRate = rates.strikeoutRateLast30 ?? 0.22;
  const bbRate = rates.walkRateLast30 ?? 0.08;
  const swStrRate = rates.swingingStrikeRate ?? 0.10;
  const gbRatio = rates.gbRatio ?? 0.45;
  
  // Estimate hit rate from WHIP (approximate)
  const whip = rates.whipLast30 ?? 1.30;
  const hitRate = Math.max(0.15, Math.min(0.30, (whip - bbRate) * 0.25));
  
  // HR rate from HR/9 (approximate)
  const hrPer9 = rates.hrPer9 ?? 1.2;
  const hrRate = (hrPer9 / 27) * 0.8;  // Convert to per-PA rate (rough)
  
  // Remaining is balls in play
  const bipRate = Math.max(0, 1 - kRate - bbRate - 0.01);  // 1% HBP estimate
  
  // Break down BIP into types
  const gbRate = bipRate * gbRatio;
  const fbRate = bipRate * (1 - gbRatio) * 0.6;  // 60% of non-GB are FB
  const ldRate = bipRate * (1 - gbRatio) * 0.4;  // 40% are LD
  
  // HR comes from FB
  const hrFromFb = Math.min(hrRate, fbRate * 0.12);  // ~12% of FB are HR
  const fbRateNoHr = fbRate - hrFromFb;
  
  const probs = new Map<string, number>([
    ['K', kRate],
    ['BB', bbRate],
    ['HBP', 0.01],
    ['GB', gbRate],
    ['FB', fbRateNoHr],
    ['LD', ldRate],
    ['HR', hrFromFb],
  ]);
  
  return probs;
}

/**
 * Simulate a single plate appearance.
 */
function simulatePA(
  probs: Map<string, number>,
  rng: () => number
): PAOutcome {
  const roll = rng();
  let cumulative = 0;
  
  for (const [type, prob] of probs) {
    cumulative += prob;
    if (roll <= cumulative) {
      // Determine outcome details based on type
      switch (type) {
        case 'K':
          return { type: 'K', baseAdvances: 0, runsScored: 0 };
        case 'BB':
          return { type: 'BB', baseAdvances: 1, runsScored: 0 };
        case 'HBP':
          return { type: 'HBP', baseAdvances: 1, runsScored: 0 };
        case 'GB':
          // Ground balls: mostly outs, some singles, occasional double
          const gbRoll = rng();
          if (gbRoll < 0.75) return { type: 'GB', baseAdvances: 0, runsScored: 0 };  // Out
          else if (gbRoll < 0.95) return { type: 'GB', baseAdvances: 1, runsScored: 0 };  // Single
          else return { type: 'GB', baseAdvances: 2, runsScored: 0 };  // Double
        case 'FB':
          // Fly balls: mix of outs and extra bases
          const fbRoll = rng();
          if (fbRoll < 0.70) return { type: 'FB', baseAdvances: 0, runsScored: 0 };  // Out
          else if (fbRoll < 0.85) return { type: 'FB', baseAdvances: 1, runsScored: 0 };  // Single
          else if (fbRoll < 0.95) return { type: 'FB', baseAdvances: 2, runsScored: 0 };  // Double
          else return { type: 'FB', baseAdvances: 3, runsScored: 0 };  // Triple (rare)
        case 'LD':
          // Line drives: more likely to be hits
          const ldRoll = rng();
          if (ldRoll < 0.35) return { type: 'LD', baseAdvances: 0, runsScored: 0 };  // Out
          else if (ldRoll < 0.80) return { type: 'LD', baseAdvances: 1, runsScored: 0 };  // Single
          else if (ldRoll < 0.95) return { type: 'LD', baseAdvances: 2, runsScored: 0 };  // Double
          else return { type: 'LD', baseAdvances: 3, runsScored: 0 };  // Triple
        case 'HR':
          return { type: 'HR', baseAdvances: 4, runsScored: 0 };  // Runs calculated separately
        default:
          return { type: 'GB', baseAdvances: 0, runsScored: 0 };
      }
    }
  }
  
  return { type: 'GB', baseAdvances: 0, runsScored: 0 };
}

/**
 * Simulate base runners and runs scored.
 * Simple base state machine.
 */
function simulateRuns(
  outcomes: PAOutcome[],
  rng: () => number
): { runs: number; hits: number } {
  // Base state: 0 = empty, 1 = runner on 1st, etc.
  let bases = 0;
  let runs = 0;
  let hits = 0;
  
  for (const outcome of outcomes) {
    if (outcome.type === 'HR') {
      // Home run scores all runners + batter
      runs += 1 + (bases > 0 ? 1 : 0) + (bases > 1 ? 1 : 0) + (bases > 2 ? 1 : 0);
      bases = 0;
      hits++;
    } else if (outcome.baseAdvances > 0) {
      // Hit or walk - advance runners
      hits++;
      
      // Simplified: advance all runners by baseAdvances
      // If runner would score, increment runs
      if (bases >= 4 - outcome.baseAdvances && bases > 0) {
        runs += Math.min(3, bases === 7 ? 3 : bases >= 4 ? 2 : 1);
      }
      
      // Update bases (simplified model)
      bases = (bases << outcome.baseAdvances) | (1 << (outcome.baseAdvances - 1));
      bases = bases & 0x7;  // Keep only 3 bases
    }
    // Outs just clear the base state eventually (simplified)
  }
  
  return { runs, hits };
}

/**
 * Simulate a single appearance/start from component models.
 * Returns full stat line and fantasy points.
 */
function simulateAppearance(
  features: PitcherDerivedFeatures,
  score: PitcherScore,
  probs: Map<string, number>,
  rng: () => number
): PitcherAppearance {
  // 1. Simulate innings
  const innings = simulateInnings(features, score, rng);
  
  // 2. Simulate plate appearances (approx 4.3 BF per inning)
  const bfPerInning = 4.3;
  const targetBF = Math.round(innings * bfPerInning);
  
  // 3. Simulate each PA
  const outcomes: PAOutcome[] = [];
  let battersFaced = 0;
  let outs = 0;
  let strikeouts = 0;
  let walks = 0;
  let hits = 0;
  let homeRuns = 0;
  let pitches = 0;
  
  while (battersFaced < targetBF && outs < Math.floor(innings * 3)) {
    const outcome = simulatePA(probs, rng);
    outcomes.push(outcome);
    battersFaced++;
    
    // Track stats
    if (outcome.type === 'K') {
      strikeouts++;
      outs++;
      pitches += rng() < 0.5 ? 3 : 4;  // Ks take 3-4 pitches
    } else if (outcome.type === 'BB' || outcome.type === 'HBP') {
      walks++;
      pitches += rng() < 0.5 ? 4 : 5;  // BBs take 4-5 pitches
    } else if (outcome.type === 'HR') {
      homeRuns++;
      hits++;
      pitches += rng() < 0.5 ? 2 : 3;  // HRs are quick
    } else {
      // BIP
      hits += outcome.baseAdvances > 0 ? 1 : 0;
      outs += outcome.baseAdvances === 0 ? 1 : 0;
      pitches += rng() < 0.5 ? 2 : 3;  // BIP takes 2-3 pitches
    }
  }
  
  // 4. Calculate runs from base state
  const { runs } = simulateRuns(outcomes, rng);
  const earnedRuns = Math.round(runs * 0.9);  // ~90% are earned
  
  // 5. Determine outcomes
  const qualityStart = innings >= 6 && earnedRuns <= 3;
  const blowUp = earnedRuns >= 5;
  
  // Win probability (simplified - based on runs allowed)
  const win = runs <= 3 && rng() < 0.6;  // 60% win if allows <= 3 runs
  
  // Save probability (for closers)
  const save = score.role.isCloser && 
               innings >= 0.2 && 
               runs <= (innings <= 1 ? 1 : 3) &&
               rng() < 0.7;
  
  // 6. Calculate fantasy points (standard 5x5 + holds)
  // Standard points: IP=3, K=1, W=5, L=-3, SV=5, HLD=4, ER=-2, H=-0.5, BB=-0.5
  const ipPoints = innings * 3;
  const kPoints = strikeouts * 1;
  const wPoints = win ? 5 : 0;
  const svPoints = save ? 5 : 0;
  const hldPoints = (score.role.holdsEligible && !save && innings >= 0.2 && runs <= 1) ? 4 : 0;
  const erPoints = -earnedRuns * 2;
  const hPoints = -hits * 0.5;
  const bbPoints = -walks * 0.5;
  
  const fantasyPoints = ipPoints + kPoints + wPoints + svPoints + hldPoints + erPoints + hPoints + bbPoints;
  
  return {
    innings,
    battersFaced,
    strikeouts,
    walks,
    hits,
    homeRuns,
    runs,
    earnedRuns,
    pitches,
    qualityStart,
    blowUp,
    win,
    save,
    fantasyPoints,
  };
}

/**
 * Simulate weekly outcomes for relievers (multiple appearances).
 */
function simulateWeeklyReliever(
  features: PitcherDerivedFeatures,
  score: PitcherScore,
  probs: Map<string, number>,
  rng: () => number
): PitcherAppearance {
  // Relievers typically appear 3-4 times per week
  const appearances = 3 + (rng() < 0.3 ? 1 : 0);
  
  const totals: PitcherAppearance = {
    innings: 0,
    battersFaced: 0,
    strikeouts: 0,
    walks: 0,
    hits: 0,
    homeRuns: 0,
    runs: 0,
    earnedRuns: 0,
    pitches: 0,
    qualityStart: false,  // Not applicable for relievers
    blowUp: false,
    win: false,
    save: false,
    fantasyPoints: 0,
  };
  
  let blowUps = 0;
  let wins = 0;
  let saves = 0;
  
  for (let i = 0; i < appearances; i++) {
    const app = simulateAppearance(features, score, probs, rng);
    
    totals.innings += app.innings;
    totals.battersFaced += app.battersFaced;
    totals.strikeouts += app.strikeouts;
    totals.walks += app.walks;
    totals.hits += app.hits;
    totals.homeRuns += app.homeRuns;
    totals.runs += app.runs;
    totals.earnedRuns += app.earnedRuns;
    totals.pitches += app.pitches;
    totals.fantasyPoints += app.fantasyPoints;
    
    if (app.blowUp) blowUps++;
    if (app.win) wins++;
    if (app.save) saves++;
  }
  
  totals.blowUp = blowUps > 0;  // Any blow-up is bad
  totals.win = wins > 0;
  totals.save = saves > 0;
  
  return totals;
}

// ============================================================================
// Main Simulation Function
// ============================================================================

/**
 * Core Monte Carlo simulation for pitchers.
 * 
 * COMPONENT-BASED MODEL:
 * - Simulates innings volatility
 * - Simulates plate appearance outcomes
 * - Fantasy points emerge naturally from sequence
 * - NOT a simple binomial like hitters
 */
export function simulatePitcherOutcome(
  features: PitcherDerivedFeatures,
  score: PitcherScore,
  config: PitcherSimulationConfig = { runs: 10_000, horizon: 'start' }
): PitcherOutcomeDistribution {
  const rng = createRNG(config.randomSeed ?? 12345);
  
  // Pre-compute PA outcome probabilities
  const probs = getPAOutcomeProbabilities(features);
  
  const outcomes: number[] = [];
  const componentStats: PitcherAppearance[] = [];
  
  // Run simulations
  for (let i = 0; i < config.runs; i++) {
    let appearance: PitcherAppearance;
    
    if (config.horizon === 'week' && score.role.currentRole !== 'SP') {
      // Relievers get weekly simulation (multiple appearances)
      appearance = simulateWeeklyReliever(features, score, probs, rng);
    } else {
      // Starters or single-appearance horizon
      appearance = simulateAppearance(features, score, probs, rng);
    }
    
    outcomes.push(appearance.fantasyPoints);
    componentStats.push(appearance);
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
    const bucket = Math.floor(o / 5) * 5;  // 5-point buckets
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
  
  // Aggregate component stats
  const avgComponentStats = {
    avgInnings: componentStats.reduce((s, c) => s + c.innings, 0) / componentStats.length,
    avgStrikeouts: componentStats.reduce((s, c) => s + c.strikeouts, 0) / componentStats.length,
    avgWalks: componentStats.reduce((s, c) => s + c.walks, 0) / componentStats.length,
    avgHits: componentStats.reduce((s, c) => s + c.hits, 0) / componentStats.length,
    avgRuns: componentStats.reduce((s, c) => s + c.runs, 0) / componentStats.length,
    avgEarnedRuns: componentStats.reduce((s, c) => s + c.earnedRuns, 0) / componentStats.length,
  };
  
  // Pitcher-specific risk metrics
  const blowUps = componentStats.filter(c => c.blowUp).length;
  const qualityStarts = componentStats.filter(c => c.qualityStart).length;
  const wins = componentStats.filter(c => c.win).length;
  const saves = componentStats.filter(c => c.save).length;
  
  const blowUpRisk = blowUps / componentStats.length;
  const qualityStartRate = qualityStarts / componentStats.length;
  const winProbability = wins / componentStats.length;
  const saveProbability = saves / componentStats.length;
  
  // Risk-adjusted value: penalize blow-up risk heavily
  const riskPenalty = blowUpRisk * 10;  // 10 point penalty per 10% blow-up rate
  const riskAdjustedValue = expectedValue - riskPenalty;
  
  // vs Replacement
  const replacementLevel = score.role.currentRole === 'SP' ? 25 :
                           score.role.isCloser ? 15 :
                           score.role.holdsEligible ? 12 : 8;
  const vsReplacementDelta = riskAdjustedValue - replacementLevel;
  
  // Confidence impact
  let confidenceImpact: 'increase' | 'decrease' | 'neutral' = 'neutral';
  let confidenceDelta = 0;
  
  if (blowUpRisk > 0.25 && p10 < 0) {
    // High blow-up risk with negative floor = decrease confidence
    confidenceImpact = 'decrease';
    confidenceDelta = -0.15;
  } else if (qualityStartRate > 0.50 && blowUpRisk < 0.15) {
    // Reliable QS pitcher = increase confidence
    confidenceImpact = 'increase';
    confidenceDelta = 0.08;
  }
  
  // Build notes
  const notes: string[] = [];
  notes.push(`Simulated ${config.runs.toLocaleString()} ${config.horizon} outcomes`);
  notes.push(`Expected: ${expectedValue.toFixed(1)} pts, StdDev: ${standardDeviation.toFixed(1)}`);
  notes.push(`Floor (p10): ${p10.toFixed(1)}, Ceiling (p90): ${p90.toFixed(1)}`);
  notes.push(`QS Rate: ${(qualityStartRate * 100).toFixed(0)}%, Blow-up Risk: ${(blowUpRisk * 100).toFixed(0)}%`);
  notes.push(`Avg: ${avgComponentStats.avgInnings.toFixed(1)} IP, ${avgComponentStats.avgStrikeouts.toFixed(1)} K`);
  
  if (score.role.isCloser) {
    notes.push(`Save Probability: ${(saveProbability * 100).toFixed(0)}%`);
  }
  
  if (confidenceImpact !== 'neutral') {
    notes.push(`Confidence ${confidenceImpact === 'increase' ? 'boosted' : 'reduced'} due to ${confidenceImpact === 'increase' ? 'reliability' : 'blow-up risk'}`);
  }
  
  return {
    playerId: features.playerId,
    playerMlbamId: features.playerMlbamId,
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
    blowUpRisk,
    qualityStartRate,
    winProbability,
    saveProbability,
    componentStats: avgComponentStats,
    riskAdjustedValue,
    vsReplacementDelta,
    confidenceImpact,
    confidenceDelta,
    simulationNotes: notes,
  };
}

/**
 * Batch simulation for multiple pitchers.
 */
export function simulatePitcherOutcomes(
  inputs: Array<{ features: PitcherDerivedFeatures; score: PitcherScore }>,
  config: Omit<PitcherSimulationConfig, 'randomSeed'> & { randomSeed?: number }
): Map<string, PitcherOutcomeDistribution> {
  const results = new Map<string, PitcherOutcomeDistribution>();
  let seed = config.randomSeed ?? 12345;
  
  for (const { features, score } of inputs) {
    const result = simulatePitcherOutcome(features, score, {
      ...config,
      randomSeed: seed++,
    });
    results.set(features.playerMlbamId, result);
  }
  
  return results;
}
