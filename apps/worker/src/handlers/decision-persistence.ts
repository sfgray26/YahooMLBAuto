import { v4 as uuidv4 } from 'uuid';

import {
  persistLineupDecision,
  persistWaiverDecision,
} from '@cbb/infrastructure';
import type {
  BenchDecision,
  LineupDecisionRecord,
  LineupOptimizationResult,
  RosterAnalysisSnapshot,
  TeamState,
  WaiverDecisionRecord,
  WaiverRecommendationResult,
} from '@cbb/core';

import type { PlayerScore } from '../scoring/index.js';
import type { PitcherScore } from '../pitchers/index.js';

type HitterScoreMap = Map<string, PlayerScore>;
type PitcherScoreMap = Map<string, PitcherScore>;

function isPitcherScore(score: PlayerScore | PitcherScore | undefined): score is PitcherScore {
  return Boolean(score && 'role' in score);
}

function toPersistedHitterScores(scores: HitterScoreMap) {
  return new Map(
    Array.from(scores.entries()).map(([mlbamId, score]) => [
      mlbamId,
      {
        playerId: score.playerId,
        mlbamId,
        overallValue: score.overallValue,
        components: score.components,
        confidence: score.confidence,
        domain: 'hitting' as const,
      },
    ])
  );
}

function toPersistedPitcherScores(scores: PitcherScoreMap) {
  return new Map(
    Array.from(scores.entries()).map(([mlbamId, score]) => [
      mlbamId,
      {
        playerId: score.playerId,
        mlbamId,
        overallValue: score.overallValue,
        components: score.components,
        confidence: score.confidence,
        domain: 'pitching' as const,
        role: {
          currentRole: score.role.currentRole,
          isCloser: score.role.isCloser,
        },
      },
    ])
  );
}

function buildBenchDecisions(
  teamState: TeamState,
  result: LineupOptimizationResult,
  hitterScores: HitterScoreMap,
  pitcherScores: PitcherScoreMap
): BenchDecision[] {
  const starterIds = new Set(result.optimalLineup.map((slot) => slot.player.id));

  return teamState.roster.players
    .filter((player) => !starterIds.has(player.playerId))
    .map((player) => {
      const hitterScore = hitterScores.get(player.mlbamId);
      const pitcherScore = pitcherScores.get(player.mlbamId);
      const overallValue = hitterScore?.overallValue ?? pitcherScore?.overallValue ?? 0;

      let reason: BenchDecision['reason'] = 'depth';
      if (player.isInjured) reason = 'injured';
      else if (pitcherScore?.role.startProbabilityNext7 && pitcherScore.role.startProbabilityNext7 > 0.7) {
        reason = 'streaming_candidate';
      } else if (overallValue >= 55) {
        reason = 'matchup_play';
      }

      return {
        playerId: player.playerId,
        mlbamId: player.mlbamId,
        playerName: player.name,
        reason,
        overallValue,
      };
    });
}

function buildRosterAnalysisSnapshot(result: WaiverRecommendationResult): RosterAnalysisSnapshot {
  return {
    strengths: result.rosterAnalysis.strengths,
    weaknesses: result.rosterAnalysis.weaknesses,
    opportunities: result.rosterAnalysis.opportunities,
    positionDepth: {},
    benchUtilization: 0,
  };
}

export async function persistLineupDecisionSnapshot(input: {
  requestId: string;
  traceId: string;
  teamState: TeamState;
  result: LineupOptimizationResult;
  hitterScores: HitterScoreMap;
  pitcherScores: PitcherScoreMap;
}): Promise<void> {
  const { requestId, traceId, teamState, result, hitterScores, pitcherScores } = input;

  const record: LineupDecisionRecord = {
    decisionId: requestId,
    decisionType: 'lineup',
    teamId: teamState.identity.teamId,
    leagueId: teamState.identity.leagueId,
    season: teamState.identity.season,
    createdAt: result.generatedAt,
    executedAt: null,
    status: 'pending',
    reason: result.explanation.summary,
    confidence: result.confidenceScore,
    scoringPeriod: teamState.identity.scoringPeriod.startDate,
    teamStateSnapshot: {
      version: teamState.roster.version,
      capturedAt: result.generatedAt,
      roster: [],
      lineupSlots: [],
      currentLineup: { assignments: [], lockedSlots: [], benchPlayerIds: [] },
      waiverBudget: {
        remaining: teamState.waiverState.budgetRemaining,
        total: teamState.waiverState.budgetTotal,
      },
    },
    optimalLineup: result.optimalLineup.map((slot) => {
      const hitterScore = hitterScores.get(slot.player.mlbamId);
      const pitcherScore = pitcherScores.get(slot.player.mlbamId);
      const score = hitterScore ?? pitcherScore;

      return {
        slotId: slot.position,
        playerId: slot.player.id,
        mlbamId: slot.player.mlbamId,
        playerName: slot.player.name,
        projectedPoints: slot.projectedPoints,
        confidence: slot.confidence,
        overallValue: score?.overallValue ?? 0,
        componentScores: score?.components ?? {},
      };
    }),
    benchDecisions: buildBenchDecisions(teamState, result, hitterScores, pitcherScores),
    expectedPoints: result.expectedPoints,
    alternatives: result.alternativeLineups.map((lineup, index) => ({
      description: lineup.tradeoffDescription,
      expectedPoints: lineup.expectedPoints,
      varianceVsOptimal: lineup.varianceVsOptimal,
      slotChanges: lineup.lineup.map((slot) => ({
        slotId: slot.position,
        fromPlayerId: slot.player.id,
        toPlayerId: slot.player.id,
      })),
    })),
    keyDecisions: result.explanation.keyDecisions.map((decision) => ({
      position: decision.position,
      chosenPlayerId: decision.chosenPlayer.id,
      chosenPlayerName: decision.chosenPlayer.name,
      alternativesConsidered: decision.alternativesConsidered.map((player) => player.id),
      whyChosen: decision.whyChosen,
    })),
    confidenceScore: result.confidenceScore,
    lockedPlayerCount: teamState.currentLineup.lockedSlots.length,
    actualPoints: null,
    accuracyMetrics: null,
  };

  await persistLineupDecision({
    teamState,
    lineupDecision: record,
    hitterScores: toPersistedHitterScores(hitterScores),
    pitcherScores: toPersistedPitcherScores(pitcherScores),
    traceId: `${traceId}:persisted-lineup`,
  });
}

export async function persistWaiverDecisionSnapshot(input: {
  requestId: string;
  traceId: string;
  teamState: TeamState;
  result: WaiverRecommendationResult;
  hitterScores: HitterScoreMap;
  pitcherScores: PitcherScoreMap;
}): Promise<void> {
  const { requestId, traceId, teamState, result, hitterScores, pitcherScores } = input;
  const topRecommendation = result.recommendations[0];

  if (!topRecommendation) {
    return;
  }

  const targetScore = hitterScores.get(topRecommendation.player.mlbamId) ?? pitcherScores.get(topRecommendation.player.mlbamId);
  const dropScore = topRecommendation.dropCandidate
    ? hitterScores.get(topRecommendation.dropCandidate.mlbamId) ?? pitcherScores.get(topRecommendation.dropCandidate.mlbamId)
    : undefined;

  const decisionType: WaiverDecisionRecord['decisionType'] =
    topRecommendation.action === 'swap'
      ? 'waiver_swap'
      : topRecommendation.action === 'drop'
        ? 'waiver_drop'
        : 'waiver_add';

  const record: WaiverDecisionRecord = {
    decisionId: requestId,
    decisionType,
    teamId: teamState.identity.teamId,
    leagueId: teamState.identity.leagueId,
    season: teamState.identity.season,
    createdAt: result.generatedAt,
    executedAt: null,
    status: 'pending',
    reason: topRecommendation.reasoning,
    confidence: targetScore?.confidence ?? 0,
    teamStateSnapshot: {
      version: teamState.roster.version,
      capturedAt: result.generatedAt,
      roster: [],
      lineupSlots: [],
      currentLineup: { assignments: [], lockedSlots: [], benchPlayerIds: [] },
      waiverBudget: {
        remaining: teamState.waiverState.budgetRemaining,
        total: teamState.waiverState.budgetTotal,
      },
    },
    targetPlayer: {
      playerId: topRecommendation.player.id,
      mlbamId: topRecommendation.player.mlbamId,
      name: topRecommendation.player.name,
      team: topRecommendation.player.team,
      positions: topRecommendation.player.position,
      percentOwned: null,
      overallValue: targetScore?.overallValue ?? 0,
      componentScores: targetScore?.components ?? {},
      confidence: targetScore?.confidence ?? 0,
      role: isPitcherScore(targetScore)
        ? {
            currentRole: targetScore.role.currentRole,
            isCloser: targetScore.role.isCloser,
            waiverEdge: topRecommendation.expectedValue,
          }
        : undefined,
    },
    dropPlayer: topRecommendation.dropCandidate
      ? {
          playerId: topRecommendation.dropCandidate.id,
          mlbamId: topRecommendation.dropCandidate.mlbamId,
          name: topRecommendation.dropCandidate.name,
          team: topRecommendation.dropCandidate.team,
          positions: topRecommendation.dropCandidate.position,
          percentOwned: null,
          overallValue: dropScore?.overallValue ?? 0,
          componentScores: dropScore?.components ?? {},
          confidence: dropScore?.confidence ?? 0,
        }
      : undefined,
    bidAmount: undefined,
    reasoning: topRecommendation.reasoning,
    rosterAnalysisSnapshot: buildRosterAnalysisSnapshot(result),
    expectedValueAdd: targetScore?.overallValue ?? topRecommendation.expectedValue,
    expectedValueDrop: dropScore?.overallValue ?? 0,
    netValue: topRecommendation.expectedValue,
    waiverPriority: topRecommendation.rank,
    faabBudgetRemaining: teamState.waiverState.budgetRemaining,
    actualResult: null,
  };

  await persistWaiverDecision({
    teamState,
    waiverDecision: record,
    hitterScores: toPersistedHitterScores(hitterScores),
    pitcherScores: toPersistedPitcherScores(pitcherScores),
    traceId: `${traceId}:persisted-waiver`,
  });
}
