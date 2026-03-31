/**
 * Normalization Layer
 * 
 * Step 3: Normalize raw data into domain tables.
 * - Map provider IDs to canonical IDs
 * - Normalize dates/units
 * - Enforce schema constraints
 * - NO computed stats, NO rolling averages
 */

import { prisma } from '@cbb/infrastructure';
import type { RawPlayerStats, RawGameLog } from '../types/raw.js';

interface NormalizeStatsInput {
  rawStats: RawPlayerStats[];
  season: number;
  traceId: string;
}

/**
 * Normalize player season stats into domain table.
 * Idempotent - uses playerMlbamId + date + source as natural key.
 */
export async function normalizePlayerStats(
  input: NormalizeStatsInput
): Promise<{ created: number; updated: number }> {
  const { rawStats, season, traceId } = input;
  
  let created = 0;
  let updated = 0;
  
  for (const raw of rawStats) {
    // Skip if missing critical data
    if (!raw.player?.id || !raw.stat) continue;
    
    // Map provider IDs to canonical form
    const playerMlbamId = raw.player.id.toString();
    const playerId = `mlbam:${playerMlbamId}`; // Canonical ID
    
    // Normalize date (season-level stats use season start date)
    const statDate = new Date(`${season}-03-01`); // Opening Day approximation
    
    // Extract team info
    const teamMlbamId = raw.team?.id?.toString();
    const teamId = teamMlbamId ? `mlbam:${teamMlbamId}` : null;
    
    // Normalize stats (mild intelligence allowed)
    const stat = raw.stat;
    
    try {
      await prisma.playerDailyStats.upsert({
        where: {
          // Natural key for idempotency
          playerMlbamId_statDate_rawDataSource: {
            playerMlbamId,
            statDate,
            rawDataSource: 'mlb_stats_api',
          },
        },
        create: {
          // Canonical IDs
          playerId,
          playerMlbamId,
          
          // Date context
          statDate,
          season,
          
          // Team
          teamId,
          teamMlbamId,
          
          // Raw counting stats (no transforms)
          gamesPlayed: stat.gamesPlayed || 0,
          atBats: stat.atBats || 0,
          runs: stat.runs || 0,
          hits: stat.hits || 0,
          doubles: stat.doubles || 0,
          triples: stat.triples || 0,
          homeRuns: stat.homeRuns || 0,
          rbi: stat.rbi || 0,
          stolenBases: stat.stolenBases || 0,
          caughtStealing: stat.caughtStealing || 0,
          walks: stat.baseOnBalls || 0,
          strikeouts: stat.strikeOuts || 0,
          
          // Rate stats (as strings from provider)
          battingAvg: stat.avg || null,
          onBasePct: stat.obp || null,
          sluggingPct: stat.slg || null,
          ops: stat.ops || null,
          
          // Metadata
          rawDataSource: 'mlb_stats_api',
          rawDataId: playerMlbamId,
        },
        update: {
          // Update raw stats - idempotent
          teamId,
          teamMlbamId,
          
          gamesPlayed: stat.gamesPlayed || 0,
          atBats: stat.atBats || 0,
          runs: stat.runs || 0,
          hits: stat.hits || 0,
          doubles: stat.doubles || 0,
          triples: stat.triples || 0,
          homeRuns: stat.homeRuns || 0,
          rbi: stat.rbi || 0,
          stolenBases: stat.stolenBases || 0,
          caughtStealing: stat.caughtStealing || 0,
          walks: stat.baseOnBalls || 0,
          strikeouts: stat.strikeOuts || 0,
          
          battingAvg: stat.avg || null,
          onBasePct: stat.obp || null,
          sluggingPct: stat.slg || null,
          ops: stat.ops || null,
        },
      });
      
      created++;
    } catch (error) {
      // Log but don't fail entire batch
      console.error(`Failed to normalize stats for player ${playerMlbamId}:`, error);
    }
  }
  
  return { created, updated };
}

/**
 * Normalize game logs into domain table.
 * Idempotent - uses playerMlbamId + gameDate + source as natural key.
 */
export async function normalizeGameLogs(
  playerMlbamId: string,
  rawGameLogs: RawGameLog[],
  season: number,
  traceId: string
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  
  for (const raw of rawGameLogs) {
    // Skip if missing critical data
    if (!raw.date || !raw.stat) continue;
    
    // Canonical ID
    const playerId = `mlbam:${playerMlbamId}`;
    
    // Normalize date (YYYY-MM-DD from provider)
    const statDate = new Date(raw.date);
    
    // Extract opponent
    const opponentMlbamId = raw.opponent?.id?.toString();
    
    // Game ID
    const gameMlbamId = raw.game?.gamePk?.toString();
    
    const stat = raw.stat;
    
    try {
      // Note: For game logs, we might want a separate table
      // For now, storing as daily stats with game reference
      await prisma.playerDailyStats.upsert({
        where: {
          playerMlbamId_statDate_rawDataSource: {
            playerMlbamId,
            statDate,
            rawDataSource: 'mlb_stats_api:gamelog',
          },
        },
        create: {
          playerId,
          playerMlbamId,
          statDate,
          season,
          
          // Single game stats
          gamesPlayed: 1,
          atBats: stat.atBats || 0,
          runs: stat.runs || 0,
          hits: stat.hits || 0,
          doubles: stat.doubles || 0,
          triples: stat.triples || 0,
          homeRuns: stat.homeRuns || 0,
          rbi: stat.rbi || 0,
          stolenBases: stat.stolenBases || 0,
          caughtStealing: stat.caughtStealing || 0,
          walks: stat.baseOnBalls || 0,
          strikeouts: stat.strikeOuts || 0,
          
          battingAvg: stat.avg || null,
          onBasePct: stat.obp || null,
          sluggingPct: stat.slg || null,
          ops: stat.ops || null,
          
          rawDataSource: 'mlb_stats_api:gamelog',
          rawDataId: gameMlbamId || undefined,
        },
        update: {
          atBats: stat.atBats || 0,
          runs: stat.runs || 0,
          hits: stat.hits || 0,
          doubles: stat.doubles || 0,
          triples: stat.triples || 0,
          homeRuns: stat.homeRuns || 0,
          rbi: stat.rbi || 0,
          stolenBases: stat.stolenBases || 0,
          caughtStealing: stat.caughtStealing || 0,
          walks: stat.baseOnBalls || 0,
          strikeouts: stat.strikeOuts || 0,
          
          battingAvg: stat.avg || null,
          onBasePct: stat.obp || null,
          sluggingPct: stat.slg || null,
          ops: stat.ops || null,
        },
      });
      
      created++;
    } catch (error) {
      console.error(`Failed to normalize game log for ${playerMlbamId} on ${raw.date}:`, error);
    }
  }
  
  return { created, updated };
}
