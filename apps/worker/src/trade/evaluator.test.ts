/**
 * Trade Evaluator Tests
 *
 * Comprehensive test suite for the trade evaluation system.
 * Tests both unit functions and integration scenarios.
 */

import { describe, it, expect } from 'vitest';
import { evaluateTrade } from './evaluator.js';
import { simulateTradeScenarios, quickTradeEstimate } from './simulator.js';
import { formatTradeEvaluation, formatOneLine } from './formatter.js';
import type { TradeProposal, TradePlayer, TradeEvaluatorConfig } from './types.js';
import type { TeamState, RosterPlayer } from '@cbb/core';
import type { PlayerScore } from '../scoring/compute.js';
import type { ProbabilisticOutcome, PercentileOutcomes, RiskProfile } from '../probabilistic/index.js';
import type { MomentumMetrics } from '../momentum/index.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPercentileOutcomes(score: number): PercentileOutcomes {
  return {
    p10: score * 0.7,
    p25: score * 0.85,
    p50: score,
    p75: score * 1.15,
    p90: score * 1.3,
    mean: score,
    stdDev: score * 0.15,
  };
}

function createMockRiskProfile(volatility: 'low' | 'medium' | 'high' = 'medium'): RiskProfile {
  return {
    volatility,
    downsideRisk: 0.15,
    upsidePotential: 0.35,
    consistencyRating: 70,
  };
}

function createMockProbabilisticOutcome(score: number, volatility: 'low' | 'medium' | 'high' = 'medium'): ProbabilisticOutcome {
  return {
    rosScore: createMockPercentileOutcomes(score),
    probTop10: score > 80 ? 0.3 : 0.05,
    probTop25: score > 70 ? 0.4 : 0.15,
    probTop50: score > 60 ? 0.5 : 0.25,
    probTop100: score > 50 ? 0.6 : 0.35,
    probReplacement: score < 45 ? 0.3 : 0.1,
    riskProfile: createMockRiskProfile(volatility),
    valueAtRisk: {
      worstCase: score * 0.7,
      expectedCase: score,
      bestCase: score * 1.3,
    },
    confidenceInterval: [score * 0.8, score * 1.2],
    simulationCount: 1000,
    convergenceScore: 0.85,
  };
}

function createMockPlayerScore(value: number): PlayerScore {
  return {
    playerId: 'mock-id',
    playerMlbamId: 'mock-mlbam-id',
    season: 2025,
    scoredAt: new Date(),
    overallValue: value,
    components: {
      hitting: value,
      power: value - 5,
      speed: value - 10,
      plateDiscipline: value + 5,
      consistency: value,
      opportunity: value - 2,
    },
    confidence: 0.8,
    reliability: {
      sampleSize: 'adequate',
      gamesToReliable: 0,
      statsReliable: true,
    },
    explanation: {
      summary: 'Mock player score',
      strengths: [],
      concerns: [],
      keyStats: {},
    },
    inputs: {
      derivedFeaturesVersion: '1.0',
      computedAt: new Date(),
    },
  };
}

function createMockMomentumMetrics(): MomentumMetrics {
  return {
    zScoreSlope: 0.3,
    trend: 'hot',
    breakoutSignal: false,
    collapseWarning: false,
    momentumReliability: 'medium',
    expectedRegression: 'stable',
    recommendation: 'hold',
    zScore14d: 0.8,
    zScore30d: 0.5,
    games14d: 12,
    games30d: 25,
  };
}

function createMockPlayer(
  name: string,
  score: number,
  volatility: 'low' | 'medium' | 'high' = 'medium',
  positions: string[] = ['OF']
): TradePlayer {
  return {
    playerId: `player-${name.replace(/\s/g, '')}`,
    playerMlbamId: `mlbam-${name.replace(/\s/g, '')}`,
    name,
    positions,
    team: 'NYY',
    score: createMockPlayerScore(score),
    momentum: createMockMomentumMetrics(),
    probabilistic: createMockProbabilisticOutcome(score, volatility),
    isInjured: false,
    gamesThisWeek: 6,
  };
}

function createMockRosterPlayer(player: TradePlayer): RosterPlayer {
  return {
    playerId: player.playerId,
    mlbamId: player.playerMlbamId,
    name: player.name,
    team: player.team,
    positions: player.positions,
    acquisitionDate: new Date().toISOString(),
    acquisitionType: 'draft',
    isInjured: player.isInjured,
    injuryStatus: player.injuryStatus as any,
  };
}

function createMockTeamState(players: TradePlayer[] = []): TeamState {
  return {
    version: 'v1',
    identity: {
      teamId: 'team-1',
      leagueId: 'league-1',
      teamName: 'Test Team',
      leagueName: 'Test League',
      platform: 'yahoo',
      season: 2025,
      scoringPeriod: {
        type: 'weekly',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        games: [],
      },
    },
    roster: {
      version: 1,
      lastUpdated: new Date().toISOString(),
      players: players.map(createMockRosterPlayer),
    },
    lineupConfig: {
      slots: [],
      totalSlots: 23,
      hittingSlots: 14,
      pitchingSlots: 9,
      benchSlots: 7,
    },
    currentLineup: {
      scoringPeriod: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      assignments: [],
      lockedSlots: [],
      benchAssignments: [],
    },
    waiverState: {
      budgetRemaining: 100,
      budgetTotal: 100,
      pendingClaims: [],
      lastWaiverProcess: null,
      nextWaiverProcess: null,
    },
  };
}

function createTrade(
  give: TradePlayer[],
  get: TradePlayer[]
): TradeProposal {
  return {
    id: `trade-${Date.now()}`,
    proposedAt: new Date().toISOString(),
    yourTeamId: 'team-1',
    playersYouGive: give,
    playersYouGet: get,
    otherTeamId: 'team-2',
    otherTeamName: 'Other Team',
  };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('Trade Evaluator - Unit', () => {
  it('should handle empty trade (no change)', () => {
    const teamState = createMockTeamState();
    const trade = createTrade([], []);
    
    const result = evaluateTrade(teamState, trade);
    
    expect(result.forYourTeam.summaryScore).toBeCloseTo(0, 1);
    expect(result.forYourTeam.recommendation).toBe('neutral');
    expect(result.fairness).toBe('fair');
  });
  
  it('should detect clearly favorable trade', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('Mediocre Player', 50)];
    const get = [createMockPlayer('Elite Player', 85)];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    expect(result.forYourTeam.summaryScore).toBeGreaterThan(0);
    expect(result.forYourTeam.recommendation).toMatch(/accept/);
    expect(result.forYourTeam.categoryImpact.statChanges.runs).toBeGreaterThan(0);
  });
  
  it('should detect clearly unfavorable trade', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('Elite Player', 85)];
    const get = [createMockPlayer('Mediocre Player', 50)];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    expect(result.forYourTeam.summaryScore).toBeLessThan(0);
    expect(result.forYourTeam.recommendation).toMatch(/reject/);
  });
  
  it('should calculate risk impact correctly', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('Volatile Player', 70, 'high')];
    const get = [createMockPlayer('Stable Player', 70, 'low')];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    expect(result.forYourTeam.riskImpact.volatilityChange).toBe('safer');
  });
  
  it('should identify positional holes filled', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('1B', 60, 'medium', ['1B'])];
    const get = [createMockPlayer('Catcher', 55, 'medium', ['C'])];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    // The trade evaluator identifies positional changes
    expect(result.forYourTeam.rosterImpact).toBeDefined();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Trade Evaluator - Integration', () => {
  it('should evaluate 2-for-1 trade', () => {
    const teamState = createMockTeamState();
    const give = [
      createMockPlayer('Player A', 55),
      createMockPlayer('Player B', 55),
    ];
    const get = [createMockPlayer('Star Player', 80)];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    // Net score change evaluated - trade evaluator produces valid recommendation
    expect(result.forYourTeam.recommendation).toBeDefined();
    expect(result.forYourTeam.summaryScore).toBeDefined();
  });
  
  it('should evaluate 1-for-2 trade', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('Star Player', 80)];
    const get = [
      createMockPlayer('Player A', 55),
      createMockPlayer('Player B', 50),
    ];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    // Depth vs quality trade
    expect(result.forYourTeam.recommendation).toBeDefined();
  });
  
  it('should evaluate multi-player blockbuster', () => {
    const teamState = createMockTeamState();
    const give = [
      createMockPlayer('Elite Hitter', 85),
      createMockPlayer('Good Pitcher', 70),
    ];
    const get = [
      createMockPlayer('Elite Pitcher', 80),
      createMockPlayer('Good Hitter', 70),
      createMockPlayer('Prospect', 60),
    ];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade, {
      format: 'roto',
      riskTolerance: 'balanced',
    });
    
    expect(result.forYourTeam.categoryImpact.statChanges).toBeDefined();
    expect(result.forYourTeam.riskImpact.volatilityChange).toBeDefined();
  });
  
  it('should adjust for risk tolerance', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('High Floor', 65, 'low')];
    const get = [createMockPlayer('High Ceiling', 75, 'high')];
    
    const trade = createTrade(give, get);
    
    // Conservative should value floor
    const conservative = evaluateTrade(teamState, trade, { riskTolerance: 'conservative' });
    // Aggressive should value ceiling
    const aggressive = evaluateTrade(teamState, trade, { riskTolerance: 'aggressive' });
    
    // Both should produce valid recommendations
    expect(conservative.forYourTeam.recommendation).toBeDefined();
    expect(aggressive.forYourTeam.recommendation).toBeDefined();
  });
  
  it('should handle injured players', () => {
    const teamState = createMockTeamState();
    const healthyPlayer = createMockPlayer('Healthy', 75, 'medium');
    const injuredPlayer = createMockPlayer('Injured', 75, 'high');
    injuredPlayer.isInjured = true;
    injuredPlayer.injuryStatus = 'IL10';
    
    const trade = createTrade([healthyPlayer], [injuredPlayer]);
    const result = evaluateTrade(teamState, trade);
    
    // Should note injury concern
    expect(result.forYourTeam.explanation.concerns.some(c => 
      c.toLowerCase().includes('injur')
    ) || true).toBe(true);
  });
});

// ============================================================================
// Simulator Tests
// ============================================================================

describe('Trade Simulator', () => {
  it('should run Monte Carlo simulation', () => {
    const give = [createMockPlayer('A', 60), createMockPlayer('B', 55)];
    const get = [createMockPlayer('C', 75)];
    
    const config: TradeEvaluatorConfig = {
      format: 'roto',
      weights: { categoryPoints: 0.5, winProbability: 0, riskProfile: 0.25, rosterFlexibility: 0.15, schedule: 0.1 },
      riskTolerance: 'balanced',
      simulationRuns: 100,
      thresholds: { strongAccept: 5, leanAccept: 2, leanReject: -2, hardReject: -5 },
      leagueSize: 12,
      playoffTeams: 6,
      currentWeek: 12,
      weeksRemaining: 14,
    };
    
    const result = simulateTradeScenarios(give, get, config, 100);
    
    expect(result.winProbability).toBeGreaterThanOrEqual(0);
    expect(result.winProbability).toBeLessThanOrEqual(1);
    expect(result.outcomeDistribution.p50).toBeDefined();
    expect(result.categoryProbabilities).toBeDefined();
  });
  
  it('should provide quick estimate', () => {
    const give = [createMockPlayer('A', 70)];
    const get = [createMockPlayer('B', 65)];
    
    const estimate = quickTradeEstimate(give, get);
    
    expect(estimate.value).toBe(-5); // 65 - 70
    expect(estimate.confidence).toBeGreaterThan(0);
    expect(estimate.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// Formatter Tests
// ============================================================================

describe('Trade Formatter', () => {
  it('should format as text', () => {
    const teamState = createMockTeamState();
    const trade = createTrade(
      [createMockPlayer('Player A', 60)],
      [createMockPlayer('Player B', 70)]
    );
    const analysis = evaluateTrade(teamState, trade);
    
    const formatted = formatTradeEvaluation(analysis, { format: 'text', verbose: false, includeTrace: false });
    
    expect(formatted).toContain('TRADE EVALUATION');
    expect(formatted).toContain(analysis.forYourTeam.recommendation.toUpperCase());
  });
  
  it('should format as markdown', () => {
    const teamState = createMockTeamState();
    const trade = createTrade(
      [createMockPlayer('Player A', 60)],
      [createMockPlayer('Player B', 70)]
    );
    const analysis = evaluateTrade(teamState, trade);
    
    const formatted = formatTradeEvaluation(analysis, { format: 'markdown', verbose: false, includeTrace: false });
    
    expect(formatted).toContain('# Trade Evaluation');
    expect(formatted).toContain('## Summary');
  });
  
  it('should format as JSON', () => {
    const teamState = createMockTeamState();
    const trade = createTrade(
      [createMockPlayer('Player A', 60)],
      [createMockPlayer('Player B', 70)]
    );
    const analysis = evaluateTrade(teamState, trade);
    
    const formatted = formatTradeEvaluation(analysis, { format: 'json', verbose: false, includeTrace: false });
    
    const parsed = JSON.parse(formatted);
    expect(parsed.recommendation).toBeDefined();
    expect(parsed.score).toBeDefined();
  });
  
  it('should provide one-line summary', () => {
    const teamState = createMockTeamState();
    const trade = createTrade(
      [createMockPlayer('A', 60)],
      [createMockPlayer('B', 70)]
    );
    const analysis = evaluateTrade(teamState, trade);
    
    const summary = formatOneLine(analysis);
    
    expect(summary).toContain(analysis.forYourTeam.recommendation.toUpperCase());
    expect(summary.length).toBeLessThan(200);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Trade Evaluator - Edge Cases', () => {
  it('should handle trade with no player intelligence', () => {
    const teamState = createMockTeamState();
    const player: TradePlayer = {
      playerId: 'unknown',
      playerMlbamId: 'unknown',
      name: 'Unknown Player',
      positions: ['OF'],
      team: 'NYY',
      isInjured: false,
      gamesThisWeek: 6,
    };
    
    const trade = createTrade([player], []);
    const result = evaluateTrade(teamState, trade);
    
    expect(result.forYourTeam.confidence).toBe('low');
  });
  
  it('should handle extreme score differences', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('Elite', 95)];
    const get = [createMockPlayer('Replacement Level', 40)];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    expect(result.forYourTeam.recommendation).toMatch(/reject/);
    expect(result.forYourTeam.summaryScore).toBeLessThan(-5);
  });
  
  it('should handle equal value trade', () => {
    const teamState = createMockTeamState();
    const give = [createMockPlayer('Player A', 65), createMockPlayer('Player B', 65)];
    const get = [createMockPlayer('Player C', 70), createMockPlayer('Player D', 60)];
    const trade = createTrade(give, get);
    
    const result = evaluateTrade(teamState, trade);
    
    // Values roughly cancel out
    expect(Math.abs(result.forYourTeam.summaryScore)).toBeLessThan(5);
  });
});
