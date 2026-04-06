/**
 * Trade Evaluator Types
 *
 * Type definitions for trade analysis and evaluation.
 */

import type { PlayerScore } from '../scoring/compute.js';
import type { PitcherScore } from '../pitchers/compute.js';
import type { MomentumMetrics } from '../momentum/index.js';
import type { ProbabilisticOutcome } from '../probabilistic/index.js';
import type { TeamState, RosterPlayer } from '@cbb/core';

// Re-export TeamState for convenience
export type { TeamState, RosterPlayer };

// ============================================================================
// Trade Proposal
// ============================================================================

/**
 * A trade proposal between two teams
 */
export interface TradeProposal {
  id: string;
  proposedAt: string;  // ISO timestamp
  
  // Your team (the evaluator's perspective)
  yourTeamId: string;
  playersYouGive: TradePlayer[];
  playersYouGet: TradePlayer[];
  
  // Other team (for context)
  otherTeamId: string;
  otherTeamName: string;
  
  // Additional considerations
  faabYouGive?: number;
  faabYouGet?: number;
  draftPicksYouGive?: DraftPick[];
  draftPicksYouGet?: DraftPick[];
}

export interface TradePlayer {
  playerId: string;
  playerMlbamId: string;
  name: string;
  positions: string[];
  team: string;
  
  // Intelligence (populated by evaluator)
  score?: PlayerScore | PitcherScore;
  momentum?: MomentumMetrics;
  probabilistic?: ProbabilisticOutcome;
  
  // Context
  isInjured: boolean;
  injuryStatus?: string;
  gamesThisWeek: number;
}

export interface DraftPick {
  year: number;
  round: number;
  originalTeam: string;
}

// ============================================================================
// Trade Evaluation
// ============================================================================

/**
 * Complete trade evaluation result
 */
export interface TradeEvaluation {
  // Core recommendation
  recommendation: TradeRecommendation;
  summaryScore: number;           // Scalar value (can be negative)
  confidence: 'high' | 'medium' | 'low';
  
  // Detailed analysis
  categoryImpact: CategoryImpact;
  riskImpact: RiskImpact;
  rosterImpact: RosterImpact;
  scheduleImpact: ScheduleImpact;
  
  // World comparison
  worldBefore: WorldProjection;
  worldAfter: WorldProjection;
  delta: WorldDelta;
  
  // Explainability
  explanation: TradeExplanation;
  decisionTrace: TradeDecisionStep[];
}

export type TradeRecommendation = 
  | 'strong_accept'   // Clear win, do it
  | 'lean_accept'     // Probable win, favorable terms
  | 'neutral'         // Fair trade, no clear winner
  | 'lean_reject'     // Probable loss, unfavorable
  | 'hard_reject';    // Clear loss, avoid

// ============================================================================
// Impact Analysis
// ============================================================================

export interface CategoryImpact {
  format: 'roto' | 'h2h_points' | 'h2h_categories';
  
  // Raw stat changes (projected ROS)
  statChanges: Record<string, number>;  // ΔHR, ΔR, ΔRBI, etc.
  
  // Category point changes (roto)
  categoryPointChanges?: Record<string, number>;
  totalCategoryPointChange?: number;
  
  // Win probability changes (H2H)
  matchupWinProbChange?: number;
  playoffWinProbChange?: number;
  
  // Top improvements/declines
  topImprovements: string[];
  topDeclines: string[];
}

export interface RiskImpact {
  // Before/after comparisons
  volatilityBefore: 'low' | 'medium' | 'high' | 'extreme';
  volatilityAfter: 'low' | 'medium' | 'high' | 'extreme';
  volatilityChange: 'safer' | 'similar' | 'riskier';
  
  // Floor/Ceiling
  floorChange: number;   // Change in P10 outcome
  ceilingChange: number; // Change in P90 outcome
  medianChange: number;  // Change in P50 outcome
  
  // Downside/upside
  downsideRiskBefore: number;
  downsideRiskAfter: number;
  upsidePotentialBefore: number;
  upsidePotentialAfter: number;
  
  // Risk-adjusted value
  riskAdjustedValue: number;
}

export interface RosterImpact {
  // Positional changes
  positionalBalanceBefore: PositionalBalance;
  positionalBalanceAfter: PositionalBalance;
  
  // Holes filled / created
  holesFilled: string[];
  holesCreated: string[];
  
  // Depth changes
  startingQualityChange: number;  // Sum of starter score changes
  benchDepthChange: number;       // Change in bench quality
  
  // Flexibility
  flexibilityBefore: number;  // 0-100
  flexibilityAfter: number;
  
  // Replacement level exposure
  replacementLevelNeedsBefore: number;
  replacementLevelNeedsAfter: number;
}

export interface PositionalBalance {
  score: number;  // 0-100, higher = better balanced
  strengths: string[];  // Positions where you're strong
  weaknesses: string[]; // Positions where you're weak
  coverage: Record<string, 'excellent' | 'good' | 'adequate' | 'poor'>;
}

export interface ScheduleImpact {
  // Games remaining this week
  gamesThisWeekChange: number;
  
  // Two-start pitchers gained/lost
  twoStartSPsBefore: number;
  twoStartSPsAfter: number;
  
  // Favorable matchups
  favorableMatchupsGained: number;
  favorableMatchupsLost: number;
  
  // Playoff schedule (if applicable)
  playoffScheduleQuality?: 'better' | 'similar' | 'worse';
}

// ============================================================================
// World Projections
// ============================================================================

export interface WorldProjection {
  // ROS projections
  projectedCategoryTotals: Record<string, number>;
  projectedStanding: number;  // 1-12, etc.
  projectedCategoryPoints: number;
  
  // Risk profile
  volatility: 'low' | 'medium' | 'high' | 'extreme';
  floorOutcome: number;   // P10
  medianOutcome: number;  // P50
  ceilingOutcome: number; // P90
  
  // Roster state
  rosterComposition: RosterComposition;
  
  // Simulation confidence
  projectionConfidence: number;  // 0-1
}

export interface RosterComposition {
  hitters: number;
  pitchers: number;
  byPosition: Record<string, number>;
  averageStarterScore: number;
  averageBenchScore: number;
}

export interface WorldDelta {
  categoryTotals: Record<string, number>;
  standingChange: number;  // +2 means moving up 2 spots
  categoryPointsChange: number;
  
  volatilityChange: 'safer' | 'similar' | 'riskier';
  floorChange: number;
  medianChange: number;
  ceilingChange: number;
}

// ============================================================================
// Explanation
// ============================================================================

export interface TradeExplanation {
  headline: string;
  summary: string;
  
  // Structured reasoning
  keyPoints: string[];
  concerns: string[];
  opportunities: string[];
  
  // Category narrative
  categoryNarrative: string;
  
  // Risk narrative
  riskNarrative: string;
  
  // Roster narrative
  rosterNarrative: string;
  
  // Final verdict
  verdict: string;
}

export interface TradeDecisionStep {
  step: number;
  action: 'remove_player' | 'add_player' | 'recalculate_projection' | 'compare_worlds';
  description: string;
  impact: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface TradeEvaluatorConfig {
  // Scoring format
  format: 'roto' | 'h2h_points' | 'h2h_categories';
  
  // Weights for value calculation
  weights: {
    categoryPoints: number;    // Roto: category standing impact
    winProbability: number;    // H2H: matchup win probability
    riskProfile: number;       // Risk adjustment
    rosterFlexibility: number; // Positional balance
    schedule: number;          // This week/playoff impact
  };
  
  // Risk tolerance
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  
  // Simulation depth
  simulationRuns: number;  // Monte Carlo runs (default: 200 for speed)
  
  // Thresholds for recommendations
  thresholds: {
    strongAccept: number;  // e.g., +5.0
    leanAccept: number;    // e.g., +2.0
    leanReject: number;    // e.g., -2.0
    hardReject: number;    // e.g., -5.0
  };
  
  // League context
  leagueSize: number;
  playoffTeams: number;
  currentWeek: number;
  weeksRemaining: number;
}

// ============================================================================
// Side Analysis (for the other team)
// ============================================================================

export interface TradeSideAnalysis {
  forYourTeam: TradeEvaluation;
  forOtherTeam?: TradeEvaluation;  // If you want to analyze fairness
  
  // Fairness assessment
  fairness: 'lopsided_you' | 'slight_you' | 'fair' | 'slight_them' | 'lopsided_them';
  likelihoodOfAcceptance: 'high' | 'medium' | 'low';
  
  // Negotiation insights
  yourLeverage: string[];
  theirLeverage: string[];
  counterProposals?: TradeProposal[];
}
