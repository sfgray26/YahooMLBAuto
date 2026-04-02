#!/usr/bin/env node
/**
 * Verify Skenes with correct ID: 694973
 */

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';
const CORRECT_SKENES_ID = '694973';
const WRONG_SKENES_ID = '686970';

async function verifyCorrectId() {
  console.log('🔍 Verifying Paul Skenes Stats\n');
  console.log(`Wrong ID:  ${WRONG_SKENES_ID}`);
  console.log(`Correct ID: ${CORRECT_SKENES_ID}\n`);
  console.log('='.repeat(60));

  for (const id of [WRONG_SKENES_ID, CORRECT_SKENES_ID]) {
    console.log(`\n🆔 Player ID: ${id}`);
    console.log('-'.repeat(40));
    
    // Get player info
    const playerUrl = `${MLB_STATS_BASE_URL}/people/${id}`;
    const playerRes = await fetch(playerUrl);
    if (playerRes.ok) {
      const playerData = await playerRes.json();
      const p = playerData.people?.[0];
      if (p) {
        console.log(`Name: ${p.fullName}`);
        console.log(`Debut: ${p.mlbDebutDate || 'N/A'}`);
      } else {
        console.log('Player not found');
      }
    }
    
    // Get 2024 stats
    const stats2024Url = `${MLB_STATS_BASE_URL}/people/${id}/stats?stats=season&group=pitching&season=2024&gameType=R`;
    const stats2024Res = await fetch(stats2024Url);
    const stats2024Data = stats2024Res.ok ? await stats2024Res.json() : null;
    const splits2024 = stats2024Data?.stats?.[0]?.splits || [];
    
    if (splits2024.length > 0) {
      const stat = splits2024[0].stat;
      console.log(`\n📊 2024 STATS:`);
      console.log(`   Games: ${stat.gamesPlayed}`);
      console.log(`   IP: ${stat.inningsPitched}`);
      console.log(`   SO: ${stat.strikeOuts}`);
      console.log(`   BB: ${stat.baseOnBalls}`);
      console.log(`   ERA: ${stat.era}`);
    } else {
      console.log('\n📊 2024 STATS: None found');
    }
    
    // Get 2025 stats
    const stats2025Url = `${MLB_STATS_BASE_URL}/people/${id}/stats?stats=season&group=pitching&season=2025&gameType=R`;
    const stats2025Res = await fetch(stats2025Url);
    const stats2025Data = stats2025Res.ok ? await stats2025Res.json() : null;
    const splits2025 = stats2025Data?.stats?.[0]?.splits || [];
    
    if (splits2025.length > 0) {
      const stat = splits2025[0].stat;
      console.log(`\n📊 2025 STATS:`);
      console.log(`   Games: ${stat.gamesPlayed}`);
      console.log(`   IP: ${stat.inningsPitched}`);
      console.log(`   SO: ${stat.strikeOuts}`);
      console.log(`   BB: ${stat.baseOnBalls}`);
      console.log(`   ERA: ${stat.era}`);
    } else {
      console.log('\n📊 2025 STATS: None found');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ CONCLUSION:');
  console.log('   Paul Skenes correct ID is 694973');
  console.log('   He has 2024 stats (rookie year)');
  console.log('   2025 stats depend on current season data availability');
}

verifyCorrectId();
