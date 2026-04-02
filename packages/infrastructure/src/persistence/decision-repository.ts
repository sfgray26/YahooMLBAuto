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
} from '../../../core/src/persistence/contract.js';
import type { TeamState } from '../../../core/src/team/contract.js';
import type { PlayerScore } from '../../../worker/src/scoring/index.js';
import type { PitcherScore } from '../../../worker/src/pitchers/index.js';
import type { PitcherOutcomeDistribution } from '../../../worker/src/pitchers/monte-carlo.js';

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
  hitterScores: Map<string, PlayerScore>,
  pitcherScores: Map<string, PitcherScore>
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  
  for (const [mlbamId, score] of hitterScores) {
    snapshot[score.playerId] = {
      mlbamId,
      domain: 'hitting',
      overallValue: score.overallValue,
      components: score.components,
      confidence: score.confidence,
      reliability: score.reliability,
    };
  }
  
  for (const [mlbamId, score] of pitcherScores) {
    snapshot[score.playerId] = {
      mlbamId,
      domain: 'pitching',
      overallValue: score.overallValue,
      components: score.components,
      confidence: score.confidence,
      reliability: score.reliability,
      role: score.role,
    };
  }
  
  return snapshot;
}

function buildMonteCarloSnapshot(
  pitcherOutcomes: Map<string, PitcherOutcomeDistribution>
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
  hitterScores: Map<string, PlayerScore>;
  pitcherScores: Map<string, PitcherScore>;
  pitcherMonteCarlo?: Map<string, PitcherOutcomeDistribution>;
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
        leagueId: lineupDecision.leagueId,
        season: lineupDecision.season,
        status: lineupDecision.status,
        teamStateSnapshot,
        decisionPayload: {
          optimalLineup: lineupDecision.optimalLineup,
          benchDecisions: lineupDecision.benchDecisions,
          expectedPoints: lineupDecision.expectedPoints,
          alternatives: lineupDecision.alternatives,
          confidenceScore: lineupDecision.confidenceScore,
          lockedPlayerCount: lineupDecision.lockedPlayerCount,
        },
        scoresSnapshot,
        monteCarloData: monteCarloSnapshot,
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
        optimalLineup: lineupDecision.optimalLineup,
        benchDecisions: lineupDecision.benchDecisions,
        expectedPoints: lineupDecision.expectedPoints,
        confidenceScore: lineupDecision.confidenceScore,
        alternatives: lineupDecision.alternatives,
        keyDecisions: lineupDecision.keyDecisions || [],
        lockedPlayerCount: lineupDecision.lockedPlayerCount,
        injuredPlayerCount: teamState.roster.players.filter(p => p.isInjured).length,
      },
    });
    
    console.log(`[PERSISTENCE] Lineup decision stored: ${lineupDecision.decisionId}`);
    
    return { success: true, decisionId: lineupDecision.decisionId };
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
  hitterScores: Map<string, PlayerScore>;
  pitcherScores: Map<string, PitcherScore>;
  pitcherMonteCarlo?: Map<string, PitcherOutcomeDistribution>;
  traceId: string;
}

export async function persistWaiverDecision(
  input: PersistWaiverDecisionInput
): Promise<{ success: boolean; decisionId: string }> {
  const { teamState, waiverDecision, hitterScores, pitcherScores, pitcherMonteCarlo, traceId } = input;
  
  try {
    const teamStateSnapshot = buildTeamStateSnapshot(teamState);
    const scoresSnapshot = buildScoresSnapshot(hitterScores, pitcherScores);
    const monteCarloSnapshot = pitcherMonteCarlo 
      ? buildMonteCarloSnapshot(pitcherMonteCarlo) 
      : undefined;
    
    const persisted = await prisma.persistedDecision.create({
      data: {
        decisionId: waiverDecision.decisionId,
        decisionType: waiverDecision.decisionType,
        teamId: waiverDecision.teamId,
        leagueId: waiverDecision.leagueId,
        season: waiverDecision.season,
        status: waiverDecision.status,
        teamStateSnapshot,
        decisionPayload: {
          targetPlayer: waiverDecision.targetPlayer,
          dropPlayer: waiverDecision.dropPlayer,
          bidAmount: waiverDecision.bidAmount,
          expectedValueAdd: waiverDecision.expectedValueAdd,
          expectedValueDrop: waiverDecision.expectedValueDrop,
          netValue: waiverDecision.netValue,
        },
        scoresSnapshot,
        monteCarloData: monteCarloSnapshot,
        confidence: waiverDecision.confidence,
        confidenceFactors: [
          `faab_remaining:${teamState.waiverState.budgetRemaining}`,
          `roster_size:${teamState.roster.players.length}`,
        ],
        traceId,
        reason: waiverDecision.reason,
      },
    });
    
    await prisma.waiverDecisionDetail.create({
      data: {
        decisionId: waiverDecision.decisionId,
        targetPlayerId: waiverDecision.targetPlayer.playerId,
        targetPlayerName: waiverDecision.targetPlayer.name,
        targetPlayerMlbamId: waiverDecision.targetPlayer.mlbamId,
        dropPlayerId: waiverDecision.dropPlayer?.playerId,
        dropPlayerName: waiverDecision.dropPlayer?.name,
        targetValue: waiverDecision.expectedValueAdd,
        dropValue: waiverDecision.expectedValueDrop || 0,
        netValue: waiverDecision.netValue,
        bidAmount: waiverDecision.bidAmount,
        waiverPriority: waiverDecision.waiverPriority,
        faabRemaining: waiverDecision.faabBudgetRemaining,
        rosterAnalysis: waiverDecision.rosterAnalysisSnapshot,
      },
    });
    
    console.log(`[PERSISTENCE] Waiver decision stored: ${waiverDecision.decisionId}`);
    
    return { success: true, decisionId: waiverDecision.decisionId };
  } catch (error) {
    console.error('[PERSISTENCE] Failed to persist waiver decision:', error);
    return { success: false, decisionId: waiverDecision.decisionId };
  }
}

// ============================================================================
// Decision Updates (For Backtesting)
// ============================================================================

export async function updateLineupDecisionWithActualResults(
  decisionId: string,
  actualPoints: number,
  alternativeResults?: Array<{ alternativeId: string; wouldHaveScored: number }>
): Promise<void> {
  try {
    const decision = await prisma.lineupDecisionDetail.findUnique({
      where: { decisionId },
    });
    
    if (!decision) {
      console.error(`[PERSISTENCE] Lineup decision not found: ${decisionId}`);
      return;
    }
    
    const projectionError = actualPoints - decision.expectedPoints;
    const projectionErrorPercent = decision.expectedPoints !== 0 
      ? (projectionError / decision.expectedPoints) * 100 
      : 0;
    
    // Check if any alternative would have been better
    let bestAlternativePoints = decision.expectedPoints;
    let alternativeWouldHaveBeenBetter = false;
    
    if (alternativeResults && alternativeResults.length > 0) {
      for (const alt of alternativeResults) {
        if (alt.wouldHaveScored > bestAlternativePoints) {
          bestAlternativePoints = alt.wouldHaveScored;
          alternativeWouldHaveBeenBetter = true;
        }
      }
    }
    
    await prisma.lineupDecisionDetail.update({
      where: { decisionId },
      data: {
        actualPoints,
        projectionError,
        projectionErrorPercent,
        alternativeWouldHaveBeenBetter,
        bestAlternativePoints,
      },
    });
    
    await prisma.persistedDecision.update({
      where: { decisionId },
      data: {
        actualResult: { actualPoints, projectionError, projectionErrorPercent },
        accuracyMetrics: {
          projectionError,
          projectionErrorPercent,
          alternativeWouldHaveBeenBetter,
          bestAlternativePoints,
        },
      },
    });
    
    console.log(`[PERSISTENCE] Updated lineup decision ${decisionId} with actual points: ${actualPoints}`);
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
    const decision = await prisma.waiverDecisionDetail.findUnique({
      where: { decisionId },
    });
    
    if (!decision) {
      console.error(`[PERSISTENCE] Waiver decision not found: ${decisionId}`);
      return;
    }
    
    const roi = decision.bidAmount && decision.bidAmount > 0
      ? (actualResult.pointsContributed / decision.bidAmount) * 100
      : actualResult.pointsContributed;  // If free, ROI is just points
    
    await prisma.waiverDecisionDetail.update({
      where: { decisionId },
      data: {
        claimSucceeded: actualResult.claimSucceeded,
        actualCost: actualResult.actualCost,
        weeksOwned: actualResult.weeksOwned,
        pointsContributed: actualResult.pointsContributed,
        roi,
        wasGoodDecision: actualResult.wasGoodDecision,
      },
    });
    
    await prisma.persistedDecision.update({
      where: { decisionId },
      data: {
        actualResult,
        accuracyMetrics: { roi, wasGoodDecision: actualResult.wasGoodDecision },
      },
    });
    
    console.log(`[PERSISTENCE] Updated waiver decision ${decisionId} with results: ${actualResult.claimSucceeded ? 'claimed' : 'failed'}`);
  } catch (error) {
    console.error('[PERSISTENCE] Failed to update waiver decision:', error);
  }
}

// ============================================================================
// Decision Queries
// ============================================================================

export async function queryDecisions(
  query: DecisionQuery
): Promise<Array<{ decisionId: string; decisionType: string; createdAt: Date; status: string }>> {
  const where: Record<string, unknown> = {};
  
  if (query.teamId) where.teamId = query.teamId;
  if (query.decisionType) where.decisionType = query.decisionType;
  if (query.status) where.status = query.status;
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) (where.createdAt as Record<string, Date>).gte = new Date(query.startDate);
    if (query.endDate) (where.createdAt as Record<string, Date>).lte = new Date(query.endDate);
  }
  
  const decisions = await prisma.persistedDecision.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      decisionId: true,
      decisionType: true,
      createdAt: true,
      status: true,
    },
  });
  
  return decisions;
}

export async function getDecisionById(
  decisionId: string
): Promise<unknown | null> {
  const decision = await prisma.persistedDecision.findUnique({
    where: { decisionId },
    include: {
      lineupDetail: true,
      waiverDetail: true,
    },
  });
  
  return decision;
}

// ============================================================================
// Performance Analysis
// ============================================================================

export async function getDecisionPerformanceSummary(
  teamId: string,
  season: number
): Promise<DecisionPerformanceSummary> {
  const decisions = await prisma.persistedDecision.findMany({
    where: { teamId, season },
    include: {
      lineupDetail: true,
      waiverDetail: true,
    },
  });
  
  const lineupDecisions = decisions.filter(d => d.decisionType === 'lineup');
  const waiverDecisions = decisions.filter(d => 
    ['waiver_add', 'waiver_drop', 'waiver_swap'].includes(d.decisionType)
  );
  
  // Lineup accuracy
  const lineupWithResults = lineupDecisions.filter(d => d.lineupDetail?.actualPoints != null);
  const totalLineupError = lineupWithResults.reduce(
    (sum, d) => sum + (d.lineupDetail?.projectionError || 0), 
    0
  );
  const avgLineupError = lineupWithResults.length > 0 
    ? totalLineupError / lineupWithResults.length 
    : 0;
  const avgLineupErrorPercent = lineupWithResults.length > 0
    ? lineupWithResults.reduce((sum, d) => sum + (d.lineupDetail?.projectionErrorPercent || 0), 0) / lineupWithResults.length
    : 0;
  
  const alternativesBetter = lineupWithResults.filter(
    d => d.lineupDetail?.alternativeWouldHaveBeenBetter
  ).length;
  
  // Waiver ROI
  const waiverWithResults = waiverDecisions.filter(d => d.waiverDetail?.claimSucceeded != null);
  const totalSpend = waiverWithResults.reduce(
    (sum, d) => sum + (d.waiverDetail?.actualCost || 0), 
    0
  );
  const totalReturn = waiverWithResults.reduce(
    (sum, d) => sum + (d.waiverDetail?.pointsContributed || 0), 
    0
  );
  const waiverRoi = totalSpend > 0 ? (totalReturn / totalSpend) * 100 : 0;
  
  return {
    totalDecisions: decisions.length,
    executedDecisions: decisions.filter(d => d.status === 'executed').length,
    lineupDecisions: lineupDecisions.length,
    waiverDecisions: waiverDecisions.length,
    avgLineupError,
    avgLineupErrorPercent,
    decisionsWhereAlternativeBetter: alternativesBetter,
    totalWaiverSpend: totalSpend,
    totalWaiverReturn: totalReturn,
    waiverRoi,
    highConfidenceAccuracy: 0,  // TODO: Calculate by confidence level
    lowConfidenceAccuracy: 0,
  };
}
