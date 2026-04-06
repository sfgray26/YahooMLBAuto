/**
 * Backtest Report Generator
 *
 * Generates comprehensive backtest reports with:
 * - Performance summaries
 * - Category breakdowns
 * - Decision analysis
 * - Risk analysis
 * - Baseline comparisons
 */

import type {
  BacktestReport,
  BacktestMetrics,
  SimulationStep,
  CategoryBreakdownReport,
  DecisionAnalysisReport,
  RiskAnalysisReport,
  BaselineReport,
  DecisionReview,
} from './types.js';

// ============================================================================
// Report Generator
// ============================================================================

export class ReportGenerator {
  private season: number;
  private steps: SimulationStep[];
  private metrics: BacktestMetrics;
  
  constructor(
    season: number,
    steps: SimulationStep[],
    metrics: BacktestMetrics
  ) {
    this.season = season;
    this.steps = steps;
    this.metrics = metrics;
  }
  
  /**
   * Generate complete backtest report
   */
  generateReport(): BacktestReport {
    return {
      metadata: {
        season: this.season,
        leagueId: 'test-league',
        teamId: 'test-team',
        simulationDates: this.steps.map(s => s.date),
        totalWeeks: this.steps.length,
        runDate: new Date().toISOString(),
      },
      
      summary: this.generateSummary(),
      metrics: this.metrics,
      
      categoryBreakdown: this.generateCategoryBreakdown(),
      decisionAnalysis: this.generateDecisionAnalysis(),
      riskAnalysis: this.generateRiskAnalysis(),
      
      baselineReports: this.generateBaselineReports(),
      
      goldenBaselineMatch: true, // Would compare to stored baseline
      regressions: [],
    };
  }
  
  /**
   * Generate executive summary
   */
  private generateSummary() {
    const { wins, losses, winPercentage } = this.metrics;
    const vsNaive = this.metrics.baselineComparisons['naive'];
    const vsHuman = this.metrics.baselineComparisons['human_heuristic'];
    
    const overallPerformance = 
      `Optimizer: ${wins}-${losses} (${(winPercentage * 100).toFixed(1)}% win rate)`;
    
    const keyWins: string[] = [];
    const keyLosses: string[] = [];
    
    // Find best and worst weeks
    for (const [name, comparison] of Object.entries(this.metrics.baselineComparisons)) {
      const bestWeek = comparison.weeklyResults.reduce((best, current) => 
        current.delta > best.delta ? current : best
      );
      
      const worstWeek = comparison.weeklyResults.reduce((worst, current) => 
        current.delta < worst.delta ? current : worst
      );
      
      keyWins.push(`Week ${bestWeek.week}: +${bestWeek.delta.toFixed(1)} vs ${name}`);
      keyLosses.push(`Week ${worstWeek.week}: ${worstWeek.delta.toFixed(1)} vs ${name}`);
    }
    
    const vsBaselines = [
      `vs Naive: ${vsNaive?.optimizerWins || 0}-${vsNaive?.baselineWins || 0}`,
      `vs Human: ${vsHuman?.optimizerWins || 0}-${vsHuman?.baselineWins || 0}`,
    ].join(', ');
    
    return {
      overallPerformance,
      keyWins: keyWins.slice(0, 3),
      keyLosses: keyLosses.slice(0, 3),
      vsBaselines,
    };
  }
  
  /**
   * Generate category breakdown
   */
  private generateCategoryBreakdown(): CategoryBreakdownReport {
    const byCategory: CategoryBreakdownReport['byCategory'] = {};
    
    for (const [cat, gain] of Object.entries(this.metrics.categoryGains)) {
      byCategory[cat] = {
        finalValue: gain.optimizerValue,
        leagueRank: gain.leagueRank,
        weeklyTrend: [], // Would fill from weekly data
        keyContributors: [],
        deltaVsBaselines: gain.deltaVsBaseline,
      };
    }
    
    // Find strongest/weakest
    const sorted = Object.entries(byCategory).sort((a, b) => 
      b[1].finalValue - a[1].finalValue
    );
    
    return {
      byCategory,
      strongestCategories: sorted.slice(0, 3).map(([cat]) => cat),
      weakestCategories: sorted.slice(-3).map(([cat]) => cat),
      improvementOpportunities: [],
    };
  }
  
  /**
   * Generate decision analysis
   */
  private generateDecisionAnalysis(): DecisionAnalysisReport {
    const bestDecisions: DecisionReview[] = [];
    const worstDecisions: DecisionReview[] = [];
    
    // Analyze each decision
    for (const step of this.steps) {
      for (const decision of step.optimizerDecisions) {
        const outcome = step.actualOutcomes['optimizer']?.playerOutcomes.find(
          p => p.playerId === decision.playerId
        );
        
        if (!outcome) continue;
        
        const review: DecisionReview = {
          date: step.date,
          decision: `${decision.action} ${decision.playerName}`,
          reasoning: decision.reasoning,
          actualOutcome: `${outcome.fantasyPoints.toFixed(1)} points`,
          valueDelta: outcome.fantasyPoints,
          wasCorrect: outcome.fantasyPoints > 10,
        };
        
        if (outcome.fantasyPoints > 20) {
          bestDecisions.push(review);
        } else if (outcome.fantasyPoints < 0) {
          worstDecisions.push(review);
        }
      }
    }
    
    // Sort by value
    bestDecisions.sort((a, b) => b.valueDelta - a.valueDelta);
    worstDecisions.sort((a, b) => a.valueDelta - b.valueDelta);
    
    return {
      bestDecisions: bestDecisions.slice(0, 5),
      worstDecisions: worstDecisions.slice(0, 5),
      controversialDecisions: [],
      patternAnalysis: {
        overusedPlayers: [],
        underusedPlayers: [],
        timingAccuracy: this.metrics.decisionAccuracy.accuracy,
      },
    };
  }
  
  /**
   * Generate risk analysis
   */
  private generateRiskAnalysis(): RiskAnalysisReport {
    const highRiskWins: DecisionReview[] = [];
    const highRiskLosses: DecisionReview[] = [];
    const conservativeWins: DecisionReview[] = [];
    const conservativeLosses: DecisionReview[] = [];
    
    for (const step of this.steps) {
      for (const decision of step.optimizerDecisions) {
        if (decision.action !== 'start') continue;
        
        const player = step.worldState.roster.players.find(
          p => p.playerId === decision.playerId
        );
        
        if (!player?.probabilistic) continue;
        
        const outcome = step.actualOutcomes['optimizer']?.playerOutcomes.find(
          p => p.playerId === decision.playerId
        );
        
        if (!outcome) continue;
        
        const review: DecisionReview = {
          date: step.date,
          decision: `Start ${decision.playerName}`,
          reasoning: decision.reasoning,
          actualOutcome: `${outcome.fantasyPoints.toFixed(1)} points`,
          valueDelta: outcome.fantasyPoints,
          wasCorrect: outcome.fantasyPoints > 10,
        };
        
        const isHighRisk = player.probabilistic.riskProfile.volatility === 'high';
        const isWin = outcome.fantasyPoints > 10;
        
        if (isHighRisk && isWin) highRiskWins.push(review);
        if (isHighRisk && !isWin) highRiskLosses.push(review);
        if (!isHighRisk && isWin) conservativeWins.push(review);
        if (!isHighRisk && !isWin) conservativeLosses.push(review);
      }
    }
    
    return {
      riskToleranceEffectiveness: this.getRiskEffectivenessSummary(),
      highRiskWins: highRiskWins.slice(0, 3),
      highRiskLosses: highRiskLosses.slice(0, 3),
      conservativeWins: conservativeWins.slice(0, 3),
      conservativeLosses: conservativeLosses.slice(0, 3),
    };
  }
  
  private getRiskEffectivenessSummary(): string {
    const mc = this.metrics.monteCarloCalibration;
    const risk = this.metrics.riskProfileAccuracy;
    
    return [
      `Monte Carlo calibration: ${(mc.calibrationScore).toFixed(0)}/100`,
      `Consistency rating: ${risk.consistencyRating.toFixed(0)}/100`,
      `Risk profile: ${risk.volatility}`,
    ].join('; ');
  }
  
  /**
   * Generate baseline comparison reports
   */
  private generateBaselineReports(): BaselineReport[] {
    return Object.entries(this.metrics.baselineComparisons).map(([name, comparison]) => ({
      baselineName: name,
      headToHead: `${comparison.optimizerWins}-${comparison.baselineWins}-${comparison.ties}`,
      weeklyBreakdown: `Avg delta: ${comparison.avgPointsDelta.toFixed(1)} points`,
      keyDifferences: [
        `Total value added: ${comparison.totalValueAdded.toFixed(1)} points`,
        `Win rate: ${(comparison.optimizerWins / this.steps.length * 100).toFixed(0)}%`,
      ],
    }));
  }
  
  /**
   * Format report as text
   */
  formatAsText(report: BacktestReport): string {
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════════╗',
      '║                    BACKTEST REPORT                               ║',
      `║  Season: ${report.metadata.season}                                  ║`,
      `║  Weeks: ${report.metadata.totalWeeks}                                     ║`,
      `║  Run Date: ${report.metadata.runDate.split('T')[0]}                        ║`,
      '╚══════════════════════════════════════════════════════════════════╝',
      '',
      '📊 SUMMARY',
      `  ${report.summary.overallPerformance}`,
      `  ${report.summary.vsBaselines}`,
      '',
      '🏆 KEY WINS',
      ...report.summary.keyWins.map(w => `  ✓ ${w}`),
      '',
      '📉 KEY LOSSES',
      ...report.summary.keyLosses.map(l => `  ✗ ${l}`),
      '',
      '📈 METRICS',
      `  Decision Accuracy: ${(report.metrics.decisionAccuracy.accuracy * 100).toFixed(1)}%`,
      `  Momentum Accuracy: ${(report.metrics.momentumAccuracy.correctDirection * 100).toFixed(1)}%`,
      `  Monte Carlo Calibration: ${report.metrics.monteCarloCalibration.calibrationScore.toFixed(0)}/100`,
      '',
      '🎯 BASELINE COMPARISONS',
      ...report.baselineReports.map(b => [
        `  ${b.baselineName}:`,
        `    H2H: ${b.headToHead}`,
        `    ${b.weeklyBreakdown}`,
      ].join('\n')),
      '',
      '═══════════════════════════════════════════════════════════════════',
    ];
    
    return lines.join('\n');
  }
  
  /**
   * Export report as JSON
   */
  exportAsJSON(report: BacktestReport): string {
    return JSON.stringify(report, null, 2);
  }
  
  /**
   * Export report as CSV (for spreadsheet analysis)
   */
  exportAsCSV(report: BacktestReport): string {
    const rows: string[] = [
      'Week,Date,Optimizer Points,Baseline Points,Delta,Winner',
    ];
    
    for (const [name, comparison] of Object.entries(report.metrics.baselineComparisons)) {
      for (const week of comparison.weeklyResults) {
        rows.push([
          week.week,
          this.steps[week.week - 1]?.date || '',
          week.optimizerScore.toFixed(1),
          week.baselineScore.toFixed(1),
          week.delta.toFixed(1),
          week.winner,
        ].join(','));
      }
    }
    
    return rows.join('\n');
  }
}

// ============================================================================
// Golden Baseline Management
// ============================================================================

import type { GoldenBaseline } from './types.js';

export class GoldenBaselineManager {
  private storageKey = 'fantasy-baseball-golden-baseline';
  
  /**
   * Save a golden baseline
   */
  saveGoldenBaseline(
    season: number,
    steps: SimulationStep[],
    metrics: BacktestMetrics
  ): GoldenBaseline {
    const baseline: GoldenBaseline = {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      season,
      weeklyLineups: {},
      decisions: {},
      outcomes: {},
      metrics,
      checksum: this.calculateChecksum(steps),
    };
    
    // Populate weekly data
    for (const step of steps) {
      baseline.weeklyLineups[step.date] = step.optimizerLineup;
      baseline.decisions[step.date] = step.optimizerDecisions;
      baseline.outcomes[step.date] = step.actualOutcomes['optimizer'];
    }
    
    // Store (would use actual storage in production)
    console.log(`[GoldenBaseline] Saved baseline for season ${season}`);
    
    return baseline;
  }
  
  /**
   * Compare current results to golden baseline
   */
  compareToGoldenBaseline(
    currentSteps: SimulationStep[],
    golden: GoldenBaseline
  ): { matches: boolean; regressions: string[] } {
    const regressions: string[] = [];
    
    // Check key metrics
    const currentMetrics = new MetricsCalculator(currentSteps, new Map()).calculateAllMetrics();
    
    if (currentMetrics.winPercentage < golden.metrics.winPercentage * 0.95) {
      regressions.push(`Win percentage dropped: ${(currentMetrics.winPercentage * 100).toFixed(1)}% vs ${(golden.metrics.winPercentage * 100).toFixed(1)}%`);
    }
    
    if (currentMetrics.decisionAccuracy.accuracy < golden.metrics.decisionAccuracy.accuracy * 0.95) {
      regressions.push('Decision accuracy regression detected');
    }
    
    return {
      matches: regressions.length === 0,
      regressions,
    };
  }
  
  private calculateChecksum(steps: SimulationStep[]): string {
    // Simple checksum for validation
    const data = steps.map(s => `${s.date}:${s.optimizerLineup.totalObjective}`).join('|');
    return Buffer.from(data).toString('base64').slice(0, 16);
  }
}
