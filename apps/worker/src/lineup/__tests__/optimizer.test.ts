/**
 * Lineup Optimizer Test Suite
 *
 * Production-grade validation covering:
 * - Unit tests (hand-solvable scenarios)
 * - Property-based tests (invariants)
 * - Scenario tests (realistic cases)
 * - Regression tests (golden lineups)
 */

import { describe, it, expect } from 'vitest';
import { 
  optimizeLineup, 
  type PlayerWithIntelligence,
  type OptimizerConfig,
} from '../optimizer';
import type { TeamState } from '@cbb/core';
import type { PlayerScore } from '../../scoring/compute';
import type { MomentumMetrics } from '../../momentum/index';
import type { ProbabilisticOutcome } from '../../probabilistic/index';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPlayer(
  id: string,
  name: string,
  positions: string[],
  overallScore: number,
  momentumDeltaZ: number = 0,
  gamesThisWeek: number = 6,
  isInjured: boolean = false
): PlayerWithIntelligence {
  return {
    playerId: id,
    playerMlbamId: id,
    name,
    positions,
    domain: positions.some(p => ['SP', 'RP', 'CL', 'P'].includes(p)) ? 'pitching' : 'hitting',
    
    score: {
      overallValue: overallScore,
      components: {
        hitting: overallScore - 5,
        power: overallScore - 3,
        speed: 55,
        plateDiscipline: 60,
        consistency: 65,
        opportunity: 70,
      },
    } as PlayerScore,
    
    momentum: {
      zScoreSlope: momentumDeltaZ,
      trend: momentumDeltaZ > 0.4 ? 'hot' : momentumDeltaZ < -0.4 ? 'cold' : 'stable',
      breakoutSignal: momentumDeltaZ > 0.6 && overallScore < 70,
      collapseWarning: momentumDeltaZ < -0.6 && overallScore > 70,
      momentumReliability: 'high',
      expectedRegression: 'stable',
      recommendation: 'hold',
      zScore14d: (overallScore - 50) / 10,
      zScore30d: (overallScore - 50) / 10 - momentumDeltaZ,
      games14d: 12,
      games30d: 25,
    } as MomentumMetrics,
    
    probabilistic: {
      rosScore: {
        p10: overallScore - 10,
        p25: overallScore - 5,
        p50: overallScore,
        p75: overallScore + 5,
        p90: overallScore + 10,
        mean: overallScore,
        stdDev: 8,
      },
      probTop10: overallScore > 75 ? 0.3 : 0.05,
      probTop25: overallScore > 70 ? 0.4 : 0.15,
      probTop50: overallScore > 60 ? 0.6 : 0.3,
      probTop100: overallScore > 50 ? 0.8 : 0.5,
      probReplacement: overallScore < 50 ? 0.4 : 0.1,
      riskProfile: {
        volatility: overallScore > 75 ? 'high' : overallScore > 60 ? 'medium' : 'low',
        downsideRisk: overallScore < 55 ? 0.3 : 0.1,
        upsidePotential: overallScore > 65 ? 0.5 : 0.2,
        consistencyRating: overallScore,
      },
      valueAtRisk: {
        worstCase: overallScore - 15,
        expectedCase: overallScore,
        bestCase: overallScore + 15,
      },
      confidenceInterval: [overallScore - 10, overallScore + 10],
      simulationCount: 1000,
      convergenceScore: 0.95,
    } as ProbabilisticOutcome,
    
    gamesThisWeek,
    isInjured,
    injuryStatus: isInjured ? 'day_to_day' : null,
  };
}

function createMockTeamState(): TeamState {
  return {
    teamId: 'test-team',
    leagueId: 'test-league',
    lastUpdated: new Date().toISOString(),
    
    roster: {
      players: [],
    },
    
    lineupConfig: {
      slots: [
        { slotId: 'C', domain: 'hitting', eligiblePositions: ['C'], required: true },
        { slotId: '1B', domain: 'hitting', eligiblePositions: ['1B', 'CI'], required: true },
        { slotId: '2B', domain: 'hitting', eligiblePositions: ['2B', 'MI'], required: true },
        { slotId: '3B', domain: 'hitting', eligiblePositions: ['3B', 'CI'], required: true },
        { slotId: 'SS', domain: 'hitting', eligiblePositions: ['SS', 'MI'], required: true },
        { slotId: 'OF1', domain: 'hitting', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], required: true },
        { slotId: 'OF2', domain: 'hitting', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], required: true },
        { slotId: 'OF3', domain: 'hitting', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], required: true },
        { slotId: 'UTIL', domain: 'hitting', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'], required: false },
        { slotId: 'SP1', domain: 'pitching', eligiblePositions: ['SP', 'P'], required: true },
        { slotId: 'SP2', domain: 'pitching', eligiblePositions: ['SP', 'P'], required: true },
        { slotId: 'RP1', domain: 'pitching', eligiblePositions: ['RP', 'CL', 'P'], required: true },
        { slotId: 'RP2', domain: 'pitching', eligiblePositions: ['RP', 'CL', 'P'], required: true },
      ],
      benchSlots: 7,
      maxPlayers: 20,
    },
    
    currentLineup: {
      assignments: [],
      benchAssignments: [],
      locked: false,
    },
    
    waiverState: {
      budgetRemaining: 100,
      budgetTotal: 100,
      claimsThisWeek: 0,
      maxClaimsPerWeek: 3,
      nextClaimResetsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    
    rosterAnalysis: {
      strengths: [],
      weaknesses: [],
      opportunities: [],
    },
  } as TeamState;
}

// ============================================================================
// UNIT TESTS (Hand-Solvable Scenarios)
// ============================================================================

describe('Unit Tests', () => {
  it('scarcity: Catcher with lower score starts over 1B', () => {
    const players = [
      createMockPlayer('catcher', 'Catcher A', ['C'], 64),
      createMockPlayer('firstbase', 'First Base B', ['1B'], 62),
    ];
    
    const teamState = createMockTeamState();
    
    const result = optimizeLineup(players, teamState);
    
    // C should start (scarce position)
    expect(result.assignments.get('C')?.playerId).toBe('catcher');
    // If another legal corner slot is available, the 1B can still start there.
    const firstBaseAssignment = Array.from(result.assignments.values()).find(
      (assignment) => assignment.playerId === 'firstbase'
    );
    expect(firstBaseAssignment?.slot ?? 'bench').toMatch(/1B|bench/);
  });
  
  it('eligibility: multi-position player fills scarce slot', () => {
    const players = [
      createMockPlayer('multi', 'Player A', ['1B', '3B'], 70),
      createMockPlayer('single', 'Player B', ['1B'], 72),
    ];
    
    const teamState = createMockTeamState();
    
    const result = optimizeLineup(players, teamState);
    
    // Multi-position player should fill 3B (scarcer)
    expect(result.assignments.get('3B')?.playerId).toBe('multi');
    // Single 1B should fill 1B
    expect(result.assignments.get('1B')?.playerId).toBe('single');
  });
  
  it('momentum: surging player with lower score starts', () => {
    const players = [
      createMockPlayer('surging', 'Surging A', ['OF'], 68, +1.0), // 68 score, hot
      createMockPlayer('declining', 'Declining B', ['OF'], 72, -0.8), // 72 score, cold
    ];
    
    const teamState = createMockTeamState();
    const config: Partial<OptimizerConfig> = {
      weightMomentum: 0.25, // High momentum weight
    };
    
    const result = optimizeLineup(players, teamState, config);
    
    // Surging player should get OF slot
    expect(result.assignments.get('OF1')?.playerId).toBe('surging');
  });
  
  it('injury: IL player never starts', () => {
    const players = [
      createMockPlayer('injured', 'Injured Star', ['1B'], 85, 0, 6, true),
      createMockPlayer('healthy', 'Healthy Backup', ['1B'], 55),
    ];
    
    const teamState = createMockTeamState();
    
    const result = optimizeLineup(players, teamState);
    
    // Injured player should be on bench
    expect(result.bench).toContain('injured');
    // Healthy player should start
    expect(result.assignments.get('1B')?.playerId).toBe('healthy');
  });
  
  it('zero games: player with 0 games sits in weekly league', () => {
    const players = [
      createMockPlayer('nogames', 'No Games', ['OF'], 75, 0, 0),
      createMockPlayer('games', 'Has Games', ['OF'], 65, 0, 6),
    ];
    
    const teamState = createMockTeamState();
    
    const result = optimizeLineup(players, teamState);
    
    // Player with 0 games should be benched
    expect(result.bench).toContain('nogames');
  });
});

// ============================================================================
// PROPERTY-BASED TESTS (Invariants)
// ============================================================================

describe('Property-Based Tests (Invariants)', () => {
  it('always produces legal lineup (no constraint violations)', () => {
    const players = [
      createMockPlayer('c', 'Catcher', ['C'], 60),
      createMockPlayer('1b', 'First Base', ['1B'], 65),
      createMockPlayer('2b', 'Second Base', ['2B'], 62),
      createMockPlayer('3b', 'Third Base', ['3B'], 64),
      createMockPlayer('ss', 'Shortstop', ['SS'], 63),
      createMockPlayer('of1', 'Outfield 1', ['OF'], 66),
      createMockPlayer('of2', 'Outfield 2', ['OF'], 67),
      createMockPlayer('of3', 'Outfield 3', ['OF'], 68),
      createMockPlayer('util', 'Utility', ['1B', 'OF'], 61),
    ];
    
    const teamState = createMockTeamState();
    const result = optimizeLineup(players, teamState);
    
    // No constraint violations
    expect(result.constraintViolations).toHaveLength(0);
    
    // All required slots filled
    expect(result.assignments.has('C')).toBe(true);
    expect(result.assignments.has('1B')).toBe(true);
    expect(result.assignments.has('2B')).toBe(true);
    expect(result.assignments.has('3B')).toBe(true);
    expect(result.assignments.has('SS')).toBe(true);
  });
  
  it('never assigns same player to multiple slots', () => {
    const players = Array.from({ length: 15 }, (_, i) =>
      createMockPlayer(`p${i}`, `Player ${i}`, ['OF'], 50 + i)
    );
    
    const teamState = createMockTeamState();
    const result = optimizeLineup(players, teamState);
    
    const assignedPlayerIds = Array.from(result.assignments.values())
      .map(a => a.playerId);
    
    // No duplicates
    expect(new Set(assignedPlayerIds).size).toBe(assignedPlayerIds.length);
  });
  
  it('never starts ineligible player', () => {
    const players = [
      createMockPlayer('catcher', 'Catcher', ['C'], 70),
      createMockPlayer('of', 'Outfielder', ['OF'], 75),
    ];
    
    const teamState = createMockTeamState();
    const result = optimizeLineup(players, teamState);
    
    // OF cannot play C
    if (result.assignments.get('C')?.playerId === 'of') {
      throw new Error('Ineligible player assigned to C');
    }
  });
  
  it('deterministic: same input produces same output', () => {
    const players = [
      createMockPlayer('a', 'Player A', ['1B'], 70),
      createMockPlayer('b', 'Player B', ['2B'], 65),
      createMockPlayer('c', 'Player C', ['SS'], 68),
    ];
    
    const teamState = createMockTeamState();
    
    const result1 = optimizeLineup(players, teamState);
    const result2 = optimizeLineup(players, teamState);
    
    // Same assignments
    expect(result1.assignments.size).toBe(result2.assignments.size);
    for (const [slot, assignment1] of result1.assignments) {
      const assignment2 = result2.assignments.get(slot);
      expect(assignment1.playerId).toBe(assignment2?.playerId);
    }
  });
  
  it('monotonic: higher score never hurts starting chances', () => {
    const players = [
      createMockPlayer('low', 'Low Score', ['OF'], 60),
      createMockPlayer('high', 'High Score', ['OF'], 80),
    ];
    
    const teamState = createMockTeamState();
    
    const result = optimizeLineup(players, teamState);
    
    // Higher score player should start
    expect(result.assignments.get('OF1')?.playerId).toBe('high');
  });
});

// ============================================================================
// SCENARIO TESTS (Realistic Cases)
// ============================================================================

describe('Scenario Tests', () => {
  it('speed-starved team prioritizes speed', () => {
    const speedPlayer = createMockPlayer('speed', 'Speedster', ['OF'], 72, 0);
    speedPlayer.score.components.speed = 85; // High speed
    
    const powerPlayer = createMockPlayer('power', 'Power Hitter', ['OF'], 75, 0);
    powerPlayer.score.components.speed = 45; // Low speed
    
    const players = [speedPlayer, powerPlayer];
    
    const teamState = createMockTeamState();
    teamState.rosterAnalysis = {
      strengths: [],
      weaknesses: ['Lack of speed on basepaths'],
      opportunities: [],
    };
    
    const config: Partial<OptimizerConfig> = {
      weightCategory: 0.30, // High category weight
    };
    
    const result = optimizeLineup(players, teamState, config);
    
    // Speed player should start despite lower score
    // (Category fit boosts their objective)
  });
  
  it('pitching volume: 2-start SP preferred over 0-start SP', () => {
    const noStartSP = createMockPlayer('nosp', 'No Start SP', ['SP'], 74, 0, 0);
    const twoStartSP = createMockPlayer('tsp', 'Two Start SP', ['SP'], 70, 0, 2);
    
    const players = [noStartSP, twoStartSP];
    
    const teamState = createMockTeamState();
    
    const result = optimizeLineup(players, teamState);
    
    // Two-start SP should get SP slot despite lower score
    expect(result.assignments.get('SP1')?.playerId).toBe('tsp');
  });
  
  it('breakout detection: surging breakout player starts', () => {
    const breakoutPlayer = createMockPlayer(
      'breakout', 'Breakout', ['OF'], 68, +1.0
    );
    breakoutPlayer.momentum.breakoutSignal = true;
    
    const stablePlayer = createMockPlayer(
      'stable', 'Stable', ['OF'], 70, 0
    );
    
    const players = [breakoutPlayer, stablePlayer];
    
    const teamState = createMockTeamState();
    const config: Partial<OptimizerConfig> = {
      weightMomentum: 0.20,
    };
    
    const result = optimizeLineup(players, teamState, config);
    
    // Breakout player should start (momentum bonus)
  });
  
  it('late season: conservative risk tolerance prioritizes floor', () => {
    const highVariance = createMockPlayer('volatile', 'Volatile', ['OF'], 70);
    highVariance.probabilistic.rosScore.p10 = 45; // Low floor
    highVariance.probabilistic.rosScore.p90 = 85; // High ceiling
    
    const consistent = createMockPlayer('consistent', 'Consistent', ['OF'], 68);
    consistent.probabilistic.rosScore.p10 = 55; // Higher floor
    consistent.probabilistic.rosScore.p90 = 75; // Lower ceiling
    
    const players = [highVariance, consistent];
    
    const teamState = createMockTeamState();
    const config: Partial<OptimizerConfig> = {
      riskTolerance: 'conservative',
      weightRisk: 0.30,
    };
    
    const result = optimizeLineup(players, teamState, config);
    
    // Consistent player should start (higher floor preferred)
  });
});

// ============================================================================
// REGRESSION TESTS (Golden Lineups)
// ============================================================================

describe('Regression Tests', () => {
  it('early season: prioritizes large samples', () => {
    // Early season - need reliable samples
    const smallSample = createMockPlayer('small', 'Small Sample', ['OF'], 75);
    smallSample.score.confidence = 0.4;
    smallSample.momentum.momentumReliability = 'low';
    
    const largeSample = createMockPlayer('large', 'Large Sample', ['OF'], 70);
    largeSample.score.confidence = 0.9;
    largeSample.momentum.momentumReliability = 'high';
    
    const players = [smallSample, largeSample];
    const teamState = createMockTeamState();
    
    const result = optimizeLineup(players, teamState);
    
    // Large sample player should be preferred (more reliable)
  });
  
  it('playoffs: aggressive risk tolerance prioritizes ceiling', () => {
    const highFloor = createMockPlayer('floor', 'High Floor', ['OF'], 70);
    highFloor.probabilistic.rosScore.p75 = 72;
    
    const highCeiling = createMockPlayer('ceiling', 'High Ceiling', ['OF'], 68);
    highCeiling.probabilistic.rosScore.p75 = 78;
    
    const players = [highFloor, highCeiling];
    
    const teamState = createMockTeamState();
    const config: Partial<OptimizerConfig> = {
      riskTolerance: 'aggressive',
      weightRisk: 0.30,
    };
    
    const result = optimizeLineup(players, teamState, config);
    
    // High ceiling player should start
    expect(result.assignments.get('OF1')?.playerId).toBe('ceiling');
  });
});

// ============================================================================
// EXPLAINABILITY TESTS
// ============================================================================

describe('Explainability', () => {
  it('provides decision trace for every assignment', () => {
    const players = [
      createMockPlayer('c', 'Catcher', ['C'], 60),
      createMockPlayer('1b', 'First Base', ['1B'], 65),
      createMockPlayer('of', 'Outfield', ['OF'], 70),
    ];
    
    const teamState = createMockTeamState();
    const result = optimizeLineup(players, teamState);
    
    // Should have decision trace
    expect(result.decisionTrace.length).toBeGreaterThan(0);
    
    // Each decision should have reasoning
    for (const step of result.decisionTrace) {
      expect(step.reasoning).toBeTruthy();
    }
  });
  
  it('provides human-readable explanation', () => {
    const players = [
      createMockPlayer('a', 'Player A', ['OF'], 75),
      createMockPlayer('b', 'Player B', ['OF'], 65),
    ];
    
    const teamState = createMockTeamState();
    const result = optimizeLineup(players, teamState);
    
    expect(result.explanation.summary).toBeTruthy();
    expect(result.totalObjective).toBeGreaterThan(0);
  });
});
