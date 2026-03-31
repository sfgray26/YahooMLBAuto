/**
 * Lineup Decision Assembly
 *
 * Transforms PlayerScores + Roster Constraints → LineupOptimizationResult
 * Deterministic, no Monte Carlo, no weather, no ballpark factors.
 * Simple greedy assignment based on overall value scores.
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

// ============================================================================
// Types
// ============================================================================

export interface AssemblyInput {
  request: LineupOptimizationRequest;
  playerScores: Map<string, PlayerScore>; // mlbamId -> score
}

export interface AssemblyResult {
  success: boolean;
  result?: LineupOptimizationResult;
  errors: string[];
  traceId: string;
}

// ============================================================================
// Assembly Functions
// ============================================================================

/**
 * Assemble a lineup decision from scores and constraints.
 * Deterministic greedy assignment.
 */
export function assembleLineup(input: AssemblyInput): AssemblyResult {
  const { request, playerScores } = input;
  const errors: string[] = [];
  const traceId = crypto.randomUUID();

  try {
    // Extract available players with scores
    const scoredPlayers = request.availablePlayers.players
      .filter((p) => p.isAvailable)
      .map((p) => {
        const score = playerScores.get(p.player.mlbamId);
        return {
          ...p,
          score,
          overallValue: score?.overallValue ?? 0,
          confidence: score?.confidence ?? 0,
        };
      })
      .filter((p) => p.score !== undefined); // Only players with computed scores

    if (scoredPlayers.length === 0) {
      return {
        success: false,
        errors: ['No players with computed scores available'],
        traceId,
      };
    }

    // Apply manual overrides
    const lockedIn = new Set(request.rosterConstraints.mustInclude || []);
    const lockedOut = new Set(request.rosterConstraints.mustExclude || []);

    for (const override of request.manualOverrides || []) {
      if (override.action === 'lock_in') {
        lockedIn.add(override.playerId);
      } else if (override.action === 'lock_out') {
        lockedOut.add(override.playerId);
      }
    }

    // Filter out locked out players
    const eligiblePlayers = scoredPlayers.filter(
      (p) => !lockedOut.has(p.player.id)
    );

    // Sort by overall value (descending)
    const sortedPlayers = [...eligiblePlayers].sort(
      (a, b) => b.overallValue - a.overallValue
    );

    // Build lineup via greedy position assignment
    const lineup: LineupSlot[] = [];
    const usedPlayers = new Set<UUID>();
    const keyDecisions: KeyDecisionPoint[] = [];

    for (const position of request.leagueConfig.rosterPositions) {
      const slotsToFill = position.maxCount;

      for (let i = 0; i < slotsToFill; i++) {
        // Find best eligible player for this position
        const eligibleForPosition = sortedPlayers.filter(
          (p) =>
            !usedPlayers.has(p.player.id) &&
            (p.player.position.some((pos) =>
              position.eligiblePositions.includes(pos)) ||
              position.eligiblePositions.includes('UTIL'))
        );

        // Check locked slots
        const slotId = `${position.slot}_${i}`;
        if (request.rosterConstraints.lockedSlots.includes(slotId)) {
          // Find player already in this slot (from current roster)
          // For now, skip locked slots
          continue;
        }

        // Prioritize locked-in players
        const lockedInPlayer = eligibleForPosition.find((p) =>
          lockedIn.has(p.player.id)
        );

        const selected = lockedInPlayer || eligibleForPosition[0];

        if (selected) {
          usedPlayers.add(selected.player.id);

          const slot: LineupSlot = {
            position: position.slot,
            player: selected.player,
            projectedPoints: calculateProjectedPoints(selected.score!),
            confidence: mapConfidence(selected.confidence),
            factors: generateFactors(selected.score!),
          };

          lineup.push(slot);

          // Record key decision if there were alternatives
          if (eligibleForPosition.length > 1) {
            keyDecisions.push({
              position: position.slot,
              chosenPlayer: selected.player,
              alternativesConsidered: eligibleForPosition
                .slice(1, 4)
                .map((p) => p.player),
              whyChosen: `Higher overall value score (${selected.overallValue} vs ${eligibleForPosition[1]?.overallValue || 0})`,
            });
          }
        }
      }
    }

    // Calculate expected points
    const expectedPoints = lineup.reduce(
      (sum, slot) => sum + slot.projectedPoints,
      0
    );

    // Generate alternative lineups (swap one player at a time)
    const alternativeLineups = generateAlternatives(
      lineup,
      scoredPlayers,
      request
    );

    // Build explanation
    const explanation: LineupExplanation = {
      summary: generateSummary(lineup, expectedPoints),
      keyDecisions: keyDecisions.slice(0, 5),
      riskFactors: generateRiskFactors(lineup),
      opportunities: generateOpportunities(lineup, scoredPlayers),
    };

    const result: LineupOptimizationResult = {
      requestId: request.id,
      generatedAt: new Date().toISOString() as ISO8601Timestamp,
      optimalLineup: lineup,
      expectedPoints,
      confidenceScore: calculateConfidenceScore(lineup),
      alternativeLineups: alternativeLineups.slice(0, 3),
      explanation,
    };

    return {
      success: true,
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
// Helper Functions
// ============================================================================

function calculateProjectedPoints(score: PlayerScore): number {
  // Simple projection based on overall value
  // Scale 0-100 to fantasy points (rough approximation)
  const basePoints = (score.overallValue / 100) * 25; // 0-25 points per game

  // Adjust for confidence
  const confidenceAdjustment = score.confidence * 5; // 0-5 point boost

  return Math.round((basePoints + confidenceAdjustment) * 10) / 10;
}

function mapConfidence(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return 'very_high';
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.6) return 'moderate';
  if (confidence >= 0.4) return 'low';
  return 'very_low';
}

function generateFactors(score: PlayerScore): string[] {
  const factors: string[] = [];

  // Component-based factors
  if (score.components.hitting >= 70) factors.push('strong_hitter');
  if (score.components.power >= 70) factors.push('power_threat');
  if (score.components.plateDiscipline >= 70) factors.push('good_approach');
  if (score.components.consistency >= 70) factors.push('reliable');
  if (score.components.opportunity >= 70) factors.push('regular_playing_time');

  // Risk factors
  if (score.reliability.sampleSize === 'small') factors.push('small_sample');
  if (score.reliability.sampleSize === 'insufficient') factors.push('insufficient_data');

  return factors;
}

function generateAlternatives(
  lineup: LineupSlot[],
  allPlayers: ({
    player: PlayerIdentity;
    score?: PlayerScore;
    overallValue: number;
  })[],
  request: LineupOptimizationRequest
): AlternativeLineup[] {
  const alternatives: AlternativeLineup[] = [];

  // Try swapping each position with the next best alternative
  for (const slot of lineup) {
    const position = request.leagueConfig.rosterPositions.find(
      (p) => p.slot === slot.position
    );
    if (!position) continue;

    const alternativesForSlot = allPlayers.filter(
      (p) =>
        p.player.id !== slot.player.id &&
        (p.player.position.some((pos) =>
          position.eligiblePositions.includes(pos)) ||
          position.eligiblePositions.includes('UTIL'))
    );

    if (alternativesForSlot.length > 0) {
      const nextBest = alternativesForSlot[0];
      const altLineup = lineup.map((s) =>
        s.position === slot.position
          ? {
              ...s,
              player: nextBest.player,
              projectedPoints: calculateProjectedPoints(nextBest.score!),
            }
          : s
      );

      const altPoints = altLineup.reduce(
        (sum, s) => sum + s.projectedPoints,
        0
      );

      alternatives.push({
        lineup: altLineup,
        expectedPoints: altPoints,
        varianceVsOptimal: altPoints - lineup.reduce((sum, s) => sum + s.projectedPoints, 0),
        tradeoffDescription: `Swap ${slot.player.name} for ${nextBest.player.name}`,
      });
    }
  }

  return alternatives;
}

function generateSummary(lineup: LineupSlot[], expectedPoints: number): string {
  const playerCount = lineup.length;
  const avgValue =
    lineup.reduce((sum, s) => sum + ((s.player as unknown as { value?: number }).value || 0), 0) /
    playerCount;

  return `Optimized lineup with ${playerCount} players projected for ${expectedPoints.toFixed(1)} points. ` +
    `Core lineup built on ${lineup.filter(s => s.confidence >= 'high').length} high-confidence selections.`;
}

function generateRiskFactors(lineup: LineupSlot[]): string[] {
  const risks: string[] = [];

  const lowConfidence = lineup.filter((s) =>
    s.confidence === 'low' || s.confidence === 'very_low'
  );
  if (lowConfidence.length > 0) {
    risks.push(
      `${lowConfidence.length} low-confidence selections due to small sample sizes`
    );
  }

  const smallSamples = lineup.filter((s) =>
    s.factors.includes('small_sample')
  );
  if (smallSamples.length > 0) {
    risks.push('Recent call-ups with limited MLB experience');
  }

  return risks;
}

function generateOpportunities(
  lineup: LineupSlot[],
  allPlayers: { player: PlayerIdentity; overallValue: number }[]
): string[] {
  const opportunities: string[] = [];

  // Find high-value players not in lineup
  const lineupIds = new Set(lineup.map((s) => s.player.id));
  const benchOptions = allPlayers.filter(
    (p) => !lineupIds.has(p.player.id) && p.overallValue >= 60
  );

  if (benchOptions.length > 0) {
    opportunities.push(
      `${benchOptions.length} high-value players available on bench for matchups`
    );
  }

  // Check for hot streaks
  const hotPlayers = lineup.filter((s) =>
    s.factors.includes('strong_hitter') && s.factors.includes('reliable')
  );
  if (hotPlayers.length >= 3) {
    opportunities.push(
      `${hotPlayers.length} reliable bats in lineup - consider stacking`
    );
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
