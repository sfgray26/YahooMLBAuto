/**
 * Trade Evaluator
 *
 * Evaluates trade proposals by comparing world-with-trade vs world-without-trade.
 *
 * Core principle: Simulate both scenarios using the existing intelligence stack,
 * then compare outcomes across categories, risk, and roster construction.
 */

import type {
  TradeProposal,
  TradeEvaluation,
  TradePlayer,
  TradeRecommendation,
  CategoryImpact,
  RiskImpact,
  RosterImpact,
  WorldProjection,
  WorldDelta,
  TradeExplanation,
  TradeDecisionStep,
  TradeEvaluatorConfig,
  PositionalBalance,
  TradeSideAnalysis,
  TeamState,
} from './types.js';

import type { ProbabilisticOutcome } from '../probabilistic/index.js';
import type { PlayerScore, PlayerScore as HitterScore } from '../scoring/compute.js';
import type { PitcherScore } from '../pitchers/compute.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: TradeEvaluatorConfig = {
  format: 'roto',
  weights: {
    categoryPoints: 0.50,
    winProbability: 0.00,  // Not used in roto
    riskProfile: 0.25,
    rosterFlexibility: 0.15,
    schedule: 0.10,
  },
  riskTolerance: 'balanced',
  simulationRuns: 200,  // Lighter than full 1000 for trade speed
  thresholds: {
    strongAccept: 5.0,
    leanAccept: 2.0,
    leanReject: -2.0,
    hardReject: -5.0,
  },
  leagueSize: 12,
  playoffTeams: 6,
  currentWeek: 12,
  weeksRemaining: 14,
};

// ============================================================================
// Main Evaluator Function
// ============================================================================

/**
 * Evaluate a trade proposal
 *
 * Compares world-with-trade vs world-without-trade using ROS projections.
 */
export function evaluateTrade(
  teamState: TeamState,
  trade: TradeProposal,
  config: Partial<TradeEvaluatorConfig> = {}
): TradeSideAnalysis {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const trace: TradeDecisionStep[] = [];
  let step = 0;
  
  // Step 1: Enrich players with intelligence
  const enrichedTrade = enrichTradeWithIntelligence(trade, teamState);
  trace.push({
    step: ++step,
    action: 'recalculate_projection',
    description: 'Loaded player intelligence (scores, momentum, Monte Carlo)',
    impact: 0,
  });
  
  // Step 2: Project World A (keep current roster)
  const worldBefore = projectWorld(teamState, enrichedTrade.playersYouGive, cfg);
  trace.push({
    step: ++step,
    action: 'recalculate_projection',
    description: `Projected current roster: ${worldBefore.projectedCategoryPoints.toFixed(1)} cat pts`,
    impact: 0,
  });
  
  // Step 3: Apply trade and project World B
  const teamStateAfter = applyTradeToTeamState(teamState, enrichedTrade);
  const worldAfter = projectWorld(teamStateAfter, enrichedTrade.playersYouGet, cfg);
  trace.push({
    step: ++step,
    action: 'recalculate_projection',
    description: `Projected post-trade roster: ${worldAfter.projectedCategoryPoints.toFixed(1)} cat pts`,
    impact: worldAfter.projectedCategoryPoints - worldBefore.projectedCategoryPoints,
  });
  
  // Step 4: Calculate deltas
  const delta = calculateWorldDelta(worldBefore, worldAfter);
  
  // Step 5: Analyze impacts
  const categoryImpact = analyzeCategoryImpact(worldBefore, worldAfter, delta, cfg);
  const riskImpact = analyzeRiskImpact(worldBefore, worldAfter, cfg);
  const rosterImpact = analyzeRosterImpact(teamState, teamStateAfter, enrichedTrade, cfg);
  
  // Step 6: Calculate summary score
  const summaryScore = calculateSummaryScore(
    categoryImpact,
    riskImpact,
    rosterImpact,
    cfg
  );
  
  // Step 7: Generate recommendation
  const recommendation = generateRecommendation(summaryScore, cfg);
  
  // Step 8: Build explanation
  const explanation = buildTradeExplanation(
    recommendation,
    summaryScore,
    categoryImpact,
    riskImpact,
    rosterImpact,
    enrichedTrade
  );
  
  // Assemble evaluation
  const evaluation: TradeEvaluation = {
    recommendation,
    summaryScore,
    confidence: calculateConfidence(worldBefore, worldAfter),
    categoryImpact,
    riskImpact,
    rosterImpact: rosterImpact as any, // Cast for now
    scheduleImpact: analyzeScheduleImpact(enrichedTrade, cfg),
    worldBefore,
    worldAfter,
    delta,
    explanation,
    decisionTrace: trace,
  };
  
  return {
    forYourTeam: evaluation,
    fairness: assessFairness(evaluation),
    likelihoodOfAcceptance: assessAcceptance(evaluation),
    yourLeverage: identifyYourLeverage(evaluation, enrichedTrade),
    theirLeverage: identifyTheirLeverage(evaluation, enrichedTrade),
  };
}

// ============================================================================
// Trade Application
// ============================================================================

/**
 * Apply trade to team state (pure function - returns new state)
 */
function applyTradeToTeamState(
  teamState: TeamState,
  trade: TradeProposal
): TeamState {
  // Deep clone to avoid mutation
  const newState: TeamState = JSON.parse(JSON.stringify(teamState));
  
  // Filter out outgoing players
  const remainingPlayers = newState.roster.players.filter(
    p => !trade.playersYouGive.some(g => g.playerId === p.playerId)
  );
  
  // Add incoming players
  for (const incoming of trade.playersYouGet) {
    remainingPlayers.push({
      playerId: incoming.playerId,
      mlbamId: incoming.playerMlbamId,
      name: incoming.name,
      team: incoming.team,
      positions: incoming.positions,
      acquisitionDate: new Date().toISOString(),
      acquisitionType: 'trade',
      isInjured: incoming.isInjured,
      injuryStatus: incoming.injuryStatus as any || undefined,
    });
  }
  
  // Create new roster state with updated players
  return {
    ...newState,
    roster: {
      ...newState.roster,
      version: newState.roster.version + 1,
      lastUpdated: new Date().toISOString(),
      players: remainingPlayers,
    },
  };
}

// ============================================================================
// World Projection
// ============================================================================

/**
 * Project ROS outcomes for a team state
 */
function projectWorld(
  teamState: TeamState,
  playersToAnalyze: TradePlayer[],
  config: TradeEvaluatorConfig
): WorldProjection {
  // Aggregate category projections
  const categoryTotals: Record<string, number> = {
    runs: 0,
    homeRuns: 0,
    rbi: 0,
    stolenBases: 0,
    battingAverage: 0,
    ops: 0,
    wins: 0,
    saves: 0,
    strikeouts: 0,
    era: 0,
    whip: 0,
  };
  
  let totalHitters = 0;
  let totalPitchers = 0;
  let totalScore = 0;
  
  // Collect all probabilistic outcomes for risk calculation
  const allOutcomes: ProbabilisticOutcome[] = [];
  
  for (const player of playersToAnalyze) {
    if (!player.probabilistic) continue;
    
    allOutcomes.push(player.probabilistic);
    
    // Add to category totals (simplified - would use actual projections)
    const ros = player.probabilistic.rosScore.p50;
    
    if (player.positions.some(p => ['SP', 'RP', 'CL', 'P'].includes(p))) {
      totalPitchers++;
    } else {
      totalHitters++;
      // Approximate category contributions
      categoryTotals.runs += (ros / 100) * 15;  // ~15 runs per player
      categoryTotals.homeRuns += (ros / 100) * 4;
      categoryTotals.rbi += (ros / 100) * 15;
      categoryTotals.stolenBases += (ros / 100) * 2;
    }
    
    totalScore += ros;
  }
  
  // Calculate risk profile
  const volatility = calculateAggregateVolatility(allOutcomes);
  const floor = allOutcomes.reduce((sum, o) => sum + o.rosScore.p10, 0) / Math.max(1, allOutcomes.length);
  const median = allOutcomes.reduce((sum, o) => sum + o.rosScore.p50, 0) / Math.max(1, allOutcomes.length);
  const ceiling = allOutcomes.reduce((sum, o) => sum + o.rosScore.p90, 0) / Math.max(1, allOutcomes.length);
  
  // Project standing (simplified)
  const projectedCategoryPoints = estimateCategoryPoints(categoryTotals, config);
  
  return {
    projectedCategoryTotals: categoryTotals,
    projectedStanding: estimateStanding(projectedCategoryPoints, config),
    projectedCategoryPoints,
    volatility,
    floorOutcome: floor,
    medianOutcome: median,
    ceilingOutcome: ceiling,
    rosterComposition: {
      hitters: totalHitters,
      pitchers: totalPitchers,
      byPosition: {},
      averageStarterScore: totalScore / Math.max(1, playersToAnalyze.length),
      averageBenchScore: 0,
    },
    projectionConfidence: calculateProjectionConfidence(allOutcomes),
  };
}

function calculateAggregateVolatility(
  outcomes: ProbabilisticOutcome[]
): 'low' | 'medium' | 'high' | 'extreme' {
  if (outcomes.length === 0) return 'medium';
  
  const avgVolatility = outcomes.reduce(
    (sum, o) => sum + (o.riskProfile.volatility === 'high' ? 3 : 
                      o.riskProfile.volatility === 'medium' ? 2 : 1),
    0
  ) / outcomes.length;
  
  if (avgVolatility > 2.5) return 'extreme';
  if (avgVolatility > 2) return 'high';
  if (avgVolatility > 1.5) return 'medium';
  return 'low';
}

// ============================================================================
// Impact Analysis
// ============================================================================

function analyzeCategoryImpact(
  before: WorldProjection,
  after: WorldProjection,
  delta: WorldDelta,
  config: TradeEvaluatorConfig
): CategoryImpact {
  const statChanges: Record<string, number> = {};
  const improvements: string[] = [];
  const declines: string[] = [];
  
  for (const [cat, afterVal] of Object.entries(after.projectedCategoryTotals)) {
    const beforeVal = before.projectedCategoryTotals[cat] || 0;
    const change = afterVal - beforeVal;
    statChanges[cat] = change;
    
    if (change > 5) improvements.push(`${cat}: +${change.toFixed(1)}`);
    if (change < -5) declines.push(`${cat}: ${change.toFixed(1)}`);
  }
  
  return {
    format: config.format,
    statChanges,
    categoryPointChanges: {},
    totalCategoryPointChange: delta.categoryPointsChange,
    matchupWinProbChange: undefined,
    playoffWinProbChange: undefined,
    topImprovements: improvements.slice(0, 3),
    topDeclines: declines.slice(0, 3),
  };
}

function analyzeRiskImpact(
  before: WorldProjection,
  after: WorldProjection,
  config: TradeEvaluatorConfig
): RiskImpact {
  const floorChange = after.floorOutcome - before.floorOutcome;
  const medianChange = after.medianOutcome - before.medianOutcome;
  const ceilingChange = after.ceilingOutcome - before.ceilingOutcome;
  
  let volatilityChange: 'safer' | 'similar' | 'riskier';
  const volOrder: Record<string, number> = { low: 1, medium: 2, high: 3, extreme: 4 };
  const beforeVol = volOrder[before.volatility];
  const afterVol = volOrder[after.volatility];
  
  if (afterVol < beforeVol) volatilityChange = 'safer';
  else if (afterVol > beforeVol) volatilityChange = 'riskier';
  else volatilityChange = 'similar';
  
  // Risk-adjusted value based on tolerance
  let riskAdjustment = 0;
  if (config.riskTolerance === 'conservative') {
    riskAdjustment = floorChange * 0.5;  // Care about floor
  } else if (config.riskTolerance === 'aggressive') {
    riskAdjustment = ceilingChange * 0.3;  // Care about ceiling
  } else {
    riskAdjustment = medianChange * 0.2;  // Balanced
  }
  
  return {
    volatilityBefore: before.volatility,
    volatilityAfter: after.volatility,
    volatilityChange,
    floorChange,
    ceilingChange,
    medianChange,
    downsideRiskBefore: 0,
    downsideRiskAfter: 0,
    upsidePotentialBefore: 0,
    upsidePotentialAfter: 0,
    riskAdjustedValue: riskAdjustment,
  };
}

function analyzeRosterImpact(
  before: TeamState,
  after: TeamState,
  trade: TradeProposal,
  config: TradeEvaluatorConfig
): RosterImpact {
  const balanceBefore = calculatePositionalBalance(before, trade.playersYouGive);
  const balanceAfter = calculatePositionalBalance(after, trade.playersYouGet);
  
  const holesFilled: string[] = [];
  const holesCreated: string[] = [];
  
  // Identify positional changes
  for (const weak of balanceBefore.weaknesses) {
    if (!balanceAfter.weaknesses.includes(weak)) {
      holesFilled.push(weak);
    }
  }
  
  for (const weak of balanceAfter.weaknesses) {
    if (!balanceBefore.weaknesses.includes(weak)) {
      holesCreated.push(weak);
    }
  }
  
  return {
    positionalBalanceBefore: balanceBefore,
    positionalBalanceAfter: balanceAfter,
    holesFilled,
    holesCreated,
    startingQualityChange: 0,
    benchDepthChange: 0,
    flexibilityBefore: balanceBefore.score,
    flexibilityAfter: balanceAfter.score,
    replacementLevelNeedsBefore: 0,
    replacementLevelNeedsAfter: 0,
  };
}

function calculatePositionalBalance(
  teamState: TeamState,
  players: TradePlayer[]
): PositionalBalance {
  const positionCounts: Record<string, number> = {};
  const positionStrengths: Record<string, number> = {};
  
  for (const player of players) {
    if (!player.score) continue;
    
    for (const pos of player.positions) {
      positionCounts[pos] = (positionCounts[pos] || 0) + 1;
      positionStrengths[pos] = (positionStrengths[pos] || 0) + player.score.overallValue;
    }
  }
  
  // Calculate balance score
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const coverage: Record<string, 'excellent' | 'good' | 'adequate' | 'poor'> = {};
  
  for (const [pos, count] of Object.entries(positionCounts)) {
    const avgStrength = positionStrengths[pos] / count;
    
    if (avgStrength > 70) {
      strengths.push(pos);
      coverage[pos] = 'excellent';
    } else if (avgStrength > 60) {
      coverage[pos] = 'good';
    } else if (avgStrength > 50) {
      coverage[pos] = 'adequate';
    } else {
      weaknesses.push(pos);
      coverage[pos] = 'poor';
    }
  }
  
  // Score based on strengths vs weaknesses
  const score = Math.min(100, Math.max(0, 50 + strengths.length * 10 - weaknesses.length * 15));
  
  return {
    score,
    strengths,
    weaknesses,
    coverage,
  };
}

function analyzeScheduleImpact(trade: TradeProposal, config: TradeEvaluatorConfig): any {
  // Simplified - would analyze actual schedules
  return {
    gamesThisWeekChange: 0,
    twoStartSPsBefore: 0,
    twoStartSPsAfter: 0,
    favorableMatchupsGained: 0,
    favorableMatchupsLost: 0,
  };
}

// ============================================================================
// Calculation Helpers
// ============================================================================

function calculateWorldDelta(before: WorldProjection, after: WorldProjection): WorldDelta {
  const categoryTotals: Record<string, number> = {};
  
  for (const cat of Object.keys(after.projectedCategoryTotals)) {
    const afterVal = after.projectedCategoryTotals[cat];
    const beforeVal = before.projectedCategoryTotals[cat] || 0;
    categoryTotals[cat] = afterVal - beforeVal;
  }
  
  return {
    categoryTotals,
    standingChange: after.projectedStanding - before.projectedStanding,
    categoryPointsChange: after.projectedCategoryPoints - before.projectedCategoryPoints,
    volatilityChange: after.volatility === before.volatility ? 'similar' : 
                      (volOrder(after.volatility) > volOrder(before.volatility) ? 'riskier' : 'safer'),
    floorChange: after.floorOutcome - before.floorOutcome,
    medianChange: after.medianOutcome - before.medianOutcome,
    ceilingChange: after.ceilingOutcome - before.ceilingOutcome,
  };
}

function volOrder(vol: string): number {
  const orders: Record<string, number> = { low: 1, medium: 2, high: 3, extreme: 4 };
  return orders[vol] || 2;
}

function calculateSummaryScore(
  category: CategoryImpact,
  risk: RiskImpact,
  roster: RosterImpact,
  config: TradeEvaluatorConfig
): number {
  let score = 0;
  
  // Category points (primary)
  score += (category.totalCategoryPointChange || 0) * config.weights.categoryPoints;
  
  // Risk adjustment
  score += risk.riskAdjustedValue * config.weights.riskProfile;
  
  // Roster flexibility
  const flexibilityChange = roster.flexibilityAfter - roster.flexibilityBefore;
  score += flexibilityChange * config.weights.rosterFlexibility;
  
  return score;
}

function generateRecommendation(score: number, config: TradeEvaluatorConfig): TradeRecommendation {
  const { thresholds } = config;
  
  if (score >= thresholds.strongAccept) return 'strong_accept';
  if (score >= thresholds.leanAccept) return 'lean_accept';
  if (score <= thresholds.hardReject) return 'hard_reject';
  if (score <= thresholds.leanReject) return 'lean_reject';
  return 'neutral';
}

// ============================================================================
// Explanation Builder
// ============================================================================

function buildTradeExplanation(
  rec: TradeRecommendation,
  score: number,
  category: CategoryImpact,
  risk: RiskImpact,
  roster: RosterImpact,
  trade: TradeProposal
): TradeExplanation {
  const headlines: Record<TradeRecommendation, string> = {
    strong_accept: '✓ Strong Accept: Clear win for your team',
    lean_accept: '✓ Lean Accept: Probable win with favorable terms',
    neutral: '→ Neutral: Fair trade, no clear advantage',
    lean_reject: '✗ Lean Reject: Likely unfavorable',
    hard_reject: '✗ Hard Reject: Clear loss, avoid this trade',
  };
  
  const keyPoints: string[] = [];
  
  if (category.totalCategoryPointChange && category.totalCategoryPointChange > 0) {
    keyPoints.push(`Improves projected standing by +${category.totalCategoryPointChange.toFixed(1)} category points`);
  }
  
  if (roster.holesFilled.length > 0) {
    keyPoints.push(`Fills positional holes at: ${roster.holesFilled.join(', ')}`);
  }
  
  if (risk.volatilityChange === 'safer') {
    keyPoints.push('Reduces roster volatility (safer profile)');
  } else if (risk.volatilityChange === 'riskier' && risk.ceilingChange > risk.floorChange) {
    keyPoints.push('Increases upside potential despite higher volatility');
  }
  
  const concerns: string[] = [];
  
  if (category.totalCategoryPointChange && category.totalCategoryPointChange < 0) {
    concerns.push(`Decreases projected standing by ${category.totalCategoryPointChange.toFixed(1)} category points`);
  }
  
  if (roster.holesCreated.length > 0) {
    concerns.push(`Creates new positional weaknesses at: ${roster.holesCreated.join(', ')}`);
  }
  
  if (risk.volatilityChange === 'riskier' && risk.floorChange < -5) {
    concerns.push('Significantly lowers floor outcome (more downside risk)');
  }
  
  return {
    headline: headlines[rec],
    summary: `Trade value: ${score > 0 ? '+' : ''}${score.toFixed(1)} points`,
    keyPoints,
    concerns,
    opportunities: [],
    categoryNarrative: buildCategoryNarrative(category),
    riskNarrative: buildRiskNarrative(risk),
    rosterNarrative: buildRosterNarrative(roster),
    verdict: generateVerdict(rec, score, keyPoints, concerns),
  };
}

function buildCategoryNarrative(category: CategoryImpact): string {
  const improvements = category.topImprovements;
  const declines = category.topDeclines;
  
  if (improvements.length === 0 && declines.length === 0) {
    return 'Minimal impact on category standings.';
  }
  
  const parts: string[] = [];
  if (improvements.length > 0) {
    parts.push(`Strengthens: ${improvements.join(', ')}`);
  }
  if (declines.length > 0) {
    parts.push(`Weakens: ${declines.join(', ')}`);
  }
  
  return parts.join('; ');
}

function buildRiskNarrative(risk: RiskImpact): string {
  if (risk.volatilityChange === 'similar') {
    return `Risk profile remains similar. Floor: ${risk.floorChange > 0 ? '+' : ''}${risk.floorChange.toFixed(1)}, Ceiling: ${risk.ceilingChange > 0 ? '+' : ''}${risk.ceilingChange.toFixed(1)}`;
  }
  
  return `Trade makes your roster ${risk.volatilityChange}. Floor changes by ${risk.floorChange > 0 ? '+' : ''}${risk.floorChange.toFixed(1)}, ceiling by ${risk.ceilingChange > 0 ? '+' : ''}${risk.ceilingChange.toFixed(1)}`;
}

function buildRosterNarrative(roster: RosterImpact): string {
  if (roster.holesFilled.length > 0 && roster.holesCreated.length === 0) {
    return `Excellent roster fit: fills holes at ${roster.holesFilled.join(', ')} without creating new ones.`;
  }
  if (roster.holesFilled.length > 0 && roster.holesCreated.length > 0) {
    return `Mixed roster impact: fills ${roster.holesFilled.join(', ')} but creates needs at ${roster.holesCreated.join(', ')}.`;
  }
  if (roster.holesCreated.length > 0) {
    return `Concerning roster fit: creates new holes at ${roster.holesCreated.join(', ')}.`;
  }
  return 'Neutral roster impact: no significant positional changes.';
}

function generateVerdict(
  rec: TradeRecommendation,
  score: number,
  positives: string[],
  negatives: string[]
): string {
  const parts: string[] = [];
  
  parts.push(`Overall score: ${score > 0 ? '+' : ''}${score.toFixed(1)}`);
  parts.push(`Recommendation: ${rec.replace('_', ' ').toUpperCase()}`);
  
  if (positives.length > 0) {
    parts.push(`Key benefits: ${positives[0]}`);
  }
  
  if (negatives.length > 0) {
    parts.push(`Main concern: ${negatives[0]}`);
  }
  
  return parts.join('. ');
}

// ============================================================================
// Helper Functions
// ============================================================================

function enrichTradeWithIntelligence(
  trade: TradeProposal,
  teamState: TeamState
): TradeProposal {
  // In real implementation, would look up player intelligence
  // For now, return as-is (would be populated by caller)
  return trade;
}

function calculateConfidence(before: WorldProjection, after: WorldProjection): 'high' | 'medium' | 'low' {
  const minConfidence = Math.min(before.projectionConfidence, after.projectionConfidence);
  if (minConfidence > 0.8) return 'high';
  if (minConfidence > 0.6) return 'medium';
  return 'low';
}

function estimateCategoryPoints(totals: Record<string, number>, config: TradeEvaluatorConfig): number {
  // Simplified - would use actual league standings curves
  return Object.values(totals).reduce((sum, v) => sum + v, 0) / 10;
}

function estimateStanding(points: number, config: TradeEvaluatorConfig): number {
  // Simplified standing estimate
  return Math.max(1, Math.min(config.leagueSize, Math.round(config.leagueSize * 0.5)));
}

function calculateProjectionConfidence(outcomes: ProbabilisticOutcome[]): number {
  if (outcomes.length === 0) return 0.5;
  return outcomes.reduce((sum, o) => sum + o.convergenceScore, 0) / outcomes.length;
}

function assessFairness(evaluation: TradeEvaluation): 'lopsided_you' | 'slight_you' | 'fair' | 'slight_them' | 'lopsided_them' {
  const score = evaluation.summaryScore;
  if (score > 10) return 'lopsided_you';
  if (score > 5) return 'slight_you';
  if (score < -10) return 'lopsided_them';
  if (score < -5) return 'slight_them';
  return 'fair';
}

function assessAcceptance(evaluation: TradeEvaluation): 'high' | 'medium' | 'low' {
  const fairness = assessFairness(evaluation);
  if (fairness === 'lopsided_you' || fairness === 'slight_you') return 'low';
  if (fairness === 'fair') return 'medium';
  return 'high';
}

function identifyYourLeverage(evaluation: TradeEvaluation, trade: TradeProposal): string[] {
  const leverage: string[] = [];
  
  if (evaluation.rosterImpact.holesCreated.length > 0) {
    leverage.push('You can absorb the positional hit');
  }
  
  if (evaluation.riskImpact.volatilityChange === 'safer') {
    leverage.push('Youre selling high on volatile assets');
  }
  
  return leverage;
}

function identifyTheirLeverage(evaluation: TradeEvaluation, trade: TradeProposal): string[] {
  const leverage: string[] = [];
  
  if (evaluation.rosterImpact.holesFilled.length > 0) {
    leverage.push('They desperately need the positions youre offering');
  }
  
  return leverage;
}
