import type {
  LineupOptimizationRequest,
  PoolPlayer,
  RosterPlayer,
  RosterSlot,
  TeamScoringPeriod,
  TeamState,
  WaiverRecommendationRequest,
} from '@cbb/core';

import { scoreSinglePlayer, type PlayerScore } from '../scoring/index.js';
import { scoreSinglePitcher, type PitcherScore } from '../pitchers/index.js';

interface ScoreMaps {
  hitterScores: Map<string, PlayerScore>;
  pitcherScores: Map<string, PitcherScore>;
}

interface ExpandedSlot {
  slotId: string;
  domain: 'hitting' | 'pitching' | 'utility' | 'bench';
  eligiblePositions: string[];
}

interface LineupAssignmentSeed {
  playerId: string;
  position: string;
  isLocked: boolean;
}

const BENCH_SLOT_IDS = new Set(['BN', 'IL', 'NA', 'IR']);
const PITCHER_POSITIONS = new Set(['SP', 'RP', 'P', 'CL']);
const OF_POSITIONS = ['OF', 'LF', 'CF', 'RF'];

export async function loadScoreMaps(
  players: Array<{ mlbamId: string; positions: string[] }>,
  season: number
): Promise<ScoreMaps> {
  const hitterScores = new Map<string, PlayerScore>();
  const pitcherScores = new Map<string, PitcherScore>();

  const uniquePlayers = new Map<string, string[]>();
  for (const player of players) {
    if (!uniquePlayers.has(player.mlbamId)) {
      uniquePlayers.set(player.mlbamId, player.positions);
    }
  }

  await Promise.all(
    Array.from(uniquePlayers.entries()).map(async ([mlbamId, positions]) => {
      if (isPitcher(positions)) {
        const pitcherScore = await scoreSinglePitcher(mlbamId, season);
        if (pitcherScore) {
          pitcherScores.set(mlbamId, pitcherScore);
        }
        return;
      }

      const hitterScore = await scoreSinglePlayer(mlbamId, season);
      if (hitterScore) {
        hitterScores.set(mlbamId, hitterScore);
      }
    })
  );

  return { hitterScores, pitcherScores };
}

export function getSeasonFromTimestamp(timestamp: string): number {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid scoring period timestamp: ${timestamp}`);
  }

  return parsed.getUTCFullYear();
}

export function buildTeamStateFromLineupRequest(
  request: LineupOptimizationRequest
): TeamState {
  const rosterPlayers = request.availablePlayers.players.map((player) =>
    toRosterPlayer(player, request.createdAt)
  );

  const expandedSlots = expandRosterPositions(request.leagueConfig.rosterPositions);
  const startingPlayers = request.availablePlayers.players
    .filter((player) => player.currentRosterStatus === 'starting')
    .map((player) => ({
      playerId: player.player.id,
      position: player.player.position[0] ?? 'UTIL',
      isLocked: false,
    }));

  return buildTeamState({
    requestId: request.id,
    platform: request.leagueConfig.platform,
    season: getSeasonFromTimestamp(request.scoringPeriod.startDate),
    scoringPeriod: toTeamScoringPeriod(request.scoringPeriod),
    rosterPlayers,
    expandedSlots,
    lineupAssignments: assignPlayersToSlots(startingPlayers, expandedSlots),
    lockedSlotIds: new Set(request.rosterConstraints.lockedSlots),
    benchPlayerIds: rosterPlayers
      .filter((player) => !startingPlayers.some((starter) => starter.playerId === player.playerId))
      .map((player) => player.playerId),
  });
}

export function buildTeamStateFromWaiverRequest(
  request: WaiverRecommendationRequest
): TeamState {
  const rosterPlayers = request.currentRoster.map((slot) => toRosterPlayerFromSlot(slot, request.createdAt));
  const expandedSlots = expandRosterPositions(request.leagueConfig.rosterPositions);
  const activeAssignments = request.currentRoster
    .filter((slot) => !BENCH_SLOT_IDS.has(slot.position.toUpperCase()))
    .map((slot) => ({
      playerId: slot.player.id,
      position: slot.position,
      isLocked: slot.isLocked,
    }));

  return buildTeamState({
    requestId: request.id,
    platform: request.leagueConfig.platform,
    season: new Date().getUTCFullYear(),
    scoringPeriod: {
      type: 'daily',
      startDate: request.createdAt,
      endDate: request.createdAt,
      games: [],
    },
    rosterPlayers,
    expandedSlots,
    lineupAssignments: assignPlayersToSlots(activeAssignments, expandedSlots),
    lockedSlotIds: new Set<string>(),
    benchPlayerIds: request.currentRoster
      .filter((slot) => BENCH_SLOT_IDS.has(slot.position.toUpperCase()))
      .map((slot) => slot.player.id),
  });
}

function buildTeamState(input: {
  requestId: string;
  platform: LineupOptimizationRequest['leagueConfig']['platform'];
  season: number;
  scoringPeriod: TeamScoringPeriod;
  rosterPlayers: RosterPlayer[];
  expandedSlots: ExpandedSlot[];
  lineupAssignments: Array<{ slotId: string; playerId: string; isLocked: boolean }>;
  lockedSlotIds: Set<string>;
  benchPlayerIds: string[];
}): TeamState {
  const now = new Date().toISOString();

  return {
    version: 'v1',
    identity: {
      teamId: input.requestId,
      leagueId: input.requestId,
      teamName: 'API Request Team',
      leagueName: 'API League',
      platform: input.platform === 'custom' ? 'manual' : input.platform,
      season: input.season,
      scoringPeriod: input.scoringPeriod,
    },
    roster: {
      version: 1,
      lastUpdated: now,
      players: input.rosterPlayers,
    },
    lineupConfig: {
      slots: input.expandedSlots.map((slot, index) => ({
        slotId: slot.slotId,
        domain: slot.domain,
        eligiblePositions: slot.eligiblePositions,
        maxPlayers: 1,
        displayOrder: index + 1,
      })),
      totalSlots: input.expandedSlots.length,
      hittingSlots: input.expandedSlots.filter((slot) => slot.domain === 'hitting' || slot.domain === 'utility').length,
      pitchingSlots: input.expandedSlots.filter((slot) => slot.domain === 'pitching').length,
      benchSlots: input.expandedSlots.filter((slot) => slot.domain === 'bench').length,
    },
    currentLineup: {
      scoringPeriod: input.scoringPeriod.startDate,
      lastUpdated: now,
      assignments: input.lineupAssignments.map((assignment) => ({
        slotId: assignment.slotId,
        playerId: assignment.playerId,
        assignedAt: now,
        isLocked: assignment.isLocked || input.lockedSlotIds.has(assignment.slotId),
      })),
      lockedSlots: input.lineupAssignments
        .filter((assignment) => assignment.isLocked || input.lockedSlotIds.has(assignment.slotId))
        .map((assignment) => ({
          slotId: assignment.slotId,
          playerId: assignment.playerId,
          lockedAt: now,
          reason: 'game_started' as const,
        })),
      benchAssignments: input.benchPlayerIds.map((playerId) => ({
        playerId,
        assignedAt: now,
        isLocked: false,
      })),
    },
    waiverState: {
      budgetRemaining: 100,
      budgetTotal: 100,
      pendingClaims: [],
      lastWaiverProcess: null,
      nextWaiverProcess: null,
    },
  };
}

function toRosterPlayer(player: PoolPlayer, acquisitionDate: string): RosterPlayer {
  return {
    playerId: player.player.id,
    mlbamId: player.player.mlbamId,
    name: player.player.name,
    team: player.player.team,
    positions: normalizeEligiblePositions(player.player.position),
    acquisitionDate,
    acquisitionType: player.acquisitionCost != null ? 'waiver' : 'draft',
    isInjured: player.currentRosterStatus === 'injured',
    injuryStatus: player.currentRosterStatus === 'injured' ? 'out' : undefined,
  };
}

function toRosterPlayerFromSlot(slot: RosterSlot, acquisitionDate: string): RosterPlayer {
  const isInjured = slot.position.toUpperCase() === 'IL';

  return {
    playerId: slot.player.id,
    mlbamId: slot.player.mlbamId,
    name: slot.player.name,
    team: slot.player.team,
    positions: normalizeEligiblePositions(slot.player.position),
    acquisitionDate,
    acquisitionType: 'draft',
    isInjured,
    injuryStatus: isInjured ? 'out' : undefined,
  };
}

function toTeamScoringPeriod(scoringPeriod: LineupOptimizationRequest['scoringPeriod']): TeamScoringPeriod {
  return {
    type: scoringPeriod.type === 'weekly' ? 'weekly' : 'daily',
    startDate: scoringPeriod.startDate,
    endDate: scoringPeriod.endDate,
    games: scoringPeriod.games.map((game) => ({
      gameId: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      startTime: game.startTime,
      ballpark: game.ballpark,
    })),
  };
}

function expandRosterPositions(
  rosterPositions: LineupOptimizationRequest['leagueConfig']['rosterPositions']
): ExpandedSlot[] {
  const expandedSlots: ExpandedSlot[] = [];

  for (const rosterPosition of rosterPositions) {
    const domain = getDomainForSlot(rosterPosition.slot, rosterPosition.eligiblePositions);
    const eligiblePositions = normalizeEligiblePositions(rosterPosition.eligiblePositions);

    for (let index = 0; index < rosterPosition.maxCount; index += 1) {
      expandedSlots.push({
        slotId: rosterPosition.maxCount > 1 ? `${rosterPosition.slot}${index + 1}` : rosterPosition.slot,
        domain,
        eligiblePositions,
      });
    }
  }

  return expandedSlots;
}

function getDomainForSlot(
  slot: string,
  eligiblePositions: string[]
): ExpandedSlot['domain'] {
  const upperSlot = slot.toUpperCase();

  if (BENCH_SLOT_IDS.has(upperSlot)) {
    return 'bench';
  }

  const normalizedEligible = normalizeEligiblePositions(eligiblePositions);
  if (upperSlot === 'UTIL') {
    return 'utility';
  }

  if (normalizedEligible.every((position) => PITCHER_POSITIONS.has(position))) {
    return 'pitching';
  }

  return 'hitting';
}

function assignPlayersToSlots(
  assignments: LineupAssignmentSeed[],
  expandedSlots: ExpandedSlot[]
): Array<{ slotId: string; playerId: string; isLocked: boolean }> {
  const takenSlots = new Set<string>();
  const slotAssignments: Array<{ slotId: string; playerId: string; isLocked: boolean }> = [];

  for (const assignment of assignments) {
    const desiredPosition = assignment.position.toUpperCase();
    const slot = expandedSlots.find((candidate) =>
      !takenSlots.has(candidate.slotId) &&
      candidate.domain !== 'bench' &&
      matchesPosition(candidate, desiredPosition)
    );

    if (!slot) {
      continue;
    }

    takenSlots.add(slot.slotId);
    slotAssignments.push({
      slotId: slot.slotId,
      playerId: assignment.playerId,
      isLocked: assignment.isLocked,
    });
  }

  return slotAssignments;
}

function matchesPosition(slot: ExpandedSlot, desiredPosition: string): boolean {
  const baseSlotId = slot.slotId.replace(/\d+$/, '');
  if (baseSlotId === desiredPosition) {
    return true;
  }

  if (desiredPosition === 'LF' || desiredPosition === 'CF' || desiredPosition === 'RF') {
    return slot.eligiblePositions.includes('OF');
  }

  return slot.eligiblePositions.includes(desiredPosition);
}

function normalizeEligiblePositions(positions: string[]): string[] {
  const normalized = new Set<string>();

  for (const rawPosition of positions) {
    const position = rawPosition.toUpperCase();
    normalized.add(position);

    if (position === 'OF') {
      OF_POSITIONS.forEach((ofPosition) => normalized.add(ofPosition));
    }

    if (position === 'LF' || position === 'CF' || position === 'RF') {
      normalized.add('OF');
    }

    if (position === 'P') {
      normalized.add('SP');
      normalized.add('RP');
      normalized.add('CL');
    }

    if (position === 'RP') {
      normalized.add('CL');
    }
  }

  return Array.from(normalized);
}

function isPitcher(positions: string[]): boolean {
  return positions.some((position) => PITCHER_POSITIONS.has(position.toUpperCase()));
}
