/**
 * Lineup Decision Assembly - DOMAIN AWARE
 *
 * CRITICAL PRINCIPLE: Hitters and Pitchers are SEPARATE DOMAINS.
 * They share identities (player_id, mlbamId) but have DIFFERENT scoring.
 * Never compare hitters and pitchers directly.
 *
 * Assembly Strategy:
 * 1. Separate roster slots by domain (hitting vs pitching)
 * 2. Optimize hitters within hitting slots
 * 3. Optimize pitchers within pitching slots
 * 4. Combine results - no cross-domain comparison
 */

import type { UUID, ISO8601Timestamp } from '@cbb/core';
import type {
  LineupOptimizationRequest,
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

// ============================================================================
// Types
// ============================================================================

export interface DomainAwareAssemblyInput {
  request: LineupOptimizationRequest;
  hitterScores: Map<string, PlayerScore>;     // mlbamId -> hitter score
  pitcherScores: Map<string, PitcherScore>;   // mlbamId -> pitcher score
}

export interface AssemblyResult {
  success: boolean;
  result?: LineupOptimizationResult;
  errors: string[];
  traceId: string;
}

// Domain discriminator
export type PerformanceDomain = 'hitting' | 'pitching';

export interface DomainSlot {
  slot: string;
  domain: PerformanceDomain;
  eligiblePositions: string[];
}

// ============================================================================
// Domain Classification
// ============================================================================

/**
 * Determine the domain for a roster slot.
 * Pitcher slots: SP, RP, P, CL (and variations)
 * Hitting slots: Everything else
 */
function getSlotDomain(slot: string): PerformanceDomain {
  const pitcherSlots = ['SP', 'RP', 'P', 'CL', 'SP/RP', 'PITCHER'];
  const upperSlot = slot.toUpperCase();
  
  // Check if slot is a pitcher slot
  if (pitcherSlots.some(ps => upperSlot.includes(ps))) {
    return 'pitching';
  }
  
  return 'hitting';
}

/**
 * Check if a player is eligible for a slot based on domain.
 * A hitter cannot fill a pitcher slot and vice versa.
 */
function isEligibleForDomain(
  playerPositions: string[],
  slotDomain: PerformanceDomain
): boolean {
  const hasPitcherPosition = playerPositions.some(p => 
    ['SP', 'RP', 'P', 'CL'].includes(p.toUpperCase())
  );
  
  if (slotDomain === 'pitching') {
    return hasPitcherPosition;
  } else {
    return !hasPitcherPosition;
  }
}

// ============================================================================
// Hitter Assembly
// ============================================================================

interface HitterAssemblyContext {
  scoredHitters: Array<{
    player: PlayerIdentity;
    score: PlayerScore;
    overallValue: number;
    confidence: number;
  }>;
  lockedIn: Set<UUID>;
  lockedOut: Set<UUID>;
  lockedSlots: Set<string>;
}

function assembleHitters(
  hittingSlots: Array<{ slot: string; maxCount: number; eligiblePositions: string[] }>,
  context: HitterAssemblyContext,
  request: LineupOptimizationRequest
): { slots: LineupSlot[]; keyDecisions: KeyDecisionPoint[] } {
  const lineup: LineupSlot[] = [];
  const keyDecisions: KeyDecisionPoint[] = [];
  const usedPlayers = new Set<UUID>();

  const { scoredHitters, lockedIn, lockedOut, lockedSlots } = context;

  // Sort hitters by overall value
  const sortedHitters = [...scoredHitters]
    .filter(h => !lockedOut.has(h.player.id))
    .sort((a, b) => b.overallValue - a.overallValue);

  for (const position of hittingSlots) {
    for (let i = 0; i < position.maxCount; i++) {
      const slotId = `${position.slot}_${i}`;
      
      // Skip locked slots
      if (lockedSlots.has(slotId)) continue;

      // Find eligible hitters for this slot
      const eligible = sortedHitters.filter(
        h =>
          !usedPlayers.has(h.player.id) &&
          (h.player.position.some((pos) =
            position.eligiblePositions.includes(pos)) ||
            position.eligiblePositions.includes('UTIL'))
      );

      // Prioritize locked-in players
      const lockedInPlayer = eligible.find((h) => lockedIn.has(h.player.id));
      const selected = lockedInPlayer || eligible[0];

      if (selected) {
        usedPlayers.add(selected.player.id);

        const slot: LineupSlot = {
          position: position.slot,
          player: selected.player,
          projectedPoints: calculateHitterProjectedPoints(selected.score),
          confidence: mapConfidence(selected.confidence),
          factors: generateHitterFactors(selected.score),
        };

        lineup.push(slot);

        // Record key decision if alternatives exist
        if (eligible.length > 1) {
          keyDecisions.push({
            position: position.slot,
            chosenPlayer: selected.player,
            alternativesConsidered: eligible.slice(1, 4).map((h) => h.player),
            whyChosen: `Hitter value ${selected.overallValue} vs ${eligible[1]?.overallValue || 0}`,
          });
        }
      }
    }
  }

  return { slots: lineup, keyDecisions };
}

// ============================================================================
// Pitcher Assembly
// ============================================================================

interface PitcherAssemblyContext {
  scoredPitchers: Array<{
    player: PlayerIdentity;
    score: PitcherScore;
    overallValue: number;
    confidence: number;
    role: PitcherScore['role'];
  }>;
  lockedIn: Set<UUID>;
  lockedOut: Set<UUID>;
  lockedSlots: Set<string>;
}

function assemblePitchers(
  pitcherSlots: Array<{ slot: string; maxCount: number; eligiblePositions: string[] }>,
  context: PitcherAssemblyContext,
  request: LineupOptimizationRequest
): { slots: LineupSlot[]; keyDecisions: KeyDecisionPoint[] } {
  const lineup: LineupSlot[] = [];
  const keyDecisions: KeyDecisionPoint[] = [];
  const usedPlayers = new Set<UUID>();

  const { scoredPitchers, lockedIn, lockedOut, lockedSlots } = context;

  // Sort pitchers by role priority, then value
  // Closers and starters prioritized differently based on slot
  const sortedPitchers = [...scoredPitchers]
    .filter(p => !lockedOut.has(p.player.id))
    .sort((a, b) => {
      // Role priority for fantasy
      const rolePriority = { CL: 4, SP: 3, SWING: 2, RP: 1 };
      const aPriority = rolePriority[a.role.currentRole] || 0;
      const bPriority = rolePriority[b.role.currentRole] || 0;
      
      if (aPriority !== bPriority) return bPriority - aPriority;
      return b.overallValue - a.overallValue;
    });

  for (const position of pitcherSlots) {
    for (let i = 0; i < position.maxCount; i++) {
      const slotId = `${position.slot}_${i}`;
      
      // Skip locked slots
      if (lockedSlots.has(slotId)) continue;

      // Determine role preference for this slot
      const slotUpper = position.slot.toUpperCase();
      const preferClosers = slotUpper.includes('CL');
      const preferStarters = slotUpper.includes('SP') && !slotUpper.includes('RP');

      // Find eligible pitchers for this slot
      let eligible = sortedPitchers.filter(
        p =>
          !usedPlayers.has(p.player.id) &&
          p.player.position.some((pos) =
            position.eligiblePositions.includes(pos))
      );

      // Apply role preferences
      if (preferClosers) {
        // Prioritize closers, then any high-value pitcher
        const closers = eligible.filter(p => p.role.isCloser);
        const others = eligible.filter(p => !p.role.isCloser);
        eligible = [...closers, ...others];
      } else if (preferStarters) {
        // Prioritize starters with scheduled starts
        const startersWithStarts = eligible.filter(
          p => p.role.currentRole === 'SP' && p.role.startProbabilityNext7 > 0.5
        );
        const otherStarters = eligible.filter(
          p => p.role.currentRole === 'SP' && p.role.startProbabilityNext7 <= 0.5
        );
        const others = eligible.filter(p => p.role.currentRole !== 'SP');
        eligible = [...startersWithStarts, ...otherStarters, ...others];
      }

      // Prioritize locked-in players
      const lockedInPlayer = eligible.find((p) => lockedIn.has(p.player.id));
      const selected = lockedInPlayer || eligible[0];

      if (selected) {
        usedPlayers.add(selected.player.id);

        const slot: LineupSlot = {
          position: position.slot,
          player: selected.player,
          projectedPoints: calculatePitcherProjectedPoints(selected.score),
          confidence: mapConfidence(selected.confidence),
          factors: generatePitcherFactors(selected.score),
        };

        lineup.push(slot);

        // Record key decision
        if (eligible.length > 1) {
          keyDecisions.push({
            position: position.slot,
            chosenPlayer: selected.player,
            alternativesConsidered: eligible.slice(1, 4).map((p) => p.player),
            whyChosen: `Pitcher ${selected.role.currentRole} with value ${selected.overallValue}`,
          });
        }
      }
    }
  }

  return { slots: lineup, keyDecisions };
}

// ============================================================================
// Main Assembly Function
// ============================================================================

/**
 * Domain-aware lineup assembly.
 * NEVER compares hitters to pitchers directly.
 */
export function assembleLineupDomainAware(input: DomainAwareAssemblyInput): AssemblyResult {
  const { request, hitterScores, pitcherScores } = input;
  const errors: string[] = [];
  const traceId = crypto.randomUUID();

  try {
    // Apply manual overrides
    const lockedIn = new Set<UUID>(request.rosterConstraints.mustInclude || []);
    const lockedOut = new Set<UUID>(request.rosterConstraints.mustExclude || []);
    const lockedSlots = new Set<string>(request.rosterConstraints.lockedSlots || []);

    for (const override of request.manualOverrides || []) {
      if (override.action === 'lock_in') lockedIn.add(override.playerId);
      else if (override.action === 'lock_out') lockedOut.add(override.playerId);
    }

    // Separate slots by domain
    const hittingSlots: Array<{ slot: string; maxCount: number; eligiblePositions: string[] }> = [];
    const pitcherSlots: Array<{ slot: string; maxCount: number; eligiblePositions: string[] }> = [];

    for (const pos of request.leagueConfig.rosterPositions) {
      const domain = getSlotDomain(pos.slot);
      if (domain === 'pitching') {
        pitcherSlots.push(pos);
      } else {
        hittingSlots.push(pos);
      }
    }

    // Prepare scored hitters
    const scoredHitters = request.availablePlayers.players
      .filter(p => p.isAvailable && isEligibleForDomain(p.player.position, 'hitting'))
      .map(p => {
        const score = hitterScores.get(p.player.mlbamId);
        return {
          player: p.player,
          score,
          overallValue: score?.overallValue ?? 0,
          confidence: score?.confidence ?? 0,
        };
      })
      .filter(h => h.score !== undefined);

    // Prepare scored pitchers
    const scoredPitchers = request.availablePlayers.players
      .filter(p => p.isAvailable && isEligibleForDomain(p.player.position, 'pitching'))
      .map(p => {
        const score = pitcherScores.get(p.player.mlbamId);
        return {
          player: p.player,
          score,
          overallValue: score?.overallValue ?? 0,
          confidence: score?.confidence ?? 0,
          role: score?.role ?? { currentRole: 'RP', isCloser: false, holdsEligible: false, expectedInningsPerWeek: 3, startProbabilityNext7: 0 },
        };
      })
      .filter(p => p.score !== undefined);

    if (scoredHitters.length === 0 && hittingSlots.length > 0) {
      errors.push('No hitters with computed scores available');
    }
    if (scoredPitchers.length === 0 && pitcherSlots.length > 0) {
      errors.push('No pitchers with computed scores available');
    }

    // Assemble hitters and pitchers SEPARATELY
    const hitterResult = assembleHitters(hittingSlots, { scoredHitters, lockedIn, lockedOut, lockedSlots }, request);
    const pitcherResult = assemblePitchers(pitcherSlots, { scoredPitchers, lockedIn, lockedOut, lockedSlots }, request);

    // Combine results (no cross-domain comparison)
    const allSlots = [...hitterResult.slots, ...pitcherResult.slots];
    const allKeyDecisions = [...hitterResult.keyDecisions, ...pitcherResult.keyDecisions];

    // Calculate expected points
    const expectedPoints = allSlots.reduce((sum, slot) => sum + slot.projectedPoints, 0);

    // Generate alternatives (within-domain swaps only)
    const alternativeLineups = generateDomainAwareAlternatives(
      allSlots,
      scoredHitters,
      scoredPitchers,
      request
    );

    // Build explanation
    const explanation: LineupExplanation = {
      summary: generateDomainAwareSummary(allSlots, expectedPoints, hitterResult.slots.length, pitcherResult.slots.length),
      keyDecisions: allKeyDecisions.slice(0, 5),
      riskFactors: generateDomainAwareRiskFactors(allSlots, scoredHitters, scoredPitchers),
      opportunities: generateDomainAwareOpportunities(allSlots, scoredHitters, scoredPitchers),
    };

    const result: LineupOptimizationResult = {
      requestId: request.id,
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
// Projection & Factor Functions
// ============================================================================

function calculateHitterProjectedPoints(score: PlayerScore): number {
  const basePoints = (score.overallValue / 100) * 25;
  const confidenceAdjustment = score.confidence * 5;
  return Math.round((basePoints + confidenceAdjustment) * 10) / 10;
}

function calculatePitcherProjectedPoints(score: PitcherScore): number {
  // Pitchers project differently based on role
  const roleMultiplier = score.role.currentRole === 'SP' ? 1.0 :
                         score.role.isCloser ? 0.8 :
                         score.role.holdsEligible ? 0.6 : 0.5;
  
  const basePoints = (score.overallValue / 100) * 30 * roleMultiplier;
  const confidenceAdjustment = score.confidence * 5;
  return Math.round((basePoints + confidenceAdjustment) * 10) / 10;
}

function mapConfidence(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return 'very_high';
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.6) return 'moderate';
  if (confidence >= 0.4) return 'low';
  return 'very_low';
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
  if (score.components.workload >= 70) factors.push('workhorse');
  if (score.reliability.sampleSize === 'small') factors.push('small_sample');
  return factors;
}

// ============================================================================
// Summary & Explanation Functions
// ============================================================================

function generateDomainAwareAlternatives(
  lineup: LineupSlot[],
  scoredHitters: Array<{ player: PlayerIdentity; score: PlayerScore }>,
  scoredPitchers: Array<{ player: PlayerIdentity; score: PitcherScore }>,
  request: LineupOptimizationRequest
): AlternativeLineup[] {
  const alternatives: AlternativeLineup[] = [];

  for (const slot of lineup) {
    const slotDomain = getSlotDomain(slot.position);
    
    // Only generate alternatives from same domain
    const alternativesForSlot = slotDomain === 'pitching'
      ? scoredPitchers.filter(p => p.player.id !== slot.player.id)
      : scoredHitters.filter(h => h.player.id !== slot.player.id);

    if (alternativesForSlot.length > 0) {
      const nextBest = alternativesForSlot[0];
      const altLineup = lineup.map(s =>
        s.position === slot.position && s.player.id === slot.player.id
          ? { ...s, player: nextBest.player }
          : s
      );

      const altPoints = altLineup.reduce((sum, s) => sum + s.projectedPoints, 0);
      const origPoints = lineup.reduce((sum, s) => sum + s.projectedPoints, 0);

      alternatives.push({
        lineup: altLineup,
        expectedPoints: altPoints,
        varianceVsOptimal: altPoints - origPoints,
        tradeoffDescription: `Swap ${slot.player.name} for ${nextBest.player.name} (${slotDomain})`,
      });
    }
  }

  return alternatives;
}

function generateDomainAwareSummary(
  lineup: LineupSlot[],
  expectedPoints: number,
  hitterCount: number,
  pitcherCount: number
): string {
  return `Domain-optimized lineup: ${hitterCount} hitters + ${pitcherCount} pitchers. ` +
    `Projected ${expectedPoints.toFixed(1)} points. ` +
    `${lineup.filter(s => s.confidence >= 'high').length} high-confidence selections.`;
}

function generateDomainAwareRiskFactors(
  lineup: LineupSlot[],
  scoredHitters: Array<{ player: PlayerIdentity; score: PlayerScore }>,
  scoredPitchers: Array<{ player: PlayerIdentity; score: PitcherScore }>
): string[] {
  const risks: string[] = [];

  const lowConfidence = lineup.filter(s => s.confidence === 'low' || s.confidence === 'very_low');
  if (lowConfidence.length > 0) {
    risks.push(`${lowConfidence.length} low-confidence selections`);
  }

  const blowUpRiskPitchers = scoredPitchers.filter(
    p => p.score.components.consistency < 40
  );
  if (blowUpRiskPitchers.length > 0) {
    risks.push(`${blowUpRiskPitchers.length} pitchers with blow-up risk in rotation`);
  }

  return risks;
}

function generateDomainAwareOpportunities(
  lineup: LineupSlot[],
  scoredHitters: Array<{ player: PlayerIdentity; score: PlayerScore }>,
  scoredPitchers: Array<{ player: PlayerIdentity; score: PitcherScore }>
): string[] {
  const opportunities: string[] = [];

  const lineupIds = new Set(lineup.map(s => s.player.id));

  // Hitter opportunities
  const benchHitters = scoredHitters.filter(
    h => !lineupIds.has(h.player.id) && h.score.overallValue >= 60
  );
  if (benchHitters.length > 0) {
    opportunities.push(`${benchHitters.length} valuable hitters on bench`);
  }

  // Pitcher opportunities (the cheat code)
  const streamerPitchers = scoredPitchers.filter(
    p =>
      !lineupIds.has(p.player.id) &&
      (p.score.role.startProbabilityNext7 > 0.7 ||
       (p.score.role.isCloser && p.score.overallValue >= 65))
  );
  if (streamerPitchers.length > 0) {
    opportunities.push(`${streamerPitchers.length} streaming pitcher options available`);
  }

  return opportunities;
}

function calculateConfidenceScore(lineup: LineupSlot[]): number {
  if (lineup.length === 0) return 0;

  const confidenceMap: Record<ConfidenceLevel, number> = {
    very_high: 1.0,
    high: 0.8,
    moderate: 0.6,
    low: 0.4,
    very_low: 0.2,
  };

  const totalConfidence = lineup.reduce(
    (sum, s) => sum + confidenceMap[s.confidence],
    0
  );

  return totalConfidence / lineup.length;
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

/**
 * Legacy assembleLineup for backward compatibility.
 * Only works with hitters - pitchers must use assembleLineupDomainAware.
 * @deprecated Use assembleLineupDomainAware for full lineup assembly
 */
export function assembleLineup(input: {
  request: LineupOptimizationRequest;
  playerScores: Map<string, PlayerScore>;
}): AssemblyResult {
  return assembleLineupDomainAware({
    request: input.request,
    hitterScores: input.playerScores,
    pitcherScores: new Map(),
  });
}
