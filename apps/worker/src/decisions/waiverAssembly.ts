/**
 * Waiver Decision Assembly
 *
 * Transforms PlayerScores + Roster Constraints → WaiverRecommendationResult
 * Deterministic, simple rules-based recommendations.
 */

import type { UUID, ISO8601Timestamp } from '@cbb/core';
import type {
  WaiverRecommendationRequest,
  WaiverRecommendationResult,
  WaiverRecommendation,
  RosterAnalysis,
  PlayerIdentity,
  ConfidenceLevel,
} from '@cbb/core';
import type { PlayerScore } from '../scoring/index.js';

// ============================================================================
// Types
// ============================================================================

export interface WaiverAssemblyInput {
  request: WaiverRecommendationRequest;
  playerScores: Map<string, PlayerScore>; // mlbamId -> score
}

export interface WaiverAssemblyResult {
  success: boolean;
  result?: WaiverRecommendationResult;
  errors: string[];
  traceId: string;
}

// ============================================================================
// Assembly Functions
// ============================================================================

/**
 * Assemble waiver recommendations from scores and roster analysis.
 */
export function assembleWaiverDecisions(
  input: WaiverAssemblyInput
): WaiverAssemblyResult {
  const { request, playerScores } = input;
  const errors: string[] = [];
  const traceId = crypto.randomUUID();

  try {
    // Get current roster scores
    const rosterScores = request.currentRoster
      .map((slot) => {
        const score = playerScores.get(slot.player.mlbamId);
        return {
          ...slot,
          score,
          overallValue: score?.overallValue ?? 0,
        };
      })
      .filter((s) => s.score !== undefined);

    // Get available FA/waiver players with scores
    const availableScores = request.availablePlayers.players
      .filter((p) => p.isAvailable)
      .map((p) => {
        const score = playerScores.get(p.player.mlbamId);
        return {
          ...p,
          score,
          overallValue: score?.overallValue ?? 0,
        };
      })
      .filter((p) => p.score !== undefined)
      .sort((a, b) => b.overallValue - a.overallValue);

    if (availableScores.length === 0) {
      return {
        success: false,
        errors: ['No available players with computed scores'],
        traceId,
      };
    }

    // Build roster analysis
    const rosterAnalysis = analyzeRoster(rosterScores, request);

    // Generate recommendations based on scope
    const recommendations: WaiverRecommendation[] = [];

    switch (request.recommendationScope) {
      case 'add_only':
        recommendations.push(...generateAddRecommendations(availableScores, request));
        break;

      case 'drop_only':
        recommendations.push(...generateDropRecommendations(rosterScores, request));
        break;

      case 'add_drop':
      case 'full_optimization':
        recommendations.push(...generateSwapRecommendations(
          rosterScores,
          availableScores,
          request
        ));
        break;
    }

    // Rank recommendations
    const rankedRecommendations = recommendations
      .sort((a, b) => b.expectedValue - a.expectedValue)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const result: WaiverRecommendationResult = {
      requestId: request.id,
      generatedAt: new Date().toISOString() as ISO8601Timestamp,
      recommendations: rankedRecommendations.slice(0, 10),
      rosterAnalysis,
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
// Analysis Functions
// ============================================================================

function analyzeRoster(
  rosterScores: {
    player: PlayerIdentity;
    position: string;
    overallValue: number;
  }[],
  request: WaiverRecommendationRequest
): RosterAnalysis {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];

  // Calculate position depth
  const positionCounts: Record<string, number> = {};
  for (const slot of rosterScores) {
    positionCounts[slot.position] = (positionCounts[slot.position] || 0) + 1;
  }

  // Identify strengths
  const avgValue =
    rosterScores.reduce((sum, s) => sum + s.overallValue, 0) / rosterScores.length;
  if (avgValue >= 60) strengths.push('Strong overall roster value');

  const highValuePlayers = rosterScores.filter((s) => s.overallValue >= 70);
  if (highValuePlayers.length >= 3) {
    strengths.push(`${highValuePlayers.length} elite fantasy assets`);
  }

  // Identify weaknesses
  const lowValuePlayers = rosterScores.filter((s) => s.overallValue < 40);
  if (lowValuePlayers.length > 0) {
    weaknesses.push(`${lowValuePlayers.length} underperforming players`);
  }

  // Check positional needs
  if (request.rosterNeeds?.positionalNeeds) {
    for (const [pos, need] of Object.entries(request.rosterNeeds.positionalNeeds)) {
      if (need === 'critical') {
        weaknesses.push(`Critical need at ${pos}`);
      } else if (need === 'high') {
        weaknesses.push(`Need depth at ${pos}`);
      }
    }
  }

  // Identify opportunities
  if (weaknesses.length > 0 && strengths.length > 0) {
    opportunities.push('Upgrade opportunities via waiver wire');
  }

  return {
    strengths,
    weaknesses,
    opportunities,
  };
}

// ============================================================================
// Recommendation Generators
// ============================================================================

function generateAddRecommendations(
  availablePlayers: {
    player: PlayerIdentity;
    score?: PlayerScore;
    overallValue: number;
  }[],
  request: WaiverRecommendationRequest
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  // Get top available players above threshold
  const threshold = request.rosterNeeds?.preferredUpside ? 50 : 45;

  for (const player of availablePlayers.slice(0, 5)) {
    if (player.overallValue < threshold) continue;

    const score = player.score!;

    recommendations.push({
      rank: 0, // Will be reassigned
      player: player.player,
      action: 'add',
      expectedValue: calculateWaiverValue(score),
      confidence: mapConfidence(score.confidence),
      reasoning: generateAddReasoning(score),
      urgency: calculateUrgency(score, request),
    });
  }

  return recommendations;
}

function generateDropRecommendations(
  rosterScores: {
    player: PlayerIdentity;
    position: string;
    score?: PlayerScore;
    overallValue: number;
  }[],
  request: WaiverRecommendationRequest
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  // Find droppable players (low value, high risk)
  const droppable = rosterScores.filter((s) => {
    const score = s.score!;
    return (
      s.overallValue < 40 ||
      score.reliability.sampleSize === 'insufficient' ||
      score.components.opportunity < 30
    );
  });

  for (const slot of droppable.slice(0, 3)) {
    const score = slot.score!;

    recommendations.push({
      rank: 0,
      player: slot.player,
      action: 'drop',
      expectedValue: -score.overallValue, // Negative value = benefit of dropping
      confidence: 'moderate',
      reasoning: generateDropReasoning(score),
      urgency: 'low',
    });
  }

  return recommendations;
}

function generateSwapRecommendations(
  rosterScores: {
    player: PlayerIdentity;
    position: string;
    score?: PlayerScore;
    overallValue: number;
  }[],
  availablePlayers: {
    player: PlayerIdentity;
    score?: PlayerScore;
    overallValue: number;
  }[],
  request: WaiverRecommendationRequest
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  // Find upgrade opportunities
  const droppable = rosterScores.filter((s) =>
    s.overallValue < 50
  );

  for (const avail of availablePlayers.slice(0, 10)) {
    // Find best drop candidate
    const bestDrop = droppable
      .filter((d) => d.overallValue < avail.overallValue - 10) // Minimum 10 point upgrade
      .sort((a, b) => a.overallValue - b.overallValue)[0];

    if (bestDrop) {
      const upgradeValue = avail.overallValue - bestDrop.overallValue;
      const availScore = avail.score!;

      recommendations.push({
        rank: 0,
        player: avail.player,
        action: 'swap',
        dropCandidate: bestDrop.player,
        expectedValue: upgradeValue,
        confidence: mapConfidence(availScore.confidence),
        reasoning: `Upgrade ${bestDrop.overallValue} value to ${avail.overallValue} value. ${generateAddReasoning(availScore)}`,
        urgency: upgradeValue >= 20 ? 'high' : 'medium',
      });
    }
  }

  return recommendations;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateWaiverValue(score: PlayerScore): number {
  // Base value on overall score
  let value = score.overallValue;

  // Boost for upside (high power/speed combo)
  if (score.components.power >= 65 && score.components.speed >= 50) {
    value += 5;
  }

  // Penalty for risk
  if (score.reliability.sampleSize === 'small') value -= 5;
  if (score.reliability.sampleSize === 'insufficient') value -= 10;

  return Math.max(0, value);
}

function mapConfidence(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return 'very_high';
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.6) return 'moderate';
  if (confidence >= 0.4) return 'low';
  return 'very_low';
}

function generateAddReasoning(score: PlayerScore): string {
  const reasons: string[] = [];

  if (score.components.hitting >= 70) reasons.push('Strong hitter');
  if (score.components.power >= 70) reasons.push('Power threat');
  if (score.components.plateDiscipline >= 70) reasons.push('Good plate discipline');
  if (score.components.consistency >= 65) reasons.push('Reliable production');
  if (score.components.opportunity >= 75) reasons.push('Regular playing time');

  if (reasons.length === 0) {
    reasons.push(`Solid overall value (${score.overallValue})`);
  }

  return reasons.join(', ');
}

function generateDropReasoning(score: PlayerScore): string {
  if (score.components.opportunity < 30) {
    return 'Limited playing time - not fantasy relevant';
  }
  if (score.reliability.sampleSize === 'insufficient') {
    return 'Insufficient data to justify roster spot';
  }
  return `Low value score (${score.overallValue}) relative to available alternatives`;
}

function calculateUrgency(
  score: PlayerScore,
  request: WaiverRecommendationRequest
): 'low' | 'medium' | 'high' | 'critical' {
  // Check roster needs
  const positionalNeeds = request.rosterNeeds?.positionalNeeds || {};
  const hasCriticalNeed = Object.values(positionalNeeds).some(
    (n) => n === 'critical'
  );

  if (hasCriticalNeed && score.overallValue >= 65) return 'high';
  if (score.overallValue >= 75) return 'high';
  if (score.overallValue >= 60) return 'medium';
  return 'low';
}
