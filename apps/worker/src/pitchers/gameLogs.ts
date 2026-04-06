/**
 * Pitcher Game Log Ingestion Module
 *
 * Fetches pitcher game-by-game stats from MLB Stats API
 * and stores them in PitcherGameLog for rolling feature computation.
 */

import { prisma } from '@cbb/infrastructure';

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

interface PitcherGameLogEntry {
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
    gamesStarted: number;
    gamesFinished: number;
    gamesSaved: number;
    holds: number;
    inningsPitched: number;
    battersFaced: number;
    hitsAllowed: number;
    runsAllowed: number;
    earnedRuns: number;
    walks: number;
    strikeouts: number;
    homeRunsAllowed: number;
    hitByPitch: number;
    pitches: number | null;
    strikes: number | null;
    firstPitchStrikes: number | null;
    swingingStrikes: number | null;
    groundBalls: number | null;
    flyBalls: number | null;
  };
  position?: string;
}

export function parseInningsPitched(value: string | number | undefined): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (typeof value === 'number') {
    const whole = Math.trunc(value);
    const fractional = Number((value - whole).toFixed(1));

    if (fractional === 0.1) {
      return whole + (1 / 3);
    }
    if (fractional === 0.2) {
      return whole + (2 / 3);
    }

    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  const [wholePart, fractionalPart] = trimmed.split('.');
  const whole = Number(wholePart || 0);

  if (!fractionalPart) {
    return whole;
  }

  if (fractionalPart === '1') {
    return whole + (1 / 3);
  }

  if (fractionalPart === '2') {
    return whole + (2 / 3);
  }

  return Number(trimmed) || 0;
}

export async function fetchPitcherGameLogsFromApi(
  playerMlbamId: string,
  season: number
): Promise<PitcherGameLogEntry[]> {
  const url = new URL(`${MLB_STATS_BASE_URL}/people/${playerMlbamId}/stats`);
  url.searchParams.append('stats', 'gameLog');
  url.searchParams.append('group', 'pitching');
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
          gamesPitched?: number;
          gamesStarted?: number;
          gamesFinished?: number;
          saves?: number;
          holds?: number;
          inningsPitched?: string | number;
          battersFaced?: number;
          hits?: number;
          runs?: number;
          earnedRuns?: number;
          baseOnBalls?: number;
          strikeOuts?: number;
          homeRuns?: number;
          hitByPitch?: number;
          numberOfPitches?: number;
          pitchesThrown?: number;
          strikes?: number;
          firstPitchStrikes?: number;
          swingingStrikes?: number;
          groundOuts?: number;
          airOuts?: number;
        };
        position?: {
          code?: string;
        };
      }>;
    }>;
  };

  const splits = data.stats?.[0]?.splits || [];
  const entries: PitcherGameLogEntry[] = [];

  for (const split of splits) {
    if (!split.date || !split.game?.gamePk) {
      continue;
    }

    const stat = split.stat || {};
    const inningsPitched = parseInningsPitched(stat.inningsPitched);

    entries.push({
      playerMlbamId,
      season,
      gameDate: new Date(split.date),
      gamePk: String(split.game.gamePk),
      homeTeamId: String(split.game.teams?.home?.team?.id || ''),
      awayTeamId: String(split.game.teams?.away?.team?.id || ''),
      isHomeGame: split.isHome || false,
      teamId: String(split.team?.id || ''),
      teamMlbamId: String(split.team?.id || ''),
      opponentId: String(split.opponent?.id || ''),
      stats: {
        gamesPlayed: stat.gamesPitched || stat.gamesPlayed || 1,
        gamesStarted: stat.gamesStarted || 0,
        gamesFinished: stat.gamesFinished || 0,
        gamesSaved: stat.saves || 0,
        holds: stat.holds || 0,
        inningsPitched,
        battersFaced: stat.battersFaced || Math.round(inningsPitched * 4.3),
        hitsAllowed: stat.hits || 0,
        runsAllowed: stat.runs || 0,
        earnedRuns: stat.earnedRuns || 0,
        walks: stat.baseOnBalls || 0,
        strikeouts: stat.strikeOuts || 0,
        homeRunsAllowed: stat.homeRuns || 0,
        hitByPitch: stat.hitByPitch || 0,
        pitches: stat.numberOfPitches ?? stat.pitchesThrown ?? null,
        strikes: stat.strikes ?? null,
        firstPitchStrikes: stat.firstPitchStrikes ?? null,
        swingingStrikes: stat.swingingStrikes ?? null,
        groundBalls: stat.groundOuts ?? null,
        flyBalls: stat.airOuts ?? null,
      },
      position: split.position?.code,
    });
  }

  return entries;
}

export async function storePitcherGameLogs(
  playerId: string,
  entries: PitcherGameLogEntry[]
): Promise<{ stored: number; errors: string[] }> {
  const errors: string[] = [];
  let stored = 0;

  for (const entry of entries) {
    try {
      await prisma.pitcherGameLog.upsert({
        where: {
          playerMlbamId_gamePk: {
            playerMlbamId: entry.playerMlbamId,
            gamePk: entry.gamePk,
          },
        },
        update: {
          gamesPlayed: entry.stats.gamesPlayed,
          gamesStarted: entry.stats.gamesStarted,
          gamesFinished: entry.stats.gamesFinished,
          gamesSaved: entry.stats.gamesSaved,
          holds: entry.stats.holds,
          inningsPitched: entry.stats.inningsPitched,
          battersFaced: entry.stats.battersFaced,
          hitsAllowed: entry.stats.hitsAllowed,
          runsAllowed: entry.stats.runsAllowed,
          earnedRuns: entry.stats.earnedRuns,
          walks: entry.stats.walks,
          strikeouts: entry.stats.strikeouts,
          homeRunsAllowed: entry.stats.homeRunsAllowed,
          hitByPitch: entry.stats.hitByPitch,
          pitches: entry.stats.pitches,
          strikes: entry.stats.strikes,
          firstPitchStrikes: entry.stats.firstPitchStrikes,
          swingingStrikes: entry.stats.swingingStrikes,
          groundBalls: entry.stats.groundBalls,
          flyBalls: entry.stats.flyBalls,
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
          gamesStarted: entry.stats.gamesStarted,
          gamesFinished: entry.stats.gamesFinished,
          gamesSaved: entry.stats.gamesSaved,
          holds: entry.stats.holds,
          inningsPitched: entry.stats.inningsPitched,
          battersFaced: entry.stats.battersFaced,
          hitsAllowed: entry.stats.hitsAllowed,
          runsAllowed: entry.stats.runsAllowed,
          earnedRuns: entry.stats.earnedRuns,
          walks: entry.stats.walks,
          strikeouts: entry.stats.strikeouts,
          homeRunsAllowed: entry.stats.homeRunsAllowed,
          hitByPitch: entry.stats.hitByPitch,
          pitches: entry.stats.pitches,
          strikes: entry.stats.strikes,
          firstPitchStrikes: entry.stats.firstPitchStrikes,
          swingingStrikes: entry.stats.swingingStrikes,
          groundBalls: entry.stats.groundBalls,
          flyBalls: entry.stats.flyBalls,
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

export async function ingestPitcherGameLogsForPlayers(
  playerIds: Array<{ playerId: string; mlbamId: string }>,
  season: number
): Promise<{
  totalPlayers: number;
  totalGames: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let totalGames = 0;

  for (const { playerId, mlbamId } of playerIds) {
    try {
      const entries = await fetchPitcherGameLogsFromApi(mlbamId, season);
      const result = await storePitcherGameLogs(playerId, entries);
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

export async function ingestPitcherGameLogs(
  mlbamId: string,
  season: number
): Promise<{
  success: boolean;
  totalGames: number;
  errors: string[];
}> {
  const entries = await fetchPitcherGameLogsFromApi(mlbamId, season);
  if (entries.length === 0) {
    return {
      success: true,
      totalGames: 0,
      errors: [],
    };
  }

  const result = await storePitcherGameLogs(`mlbam:${mlbamId}`, entries);
  return {
    success: result.errors.length === 0,
    totalGames: result.stored,
    errors: result.errors,
  };
}

