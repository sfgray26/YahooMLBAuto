#!/usr/bin/env node
/**
 * Investigation: Missing Paul Skenes Data
 * He had 187.2 IP in 2025 but our database shows 0 records
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';
const SKENES_MLBAM_ID = '686970';
const PIRATES_TEAM_ID = '134'; // Pittsburgh Pirates

async function investigateSkenes() {
  console.log('🔍 Investigation: Missing Paul Skenes Data\n');
  console.log('Expected: 187.2 IP in 2025');
  console.log('Found in DB: 0 records\n');
  console.log('='.repeat(70));

  // 1. Check database thoroughly
  console.log('\n📊 DATABASE SEARCH\n');
  
  // By mlbamId
  const byMlbamId = await prisma.playerDailyStats.findMany({
    where: { playerMlbamId: SKENES_MLBAM_ID },
  });
  console.log(`By mlbamId (${SKENES_MLBAM_ID}): ${byMlbamId.length} records`);
  
  // By playerId (various formats)
  const byPlayerId = await prisma.playerDailyStats.findMany({
    where: { 
      OR: [
        { playerId: SKENES_MLBAM_ID },
        { playerId: `p_${SKENES_MLBAM_ID}` },
        { playerId: { contains: 'skenes' } },
      ]
    },
  });
  console.log(`By playerId variations: ${byPlayerId.length} records`);

  // 2. Check Pittsburgh Pirates roster in database
  console.log('\n\n🏴‍☠️ PITTSBURGH PIRATES ROSTER CHECK\n');
  
  const pirates = await prisma.playerDailyStats.findMany({
    where: { teamMlbamId: PIRATES_TEAM_ID },
    select: { playerMlbamId: true, playerId: true },
    distinct: ['playerMlbamId'],
    take: 20,
  });
  console.log(`Players with team_id ${PIRATES_TEAM_ID}: ${pirates.length}`);
  pirates.forEach(p => console.log(`   - ${p.playerMlbamId}`));

  // 3. Check raw ingestion logs
  console.log('\n\n📥 RAW INGESTION LOGS\n');
  
  const logs = await prisma.rawIngestionLog.findMany({
    orderBy: { fetchedAt: 'desc' },
    take: 5,
  });
  logs.forEach(log => {
    console.log(`${log.source} | ${log.endpoint} | Records: ${log.recordCount} | ${log.fetchedAt.toISOString()}`);
  });

  // 4. MLB API Direct Check - Skenes stats
  console.log('\n\n⚾ MLB API DIRECT CHECK - Skenes\n');
  
  // Season stats
  const seasonUrl = `${MLB_STATS_BASE_URL}/people/${SKENES_MLBAM_ID}/stats?stats=season&group=pitching&season=2025&gameType=R`;
  const seasonRes = await fetch(seasonUrl);
  const seasonData = seasonRes.ok ? await seasonRes.json() : null;
  
  console.log('Season Stats API Response:');
  if (seasonData?.stats?.[0]?.splits?.length > 0) {
    const stat = seasonData.stats[0].splits[0].stat;
    console.log(`  ✅ Games: ${stat.gamesPlayed}, GS: ${stat.gamesStarted}`);
    console.log(`  ✅ IP: ${stat.inningsPitched}`);
    console.log(`  ✅ SO: ${stat.strikeOuts}, BB: ${stat.baseOnBalls}`);
    console.log(`  ✅ BF: ${stat.battersFaced}`);
  } else {
    console.log('  ❌ No season stats found');
    console.log('  Response:', JSON.stringify(seasonData?.stats?.[0], null, 2)?.substring(0, 500));
  }

  // Game log to see individual games
  const gameLogUrl = `${MLB_STATS_BASE_URL}/people/${SKENES_MLBAM_ID}/stats?stats=gameLog&group=pitching&season=2025&gameType=R`;
  const gameLogRes = await fetch(gameLogUrl);
  const gameLogData = gameLogRes.ok ? await gameLogRes.json() : null;
  
  const games = gameLogData?.stats?.[0]?.splits || [];
  console.log(`\nGame Log: ${games.length} games found`);
  if (games.length > 0) {
    games.slice(0, 3).forEach((g: any) => {
      console.log(`  - ${g.date}: ${g.stat.inningsPitched} IP, ${g.stat.strikeOuts} SO`);
    });
  }

  // 5. Check Pirates team roster via API
  console.log('\n\n⚾ MLB API - PIRATES ROSTER\n');
  
  const rosterUrl = `${MLB_STATS_BASE_URL}/teams/${PIRATES_TEAM_ID}/roster?season=2025`;
  const rosterRes = await fetch(rosterUrl);
  const rosterData = rosterRes.ok ? await rosterRes.json() : null;
  
  const roster = rosterData?.roster || [];
  console.log(`Total roster size: ${roster.length}`);
  
  const skenesOnRoster = roster.find((p: any) => p.person.id === parseInt(SKENES_MLBAM_ID));
  if (skenesOnRoster) {
    console.log(`✅ Skenes FOUND on Pirates roster: ${skenesOnRoster.person.fullName}`);
    console.log(`   Position: ${skenesOnRoster.position.abbreviation}`);
    console.log(`   Status: ${skenesOnRoster.status.description}`);
  } else {
    console.log('❌ Skenes NOT found on Pirates roster');
  }

  // 6. Check if we missed him in qualified stats only
  console.log('\n\n⚾ MLB API - QUALIFIED vs ALL PLAYERS\n');
  
  // Standard qualified endpoint
  const qualifiedUrl = `${MLB_STATS_BASE_URL}/stats?stats=season&group=pitching&season=2025&gameType=R`;
  const qualifiedRes = await fetch(qualifiedUrl);
  const qualifiedData = qualifiedRes.ok ? await qualifiedRes.json() : null;
  
  const qualifiedPlayers = qualifiedData?.stats?.[0]?.splits || [];
  console.log(`Qualified pitchers: ${qualifiedPlayers.length}`);
  
  const skenesInQualified = qualifiedPlayers.find((p: any) => p.player?.id === parseInt(SKENES_MLBAM_ID));
  console.log(`Skenes in qualified list: ${skenesInQualified ? '✅ YES' : '❌ NO'}`);
  if (skenesInQualified) {
    console.log(`   Stats: ${skenesInQualified.stat.inningsPitched} IP, ${skenesInQualified.stat.strikeOuts} SO`);
  }

  // 7. Summary and hypothesis
  console.log('\n' + '='.repeat(70));
  console.log('📋 SUMMARY & HYPOTHESIS\n');
  
  if (games.length > 0 && byMlbamId.length === 0) {
    console.log('🎯 KEY FINDING:');
    console.log('   - Skenes HAS 2025 stats in MLB API');
    console.log('   - Skenes NOT in our database');
    console.log('   - This is an INGESTION BUG\n');
    
    console.log('🔍 Possible causes:');
    console.log('   1. Roster-based ingestion missed him (team lookup issue)');
    console.log('   2. Stats endpoint returned empty during ingestion window');
    console.log('   3. Database insert failed silently');
    console.log('   4. Player ID mismatch in our mapping\n');
    
    console.log('✅ Next steps:');
    console.log('   1. Check if Pirates were fully ingested');
    console.log('   2. Compare roster-based vs qualified-stats ingestion');
    console.log('   3. Test individual player ingestion for Skenes');
  } else if (games.length === 0) {
    console.log('🎯 KEY FINDING:');
    console.log('   - Skenes has NO 2025 stats in MLB API');
    console.log('   - This is an MLB API DATA ISSUE, not our ingestion\n');
    console.log('   Possible reasons:');
    console.log('   - Stats not yet published for 2025');
    console.log('   - Different player ID used in 2025');
    console.log('   - API filter excluding his data');
  }
}

investigateSkenes().then(() => prisma.$disconnect());
