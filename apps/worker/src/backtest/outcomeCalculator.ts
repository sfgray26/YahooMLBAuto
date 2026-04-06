/**
 * Fantasy Outcome Calculator
 *
 * Computes actual fantasy results from historical game logs
 * for a given lineup.
 */

import type {
  WorldState,
  OptimizedLineup,
  FantasyOutcome,
  CategoryStats,
  PlayerFantasyOutcome,
  HistoricalGame,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

interface ScoringConfig {
  format: 'points' | 'roto' | 'categories';
  pointsPerStat: Record<string, number>;
  categories: string[];
}

const DEFAULT_POINTS_CONFIG: ScoringConfig = {
  format: 'points',
  pointsPerStat: {
    run: 1,
    hit: 1,
    double: 2,
    triple: 3,
    homeRun: 4,
    rbi: 1,
    stolenBase: 2,
    caughtStealing: -1,
    walk: 1,
    strikeout: -0.5,
    win: 5,
    save: 5,
    qualityStart: 3,
    strikeoutPitched: 1,
    inningPitched: 1,
    earnedRun: -2,
    hitAllowed: -0.5,
    walkAllowed: -0.5,
  },
  categories: [],
};

// ============================================================================
// Main Calculator
// ============================================================================

export class FantasyOutcomeCalculator {
  private config: ScoringConfig;
  
  constructor(config: Partial<ScoringConfig> = {}) {
    this.config = { ...DEFAULT_POINTS_CONFIG, ...config };
  }
  
  /**
   * Calculate fantasy outcome for a lineup
   */
  calculateOutcome(
    lineup: OptimizedLineup,
    worldState: WorldState,
    periodStart: Date,
    periodEnd: Date
  ): FantasyOutcome {
    const playerOutcomes: PlayerFantasyOutcome[] = [];
    
    // Calculate for each starter
    for (const [, assignment] of lineup.assignments) {
      const games = this.getGamesInPeriod(
        assignment.playerId,
        worldState,
        periodStart,
        periodEnd
      );
      
      const outcome = this.calculatePlayerOutcome(
        assignment.playerId,
        assignment.name,
        games
      );
      
      playerOutcomes.push(outcome);
    }
    
    // Aggregate
    const totalPoints = playerOutcomes.reduce(
      (sum, p) => sum + p.fantasyPoints,
      0
    );
    
    const categoryStats = this.aggregateCategoryStats(playerOutcomes);
    
    return {
      totalPoints,
      categoryStats,
      playerOutcomes,
      vsBaseline: {},  // Filled by comparison layer
    };
  }
  
  /**
   * Get games for a player in a date range
   */
  private getGamesInPeriod(
    playerId: string,
    worldState: WorldState,
    start: Date,
    end: Date
  ): HistoricalGame[] {
    const allGames = worldState.gameLogs.get(playerId) || [];
    
    return allGames.filter(g => {
      const gameDate = new Date(g.date);
      return gameDate >= start && gameDate <= end;
    });
  }
  
  /**
   * Calculate fantasy outcome for a single player
   */
  private calculatePlayerOutcome(
    playerId: string,
    playerName: string,
    games: HistoricalGame[]
  ): PlayerFantasyOutcome {
    let fantasyPoints = 0;
    const categoryContributions: Partial<CategoryStats> = {
      runs: 0,
      homeRuns: 0,
      rbi: 0,
      stolenBases: 0,
      hits: 0,
      atBats: 0,
      wins: 0,
      saves: 0,
      strikeouts: 0,
      earnedRuns: 0,
      inningsPitched: 0,
    };
    
    for (const game of games) {
      // Batting points
      fantasyPoints += game.runs * this.config.pointsPerStat.run;
      fantasyPoints += game.hits * this.config.pointsPerStat.hit;
      fantasyPoints += game.doubles * this.config.pointsPerStat.double;
      fantasyPoints += game.triples * this.config.pointsPerStat.triple;
      fantasyPoints += game.homeRuns * this.config.pointsPerStat.homeRun;
      fantasyPoints += game.rbi * this.config.pointsPerStat.rbi;
      fantasyPoints += game.stolenBases * this.config.pointsPerStat.stolenBase;
      fantasyPoints += game.walks * this.config.pointsPerStat.walk;
      fantasyPoints += game.strikeouts * this.config.pointsPerStat.strikeout;
      
      // Category accumulation
      categoryContributions.runs! += game.runs;
      categoryContributions.homeRuns! += game.homeRuns;
      categoryContributions.rbi! += game.rbi;
      categoryContributions.stolenBases! += game.stolenBases;
      categoryContributions.hits! += game.hits;
      categoryContributions.atBats! += game.atBats;
      
      // Pitching (if applicable)
      fantasyPoints += game.wins * this.config.pointsPerStat.win;
      fantasyPoints += game.saves * this.config.pointsPerStat.save;
      fantasyPoints += game.strikeoutsPitched * this.config.pointsPerStat.strikeoutPitched;
      fantasyPoints += game.inningsPitched * this.config.pointsPerStat.inningPitched;
      fantasyPoints += game.earnedRuns * this.config.pointsPerStat.earnedRun;
      
      categoryContributions.wins! += game.wins;
      categoryContributions.saves! += game.saves;
      categoryContributions.strikeouts! += game.strikeoutsPitched;
      categoryContributions.earnedRuns! += game.earnedRuns;
      categoryContributions.inningsPitched! += game.inningsPitched;
    }
    
    // Calculate rate stats
    if (categoryContributions.atBats! > 0) {
      categoryContributions.battingAverage = 
        categoryContributions.hits! / categoryContributions.atBats!;
    }
    
    if (categoryContributions.inningsPitched! > 0) {
      categoryContributions.era = 
        (categoryContributions.earnedRuns! * 9) / categoryContributions.inningsPitched!;
    }
    
    return {
      playerId,
      playerName,
      gamesPlayed: games.length,
      fantasyPoints,
      categoryContributions,
    };
  }
  
  /**
   * Aggregate category stats across all players
   */
  private aggregateCategoryStats(
    playerOutcomes: PlayerFantasyOutcome[]
  ): CategoryStats {
    const totals: Partial<CategoryStats> = {
      runs: 0,
      homeRuns: 0,
      rbi: 0,
      stolenBases: 0,
      battingAverage: 0,
      onBasePercentage: 0,
      sluggingPercentage: 0,
      ops: 0,
      wins: 0,
      saves: 0,
      strikeouts: 0,
      era: 0,
      whip: 0,
      kPerNine: 0,
      qualityStarts: 0,
    };
    
    let totalHits = 0;
    let totalAtBats = 0;
    let totalEarnedRuns = 0;
    let totalInnings = 0;
    
    for (const player of playerOutcomes) {
      const cats = player.categoryContributions;
      totals.runs! += cats.runs || 0;
      totals.homeRuns! += cats.homeRuns || 0;
      totals.rbi! += cats.rbi || 0;
      totals.stolenBases! += cats.stolenBases || 0;
      totals.wins! += cats.wins || 0;
      totals.saves! += cats.saves || 0;
      totals.strikeouts! += cats.strikeouts || 0;
      totals.qualityStarts! += cats.qualityStarts || 0;
      
      totalHits += cats.hits || 0;
      totalAtBats += cats.atBats || 0;
      totalEarnedRuns += cats.earnedRuns || 0;
      totalInnings += cats.inningsPitched || 0;
    }
    
    // Calculate rate stats
    if (totalAtBats > 0) {
      totals.battingAverage = totalHits / totalAtBats;
    }
    
    if (totalInnings > 0) {
      totals.era = (totalEarnedRuns * 9) / totalInnings;
    }
    
    return totals as CategoryStats;
  }
  
  /**
   * Compare two outcomes
   */
  compareOutcomes(
    optimizer: FantasyOutcome,
    baseline: FantasyOutcome
  ): { delta: number; winner: 'optimizer' | 'baseline' | 'tie' } {
    const delta = optimizer.totalPoints - baseline.totalPoints;
    
    let winner: 'optimizer' | 'baseline' | 'tie';
    if (delta > 0.1) winner = 'optimizer';
    else if (delta < -0.1) winner = 'baseline';
    else winner = 'tie';
    
    return { delta, winner };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick calculate function
 */
export function calculateFantasyOutcome(
  lineup: OptimizedLineup,
  worldState: WorldState,
  periodStart: Date,
  periodEnd: Date
): FantasyOutcome {
  const calculator = new FantasyOutcomeCalculator();
  return calculator.calculateOutcome(lineup, worldState, periodStart, periodEnd);
}
