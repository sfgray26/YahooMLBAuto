/**
 * Lineup Optimization Handler
 *
 * Real implementation using Decision Assembly.
 * Consumes PlayerScores, produces LineupOptimizationResult.
 */

import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@cbb/infrastructure';
import type { LineupOptimizationRequest, LineupOptimizationResult } from '@cbb/core';

import { assembleLineup, type AssemblyInput } from '../decisions/index.js';
import { scorePlayers, type PlayerScore } from '../scoring/index.js';

export async function handleLineupOptimization(
  request: LineupOptimizationRequest,
  traceId: string
): Promise<LineupOptimizationResult> {
  const startTime = Date.now();

  console.log('[LINEUP] Processing optimization request', {
    requestId: request.id,
    scoringPeriod: request.scoringPeriod.type,
    playerCount: request.availablePlayers.players.length,
  });

  // Step 1: Get player scores for all available players
  const playerScores = await getPlayerScores(request);

  console.log('[LINEUP] Retrieved scores for', playerScores.size, 'players');

  // Step 2: Assemble lineup using deterministic logic
  const assemblyInput: AssemblyInput = {
    request,
    playerScores,
  };

  const assemblyResult = assembleLineup(assemblyInput);

  if (!assemblyResult.success || !assemblyResult.result) {
    throw new Error(
      `Lineup assembly failed: ${assemblyResult.errors.join(', ')}`
    );
  }

  const result = assemblyResult.result;

  // Step 3: Store result
  await prisma.lineupResult.create({
    data: {
      id: uuidv4(),
      requestId: request.id,
      scoringPeriodStart: new Date(request.scoringPeriod.startDate),
      scoringPeriodEnd: new Date(request.scoringPeriod.endDate),
      expectedPoints: result.expectedPoints,
      confidenceScore: result.confidenceScore,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      optimalLineup: result.optimalLineup as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alternativeLineups: result.alternativeLineups as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      explanation: result.explanation as any,
      traceId,
    },
  });

  console.log('[LINEUP] Optimization complete', {
    requestId: request.id,
    expectedPoints: result.expectedPoints.toFixed(1),
    lineupSize: result.optimalLineup.length,
    durationMs: Date.now() - startTime,
  });

  return result;
}

/**
 * Get player scores for all players in the request.
 */
async function getPlayerScores(
  request: LineupOptimizationRequest
): Promise<Map<string, PlayerScore>> {
  const playerScores = new Map<string, PlayerScore>();
  const season = parseInt(request.scoringPeriod.startDate.split('-')[0]);

  // Get mlbamIds for all available players
  const mlbamIds = request.availablePlayers.players
    .filter((p) => p.isAvailable)
    .map((p) => p.player.mlbamId);

  // Fetch derived features and compute scores
  for (const mlbamId of mlbamIds) {
    const derivedRecord = await prisma.playerDerivedStats.findFirst({
      where: { playerMlbamId: mlbamId, season },
      orderBy: { computedAt: 'desc' },
    });

    if (!derivedRecord) continue;

    // Compute score on-the-fly
    const score = computeScoreFromRecord(derivedRecord);
    playerScores.set(mlbamId, score);
  }

  return playerScores;
}

/**
 * Compute a PlayerScore from a database record.
 * Matches the logic in the scoring module.
 */
function computeScoreFromRecord(record: {
  playerId: string;
  playerMlbamId: string;
  season: number;
  computedAt: Date;
  gamesLast7: number;
  gamesLast14: number;
  gamesLast30: number;
  plateAppearancesLast7: number;
  plateAppearancesLast14: number;
  plateAppearancesLast30: number;
  atBatsLast30: number;
  battingAverageLast30: number | null;
  onBasePctLast30: number | null;
  sluggingPctLast30: number | null;
  opsLast30: number | null;
  isoLast30: number | null;
  walkRateLast30: number | null;
  strikeoutRateLast30: number | null;
  babipLast30: number | null;
  battingAverageReliable: boolean;
  obpReliable: boolean;
  slgReliable: boolean;
  opsReliable: boolean;
  gamesToReliable: number;
  hitConsistencyScore: number;
  productionVolatility: number;
  zeroHitGamesLast14: number;
  multiHitGamesLast14: number;
  gamesStartedLast14: number;
  lineupSpot: number | null;
  platoonRisk: string | null;
  playingTimeTrend: string | null;
  positionEligibility: string[];
  waiverWireValue: number | null;
  rosteredPercent: number | null;
}): PlayerScore {
  // Simple scoring logic (matches the worker scoring module)
  let overallValue = 50;

  // OPS contribution
  if (record.opsLast30 !== null) {
    if (record.opsLast30 >= 0.900) overallValue += 20;
    else if (record.opsLast30 >= 0.800) overallValue += 15;
    else if (record.opsLast30 >= 0.750) overallValue += 10;
    else if (record.opsLast30 >= 0.700) overallValue += 5;
    else if (record.opsLast30 < 0.650) overallValue -= 10;
  }

  // Games played contribution
  const gamesRate = record.gamesLast30 / 30;
  if (gamesRate >= 0.9) overallValue += 10;
  else if (gamesRate >= 0.8) overallValue += 5;
  else if (gamesRate < 0.5) overallValue -= 10;

  // Hitting component
  let hitting = 50;
  if (record.battingAverageLast30 !== null) {
    if (record.battingAverageLast30 >= 0.300) hitting += 20;
    else if (record.battingAverageLast30 >= 0.280) hitting += 15;
    else if (record.battingAverageLast30 >= 0.260) hitting += 10;
    else if (record.battingAverageLast30 < 0.220) hitting -= 10;
  }

  // Power component
  let power = 50;
  if (record.isoLast30 !== null) {
    if (record.isoLast30 >= 0.200) power += 20;
    else if (record.isoLast30 >= 0.180) power += 15;
    else if (record.isoLast30 >= 0.150) power += 10;
    else if (record.isoLast30 < 0.100) power -= 5;
  }

  // Plate discipline
  let plateDiscipline = 50;
  if (record.walkRateLast30 !== null) {
    if (record.walkRateLast30 >= 0.10) plateDiscipline += 10;
    else if (record.walkRateLast30 < 0.05) plateDiscipline -= 5;
  }
  if (record.strikeoutRateLast30 !== null) {
    if (record.strikeoutRateLast30 <= 0.18) plateDiscipline += 10;
    else if (record.strikeoutRateLast30 >= 0.28) plateDiscipline -= 10;
  }

  // Opportunity
  let opportunity = 50;
  const startRate = record.gamesStartedLast14 / 14;
  if (startRate >= 0.9) opportunity += 20;
  else if (startRate >= 0.8) opportunity += 15;
  else if (startRate >= 0.7) opportunity += 10;
  else if (startRate < 0.5) opportunity -= 10;

  // Confidence
  let confidence = 0.5;
  if (record.gamesLast30 >= 25) confidence += 0.2;
  else if (record.gamesLast30 >= 20) confidence += 0.15;

  if (record.plateAppearancesLast30 >= 100) confidence += 0.15;
  else if (record.plateAppearancesLast30 < 50) confidence -= 0.15;

  if (record.opsReliable) confidence += 0.15;

  return {
    playerId: record.playerId,
    playerMlbamId: record.playerMlbamId,
    season: record.season,
    scoredAt: new Date(),
    overallValue: Math.max(0, Math.min(100, overallValue)),
    components: {
      hitting: Math.max(0, Math.min(100, hitting)),
      power: Math.max(0, Math.min(100, power)),
      speed: 50, // Placeholder
      plateDiscipline: Math.max(0, Math.min(100, plateDiscipline)),
      consistency: record.hitConsistencyScore,
      opportunity: Math.max(0, Math.min(100, opportunity)),
    },
    confidence: Math.max(0, Math.min(1, confidence)),
    reliability: {
      sampleSize:
        record.plateAppearancesLast30 >= 100
          ? 'large'
          : record.plateAppearancesLast30 >= 60
            ? 'adequate'
            : 'small',
      gamesToReliable: record.gamesToReliable,
      statsReliable: record.opsReliable,
    },
    explanation: {
      summary: `Value: ${overallValue.toFixed(0)}`,
      strengths: [],
      concerns: [],
      keyStats: {
        ops: record.opsLast30?.toFixed(3) ?? 'N/A',
        avg: record.battingAverageLast30?.toFixed(3) ?? 'N/A',
      },
    },
    inputs: {
      derivedFeaturesVersion: 'v1',
      computedAt: record.computedAt,
    },
  };
}
