/**
 * Game Log Ingestion Module
 *
 * Fetches game-by-game stats from MLB Stats API
 * Stores in PlayerGameLog table for rolling 7/14/30 day calculations
 */

import { prisma } from '@cbb/infrastructure';
import type { PlayerGameLog } from '@cbb/infrastructure';
import { validatePlayerIdentity } from '../validation/playerIdentity.js';

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

interface GameLogEntry {
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
  stats: {
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
    groundIntoDp: number;
    leftOnBase: number;
    plateAppearances: number;
    totalBases: number;
  };
  position?: string;
}

/**
 * Fetch game logs for a specific player from MLB Stats API
 */
export async function fetchPlayerGameLogsFromApi(
  playerMlbamId: string,
  season: number
): Promise<GameLogEntry[]> {
  const url = new URL(`${MLB_STATS_BASE_URL}/people/${playerMlbamId}/stats`);
  url.searchParams.append('stats', 'gameLog');
  url.searchParams.append('group', 'hitting');
  url.searchParams.append('season', season.toString());

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`MLB Stats API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    stats?: Array<{
      splits?: Array<{
        date?: string;
        game?: {
          gamePk?: number;
          teams?: {
            home?: { team?: { id?: number } };
            away?: { team?: { id?: number } };
          };
        };
        team?: { id?: number };
        opponent?: { id?: number };
        isHome?: boolean;
        stat?: {
          gamesPlayed?: number;
          atBats?: number;
          runs?: number;
          hits?: number;
          doubles?: number;
          triples?: number;
          homeRuns?: number;
          rbi?: number;
          stolenBases?: number;
          caughtStealing?: number;
          baseOnBalls?: number;
          strikeOuts?: number;
          hitByPitch?: number;
          sacrificeFlies?: number;
          groundIntoDoublePlay?: number;
          leftOnBase?: number;
          plateAppearances?: number;
          totalBases?: number;
        };
        position?: {
          code?: string;
        };
      }>;
    }>;
  };

  const splits = data.stats?.[0]?.splits || [];
  
  if (splits.length === 0) {
    console.warn(`[INGESTION] No game logs found for player ${playerMlbamId} in season ${season}. This may indicate:
      - Player has not played yet
      - MLB Stats API data lag (try again later)
      - Player ID mismatch
      - Data source limitation (MLB API vs Baseball-Reference)`);
  }
  
  const entries: GameLogEntry[] = [];

  for (const split of splits) {
    if (!split.date || !split.game?.gamePk) continue;

    const stat = split.stat || {};
    const gamePk = String(split.game.gamePk);
    const gameDate = new Date(split.date);

    // Determine teams
    const homeTeamId = String(split.game.teams?.home?.team?.id || '');
    const awayTeamId = String(split.game.teams?.away?.team?.id || '');
    const teamId = String(split.team?.id || '');
    const opponentId = String(split.opponent?.id || '');
    const isHomeGame = split.isHome || false;

    // Calculate plate appearances if not provided
    const atBats = stat.atBats || 0;
    const walks = stat.baseOnBalls || 0;
    const hitByPitch = stat.hitByPitch || 0;
    const sacrificeFlies = stat.sacrificeFlies || 0;
    const plateAppearances = stat.plateAppearances || (atBats + walks + hitByPitch + sacrificeFlies);

    // Calculate total bases
    const hits = stat.hits || 0;
    const doubles = stat.doubles || 0;
    const triples = stat.triples || 0;
    const homeRuns = stat.homeRuns || 0;
    const totalBases = stat.totalBases || (hits + doubles + 2 * triples + 3 * homeRuns);

    entries.push({
      playerMlbamId,
      season,
      gameDate,
      gamePk,
      homeTeamId,
      awayTeamId,
      isHomeGame,
      teamId,
      teamMlbamId: teamId,
      opponentId,
      stats: {
        gamesPlayed: stat.gamesPlayed || 1,
        atBats,
        runs: stat.runs || 0,
        hits,
        doubles,
        triples,
        homeRuns,
        rbi: stat.rbi || 0,
        stolenBases: stat.stolenBases || 0,
        caughtStealing: stat.caughtStealing || 0,
        walks,
        strikeouts: stat.strikeOuts || 0,
        hitByPitch,
        sacrificeFlies,
        groundIntoDp: stat.groundIntoDoublePlay || 0,
        leftOnBase: stat.leftOnBase || 0,
        plateAppearances,
        totalBases,
      },
      position: split.position?.code,
    });
  }

  return entries;
}

/**
 * Store game logs in database (idempotent - upserts by playerMlbamId + gamePk)
 */
export async function storeGameLogs(
  playerId: string,
  entries: GameLogEntry[],
  traceId: string
): Promise<{ stored: number; errors: string[] }> {
  const errors: string[] = [];
  let stored = 0;

  for (const entry of entries) {
    try {
      await prisma.playerGameLog.upsert({
        where: {
          playerMlbamId_gamePk: {
            playerMlbamId: entry.playerMlbamId,
            gamePk: entry.gamePk,
          },
        },
        update: {
          playerId,
          gamesPlayed: entry.stats.gamesPlayed,
          atBats: entry.stats.atBats,
          runs: entry.stats.runs,
          hits: entry.stats.hits,
          doubles: entry.stats.doubles,
          triples: entry.stats.triples,
          homeRuns: entry.stats.homeRuns,
          rbi: entry.stats.rbi,
          stolenBases: entry.stats.stolenBases,
          caughtStealing: entry.stats.caughtStealing,
          walks: entry.stats.walks,
          strikeouts: entry.stats.strikeouts,
          hitByPitch: entry.stats.hitByPitch,
          sacrificeFlies: entry.stats.sacrificeFlies,
          groundIntoDp: entry.stats.groundIntoDp,
          leftOnBase: entry.stats.leftOnBase,
          plateAppearances: entry.stats.plateAppearances,
          totalBases: entry.stats.totalBases,
          position: entry.position,
          updatedAt: new Date(),
        },
        create: {
          playerId,
          playerMlbamId: entry.playerMlbamId,
          season: entry.season,
          gameDate: entry.gameDate,
          gamePk: entry.gamePk,
          homeTeamId: entry.homeTeamId,
          awayTeamId: entry.awayTeamId,
          isHomeGame: entry.isHomeGame,
          teamId: entry.teamId,
          teamMlbamId: entry.teamMlbamId,
          opponentId: entry.opponentId,
          gamesPlayed: entry.stats.gamesPlayed,
          atBats: entry.stats.atBats,
          runs: entry.stats.runs,
          hits: entry.stats.hits,
          doubles: entry.stats.doubles,
          triples: entry.stats.triples,
          homeRuns: entry.stats.homeRuns,
          rbi: entry.stats.rbi,
          stolenBases: entry.stats.stolenBases,
          caughtStealing: entry.stats.caughtStealing,
          walks: entry.stats.walks,
          strikeouts: entry.stats.strikeouts,
          hitByPitch: entry.stats.hitByPitch,
          sacrificeFlies: entry.stats.sacrificeFlies,
          groundIntoDp: entry.stats.groundIntoDp,
          leftOnBase: entry.stats.leftOnBase,
          plateAppearances: entry.stats.plateAppearances,
          totalBases: entry.stats.totalBases,
          position: entry.position,
        },
      });
      stored++;
    } catch (error) {
      errors.push(`Game ${entry.gamePk}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { stored, errors };
}

/**
 * Ingest game logs for a list of players
 */
export async function ingestGameLogsForPlayers(
  playerIds: Array<{ playerId: string; mlbamId: string }>,
  season: number,
  traceId: string
): Promise<{
  totalPlayers: number;
  totalGames: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let totalGames = 0;

  for (const { playerId, mlbamId } of playerIds) {
    try {
      const entries = await fetchPlayerGameLogsFromApi(mlbamId, season);
      const result = await storeGameLogs(playerId, entries, traceId);
      totalGames += result.stored;
      errors.push(...result.errors);
    } catch (error) {
      errors.push(`Player ${mlbamId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    totalPlayers: playerIds.length,
    totalGames,
    errors,
  };
}

/**
 * Ingest game logs with player identity validation
 * Validates each player's ID matches their name before ingestion
 * Prevents silent data corruption from ID mismatches
 */
export async function ingestGameLogsWithValidation(
  players: Array<{ playerId: string; mlbamId: string; name: string }>,
  season: number,
  traceId: string
): Promise<{
  totalPlayers: number;
  validated: number;
  rejected: number;
  totalGames: number;
  errors: string[];
  validations: Array<{
    mlbamId: string;
    name: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;
}> {
  const errors: string[] = [];
  const validations: Array<{
    mlbamId: string;
    name: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> = [];
  let totalGames = 0;
  let validated = 0;
  let rejected = 0;

  for (const { playerId, mlbamId, name } of players) {
    console.log(`[INGESTION] Validating ${name} (${mlbamId})...`);

    // Validate identity before ingestion
    const validation = await validatePlayerIdentity(mlbamId, name);

    validations.push({
      mlbamId,
      name,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    });

    // Log warnings
    for (const warning of validation.warnings) {
      console.warn(`[INGESTION] Warning for ${name}: ${warning}`);
    }

    // Reject if identity mismatch
    if (!validation.valid) {
      for (const error of validation.errors) {
        console.error(`[INGESTION] ${error}`);
        errors.push(`${name} (${mlbamId}): ${error}`);
      }
      rejected++;
      continue;
    }

    // Proceed with ingestion
    try {
      const entries = await fetchPlayerGameLogsFromApi(mlbamId, season);
      const result = await storeGameLogs(playerId, entries, traceId);
      totalGames += result.stored;
      errors.push(...result.errors);
      validated++;

      console.log(
        `[INGESTION] ${name}: ${result.stored} games stored (${entries.length} fetched)`
      );
    } catch (error) {
      const msg = `Player ${name} (${mlbamId}): ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[INGESTION] ${msg}`);
      errors.push(msg);
      rejected++;
    }
  }

  return {
    totalPlayers: players.length,
    validated,
    rejected,
    totalGames,
    errors,
    validations,
  };
}

/**
 * Simple wrapper for single player ingestion
 * Used by gated ingestion after identity verification
 */
export async function ingestGameLogs(
  mlbamId: string,
  season: number
): Promise<{
  success: boolean;
  totalGames: number;
  errors: string[];
}> {
  const traceId = `ingest-${mlbamId}-${Date.now()}`;
  const entries = await fetchPlayerGameLogsFromApi(mlbamId, season);
  
  if (entries.length === 0) {
    return {
      success: true,
      totalGames: 0,
      errors: [],
    };
  }

  const canonicalPlayerId = `mlbam:${mlbamId}`;
  const result = await storeGameLogs(canonicalPlayerId, entries, traceId);
  
  return {
    success: result.errors.length === 0,
    totalGames: result.stored,
    errors: result.errors,
  };
}
