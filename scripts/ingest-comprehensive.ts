#!/usr/bin/env node
/**
 * Comprehensive MLB Data Ingestion
 * Fetches both hitting and pitching stats
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

async function fetchStats(group: 'hitting' | 'pitching', season: number): Promise<any[]> {
  const url = new URL(`${MLB_STATS_BASE_URL}/stats`);
  url.searchParams.append('stats', 'season');
  url.searchParams.append('group', group);
  url.searchParams.append('season', season.toString());
  url.searchParams.append('gameType', 'R');
  url.searchParams.append('limit', '1000');

  console.log(`  Fetching ${group} stats...`);
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`MLB API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const splits = data.stats?.[0]?.splits || [];
  console.log(`  ✓ Got ${splits.length} ${group} records`);
  return splits;
}

async function ingestStats() {
  const season = 2025;
  const traceId = `ingest-${Date.now()}`;
  const startTime = Date.now();

  console.log(`🚀 Starting comprehensive ingestion for season ${season}\n`);

  // Fetch both hitting and pitching
  const [hittingStats, pitchingStats] = await Promise.all([
    fetchStats('hitting', season),
    fetchStats('pitching', season),
  ]);

  console.log(`\n📊 Total records: ${hittingStats.length} hitting + ${pitchingStats.length} pitching`);

  // Store raw hitting log
  await prisma.rawIngestionLog.create({
    data: {
      cacheKey: `${traceId}-hitting`,
      source: 'mlb_stats_api',
      endpoint: '/stats?group=hitting',
      season,
      gameType: 'R',
      fetchedAt: new Date(),
      rawPayload: { recordCount: hittingStats.length },
      recordCount: hittingStats.length,
      traceId: `${traceId}-hitting`,
    },
  });

  // Store raw pitching log
  await prisma.rawIngestionLog.create({
    data: {
      cacheKey: `${traceId}-pitching`,
      source: 'mlb_stats_api',
      endpoint: '/stats?group=pitching',
      season,
      gameType: 'R',
      fetchedAt: new Date(),
      rawPayload: { recordCount: pitchingStats.length },
      recordCount: pitchingStats.length,
      traceId: `${traceId}-pitching`,
    },
  });

  // Normalize and store hitting stats
  console.log('\n💾 Storing hitting stats...');
  let hittingCount = 0;
  for (const split of hittingStats) {
    const player = split.player;
    const stats = split.stat;
    const team = split.team;

    if (!player?.id) continue;

    await prisma.playerDailyStats.upsert({
      where: {
        // Use composite unique key if exists, otherwise create one
        id: `${player.id}-${season}-hitting`,
      },
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
        id: `${player.id}-${season}-hitting`,
        playerId: player.id.toString(),
        playerMlbamId: player.id.toString(),
        statDate: new Date(),
        season,
        teamId: team?.id?.toString(),
        teamMlbamId: team?.id?.toString(),
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
        rawDataId: split.player?.id?.toString(),
        ingestedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    hittingCount++;
    if (hittingCount % 50 === 0) {
      process.stdout.write(`  ${hittingCount}/${hittingStats.length}\r`);
    }
  }
  console.log(`  ✓ Stored ${hittingCount} hitting records`);

  // Normalize and store pitching stats
  console.log('\n💾 Storing pitching stats...');
  let pitchingCount = 0;
  for (const split of pitchingStats) {
    const player = split.player;
    const stats = split.stat;
    const team = split.team;

    if (!player?.id) continue;

    await prisma.playerDailyStats.upsert({
      where: {
        id: `${player.id}-${season}-pitching`,
      },
      update: {
        gamesPlayed: stats.gamesPlayed || 0,
        atBats: 0,
        walks: stats.baseOnBalls || 0,
        strikeouts: stats.strikeOuts || 0,
        updatedAt: new Date(),
      },
      create: {
        id: `${player.id}-${season}-pitching`,
        playerId: player.id.toString(),
        playerMlbamId: player.id.toString(),
        statDate: new Date(),
        season,
        teamId: team?.id?.toString(),
        teamMlbamId: team?.id?.toString(),
        gamesPlayed: stats.gamesPlayed || 0,
        atBats: 0,
        walks: stats.baseOnBalls || 0,
        strikeouts: stats.strikeOuts || 0,
        rawDataSource: 'mlb_stats_api',
        rawDataId: split.player?.id?.toString(),
        ingestedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    pitchingCount++;
    if (pitchingCount % 50 === 0) {
      process.stdout.write(`  ${pitchingCount}/${pitchingStats.length}\r`);
    }
  }
  console.log(`  ✓ Stored ${pitchingCount} pitching records`);

  const durationMs = Date.now() - startTime;
  console.log(`\n✅ Ingestion complete in ${durationMs}ms`);
  console.log(`   Hitting: ${hittingCount} records`);
  console.log(`   Pitching: ${pitchingCount} records`);
  console.log(`   Total: ${hittingCount + pitchingCount} records`);

  return { success: true, hittingCount, pitchingCount };
}

ingestStats()
  .then((result) => {
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
