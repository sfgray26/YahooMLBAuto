/**
 * Waiver Decision Assembly - DOMAIN AWARE with PITCHER EDGE
 *
 * CRITICAL PRINCIPLE: Pitchers are the waiver cheat code.
 * 
 * Why pitchers dominate waivers:
 * 1. Higher volatility = more opportunities to find value
 * 2. Streaming SPs is a known winning strategy
 * 3. Closers emerge throughout the season (role changes)
 * 4. Holds leagues have hidden value in middle relievers
 * 5. One hot streak can win a week (unlike hitters)
 *
 * WAIVER STRATEGY:
 * - Prioritize high-upside pitchers in uncertain markets
 * - Track role changes (closer/holds opportunities)
 * - Stream starters with favorable matchups
 * - Don't chase hitting on waivers (stable, predictable)
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
import type { PitcherScore } from '../pitchers/index.js';

// ============================================================================
// Types
// ============================================================================

export interface DomainAwareWaiverInput {
  request: WaiverRecommendationRequest;
  hitterScores: Map<string, PlayerScore>;
  pitcherScores: Map<string, PitcherScore>;
}

export interface WaiverAssemblyResult {
  success: boolean;
  result?: WaiverRecommendationResult;
  errors: string[];
  traceId: string;
}

// Domain discriminator
export type PerformanceDomain = 'hitting' | 'pitching';

interface ScoredHitter {
  player: PlayerIdentity;
  score: PlayerScore;
  overallValue: number;
  domain: 'hitting';
}

interface ScoredPitcher {
  player: PlayerIdentity;
  score: PitcherScore;
  overallValue: number;
  role: PitcherScore['role'];
  domain: 'pitching';
  waiverEdge: number;  // Calculated edge score
}

type ScoredPlayer = ScoredHitter | ScoredPitcher;

// ============================================================================
// Domain Classification
// ============================================================================

function isPitcher(player: PlayerIdentity): boolean {
  return player.position.some(p => 
    ['SP', 'RP', 'P', 'CL'].includes(p.toUpperCase())
  );
}

// ============================================================================
// Pitcher Edge Calculation
// ============================================================================

/**
 * Calculate the "waiver edge" for a pitcher.
 * This is the secret sauce - identifies pitchers who are waiver gold.
 */
function calculatePitcherWaiverEdge(pitcher: ScoredPitcher): number {
  const score = pitcher.score;
  let edge = 0;

  // 1. Role change opportunity (biggest edge)
  if (score.role.isCloser) {
    // New closer with decent stuff = massive edge
    edge += score.components.stuff >= 60 ? 25 : 15;
  } else if (score.role.holdsEligible && score.components.stuff >= 65) {
    // High-strikeout setup man for holds leagues
    edge += 15;
  } else if (score.role.currentRole === 'SP' && score.role.startProbabilityNext7 > 0.8) {
    // Streaming starter with two starts
    edge += 20;
  }

  // 2. Skills > results discrepancy (buy low)
  if (score.components.stuff >= 70 && score.components.results <= 45) {
    // Dominant stuff, poor results = buy low opportunity
    edge += 15;
  }

  // 3. Workload upside
  if (score.components.workload >= 70 && score.role.expectedInningsPerWeek >= 12) {
    // Workhorse SP who can accumulate volume
    edge += 10;
  }

  // 4. Consistency floor (avoid blow-up artists)
  if (score.components.consistency >= 60) {
    edge += 5;
  } else if (score.components.consistency <= 35) {
    edge -= 10;  // Penalty for blow-up risk
  }

  // 5. Matchup context
  if (score.components.matchup >= 65) {
    edge += 5;  // Favorable upcoming matchups
  }

  // 6. Confidence adjustment
  if (score.reliability.sampleSize === 'small') {
    edge -= 5;  // Small sample uncertainty
  }

  return edge;
}

/**
 * Calculate waiver edge for hitters (more conservative).
 */
function calculateHitterWaiverEdge(hitter: ScoredHitter): number {
  const score = hitter.score;
  let edge = 0;

  // Hitters are more stable - less edge on waivers generally
  if (score.components.opportunity >= 75 && score.components.consistency >= 60) {
    edge += 10;  // Full-time player with consistency
  }

  if (score.components.power >= 70 || score.components.speed >= 70) {
    edge += 8;  // Category specialist
  }

  // Platoon advantage
  if (score.components.opportunity >= 70 && score.reliability.sampleSize === 'adequate') {
    edge += 5;
  }

  return edge;
}

// ============================================================================
// Main Assembly Function
// ============================================================================

/**
 * Assemble waiver recommendations with pitcher edge detection.
 * Pitchers are prioritized as the waiver cheat code.
 */
export function assembleWaiverDecisionsDomainAware(
  input: DomainAwareWaiverInput
): WaiverAssemblyResult {
  const { request, hitterScores, pitcherScores } = input;
  const errors: string[] = [];
  const traceId = crypto.randomUUID();

  try {
    // Build scored players list with domain and edge
    const rosterPlayers: ScoredPlayer[] = [];
    const availablePlayers: ScoredPlayer[] = [];

    // Process roster
    for (const slot of request.currentRoster) {
      if (isPitcher(slot.player)) {
        const score = pitcherScores.get(slot.player.mlbamId);
        if (score) {
          const pitcher: ScoredPitcher = {
            player: slot.player,
            score,
            overallValue: score.overallValue,
            role: score.role,
            domain: 'pitching',
            waiverEdge: 0,  // Will calculate below
          };
          pitcher.waiverEdge = calculatePitcherWaiverEdge(pitcher);
          rosterPlayers.push(pitcher);
        }
      } else {
        const score = hitterScores.get(slot.player.mlbamId);
        if (score) {
          const hitter: ScoredHitter = {
            player: slot.player,
            score,
            overallValue: score.overallValue,
            domain: 'hitting',
          };
          rosterPlayers.push(hitter);
        }
      }
    }

    // Process available players
    for (const avail of request.availablePlayers.players.filter(p => p.isAvailable)) {
      if (isPitcher(avail.player)) {
        const score = pitcherScores.get(avail.player.mlbamId);
        if (score) {
          const pitcher: ScoredPitcher = {
            player: avail.player,
            score,
            overallValue: score.overallValue,
            role: score.role,
            domain: 'pitching',
            waiverEdge: 0,
          };
          pitcher.waiverEdge = calculatePitcherWaiverEdge(pitcher);
          availablePlayers.push(pitcher);
        }
      } else {
        const score = hitterScores.get(avail.player.mlbamId);
        if (score) {
          const hitter: ScoredHitter = {
            player: avail.player,
            score,
            overallValue: score.overallValue,
            domain: 'hitting',
          };
          availablePlayers.push(hitter);
        }
      }
    }

    if (availablePlayers.length === 0) {
      return {
        success: false,
        errors: ['No available players with computed scores'],
        traceId,
      };
    }

    // Build roster analysis
    const rosterAnalysis = analyzeRosterDomainAware(rosterPlayers, request);

    // Generate recommendations
    const recommendations: WaiverRecommendation[] = [];

    switch (request.recommendationScope) {
      case 'add_only':
        recommendations.push(...generateAddRecommendationsDomainAware(availablePlayers));
        break;

      case 'drop_only':
        recommendations.push(...generateDropRecommendationsDomainAware(rosterPlayers));
        break;

      case 'add_drop':
      case 'full_optimization':
        recommendations.push(...generateSwapRecommendationsDomainAware(
          rosterPlayers,
          availablePlayers
        ));
        break;
    }

    // Rank by edge (pitchers get priority)
    const rankedRecommendations = recommendations
      .sort((a, b) => {
        // Pitcher edge bonus in ranking
        const aEdge = a.expectedValue;
        const bEdge = b.expectedValue;
        return bEdge - aEdge;
      })
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

function analyzeRosterDomainAware(
  rosterPlayers: ScoredPlayer[],
  request: WaiverRecommendationRequest
): RosterAnalysis {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];

  const hitters = rosterPlayers.filter(p => p.domain === 'hitting') as ScoredHitter[];
  const pitchers = rosterPlayers.filter(p => p.domain === 'pitching') as ScoredPitcher[];

  // Hitter analysis
  const hitterAvg = hitters.reduce((sum, h) => sum + h.overallValue, 0) / (hitters.length || 1);
  if (hitterAvg >= 60) strengths.push('Strong hitting core');
  else if (hitterAvg < 50) weaknesses.push('Weak hitting foundation');

  // Pitcher analysis
  const spCount = pitchers.filter(p => p.role.currentRole === 'SP').length;
  const closerCount = pitchers.filter(p => p.role.isCloser).length;
  const holdsCount = pitchers.filter(p => p.role.holdsEligible).length;

  if (spCount >= 5) strengths.push('Deep starting rotation');
  else if (spCount < 3) weaknesses.push('Shallow rotation - stream opportunities');

  if (closerCount >= 2) strengths.push('Strong closer situation');
  else if (closerCount === 0) {
    weaknesses.push('No closer - priority add');
    opportunities.push('Monitor bullpens for role changes');
  }

  if (holdsCount >= 2) strengths.push('Holds coverage');

  // Waiver opportunities (the cheat code)
  const streamingOpportunities = pitchers.filter(
    p => p.role.currentRole === 'SP' && p.role.startProbabilityNext7 > 0.5
  ).length;
  if (streamingOpportunities < 2) {
    opportunities.push('Stream starting pitchers for volume');
  }

  // High-edge pitchers available
  const highEdgePitchers = pitchers.filter(p => p.waiverEdge >= 20);
  if (highEdgePitchers.length > 0) {
    opportunities.push(`${highEdgePitchers.length} high-upside pitchers on roster`);
  }

  return { strengths, weaknesses, opportunities };
}

// ============================================================================
// Recommendation Generators
// ============================================================================

function generateAddRecommendationsDomainAware(
  availablePlayers: ScoredPlayer[]
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  // Separate by domain
  const availablePitchers = availablePlayers.filter(
    p => p.domain === 'pitching'
  ) as ScoredPitcher[];
  const availableHitters = availablePlayers.filter(
    p => p.domain === 'hitting'
  ) as ScoredHitter[];

  // Prioritize pitchers with high edge (the cheat code)
  const highEdgePitchers = availablePitchers
    .filter(p => p.waiverEdge >= 15)
    .sort((a, b) => b.waiverEdge - a.waiverEdge);

  for (const pitcher of highEdgePitchers.slice(0, 5)) {
    const edge = pitcher.waiverEdge;
    const isCloser = pitcher.role.isCloser;
    const isStreamer = pitcher.role.currentRole === 'SP' && pitcher.role.startProbabilityNext7 > 0.7;

    recommendations.push({
      rank: 0,
      player: pitcher.player,
      action: 'add',
      expectedValue: pitcher.overallValue + edge,
      confidence: mapConfidence(pitcher.score.confidence),
      reasoning: generatePitcherAddReasoning(pitcher),
      urgency: isCloser ? 'critical' : isStreamer ? 'high' : 'medium',
    });
  }

  // Add top hitters (lower priority)
  const topHitters = availableHitters
    .filter(h => h.overallValue >= 55)
    .sort((a, b) => b.overallValue - a.overallValue);

  for (const hitter of topHitters.slice(0, 3)) {
    recommendations.push({
      rank: 0,
      player: hitter.player,
      action: 'add',
      expectedValue: hitter.overallValue,
      confidence: mapConfidence(hitter.score.confidence),
      reasoning: generateHitterAddReasoning(hitter),
      urgency: 'medium',
    });
  }

  return recommendations;
}

function generateDropRecommendationsDomainAware(
  rosterPlayers: ScoredPlayer[]
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  const droppable = rosterPlayers.filter(p => {
    if (p.domain === 'pitching') {
      const pitcher = p as ScoredPitcher;
      // Drop low-value pitchers without role upside
      return pitcher.overallValue < 40 && pitcher.waiverEdge < 5;
    } else {
      const hitter = p as ScoredHitter;
      return (
        hitter.overallValue < 40 ||
        hitter.score.reliability.sampleSize === 'insufficient' ||
        hitter.score.components.opportunity < 30
      );
    }
  });

  for (const player of droppable.slice(0, 3)) {
    const reasoning = player.domain === 'pitching'
      ? generatePitcherDropReasoning(player as ScoredPitcher)
      : generateHitterDropReasoning(player as ScoredHitter);

    recommendations.push({
      rank: 0,
      player: player.player,
      action: 'drop',
      expectedValue: -player.overallValue,
      confidence: 'moderate',
      reasoning,
      urgency: 'low',
    });
  }

  return recommendations;
}

function generateSwapRecommendationsDomainAware(
  rosterPlayers: ScoredPlayer[],
  availablePlayers: ScoredPlayer[]
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  // Group by domain
  const rosterPitchers = rosterPlayers.filter(p => p.domain === 'pitching') as ScoredPitcher[];
  const rosterHitters = rosterPlayers.filter(p => p.domain === 'hitting') as ScoredHitter[];
  const availPitchers = availablePlayers.filter(p => p.domain === 'pitching') as ScoredPitcher[];
  const availHitters = availablePlayers.filter(p => p.domain === 'hitting') as ScoredHitter[];

  // Pitcher swaps (priority)
  const droppablePitchers = rosterPitchers.filter(p => p.overallValue < 50 && p.waiverEdge < 10);
  const highEdgeAvailable = availPitchers.filter(p => p.waiverEdge >= 15);

  for (const avail of highEdgeAvailable.slice(0, 5)) {
    const bestDrop = droppablePitchers
      .filter(d => d.overallValue < avail.overallValue + avail.waiverEdge - 10)
      .sort((a, b) => a.overallValue - b.overallValue)[0];

    if (bestDrop) {
      const upgradeValue = avail.overallValue + avail.waiverEdge - bestDrop.overallValue;

      recommendations.push({
        rank: 0,
        player: avail.player,
        action: 'swap',
        dropCandidate: bestDrop.player,
        expectedValue: upgradeValue,
        confidence: mapConfidence(avail.score.confidence),
        reasoning: `Upgrade ${bestDrop.overallValue} → ${avail.overallValue} with +${avail.waiverEdge} edge. ${generatePitcherAddReasoning(avail)}`,
        urgency: avail.role.isCloser ? 'critical' : 'high',
      });
    }
  }

  // Hitter swaps (lower priority)
  const droppableHitters = rosterHitters.filter(h => h.overallValue < 45);
  const topAvailHitters = availHitters.filter(h => h.overallValue >= 55);

  for (const avail of topAvailHitters.slice(0, 3)) {
    const bestDrop = droppableHitters
      .filter(d => d.overallValue < avail.overallValue - 10)
      .sort((a, b) => a.overallValue - b.overallValue)[0];

    if (bestDrop) {
      recommendations.push({
        rank: 0,
        player: avail.player,
        action: 'swap',
        dropCandidate: bestDrop.player,
        expectedValue: avail.overallValue - bestDrop.overallValue,
        confidence: mapConfidence(avail.score.confidence),
        reasoning: `Hitter upgrade ${bestDrop.overallValue} → ${avail.overallValue}`,
        urgency: 'medium',
      });
    }
  }

  return recommendations;
}

// ============================================================================
// Reasoning Functions
// ============================================================================

function generatePitcherAddReasoning(pitcher: ScoredPitcher): string {
  const reasons: string[] = [];
  const score = pitcher.score;

  // Role-based reasons
  if (score.role.isCloser) {
    reasons.push('Closer role - save opportunities');
  } else if (score.role.holdsEligible && score.components.stuff >= 65) {
    reasons.push('Setup role with strikeout upside for holds');
  } else if (score.role.startProbabilityNext7 > 0.7) {
    reasons.push(`Streaming SP with ${score.role.startProbabilityNext7 > 0.9 ? 'two' : 'one'} start(s) this week`);
  }

  // Skill-based reasons
  if (score.components.stuff >= 70) reasons.push('Dominant stuff');
  if (score.components.command >= 70) reasons.push('Elite control');
  if (score.components.workload >= 70) reasons.push('Workhorse workload');

  // Opportunity reasons
  if (pitcher.waiverEdge >= 20) {
    reasons.push(`High waiver edge (+${pitcher.waiverEdge}) - cheat code candidate`);
  }

  if (score.components.stuff >= 70 && score.components.results <= 45) {
    reasons.push('Buy low: dominant skills, poor results');
  }

  if (reasons.length === 0) {
    reasons.push(`Solid pitcher value (${score.overallValue})`);
  }

  return reasons.join(', ');
}

function generateHitterAddReasoning(hitter: ScoredHitter): string {
  const score = hitter.score;
  const reasons: string[] = [];

  if (score.components.power >= 70) reasons.push('Power threat');
  if (score.components.speed >= 70) reasons.push('Speed asset');
  if (score.components.hitting >= 70) reasons.push('Strong hitter');
  if (score.components.opportunity >= 75) reasons.push('Full-time role');
  if (score.components.consistency >= 65) reasons.push('Reliable');

  if (reasons.length === 0) {
    reasons.push(`Solid hitter value (${score.overallValue})`);
  }

  return reasons.join(', ');
}

function generatePitcherDropReasoning(pitcher: ScoredPitcher): string {
  if (pitcher.role.currentRole === 'RP' && !pitcher.role.isCloser && pitcher.overallValue < 40) {
    return 'Middle reliever without holds value or role upside';
  }
  if (pitcher.score.components.consistency < 35) {
    return 'High blow-up risk - not worth roster spot';
  }
  return `Low value pitcher (${pitcher.overallValue}) without clear role`;
}

function generateHitterDropReasoning(hitter: ScoredHitter): string {
  if (hitter.score.components.opportunity < 30) {
    return 'Limited playing time - not fantasy relevant';
  }
  if (hitter.score.reliability.sampleSize === 'insufficient') {
    return 'Insufficient data to justify roster spot';
  }
  return `Low value hitter (${hitter.overallValue})`;
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapConfidence(confidence: number): ConfidenceLevel {
  if (confidence >= 0.9) return 'very_high';
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.6) return 'moderate';
  if (confidence >= 0.4) return 'low';
  return 'very_low';
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

/**
 * Legacy waiver assembly for backward compatibility.
 * Only works with hitters.
 * @deprecated Use assembleWaiverDecisionsDomainAware for full waiver assembly
 */
export function assembleWaiverDecisions(input: {
  request: WaiverRecommendationRequest;
  playerScores: Map<string, PlayerScore>;
}): WaiverAssemblyResult {
  return assembleWaiverDecisionsDomainAware({
    request: input.request,
    hitterScores: input.playerScores,
    pitcherScores: new Map(),
  });
}
