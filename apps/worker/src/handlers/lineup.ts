/**
 * Lineup Optimization Handler
 *
 * Builds a TeamState from the request payload and feeds deterministic
 * hitter/pitcher scores into the lineup assembly layer.
 */

import { v4 as uuidv4 } from 'uuid';

import { prisma } from '@cbb/infrastructure';
import { validateTeamState, type LineupOptimizationRequest, type LineupOptimizationResult } from '@cbb/core';

import { assembleLineup, type AssemblyInput } from '../decisions/index.js';
import { persistLineupDecisionSnapshot } from './decision-persistence.js';
import { buildTeamStateFromLineupRequest, getSeasonFromTimestamp, loadScoreMaps } from './request-context.js';

export async function handleLineupOptimization(
  request: LineupOptimizationRequest,
  traceId: string
): Promise<LineupOptimizationResult> {
  const startTime = Date.now();

  if (request.availablePlayers.players.length === 0) {
    throw new Error('Lineup optimization requires at least one hydrated roster player');
  }

  console.log('[LINEUP] Processing optimization request', {
    requestId: request.id,
    scoringPeriod: request.scoringPeriod.type,
    playerCount: request.availablePlayers.players.length,
  });

  const teamState = buildTeamStateFromLineupRequest(request);
  const validation = validateTeamState(teamState);
  if (!validation.isValid) {
    throw new Error(`Invalid team state for lineup optimization: ${validation.errors.join(', ')}`);
  }

  const season = getSeasonFromTimestamp(request.scoringPeriod.startDate);
  const { hitterScores, pitcherScores } = await loadScoreMaps(
    teamState.roster.players.map((player) => ({
      mlbamId: player.mlbamId,
      positions: player.positions,
    })),
    season
  );

  const missingRosterPlayers = teamState.roster.players
    .filter((player) => !player.isInjured || player.injuryStatus === 'day_to_day')
    .filter((player) => {
      const isPitcher = player.positions.some((position) => ['SP', 'RP', 'P', 'CL'].includes(position.toUpperCase()));
      return isPitcher
        ? !pitcherScores.has(player.mlbamId)
        : !hitterScores.has(player.mlbamId);
    });

  if (missingRosterPlayers.length > 0) {
    throw new Error(
      `Lineup optimization requires complete score coverage; missing ${missingRosterPlayers.length} roster player scores`
    );
  }

  if (hitterScores.size === 0 && pitcherScores.size === 0) {
    throw new Error('No derived hitter or pitcher scores were available for the requested roster');
  }

  const assemblyInput: AssemblyInput = {
    teamState,
    hitterScores,
    pitcherScores,
    manualLocks: new Set(request.rosterConstraints.mustInclude ?? []),
    excludedPlayerIds: new Set(request.rosterConstraints.mustExclude ?? []),
  };

  const assemblyResult = assembleLineup(assemblyInput);
  if (!assemblyResult.success || !assemblyResult.result) {
    throw new Error(`Lineup assembly failed: ${assemblyResult.errors.join(', ')}`);
  }

  const result: LineupOptimizationResult = {
    ...assemblyResult.result,
    requestId: request.id,
  };

  await prisma.lineupResult.create({
    data: {
      id: uuidv4(),
      requestId: request.id,
      scoringPeriodStart: new Date(request.scoringPeriod.startDate),
      scoringPeriodEnd: new Date(request.scoringPeriod.endDate),
      expectedPoints: result.expectedPoints,
      confidenceScore: result.confidenceScore,
      optimalLineup: result.optimalLineup as unknown as object,
      alternativeLineups: result.alternativeLineups as unknown as object,
      explanation: result.explanation as unknown as object,
      traceId,
    },
  });

  await persistLineupDecisionSnapshot({
    requestId: request.id,
    traceId,
    teamState,
    result,
    hitterScores,
    pitcherScores,
  });

  console.log('[LINEUP] Optimization complete', {
    requestId: request.id,
    expectedPoints: result.expectedPoints.toFixed(1),
    lineupSize: result.optimalLineup.length,
    durationMs: Date.now() - startTime,
  });

  return result;
}
