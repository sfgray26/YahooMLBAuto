/**
 * Waiver Recommendation Handler
 *
 * Builds a TeamState from the roster payload and compares it against a hydrated
 * waiver pool using deterministic hitter and pitcher scores.
 */

import { v4 as uuidv4 } from 'uuid';

import { prisma } from '@cbb/infrastructure';
import { validateTeamState, type WaiverRecommendationRequest, type WaiverRecommendationResult } from '@cbb/core';

import { assembleWaiverDecisions, type AvailablePlayer, type WaiverAssemblyInput } from '../decisions/index.js';
import { persistWaiverDecisionSnapshot } from './decision-persistence.js';
import { buildTeamStateFromWaiverRequest, getSeasonFromTimestamp, loadScoreMaps } from './request-context.js';

export async function handleWaiverRecommendation(
  request: WaiverRecommendationRequest,
  traceId: string
): Promise<WaiverRecommendationResult> {
  if (request.currentRoster.length === 0) {
    throw new Error('Waiver recommendation requires a hydrated current roster');
  }

  if (request.availablePlayers.players.length === 0) {
    throw new Error('Waiver recommendation requires at least one available player');
  }

  console.log('[WAIVER] Processing waiver request', {
    requestId: request.id,
    scope: request.recommendationScope,
    rosterSize: request.currentRoster.length,
    availablePlayers: request.availablePlayers.players.length,
  });

  const teamState = buildTeamStateFromWaiverRequest(request);
  const validation = validateTeamState(teamState);
  if (!validation.isValid) {
    throw new Error(`Invalid team state for waiver recommendation: ${validation.errors.join(', ')}`);
  }

  const season = getSeasonFromTimestamp(request.createdAt);
  const { hitterScores, pitcherScores } = await loadScoreMaps(
    [
      ...teamState.roster.players.map((player) => ({
        mlbamId: player.mlbamId,
        positions: player.positions,
      })),
      ...request.availablePlayers.players.map((player) => ({
        mlbamId: player.player.mlbamId,
        positions: player.player.position,
      })),
    ],
    season
  );

  const missingPoolPlayers = request.availablePlayers.players
    .filter((player) => player.isAvailable)
    .filter((player) => {
      const positions = player.player.position;
      const isPitcher = positions.some((position) => ['SP', 'RP', 'P', 'CL'].includes(position.toUpperCase()));
      return isPitcher
        ? !pitcherScores.has(player.player.mlbamId)
        : !hitterScores.has(player.player.mlbamId);
    });

  if (missingPoolPlayers.length > 0) {
    throw new Error(
      `Waiver recommendation requires complete score coverage; missing ${missingPoolPlayers.length} available player scores`
    );
  }

  if (hitterScores.size === 0 && pitcherScores.size === 0) {
    throw new Error('No derived hitter or pitcher scores were available for the roster or waiver pool');
  }

  const availablePlayers: AvailablePlayer[] = request.availablePlayers.players
    .filter((player) => player.isAvailable)
    .map((player) => ({
      playerId: player.player.id,
      mlbamId: player.player.mlbamId,
      name: player.player.name,
      team: player.player.team,
      positions: player.player.position,
      percentOwned: 0,
      percentStarted: 0,
    }));

  const assemblyInput: WaiverAssemblyInput = {
    teamState,
    hitterScores,
    pitcherScores,
    availablePlayers,
  };

  const assemblyResult = assembleWaiverDecisions(assemblyInput);
  if (!assemblyResult.success || !assemblyResult.result) {
    throw new Error(`Waiver assembly failed: ${assemblyResult.errors.join(', ')}`);
  }

  const result: WaiverRecommendationResult = {
    ...assemblyResult.result,
    requestId: request.id,
  };

  await prisma.waiverResult.create({
    data: {
      id: uuidv4(),
      requestId: request.id,
      recommendations: result.recommendations as unknown as object,
      rosterAnalysis: result.rosterAnalysis as unknown as object,
      traceId,
    },
  });

  await persistWaiverDecisionSnapshot({
    requestId: request.id,
    traceId,
    teamState,
    result,
    hitterScores,
    pitcherScores,
  });

  console.log('[WAIVER] Recommendations generated', {
    requestId: request.id,
    recommendationCount: result.recommendations.length,
    topPlayer: result.recommendations[0]?.player.name ?? 'none',
  });

  return result;
}
