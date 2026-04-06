/**
 * Baseline Strategies
 *
 * Comparison strategies for backtesting:
 * - Naive: Simple highest-score approach
 * - Human Heuristic: Common fantasy logic
 * - Position-Only: Ignores momentum/risk
 */

import type {
  BaselineStrategy,
  WorldState,
  OptimizedLineup,
  LineupAssignment,
} from './types.js';
import type { PlayerWithIntelligence } from '../lineup/optimizer.js';
import type { TeamState } from '@cbb/core';

// ============================================================================
// Baseline A: Naive (Highest Raw Score)
// ============================================================================

/**
 * Naive baseline: Start highest raw scores, ignore:
 * - Position scarcity
 * - Momentum
 * - Risk
 * - Schedule
 */
export const NaiveBaseline: BaselineStrategy = {
  name: 'naive',
  description: 'Start highest raw scores, ignore all context',
  
  selectLineup(worldState: WorldState): OptimizedLineup {
    const assignments = new Map<string, LineupAssignment>();
    const usedPlayers = new Set<string>();
    
    // Sort all players by raw score
    const sortedPlayers = [...worldState.roster.players]
      .filter(p => p.score)
      .sort((a, b) => (b.score?.overallValue || 0) - (a.score?.overallValue || 0));
    
    // Fill slots greedily by score
    for (const slot of worldState.roster.lineupConfig.slots) {
      // Find highest-scoring eligible player
      for (const player of sortedPlayers) {
        if (usedPlayers.has(player.playerId)) continue;
        
        // Check eligibility
        const isEligible = slot.eligiblePositions.some(pos => 
          player.positions.includes(pos)
        );
        
        if (isEligible) {
          assignments.set(slot.slotId, {
            playerId: player.playerId,
            playerMlbamId: player.playerMlbamId,
            name: player.name,
            slot: slot.slotId,
            position: player.positions[0],
            objectiveValue: player.score?.overallValue || 0,
            reasoning: 'Highest raw score',
          });
          usedPlayers.add(player.playerId);
          break;
        }
      }
    }
    
    const bench = worldState.roster.players
      .filter(p => !usedPlayers.has(p.playerId))
      .map(p => p.playerId);
    
    return {
      assignments,
      bench,
      totalObjective: 0,
      constraintViolations: [],
      explanation: {
        summary: 'Naive baseline: highest raw scores',
        keyDecisions: [],
        categoryNotes: [],
        riskNotes: [],
      },
      decisionTrace: [],
    };
  },
};

// ============================================================================
// Baseline B: Human Heuristic
// ============================================================================

/**
 * Human heuristic baseline: Start highest score at each position
 * with basic rules:
 * - Avoid injured players
 * - Prefer players with more games
 */
export const HumanHeuristicBaseline: BaselineStrategy = {
  name: 'human_heuristic',
  description: 'Common fantasy logic: avoid injuries, prefer volume',
  
  selectLineup(worldState: WorldState): OptimizedLineup {
    const assignments = new Map<string, LineupAssignment>();
    const usedPlayers = new Set<string>();
    
    // Convert to PlayerWithIntelligence-like structure
    const players = worldState.roster.players.map(p => ({
      ...p,
      gamesThisWeek: estimateGamesThisWeek(p.playerId, worldState),
      isInjured: worldState.injuries.get(p.playerId)?.isInjured || false,
    }));
    
    // Score with penalty for injury and zero games
    const scoredPlayers = players.map(p => {
      let score = p.score?.overallValue || 0;
      if (p.isInjured) score -= 50;  // Heavy penalty
      if (p.gamesThisWeek === 0) score -= 30;
      return { ...p, adjustedScore: score };
    });
    
    // Sort by adjusted score
    scoredPlayers.sort((a, b) => b.adjustedScore - a.adjustedScore);
    
    // Fill slots
    for (const slot of worldState.roster.lineupConfig.slots) {
      for (const player of scoredPlayers) {
        if (usedPlayers.has(player.playerId)) continue;
        
        const isEligible = slot.eligiblePositions.some(pos => 
          player.positions.includes(pos)
        );
        
        if (isEligible) {
          const reasons: string[] = [];
          if (player.isInjured) reasons.push('AVOIDED: injured');
          else if (player.gamesThisWeek === 0) reasons.push('AVOIDED: no games');
          else reasons.push('High score + available');
          
          assignments.set(slot.slotId, {
            playerId: player.playerId,
            playerMlbamId: player.playerMlbamId,
            name: player.name,
            slot: slot.slotId,
            position: player.positions[0],
            objectiveValue: player.adjustedScore,
            reasoning: reasons.join(', '),
          });
          usedPlayers.add(player.playerId);
          break;
        }
      }
    }
    
    const bench = worldState.roster.players
      .filter(p => !usedPlayers.has(p.playerId))
      .map(p => p.playerId);
    
    return {
      assignments,
      bench,
      totalObjective: 0,
      constraintViolations: [],
      explanation: {
        summary: 'Human heuristic: avoid injuries, prefer volume',
        keyDecisions: [],
        categoryNotes: [],
        riskNotes: [],
      },
      decisionTrace: [],
    };
  },
};

// ============================================================================
// Baseline C: Position-Only (No Intelligence)
// ============================================================================

/**
 * Position-only baseline: Only considers position scarcity
 * Ignores momentum, risk, Monte Carlo
 */
export const PositionOnlyBaseline: BaselineStrategy = {
  name: 'position_only',
  description: 'Position scarcity only, ignore momentum/risk',
  
  selectLineup(worldState: WorldState): OptimizedLineup {
    const assignments = new Map<string, LineupAssignment>();
    const usedPlayers = new Set<string>();
    
    const players = worldState.roster.players.filter(p => p.score);
    
    // Scarce positions first
    const scarceOrder = ['C', 'SS', '2B', '3B', 'MI', 'CI', '1B', 'OF', 'UTIL'];
    
    for (const scarcity of scarceOrder) {
      const slots = worldState.roster.lineupConfig.slots.filter(s => 
        s.eligiblePositions.includes(scarcity as any) &&
        !assignments.has(s.slotId)
      );
      
      for (const slot of slots) {
        // Find best eligible player
        const eligiblePlayers = players.filter(p => 
          !usedPlayers.has(p.playerId) &&
          p.positions.includes(scarcity)
        );
        
        if (eligiblePlayers.length > 0) {
          // Sort by raw score
          eligiblePlayers.sort((a, b) => 
            (b.score?.overallValue || 0) - (a.score?.overallValue || 0)
          );
          
          const best = eligiblePlayers[0];
          assignments.set(slot.slotId, {
            playerId: best.playerId,
            playerMlbamId: best.playerMlbamId,
            name: best.name,
            slot: slot.slotId,
            position: scarcity,
            objectiveValue: best.score?.overallValue || 0,
            reasoning: `Position scarcity: ${scarcity}`,
          });
          usedPlayers.add(best.playerId);
        }
      }
    }
    
    const bench = worldState.roster.players
      .filter(p => !usedPlayers.has(p.playerId))
      .map(p => p.playerId);
    
    return {
      assignments,
      bench,
      totalObjective: 0,
      constraintViolations: [],
      explanation: {
        summary: 'Position-only: scarce positions first',
        keyDecisions: [],
        categoryNotes: [],
        riskNotes: [],
      },
      decisionTrace: [],
    };
  },
};

// ============================================================================
// Baseline D: Last Year's Actual Lineups (if available)
// ============================================================================

/**
 * Historical baseline: Replay actual lineup decisions from last year
 */
export function createHistoricalBaseline(
  actualLineups: Map<string, string[]>  // date -> playerIds
): BaselineStrategy {
  return {
    name: 'historical_actual',
    description: 'Actual lineup decisions from last year',
    
    selectLineup(worldState: WorldState): OptimizedLineup {
      const date = worldState.date;
      const actualPlayerIds = actualLineups.get(date) || [];
      
      const assignments = new Map<string, LineupAssignment>();
      const usedPlayers = new Set<string>();
      
      // Try to match actual lineup to slots
      for (const slot of worldState.roster.lineupConfig.slots) {
        for (const playerId of actualPlayerIds) {
          if (usedPlayers.has(playerId)) continue;
          
          const player = worldState.roster.players.find(p => p.playerId === playerId);
          if (!player) continue;
          
          const isEligible = slot.eligiblePositions.some(pos => 
            player.positions.includes(pos)
          );
          
          if (isEligible) {
            assignments.set(slot.slotId, {
              playerId: player.playerId,
              playerMlbamId: player.playerMlbamId,
              name: player.name,
              slot: slot.slotId,
              position: player.positions[0],
              objectiveValue: player.score?.overallValue || 0,
              reasoning: 'Actual historical decision',
            });
            usedPlayers.add(playerId);
            break;
          }
        }
      }
      
      const bench = worldState.roster.players
        .filter(p => !usedPlayers.has(p.playerId))
        .map(p => p.playerId);
      
      return {
        assignments,
        bench,
        totalObjective: 0,
        constraintViolations: [],
        explanation: {
          summary: 'Historical actual lineup',
          keyDecisions: [],
          categoryNotes: [],
          riskNotes: [],
        },
        decisionTrace: [],
      };
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Estimate games this week for a player
 */
function estimateGamesThisWeek(playerId: string, worldState: WorldState): number {
  // Check schedule for player's team
  // Simplified: assume 6 games for full-time players
  const games = worldState.gameLogs.get(playerId) || [];
  const recentGames = games.filter(g => {
    const gameDate = new Date(g.date);
    const daysAgo = (new Date(worldState.date).getTime() - gameDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 7;
  });
  
  return recentGames.length;
}

/**
 * All available baselines
 */
export const AllBaselines: BaselineStrategy[] = [
  NaiveBaseline,
  HumanHeuristicBaseline,
  PositionOnlyBaseline,
];
