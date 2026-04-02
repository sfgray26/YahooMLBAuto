/**
 * Waiver Decision Assembly - TEAM STATE AWARE
 *
 * Decision = f(TeamState, PlayerScores, MonteCarloData)
 *
 * This assembly:
 * 1. Compares roster vs replacement pool (from TeamState roster)
 * 2. Factors bench flexibility (from TeamState lineup)
 * 3. Factors position coverage (from TeamState roster composition)
 * 4. Prioritizes pitcher edge detection (domain-aware)
 * 5. Respects waiver budget (from TeamState waiverState)
 *
 * What does NOT change:
 * - Scoring logic
 * - Monte Carlo logic
 * - Waiver edge calculation
 */

import type { 
  UUID, 
  ISO8601Timestamp,
  TeamState,
  WaiverRecommendationResult,
  WaiverRecommendation,
  RosterAnalysis,
  PlayerIdentity,
  ConfidenceLevel,
} from '@cbb/core';
import type { PlayerScore } from '../scoring/index.js';
import type { PitcherScore } from '../pitchers/index.js';
import { 
  isPlayerOnRoster,
  getRosterPlayer,
  getRosterPlayerByMlbamId,
} from '@cbb/core';

// ============================================================================
// Types
// ============================================================================

export interface TeamStateWaiverInput {
  teamState: TeamState;
  hitterScores: Map<string, PlayerScore>;
  pitcherScores: Map<string, PitcherScore>;
  availablePlayers: AvailablePlayer[];  // FA/Waiver pool - NOT from TeamState
}

export interface AvailablePlayer {
  playerId: UUID;
  mlbamId: string;
  name: string;
  team: string;
  positions: string[];
  percentOwned: number;  // For waiver priority assessment
  percentStarted: number;
}

export interface WaiverAssemblyResult {
  success: boolean;
  result?: WaiverRecommendationResult;
  errors: string[];
  traceId: string;
}

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
  waiverEdge: number;
}

type ScoredPlayer = ScoredHitter | ScoredPitcher;

// ============================================================================
// Domain Classification
// ============================================================================

function isPitcher(positions: string[]): boolean {
  return positions.some(p => 
    ['SP', 'RP', 'P', 'CL'].includes(p.toUpperCase())
  );
}

function calculatePitcherWaiverEdge(pitcher: ScoredPitcher): number {
  const score = pitcher.score;
  let edge = 0;

  // Role change opportunity
  if (score.role.isCloser) {
    edge += score.components.stuff >= 60 ? 25 : 15;
  } else if (score.role.holdsEligible && score.components.stuff >= 65) {
    edge += 15;
  } else if (score.role.currentRole === 'SP' && score.role.startProbabilityNext7 > 0.8) {
    edge += 20;
  }

  // Skills > results discrepancy
  if (score.components.stuff >= 70 && score.components.results <= 45) {
    edge += 15;
  }

  // Workload upside
  if (score.components.workload >= 70 && score.role.expectedInningsPerWeek >= 12) {
    edge += 10;
  }

  // Consistency
  if (score.components.consistency >= 60) {
    edge += 5;
  } else if (score.components.consistency <= 35) {
    edge -= 10;
  }

  // Matchup
  if (score.components.matchup >= 65) {
    edge += 5;
  }

  // Confidence adjustment
  if (score.reliability.sampleSize === 'small') {
    edge -= 5;
  }

  return edge;
}

// ============================================================================
// Main Assembly Function
// ============================================================================

export function assembleWaiverDecisionsFromTeamState(
  input: TeamStateWaiverInput
): WaiverAssemblyResult {
  const { teamState, hitterScores, pitcherScores, availablePlayers } = input;
  const errors: string[] = [];
  const traceId = crypto.randomUUID();

  try {
    // Build roster players with scores
    const rosterHitters: ScoredHitter[] = [];
    const rosterPitchers: ScoredPitcher[] = [];

    for (const rosterPlayer of teamState.roster.players) {
      if (rosterPlayer.isInjured && rosterPlayer.injuryStatus !== 'day_to_day') {
        continue;  // Skip injured players
      }

      if (isPitcher(rosterPlayer.positions)) {
        const score = pitcherScores.get(rosterPlayer.mlbamId);
        if (score) {
          const pitcher: ScoredPitcher = {
            player: {
              id: rosterPlayer.playerId,
              mlbamId: rosterPlayer.mlbamId,
              name: rosterPlayer.name,
              team: rosterPlayer.team,
              position: rosterPlayer.positions,
            },
            score,
            overallValue: score.overallValue,
            role: score.role,
            domain: 'pitching',
            waiverEdge: 0,
          };
          pitcher.waiverEdge = calculatePitcherWaiverEdge(pitcher);
          rosterPitchers.push(pitcher);
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
            domain: 'hitting',
          });
        }
      }
    }

    // Build available players with scores
    const availableHitters: ScoredHitter[] = [];
    const availablePitchers: ScoredPitcher[] = [];

    for (const avail of availablePlayers) {
      if (isPitcher(avail.positions)) {
        const score = pitcherScores.get(avail.mlbamId);
        if (score) {
          const pitcher: ScoredPitcher = {
            player: {
              id: avail.playerId,
              mlbamId: avail.mlbamId,
              name: avail.name,
              team: avail.team,
              position: avail.positions,
            },
            score,
            overallValue: score.overallValue,
            role: score.role,
            domain: 'pitching',
            waiverEdge: 0,
          };
          pitcher.waiverEdge = calculatePitcherWaiverEdge(pitcher);
          availablePitchers.push(pitcher);
        }
      } else {
        const score = hitterScores.get(avail.mlbamId);
        if (score) {
          availableHitters.push({
            player: {
              id: avail.playerId,
              mlbamId: avail.mlbamId,
              name: avail.name,
              team: avail.team,
              position: avail.positions,
            },
            score,
            overallValue: score.overallValue,
            domain: 'hitting',
          });
        }
      }
    }

    if (availableHitters.length === 0 && availablePitchers.length === 0) {
      return {
        success: false,
        errors: ['No available players with computed scores'],
        traceId,
      };
    }

    // Build roster analysis with TeamState context
    const rosterAnalysis = analyzeRosterWithTeamState(
      rosterHitters,
      rosterPitchers,
      teamState
    );

    // Generate recommendations
    const recommendations: WaiverRecommendation[] = [];

    // Pitcher recommendations (priority - the cheat code)
    recommendations.push(...generatePitcherRecommendations(
      rosterPitchers,
      availablePitchers,
      teamState
    ));

    // Hitter recommendations
    recommendations.push(...generateHitterRecommendations(
      rosterHitters,
      availableHitters,
      teamState
    ));

    // Sort by effective value (pitcher edge bonus)
    const rankedRecommendations = recommendations
      .sort((a, b) => b.expectedValue - a.expectedValue)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const result: WaiverRecommendationResult = {
      requestId: traceId,
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
// Roster Analysis with TeamState Context
// ============================================================================

function analyzeRosterWithTeamState(
  rosterHitters: ScoredHitter[],
  rosterPitchers: ScoredPitcher[],
  teamState: TeamState
): RosterAnalysis {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];

  // Hitter analysis
  const hitterAvg = rosterHitters.length > 0 
    ? rosterHitters.reduce((sum, h) => sum + h.overallValue, 0) / rosterHitters.length 
    : 0;
  
  if (hitterAvg >= 60) strengths.push('Strong hitting core');
  else if (hitterAvg < 50 && rosterHitters.length > 0) weaknesses.push('Weak hitting foundation');

  // Pitcher analysis with role breakdown
  const spCount = rosterPitchers.filter(p => p.role.currentRole === 'SP').length;
  const closerCount = rosterPitchers.filter(p => p.role.isCloser).length;
  const holdsCount = rosterPitchers.filter(p => p.role.holdsEligible).length;
  const highEdgePitchers = rosterPitchers.filter(p => p.waiverEdge >= 20);

  if (spCount >= 5) strengths.push('Deep starting rotation');
  else if (spCount < 3) weaknesses.push('Shallow rotation - stream opportunities');

  if (closerCount >= 2) strengths.push('Strong closer situation');
  else if (closerCount === 0) {
    weaknesses.push('No closer - priority add');
    opportunities.push('Monitor bullpens for role changes');
  }

  if (holdsCount >= 2) strengths.push('Holds coverage');

  // Bench analysis from TeamState
  const benchSize = teamState.lineupConfig.benchSlots;
  const assignedToBench = teamState.currentLineup.benchAssignments.length;
  const benchFlexibility = assignedToBench > 0 
    ? assignedToBench / benchSize 
    : 0;

  if (benchFlexibility >= 0.8) {
    opportunities.push('Full bench - consider streaming upgrades');
  } else if (benchFlexibility <= 0.3) {
    weaknesses.push('Empty bench - limited flexibility');
  }

  // High-edge pitchers on roster
  if (highEdgePitchers.length > 0) {
    opportunities.push(`${highEdgePitchers.length} high-upside pitchers on roster`);
  }

  // Waiver budget context
  const budgetRemaining = teamState.waiverState.budgetRemaining;
  const budgetTotal = teamState.waiverState.budgetTotal;
  if (budgetRemaining < budgetTotal * 0.2) {
    weaknesses.push(`Low FAAB (${budgetRemaining}/${budgetTotal}) - spend wisely`);
  } else if (budgetRemaining > budgetTotal * 0.5) {
    opportunities.push(`Healthy FAAB budget (${budgetRemaining}) for bids`);
  }

  return { strengths, weaknesses, opportunities };
}

// ============================================================================
// Recommendation Generators
// ============================================================================

function generatePitcherRecommendations(
  rosterPitchers: ScoredPitcher[],
  availablePitchers: ScoredPitcher[],
  teamState: TeamState
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  // Sort available by edge
  const highEdgeAvailable = availablePitchers
    .filter(p => p.waiverEdge >= 15)
    .sort((a, b) => b.waiverEdge - a.waiverEdge);

  // Find droppable roster pitchers
  const droppablePitchers = rosterPitchers.filter(p => 
    p.overallValue < 50 && p.waiverEdge < 10
  );

  // Generate swap recommendations
  for (const avail of highEdgeAvailable.slice(0, 5)) {
    const bestDrop = droppablePitchers
      .filter(d => {
        const upgradeValue = avail.overallValue + avail.waiverEdge - d.overallValue;
        return upgradeValue > 10;  // Minimum 10-point upgrade
      })
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
        reasoning: generatePitcherReasoning(avail, bestDrop, teamState),
        urgency: determineUrgency(avail, teamState),
      });
    } else if (teamState.currentLineup.benchAssignments.length < teamState.lineupConfig.benchSlots) {
      // Add recommendation if bench space available
      recommendations.push({
        rank: 0,
        player: avail.player,
        action: 'add',
        expectedValue: avail.overallValue + avail.waiverEdge,
        confidence: mapConfidence(avail.score.confidence),
        reasoning: generatePitcherAddReasoning(avail, teamState),
        urgency: avail.role.isCloser ? 'critical' : 'high',
      });
    }
  }

  return recommendations;
}

function generateHitterRecommendations(
  rosterHitters: ScoredHitter[],
  availableHitters: ScoredHitter[],
  teamState: TeamState
): WaiverRecommendation[] {
  const recommendations: WaiverRecommendation[] = [];

  // Find position needs from roster
  const positionCounts = new Map<string, number>();
  for (const h of rosterHitters) {
    for (const pos of h.player.position) {
      positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
    }
  }

  // Identify thin positions
  const thinPositions: string[] = [];
  for (const slot of teamState.lineupConfig.slots) {
    if (slot.domain === 'hitting') {
      const eligibleCount = slot.eligiblePositions.reduce((sum, pos) => 
        sum + (positionCounts.get(pos) || 0), 0
      );
      if (eligibleCount < 2) {
        thinPositions.push(...slot.eligiblePositions);
      }
    }
  }

  // Top available hitters
  const topHitters = availableHitters
    .filter(h => h.overallValue >= 55)
    .sort((a, b) => b.overallValue - a.overallValue)
    .slice(0, 5);

  // Find droppable hitters
  const droppableHitters = rosterHitters.filter(h => h.overallValue < 45);

  for (const avail of topHitters) {
    // Check if fills a need
    const fillsNeed = avail.player.position.some(p => thinPositions.includes(p));
    
    const bestDrop = droppableHitters
      .filter(d => avail.overallValue - d.overallValue > 10)
      .sort((a, b) => a.overallValue - b.overallValue)[0];

    if (bestDrop) {
      recommendations.push({
        rank: 0,
        player: avail.player,
        action: 'swap',
        dropCandidate: bestDrop.player,
        expectedValue: avail.overallValue - bestDrop.overallValue,
        confidence: mapConfidence(avail.score.confidence),
        reasoning: generateHitterReasoning(avail, bestDrop, fillsNeed, thinPositions),
        urgency: fillsNeed ? 'high' : 'medium',
      });
    } else if (teamState.currentLineup.benchAssignments.length < teamState.lineupConfig.benchSlots) {
      recommendations.push({
        rank: 0,
        player: avail.player,
        action: 'add',
        expectedValue: avail.overallValue,
        confidence: mapConfidence(avail.score.confidence),
        reasoning: generateHitterAddReasoning(avail, fillsNeed),
        urgency: fillsNeed ? 'high' : 'medium',
      });
    }
  }

  return recommendations;
}

// ============================================================================
// Reasoning Functions (Team-Aware)
// ============================================================================

function generatePitcherReasoning(
  avail: ScoredPitcher,
  drop: ScoredPitcher,
  teamState: TeamState
): string {
  const reasons: string[] = [];
  
  const upgradeValue = avail.overallValue + avail.waiverEdge - drop.overallValue;
  reasons.push(`${drop.overallValue} → ${avail.overallValue} (+${avail.waiverEdge} edge = ${upgradeValue} net)`);

  if (avail.role.isCloser) {
    reasons.push('Closer role - save opportunities');
  } else if (avail.role.holdsEligible && avail.score.components.stuff >= 65) {
    reasons.push('Setup role with strikeout upside');
  } else if (avail.role.startProbabilityNext7 > 0.7) {
    reasons.push(`Streaming SP with ${avail.role.startProbabilityNext7 > 0.9 ? 'two' : 'one'} start(s)`);
  }

  if (avail.score.components.stuff >= 70) reasons.push('Dominant stuff');
  if (avail.waiverEdge >= 20) reasons.push(`High waiver edge (+${avail.waiverEdge})`);
  
  // Team context
  if (drop.overallValue < 40) {
    reasons.push(`Frees up roster spot from ${drop.player.name} (${drop.overallValue})`);
  }

  return reasons.join('. ');
}

function generatePitcherAddReasoning(
  avail: ScoredPitcher,
  teamState: TeamState
): string {
  const reasons: string[] = [];

  if (avail.role.isCloser) reasons.push('Closer role - immediate impact');
  if (avail.role.startProbabilityNext7 > 0.7) reasons.push('Two-start week');
  if (avail.score.components.stuff >= 70) reasons.push('Dominant stuff');
  if (avail.waiverEdge >= 20) reasons.push(`High waiver edge (+${avail.waiverEdge})`);

  // Bench context
  const benchSpace = teamState.lineupConfig.benchSlots - teamState.currentLineup.benchAssignments.length;
  if (benchSpace > 0) {
    reasons.push(`${benchSpace} bench spot(s) available`);
  }

  return reasons.join('. ');
}

function generateHitterReasoning(
  avail: ScoredHitter,
  drop: ScoredHitter,
  fillsNeed: boolean,
  thinPositions: string[]
): string {
  const reasons: string[] = [];
  reasons.push(`${drop.overallValue} → ${avail.overallValue} (${avail.overallValue - drop.overallValue} point upgrade)`);

  if (fillsNeed && thinPositions.length > 0) {
    reasons.push(`Fills need at ${thinPositions.slice(0, 3).join('/')}`);
  }

  if (avail.score.components.power >= 70) reasons.push('Power threat');
  if (avail.score.components.speed >= 70) reasons.push('Speed asset');
  if (avail.score.components.opportunity >= 75) reasons.push('Full-time role');

  return reasons.join('. ');
}

function generateHitterAddReasoning(
  avail: ScoredHitter,
  fillsNeed: boolean
): string {
  const reasons: string[] = [];

  if (fillsNeed) reasons.push('Fills position need');
  if (avail.score.components.power >= 70) reasons.push('Power threat');
  if (avail.score.components.speed >= 70) reasons.push('Speed asset');
  if (avail.score.components.consistency >= 65) reasons.push('Reliable production');

  return reasons.join('. ');
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

function determineUrgency(
  pitcher: ScoredPitcher,
  teamState: TeamState
): 'low' | 'medium' | 'high' | 'critical' {
  // Critical: New closer, FAAB running low, or roster gap
  if (pitcher.role.isCloser) return 'critical';
  
  const budgetRemaining = teamState.waiverState.budgetRemaining;
  const budgetTotal = teamState.waiverState.budgetTotal;
  if (budgetRemaining < budgetTotal * 0.1 && pitcher.waiverEdge >= 20) {
    return 'high';  // Spend remaining budget on high-edge plays
  }

  // High: Two-start SP or high-edge streaming option
  if (pitcher.role.startProbabilityNext7 > 0.9 || pitcher.waiverEdge >= 25) {
    return 'high';
  }

  // Medium: Solid streaming option
  if (pitcher.waiverEdge >= 15) return 'medium';

  return 'low';
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

export { assembleWaiverDecisionsFromTeamState as assembleWaiverDecisionsDomainAware };
