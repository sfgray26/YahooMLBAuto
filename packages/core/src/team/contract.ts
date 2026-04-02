/**
 * Team State Contract
 * 
 * CANONICAL INTERNAL REPRESENTATION
 * 
 * This is the single source of truth for a fantasy team's state.
 * It answers ONLY:
 * - Who is on my roster?
 * - What positions are they eligible for?
 * - What lineup slots exist?
 * - Which players are locked for today?
 * 
 * It does NOT:
 * - Decide who starts
 * - Rank players
 * - Know about Monte Carlo
 * - Know about Yahoo or any platform
 * 
 * Every decision is a pure function:
 * Decision = f(TeamState, PlayerScores, MonteCarloData)
 */

import type { UUID, ISO8601Timestamp } from '@cbb/core';

// ============================================================================
// Core Team Identity
// ============================================================================

export interface TeamIdentity {
  readonly teamId: UUID;
  readonly leagueId: UUID;
  readonly teamName: string;
  readonly leagueName: string;
  readonly platform: 'yahoo' | 'espn' | 'fantrax' | 'sleeper' | 'manual';
  readonly season: number;
  readonly scoringPeriod: ScoringPeriod;
}

export interface ScoringPeriod {
  readonly type: 'daily' | 'weekly';
  readonly startDate: ISO8601Timestamp;
  readonly endDate: ISO8601Timestamp;
  readonly games: ScheduledGame[];
}

export interface ScheduledGame {
  readonly gameId: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly startTime: ISO8601Timestamp;
  readonly ballpark: string;
}

// ============================================================================
// Roster State (The Roster)
// ============================================================================

export interface RosterState {
  readonly version: number;  // Incremented on every roster change
  readonly lastUpdated: ISO8601Timestamp;
  readonly players: RosterPlayer[];
}

export interface RosterPlayer {
  readonly playerId: UUID;
  readonly mlbamId: string;
  readonly name: string;
  readonly team: string;
  readonly positions: string[];  // ['1B', 'OF'] - eligibility
  readonly acquisitionDate: ISO8601Timestamp;
  readonly acquisitionType: 'draft' | 'auction' | 'waiver' | 'free_agent' | 'trade';
  readonly isInjured: boolean;
  readonly injuryStatus?: 'day_to_day' | 'week_to_week' | 'out' | 'suspended';
}

// ============================================================================
// Lineup Configuration (The Slots)
// ============================================================================

export interface LineupConfiguration {
  readonly slots: LineupSlotConfig[];
  readonly totalSlots: number;
  readonly hittingSlots: number;
  readonly pitchingSlots: number;
  readonly benchSlots: number;
}

export interface LineupSlotConfig {
  readonly slotId: string;      // 'C', '1B', 'UTIL', 'SP', etc.
  readonly domain: 'hitting' | 'pitching' | 'utility' | 'bench';
  readonly eligiblePositions: string[];  // Positions that can fill this slot
  readonly maxPlayers: number;   // Usually 1, bench might be multiple
  readonly displayOrder: number; // For UI ordering
}

// ============================================================================
// Current Lineup State (Today's Assignment)
// ============================================================================

export interface LineupState {
  readonly scoringPeriod: ISO8601Timestamp;  // Which day/week this lineup is for
  readonly lastUpdated: ISO8601Timestamp;
  readonly assignments: SlotAssignment[];    // Who is in which slot
  readonly lockedSlots: LockedSlot[];        // Which slots are locked (game started)
  readonly benchAssignments: BenchAssignment[];
}

export interface SlotAssignment {
  readonly slotId: string;
  readonly playerId: UUID;
  readonly assignedAt: ISO8601Timestamp;
  readonly isLocked: boolean;  // True if game has started
}

export interface LockedSlot {
  readonly slotId: string;
  readonly playerId: UUID;
  readonly lockedAt: ISO8601Timestamp;
  readonly reason: 'game_started' | 'manual_lock' | 'system_lock';
}

export interface BenchAssignment {
  readonly playerId: UUID;
  readonly assignedAt: ISO8601Timestamp;
  readonly isLocked: boolean;  // Can't move if their game started
}

// ============================================================================
// Waiver/Free Agent State
// ============================================================================

export interface WaiverState {
  readonly budgetRemaining: number;  // FAAB dollars or waiver priority
  readonly budgetTotal: number;
  readonly pendingClaims: WaiverClaim[];
  readonly lastWaiverProcess: ISO8601Timestamp | null;
  readonly nextWaiverProcess: ISO8601Timestamp | null;
}

export interface WaiverClaim {
  readonly claimId: UUID;
  readonly playerId: UUID;
  readonly dropPlayerId: UUID | null;
  readonly bidAmount: number;
  readonly priority: number;
  readonly submittedAt: ISO8601Timestamp;
  readonly status: 'pending' | 'processed' | 'failed';
}

// ============================================================================
// THE TeamState Contract
// ============================================================================

export interface TeamState {
  readonly version: 'v1';
  readonly identity: TeamIdentity;
  readonly roster: RosterState;
  readonly lineupConfig: LineupConfiguration;
  readonly currentLineup: LineupState;
  readonly waiverState: WaiverState;
}

// ============================================================================
// Team State Queries (Pure Functions)
// ============================================================================

export function getRosterPlayer(teamState: TeamState, playerId: UUID): RosterPlayer | undefined {
  return teamState.roster.players.find(p => p.playerId === playerId);
}

export function getRosterPlayerByMlbamId(teamState: TeamState, mlbamId: string): RosterPlayer | undefined {
  return teamState.roster.players.find(p => p.mlbamId === mlbamId);
}

export function isPlayerOnRoster(teamState: TeamState, playerId: UUID): boolean {
  return teamState.roster.players.some(p => p.playerId === playerId);
}

export function isSlotLocked(teamState: TeamState, slotId: string): boolean {
  return teamState.currentLineup.lockedSlots.some(ls => ls.slotId === slotId);
}

export function getPlayerInSlot(teamState: TeamState, slotId: string): UUID | undefined {
  const assignment = teamState.currentLineup.assignments.find(a => a.slotId === slotId);
  return assignment?.playerId;
}

export function isPlayerLocked(teamState: TeamState, playerId: UUID): boolean {
  // Player is locked if any slot they're in is locked
  return teamState.currentLineup.lockedSlots.some(ls => ls.playerId === playerId);
}

export function getAvailableBenchPlayers(teamState: TeamState): UUID[] {
  return teamState.currentLineup.benchAssignments
    .filter(b => !b.isLocked)
    .map(b => b.playerId);
}

export function getEligibleSlotsForPlayer(
  teamState: TeamState, 
  playerId: UUID
): string[] {
  const player = getRosterPlayer(teamState, playerId);
  if (!player) return [];

  return teamState.lineupConfig.slots
    .filter(slot => {
      // Check if player has any position that qualifies for this slot
      return player.positions.some(pos => 
        slot.eligiblePositions.includes(pos) || 
        slot.eligiblePositions.includes('UTIL') ||
        slot.eligiblePositions.includes('P')
      );
    })
    .map(slot => slot.slotId);
}

export function getOpenSlots(teamState: TeamState): string[] {
  const filledSlots = new Set(teamState.currentLineup.assignments.map(a => a.slotId));
  return teamState.lineupConfig.slots
    .filter(slot => !filledSlots.has(slot.slotId) && slot.domain !== 'bench')
    .map(slot => slot.slotId);
}

// ============================================================================
// Team State Validation
// ============================================================================

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: string[];
  readonly warnings: string[];
}

export function validateTeamState(teamState: TeamState): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check that all assigned players are on roster
  for (const assignment of teamState.currentLineup.assignments) {
    if (!isPlayerOnRoster(teamState, assignment.playerId)) {
      errors.push(`Player ${assignment.playerId} assigned to slot ${assignment.slotId} but not on roster`);
    }
  }

  // Check that bench players are on roster
  for (const bench of teamState.currentLineup.benchAssignments) {
    if (!isPlayerOnRoster(teamState, bench.playerId)) {
      errors.push(`Player ${bench.playerId} on bench but not on roster`);
    }
  }

  // Check for duplicate assignments
  const assignedPlayers = teamState.currentLineup.assignments.map(a => a.playerId);
  const uniqueAssigned = new Set(assignedPlayers);
  if (assignedPlayers.length !== uniqueAssigned.size) {
    errors.push('Player assigned to multiple slots');
  }

  // Check slot eligibility
  for (const assignment of teamState.currentLineup.assignments) {
    const slot = teamState.lineupConfig.slots.find(s => s.slotId === assignment.slotId);
    const player = getRosterPlayer(teamState, assignment.playerId);
    
    if (slot && player) {
      const isEligible = player.positions.some(pos => 
        slot.eligiblePositions.includes(pos) || 
        slot.eligiblePositions.includes('UTIL')
      );
      if (!isEligible) {
        errors.push(`Player ${player.name} not eligible for slot ${slot.slotId}`);
      }
    }
  }

  // Warning: players on roster but not assigned anywhere
  const allAssignedIds = new Set([
    ...teamState.currentLineup.assignments.map(a => a.playerId),
    ...teamState.currentLineup.benchAssignments.map(b => b.playerId)
  ]);
  
  for (const player of teamState.roster.players) {
    if (!allAssignedIds.has(player.playerId)) {
      warnings.push(`Player ${player.name} on roster but not assigned to lineup or bench`);
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}
