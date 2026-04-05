/**
 * Balldontlie GOAT Adapter
 * 
 * Primary data source with native support for:
 * - Game logs (no parsing required)
 * - Player splits (contextual performance)
 * - Daily lineups (real-time)
 */

import { createHash } from 'crypto';
import type { 
  MLBDataProvider, 
  ProviderHealth, 
  DataSourceResult,
  PlayerGameLog,
  SeasonStats,
  DailyLineup,
  PlayerSplits,
  PlayerSplit
} from './interface.js';
import { ProviderError } from './interface.js';
import { TokenBucket } from './rate-limiter.js';
import type { Cache } from './cache.js';
import { defaultCache } from './cache.js';

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface BalldontlieConfig {
  apiKey: string;
  redisUrl?: string;
  cache?: Cache;
}

export class BalldontlieProvider implements MLBDataProvider {
  readonly name = 'balldontlie';
  readonly version = 'goat-tier';
  
  private apiKey: string;
  private baseUrl = 'https://api.balldontlie.io/mlb/v1';
  private rateLimiter: TokenBucket;
  private cache: Cache;

  constructor(config: BalldontlieConfig) {
    this.apiKey = config.apiKey;
    // More conservative: 600 req/min = 10/sec, use 5/sec to be safe
    this.rateLimiter = new TokenBucket({ capacity: 300, refillRate: 5 });
    this.cache = config.cache || defaultCache;
  }

  // ==========================================================================
  // Core: Game Logs (The Foundation of Your Pipeline)
  // ==========================================================================
  
  async getGameLogs(
    playerId: string,
    options: { season: number; startDate?: Date; endDate?: Date }
  ): Promise<DataSourceResult<PlayerGameLog[]>> {
    // Include date range in cache key if specified
    const dateRangeKey = options.startDate || options.endDate 
      ? `:${options.startDate?.toISOString().split('T')[0] || 'start'}_${options.endDate?.toISOString().split('T')[0] || 'end'}`
      : '';
    const cacheKey = `balldontlie:gamelogs:${playerId}:${options.season}${dateRangeKey}`;
    
    // Check cache
    const cached = await this.cache.get<PlayerGameLog[]>(cacheKey);
    if (cached) {
      return {
        data: cached,
        source: this.name,
        fetchedAt: new Date(),
        cacheKey,
        confidence: 'high'
      };
    }

    // Rate limit check
    await this.rateLimiter.consume(1);

    // Build request
    const params = new URLSearchParams({
      player_id: playerId,
      season: options.season.toString(),
      per_page: '100'
    });

    const url = `${this.baseUrl}/stats?${params}`;
    
    try {
      const response = await this.fetchWithRetry(url, {
        headers: { 'Authorization': this.apiKey }
      });

      if (!response.ok) {
        throw new ProviderError(`Balldontlie stats failed: ${response.status} - ${await response.text()}`);
      }

      const data: any = await response.json();
      
      // Get game dates for these stats
      const gameIds: number[] = [...new Set<number>((data.data || []).map((s: any) => s.game_id).filter((x: any) => x != null))];
      const gameDateMap = await this.fetchGameDates(gameIds);
      
      // Transform to canonical PlayerGameLog format
      const gameLogs: PlayerGameLog[] = (data.data || []).map((log: any) => 
        this.transformGameLog(log, playerId, gameDateMap)
      );

      // Filter by date range if specified
      const filtered = gameLogs.filter(log => {
        if (options.startDate && log.gameDate < options.startDate) return false;
        if (options.endDate && log.gameDate > options.endDate) return false;
        return true;
      });

      // Cache (game logs don't change, long TTL)
      await this.cache.set(cacheKey, filtered, 60 * 60 * 24); // 24 hours

      return {
        data: filtered,
        source: this.name,
        fetchedAt: new Date(),
        cacheKey,
        confidence: 'high'
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Failed to fetch game logs: ${error}`, error);
    }
  }

  private async fetchGameDates(gameIds: number[]): Promise<Map<string, Date>> {
    const dateMap = new Map<string, Date>();
    
    // Get unique game IDs
    const uniqueIds = [...new Set(gameIds)];
    
    // Fetch each game's details (respecting rate limits)
    for (const gameId of uniqueIds.slice(0, 50)) { // Limit to prevent abuse
      try {
        await this.rateLimiter.consume(1);
        
        // Use the specific game endpoint: /mlb/v1/games/{id}
        const response = await this.fetchWithRetry(
          `${this.baseUrl}/games/${gameId}`,
          { headers: { 'Authorization': this.apiKey } }
        );
        
        if (response.ok) {
          const data: any = await response.json();
          const game = data.data;
          if (game?.date) {
            dateMap.set(gameId.toString(), new Date(game.date));
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch game date for ${gameId}:`, error);
      }
    }
    
    return dateMap;
  }

  private transformGameLog(log: any, playerId: string, gameDateMap: Map<string, Date>): PlayerGameLog {
    // Map field names from balldontlie format to our format
    const atBats = log.at_bats || 0;
    const hits = log.hits || 0;
    const doubles = log.doubles || 0;
    const triples = log.triples || 0;
    const homeRuns = log.hr || 0;
    const walks = log.bb || 0;
    const strikeouts = log.k || 0;
    const hitByPitch = log.hit_by_pitch || 0;
    const sacrificeFlies = log.sac_flies || 0;
    const stolenBases = log.stolen_bases || 0;
    const caughtStealing = log.caught_stealing || 0;
    const rbi = log.rbi || 0;
    const runs = log.runs || 0;
    
    // Calculate singles for total bases
    const singles = hits - doubles - triples - homeRuns;
    
    // Get game date from map
    const gameId = log.game_id?.toString() || 'unknown';
    const gameDate = gameDateMap.get(gameId) || new Date('2025-01-01'); // Fallback
    
    return {
      id: `gamelog-${playerId}-${gameId}`,
      playerId,
      playerMlbamId: playerId,
      season: gameDate.getFullYear(),
      gameDate,
      gamePk: gameId,
      homeTeamId: '', // Not provided in stats endpoint
      awayTeamId: '', // Not provided in stats endpoint
      isHomeGame: false, // Not provided in stats endpoint
      teamId: '', // Not provided as ID in stats endpoint
      teamMlbamId: '', // Not provided in stats endpoint
      opponentId: '', // Not provided in stats endpoint
      position: log.player?.position,
      
      gamesPlayed: 1,
      atBats,
      runs,
      hits,
      doubles,
      triples,
      homeRuns,
      rbi,
      stolenBases,
      caughtStealing,
      walks,
      strikeouts,
      hitByPitch,
      sacrificeFlies,
      
      plateAppearances: log.plate_appearances || atBats + walks + hitByPitch + sacrificeFlies,
      totalBases: singles + (2 * doubles) + (3 * triples) + (4 * homeRuns),
      
      rawDataSource: this.name,
      ingestedAt: new Date(),
    };
  }

  // ==========================================================================
  // Season Stats
  // ==========================================================================
  
  async getSeasonStats(
    playerId: string,
    season: number
  ): Promise<DataSourceResult<SeasonStats>> {
    // Use game logs to compute season stats (more reliable than separate endpoint)
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
      ...totals,
      battingAverage: totals.atBats > 0 ? totals.hits / totals.atBats : 0,
      ops: 0, // Would need OBP + SLG calculation
    };

    return {
      data: seasonStats,
      source: this.name,
      fetchedAt: new Date(),
      cacheKey: gameLogsResult.cacheKey,
      confidence: 'high'
    };
  }

  // ==========================================================================
  // Daily Lineups (Real-Time Context)
  // ==========================================================================
  
  async getDailyLineups(date: Date): Promise<DataSourceResult<DailyLineup[]>> {
    const dateStr = date.toISOString().split('T')[0];
    const cacheKey = `balldontlie:lineups:${dateStr}`;
    
    // Short cache for live data
    const cached = await this.cache.get<DailyLineup[]>(cacheKey);
    if (cached) {
      return {
        data: cached,
        source: this.name,
        fetchedAt: new Date(),
        cacheKey,
        confidence: 'high'
      };
    }

    await this.rateLimiter.consume(1);

    try {
      const response = await fetch(
        `${this.baseUrl}/lineups?date=${dateStr}`,
        { headers: { 'Authorization': this.apiKey } }
      );

      if (!response.ok) {
        throw new ProviderError(`Balldontlie lineups failed: ${response.status}`);
      }

      const data: any = await response.json();
      
      const lineups: DailyLineup[] = (data.data || []).flatMap((game: any) => {
        const homeTeamId = game.home_team_id?.toString();
        const awayTeamId = game.visitor_team_id?.toString();
        
        return (game.lineups || []).flatMap((lineup: any) => 
          (lineup.players || []).map((player: any) => ({
            playerId: player.player_id?.toString() || '',
            playerMlbamId: player.player_id?.toString() || '',
            gameDate: date,
            isInStartingLineup: true,
            battingOrder: player.batting_order,
            position: player.position,
            opponentTeamId: lineup.team_id?.toString() === homeTeamId ? awayTeamId : homeTeamId,
            isHomeGame: lineup.team_id?.toString() === homeTeamId,
          }))
        );
      });

      // Short cache for live lineups
      await this.cache.set(cacheKey, lineups, 120); // 2 minutes

      return {
        data: lineups,
        source: this.name,
        fetchedAt: new Date(),
        cacheKey,
        confidence: 'high'
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Failed to fetch lineups: ${error}`, error);
    }
  }

  // ==========================================================================
  // Player Splits (Contextual Data)
  // ==========================================================================
  
  async getPlayerSplits(
    playerId: string,
    season: number
  ): Promise<DataSourceResult<PlayerSplits>> {
    const cacheKey = `balldontlie:splits:${playerId}:${season}`;
    
    const cached = await this.cache.get<PlayerSplits>(cacheKey);
    if (cached) {
      return {
        data: cached,
        source: this.name,
        fetchedAt: new Date(),
        cacheKey,
        confidence: 'high'
      };
    }

    await this.rateLimiter.consume(1);

    try {
      const response = await fetch(
        `${this.baseUrl}/players/splits?player_id=${playerId}&season=${season}`,
        { headers: { 'Authorization': this.apiKey } }
      );

      if (!response.ok) {
        throw new ProviderError(`Balldontlie splits failed: ${response.status}`);
      }

      const data: any = await response.json();
      
      // Transform splits into standardized format
      // The API returns: { split: [...], byDayMonth: [...], byOpponent: [...] }
      const splits: PlayerSplits = {
        playerId,
        season,
        byHomeAway: this.extractSplits(data.data, 'split'),  // Contains home/away
        byHandedness: this.extractSplits(data.data, 'split'), // Contains vs LHP/RHP
        byMonth: this.extractSplits(data.data, 'byDayMonth'),
      };

      // Cache splits (change slowly)
      await this.cache.set(cacheKey, splits, 60 * 60 * 6); // 6 hours

      return {
        data: splits,
        source: this.name,
        fetchedAt: new Date(),
        cacheKey,
        confidence: 'high'
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`Failed to fetch splits: ${error}`, error);
    }
  }

  private extractSplits(data: any, splitCategory: string): PlayerSplit[] {
    if (!data || typeof data !== 'object') return [];
    
    // The API returns splits grouped by category
    // e.g., data = { split: [...], byDayMonth: [...], byOpponent: [...] }
    const categoryData = data[splitCategory];
    if (!Array.isArray(categoryData)) return [];
    
    return categoryData.map((s: any) => ({
      splitType: s.split_category || splitCategory,
      splitValue: s.split_name || s.split_abbreviation || '',
      gamesPlayed: s.games_played || 0,
      plateAppearances: 0, // Not in the schema
      atBats: s.at_bats || 0,
      hits: s.hits || 0,
      homeRuns: s.home_runs || 0,
      battingAverage: s.avg ? parseFloat(s.avg) : undefined,
      ops: s.ops ? parseFloat(s.ops) : undefined,
    }));
  }

  // ==========================================================================
  // Retry Logic for Rate Limits
  // ==========================================================================
  
  private async fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        
        // If rate limited, wait and retry
        if (response.status === 429) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`Rate limited, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`);
          await sleep(delay);
          continue;
        }
        
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          await sleep(1000);
        }
      }
    }
    
    throw lastError || new Error('Max retries exceeded');
  }
  
  async getProviderStatus(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Lightweight health check - just check rate limit headers
      const response = await fetch(`${this.baseUrl}/games?per_page=1`, {
        headers: { 'Authorization': this.apiKey }
      });
      
      const latency = Date.now() - start;
      
      return {
        status: response.ok ? 'healthy' : 'degraded',
        latencyMs: latency,
        rateLimitRemaining: parseInt(response.headers.get('X-RateLimit-Remaining') || '0'),
        lastSuccessfulFetch: new Date()
      };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        lastSuccessfulFetch: new Date(0)
      };
    }
  }
}
