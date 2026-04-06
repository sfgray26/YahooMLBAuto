import { z } from 'zod';

import type { RiskProfile, ScoringRules } from '@cbb/core';

export const PlayerIdentitySchema = z.object({
  id: z.string(),
  mlbamId: z.string(),
  name: z.string(),
  team: z.string(),
  position: z.array(z.string()).min(1),
});

export const PoolPlayerSchema = z.object({
  player: PlayerIdentitySchema,
  isAvailable: z.boolean().default(true),
  currentRosterStatus: z.enum(['starting', 'bench', 'injured', 'minors']).optional(),
  acquisitionCost: z.number().nonnegative().optional(),
});

export const RosterSlotSchema = z.object({
  player: PlayerIdentitySchema,
  position: z.string(),
  isLocked: z.boolean(),
});

export const ScoringRulesSchema = z.object({
  batting: z.record(z.number()),
  pitching: z.record(z.number()),
});

export const RosterPositionSchema = z.object({
  slot: z.string(),
  maxCount: z.number().int().positive(),
  eligiblePositions: z.array(z.string()).min(1),
});

export const LineupRequestSchema = z.object({
  leagueId: z.string(),
  platform: z.enum(['yahoo', 'espn', 'fantrax', 'sleeper', 'custom']),
  format: z.enum(['h2h', 'roto', 'points']),
  scoringPeriod: z.enum(['today', 'tomorrow', 'week']).default('today'),
  riskTolerance: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  leagueSize: z.number().int().positive().optional(),
  scoringRules: ScoringRulesSchema.optional(),
  rosterPositions: z.array(RosterPositionSchema).min(1).optional(),
  availablePlayers: z.object({
    players: z.array(PoolPlayerSchema).min(1),
    lastUpdated: z.string().datetime().optional(),
  }),
  weatherSensitivity: z.object({
    rainThreshold: z.number().min(0).max(1).optional(),
    windThreshold: z.number().optional(),
  }).optional(),
  manualOverrides: z.array(z.object({
    playerId: z.string(),
    action: z.enum(['lock_in', 'lock_out']),
  })).optional(),
});

export const WaiverRequestSchema = z.object({
  leagueId: z.string(),
  platform: z.enum(['yahoo', 'espn', 'fantrax', 'sleeper', 'custom']),
  format: z.enum(['h2h', 'roto', 'points']),
  scope: z.enum(['add_only', 'drop_only', 'add_drop', 'full_optimization']).default('add_drop'),
  leagueSize: z.number().int().positive().optional(),
  scoringRules: ScoringRulesSchema.optional(),
  rosterPositions: z.array(RosterPositionSchema).min(1).optional(),
  currentRoster: z.array(RosterSlotSchema).min(1),
  availablePlayers: z.object({
    players: z.array(PoolPlayerSchema).min(1),
    lastUpdated: z.string().datetime().optional(),
  }),
  rosterNeeds: z.object({
    positionalNeeds: z.record(z.enum(['none', 'moderate', 'high', 'critical'])).optional(),
    preferredUpside: z.boolean().optional(),
  }).optional(),
});

export function getDefaultScoringRules(format: string): ScoringRules {
  const batting: Record<string, number> = format === 'points'
    ? { R: 1, HR: 4, RBI: 1, SB: 2, BB: 1, H: 1, '2B': 2, '3B': 3, AVG: 0 }
    : { AVG: 1, HR: 1, RBI: 1, R: 1, SB: 1, BB: 0, H: 0, '2B': 0, '3B': 0 };

  const pitching: Record<string, number> = format === 'points'
    ? { IP: 3, SO: 1, W: 5, SV: 5, ER: -1, H: -0.5, BB: -0.5, ERA: 0, WHIP: 0, K: 0 }
    : { ERA: 1, WHIP: 1, K: 1, W: 1, SV: 1, IP: 0, SO: 0, ER: 0, H: 0, BB: 0 };

  return { batting, pitching };
}

export function getDefaultRosterPositions() {
  return [
    { slot: 'C', maxCount: 1, eligiblePositions: ['C'] },
    { slot: '1B', maxCount: 1, eligiblePositions: ['1B', 'CI'] },
    { slot: '2B', maxCount: 1, eligiblePositions: ['2B', 'MI'] },
    { slot: '3B', maxCount: 1, eligiblePositions: ['3B', 'CI'] },
    { slot: 'SS', maxCount: 1, eligiblePositions: ['SS', 'MI'] },
    { slot: 'OF', maxCount: 3, eligiblePositions: ['OF', 'LF', 'CF', 'RF'] },
    { slot: 'UTIL', maxCount: 1, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF'] },
    { slot: 'SP', maxCount: 2, eligiblePositions: ['SP'] },
    { slot: 'RP', maxCount: 2, eligiblePositions: ['RP', 'CL'] },
    { slot: 'P', maxCount: 3, eligiblePositions: ['SP', 'RP', 'P', 'CL'] },
    { slot: 'BN', maxCount: 5, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P'] },
    { slot: 'IL', maxCount: 4, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P'] },
  ];
}

export function getRiskProfile(tolerance: string): RiskProfile {
  switch (tolerance) {
    case 'conservative':
      return { type: 'conservative', varianceTolerance: 0.1 as const, description: 'Minimize downside' };
    case 'aggressive':
      return { type: 'aggressive', varianceTolerance: 0.5 as const, description: 'Maximize upside potential' };
    default:
      return { type: 'balanced', varianceTolerance: 0.3 as const, description: 'Balance risk and reward' };
  }
}
