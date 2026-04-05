/**
 * Database-backed Game Log Provider
 * 
 * Implements MLBDataProvider interface but reads from the database
 * instead of external APIs. This ensures the computation layer uses
 * the canonical data stored in the system.
 */

import type { MLBDataProvider, PlayerGameLog, DataSourceResult, SeasonStats, PlayerSplits, DailyLineup, ProviderHealth } from './interface.js';

// Generic Prisma client interface to avoid direct dependency
interface PrismaClient {
  playerGameLog: {
    findMany(args: { where: any; orderBy?: any }): Promise<any[]>;
  };
  $queryRaw(strings: TemplateStringsArray): Promise<any>;
}

export class DatabaseGameLogProvider implements MLBDataProvider {
  readonly name = 'database';
  readonly version = '1.0.0';

  constructor(private prisma: PrismaClient) {}

  async getGameLogs(
    playerId: string,
    options: { season: number; startDate?: Date; endDate?: Date }
  ): Promise<DataSourceResult<PlayerGameLog[]>> {
    const where: any = {
      playerMlbamId: playerId,
      season: options.season
    };

    if (options.startDate || options.endDate) {
      where.gameDate = {};
      if (options.startDate) {
        where.gameDate.gte = options.startDate;
      }
      if (options.endDate) {
        where.gameDate.lte = options.endDate;
      }
    }

    const logs = await this.prisma.playerGameLog.findMany({
      where,
      orderBy: { gameDate: 'desc' }
    });

    // Transform database records to PlayerGameLog interface
    const gameLogs: PlayerGameLog[] = logs.map((log: any) => ({
      id: log.id,
      playerId: log.playerId,
      playerMlbamId: log.playerMlbamId,
      season: log.season,
      gameDate: log.gameDate,
      gamePk: log.gamePk,
      homeTeamId: log.homeTeamId,
      awayTeamId: log.awayTeamId,
      isHomeGame: log.isHomeGame,
      teamId: log.teamId,
      teamMlbamId: log.teamMlbamId,
      opponentId: log.opponentId,
      position: log.position || undefined,
      gamesPlayed: log.gamesPlayed,
      atBats: log.atBats,
      runs: log.runs,
      hits: log.hits,
      doubles: log.doubles,
      triples: log.triples,
      homeRuns: log.homeRuns,
      rbi: log.rbi,
      stolenBases: log.stolenBases,
      caughtStealing: log.caughtStealing,
      walks: log.walks,
      strikeouts: log.strikeouts,
      hitByPitch: log.hitByPitch,
      sacrificeFlies: log.sacrificeFlies,
      plateAppearances: log.plateAppearances,
      totalBases: log.totalBases,
      rawDataSource: log.rawDataSource,
      ingestedAt: log.ingestedAt
    }));

    return {
      data: gameLogs,
      source: this.name,
      fetchedAt: new Date(),
      cacheKey: `db:gamelogs:${playerId}:${options.season}`,
      confidence: 'high'
    };
  }

  async getSeasonStats(
    playerId: string,
    season: number
  ): Promise<DataSourceResult<SeasonStats>> {
    // Use game logs to compute season stats
    const gameLogsResult = await this.getGameLogs(playerId, { season });
    const logs = gameLogsResult.data;
    
    const totals = logs.reduce((acc, log) => ({
      gamesPlayed: acc.gamesPlayed + 1,
      atBats: acc.atBats + log.atBats,
      hits: acc.hits + log.hits,
      homeRuns: acc.homeRuns + log.homeRuns,
      rbi: acc.rbi + log.rbi,
    }), { gamesPlayed: 0, atBats: 0, hits: 0, homeRuns: 0, rbi: 0 });

    const seasonStats: SeasonStats = {
      playerId,
      playerMlbamId: playerId,
      season,
      gamesPlayed: totals.gamesPlayed,
      atBats: totals.atBats,
      hits: totals.hits,
      homeRuns: totals.homeRuns,
      rbi: totals.rbi,
      battingAverage: totals.atBats > 0 ? totals.hits / totals.atBats : 0,
      ops: 0 // Would need full OBP/SLG calculation
    };

    return {
      data: seasonStats,
      source: this.name,
      fetchedAt: new Date(),
      cacheKey: `db:season:${playerId}:${season}`,
      confidence: 'high'
    };
  }

  async getDailyLineups(date: Date): Promise<DataSourceResult<DailyLineup[]>> {
    // Not implemented for database provider
    return {
      data: [],
      source: this.name,
      fetchedAt: new Date(),
      cacheKey: `db:lineups:${date.toISOString()}`,
      confidence: 'low'
    };
  }

  async getPlayerSplits(
    playerId: string,
    season: number
  ): Promise<DataSourceResult<PlayerSplits>> {
    // Not implemented for database provider
    return {
      data: {
        playerId,
        season,
        byHomeAway: [],
        byHandedness: [],
        byMonth: []
      },
      source: this.name,
      fetchedAt: new Date(),
      cacheKey: `db:splits:${playerId}:${season}`,
      confidence: 'low'
    };
  }

  async getProviderStatus(): Promise<ProviderHealth> {
    // Check database connectivity
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return {
        status: 'healthy',
        latencyMs: latency,
        lastSuccessfulFetch: new Date()
      };
    } catch {
      return {
        status: 'down',
        latencyMs: 0,
        lastSuccessfulFetch: new Date(0)
      };
    }
  }
}
