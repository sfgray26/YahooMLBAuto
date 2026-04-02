/**
 * Team State Module
 * 
 * Canonical internal representation of a fantasy team.
 * Independent of any platform (Yahoo, ESPN, etc.)
 */

// Contract
export type {
  TeamState,
  TeamIdentity,
  RosterState,
  RosterPlayer,
  LineupConfiguration,
  LineupSlotConfig,
  LineupState,
  SlotAssignment,
  LockedSlot,
  BenchAssignment,
  WaiverState,
  WaiverClaim,
  TeamScoringPeriod,
  TeamScheduledGame,
  ValidationResult,
} from './contract.js';

export {
  getRosterPlayer,
  getRosterPlayerByMlbamId,
  isPlayerOnRoster,
  isSlotLocked,
  getPlayerInSlot,
  isPlayerLocked,
  getAvailableBenchPlayers,
  getEligibleSlotsForPlayer,
  getOpenSlots,
  validateTeamState,
} from './contract.js';

// Static Provider
export {
  setRoster,
  addPlayerToRoster,
  removePlayerFromRoster,
  updatePlayerInjury,
  setTeamIdentity,
  setWaiverBudget,
  setLineupSlots,
  getStaticData,
  resetStaticData,
  buildTeamState,
  getEmptyLineup,
  buildTeamStateWithEmptyLineup,
  saveToFile,
  loadFromFile,
} from './static-provider.js';
