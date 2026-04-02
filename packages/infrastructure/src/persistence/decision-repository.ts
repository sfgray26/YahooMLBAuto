/**
 * Decision Persistence Repository
 * 
 * Stores every decision with full metadata for:
 * - Backtesting
 * - Self-auditing
 * - Performance attribution
 * - Learning from mistakes
 * 
 * TODO: Uncomment Prisma code after running `pnpm prisma generate`
 */

// import { prisma } from '../index.js';
import type {
  LineupDecisionRecord,
  WaiverDecisionRecord,
  TeamStateSnapshot,
  DecisionQuery,
  DecisionPerformanceSummary,
} from '@cbb/core';
import type { TeamState } from '@cbb/core';

// Simplified score types for persistence (avoiding worker dependency)
interface ScoreSnapshot {
  playerId: string;
  mlbamId: string;
  overallValue: number;
  components: Record<string, number>;
  confidence: number;
  domain?: 'hitting' | 'pitching';
  role?: {
    currentRole: string;
    isCloser: boolean;
  };
}

interface PitcherOutcomeSnapshot {
  mlbamId: string;
  expectedValue: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  blowUpRisk?: number;
  qualityStartRate?: number;
}

// ============================================================================
// Snapshot Builders
// ============================================================================

function buildTeamStateSnapshot(teamState: TeamState): TeamStateSnapshot {
  return {
    version: teamState.roster.version,
    capturedAt: new Date().toISOString(),
    roster: teamState.roster.players.map(p => ({
      playerId: p.playerId,
      mlbamId: p.mlbamId,
      name: p.name,
      positions: p.positions,
      isInjured: p.isInjured,
      acquisitionType: p.acquisitionType,
    })),
    lineupSlots: teamState.lineupConfig.slots.map(s => ({
      slotId: s.slotId,
      domain: s.domain,
      eligiblePositions: s.eligiblePositions,
    })),
    currentLineup: {
      assignments: teamState.currentLineup.assignments.map(a => ({
        slotId: a.slotId,
        playerId: a.playerId,
      })),
      lockedSlots: teamState.currentLineup.lockedSlots.map(l => l.slotId),
      benchPlayerIds: teamState.currentLineup.benchAssignments.map(b => b.playerId),
    },
    waiverBudget: {
      remaining: teamState.waiverState.budgetRemaining,
      total: teamState.waiverState.budgetTotal,
    },
  };
}

function buildScoresSnapshot(
  hitterScores: Map<string, ScoreSnapshot>,
  pitcherScores: Map<string, ScoreSnapshot>
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  
  for (const [mlbamId, score] of hitterScores) {
    snapshot[score.playerId] = {
      mlbamId,
      domain: 'hitting',
      overallValue: score.overallValue,
      components: score.components,
      confidence: score.confidence,
    };
  }
  
  for (const [mlbamId, score] of pitcherScores) {
    snapshot[score.playerId] = {
      mlbamId,
      domain: 'pitching',
      overallValue: score.overallValue,
      components: score.components,
      confidence: score.confidence,
      role: score.role,
    };
  }
  
  return snapshot;
}

function buildMonteCarloSnapshot(
  pitcherOutcomes: Map<string, PitcherOutcomeSnapshot>
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  
  for (const [mlbamId, outcome] of pitcherOutcomes) {
    snapshot[mlbamId] = {
      expectedValue: outcome.expectedValue,
      p10: outcome.p10,
      p25: outcome.p25,
      p50: outcome.p50,
      p75: outcome.p75,
      p90: outcome.p90,
      blowUpRisk: outcome.blowUpRisk,
      qualityStartRate: outcome.qualityStartRate,
    };
  }
  
  return snapshot;
}

// ============================================================================
// STUB IMPLEMENTATIONS
// TODO: Uncomment and fix Prisma code after running `pnpm prisma generate`
// ============================================================================

export interface PersistLineupDecisionInput {
  teamState: TeamState;
  lineupDecision: LineupDecisionRecord;
  hitterScores: Map<string, ScoreSnapshot>;
  pitcherScores: Map<string, ScoreSnapshot>;
  pitcherMonteCarlo?: Map<string, PitcherOutcomeSnapshot>;
  traceId: string;
}

export async function persistLineupDecision(
  input: PersistLineupDecisionInput
): Promise<{ success: boolean; decisionId: string }> {
  // STUB: Log to console instead of database
  console.log('[PERSISTENCE STUB] Lineup decision:', input.lineupDecision.decisionId);
  console.log('[PERSISTENCE STUB] Run `pnpm prisma generate` to enable full persistence');
  
  return { success: true, decisionId: input.lineupDecision.decisionId };
}

export interface PersistWaiverDecisionInput {
  teamState: TeamState;
  waiverDecision: WaiverDecisionRecord;
  hitterScores: Map<string, ScoreSnapshot>;
  pitcherScores: Map<string, ScoreSnapshot>;
  pitcherMonteCarlo?: Map<string, PitcherOutcomeSnapshot>;
  traceId: string;
}

export async function persistWaiverDecision(
  input: PersistWaiverDecisionInput
): Promise<{ success: boolean; decisionId: string }> {
  // STUB: Log to console instead of database
  console.log('[PERSISTENCE STUB] Waiver decision:', input.waiverDecision.decisionId);
  console.log('[PERSISTENCE STUB] Run `pnpm prisma generate` to enable full persistence');
  
  return { success: true, decisionId: input.waiverDecision.decisionId };
}

export async function updateLineupDecisionWithActualResults(
  decisionId: string,
  actualPoints: number,
  alternativeResults?: Array<{ alternativeId: string; wouldHaveScored: number }>
): Promise<void> {
  // STUB
  console.log(`[PERSISTENCE STUB] Update lineup decision ${decisionId} with ${actualPoints} points`);
}

export async function updateWaiverDecisionWithActualResults(
  decisionId: string,
  actualResult: {
    claimSucceeded: boolean;
    actualCost?: number;
    weeksOwned: number;
    pointsContributed: number;
    wasGoodDecision: boolean;
  }
): Promise<void> {
  // STUB
  console.log(`[PERSISTENCE STUB] Update waiver decision ${decisionId}: ${actualResult.claimSucceeded ? 'claimed' : 'failed'}`);
}

export async function queryDecisions(
  query: DecisionQuery
): Promise<Array<{ decisionId: string; decisionType: string; createdAt: Date; status: string }>> {
  // STUB: Return empty array
  console.log('[PERSISTENCE STUB] Query decisions (returning empty)');
  return [];
}

export async function getDecisionById(
  decisionId: string
): Promise<unknown | null> {
  // STUB: Return null
  console.log(`[PERSISTENCE STUB] Get decision ${decisionId} (returning null)`);
  return null;
}

export async function getDecisionPerformanceSummary(
  teamId: string,
  season: number
): Promise<DecisionPerformanceSummary> {
  // STUB: Return empty summary
  console.log(`[PERSISTENCE STUB] Get performance summary for ${teamId}, season ${season}`);
  
  return {
    totalDecisions: 0,
    executedDecisions: 0,
    lineupDecisions: 0,
    waiverDecisions: 0,
    avgLineupError: 0,
    avgLineupErrorPercent: 0,
    decisionsWhereAlternativeBetter: 0,
    totalWaiverSpend: 0,
    totalWaiverReturn: 0,
    waiverRoi: 0,
    highConfidenceAccuracy: 0,
    lowConfidenceAccuracy: 0,
  };
}
