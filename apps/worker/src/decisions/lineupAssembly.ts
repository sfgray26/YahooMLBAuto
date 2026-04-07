/**
 * Lineup Decision Assembly - TEAM STATE AWARE
 *
 * CRITICAL PRINCIPLE: All decisions are pure functions of TeamState.
 * 
 * Decision = f(TeamState, PlayerScores, MonteCarloData)
 * 
 * This assembly:
 * 1. Filters to roster players only (from TeamState)
 * 2. Respects positional eligibility (from TeamState roster)
 * 3. Respects locked players (from TeamState lineup)
 * 4. Uses slot configuration (from TeamState lineupConfig)
 * 5. Separates hitters and pitchers by domain (never compare directly)
 * 
 * What does NOT change:
 * - Scoring logic (compute.ts)
 * - Monte Carlo logic (monte-carlo.ts)
 * - Feature definitions (derived.ts)
 */

import type { 
  UUID, 
  ISO8601Timestamp,
  TeamState,
  LineupOptimizationResult,
  LineupSlot,
  AlternativeLineup,
  LineupExplanation,
  KeyDecisionPoint,
  PlayerIdentity,
  ConfidenceLevel,
} from '@cbb/core';
import type { PlayerScore } from '../scoring/index.js';
import type { PitcherScore } from '../pitchers/index.js';
import { confidenceLevelToScore, mapConfidenceLabel } from './confidence.js';
import { 
  isPlayerOnRoster, 
  isPlayerLocked, 
  getAvailableBenchPlayers,
  getEligibleSlotsForPlayer,
  getOpenSlots,
} from '@cbb/core';

// ============================================================================
// Types
// ============================================================================

export interface TeamStateLineupInput {
  teamState: TeamState;                        // Canonical team representation
  hitterScores: Map<string, PlayerScore>;     // mlbamId -> hitter score
  pitcherScores: Map<string, PitcherScore>;   // mlbamId -> pitcher score
  manualLocks?: Set<UUID>;                    // Additional manual locks
  excludedPlayerIds?: Set<UUID>;              // Players to exclude (injuries, etc.)
}

export interface AssemblyResult {
  success: boolean;
  result?: LineupOptimizationResult;
  errors: string[];
  traceId: string;
}

export type PerformanceDomain = 'hitting' | 'pitching';

// ============================================================================
// Domain Classification
// ============================================================================

function getSlotDomain(slotId: string): PerformanceDomain {
  const pitcherSlots = ['SP', 'RP', 'P', 'CL'];
  const upperSlot = slotId.toUpperCase();
  
  if (pitcherSlots.some(ps => upperSlot.includes(ps))) {
    return 'pitching';
  }
  return 'hitting';
}

function isPitcher(positions: string[]): boolean {
  return positions.some(p => 
    ['SP', 'RP', 'P', 'CL'].includes(p.toUpperCase())
  );
}

// ============================================================================
// Hitter Assembly (Team State Aware)
// ============================================================================

interface HitterAssemblyContext {
  scoredHitters: Array<{
    player: PlayerIdentity;
    score: PlayerScore;
    overallValue: number;
    confidence: number;
    eligibleSlots: string[];  // From TeamState
  }>;
  lockedPlayerIds: Set<UUID>;
  excludedPlayerIds: Set<UUID>;
}

function assembleHitters(
  hittingSlots: Array<{ slotId: string; eligiblePositions: string[] }>,
  context: HitterAssemblyContext
): { slots: LineupSlot[]; keyDecisions: KeyDecisionPoint[]; usedPlayerIds: Set<UUID> } {
  const lineup: LineupSlot[] = [];
  const keyDecisions: KeyDecisionPoint[] = [];
  const usedPlayers = new Set<UUID>();

  const { scoredHitters, lockedPlayerIds, excludedPlayerIds } = context;

  // Filter to available hitters (not locked, not excluded)
  const availableHitters = scoredHitters.filter(
    h => !lockedPlayerIds.has(h.player.id) && !excludedPlayerIds.has(h.player.id)
  );

  // Sort by value
  const sortedHitters = [...availableHitters].sort(
    (a, b) => b.overallValue - a.overallValue
  );

  for (const slotConfig of hittingSlots) {
    // Find eligible hitters for this slot
    const eligible = sortedHitters.filter(
      h =>
        !usedPlayers.has(h.player.id) &&
        h.eligibleSlots.includes(slotConfig.slotId)
    );

    if (eligible.length > 0) {
      const selected = eligible[0];
      usedPlayers.add(selected.player.id);

      const slot: LineupSlot = {
        position: slotConfig.slotId,
        player: selected.player,
        projectedPoints: calculateHitterProjectedPoints(selected.score),
      confidence: mapConfidenceLabel(selected.confidence),
        factors: generateHitterFactors(selected.score),
      };

      lineup.push(slot);

      // Record key decision
      if (eligible.length > 1) {
        keyDecisions.push({
          position: slotConfig.slotId,
          chosenPlayer: selected.player,
          alternativesConsidered: eligible.slice(1, 4).map(h => h.player),
          whyChosen: `Value ${selected.overallValue} vs ${eligible[1]?.overallValue || 0}`,
        });
      }
    }
  }

  return { slots: lineup, keyDecisions, usedPlayerIds: usedPlayers };
}

// ============================================================================
// Pitcher Assembly (Team State Aware)
// ============================================================================

interface PitcherAssemblyContext {
  scoredPitchers: Array<{
    player: PlayerIdentity;
    score: PitcherScore;
    overallValue: number;
    confidence: number;
    role: PitcherScore['role'];
    eligibleSlots: string[];
  }>;
  lockedPlayerIds: Set<UUID>;
  excludedPlayerIds: Set<UUID>;
}

function assemblePitchers(
  pitcherSlots: Array<{ slotId: string; eligiblePositions: string[] }>,
  context: PitcherAssemblyContext
): { slots: LineupSlot[]; keyDecisions: KeyDecisionPoint[]; usedPlayerIds: Set<UUID> } {
  const lineup: LineupSlot[] = [];
  const keyDecisions: KeyDecisionPoint[] = [];
  const usedPlayers = new Set<UUID>();

  const { scoredPitchers, lockedPlayerIds, excludedPlayerIds } = context;

  // Filter to available pitchers
  const availablePitchers = scoredPitchers.filter(
    p => !lockedPlayerIds.has(p.player.id) && !excludedPlayerIds.has(p.player.id)
  );

  // Sort by role priority, then value
  const sortedPitchers = [...availablePitchers].sort((a, b) => {
    const rolePriority = { CL: 4, SP: 3, SWING: 2, RP: 1 };
    const aPriority = rolePriority[a.role.currentRole] || 0;
    const bPriority = rolePriority[b.role.currentRole] || 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return b.overallValue - a.overallValue;
  });

  for (const slotConfig of pitcherSlots) {
    const slotDomain = getSlotDomain(slotConfig.slotId);
    const preferClosers = slotConfig.slotId.toUpperCase().includes('CL');
    const preferStarters = slotConfig.slotId.toUpperCase().includes('SP');

    // Find eligible pitchers
    let eligible = sortedPitchers.filter(
      p =>
        !usedPlayers.has(p.player.id) &&
        p.eligibleSlots.includes(slotConfig.slotId)
    );

    // Apply role preferences
    if (preferClosers) {
      const closers = eligible.filter(p => p.role.isCloser);
      const others = eligible.filter(p => !p.role.isCloser);
      eligible = [...closers, ...others];
    } else if (preferStarters) {
      const withStarts = eligible.filter(
        p => p.role.currentRole === 'SP' && p.role.startProbabilityNext7 > 0.5
      );
      const otherStarters = eligible.filter(
        p => p.role.currentRole === 'SP' && p.role.startProbabilityNext7 <= 0.5
      );
      const others = eligible.filter(p => p.role.currentRole !== 'SP');
      eligible = [...withStarts, ...otherStarters, ...others];
    }

    if (eligible.length > 0) {
      const selected = eligible[0];
      usedPlayers.add(selected.player.id);

      const slot: LineupSlot = {
        position: slotConfig.slotId,
        player: selected.player,
        projectedPoints: calculatePitcherProjectedPoints(selected.score),
        confidence: mapConfidenceLabel(selected.confidence),
        factors: generatePitcherFactors(selected.score),
      };

      lineup.push(slot);

      if (eligible.length > 1) {
        keyDecisions.push({
          position: slotConfig.slotId,
          chosenPlayer: selected.player,
          alternativesConsidered: eligible.slice(1, 4).map(p => p.player),
          whyChosen: `${selected.role.currentRole} with value ${selected.overallValue}`,
        });
      }
    }
  }

  return { slots: lineup, keyDecisions, usedPlayerIds: usedPlayers };
}

// ============================================================================
// Main Assembly Function (Team State Aware)
// ============================================================================

export function assembleLineupFromTeamState(input: TeamStateLineupInput): AssemblyResult {
  const { teamState, hitterScores, pitcherScores, manualLocks, excludedPlayerIds } = input;
  const errors: string[] = [];
  const traceId = crypto.randomUUID();

  try {
    // Build locked player set from TeamState
    const lockedPlayerIds = new Set<UUID>();
    for (const locked of teamState.currentLineup.lockedSlots) {
      lockedPlayerIds.add(locked.playerId);
    }
    for (const locked of manualLocks || []) {
      lockedPlayerIds.add(locked);
    }

    // Build excluded player set
    const exclusions = new Set<UUID>(excludedPlayerIds || []);
    
    // Exclude injured players automatically
    for (const player of teamState.roster.players) {
      if (player.isInjured && player.injuryStatus !== 'day_to_day') {
        exclusions.add(player.playerId);
      }
    }

    // Prepare scored players from ROSTER ONLY (TeamState boundary)
    const rosterHitters: HitterAssemblyContext['scoredHitters'] = [];
    const rosterPitchers: PitcherAssemblyContext['scoredPitchers'] = [];

    for (const rosterPlayer of teamState.roster.players) {
      if (exclusions.has(rosterPlayer.playerId)) continue;

      // Get eligible slots from TeamState
      const eligibleSlots = getEligibleSlotsForPlayer(teamState, rosterPlayer.playerId);

      if (isPitcher(rosterPlayer.positions)) {
        const score = pitcherScores.get(rosterPlayer.mlbamId);
        if (score) {
          rosterPitchers.push({
            player: {
              id: rosterPlayer.playerId,
              mlbamId: rosterPlayer.mlbamId,
              name: rosterPlayer.name,
              team: rosterPlayer.team,
              position: rosterPlayer.positions,
            },
            score,
            overallValue: score.overallValue,
            confidence: score.confidence,
            role: score.role,
            eligibleSlots,
          });
        }
      } else {
        const score = hitterScores.get(rosterPlayer.mlbamId);
        if (score) {
          rosterHitters.push({
            player: {
              id: rosterPlayer.playerId,
              mlbamId: rosterPlayer.mlbamId,
              name: rosterPlayer.name,
              team: rosterPlayer.team,
              position: rosterPlayer.positions,
            },
            score,
            overallValue: score.overallValue,
            confidence: score.confidence,
            eligibleSlots,
          });
        }
      }
    }

    // Separate slots by domain from TeamState
    const hittingSlots: Array<{ slotId: string; eligiblePositions: string[] }> = [];
    const pitcherSlots: Array<{ slotId: string; eligiblePositions: string[] }> = [];

    for (const slot of teamState.lineupConfig.slots) {
      if (slot.domain === 'hitting' || slot.domain === 'utility') {
        hittingSlots.push({ slotId: slot.slotId, eligiblePositions: slot.eligiblePositions });
      } else if (slot.domain === 'pitching') {
        pitcherSlots.push({ slotId: slot.slotId, eligiblePositions: slot.eligiblePositions });
      }
      // Bench slots are handled separately
    }

    if (rosterHitters.length === 0 && hittingSlots.length > 0) {
      errors.push('No hitters with computed scores on roster');
    }
    if (rosterPitchers.length === 0 && pitcherSlots.length > 0) {
      errors.push('No pitchers with computed scores on roster');
    }

    // Assemble hitters and pitchers SEPARATELY
    const hitterResult = assembleHitters(hittingSlots, {
      scoredHitters: rosterHitters,
      lockedPlayerIds,
      excludedPlayerIds: exclusions,
    });

    const pitcherResult = assemblePitchers(pitcherSlots, {
      scoredPitchers: rosterPitchers,
      lockedPlayerIds,
      excludedPlayerIds: exclusions,
    });

    // Combine results
    const allSlots = [...hitterResult.slots, ...pitcherResult.slots];
    const allKeyDecisions = [...hitterResult.keyDecisions, ...pitcherResult.keyDecisions];

    // Calculate expected points
    const expectedPoints = allSlots.reduce((sum, slot) => sum + slot.projectedPoints, 0);

    // Generate alternatives
    const alternativeLineups = generateAlternatives(
      allSlots,
      rosterHitters,
      rosterPitchers,
      hittingSlots,
      pitcherSlots
    );

    // Build team-aware explanation
    const explanation = generateTeamAwareExplanation(
      allSlots,
      expectedPoints,
      hitterResult.slots.length,
      pitcherResult.slots.length,
      teamState,
      lockedPlayerIds,
      rosterHitters,
      rosterPitchers
    );

    const result: LineupOptimizationResult = {
      requestId: teamState.identity.teamId,
      generatedAt: new Date().toISOString() as ISO8601Timestamp,
      optimalLineup: allSlots,
      expectedPoints,
      confidenceScore: calculateConfidenceScore(allSlots),
      alternativeLineups: alternativeLineups.slice(0, 3),
      explanation,
    };

    return {
      success: errors.length === 0,
      result,
      errors,
      traceId,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      errors: [errorMsg],
      traceId,
    };
  }
}

// ============================================================================
// Helper Functions (Unchanged from domain-aware version)
// ============================================================================

function calculateHitterProjectedPoints(score: PlayerScore): number {
  const basePoints = (score.overallValue / 100) * 25;
  const confidenceAdjustment = score.confidence * 5;
  return Math.round((basePoints + confidenceAdjustment) * 10) / 10;
}

function calculatePitcherProjectedPoints(score: PitcherScore): number {
  const roleMultiplier = score.role.currentRole === 'SP' ? 1.0 :
                         score.role.isCloser ? 0.8 :
                         score.role.holdsEligible ? 0.6 : 0.5;
  const basePoints = (score.overallValue / 100) * 30 * roleMultiplier;
  const confidenceAdjustment = score.confidence * 5;
  return Math.round((basePoints + confidenceAdjustment) * 10) / 10;
}

function generateHitterFactors(score: PlayerScore): string[] {
  const factors: string[] = [];
  if (score.components.hitting >= 70) factors.push('strong_hitter');
  if (score.components.power >= 70) factors.push('power_threat');
  if (score.components.plateDiscipline >= 70) factors.push('good_approach');
  if (score.components.consistency >= 70) factors.push('reliable');
  if (score.components.opportunity >= 70) factors.push('regular_playing_time');
  if (score.reliability.sampleSize === 'small') factors.push('small_sample');
  return factors;
}

function generatePitcherFactors(score: PitcherScore): string[] {
  const factors: string[] = [];
  factors.push(score.role.currentRole.toLowerCase());
  if (score.role.isCloser) factors.push('closer');
  if (score.role.holdsEligible) factors.push('holds_eligible');
  if (score.components.command >= 70) factors.push('elite_command');
  if (score.components.stuff >= 70) factors.push('dominant_stuff');
  if (score.components.results >= 70) factors.push('excellent_results');
  if (score.reliability.sampleSize === 'small') factors.push('small_sample');
  return factors;
}

export function generateAlternatives(
  lineup: LineupSlot[],
  rosterHitters: Array<{ player: PlayerIdentity; score: PlayerScore; overallValue: number; confidence: number; eligibleSlots: string[] }>,
  rosterPitchers: Array<{ player: PlayerIdentity; score: PitcherScore; overallValue: number; confidence: number; eligibleSlots: string[] }>,
  hittingSlots: Array<{ slotId: string }>,
  pitcherSlots: Array<{ slotId: string }>
): AlternativeLineup[] {
  const alternatives: AlternativeLineup[] = [];
  const lineupPlayerIds = new Set(lineup.map((slot) => slot.player.id));

  for (const slot of lineup) {
    const isPitcherSlot = pitcherSlots.some(ps => ps.slotId === slot.position);
    
    const alternativesForSlot = isPitcherSlot
      ? rosterPitchers
          .filter(p => p.player.id !== slot.player.id)
          .filter(p => !lineupPlayerIds.has(p.player.id))
          .filter(p => p.eligibleSlots.includes(slot.position))
          .sort((a, b) => b.overallValue - a.overallValue)
      : rosterHitters
          .filter(h => h.player.id !== slot.player.id)
          .filter(h => !lineupPlayerIds.has(h.player.id))
          .filter(h => h.eligibleSlots.includes(slot.position))
          .sort((a, b) => b.overallValue - a.overallValue);

    if (alternativesForSlot.length > 0) {
      const nextBest = alternativesForSlot[0];
      const replacementProjectedPoints = isPitcherSlot
        ? calculatePitcherProjectedPoints((nextBest as { score: PitcherScore }).score)
        : calculateHitterProjectedPoints((nextBest as { score: PlayerScore }).score);
      const replacementFactors = isPitcherSlot
        ? generatePitcherFactors((nextBest as { score: PitcherScore }).score)
        : generateHitterFactors((nextBest as { score: PlayerScore }).score);
      const altLineup = lineup.map(s =>
        s.position === slot.position && s.player.id === slot.player.id
          ? {
              ...s,
              player: nextBest.player,
              projectedPoints: replacementProjectedPoints,
              confidence: mapConfidenceLabel(nextBest.confidence),
              factors: replacementFactors,
            }
          : s
      );

      const altPoints = altLineup.reduce((sum, s) => sum + s.projectedPoints, 0);
      const origPoints = lineup.reduce((sum, s) => sum + s.projectedPoints, 0);

      alternatives.push({
        lineup: altLineup,
        expectedPoints: altPoints,
        varianceVsOptimal: altPoints - origPoints,
        tradeoffDescription: `Swap ${slot.player.name} for ${nextBest.player.name}`,
      });
    }
  }

  return alternatives;
}

// ============================================================================
// Team-Aware Explanation (Step 4: Decision Justification)
// ============================================================================

function generateTeamAwareExplanation(
  lineup: LineupSlot[],
  expectedPoints: number,
  hitterCount: number,
  pitcherCount: number,
  teamState: TeamState,
  lockedPlayerIds: Set<UUID>,
  rosterHitters: HitterAssemblyContext['scoredHitters'],
  rosterPitchers: PitcherAssemblyContext['scoredPitchers']
): LineupExplanation {
  const summary = buildTeamAwareSummary(lineup, expectedPoints, hitterCount, pitcherCount, teamState);
  
  const keyDecisions: KeyDecisionPoint[] = [];
  
  // Identify critical decisions with team context
  const lockedCount = lockedPlayerIds.size;
  const openSlotCount = teamState.lineupConfig.slots.length - lineup.length;
  
  // Find players with multiple eligible slots (flexibility)
  const flexiblePlayers = rosterHitters.filter(h => 
    h.eligibleSlots.length > 2 && lineup.some(s => s.player.id === h.player.id)
  );
  
  if (flexiblePlayers.length > 0) {
    keyDecisions.push({
      position: 'UTIL',
      chosenPlayer: flexiblePlayers[0].player,
      alternativesConsidered: [],
      whyChosen: `Multi-position eligibility provides roster flexibility`,
    });
  }

  // Identify pitching decisions
  const closerSlots = lineup.filter(s => 
    s.position.toUpperCase().includes('CL') || s.factors.includes('closer')
  );
  if (closerSlots.length > 0) {
    keyDecisions.push({
      position: 'RP/CL',
      chosenPlayer: closerSlots[0].player,
      alternativesConsidered: [],
      whyChosen: `Closer role locked in for save opportunities`,
    });
  }

  const riskFactors: string[] = [];
  
  // Team-specific risks
  if (lockedCount > 0) {
    riskFactors.push(`${lockedCount} players locked (games started)`);
  }
  
  const injuredOnRoster = teamState.roster.players.filter(p => p.isInjured);
  if (injuredOnRoster.length > 0) {
    riskFactors.push(`${injuredOnRoster.length} injured players on roster`);
  }

  const lowConfidence = lineup.filter(s => s.confidence === 'low' || s.confidence === 'very_low');
  if (lowConfidence.length > 0) {
    riskFactors.push(`${lowConfidence.length} low-confidence selections`);
  }

  const opportunities: string[] = [];
  
  // Find valuable bench players
  const lineupIds = new Set(lineup.map(s => s.player.id));
  const valuableBenchHitters = rosterHitters.filter(
    h => !lineupIds.has(h.player.id) && h.overallValue >= 55
  );
  if (valuableBenchHitters.length > 0) {
    opportunities.push(`${valuableBenchHitters.length} valuable hitters on bench for matchups`);
  }

  const streamingPitchers = rosterPitchers.filter(
    p =>
      !lineupIds.has(p.player.id) &&
      p.role.startProbabilityNext7 > 0.7
  );
  if (streamingPitchers.length > 0) {
    opportunities.push(`${streamingPitchers.length} streaming SP options on bench`);
  }

  return {
    summary,
    keyDecisions,
    riskFactors,
    opportunities,
  };
}

function buildTeamAwareSummary(
  lineup: LineupSlot[],
  expectedPoints: number,
  hitterCount: number,
  pitcherCount: number,
  teamState: TeamState
): string {
  const lockedCount = teamState.currentLineup.lockedSlots.length;
  const totalRosterSize = teamState.roster.players.length;
  
  return `Optimized lineup for ${teamState.identity.teamName}: ` +
    `${hitterCount} hitters + ${pitcherCount} pitchers ` +
    `(${lineup.length}/${totalRosterSize} roster spots filled). ` +
    `Projected ${expectedPoints.toFixed(1)} points. ` +
    `${lockedCount > 0 ? `${lockedCount} locked. ` : ''}` +
    `${lineup.filter(s => confidenceLevelToScore(s.confidence) >= confidenceLevelToScore('high')).length} high-confidence selections.`;
}

function calculateConfidenceScore(lineup: LineupSlot[]): number {
  if (lineup.length === 0) return 0;

  const total = lineup.reduce((sum, s) => sum + confidenceLevelToScore(s.confidence), 0);
  return total / lineup.length;
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

export { assembleLineupFromTeamState as assembleLineupDomainAware };

// Re-export from core for convenience
export type { LineupOptimizationResult };

// Old interface for backward compatibility - requires TeamState now
export interface DomainAwareAssemblyInput {
  teamState: TeamState;
  hitterScores: Map<string, PlayerScore>;
  pitcherScores: Map<string, PitcherScore>;
  manualLocks?: Set<UUID>;
  excludedPlayerIds?: Set<UUID>;
}
