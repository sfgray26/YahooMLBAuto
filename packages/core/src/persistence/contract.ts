/**
 * Decision Persistence Contract
 * 
 * NON-NEGOTIABLE FOR ELITE SYSTEMS
 * 
 * Every decision is stored with full metadata:
 * - Decision context (TeamState snapshot)
 * - Scores used at decision time
 * - Monte Carlo percentiles
 * - Confidence levels
 * 
 * This enables:
 * - Backtesting
 * - Self-auditing
 * - Learning from mistakes
 * - Performance attribution
 */

import type { UUID, ISO8601Timestamp } from '@cbb/core';

// ============================================================================
// Base Decision Types
// ============================================================================

export type DecisionType = 'lineup' | 'waiver_add' | 'waiver_drop' | 'waiver_swap';

export type DecisionStatus = 'pending' | 'executed' | 'rejected' | 'expired';

export interface BaseDecisionRecord {
  readonly decisionId: UUID;
  readonly decisionType: DecisionType;
  readonly teamId: UUID;
  readonly leagueId: UUID;
  readonly season: number;
  
  readonly createdAt: ISO8601Timestamp;
  readonly executedAt: ISO8601Timestamp | null;
  readonly status: DecisionStatus;
  
  readonly reason: string;
  readonly confidence: number;  // 0-1 confidence at decision time
}

// ============================================================================
// Lineup Decision
// ============================================================================

export interface LineupDecisionRecord extends BaseDecisionRecord {
  readonly decisionType: 'lineup';
  readonly scoringPeriod: ISO8601Timestamp;
  
  // Team state snapshot at decision time
  readonly teamStateSnapshot: TeamStateSnapshot;
  
  // The decision
  readonly optimalLineup: SlotDecision[];
  readonly benchDecisions: BenchDecision[];
  readonly expectedPoints: number;
  
  // Alternatives considered
  readonly alternatives: AlternativeLineupSnapshot[];
  
  // Key decisions made
  readonly keyDecisions: KeyDecisionSnapshot[];
  
  // Key metrics at decision time
  readonly confidenceScore: number;
  readonly lockedPlayerCount: number;
  
  // For backtesting
  readonly actualPoints: number | null;  // Filled in after scoring period
  readonly accuracyMetrics: LineupAccuracyMetrics | null;
}

export interface SlotDecision {
  readonly slotId: string;
  readonly playerId: UUID;
  readonly mlbamId: string;
  readonly playerName: string;
  readonly projectedPoints: number;
  readonly confidence: 'very_high' | 'high' | 'moderate' | 'low' | 'very_low';
  
  // Scores used at decision time
  readonly overallValue: number;
  readonly componentScores: Record<string, number>;
  
  // Monte Carlo data (if available)
  readonly monteCarlo?: {
    readonly expectedValue: number;
    readonly p10: number;
    readonly p50: number;
    readonly p90: number;
    readonly blowUpRisk?: number;  // For pitchers
  };
}

export interface BenchDecision {
  readonly playerId: UUID;
  readonly mlbamId: string;
  readonly playerName: string;
  readonly reason: 'streaming_candidate' | 'injured' | 'matchup_play' | 'depth';
  readonly overallValue: number;
}

export interface AlternativeLineupSnapshot {
  readonly description: string;
  readonly expectedPoints: number;
  readonly varianceVsOptimal: number;
  readonly slotChanges: Array<{
    readonly slotId: string;
    readonly fromPlayerId: UUID;
    readonly toPlayerId: UUID;
  }>;
}

export interface KeyDecisionSnapshot {
  readonly position: string;
  readonly chosenPlayerId: UUID;
  readonly chosenPlayerName: string;
  readonly alternativesConsidered: string[];
  readonly whyChosen: string;
}

export interface LineupAccuracyMetrics {
  readonly actualPoints: number;
  readonly projectedPoints: number;
  readonly error: number;  // actual - projected
  readonly errorPercent: number;
  readonly rankIfAlternatives: Array<{
    readonly alternativeId: string;
    readonly wouldHaveScored: number;
    readonly wouldHaveBeenBetter: boolean;
  }>;
}

// ============================================================================
// Waiver Decision
// ============================================================================

export interface WaiverDecisionRecord extends BaseDecisionRecord {
  readonly decisionType: 'waiver_add' | 'waiver_drop' | 'waiver_swap';
  
  // Team state snapshot
  readonly teamStateSnapshot: TeamStateSnapshot;
  
  // The decision
  readonly targetPlayer: PlayerSnapshot;
  readonly dropPlayer?: PlayerSnapshot;  // For swaps
  readonly bidAmount?: number;
  
  // Reasoning
  readonly reasoning: string;
  readonly rosterAnalysisSnapshot: RosterAnalysisSnapshot;
  
  // Key metrics
  readonly expectedValueAdd: number;  // Value of player being added
  readonly expectedValueDrop: number;  // Value of player being dropped (if swap)
  readonly netValue: number;
  
  // Waiver context
  readonly waiverPriority: number | null;
  readonly faabBudgetRemaining: number;
  
  // For backtesting
  readonly actualResult: WaiverActualResult | null;
}

export interface PlayerSnapshot {
  readonly playerId: UUID;
  readonly mlbamId: string;
  readonly name: string;
  readonly team: string;
  readonly positions: string[];
  readonly percentOwned: number | null;
  
  // Scores at decision time
  readonly overallValue: number;
  readonly componentScores: Record<string, number>;
  readonly confidence: number;
  
  // For pitchers
  readonly role?: {
    readonly currentRole: string;
    readonly isCloser: boolean;
    readonly waiverEdge: number;
  };
  
  // Monte Carlo
  readonly monteCarlo?: {
    readonly expectedValue: number;
    readonly p10: number;
    readonly p50: number;
    readonly p90: number;
  };
}

export interface RosterAnalysisSnapshot {
  readonly strengths: string[];
  readonly weaknesses: string[];
  readonly opportunities: string[];
  readonly positionDepth: Record<string, number>;
  readonly benchUtilization: number;
}

export interface WaiverActualResult {
  readonly claimSucceeded: boolean;
  readonly actualCost: number;  // What was actually paid
  readonly weeksOwned: number;
  readonly pointsContributed: number;
  readonly roi: number;  // Return on investment
  readonly correctDecision: boolean;  // With hindsight
}

// ============================================================================
// Team State Snapshot (For Decision Context)
// ============================================================================

export interface TeamStateSnapshot {
  readonly version: number;
  readonly capturedAt: ISO8601Timestamp;
  
  readonly roster: Array<{
    readonly playerId: UUID;
    readonly mlbamId: string;
    readonly name: string;
    readonly positions: string[];
    readonly isInjured: boolean;
    readonly acquisitionType: string;
  }>;
  
  readonly lineupSlots: Array<{
    readonly slotId: string;
    readonly domain: string;
    readonly eligiblePositions: string[];
  }>;
  
  readonly currentLineup: {
    readonly assignments: Array<{
      readonly slotId: string;
      readonly playerId: UUID;
    }>;
    readonly lockedSlots: string[];
    readonly benchPlayerIds: UUID[];
  };
  
  readonly waiverBudget: {
    readonly remaining: number;
    readonly total: number;
  };
}

// ============================================================================
// Decision Queries (For Analysis)
// ============================================================================

export interface DecisionQuery {
  readonly teamId?: UUID;
  readonly decisionType?: DecisionType;
  readonly startDate?: ISO8601Timestamp;
  readonly endDate?: ISO8601Timestamp;
  readonly status?: DecisionStatus;
}

export interface DecisionPerformanceSummary {
  readonly totalDecisions: number;
  readonly executedDecisions: number;
  readonly lineupDecisions: number;
  readonly waiverDecisions: number;
  
  // Accuracy metrics
  readonly avgLineupError: number;
  readonly avgLineupErrorPercent: number;
  readonly decisionsWhereAlternativeBetter: number;
  
  // Waiver ROI
  readonly totalWaiverSpend: number;
  readonly totalWaiverReturn: number;
  readonly waiverRoi: number;
  
  // By confidence level
  readonly highConfidenceAccuracy: number;
  readonly lowConfidenceAccuracy: number;
}
