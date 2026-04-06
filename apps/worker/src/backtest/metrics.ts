/**
 * Performance Metrics Calculator
 *
 * Computes comprehensive backtest metrics:
 * - Win/loss records
 * - Category gains
 * - Decision accuracy
 * - Momentum accuracy
 * - Monte Carlo calibration
 * - Risk profile effectiveness
 */

import type {
  SimulationStep,
  BacktestMetrics,
  CategoryGain,
  DecisionAccuracyMetrics,
  MomentumAccuracyMetrics,
  MonteCarloCalibration,
  RiskProfileMetrics,
  BaselineComparison,
  FantasyOutcome,
} from './types.js';

// ============================================================================
// Main Metrics Calculator
// ============================================================================

export class MetricsCalculator {
  private steps: SimulationStep[];
  private baselineResults: Map<string, SimulationStep[]>;
  
  constructor(
    steps: SimulationStep[],
    baselineResults: Map<string, SimulationStep[]>
  ) {
    this.steps = steps;
    this.baselineResults = baselineResults;
  }
  
  /**
   * Calculate all metrics
   */
  calculateAllMetrics(): BacktestMetrics {
    return {
      totalWeeks: this.steps.length,
      wins: this.calculateWins(),
      losses: this.calculateLosses(),
      ties: this.calculateTies(),
      winPercentage: this.calculateWinPercentage(),
      categoryGains: this.calculateCategoryGains(),
      totalCategoryPoints: this.calculateTotalCategoryPoints(),
      categoryPointDeltaVsBaseline: this.calculateCategoryPointDeltas(),
      decisionAccuracy: this.calculateDecisionAccuracy(),
      momentumAccuracy: this.calculateMomentumAccuracy(),
      monteCarloCalibration: this.calculateMonteCarloCalibration(),
      riskProfileAccuracy: this.calculateRiskProfileAccuracy(),
      baselineComparisons: this.calculateBaselineComparisons(),
    };
  }
  
  // ============================================================================
  // Basic Record
  // ============================================================================
  
  private calculateWins(): number {
    return this.steps.filter(s => {
      const outcome = s.actualOutcomes['optimizer'];
      return outcome && outcome.totalPoints > 0; // Would compare to opponent
    }).length;
  }
  
  private calculateLosses(): number {
    return this.steps.filter(s => {
      const outcome = s.actualOutcomes['optimizer'];
      return outcome && outcome.totalPoints < 0;
    }).length;
  }
  
  private calculateTies(): number {
    return this.steps.filter(s => {
      const outcome = s.actualOutcomes['optimizer'];
      return outcome && outcome.totalPoints === 0;
    }).length;
  }
  
  private calculateWinPercentage(): number {
    const total = this.steps.length;
    if (total === 0) return 0;
    return this.calculateWins() / total;
  }
  
  // ============================================================================
  // Category Metrics
  // ============================================================================
  
  private calculateCategoryGains(): Record<string, CategoryGain> {
    // Aggregate category stats across all weeks
    const gains: Record<string, CategoryGain> = {};
    
    const categories = ['runs', 'homeRuns', 'rbi', 'stolenBases', 'battingAverage'];
    
    for (const cat of categories) {
      const values = this.steps.map(s => 
        s.actualOutcomes['optimizer']?.categoryStats[cat as keyof typeof s.actualOutcomes['optimizer']['categoryStats']] || 0
      );
      
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      
      gains[cat] = {
        category: cat,
        optimizerValue: avg,
        leagueRank: 0, // Would need league data
        deltaVsAverage: 0, // Would need league average
        deltaVsBaseline: {},
      };
    }
    
    return gains;
  }
  
  private calculateTotalCategoryPoints(): number {
    // Sum of category ranks (lower is better in roto)
    const gains = this.calculateCategoryGains();
    return Object.values(gains).reduce((sum, g) => sum + g.optimizerValue, 0);
  }
  
  private calculateCategoryPointDeltas(): Record<string, number> {
    const deltas: Record<string, number> = {};
    
    for (const [baselineName, baselineSteps] of this.baselineResults) {
      const optimizerTotal = this.calculateTotalCategoryPoints();
      const baselineTotal = baselineSteps.reduce((sum, s) => 
        sum + (s.actualOutcomes[baselineName]?.totalPoints || 0), 0
      );
      
      deltas[baselineName] = optimizerTotal - baselineTotal;
    }
    
    return deltas;
  }
  
  // ============================================================================
  // Decision Accuracy
  // ============================================================================
  
  private calculateDecisionAccuracy(): DecisionAccuracyMetrics {
    let totalDecisions = 0;
    let correctDecisions = 0;
    
    for (const step of this.steps) {
      for (const decision of step.optimizerDecisions) {
        totalDecisions++;
        
        // Check if decision was correct
        // A "start" decision is correct if the player outperformed alternatives
        if (decision.action === 'start') {
          const wasCorrect = this.wasStartDecisionCorrect(step, decision);
          if (wasCorrect) correctDecisions++;
        }
      }
    }
    
    // Calculate value added vs baselines
    let valueAddedVsNaive = 0;
    let valueAddedVsHuman = 0;
    
    for (const step of this.steps) {
      const optimizerOutcome = step.actualOutcomes['optimizer'];
      
      for (const [baselineName, baselineSteps] of this.baselineResults) {
        const baselineStep = baselineSteps.find(s => s.date === step.date);
        if (!baselineStep) continue;
        
        const baselineOutcome = baselineStep.actualOutcomes[baselineName];
        const delta = optimizerOutcome.totalPoints - baselineOutcome.totalPoints;
        
        if (baselineName === 'naive') valueAddedVsNaive += delta;
        if (baselineName === 'human_heuristic') valueAddedVsHuman += delta;
      }
    }
    
    return {
      totalDecisions,
      correctDecisions,
      accuracy: totalDecisions > 0 ? correctDecisions / totalDecisions : 0,
      startCorrect: correctDecisions, // Simplified
      benchCorrect: 0,
      addCorrect: 0,
      dropCorrect: 0,
      valueAddedVsNaive,
      valueAddedVsHuman,
    };
  }
  
  private wasStartDecisionCorrect(
    step: SimulationStep,
    decision: { playerId: string; slot: string }
  ): boolean {
    // Check if started player outperformed benched alternatives
    const startedOutcome = step.actualOutcomes['optimizer']?.playerOutcomes.find(
      p => p.playerId === decision.playerId
    );
    
    if (!startedOutcome) return false;
    
    // Compare to average bench performance
    const benchedPlayers = step.optimizerLineup.bench;
    const benchOutcomes = benchedPlayers
      .map(id => step.actualOutcomes['optimizer']?.playerOutcomes.find(p => p.playerId === id))
      .filter(Boolean);
    
    if (benchOutcomes.length === 0) return true;
    
    const avgBench = benchOutcomes.reduce((sum, p) => sum + p!.fantasyPoints, 0) / benchOutcomes.length;
    
    return startedOutcome.fantasyPoints > avgBench;
  }
  
  // ============================================================================
  // Momentum Accuracy
  // ============================================================================
  
  private calculateMomentumAccuracy(): MomentumAccuracyMetrics {
    let totalPredictions = 0;
    let correctDirection = 0;
    let breakoutHits = 0;
    let breakoutTotal = 0;
    
    for (const step of this.steps) {
      for (const player of step.worldState.roster.players) {
        if (!player.momentum) continue;
        
        totalPredictions++;
        
        // Check if trend direction was correct
        const predictedTrend = player.momentum.trend;
        const actualPerformance = this.getActualPerformance(step, player.playerId);
        
        const wasCorrect = this.wasTrendCorrect(predictedTrend, actualPerformance);
        if (wasCorrect) correctDirection++;
        
        // Breakout detection
        if (player.momentum.breakoutSignal) {
          breakoutTotal++;
          if (actualPerformance === 'hot') breakoutHits++;
        }
      }
    }
    
    return {
      totalPredictions,
      correctDirection: totalPredictions > 0 ? correctDirection / totalPredictions : 0,
      breakoutHitRate: breakoutTotal > 0 ? breakoutHits / breakoutTotal : 0,
      collapseAvoidedRate: 0, // Would track collapses
      predictedHotActualHot: 0,
      predictedHotActualCold: 0,
      predictedColdActualHot: 0,
      predictedColdActualCold: 0,
    };
  }
  
  private getActualPerformance(
    step: SimulationStep,
    playerId: string
  ): 'hot' | 'cold' | 'neutral' {
    const outcome = step.actualOutcomes['optimizer']?.playerOutcomes.find(
      p => p.playerId === playerId
    );
    
    if (!outcome) return 'neutral';
    
    // Simple threshold
    if (outcome.fantasyPoints > 15) return 'hot';
    if (outcome.fantasyPoints < 5) return 'cold';
    return 'neutral';
  }
  
  private wasTrendCorrect(
    predicted: string,
    actual: 'hot' | 'cold' | 'neutral'
  ): boolean {
    if (predicted === 'surging' || predicted === 'hot') {
      return actual === 'hot';
    }
    if (predicted === 'collapsing' || predicted === 'cold') {
      return actual === 'cold';
    }
    return actual === 'neutral';
  }
  
  // ============================================================================
  // Monte Carlo Calibration
  // ============================================================================
  
  private calculateMonteCarloCalibration(): MonteCarloCalibration {
    let p10Count = 0;
    let p50Count = 0;
    let p90Count = 0;
    let total = 0;
    
    for (const step of this.steps) {
      for (const player of step.worldState.roster.players) {
        if (!player.probabilistic) continue;
        
        const actual = step.actualOutcomes['optimizer']?.playerOutcomes.find(
          p => p.playerId === player.playerId
        );
        
        if (!actual) continue;
        
        total++;
        
        // Check percentiles
        if (actual.fantasyPoints >= player.probabilistic.rosScore.p10) p10Count++;
        if (actual.fantasyPoints >= player.probabilistic.rosScore.p50) p50Count++;
        if (actual.fantasyPoints <= player.probabilistic.rosScore.p90) p90Count++;
      }
    }
    
    return {
      p10Accuracy: total > 0 ? p10Count / total : 0,
      p50Accuracy: total > 0 ? p50Count / total : 0,
      p90Accuracy: total > 0 ? p90Count / total : 0,
      calibrationScore: total > 0 
        ? 100 - Math.abs(0.5 - p50Count / total) * 200 
        : 0,
    };
  }
  
  // ============================================================================
  // Risk Profile
  // ============================================================================
  
  private calculateRiskProfileAccuracy(): RiskProfileMetrics {
    // Track high-risk vs conservative decisions
    let highRiskStarts = 0;
    let highRiskSuccess = 0;
    let conservativeStarts = 0;
    let conservativeSuccess = 0;
    
    for (const step of this.steps) {
      for (const decision of step.optimizerDecisions) {
        if (decision.action !== 'start') continue;
        
        const player = step.worldState.roster.players.find(
          p => p.playerId === decision.playerId
        );
        
        if (!player?.probabilistic) continue;
        
        const isHighRisk = player.probabilistic.riskProfile.volatility === 'high';
        const outcome = step.actualOutcomes['optimizer']?.playerOutcomes.find(
          p => p.playerId === decision.playerId
        );
        
        if (isHighRisk) {
          highRiskStarts++;
          if (outcome && outcome.fantasyPoints > 10) highRiskSuccess++;
        } else {
          conservativeStarts++;
          if (outcome && outcome.fantasyPoints > 5) conservativeSuccess++;
        }
      }
    }
    
    return {
      volatility: highRiskStarts > conservativeStarts ? 'high' : 'low',
      downsideRisk: 0,
      upsidePotential: 0,
      consistencyRating: conservativeStarts > 0 
        ? (conservativeSuccess / conservativeStarts) * 100 
        : 0,
    };
  }
  
  // ============================================================================
  // Baseline Comparisons
  // ============================================================================
  
  private calculateBaselineComparisons(): Record<string, BaselineComparison> {
    const comparisons: Record<string, BaselineComparison> = {};
    
    for (const [baselineName, baselineSteps] of this.baselineResults) {
      let optimizerWins = 0;
      let baselineWins = 0;
      let ties = 0;
      let totalDelta = 0;
      const weeklyResults = [];
      
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];
        const baselineStep = baselineSteps[i];
        
        const optimizerScore = step.actualOutcomes['optimizer']?.totalPoints || 0;
        const baselineScore = baselineStep?.actualOutcomes[baselineName]?.totalPoints || 0;
        
        const delta = optimizerScore - baselineScore;
        totalDelta += delta;
        
        let winner: 'optimizer' | 'baseline' | 'tie';
        if (delta > 0.1) {
          winner = 'optimizer';
          optimizerWins++;
        } else if (delta < -0.1) {
          winner = 'baseline';
          baselineWins++;
        } else {
          winner = 'tie';
          ties++;
        }
        
        weeklyResults.push({
          week: i + 1,
          optimizerScore,
          baselineScore,
          delta,
          winner,
        });
      }
      
      comparisons[baselineName] = {
        baselineName,
        optimizerWins,
        baselineWins,
        ties,
        avgPointsDelta: totalDelta / this.steps.length,
        totalValueAdded: totalDelta,
        weeklyResults,
      };
    }
    
    return comparisons;
  }
}
