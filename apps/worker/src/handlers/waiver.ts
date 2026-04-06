/**
 * Waiver Recommendation Handler
 *
 * Real implementation using Decision Assembly.
 * Consumes PlayerScores, produces WaiverRecommendationResult.
 */

import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@cbb/infrastructure';
import type { WaiverRecommendationRequest, WaiverRecommendationResult } from '@cbb/core';

import { assembleWaiverDecisions, type WaiverAssemblyInput, type AvailablePlayer } from '../decisions/index.js';
import type { PlayerScore } from '../scoring/index.js';

export async function handleWaiverRecommendation(
  request: WaiverRecommendationRequest,
  traceId: string
): Promise<WaiverRecommendationResult> {
  console.log('[WAIVER] Processing waiver request', {
    requestId: request.id,
    scope: request.recommendationScope,
    rosterSize: request.currentRoster.length,
    availablePlayers: request.availablePlayers.players.length,
  });

  // Step 1: Get player scores for roster and available players
  const playerScores = await getPlayerScores(request);

  console.log('[WAIVER] Retrieved scores for', playerScores.size, 'players');

  // Build hitter scores map and available players list
  const hitterScores = new Map<string, PlayerScore>();
  const availablePlayers: AvailablePlayer[] = [];

  for (const [mlbamId, score] of playerScores) {
    hitterScores.set(mlbamId, score);
    
    // Check if this player is in available pool
    const availablePoolPlayer = request.availablePlayers.players.find(
      p => p.player.mlbamId === mlbamId && p.isAvailable
    );
    if (availablePoolPlayer) {
      availablePlayers.push({
        playerId: score.playerId,
        mlbamId: score.playerMlbamId,
        name: availablePoolPlayer.player.name,
        team: availablePoolPlayer.player.team,
        positions: availablePoolPlayer.player.position,
        percentOwned: 85, // Default for UAT
        percentStarted: 65, // Default for UAT
      });
    }
  }

  console.log('[WAIVER] Available players with scores:', availablePlayers.length);

  // Step 2: Assemble waiver decisions
  // Build teamState from request data
  const rosterPlayers = request.currentRoster.map(slot => ({
    playerId: slot.player.id,
    mlbamId: slot.player.mlbamId,
    name: slot.player.name,
    team: slot.player.team,
    positions: slot.player.position,
    currentPosition: slot.position,
    isLocked: slot.isLocked,
    isInjured: slot.position === 'IL',
    injuryStatus: slot.position === 'IL' ? 'injured_list' : 'healthy',
  }));

  const assemblyInput: WaiverAssemblyInput = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    teamState: {
      identity: {
        teamId: 'uat-team',
        leagueId: 'uat-league',
        teamName: 'Your Team',
        leagueName: 'UAT League',
        platform: 'yahoo',
        season: 2026,
        scoringPeriod: {
          type: 'daily',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          games: [],
        },
      },
      roster: {
        version: 1,
        lastUpdated: new Date().toISOString(),
        players: rosterPlayers,
      },
      lineupConfig: {
        slots: [
          { slot: 'C', domain: 'hitting', eligiblePositions: ['C'] },
          { slot: '1B', domain: 'hitting', eligiblePositions: ['1B'] },
          { slot: '2B', domain: 'hitting', eligiblePositions: ['2B'] },
          { slot: '3B', domain: 'hitting', eligiblePositions: ['3B'] },
          { slot: 'SS', domain: 'hitting', eligiblePositions: ['SS'] },
          { slot: 'OF', domain: 'hitting', eligiblePositions: ['LF', 'CF', 'RF', 'OF'] },
          { slot: 'UTIL', domain: 'hitting', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF'] },
          { slot: 'SP', domain: 'pitching', eligiblePositions: ['SP'] },
          { slot: 'RP', domain: 'pitching', eligiblePositions: ['RP'] },
          { slot: 'P', domain: 'pitching', eligiblePositions: ['SP', 'RP'] },
          { slot: 'BN', domain: 'flex', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'] },
        ],
        totalSlots: 23,
        hittingSlots: 14,
        pitchingSlots: 9,
        benchSlots: 5,
      },
      currentLineup: {
        assignments: request.currentRoster
          .filter(s => s.position !== 'BN' && s.position !== 'IL')
          .map(s => ({
            slot: s.position,
            playerId: s.player.id,
            isLocked: s.isLocked,
          })),
        lockedSlots: request.currentRoster
          .filter(s => s.isLocked)
          .map(s => s.position),
        benchAssignments: request.currentRoster
          .filter(s => s.position === 'BN')
          .map(s => ({
            playerId: s.player.id,
            reason: 'bench',
          })),
      },
      waiverState: {
        budgetTotal: 100,
        budgetRemaining: 100,
        pendingClaims: [],
        lastWaiverProcess: null,
        nextWaiverProcess: null,
      },
    } as any,
    hitterScores,
    pitcherScores: new Map(),
    availablePlayers,
  };

  const assemblyResult = assembleWaiverDecisions(assemblyInput);

  if (!assemblyResult.success || !assemblyResult.result) {
    throw new Error(
      `Waiver assembly failed: ${assemblyResult.errors.join(', ')}`
    );
  }

  const result = assemblyResult.result;

  // Step 3: Store result
  await prisma.waiverResult.create({
    data: {
      id: uuidv4(),
      requestId: request.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recommendations: result.recommendations as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rosterAnalysis: result.rosterAnalysis as any,
      traceId,
    },
  });

  console.log('[WAIVER] Recommendations generated', {
    requestId: request.id,
    recommendationCount: result.recommendations.length,
    topPlayer: result.recommendations[0]?.player.name ?? 'none',
  });

  return result;
}

/**
 * Get player scores for all players in the request.
 */
async function getPlayerScores(
  request: WaiverRecommendationRequest
): Promise<Map<string, PlayerScore>> {
  const playerScores = new Map<string, PlayerScore>();
  const season = 2026; // Current MLB season

  // Collect all mlbamIds from roster and available players
  const rosterIds = request.currentRoster.map((s) => s.player.mlbamId);
  const availableIds = request.availablePlayers.players
    .filter((p) => p.isAvailable)
    .map((p) => p.player.mlbamId);

  const allIds = [...new Set([...rosterIds, ...availableIds])];

  // Fetch derived features and compute scores
  for (const mlbamId of allIds) {
    const derivedRecord = await prisma.playerDerivedStats.findFirst({
      where: { playerMlbamId: mlbamId, season },
      orderBy: { computedAt: 'desc' },
    });

    if (!derivedRecord) continue;

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
