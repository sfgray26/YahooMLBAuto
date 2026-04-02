#!/usr/bin/env node
/**
 * Research: Pitcher Stats Issue Investigation
 * 
 * Findings:
 * 1. Pitcher K%/BB% showing inflated values (242%, 300%)
 * 2. Root cause: Using hitter formula (SO/PA) instead of pitcher formula (SO/BF)
 * 3. Missing data for Skenes/Cole - no raw stats in database
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

async function researchPitcher(mlbamId: string, name: string) {
  console.log(`\n🔍 Researching ${name} (mlbamId: ${mlbamId})`);
  console.log('-'.repeat(60));

  // Check database
  const dbStats = await prisma.playerDailyStats.findMany({
    where: {
      playerMlbamId: mlbamId,
      season: 2025,
    },
  });
  console.log(`Database records: ${dbStats.length}`);
  
  if (dbStats.length > 0) {
    dbStats.forEach((s, i) => {
      console.log(`  [${i + 1}] ID: ${s.id}`);
      console.log(`      atBats: ${s.atBats}, walks: ${s.walks}, strikeouts: ${s.strikeouts}`);
      console.log(`      gamesPlayed: ${s.gamesPlayed}`);
    });
  }

  // Check derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: {
      playerMlbamId: mlbamId,
      season: 2025,
    },
  });
  
  if (derived) {
    console.log(`Derived: K%=${(derived.strikeoutRateLast30! * 100).toFixed(1)}%, BB%=${(derived.walkRateLast30! * 100).toFixed(1)}%`);
  } else {
    console.log('Derived: Not found');
  }

  // Fetch from MLB API
  console.log('\nFetching from MLB API...');
  
  // Try hitting stats
  const hittingUrl = `${MLB_STATS_BASE_URL}/people/${mlbamId}/stats?stats=season&group=hitting&season=2025&gameType=R`;
  const hittingRes = await fetch(hittingUrl);
  const hittingData = hittingRes.ok ? await hittingRes.json() : null;
  const hittingSplits = hittingData?.stats?.[0]?.splits || [];
  
  // Try pitching stats
  const pitchingUrl = `${MLB_STATS_BASE_URL}/people/${mlbamId}/stats?stats=season&group=pitching&season=2025&gameType=R`;
  const pitchingRes = await fetch(pitchingUrl);
  const pitchingData = pitchingRes.ok ? await pitchingRes.json() : null;
  const pitchingSplits = pitchingData?.stats?.[0]?.splits || [];

  console.log(`  Hitting splits: ${hittingSplits.length}`);
  if (hittingSplits.length > 0) {
    const stat = hittingSplits[0].stat;
    console.log(`    Games: ${stat.gamesPlayed}, AB: ${stat.atBats}, H: ${stat.hits}, SO: ${stat.strikeOuts}, BB: ${stat.baseOnBalls}`);
  }
  
  console.log(`  Pitching splits: ${pitchingSplits.length}`);
  if (pitchingSplits.length > 0) {
    const stat = pitchingSplits[0].stat;
    console.log(`    Games: ${stat.gamesPlayed}, GS: ${stat.gamesStarted}`);
    console.log(`    IP: ${stat.inningsPitched}, BF: ${stat.battersFaced}`);
    console.log(`    SO: ${stat.strikeOuts}, BB: ${stat.baseOnBalls}`);
    console.log(`    K% (calc): ${((stat.strikeOuts / stat.battersFaced) * 100).toFixed(1)}%`);
    console.log(`    BB% (calc): ${((stat.baseOnBalls / stat.battersFaced) * 100).toFixed(1)}%`);
  }
}

async function main() {
  console.log('🔬 Research: Pitcher Stats Investigation\n');

  await researchPitcher('669203', 'Tarik Skubal');
  await researchPitcher('686970', 'Paul Skenes');
  await researchPitcher('656288', 'Corbin Burnes');
  await researchPitcher('543037', 'Gerrit Cole');
  await researchPitcher('676440', 'Dylan Cease');

  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY OF FINDINGS');
  console.log('='.repeat(60));
  console.log('\n1. INFLATED K%/BB% for Pitchers:');
  console.log('   - Root cause: Using hitter formula SO/(AB+BB)');
  console.log('   - Should use: SO/BattersFaced for pitchers');
  console.log('   - Database stores pitching stats with atBats=0, walks=0');
  console.log('   - This causes division by near-zero, resulting in inflated %');
  
  console.log('\n2. MISSING PLAYERS (Skenes, Cole):');
  console.log('   - No records in PlayerDailyStats');
  console.log('   - Likely missing from roster ingestion');
  console.log('   - Need to verify full roster fetch for their teams');
  
  console.log('\n3. FIX REQUIRED:');
  console.log('   - Compute derived stats separately for hitters vs pitchers');
  console.log('   - Use id suffix "-hitting" vs "-pitching" to distinguish');
  console.log('   - For pitchers: K% = SO / battersFaced');
  console.log('   - For hitters: K% = SO / (AB + BB)');

  await prisma.$disconnect();
}

main();
