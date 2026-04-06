/**
 * Backtesting Harness Types
 *
 * Type definitions for the complete historical backtesting system.
 */

import type { PlayerScore } from '../scoring/compute.js';
import type { PitcherScore } from '../pitchers/compute.js';
import type { MomentumMetrics } from '../momentum/index.js';
import type { ProbabilisticOutcome } from '../probabilistic/index.js';
import type { OptimizedLineup } from '../lineup/optimizer.js';
import type { TeamState } from '@cbb/core';

// ============================================================================
// Historical Data
// ============================================================================

/**
 * World state at a specific point in time
 * Reconstructed from historical data
 */
export interface WorldState {
  date: string;                    // ISO date
  week: number;                    // Week of season (1-26)
  season: number;                  // Year
  
  // Roster context
  roster: HistoricalRoster;
  freeAgents: HistoricalPlayer[];
  
  // Game data
  gameLogs: Map<string, HistoricalGame[]>;  // playerId -> games
  schedule: TeamSchedule;
  
  // Context
  injuries: Map<string, InjuryStatus>;
  standings?: LeagueStandings;
}

export interface HistoricalRoster {
  teamId: string;
  players: HistoricalPlayer[];
  lineupConfig: TeamState['lineupConfig'];
  waiverBudget: number;
}

export interface HistoricalPlayer {
  playerId: string;
  playerMlbamId: string;
  name: string;
  positions: string[];
  acquiredDate?: string;
  acquisitionType?: 'draft' | 'waiver' | 'trade';
  
  // Intelligence (computed at this point in time)
  score?: PlayerScore | PitcherScore;
  momentum?: MomentumMetrics;
  probabilistic?: ProbabilisticOutcome;
}

export interface HistoricalGame {
  date: string;
  opponent: string;
  isHome: boolean;
  
  // Batting stats
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  stolenBases: number;
  caughtStealing: number;
  
  // Pitching stats
  inningsPitched: number;
  hitsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  walksAllowed: number;
  strikeoutsPitched: number;
  wins: number;
  losses: number;
  saves: number;
}

export interface TeamSchedule {
  teamId: string;
  games: ScheduledGame[];
}

export interface ScheduledGame {
  date: string;
  opponent: string;
  isHome: boolean;
  isDoubleheader: boolean;
}

export interface InjuryStatus {
  playerId: string;
  isInjured: boolean;
  injuryType?: string;
  expectedReturn?: string;
}

export interface LeagueStandings {
  teamId: string;
  rank: number;
  record: { wins: number; losses: number };
  categoryPoints: number;
  categories: Record<string, number>;
}

// ============================================================================
// Simulation
// ============================================================================

/**
 * Single simulation step result
 */
export interface SimulationStep {
  date: string;
  week: number;
  
  // Inputs
  worldState: WorldState;
  
  // Optimizer results
  optimizerLineup: OptimizedLineup;
  optimizerDecisions: OptimizerDecision[];
  
  // Baseline results
  baselineLineups: Record<string, OptimizedLineup>;
  
  // Outcomes
  actualOutcomes: Record<string, FantasyOutcome>;
}

export interface OptimizerDecision {
  slot: string;
  playerId: string;
  playerName: string;
  action: 'start' | 'bench' | 'add' | 'drop';
  reasoning: string;
  confidence: number;
}

// ============================================================================
// Fantasy Outcomes
// ============================================================================

/**
 * Fantasy scoring results for a lineup
 */
export interface FantasyOutcome {
  totalPoints: number;             // Points leagues
  categoryStats: CategoryStats;    // Roto leagues
  categoryPoints?: number;         // Roto: points earned
  
  // Breakdown
  playerOutcomes: PlayerFantasyOutcome[];
  
  // Comparison
  vsBaseline: Record<string, number>;  // delta vs each baseline
}

export interface CategoryStats {
  runs: number;
  homeRuns: number;
  rbi: number;
  stolenBases: number;
  battingAverage: number;
  onBasePercentage: number;
  sluggingPercentage: number;
  ops: number;
  
  // Pitching
  wins: number;
  saves: number;
  strikeouts: number;
  era: number;
  whip: number;
  kPerNine: number;
  qualityStarts: number;
}

export interface PlayerFantasyOutcome {
  playerId: string;
  playerName: string;
  gamesPlayed: number;
  fantasyPoints: number;
  categoryContributions: Partial<CategoryStats>;
}

// ============================================================================
// Performance Metrics
// ============================================================================

/**
 * Season-level performance metrics
 */
export interface BacktestMetrics {
  // Overall performance
  totalWeeks: number;
  wins: number;
  losses: number;
  ties: number;
  winPercentage: number;
  
  // Category performance (roto)
  categoryGains: Record<string, CategoryGain>;
  totalCategoryPoints: number;
  categoryPointDeltaVsBaseline: Record<string, number>;
  
  // Decision quality
  decisionAccuracy: DecisionAccuracyMetrics;
  momentumAccuracy: MomentumAccuracyMetrics;
  monteCarloCalibration: MonteCarloCalibration;
  
  // Risk metrics
  riskProfileAccuracy: RiskProfileMetrics;
  highRiskDecisions: HighRiskDecisionMetrics;
  
  // Comparison to baselines
  baselineComparisons: Record<string, BaselineComparison>;
}

export interface CategoryGain {
  category: string;
  optimizerValue: number;
  leagueRank: number;
  deltaVsAverage: number;
  deltaVsBaseline: Record<string, number>;
}

export interface DecisionAccuracyMetrics {
  totalDecisions: number;
  correctDecisions: number;
  accuracy: number;
  
  // By type
  startCorrect: number;
  benchCorrect: number;
  addCorrect: number;
  dropCorrect: number;
  
  // Value added
  valueAddedVsNaive: number;
  valueAddedVsHuman: number;
}

export interface MomentumAccuracyMetrics {
  totalPredictions: number;
  correctDirection: number;        // Did trend continue?
  breakoutHitRate: number;         // Breakouts that materialized
  collapseAvoidedRate: number;     // Collapses correctly predicted
  
  // Calibration
  predictedHotActualHot: number;
  predictedHotActualCold: number;
  predictedColdActualHot: number;
  predictedColdActualCold: number;
}

export interface MonteCarloCalibration {
  p10Accuracy: number;             // % of outcomes above 10th percentile
  p50Accuracy: number;             // % of outcomes above/below median
  p90Accuracy: number;             // % of outcomes below 90th percentile
  
  // Should be ~10%, ~50%, ~90% respectively for well-calibrated model
  calibrationScore: number;        // 0-100, higher = better calibrated
}

export interface RiskProfileMetrics {
  highRiskStarts: number;
  highRiskSuccessRate: number;
  conservativeStarts: number;
  conservativeSuccessRate: number;
  
  // Expected vs actual
  expectedDownside: number;
  actualDownside: number;
  expectedUpside: number;
  actualUpside: number;
}

export interface HighRiskDecisionMetrics {
  total: number;
  paidOff: number;
  failed: number;
  avgReturn: number;
}

export interface BaselineComparison {
  baselineName: string;
  optimizerWins: number;
  baselineWins: number;
  ties: number;
  
  avgPointsDelta: number;
  totalValueAdded: number;
  
  // Week-by-week
  weeklyResults: WeeklyComparison[];
}

export interface WeeklyComparison {
  week: number;
  optimizerScore: number;
  baselineScore: number;
  delta: number;
  winner: 'optimizer' | 'baseline' | 'tie';
}

// ============================================================================
// Baselines
// ============================================================================

/**
 * Baseline strategy interface
 */
export interface BaselineStrategy {
  name: string;
  description: string;
  
  selectLineup(
    worldState: WorldState,
    availablePlayers: HistoricalPlayer[]
  ): OptimizedLineup;
}

// ============================================================================
// Reports
// ============================================================================

/**
 * Complete backtest report
 */
export interface BacktestReport {
  metadata: {
    season: number;
    leagueId: string;
    teamId: string;
    simulationDates: string[];
    totalWeeks: number;
    runDate: string;
  };
  
  summary: {
    overallPerformance: string;
    keyWins: string[];
    keyLosses: string[];
    vsBaselines: string;
  };
  
  metrics: BacktestMetrics;
  
  // Detailed breakdowns
  categoryBreakdown: CategoryBreakdownReport;
  decisionAnalysis: DecisionAnalysisReport;
  riskAnalysis: RiskAnalysisReport;
  
  // Comparisons
  baselineReports: BaselineReport[];
  
  // Golden baseline
  goldenBaselineMatch: boolean;
  regressions: string[];
}

export interface CategoryBreakdownReport {
  byCategory: Record<string, CategoryDetail>;
  strongestCategories: string[];
  weakestCategories: string[];
  improvementOpportunities: string[];
}

export interface CategoryDetail {
  finalValue: number;
  leagueRank: number;
  weeklyTrend: number[];
  keyContributors: string[];
  deltaVsBaselines: Record<string, number>;
}

export interface DecisionAnalysisReport {
  bestDecisions: DecisionReview[];
  worstDecisions: DecisionReview[];
  controversialDecisions: DecisionReview[];
  
  patternAnalysis: {
    overusedPlayers: string[];
    underusedPlayers: string[];
    timingAccuracy: number;
  };
}

export interface DecisionReview {
  date: string;
  decision: string;
  reasoning: string;
  actualOutcome: string;
  valueDelta: number;
  wasCorrect: boolean;
}

export interface RiskAnalysisReport {
  riskToleranceEffectiveness: string;
  highRiskWins: DecisionReview[];
  highRiskLosses: DecisionReview[];
  conservativeWins: DecisionReview[];
  conservativeLosses: DecisionReview[];
}

export interface BaselineReport {
  baselineName: string;
  headToHead: string;
  weeklyBreakdown: string;
  keyDifferences: string[];
}

// ============================================================================
// Golden Baseline
// ============================================================================

/**
 * Frozen baseline for regression testing
 */
export interface GoldenBaseline {
  version: string;
  createdAt: string;
  season: number;
  
  // Full season snapshot
  weeklyLineups: Record<string, OptimizedLineup>;
  decisions: Record<string, OptimizerDecision[]>;
  outcomes: Record<string, FantasyOutcome>;
  
  // Metrics
  metrics: BacktestMetrics;
  
  // Validation hash
  checksum: string;
}
