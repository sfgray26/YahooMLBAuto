/**
 * Static Team State Provider
 * 
 * Manual/Static implementation of TeamState before Yahoo integration.
 * 
 * PRINCIPLE: This is an intentional isolation layer. We deliberately
 * hardcode roster data, manually update on trades, and treat this as truth.
 * 
 * This allows the intelligence engine to evolve independently of platform
 * adapters. When Yahoo integration comes, it just populates this contract.
 */

import type { 
  TeamState, 
  TeamIdentity, 
  RosterState, 
  LineupConfiguration, 
  LineupState,
  WaiverState,
  RosterPlayer,
  LineupSlotConfig,
  ScoringPeriod,
  ScheduledGame,
} from '../contract.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Static Data Store (In-Memory with JSON persistence option)
// ============================================================================

interface StaticTeamData {
  identity: TeamIdentity;
  roster: RosterPlayer[];
  lineupSlots: LineupSlotConfig[];
  waiverBudget: { total: number; remaining: number };
}

// Default static data - REPLACE WITH YOUR ACTUAL ROSTER
const DEFAULT_STATIC_DATA: StaticTeamData = {
  identity: {
    teamId: uuidv4(),
    leagueId: uuidv4(),
    teamName: 'My Fantasy Team',
    leagueName: 'Test League',
    platform: 'manual',
    season: 2025,
    scoringPeriod: {
      type: 'daily',
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      games: [],
    },
  },
  roster: [],  // Empty - must be populated
  lineupSlots: [
    // Hitting slots
    { slotId: 'C', domain: 'hitting', eligiblePositions: ['C'], maxPlayers: 1, displayOrder: 1 },
    { slotId: '1B', domain: 'hitting', eligiblePositions: ['1B'], maxPlayers: 1, displayOrder: 2 },
    { slotId: '2B', domain: 'hitting', eligiblePositions: ['2B'], maxPlayers: 1, displayOrder: 3 },
    { slotId: '3B', domain: 'hitting', eligiblePositions: ['3B'], maxPlayers: 1, displayOrder: 4 },
    { slotId: 'SS', domain: 'hitting', eligiblePositions: ['SS'], maxPlayers: 1, displayOrder: 5 },
    { slotId: 'OF1', domain: 'hitting', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], maxPlayers: 1, displayOrder: 6 },
    { slotId: 'OF2', domain: 'hitting', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], maxPlayers: 1, displayOrder: 7 },
    { slotId: 'OF3', domain: 'hitting', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], maxPlayers: 1, displayOrder: 8 },
    { slotId: 'UTIL', domain: 'hitting', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'UTIL'], maxPlayers: 1, displayOrder: 9 },
    // Pitching slots
    { slotId: 'SP1', domain: 'pitching', eligiblePositions: ['SP'], maxPlayers: 1, displayOrder: 10 },
    { slotId: 'SP2', domain: 'pitching', eligiblePositions: ['SP'], maxPlayers: 1, displayOrder: 11 },
    { slotId: 'RP1', domain: 'pitching', eligiblePositions: ['RP', 'CL'], maxPlayers: 1, displayOrder: 12 },
    { slotId: 'RP2', domain: 'pitching', eligiblePositions: ['RP', 'CL'], maxPlayers: 1, displayOrder: 13 },
    { slotId: 'P1', domain: 'pitching', eligiblePositions: ['SP', 'RP', 'P', 'CL'], maxPlayers: 1, displayOrder: 14 },
    { slotId: 'P2', domain: 'pitching', eligiblePositions: ['SP', 'RP', 'P', 'CL'], maxPlayers: 1, displayOrder: 15 },
    // Bench
    { slotId: 'BN1', domain: 'bench', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P', 'CL'], maxPlayers: 1, displayOrder: 16 },
    { slotId: 'BN2', domain: 'bench', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P', 'CL'], maxPlayers: 1, displayOrder: 17 },
    { slotId: 'BN3', domain: 'bench', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P', 'CL'], maxPlayers: 1, displayOrder: 18 },
    { slotId: 'BN4', domain: 'bench', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P', 'CL'], maxPlayers: 1, displayOrder: 19 },
    { slotId: 'BN5', domain: 'bench', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P', 'CL'], maxPlayers: 1, displayOrder: 20 },
  ],
  waiverBudget: {
    total: 100,
    remaining: 100,
  },
};

// In-memory store
let staticData: StaticTeamData = { ...DEFAULT_STATIC_DATA };
let dataVersion = 1;

// ============================================================================
// Admin Functions (Manual Updates)
// ============================================================================

/**
 * Set the entire roster.
 * Use this when initializing or after major roster changes.
 */
export function setRoster(players: RosterPlayer[]): void {
  staticData.roster = [...players];
  dataVersion++;
  console.log(`[TEAM_STATE] Roster updated: ${players.length} players, version ${dataVersion}`);
}

/**
 * Add a single player to the roster.
 * Use this for waiver adds, free agent pickups.
 */
export function addPlayerToRoster(player: Omit<RosterPlayer, 'acquisitionDate'>): void {
  const newPlayer: RosterPlayer = {
    ...player,
    acquisitionDate: new Date().toISOString(),
  };
  staticData.roster.push(newPlayer);
  dataVersion++;
  console.log(`[TEAM_STATE] Added ${player.name} to roster, version ${dataVersion}`);
}

/**
 * Remove a player from the roster.
 * Use this for drops, trades away.
 */
export function removePlayerFromRoster(playerId: string): boolean {
  const idx = staticData.roster.findIndex(p => p.playerId === playerId);
  if (idx >= 0) {
    const player = staticData.roster[idx];
    staticData.roster.splice(idx, 1);
    dataVersion++;
    console.log(`[TEAM_STATE] Removed ${player.name} from roster, version ${dataVersion}`);
    return true;
  }
  return false;
}

/**
 * Update player injury status.
 */
export function updatePlayerInjury(
  playerId: string, 
  isInjured: boolean, 
  injuryStatus?: RosterPlayer['injuryStatus']
): boolean {
  const player = staticData.roster.find(p => p.playerId === playerId);
  if (player) {
    (player as { isInjured: boolean; injuryStatus?: RosterPlayer['injuryStatus'] }).isInjured = isInjured;
    (player as { isInjured: boolean; injuryStatus?: RosterPlayer['injuryStatus'] }).injuryStatus = injuryStatus;
    dataVersion++;
    console.log(`[TEAM_STATE] Updated ${player.name} injury status: ${isInjured ? injuryStatus : 'healthy'}, version ${dataVersion}`);
    return true;
  }
  return false;
}

/**
 * Update team identity.
 */
export function setTeamIdentity(identity: Partial<TeamIdentity>): void {
  staticData.identity = { ...staticData.identity, ...identity };
  dataVersion++;
  console.log(`[TEAM_STATE] Team identity updated, version ${dataVersion}`);
}

/**
 * Update waiver budget.
 */
export function setWaiverBudget(total: number, remaining: number): void {
  staticData.waiverBudget = { total, remaining };
  dataVersion++;
  console.log(`[TEAM_STATE] Waiver budget updated: ${remaining}/${total}, version ${dataVersion}`);
}

/**
 * Update lineup slots configuration.
 */
export function setLineupSlots(slots: LineupSlotConfig[]): void {
  staticData.lineupSlots = [...slots];
  dataVersion++;
  console.log(`[TEAM_STATE] Lineup slots updated: ${slots.length} slots, version ${dataVersion}`);
}

/**
 * Get current static data (for debugging/inspection).
 */
export function getStaticData(): StaticTeamData {
  return { ...staticData, roster: [...staticData.roster] };
}

/**
 * Reset to defaults (use with caution).
 */
export function resetStaticData(): void {
  staticData = { ...DEFAULT_STATIC_DATA };
  dataVersion = 1;
  console.log('[TEAM_STATE] Reset to defaults');
}

// ============================================================================
// TeamState Factory
// ============================================================================

interface CurrentLineupInput {
  assignments: Array<{ slotId: string; playerId: string }>;
  lockedPlayerIds: string[];  // Players whose games have started
  benchPlayerIds: string[];   // Players explicitly on bench
}

/**
 * Build a complete TeamState from static data + current lineup.
 * 
 * This is the main entry point. You call this when you want the current
 * TeamState for decision making.
 */
export function buildTeamState(
  currentLineup: CurrentLineupInput,
  scoringPeriod?: ScoringPeriod
): TeamState {
  const now = new Date().toISOString();
  
  // Build roster state
  const rosterState: RosterState = {
    version: dataVersion,
    lastUpdated: now,
    players: [...staticData.roster],
  };

  // Build lineup configuration
  const hittingSlots = staticData.lineupSlots.filter(s => s.domain === 'hitting').length;
  const pitchingSlots = staticData.lineupSlots.filter(s => s.domain === 'pitching').length;
  const benchSlots = staticData.lineupSlots.filter(s => s.domain === 'bench').length;

  const lineupConfig: LineupConfiguration = {
    slots: [...staticData.lineupSlots],
    totalSlots: staticData.lineupSlots.length,
    hittingSlots,
    pitchingSlots,
    benchSlots,
  };

  // Build current lineup state
  const lockedSlots = currentLineup.lockedPlayerIds.map(playerId => {
    const assignment = currentLineup.assignments.find(a => a.playerId === playerId);
    return {
      slotId: assignment?.slotId || 'UNKNOWN',
      playerId,
      lockedAt: now,
      reason: 'game_started' as const,
    };
  });

  const assignments = currentLineup.assignments.map(a => ({
    slotId: a.slotId,
    playerId: a.playerId,
    assignedAt: now,
    isLocked: currentLineup.lockedPlayerIds.includes(a.playerId),
  }));

  const benchAssignments = currentLineup.benchPlayerIds.map(playerId => ({
    playerId,
    assignedAt: now,
    isLocked: currentLineup.lockedPlayerIds.includes(playerId),
  }));

  const lineupState: LineupState = {
    scoringPeriod: scoringPeriod?.startDate || now,
    lastUpdated: now,
    assignments,
    lockedSlots,
    benchAssignments,
  };

  // Build waiver state
  const waiverState: WaiverState = {
    budgetRemaining: staticData.waiverBudget.remaining,
    budgetTotal: staticData.waiverBudget.total,
    pendingClaims: [],  // Static provider doesn't track pending claims
    lastWaiverProcess: null,
    nextWaiverProcess: null,
  };

  // Build full team state
  const teamState: TeamState = {
    version: 'v1',
    identity: {
      ...staticData.identity,
      scoringPeriod: scoringPeriod || staticData.identity.scoringPeriod,
    },
    roster: rosterState,
    lineupConfig,
    currentLineup: lineupState,
    waiverState,
  };

  return teamState;
}

/**
 * Get a default "empty" lineup for initialization.
 * All roster players on bench, no assignments.
 */
export function getEmptyLineup(): CurrentLineupInput {
  return {
    assignments: [],
    lockedPlayerIds: [],
    benchPlayerIds: staticData.roster.map(p => p.playerId),
  };
}

/**
 * Build TeamState with all players on bench (useful for initial setup).
 */
export function buildTeamStateWithEmptyLineup(scoringPeriod?: ScoringPeriod): TeamState {
  return buildTeamState(getEmptyLineup(), scoringPeriod);
}

// ============================================================================
// JSON Persistence (Optional)
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_DATA_FILE = join(process.cwd(), 'team-state.json');

/**
 * Save static data to JSON file.
 */
export function saveToFile(filepath: string = DEFAULT_DATA_FILE): void {
  const data = {
    identity: staticData.identity,
    roster: staticData.roster,
    lineupSlots: staticData.lineupSlots,
    waiverBudget: staticData.waiverBudget,
    version: dataVersion,
  };
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[TEAM_STATE] Saved to ${filepath}`);
}

/**
 * Load static data from JSON file.
 */
export function loadFromFile(filepath: string = DEFAULT_DATA_FILE): void {
  if (!existsSync(filepath)) {
    console.log(`[TEAM_STATE] File not found: ${filepath}, using defaults`);
    return;
  }
  
  const raw = readFileSync(filepath, 'utf-8');
  const data = JSON.parse(raw);
  
  staticData = {
    identity: data.identity || DEFAULT_STATIC_DATA.identity,
    roster: data.roster || [],
    lineupSlots: data.lineupSlots || DEFAULT_STATIC_DATA.lineupSlots,
    waiverBudget: data.waiverBudget || DEFAULT_STATIC_DATA.waiverBudget,
  };
  dataVersion = data.version || 1;
  
  console.log(`[TEAM_STATE] Loaded from ${filepath}, version ${dataVersion}`);
}
