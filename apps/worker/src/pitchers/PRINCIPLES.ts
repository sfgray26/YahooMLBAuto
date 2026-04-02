/**
 * Pitcher Scoring Architecture - PRINCIPLES
 * 
 * LOCKED PRINCIPLE: Pitchers are NOT an extension of hitters.
 * They are a SEPARATE performance domain that shares identities.
 * 
 * Same: player_id, roster/team state
 * Different: feature logic, scoring model, risk behavior, decision rules
 * 
 * SYMMETRY RULES:
 * 1. hitters/compute.ts → pitchers/compute.ts
 * 2. hitters/orchestrator.ts → pitchers/orchestrator.ts  
 * 3. Same interface patterns, different implementations
 * 4. Domain-aware contracts (no if-else spaghetti in assembly)
 * 
 * PITCHER-SPECIFIC REALITY:
 * - Innings volatility (not plate appearances)
 * - Component-based outcomes (K%, BB%, GB%, HR/FB)
 * - Fantasy points emerge from sequence simulation
 * - Different risk profile (injury, blow-up risk)
 */

export const PITCHER_DOMAIN_PRINCIPLES = {
  // Identity is shared, performance is separate
  sharedIdentity: ['player_id', 'mlbam_id', 'name', 'team'],
  
  // Separate domains, never compared directly
  separateDomains: [
    'feature_logic',
    'scoring_model', 
    'monte_carlo_model',
    'risk_assessment',
    'lineup_slot_eligibility'
  ],
  
  // Assembly rule: ask "what domain?" not "which is better?"
  assemblyStrategy: 'domain_parallel_optimization',
  
  // Waiver edge: pitchers are the cheat code
  waiverPriority: 'pitchers_first_in_uncertain_markets'
} as const;

export type PitcherDomain = 'pitching';
export type HitterDomain = 'hitting';
export type PerformanceDomain = PitcherDomain | HitterDomain;

/**
 * Domain discriminator - used by lineup assembly
 * No string matching, no if-else chains
 */
export interface DomainIdentity {
  playerId: string;
  mlbamId: string;
  domain: PerformanceDomain;
  // Shared roster context
  team: string;
  rosterStatus: 'active' | 'injured' | 'minors';
}
