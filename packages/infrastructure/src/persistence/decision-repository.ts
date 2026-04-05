/**
 * Decision Persistence Repository
 * 
 * Stores every decision with full metadata for:
 * - Backtesting
 * - Self-auditing
 * - Performance attribution
 * - Learning from mistakes
 */

import { prisma } from '../index.js';
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
// Lineup Decision Persistence
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
  const { teamState, lineupDecision, hitterScores, pitcherScores, pitcherMonteCarlo, traceId } = input;
  
  try {
    // Build snapshots
    const teamStateSnapshot = buildTeamStateSnapshot(teamState);
    const scoresSnapshot = buildScoresSnapshot(hitterScores, pitcherScores);
    const monteCarloSnapshot = pitcherMonteCarlo 
      ? buildMonteCarloSnapshot(pitcherMonteCarlo) 
      : undefined;

    // Create the main decision record
    const persisted = await prisma.persistedDecision.create({
      data: {
        decisionId: lineupDecision.decisionId,
        decisionType: 'lineup',
        teamId: lineupDecision.teamId,
        leagueId: teamState.identity.leagueId,
        season: teamState.identity.season,
        status: lineupDecision.status,
        teamStateSnapshot: teamStateSnapshot as unknown as Json,
        decisionPayload: {
          optimalLineup: lineupDecision.optimalLineup,
          benchDecisions: lineupDecision.benchDecisions,
          expectedPoints: lineupDecision.expectedPoints,
          alternatives: lineupDecision.alternatives,
          confidenceScore: lineupDecision.confidenceScore,
          lockedPlayerCount: lineupDecision.lockedPlayerCount,
        } as unknown as Json,
        scoresSnapshot: scoresSnapshot as unknown as Json,
        monteCarloData: monteCarloSnapshot as unknown as Json,
        confidence: lineupDecision.confidence,
        confidenceFactors: [
          `roster_size:${teamState.roster.players.length}`,
          `locked_count:${lineupDecision.lockedPlayerCount}`,
          `hitter_coverage:${hitterScores.size}`,
          `pitcher_coverage:${pitcherScores.size}`,
        ],
        traceId,
        reason: lineupDecision.reason,
      },
    });

    // Create detail record
    await prisma.lineupDecisionDetail.create({
      data: {
        decisionId: lineupDecision.decisionId,
        scoringPeriod: new Date(lineupDecision.scoringPeriod),
        optimalLineup: lineupDecision.optimalLineup as unknown as Json,
        benchDecisions: lineupDecision.benchDecisions as unknown as Json,
        expectedPoints: lineupDecision.expectedPoints,
        confidenceScore: lineupDecision.confidenceScore,
        alternatives: lineupDecision.alternatives as unknown as Json,
        keyDecisions: (lineupDecision.keyDecisions || []) as unknown as Json,
        lockedPlayerCount: lineupDecision.lockedPlayerCount,
        injuredPlayerCount: teamState.roster.players.filter(p => p.isInjured).length,
      },
    });

    console.log(`[PERSISTENCE] Lineup decision stored: ${lineupDecision.decisionId}`);
    
    return { success: true, decisionId: persisted.decisionId };
  } catch (error) {
    console.error('[PERSISTENCE] Failed to persist lineup decision:', error);
    return { success: false, decisionId: lineupDecision.decisionId };
  }
}

// ============================================================================
// Waiver Decision Persistence
// ============================================================================

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
  const { teamState, waiverDecision, hitterScores, pitcherScores, pitcherMonteCarlo, traceId } = input;
  
  try {
    // Build snapshots
    const teamStateSnapshot = buildTeamStateSnapshot(teamState);
    const scoresSnapshot = buildScoresSnapshot(hitterScores, pitcherScores);
    const monteCarloSnapshot = pitcherMonteCarlo 
      ? buildMonteCarloSnapshot(pitcherMonteCarlo) 
      : undefined;

    // Create the main decision record
    const persisted = await prisma.persistedDecision.create({
      data: {
        decisionId: waiverDecision.decisionId,
        decisionType: waiverDecision.decisionType,
        teamId: waiverDecision.teamId,
        leagueId: teamState.identity.leagueId,
        season: teamState.identity.season,
        status: waiverDecision.status,
        teamStateSnapshot: teamStateSnapshot as unknown as Json,
        decisionPayload: {
          targetPlayer: waiverDecision.targetPlayer,
          dropPlayer: waiverDecision.dropPlayer,
          bidAmount: waiverDecision.bidAmount,
          reasoning: waiverDecision.reasoning,
          rosterAnalysisSnapshot: waiverDecision.rosterAnalysisSnapshot,
          expectedValueAdd: waiverDecision.expectedValueAdd,
          expectedValueDrop: waiverDecision.expectedValueDrop,
          netValue: waiverDecision.netValue,
          waiverPriority: waiverDecision.waiverPriority,
          faabBudgetRemaining: waiverDecision.faabBudgetRemaining,
        } as unknown as Json,
        scoresSnapshot: scoresSnapshot as unknown as Json,
        monteCarloData: monteCarloSnapshot as unknown as Json,
        confidence: waiverDecision.confidence,
        confidenceFactors: [
          `roster_size:${teamState.roster.players.length}`,
          `waiver_budget:${teamState.waiverState.budgetRemaining}`,
          `hitter_coverage:${hitterScores.size}`,
          `pitcher_coverage:${pitcherScores.size}`,
        ],
        traceId,
        reason: waiverDecision.reasoning,
      },
    });

    // Create detail record
    await prisma.waiverDecisionDetail.create({
      data: {
        decisionId: waiverDecision.decisionId,
        targetPlayerId: waiverDecision.targetPlayer.playerId,
        targetPlayerName: waiverDecision.targetPlayer.name,
        targetPlayerMlbamId: waiverDecision.targetPlayer.mlbamId,
        dropPlayerId: waiverDecision.dropPlayer?.playerId,
        dropPlayerName: waiverDecision.dropPlayer?.name,
        targetValue: waiverDecision.targetPlayer.overallValue,
        dropValue: waiverDecision.dropPlayer?.overallValue ?? 0,
        netValue: waiverDecision.netValue,
        bidAmount: waiverDecision.bidAmount,
        faabRemaining: waiverDecision.faabBudgetRemaining,
        rosterAnalysis: waiverDecision.rosterAnalysisSnapshot as unknown as Json,
      },
    });

    console.log(`[PERSISTENCE] Waiver decision stored: ${waiverDecision.decisionId}`);
    
    return { success: true, decisionId: persisted.decisionId };
  } catch (error) {
    console.error('[PERSISTENCE] Failed to persist waiver decision:', error);
    return { success: false, decisionId: waiverDecision.decisionId };
  }
}

// ============================================================================
// Update with Actual Results (Backtesting)
// ============================================================================

export async function updateLineupDecisionWithActualResults(
  decisionId: string,
  actualPoints: number,
  alternativeResults?: Array<{ alternativeId: string; wouldHaveScored: number }>
): Promise<void> {
  try {
    const decision = await prisma.persistedDecision.findUnique({
      where: { decisionId },
    });

    if (!decision) {
      console.warn(`[PERSISTENCE] Decision not found: ${decisionId}`);
      return;
    }

    const payload = decision.decisionPayload as { expectedPoints: number };
    const projectionError = actualPoints - payload.expectedPoints;
    const projectionErrorPercent = payload.expectedPoints !== 0 
      ? (projectionError / payload.expectedPoints) * 100 
      : 0;

    // Check if any alternative would have been better
    let bestAlternativePoints = actualPoints;
    let alternativeWouldHaveBeenBetter = false;

    if (alternativeResults && alternativeResults.length > 0) {
      for (const alt of alternativeResults) {
        if (alt.wouldHaveScored > bestAlternativePoints) {
          bestAlternativePoints = alt.wouldHaveScored;
          alternativeWouldHaveBeenBetter = true;
        }
      }
    }

    // Update the persisted decision
    await prisma.persistedDecision.update({
      where: { decisionId },
      data: {
        status: 'completed',
      },
    });

    // Update detail record
    await prisma.lineupDecisionDetail.update({
      where: { decisionId },
      data: {
        actualPoints,
        projectionError,
        projectionErrorPercent,
        alternativeWouldHaveBeenBetter,
        bestAlternativePoints: alternativeWouldHaveBeenBetter ? bestAlternativePoints : null,
      },
    });

    console.log(`[PERSISTENCE] Updated lineup decision ${decisionId} with actual results: ${actualPoints} points`);
  } catch (error) {
    console.error('[PERSISTENCE] Failed to update lineup decision:', error);
  }
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
  try {
    await prisma.waiverDecisionDetail.update({
      where: { decisionId },
      data: {
        claimSucceeded: actualResult.claimSucceeded,
        actualCost: actualResult.actualCost,
        weeksOwned: actualResult.weeksOwned,
        pointsContributed: actualResult.pointsContributed,
        roi: actualResult.actualCost && actualResult.actualCost > 0
          ? (actualResult.pointsContributed / actualResult.actualCost) * 100
          : actualResult.pointsContributed,
      },
    });

    await prisma.persistedDecision.update({
      where: { decisionId },
      data: {
        status: actualResult.claimSucceeded ? 'completed' : 'rejected',
      },
    });

    console.log(`[PERSISTENCE] Updated waiver decision ${decisionId}: ${actualResult.claimSucceeded ? 'claimed' : 'failed'}`);
  } catch (error) {
    console.error('[PERSISTENCE] Failed to update waiver decision:', error);
  }
}

// ============================================================================
// Queries
// ============================================================================

export async function queryDecisions(
  query: DecisionQuery
): Promise<Array<{ decisionId: string; decisionType: string; createdAt: Date; status: string }>> {
  try {
    const where: Record<string, unknown> = {};
    
    if (query.teamId) where.teamId = query.teamId;
    if (query.decisionType) where.decisionType = query.decisionType;
    if (query.status) where.status = query.status;
    
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, string>).gte = query.startDate;
      if (query.endDate) (where.createdAt as Record<string, string>).lte = query.endDate;
    }

    const decisions = await prisma.persistedDecision.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100, // Default limit
    });

    return decisions.map((d: { decisionId: string; decisionType: string; createdAt: Date; status: string }) => ({
      decisionId: d.decisionId,
      decisionType: d.decisionType,
      createdAt: d.createdAt,
      status: d.status,
    }));
  } catch (error) {
    console.error('[PERSISTENCE] Failed to query decisions:', error);
    return [];
  }
}

export async function getDecisionById(
  decisionId: string
): Promise<unknown | null> {
  try {
    const decision = await prisma.persistedDecision.findUnique({
      where: { decisionId },
      include: {
        lineupDetail: true,
        waiverDetail: true,
      },
    });

    if (!decision) return null;

    return {
      ...decision,
      teamStateSnapshot: decision.teamStateSnapshot,
      decisionPayload: decision.decisionPayload,
      scoresSnapshot: decision.scoresSnapshot,
      monteCarloData: decision.monteCarloData,
    };
  } catch (error) {
    console.error('[PERSISTENCE] Failed to get decision:', error);
    return null;
  }
}

export async function getDecisionPerformanceSummary(
  teamId: string,
  season: number
): Promise<DecisionPerformanceSummary> {
  try {
    const decisions = await prisma.persistedDecision.findMany({
      where: { teamId, season },
      include: {
        lineupDetail: true,
        waiverDetail: true,
      },
    });

    const lineupDecisions = decisions.filter((d: any) => d.decisionType === 'lineup');
    const waiverDecisions = decisions.filter((d: any) => d.decisionType === 'waiver');
    
    const completedLineupDecisions = lineupDecisions.filter((d: any) => d.lineupDetail?.actualPoints !== null);
    
    // Calculate lineup accuracy metrics
    let totalLineupError = 0;
    let totalLineupErrorPercent = 0;
    let decisionsWhereAlternativeBetter = 0;
    
    for (const d of completedLineupDecisions) {
      if (d.lineupDetail?.projectionError) {
        totalLineupError += Math.abs(d.lineupDetail.projectionError);
        totalLineupErrorPercent += Math.abs(d.lineupDetail.projectionErrorPercent ?? 0);
      }
      if (d.lineupDetail?.alternativeWouldHaveBeenBetter) {
        decisionsWhereAlternativeBetter++;
      }
    }

    const avgLineupError = completedLineupDecisions.length > 0 
      ? totalLineupError / completedLineupDecisions.length 
      : 0;
    const avgLineupErrorPercent = completedLineupDecisions.length > 0 
      ? totalLineupErrorPercent / completedLineupDecisions.length 
      : 0;

    // Calculate waiver ROI
    const completedWaiverDecisions = waiverDecisions.filter((d: any) => d.waiverDetail?.claimSucceeded !== null);
    let totalWaiverSpend = 0;
    let totalWaiverReturn = 0;
    
    for (const d of completedWaiverDecisions) {
      if (d.waiverDetail?.claimSucceeded && d.waiverDetail.actualCost) {
        totalWaiverSpend += d.waiverDetail.actualCost;
        totalWaiverReturn += d.waiverDetail.pointsContributed ?? 0;
      }
    }

    const waiverRoi = totalWaiverSpend > 0 
      ? ((totalWaiverReturn - totalWaiverSpend) / totalWaiverSpend) * 100 
      : 0;

    // Confidence-based accuracy (using numeric thresholds)
    // Confidence is stored as a float (0-1), so we use numeric comparisons
    const highConfidenceDecisions = completedLineupDecisions.filter((d: any) => d.confidence >= 0.8);
    const lowConfidenceDecisions = completedLineupDecisions.filter((d: any) => d.confidence <= 0.4);
    
    const highConfidenceAccuracy = highConfidenceDecisions.length > 0
      ? highConfidenceDecisions.filter((d: any) => (d.lineupDetail?.projectionErrorPercent ?? 100) < 20).length / highConfidenceDecisions.length
      : 0;
    
    const lowConfidenceAccuracy = lowConfidenceDecisions.length > 0
      ? lowConfidenceDecisions.filter((d: any) => (d.lineupDetail?.projectionErrorPercent ?? 100) < 20).length / lowConfidenceDecisions.length
      : 0;

    return {
      totalDecisions: decisions.length,
      executedDecisions: decisions.filter((d: { status: string }) => d.status === 'completed').length,
      lineupDecisions: lineupDecisions.length,
      waiverDecisions: waiverDecisions.length,
      avgLineupError,
      avgLineupErrorPercent,
      decisionsWhereAlternativeBetter,
      totalWaiverSpend,
      totalWaiverReturn,
      waiverRoi,
      highConfidenceAccuracy,
      lowConfidenceAccuracy,
    };
  } catch (error) {
    console.error('[PERSISTENCE] Failed to get performance summary:', error);
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
}

// ============================================================================
// Type helper for Prisma JSON
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
