#!/usr/bin/env node
/**
 * Full MLB Data Ingestion - All Players (not just qualified)
 * Uses the roster endpoint to get all players, then their stats
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

// All 30 MLB teams
const TEAM_IDS = [
  108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
  118, 119, 120, 121, 133, 134, 135, 136, 137, 138,
  139, 140, 141, 142, 143, 144, 145, 146, 147, 158,
];

async function fetchTeamRoster(teamId: number, season: number): Promise<any[]> {
  const url = new URL(`${MLB_STATS_BASE_URL}/teams/${teamId}/roster`);
  url.searchParams.append('season', season.toString());
  url.searchParams.append('rosterType', 'fullSeason');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.log(`  ⚠️ Team ${teamId}: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.roster || [];
  } catch (error) {
    console.log(`  ⚠️ Team ${teamId}: ${error.message}`);
    return [];
  }
}

async function fetchPlayerStats(playerId: number, season: number, group: 'hitting' | 'pitching'): Promise<any | null> {
  const url = new URL(`${MLB_STATS_BASE_URL}/people/${playerId}/stats`);
  url.searchParams.append('stats', 'season');
  url.searchParams.append('group', group);
  url.searchParams.append('season', season.toString());
  url.searchParams.append('gameType', 'R');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const data = await response.json();
    const splits = data.stats?.[0]?.splits || [];
    return splits[0] || null;
  } catch (error) {
    return null;
  }
}

async function ingestFullRosters() {
  const season = 2025;
  const traceId = `full-ingest-${Date.now()}`;
  const startTime = Date.now();

  console.log(`🚀 Fetching full rosters for all 30 teams (season ${season})\n`);

  // Get all players from all team rosters
  const allPlayers = new Map<number, any>();
  
  for (const teamId of TEAM_IDS) {
    const roster = await fetchTeamRoster(teamId, season);
    console.log(`  Team ${teamId}: ${roster.length} players`);
    
    for (const entry of roster) {
      const person = entry.person;
      if (person?.id) {
        allPlayers.set(person.id, {
          id: person.id,
          name: person.fullName,
          teamId: teamId,
          position: entry.position?.abbreviation || 'UN',
        });
      }
    }
  }

  console.log(`\n📊 Total unique players from rosters: ${allPlayers.size}`);
  console.log('💾 Fetching stats for each player...\n');

  let hittingCount = 0;
  let pitchingCount = 0;
  let processed = 0;

  // Process each player
  for (const [playerId, playerInfo] of allPlayers) {
    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`  ${processed}/${allPlayers.size} (H:${hittingCount} P:${pitchingCount})\r`);
    }

    // Try to fetch hitting stats
    const hittingStats = await fetchPlayerStats(playerId, season, 'hitting');
    if (hittingStats?.stat?.gamesPlayed > 0) {
      const stats = hittingStats.stat;
      const team = hittingStats.team;
      
      await prisma.playerDailyStats.upsert({
        where: { id: `${playerId}-${season}-hitting` },
        update: {
          gamesPlayed: stats.gamesPlayed || 0,
          atBats: stats.atBats || 0,
          runs: stats.runs || 0,
          hits: stats.hits || 0,
          doubles: stats.doubles || 0,
          triples: stats.triples || 0,
          homeRuns: stats.homeRuns || 0,
          rbi: stats.rbi || 0,
          stolenBases: stats.stolenBases || 0,
          caughtStealing: stats.caughtStealing || 0,
          walks: stats.baseOnBalls || 0,
          strikeouts: stats.strikeOuts || 0,
          battingAvg: stats.avg || null,
          onBasePct: stats.obp || null,
          sluggingPct: stats.slg || null,
          ops: stats.ops || null,
          updatedAt: new Date(),
        },
        create: {
          id: `${playerId}-${season}-hitting`,
          playerId: playerId.toString(),
          playerMlbamId: playerId.toString(),
          statDate: new Date(),
          season,
          teamId: team?.id?.toString() || playerInfo.teamId?.toString(),
          teamMlbamId: team?.id?.toString() || playerInfo.teamId?.toString(),
          gamesPlayed: stats.gamesPlayed || 0,
          atBats: stats.atBats || 0,
          runs: stats.runs || 0,
          hits: stats.hits || 0,
          doubles: stats.doubles || 0,
          triples: stats.triples || 0,
          homeRuns: stats.homeRuns || 0,
          rbi: stats.rbi || 0,
          stolenBases: stats.stolenBases || 0,
          caughtStealing: stats.caughtStealing || 0,
          walks: stats.baseOnBalls || 0,
          strikeouts: stats.strikeOuts || 0,
          battingAvg: stats.avg || null,
          onBasePct: stats.obp || null,
          sluggingPct: stats.slg || null,
          ops: stats.ops || null,
          rawDataSource: 'mlb_stats_api',
          rawDataId: playerId.toString(),
          ingestedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      hittingCount++;
    }

    // Try to fetch pitching stats
    const pitchingStats = await fetchPlayerStats(playerId, season, 'pitching');
    if (pitchingStats?.stat?.gamesPlayed > 0) {
      const stats = pitchingStats.stat;
      const team = pitchingStats.team;
      
      await prisma.playerDailyStats.upsert({
        where: { id: `${playerId}-${season}-pitching` },
        update: {
          gamesPlayed: stats.gamesPlayed || 0,
          walks: stats.baseOnBalls || 0,
          strikeouts: stats.strikeOuts || 0,
          updatedAt: new Date(),
        },
        create: {
          id: `${playerId}-${season}-pitching`,
          playerId: playerId.toString(),
          playerMlbamId: playerId.toString(),
          statDate: new Date(),
          season,
          teamId: team?.id?.toString() || playerInfo.teamId?.toString(),
          teamMlbamId: team?.id?.toString() || playerInfo.teamId?.toString(),
          gamesPlayed: stats.gamesPlayed || 0,
          walks: stats.baseOnBalls || 0,
          strikeouts: stats.strikeOuts || 0,
          rawDataSource: 'mlb_stats_api',
          rawDataId: playerId.toString(),
          ingestedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      pitchingCount++;
    }

    // Small delay to be nice to the API
    await new Promise((r) => setTimeout(r, 50));
  }

  const durationMs = Date.now() - startTime;
  console.log(`\n\n✅ Full ingestion complete in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`   Roster size: ${allPlayers.size} players`);
  console.log(`   With hitting stats: ${hittingCount}`);
  console.log(`   With pitching stats: ${pitchingCount}`);
  console.log(`   Total records: ${hittingCount + pitchingCount}`);
}

ingestFullRosters()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
