/**
 * Trade Simulator
 *
 * Runs Monte Carlo simulations comparing trade scenarios.
 * Simulates ROS outcomes with/without the trade to estimate probability distributions.
 */

import type { TradePlayer, WorldProjection, TradeEvaluatorConfig } from './types.js';
import type { ProbabilisticOutcome } from '../probabilistic/index.js';

export interface TradeSimulationResult {
  // Probability that trade improves your outcome
  winProbability: number;
  
  // Distribution of outcome changes
  outcomeDistribution: {
    p10: number;  // 10% chance of this outcome or worse
    p25: number;
    p50: number;  // Median expected outcome
    p75: number;
    p90: number;
  };
  
  // Scenario analysis
  scenarios: {
    bestCase: Scenario;
    expectedCase: Scenario;
    worstCase: Scenario;
  };
  
  // Category-specific probabilities
  categoryProbabilities: Record<string, CategoryProbability>;
}

export interface Scenario {
  description: string;
  yourGain: number;
  theirGain: number;
  netGain: number;
  probability: number;
}

export interface CategoryProbability {
  improvement: number;     // % chance you gain ground
  decline: number;         // % chance you lose ground
  magnitude: number;       // Expected change magnitude
}

/**
 * Run full trade simulation
 */
export function simulateTradeScenarios(
  playersYouGive: TradePlayer[],
  playersYouGet: TradePlayer[],
  config: TradeEvaluatorConfig,
  numRuns: number = 500
): TradeSimulationResult {
  const outcomes: number[] = [];
  const categoryOutcomes: Record<string, number[]> = {
    runs: [],
    homeRuns: [],
    rbi: [],
    sb: [],
    avg: [],
    ops: [],
    wins: [],
    saves: [],
    strikeouts: [],
    era: [],
    whip: [],
  };
  
  // Run simulations
  for (let i = 0; i < numRuns; i++) {
    const outcome = simulateSingleRun(playersYouGive, playersYouGet, config);
    outcomes.push(outcome.total);
    
    // Track category outcomes
    for (const [cat, value] of Object.entries(outcome.categories)) {
      if (categoryOutcomes[cat]) {
        categoryOutcomes[cat].push(value);
      }
    }
  }
  
  // Calculate statistics
  const sorted = outcomes.slice().sort((a, b) => a - b);
  const p10 = sorted[Math.floor(numRuns * 0.1)];
  const p25 = sorted[Math.floor(numRuns * 0.25)];
  const p50 = sorted[Math.floor(numRuns * 0.5)];
  const p75 = sorted[Math.floor(numRuns * 0.75)];
  const p90 = sorted[Math.floor(numRuns * 0.9)];
  
  // Calculate win probability
  const wins = outcomes.filter(o => o > 0).length;
  const winProbability = wins / numRuns;
  
  // Calculate category probabilities
  const categoryProbabilities: Record<string, CategoryProbability> = {};
  for (const [cat, values] of Object.entries(categoryOutcomes)) {
    const improvements = values.filter(v => v > 0).length;
    const declines = values.filter(v => v < 0).length;
    categoryProbabilities[cat] = {
      improvement: improvements / numRuns,
      decline: declines / numRuns,
      magnitude: values.reduce((a, b) => a + Math.abs(b), 0) / values.length,
    };
  }
  
  return {
    winProbability,
    outcomeDistribution: { p10, p25, p50, p75, p90 },
    scenarios: buildScenarios(sorted, numRuns, playersYouGive, playersYouGet),
    categoryProbabilities,
  };
}

interface SingleRunOutcome {
  total: number;
  categories: Record<string, number>;
}

function simulateSingleRun(
  give: TradePlayer[],
  get: TradePlayer[],
  config: TradeEvaluatorConfig
): SingleRunOutcome {
  const categories: Record<string, number> = {
    runs: 0,
    homeRuns: 0,
    rbi: 0,
    sb: 0,
    avg: 0,
    ops: 0,
    wins: 0,
    saves: 0,
    strikeouts: 0,
    era: 0,
    whip: 0,
  };
  
  let totalValue = 0;
  
  // Subtract outgoing players (sample from their distributions)
  for (const player of give) {
    if (!player.probabilistic) continue;
    
    const outcome = sampleFromDistribution(player.probabilistic);
    totalValue -= outcome.score;
    
    // Subtract category contributions
    for (const cat of Object.keys(categories)) {
      categories[cat] -= (outcome.categories[cat] || 0);
    }
  }
  
  // Add incoming players
  for (const player of get) {
    if (!player.probabilistic) continue;
    
    const outcome = sampleFromDistribution(player.probabilistic);
    totalValue += outcome.score;
    
    for (const cat of Object.keys(categories)) {
      categories[cat] += (outcome.categories[cat] || 0);
    }
  }
  
  return { total: totalValue, categories };
}

function sampleFromDistribution(probabilistic: ProbabilisticOutcome): {
  score: number;
  categories: Record<string, number>;
} {
  // Use P50 as base with noise scaled by volatility
  const volatility = probabilistic.riskProfile.volatility === 'high' ? 15 :
                     probabilistic.riskProfile.volatility === 'medium' ? 10 : 5;
  
  const noise = (Math.random() - 0.5) * 2 * volatility;
  const score = probabilistic.rosScore.p50 + noise;
  
  // Approximate category distribution
  const categories: Record<string, number> = {};
  const scoreRatio = score / probabilistic.rosScore.p50;
  
  // Simple proportional scaling
  for (const cat of ['runs', 'homeRuns', 'rbi', 'sb', 'wins', 'strikeouts']) {
    categories[cat] = 10 * scoreRatio * (0.8 + Math.random() * 0.4);
  }
  
  return { score: Math.max(0, Math.min(100, score)), categories };
}

function buildScenarios(
  sortedOutcomes: number[],
  numRuns: number,
  give: TradePlayer[],
  get: TradePlayer[]
): TradeSimulationResult['scenarios'] {
  const best = sortedOutcomes[sortedOutcomes.length - 1];
  const worst = sortedOutcomes[0];
  const expected = sortedOutcomes[Math.floor(numRuns * 0.5)];
  
  const giveNames = give.map(p => p.name.split(' ').pop()).join(', ');
  const getNames = get.map(p => p.name.split(' ').pop()).join(', ');
  
  return {
    bestCase: {
      description: `Best case: ${getNames} overperform, ${giveNames} regress`,
      yourGain: best,
      theirGain: -best * 0.3, // Assume they get some value
      netGain: best,
      probability: 0.1,
    },
    expectedCase: {
      description: `Expected: Players perform to projections`,
      yourGain: expected,
      theirGain: -expected * 0.5,
      netGain: expected,
      probability: 0.5,
    },
    worstCase: {
      description: `Worst case: ${getNames} underperform, ${giveNames} surge`,
      yourGain: worst,
      theirGain: -worst * 0.2,
      netGain: worst,
      probability: 0.1,
    },
  };
}

/**
 * Quick trade value estimate (no full simulation)
 */
export function quickTradeEstimate(
  playersYouGive: TradePlayer[],
  playersYouGet: TradePlayer[]
): { value: number; confidence: number } {
  let giveValue = 0;
  let getValue = 0;
  let totalConfidence = 0;
  
  for (const player of playersYouGive) {
    if (player.score) {
      giveValue += player.score.overallValue;
    }
    if (player.probabilistic) {
      totalConfidence += player.probabilistic.convergenceScore;
    }
  }
  
  for (const player of playersYouGet) {
    if (player.score) {
      getValue += player.score.overallValue;
    }
    if (player.probabilistic) {
      totalConfidence += player.probabilistic.convergenceScore;
    }
  }
  
  const totalPlayers = playersYouGive.length + playersYouGet.length;
  const avgConfidence = totalPlayers > 0 ? totalConfidence / totalPlayers : 0.5;
  
  return {
    value: getValue - giveValue,
    confidence: avgConfidence,
  };
}
