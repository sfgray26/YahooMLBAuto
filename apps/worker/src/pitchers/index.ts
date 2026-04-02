/**
 * Pitcher Module Index
 * 
 * Deterministic transformation: pitcher derived features → value scores.
 * Stateless, explainable, cacheable.
 * 
 * ARCHITECTURE NOTE: Pitchers are a PARALLEL domain to hitters.
 * Same identity, different performance model.
 */

export { scorePitcher, scorePitchers } from './compute.js';
export { batchScorePitchers, scoreSinglePitcher } from './orchestrator.js';
export { 
  computePitcherDerivedFeatures,
  type PitcherDerivedFeatures,
  type RawPitcherStats,
} from './derived.js';
export type { PitcherScore } from './compute.js';
export { 
  simulatePitcherOutcome, 
  simulatePitcherOutcomes,
  type PitcherOutcomeDistribution, 
  type PitcherSimulationConfig 
} from './monte-carlo.js';
export { PITCHER_DOMAIN_PRINCIPLES } from './PRINCIPLES.js';
