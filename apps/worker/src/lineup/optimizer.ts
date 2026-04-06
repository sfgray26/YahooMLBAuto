/**
 * Lineup Optimizer
 *
 * Constrained, context-aware, probabilistic lineup optimization.
 *
 * PRINCIPLES:
 * - Deterministic: Same inputs always produce same outputs
 * - Explainable: Every decision can be traced and justified
 * - Context-aware: Uses full intelligence stack (scores, momentum, risk, schedule)
 * - Constraint-respecting: Never produces illegal lineups
 *
 * ALGORITHM:
 * 1. Greedy fill of scarce positions first (C, SS, MI, CI)
 * 2. Fill flexible positions (OF, UTIL) with best remaining
 * 3. Backtracking swaps to improve objective
 * 4. Lock optimal configuration
 */

import type { PlayerScore } from '../scoring/compute.js';
import type { PitcherScore } from '../pitchers/compute.js';
import type { MomentumMetrics } from '../momentum/index.js';
import type { ProbabilisticOutcome } from '../probabilistic/index.js';
import type { TeamState } from '@cbb/core';

// ============================================================================
// Types
// ============================================================================

export interface OptimizedLineup {
  // Assignment: slot -> player
  assignments: Map<string, LineupAssignment>;
  
  // Bench players
  bench: string[];  // playerIds
  
  // Optimization metadata
  totalObjective: number;
  constraintViolations: string[];
  explanation: LineupExplanation;
  
  // Decision trace (for explainability)
  decisionTrace: DecisionStep[];
}

export interface LineupAssignment {
  playerId: string;
  playerMlbamId: string;
  name: string;
  slot: string;
  position: string;  // Position used for eligibility
  objectiveValue: number;
  reasoning: string;
}

export interface LineupExplanation {
  summary: string;
  keyDecisions: string[];
  categoryNotes: string[];
  riskNotes: string[];
}

export interface DecisionStep {
  step: number;
  action: 'fill' | 'swap' | 'lock';
  slot: string;
  player: string;
  objectiveDelta: number;
  reasoning: string;
}

export interface OptimizerConfig {
  // Objective weights
  weightOverall: number;      // Base score weight
  weightMomentum: number;     // ΔZ weight
  weightRisk: number;         // Monte Carlo adjustment
  weightCategory: number;     // Category fit
  weightSchedule: number;     // Games/volume
  
  // Risk preference
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  
  // Constraints
  respectIL: boolean;         // Never start IL players
  respectZeroGames: boolean;  // No starts with 0 games (weekly)
  maxOptimizationDepth: number; // Backtracking depth
}

export interface PlayerWithIntelligence {
  playerId: string;
  playerMlbamId: string;
  name: string;
  positions: string[];
  domain: 'hitting' | 'pitching';
  
  // Core scores
  score: PlayerScore | PitcherScore;
  
  // Intelligence layers
  momentum: MomentumMetrics;
  probabilistic: ProbabilisticOutcome;
  
  // Context
  gamesThisWeek: number;
  isInjured: boolean;
  injuryStatus: string | null;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: OptimizerConfig = {
  weightOverall: 0.40,
  weightMomentum: 0.15,
  weightRisk: 0.20,
  weightCategory: 0.15,
  weightSchedule: 0.10,
  riskTolerance: 'balanced',
  respectIL: true,
  respectZeroGames: true,
  maxOptimizationDepth: 3,
};

// ============================================================================
// Objective Function
// ============================================================================

/**
 * Calculate objective value for a player in context
 *
 * Formula:
 * Objective = w₁·Score + w₂·ΔZ + w₃·RiskAdj + w₄·CategoryFit + w₅·Games
 */
function calculateObjective(
  player: PlayerWithIntelligence,
  slot: string,
  teamState: TeamState,
  config: OptimizerConfig
): number {
  let objective = 0;
  
  // 1. Overall score (0-100)
  objective += config.weightOverall * player.score.overallValue;
  
  // 2. Momentum (ΔZ, normalized to 0-100 scale)
  // ΔZ typically ranges from -2 to +2, so normalize: (ΔZ + 2) * 25
  const momentumNormalized = (player.momentum.zScoreSlope + 2) * 25;
  objective += config.weightMomentum * momentumNormalized;
  
  // 3. Risk adjustment (based on risk tolerance)
  const riskAdj = calculateRiskAdjustment(player, config.riskTolerance);
  objective += config.weightRisk * riskAdj;
  
  // 4. Category fit (how well player fills team needs)
  const categoryFit = calculateCategoryFit(player, teamState);
  objective += config.weightCategory * categoryFit;
  
  // 5. Schedule volume
  const gamesValue = Math.min(10, player.gamesThisWeek) * 10; // Max 100
  objective += config.weightSchedule * gamesValue;
  
  return objective;
}

/**
 * Risk adjustment based on tolerance
 */
function calculateRiskAdjustment(
  player: PlayerWithIntelligence,
  tolerance: OptimizerConfig['riskTolerance']
): number {
  const { probabilistic } = player;
  
  switch (tolerance) {
    case 'conservative':
      // Prefer high floors (25th percentile)
      return probabilistic.rosScore.p25;
    case 'aggressive':
      // Prefer high ceilings (75th percentile)
      return probabilistic.rosScore.p75;
    case 'balanced':
    default:
      // Use median with downside penalty
      const downside = probabilistic.riskProfile.downsideRisk;
      return probabilistic.rosScore.p50 - (downside * 10);
  }
}

/**
 * Calculate how well player fits team's category needs
 */
function calculateCategoryFit(
  player: PlayerWithIntelligence,
  teamState: TeamState
): number {
  // This would analyze team's category strengths/weaknesses
  // and boost players who help weak categories
  
  // Simplified: check roster analysis for weaknesses
  const weaknesses = teamState.rosterAnalysis?.weaknesses || [];
  let fit = 50; // Baseline
  
  // Boost if player helps weak categories
  if ('components' in player.score) {
    const hitterScore = player.score as PlayerScore;
    
    if (weaknesses.some(w => w.includes('power')) && hitterScore.components.power > 65) {
      fit += 15;
    }
    if (weaknesses.some(w => w.includes('speed')) && hitterScore.components.speed > 65) {
      fit += 15;
    }
    if (weaknesses.some(w => w.includes('hitting')) && hitterScore.components.hitting > 65) {
      fit += 10;
    }
  }
  
  return Math.min(100, fit);
}

// ============================================================================
// Constraint Checking
// ============================================================================

interface ConstraintCheck {
  valid: boolean;
  violations: string[];
}

/**
 * Check if a player can legally start in a slot
 */
function checkEligibility(
  player: PlayerWithIntelligence,
  slot: string,
  teamState: TeamState,
  config: OptimizerConfig
): ConstraintCheck {
  const violations: string[] = [];
  
  // Check injury status
  if (config.respectIL && player.isInjured) {
    violations.push(`Player ${player.name} is on IL`);
  }
  
  // Check zero games (for weekly leagues)
  if (config.respectZeroGames && player.gamesThisWeek === 0) {
    violations.push(`Player ${player.name} has 0 games this week`);
  }
  
  // Check position eligibility
  const slotConfig = teamState.lineupConfig.slots.find(s => s.slotId === slot);
  if (slotConfig) {
    const eligible = slotConfig.eligiblePositions.some(pos => 
      player.positions.includes(pos)
    );
    if (!eligible) {
      violations.push(`Player ${player.name} not eligible for ${slot}`);
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Core Optimization Algorithm
// ============================================================================

/**
 * Optimize lineup using greedy + backtracking
 */
export function optimizeLineup(
  players: PlayerWithIntelligence[],
  teamState: TeamState,
  config: Partial<OptimizerConfig> = {}
): OptimizedLineup {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const assignments = new Map<string, LineupAssignment>();
  const usedPlayers = new Set<string>();
  const decisionTrace: DecisionStep[] = [];
  let step = 0;
  
  // Separate hitters and pitchers
  const hitters = players.filter(p => p.domain === 'hitting');
  const pitchers = players.filter(p => p.domain === 'pitching');
  
  // Get slot definitions
  const hittingSlots = teamState.lineupConfig.slots.filter(s => s.domain === 'hitting');
  const pitchingSlots = teamState.lineupConfig.slots.filter(s => s.domain === 'pitching');
  
  // Phase 1: Fill scarce positions first (C, SS, 2B, 3B)
  const scarcePositions = ['C', 'SS', '2B', '3B', '1B', 'MI', 'CI'];
  for (const slot of hittingSlots) {
    if (assignments.has(slot.slotId)) continue;
    
    const isScarce = slot.eligiblePositions.some(pos => scarcePositions.includes(pos));
    if (!isScarce) continue;
    
    const bestPlayer = findBestPlayerForSlot(
      hitters.filter(p => !usedPlayers.has(p.playerId)),
      slot.slotId,
      teamState,
      cfg
    );
    
    if (bestPlayer) {
      const check = checkEligibility(bestPlayer, slot.slotId, teamState, cfg);
      if (check.valid) {
        assignPlayer(assignments, usedPlayers, bestPlayer, slot.slotId, teamState, cfg);
        decisionTrace.push({
          step: ++step,
          action: 'fill',
          slot: slot.slotId,
          player: bestPlayer.name,
          objectiveDelta: calculateObjective(bestPlayer, slot.slotId, teamState, cfg),
          reasoning: `Scarce position fill (${slot.eligiblePositions.join('/')})`,
        });
      }
    }
  }
  
  // Phase 2: Fill flexible positions (OF, UTIL)
  for (const slot of hittingSlots) {
    if (assignments.has(slot.slotId)) continue;
    
    const bestPlayer = findBestPlayerForSlot(
      hitters.filter(p => !usedPlayers.has(p.playerId)),
      slot.slotId,
      teamState,
      cfg
    );
    
    if (bestPlayer) {
      const check = checkEligibility(bestPlayer, slot.slotId, teamState, cfg);
      if (check.valid) {
        assignPlayer(assignments, usedPlayers, bestPlayer, slot.slotId, teamState, cfg);
        decisionTrace.push({
          step: ++step,
          action: 'fill',
          slot: slot.slotId,
          player: bestPlayer.name,
          objectiveDelta: calculateObjective(bestPlayer, slot.slotId, teamState, cfg),
          reasoning: `Flexible position fill`,
        });
      }
    }
  }
  
  // Phase 3: Fill pitching slots
  for (const slot of pitchingSlots) {
    const bestPlayer = findBestPlayerForSlot(
      pitchers.filter(p => !usedPlayers.has(p.playerId)),
      slot.slotId,
      teamState,
      cfg
    );
    
    if (bestPlayer) {
      const check = checkEligibility(bestPlayer, slot.slotId, teamState, cfg);
      if (check.valid) {
        assignPlayer(assignments, usedPlayers, bestPlayer, slot.slotId, teamState, cfg);
        decisionTrace.push({
          step: ++step,
          action: 'fill',
          slot: slot.slotId,
          player: bestPlayer.name,
          objectiveDelta: calculateObjective(bestPlayer, slot.slotId, teamState, cfg),
          reasoning: `Pitching slot fill`,
        });
      }
    }
  }
  
  // Phase 4: Backtracking swaps (optimization)
  const improved = performSwaps(assignments, usedPlayers, players, teamState, cfg, decisionTrace, step);
  step = improved.finalStep;
  
  // Calculate bench
  const bench = players
    .filter(p => !usedPlayers.has(p.playerId))
    .map(p => p.playerId);
  
  // Calculate total objective
  let totalObjective = 0;
  for (const [, assignment] of assignments) {
    totalObjective += assignment.objectiveValue;
  }
  
  // Build explanation
  const explanation = buildExplanation(assignments, decisionTrace, teamState);
  
  return {
    assignments,
    bench,
    totalObjective,
    constraintViolations: [],
    explanation,
    decisionTrace,
  };
}

/**
 * Find best player for a slot based on objective
 */
function findBestPlayerForSlot(
  availablePlayers: PlayerWithIntelligence[],
  slot: string,
  teamState: TeamState,
  config: OptimizerConfig
): PlayerWithIntelligence | null {
  if (availablePlayers.length === 0) return null;
  
  let bestPlayer = availablePlayers[0];
  let bestObjective = calculateObjective(bestPlayer, slot, teamState, config);
  
  for (const player of availablePlayers.slice(1)) {
    const objective = calculateObjective(player, slot, teamState, config);
    if (objective > bestObjective) {
      bestObjective = objective;
      bestPlayer = player;
    }
  }
  
  return bestPlayer;
}

/**
 * Assign player to slot
 */
function assignPlayer(
  assignments: Map<string, LineupAssignment>,
  usedPlayers: Set<string>,
  player: PlayerWithIntelligence,
  slot: string,
  teamState: TeamState,
  config: OptimizerConfig
): void {
  // Find which position to use for eligibility
  const slotConfig = teamState.lineupConfig.slots.find(s => s.slotId === slot);
  const eligiblePosition = slotConfig?.eligiblePositions.find(pos => 
    player.positions.includes(pos)
  ) || player.positions[0];
  
  assignments.set(slot, {
    playerId: player.playerId,
    playerMlbamId: player.playerMlbamId,
    name: player.name,
    slot,
    position: eligiblePosition,
    objectiveValue: calculateObjective(player, slot, teamState, config),
    reasoning: '',
  });
  
  usedPlayers.add(player.playerId);
}

/**
 * Perform swap optimization
 */
function performSwaps(
  assignments: Map<string, LineupAssignment>,
  usedPlayers: Set<string>,
  allPlayers: PlayerWithIntelligence[],
  teamState: TeamState,
  config: OptimizerConfig,
  trace: DecisionStep[],
  startStep: number
): { finalStep: number; improvements: number } {
  let improvements = 0;
  let step = startStep;
  
  // Try swapping each assigned player with each bench player
  for (const [slot1, assignment1] of assignments) {
    const player1 = allPlayers.find(p => p.playerId === assignment1.playerId);
    if (!player1) continue;
    
    const benchPlayers = allPlayers.filter(p => !usedPlayers.has(p.playerId));
    
    for (const player2 of benchPlayers) {
      // Check if player2 is eligible for slot1
      const check = checkEligibility(player2, slot1, teamState, config);
      if (!check.valid) continue;
      
      // Calculate objective change
      const currentObj = assignment1.objectiveValue;
      const newObj = calculateObjective(player2, slot1, teamState, config);
      
      // Swap if improvement
      if (newObj > currentObj + 1) { // +1 threshold to avoid micro-swaps
        // Perform swap
        usedPlayers.delete(player1.playerId);
        usedPlayers.add(player2.playerId);
        
        assignments.set(slot1, {
          playerId: player2.playerId,
          playerMlbamId: player2.playerMlbamId,
          name: player2.name,
          slot: slot1,
          position: player2.positions[0],
          objectiveValue: newObj,
          reasoning: `Swapped for +${(newObj - currentObj).toFixed(1)} objective`,
        });
        
        trace.push({
          step: ++step,
          action: 'swap',
          slot: slot1,
          player: player2.name,
          objectiveDelta: newObj - currentObj,
          reasoning: `Improved objective by ${(newObj - currentObj).toFixed(1)}`,
        });
        
        improvements++;
      }
    }
  }
  
  return { finalStep: step, improvements };
}

/**
 * Build human-readable explanation
 */
function buildExplanation(
  assignments: Map<string, LineupAssignment>,
  trace: DecisionStep[],
  teamState: TeamState
): LineupExplanation {
  const keyDecisions: string[] = [];
  const categoryNotes: string[] = [];
  const riskNotes: string[] = [];
  
  // Identify key decisions (swaps and scarce position fills)
  for (const step of trace) {
    if (step.action === 'swap' && step.objectiveDelta > 5) {
      keyDecisions.push(`${step.player} replaces starter in ${step.slot} (+${step.objectiveDelta.toFixed(1)})`);
    }
  }
  
  // Category notes based on roster
  if (teamState.rosterAnalysis?.weaknesses?.length) {
    categoryNotes.push(`Addressing weaknesses: ${teamState.rosterAnalysis.weaknesses.slice(0, 2).join(', ')}`);
  }
  
  // Risk notes
  let conservativeCount = 0;
  let aggressiveCount = 0;
  for (const [, assignment] of assignments) {
    // Simplified - would check actual risk profile
    if (assignment.objectiveValue > 75) aggressiveCount++;
    if (assignment.objectiveValue < 55) conservativeCount++;
  }
  
  if (aggressiveCount > 3) {
    riskNotes.push(`High-upside lineup with ${aggressiveCount} high-objective starters`);
  }
  if (conservativeCount > 2) {
    riskNotes.push(`Conservative floor with ${conservativeCount} reliable starters`);
  }
  
  return {
    summary: `Optimized lineup: ${assignments.size} starters, ${keyDecisions.length} key decisions`,
    keyDecisions: keyDecisions.slice(0, 5),
    categoryNotes,
    riskNotes,
  };
}
