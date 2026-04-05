/**
 * MLB Data Provider Interface
 * 
 * The intelligence engine only knows about this interface.
 * Whether data comes from balldontlie, MLB Stats API, or carrier pigeons — 
 * the contracts are identical.
 */

export interface PlayerGameLog {
  id: string;
  playerId: string;
  playerMlbamId: string;
  season: number;
  gameDate: Date;
  gamePk: string;
  homeTeamId: string;
  awayTeamId: string;
  isHomeGame: boolean;
  teamId: string;
  teamMlbamId: string;
  opponentId: string;
  position?: string;
  
  // Stats
  gamesPlayed: number;
  atBats: number;
  runs: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  stolenBases: number;
  caughtStealing: number;
  walks: number;
  strikeouts: number;
  hitByPitch: number;
  sacrificeFlies: number;
  
  // Derived
  plateAppearances: number;
  totalBases: number;
  
  // Metadata
  rawDataSource: string;
  ingestedAt: Date;
  rawLogId?: string;
}

export interface SeasonStats {
  playerId: string;
  playerMlbamId: string;
  season: number;
  gamesPlayed: number;
  atBats: number;
  hits: number;
  homeRuns: number;
  rbi: number;
  battingAverage: number;
  ops: number;
}

export interface DailyLineup {
  playerId: string;
  playerMlbamId: string;
  gameDate: Date;
  isInStartingLineup: boolean;
  battingOrder?: number;
  position?: string;
  opponentTeamId?: string;
  opponentPitcherId?: string;
  isHomeGame?: boolean;
}

export interface PlayerSplit {
  splitType: string;
  splitValue: string;
  gamesPlayed: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  homeRuns: number;
  battingAverage?: number;
  ops?: number;
}

export interface PlayerSplits {
  playerId: string;
  season: number;
  byHomeAway: PlayerSplit[];
  byHandedness: PlayerSplit[];
  byMonth: PlayerSplit[];
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number;
  rateLimitRemaining?: number;
  lastSuccessfulFetch: Date;
}

export interface DataSourceResult<T> {
  data: T;
  source: string;
  fetchedAt: Date;
  cacheKey: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface MLBDataProvider {
  readonly name: string;
  readonly version: string;
  
  getGameLogs(
    playerId: string,
    options: {
      season: number;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<DataSourceResult<PlayerGameLog[]>>;

  getSeasonStats(
    playerId: string,
    season: number
  ): Promise<DataSourceResult<SeasonStats>>;

  getDailyLineups(date: Date): Promise<DataSourceResult<DailyLineup[]>>;

  getPlayerSplits(
    playerId: string,
    season: number
  ): Promise<DataSourceResult<PlayerSplits>>;

  getProviderStatus(): Promise<ProviderHealth>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
  }
}
