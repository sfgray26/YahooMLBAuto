/**
 * Deterministic Derived Feature Computation
 * 
 * Computes derived features using the MLBDataProvider interface.
 * Works with any provider (balldontlie, MLB Stats API, etc.)
 */

import type { MLBDataProvider, PlayerGameLog } from '../providers/interface.js';

export interface RollingWindowFeatures {
  // Player identification
  playerMlbamId: string;
  season: number;
  computedDate: Date;
  
  // Volume
  gamesLast7: number;
  gamesLast14: number;
  gamesLast30: number;
  plateAppearancesLast7: number;
  plateAppearancesLast14: number;
  plateAppearancesLast30: number;
  atBatsLast30: number;

  // Rates (30-day is most reliable)
  battingAverageLast7: number | null;
  battingAverageLast14: number | null;
  battingAverageLast30: number | null;
  onBasePctLast30: number | null;
  sluggingPctLast30: number | null;
  opsLast30: number | null;
  isoLast30: number | null;
  walkRateLast30: number | null;
  strikeoutRateLast30: number | null;

  // Reliability scoring
  battingAverageReliable: boolean;
  gamesToReliable: number;

  // Volatility metrics
  productionVolatility: number;
  zeroHitGamesLast14: number;
  multiHitGamesLast14: number;
}

export class DerivedFeatureComputer {
  constructor(private provider: MLBDataProvider) {}

  /**
   * Compute features for a specific player as of a specific date
   * Deterministic: Same inputs always produce same outputs
   */
  async computePlayerFeatures(
    playerMlbamId: string,
    season: number,
    asOfDate: Date
  ): Promise<RollingWindowFeatures | null> {
    // Fetch game logs from provider
    const result = await this.provider.getGameLogs(playerMlbamId, {
      season,
      endDate: asOfDate // Only games BEFORE the computation date
    });

    const gameLogs = result.data;

    if (gameLogs.length === 0) {
      return null;
    }

    // Sort by date descending (most recent first)
    const sorted = [...gameLogs].sort(
      (a, b) => b.gameDate.getTime() - a.gameDate.getTime()
    );

    // Calculate date boundaries
    const sevenDaysAgo = new Date(asOfDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(asOfDate.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(asOfDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Filter games into windows
    const last7Games = sorted.filter(g => g.gameDate >= sevenDaysAgo);
    const last14Games = sorted.filter(g => g.gameDate >= fourteenDaysAgo);
    const last30Games = sorted.filter(g => g.gameDate >= thirtyDaysAgo);

    // Compute aggregations for each window
    const w7 = this.aggregateGames(last7Games);
    const w14 = this.aggregateGames(last14Games);
    const w30 = this.aggregateGames(last30Games);

    // Reliability threshold: 100 PA for batting average stabilization
    const RELIABLE_PA_THRESHOLD = 100;
    const gamesToReliable = Math.max(
      0,
      Math.ceil(
        (RELIABLE_PA_THRESHOLD - w30.plateAppearances) /
          (w30.plateAppearances / w30.games || 5)
      )
    );

    // Calculate volatility (coefficient of variation)
    const productionVolatility = this.calculateVolatility(w7, w30);

    return {
      playerMlbamId,
      season,
      computedDate: asOfDate,

      // Volume
      gamesLast7: w7.games,
      gamesLast14: w14.games,
      gamesLast30: w30.games,
      plateAppearancesLast7: w7.plateAppearances,
      plateAppearancesLast14: w14.plateAppearances,
      plateAppearancesLast30: w30.plateAppearances,
      atBatsLast30: w30.atBats,

      // Rates
      battingAverageLast7: w7.atBats > 0 ? w7.hits / w7.atBats : null,
      battingAverageLast14: w14.atBats > 0 ? w14.hits / w14.atBats : null,
      battingAverageLast30: w30.atBats > 0 ? w30.hits / w30.atBats : null,
      onBasePctLast30: this.calculateOBP(w30),
      sluggingPctLast30: w30.atBats > 0 ? w30.totalBases / w30.atBats : null,
      opsLast30: this.calculateOPS(w30),
      isoLast30: this.calculateISO(w30),
      walkRateLast30:
        w30.plateAppearances > 0 ? w30.walks / w30.plateAppearances : null,
      strikeoutRateLast30:
        w30.plateAppearances > 0 ? w30.strikeouts / w30.plateAppearances : null,

      // Reliability
      battingAverageReliable: w30.plateAppearances >= RELIABLE_PA_THRESHOLD,
      gamesToReliable,

      // Volatility
      productionVolatility,
      zeroHitGamesLast14: w14.zeroHitGames,
      multiHitGamesLast14: w14.multiHitGames,
    };
  }

  private aggregateGames(games: PlayerGameLog[]) {
    return games.reduce(
      (acc, g) => ({
        games: acc.games + 1,
        atBats: acc.atBats + g.atBats,
        hits: acc.hits + g.hits,
        doubles: acc.doubles + (g.doubles || 0),
        triples: acc.triples + (g.triples || 0),
        homeRuns: acc.homeRuns + g.homeRuns,
        walks: acc.walks + g.walks,
        strikeouts: acc.strikeouts + g.strikeouts,
        totalBases: acc.totalBases + g.totalBases,
        plateAppearances: acc.plateAppearances + g.plateAppearances,
        hitByPitch: acc.hitByPitch + (g.hitByPitch || 0),
        sacrificeFlies: acc.sacrificeFlies + (g.sacrificeFlies || 0),
        zeroHitGames: acc.zeroHitGames + (g.hits === 0 ? 1 : 0),
        multiHitGames: acc.multiHitGames + (g.hits >= 2 ? 1 : 0),
      }),
      {
        games: 0,
        atBats: 0,
        hits: 0,
        doubles: 0,
        triples: 0,
        homeRuns: 0,
        walks: 0,
        strikeouts: 0,
        totalBases: 0,
        plateAppearances: 0,
        hitByPitch: 0,
        sacrificeFlies: 0,
        zeroHitGames: 0,
        multiHitGames: 0,
      }
    );
  }

  private calculateOBP(stats: ReturnType<typeof this.aggregateGames>): number | null {
    const denominator = stats.atBats + stats.walks + stats.hitByPitch + stats.sacrificeFlies;
    return denominator > 0
      ? (stats.hits + stats.walks + stats.hitByPitch) / denominator
      : null;
  }

  private calculateSLG(stats: ReturnType<typeof this.aggregateGames>): number | null {
    return stats.atBats > 0 ? stats.totalBases / stats.atBats : null;
  }

  private calculateOPS(stats: ReturnType<typeof this.aggregateGames>): number | null {
    const obp = this.calculateOBP(stats);
    const slg = this.calculateSLG(stats);
    return obp !== null && slg !== null ? obp + slg : null;
  }

  private calculateISO(stats: ReturnType<typeof this.aggregateGames>): number | null {
    const avg = stats.atBats > 0 ? stats.hits / stats.atBats : null;
    const slg = this.calculateSLG(stats);
    return avg !== null && slg !== null ? slg - avg : null;
  }

  private calculateVolatility(
    w7: ReturnType<typeof this.aggregateGames>,
    w30: ReturnType<typeof this.aggregateGames>
  ): number {
    // Need minimum sample sizes
    if (w7.atBats < 20 || w30.atBats < 50) {
      return 0;
    }

    const avg7 = w7.hits / w7.atBats;
    const avg30 = w30.hits / w30.atBats;

    // Coefficient of variation relative to 30-day baseline
    return avg30 > 0 ? Math.abs(avg7 - avg30) / avg30 : 0;
  }

  /**
   * Batch compute for multiple players
   */
  async computeBatch(
    playerIds: string[],
    season: number,
    asOfDate: Date
  ): Promise<{
    results: RollingWindowFeatures[];
    errors: { playerId: string; error: string }[];
  }> {
    const results: RollingWindowFeatures[] = [];
    const errors: { playerId: string; error: string }[] = [];

    for (const playerId of playerIds) {
      try {
        const features = await this.computePlayerFeatures(playerId, season, asOfDate);
        if (features) {
          results.push(features);
        }
      } catch (error) {
        errors.push({
          playerId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { results, errors };
  }
}
