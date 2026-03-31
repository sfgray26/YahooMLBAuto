/**
 * MLB Stats API Adapter
 *
 * One source, one dataset, one cadence.
 * Fetches data exactly as provided - no filtering beyond date.
 */

import type { RawPlayerStats, RawGameLog } from '../types/raw.js';

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

interface FetchOptions {
  season: number;
  gameType?: 'R' | 'S' | 'E'; // Regular, Spring, Exhibition
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = any;

/**
 * Fetch player stats for a given season.
 * Preserves provider IDs and timestamps exactly as returned.
 */
export async function fetchPlayerStats(options: FetchOptions): Promise<RawPlayerStats[]> {
  const { season, gameType = 'R' } = options;

  // MLB Stats API - hitting stats endpoint
  const url = new URL(`${MLB_STATS_BASE_URL}/stats`);
  url.searchParams.append('stats', 'season');
  url.searchParams.append('group', 'hitting');
  url.searchParams.append('season', season.toString());
  url.searchParams.append('gameType', gameType);
  url.searchParams.append('limit', '1000');
  url.searchParams.append('offset', '0');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`MLB Stats API error: ${response.status} ${response.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as ApiResponse;

  // Return exactly what the API provides
  return data.stats?.[0]?.splits || [];
}

/**
 * Fetch game logs for a specific player.
 * Preserves provider IDs exactly as returned.
 */
export async function fetchPlayerGameLogs(
  playerId: string,
  options: FetchOptions
): Promise<RawGameLog[]> {
  const { season } = options;

  const url = new URL(`${MLB_STATS_BASE_URL}/people/${playerId}/stats`);
  url.searchParams.append('stats', 'gameLog');
  url.searchParams.append('group', 'hitting');
  url.searchParams.append('season', season.toString());

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`MLB Stats API error: ${response.status} ${response.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as ApiResponse;

  // Return exactly what the API provides
  return data.stats?.[0]?.splits || [];
}

/**
 * Fetch all players (roster) for a team.
 */
export async function fetchTeamRoster(teamId: string, season: number): Promise<unknown[]> {
  const url = new URL(`${MLB_STATS_BASE_URL}/teams/${teamId}/roster`);
  url.searchParams.append('season', season.toString());
  url.searchParams.append('rosterType', 'fullSeason');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`MLB Stats API error: ${response.status} ${response.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as ApiResponse;
  return data.roster || [];
}

/**
 * Fetch schedule for a date range.
 */
export async function fetchSchedule(
  startDate: string,
  endDate: string
): Promise<unknown[]> {
  const url = new URL(`${MLB_STATS_BASE_URL}/schedule`);
  url.searchParams.append('startDate', startDate);
  url.searchParams.append('endDate', endDate);
  url.searchParams.append('sportId', '1'); // MLB
  url.searchParams.append('gameType', 'R');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`MLB Stats API error: ${response.status} ${response.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as ApiResponse;
  return data.dates || [];
}
