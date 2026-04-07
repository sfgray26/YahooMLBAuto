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
  type: 'K' | 'BB' | 'HBP' | 'OUT' | '1B' | '2B' | '3B' | 'HR';
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const workloadFactor = score.components.workload / 100;  // 0-1
  const recentAppearances = Math.max(
    1,
    score.role.currentRole === 'SP'
      ? features.volume.gamesStartedLast30 || features.volume.appearancesLast30
      : features.volume.appearancesLast30
  );
  const recentInningsPerAppearance = recentAppearances > 0
    ? features.volume.inningsPitchedLast30 / recentAppearances
    : null;

  let baselineInnings = score.role.currentRole === 'SP' ? 5.5 :
                        score.role.currentRole === 'SWING' ? 3.5 :
                        score.role.currentRole === 'CL' ? 1.0 : 1.25;

  if (recentInningsPerAppearance !== null && Number.isFinite(recentInningsPerAppearance) && recentInningsPerAppearance > 0) {
    baselineInnings = (baselineInnings * 0.35) + (recentInningsPerAppearance * 0.65);
  }

  let baseInnings = baselineInnings * (0.88 + workloadFactor * 0.24);

  const consistency = clamp(features.volatility.consistencyScore || 50, 25, 90);
  const variancePct = score.role.currentRole === 'SP'
    ? 0.10 + ((75 - consistency) / 400)
    : 0.18 + ((75 - consistency) / 300);
  const volatility = 1.0 + ((rng() - 0.5) * 2 * variancePct);
  let innings = baseInnings * volatility;
  
  // Hard floors/ceilings based on role
  if (score.role.currentRole === 'SP') {
    innings = Math.max(4.0, Math.min(8.0, innings));
  } else if (score.role.currentRole === 'CL') {
    innings = Math.max(0.1, Math.min(1.5, innings));
  } else if (score.role.currentRole === 'RP') {
    innings = Math.max(0.2, Math.min(2.2, innings));
  } else {
    innings = Math.max(1.0, Math.min(5.0, innings));
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
  const battersPerInning = 4.25;
  const kRate = clamp(rates.strikeoutRateLast30 ?? 0.22, 0.12, 0.40);
  const bbRate = clamp(rates.walkRateLast30 ?? 0.08, 0.03, 0.15);
  const hbpRate = 0.008;
  const whip = clamp(rates.whipLast30 ?? 1.30, 0.90, 1.75);
  const rawHitRate = clamp((whip / battersPerInning) - bbRate, 0.10, 0.30);
  const maxHitBudget = Math.max(0.08, 1 - kRate - bbRate - hbpRate - 0.48);
  const hitRate = Math.min(rawHitRate, maxHitBudget);

  const rawHrRate = clamp((rates.hrPer9 ?? 1.1) / (battersPerInning * 9), 0.005, 0.04);
  const hrRate = Math.min(rawHrRate, hitRate * 0.22);
  const nonHrHitRate = Math.max(0, hitRate - hrRate);

  const gbRatioMetric = rates.gbRatio ?? 0.95;
  const gbFraction = clamp(gbRatioMetric / (1 + gbRatioMetric), 0.30, 0.60);
  const airFraction = 1 - gbFraction;

  const tripleShare = clamp(0.01 + airFraction * 0.015, 0.01, 0.03);
  const doubleShare = clamp(0.17 + airFraction * 0.08, 0.14, 0.28);
  const singleShare = Math.max(0, 1 - doubleShare - tripleShare);

  const singleRate = nonHrHitRate * singleShare;
  const doubleRate = nonHrHitRate * doubleShare;
  const tripleRate = nonHrHitRate * tripleShare;
  const outRate = Math.max(0, 1 - kRate - bbRate - hbpRate - singleRate - doubleRate - tripleRate - hrRate);

  const probs = new Map<string, number>([
    ['K', kRate],
    ['BB', bbRate],
    ['HBP', hbpRate],
    ['1B', singleRate],
    ['2B', doubleRate],
    ['3B', tripleRate],
    ['HR', hrRate],
    ['OUT', outRate],
  ]);

  const total = Array.from(probs.values()).reduce((sum, value) => sum + value, 0);
  for (const [key, value] of probs) {
    probs.set(key, value / total);
  }

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
          return { type: 'K' };
        case 'BB':
          return { type: 'BB' };
        case 'HBP':
          return { type: 'HBP' };
        case '1B':
          return { type: '1B' };
        case '2B':
          return { type: '2B' };
        case '3B':
          return { type: '3B' };
        case 'HR':
          return { type: 'HR' };
        case 'OUT':
          return { type: 'OUT' };
        default:
          return { type: 'OUT' };
      }
    }
  }
  
   return { type: 'OUT' };
}

interface BaseState {
  first: boolean;
  second: boolean;
  third: boolean;
}

function countRunners(state: BaseState): number {
  return Number(state.first) + Number(state.second) + Number(state.third);
}

function advanceOnWalk(state: BaseState): number {
  let runs = 0;
  if (state.first && state.second && state.third) {
    runs++;
  }

  const newThird = state.third || (state.second && state.first);
  const newSecond = state.second || state.first;

  state.third = newThird;
  state.second = newSecond;
  state.first = true;

  return runs;
}

function advanceOnSingle(state: BaseState, rng: () => number): number {
  let runs = state.third ? 1 : 0;
  let newThird = false;
  let newSecond = false;

  if (state.second) {
    if (!state.first || rng() < 0.6) runs++;
    else newThird = true;
  }

  if (state.first) {
    if (rng() < 0.28) newThird = true;
    else newSecond = true;
  }

  state.first = true;
  state.second = newSecond;
  state.third = newThird;

  return runs;
}

function advanceOnDouble(state: BaseState, rng: () => number): number {
  let runs = Number(state.third) + Number(state.second);
  let newThird = false;

  if (state.first) {
    if (rng() < 0.55) runs++;
    else newThird = true;
  }

  state.first = false;
  state.second = true;
  state.third = newThird;

  return runs;
}

function advanceOnTriple(state: BaseState): number {
  const runs = countRunners(state);
  state.first = false;
  state.second = false;
  state.third = true;
  return runs;
}

function advanceOnHomeRun(state: BaseState): number {
  const runs = countRunners(state) + 1;
  state.first = false;
  state.second = false;
  state.third = false;
  return runs;
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
  const innings = simulateInnings(features, score, rng);
  const targetOuts = Math.max(3, Math.round(innings * 3));
  let battersFaced = 0;
  let outs = 0;
  let strikeouts = 0;
  let walks = 0;
  let hits = 0;
  let homeRuns = 0;
  let pitches = 0;
  let runs = 0;
  const bases: BaseState = { first: false, second: false, third: false };
  const maxBattersFaced = targetOuts + 24;

  while (outs < targetOuts && battersFaced < maxBattersFaced) {
    const outcome = simulatePA(probs, rng);
    battersFaced++;
    
    switch (outcome.type) {
      case 'K':
        strikeouts++;
        outs++;
        pitches += rng() < 0.65 ? 3 : 4;
        break;
      case 'OUT':
        outs++;
        pitches += rng() < 0.55 ? 2 : 3;
        break;
      case 'BB':
        walks++;
        runs += advanceOnWalk(bases);
        pitches += rng() < 0.45 ? 4 : 5;
        break;
      case 'HBP':
        runs += advanceOnWalk(bases);
        pitches += 3;
        break;
      case '1B':
        hits++;
        runs += advanceOnSingle(bases, rng);
        pitches += rng() < 0.55 ? 2 : 3;
        break;
      case '2B':
        hits++;
        runs += advanceOnDouble(bases, rng);
        pitches += rng() < 0.55 ? 2 : 3;
        break;
      case '3B':
        hits++;
        runs += advanceOnTriple(bases);
        pitches += 3;
        break;
      case 'HR':
        hits++;
        homeRuns++;
        runs += advanceOnHomeRun(bases);
        pitches += rng() < 0.55 ? 2 : 3;
        break;
    }
  }

  const completedInnings = outs / 3;
  const earnedRuns = runs;

  const qualityStart = completedInnings >= 6 && earnedRuns <= 3;
  const blowUp = earnedRuns >= 5;
  
  const win = runs <= 3 && rng() < 0.6;  // 60% win if allows <= 3 runs
  
  const save = score.role.isCloser && 
               completedInnings >= 0.2 && 
               runs <= (completedInnings <= 1 ? 1 : 3) &&
               rng() < 0.7;
  
  const ipPoints = completedInnings * 3;
  const kPoints = strikeouts * 1;
  const wPoints = win ? 5 : 0;
  const svPoints = save ? 5 : 0;
  const hldPoints = (score.role.holdsEligible && !save && completedInnings >= 0.2 && runs <= 1) ? 4 : 0;
  const erPoints = -earnedRuns * 2;
  const hPoints = -hits * 0.5;
  const bbPoints = -walks * 0.5;
  
  const fantasyPoints = ipPoints + kPoints + wPoints + svPoints + hldPoints + erPoints + hPoints + bbPoints;
  
  return {
    innings: completedInnings,
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
