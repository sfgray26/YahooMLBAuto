/**
 * Backtest Simulator
 *
 * Main simulation engine that runs the full intelligence stack
 * against historical data.
 */

import { optimizeLineup, type PlayerWithIntelligence } from '../lineup/optimizer.js';
import { calculateMomentum } from '../momentum/index.js';
import { simulatePlayerOutcomes } from '../probabilistic/index.js';
import { scorePlayer, type PlayerScore } from '../scoring/compute.js';
import { scorePitcher, type PitcherScore } from '../pitchers/compute.js';
import type { TeamState } from '@cbb/core';

import type {
  WorldState,
  SimulationStep,
  HistoricalPlayer,
  OptimizerDecision,
} from './types.js';

import { FantasyOutcomeCalculator } from './outcomeCalculator.js';
import { MetricsCalculator } from './metrics.js';
import { ReportGenerator, GoldenBaselineManager } from './reportGenerator.js';
import type { BaselineStrategy } from './types.js';

// ============================================================================
// Simulator Configuration
// ============================================================================

interface SimulatorConfig {
  season: number;
  teamId: string;
  leagueId: string;
  weeklyMode: boolean;
  baselines: BaselineStrategy[];
  verbose: boolean;
}

// ============================================================================
// Main Simulator
// ============================================================================

export class BacktestSimulator {
  private config: SimulatorConfig;
  private outcomeCalculator: FantasyOutcomeCalculator;
  
  constructor(config: SimulatorConfig) {
    this.config = config;
    this.outcomeCalculator = new FantasyOutcomeCalculator();
  }
  
  /**
   * Run complete backtest simulation
   */
  async runSimulation(worldStates: WorldState[]) {
    console.log(`[Simulator] Starting backtest for ${worldStates.length} weeks...`);
    
    const steps: SimulationStep[] = [];
    const baselineSteps: Map<string, SimulationStep[]> = new Map();
    
    for (const baseline of this.config.baselines) {
      baselineSteps.set(baseline.name, []);
    }
    
    // Process each simulation step
    for (let i = 0; i < worldStates.length; i++) {
      const worldState = worldStates[i];
      
      if (this.config.verbose) {
        console.log(`[Simulator] Week ${i + 1}: ${worldState.date}`);
      }
      
      // 1. Compute intelligence for all players
      const playersWithIntelligence = await this.computeIntelligence(worldState);
      
      // 2. Run optimizer
      const teamState = this.convertToTeamState(worldState);
      const optimizerLineup = optimizeLineup(playersWithIntelligence, teamState);
      
      // 3. Extract decisions
      const optimizerDecisions = this.extractDecisions(optimizerLineup, playersWithIntelligence);
      
      // 4. Run baselines
      const baselineLineups: Record<string, typeof optimizerLineup> = {};
      for (const baseline of this.config.baselines) {
        baselineLineups[baseline.name] = baseline.selectLineup(worldState);
      }
      
      // 5. Calculate actual outcomes
      const periodStart = new Date(worldState.date);
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + (this.config.weeklyMode ? 7 : 1));
      
      const actualOutcomes: Record<string, any> = {
        optimizer: this.outcomeCalculator.calculateOutcome(
          optimizerLineup,
          worldState,
          periodStart,
          periodEnd
        ),
      };
      
      for (const [name, lineup] of Object.entries(baselineLineups)) {
        actualOutcomes[name] = this.outcomeCalculator.calculateOutcome(
          lineup,
          worldState,
          periodStart,
          periodEnd
        );
      }
      
      // 6. Create simulation step
      const step: SimulationStep = {
        date: worldState.date,
        week: worldState.week,
        worldState,
        optimizerLineup,
        optimizerDecisions,
        baselineLineups,
        actualOutcomes,
      };
      
      steps.push(step);
      
      // Store baseline results
      for (const baseline of this.config.baselines) {
        baselineSteps.get(baseline.name)!.push({
          ...step,
          optimizerLineup: baselineLineups[baseline.name],
          optimizerDecisions: [],
        });
      }
    }
    
    console.log(`[Simulator] Completed ${steps.length} simulation steps`);
    
    // Calculate metrics
    const metricsCalculator = new MetricsCalculator(steps, baselineSteps);
    const metrics = metricsCalculator.calculateAllMetrics();
    
    // Generate report
    const reportGenerator = new ReportGenerator(this.config.season, steps, metrics);
    const report = reportGenerator.generateReport();
    
    // Check against golden baseline
    const goldenManager = new GoldenBaselineManager();
    const golden = goldenManager.saveGoldenBaseline(
      this.config.season,
      steps,
      metrics
    );
    
    return {
      steps,
      metrics,
      report,
      golden,
    };
  }
  
  /**
   * Compute full intelligence stack for all players
   */
  private async computeIntelligence(
    worldState: WorldState
  ): Promise<PlayerWithIntelligence[]> {
    const players: PlayerWithIntelligence[] = [];
    
    for (const player of worldState.roster.players) {
      // 1. Get derived features from game logs
      const gameLogs = worldState.gameLogs.get(player.playerId) || [];
      
      // 2. Compute score
      let score: PlayerScore | PitcherScore;
      
      if (player.domain === 'hitting') {
        // Build minimal PlayerScore from available data
        score = this.buildHitterScore(player, gameLogs);
      } else {
        score = this.buildPitcherScore(player, gameLogs);
      }
      
      // 3. Compute momentum
      const z14 = (score.overallValue - 50) / 10; // Approximate
      const z30 = z14 - 0.2; // Slight decay
      const momentum = calculateMomentum(z14, z30, 12, 25);
      
      // 4. Run Monte Carlo
      const probabilistic = simulatePlayerOutcomes(score, {
        simulations: 200, // Faster for backtesting
      });
      
      // 5. Build full player intelligence
      const playerWithIntelligence: PlayerWithIntelligence = {
        playerId: player.playerId,
        playerMlbamId: player.playerMlbamId,
        name: player.name,
        positions: player.positions,
        domain: player.domain,
        score,
        momentum,
        probabilistic,
        gamesThisWeek: this.estimateGamesThisWeek(player.playerId, worldState),
        isInjured: worldState.injuries.get(player.playerId)?.isInjured || false,
        injuryStatus: worldState.injuries.get(player.playerId)?.injuryType || null,
      };
      
      players.push(playerWithIntelligence);
    }
    
    return players;
  }
  
  /**
   * Build hitter score from game logs
   */
  private buildHitterScore(
    player: HistoricalPlayer,
    games: any[]
  ): PlayerScore {
    // Aggregate stats
    const totalPA = games.reduce((sum, g) => sum + (g.plateAppearances || 0), 0);
    const totalHits = games.reduce((sum, g) => sum + (g.hits || 0), 0);
    const totalAB = games.reduce((sum, g) => sum + (g.atBats || 0), 0);
    const totalTB = games.reduce((sum, g) => sum + (g.totalBases || 0), 0);
    
    const avg = totalAB > 0 ? totalHits / totalAB : 0;
    const slg = totalAB > 0 ? totalTB / totalAB : 0;
    const ops = avg + slg; // Simplified
    
    // Convert to 0-100 score
    const overallValue = Math.min(100, Math.max(0, 50 + (ops - 0.75) * 100));
    
    return {
      playerId: player.playerId,
      playerMlbamId: player.playerMlbamId,
      season: 2025,
      scoredAt: new Date(),
      overallValue,
      components: {
        hitting: overallValue - 5,
        power: overallValue - 3,
        speed: 55,
        plateDiscipline: 60,
        consistency: 65,
        opportunity: 70,
      },
      confidence: totalPA > 100 ? 0.9 : totalPA > 50 ? 0.75 : 0.6,
      reliability: {
        sampleSize: totalPA > 100 ? 'large' : totalPA > 50 ? 'adequate' : 'small',
        gamesToReliable: Math.max(0, 100 - totalPA),
        statsReliable: totalPA > 80,
      },
      explanation: {
        summary: 'Backtest score',
        strengths: [],
        concerns: [],
        keyStats: {},
      },
      inputs: {
        derivedFeaturesVersion: 'v1',
        computedAt: new Date(),
      },
    };
  }
  
  /**
   * Build pitcher score from game logs
   */
  private buildPitcherScore(
    player: HistoricalPlayer,
    games: any[]
  ): PitcherScore {
    // Simplified - would compute actual pitching stats
    const overallValue = 60;
    
    return {
      playerId: player.playerId,
      playerMlbamId: player.playerMlbamId,
      season: 2025,
      scoredAt: new Date(),
      domain: 'pitching',
      overallValue,
      components: {
        command: 60,
        stuff: 60,
        results: 60,
        workload: 60,
        consistency: 60,
        matchup: 50,
      },
      role: {
        currentRole: 'SP',
        isCloser: false,
        holdsEligible: false,
        expectedInningsPerWeek: 12,
        startProbabilityNext7: 0.8,
      },
      confidence: 0.7,
      reliability: {
        sampleSize: 'adequate',
        battersToReliable: 0,
        statsReliable: true,
      },
      explanation: {
        summary: 'Backtest pitcher score',
        strengths: [],
        concerns: [],
        keyStats: {},
      },
      inputs: {
        derivedFeaturesVersion: 'v1',
        computedAt: new Date(),
      },
    };
  }
  
  /**
   * Convert WorldState to TeamState
   */
  private convertToTeamState(worldState: WorldState): TeamState {
    return {
      teamId: worldState.roster.teamId,
      leagueId: this.config.leagueId,
      lastUpdated: worldState.date,
      roster: {
        players: worldState.roster.players.map(p => ({
          playerId: p.playerId,
          mlbamId: p.playerMlbamId,
          name: p.name,
          team: 'UNK',
          positions: p.positions,
          lineupStatus: 'available',
          isInjured: worldState.injuries.get(p.playerId)?.isInjured || false,
          injuryStatus: worldState.injuries.get(p.playerId)?.isInjured ? 'day_to_day' : null,
        })),
      },
      lineupConfig: worldState.roster.lineupConfig,
      currentLineup: {
        assignments: [],
        benchAssignments: [],
        locked: false,
      },
      waiverState: {
        budgetRemaining: worldState.roster.waiverBudget,
        budgetTotal: 100,
        claimsThisWeek: 0,
        maxClaimsPerWeek: 3,
        nextClaimResetsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      rosterAnalysis: {
        strengths: [],
        weaknesses: [],
        opportunities: [],
      },
    } as TeamState;
  }
  
  /**
   * Extract optimizer decisions
   */
  private extractDecisions(
    lineup: any,
    players: PlayerWithIntelligence[]
  ): OptimizerDecision[] {
    const decisions: OptimizerDecision[] = [];
    
    for (const [slot, assignment] of lineup.assignments) {
      const player = players.find(p => p.playerId === assignment.playerId);
      
      decisions.push({
        slot,
        playerId: assignment.playerId,
        playerName: assignment.name,
        action: 'start',
        reasoning: assignment.reasoning || `Best objective for ${slot}`,
        confidence: player?.score?.confidence || 0.5,
      });
    }
    
    return decisions;
  }
  
  /**
   * Estimate games this week
   */
  private estimateGamesThisWeek(playerId: string, worldState: WorldState): number {
    const games = worldState.gameLogs.get(playerId) || [];
    const recentGames = games.filter(g => {
      const gameDate = new Date(g.date);
      const daysAgo = (new Date(worldState.date).getTime() - gameDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo <= 7;
    });
    return recentGames.length;
  }
}

// ============================================================================
// Quick Run Function
// ============================================================================

export async function runBacktest(
  worldStates: WorldState[],
  config: Partial<SimulatorConfig> = {}
) {
  const fullConfig: SimulatorConfig = {
    season: 2025,
    teamId: 'test-team',
    leagueId: 'test-league',
    weeklyMode: true,
    baselines: [],
    verbose: true,
    ...config,
  };
  
  const simulator = new BacktestSimulator(fullConfig);
  return simulator.runSimulation(worldStates);
}
