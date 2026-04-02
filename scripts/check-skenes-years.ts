#!/usr/bin/env node
/**
 * Verify: Skenes 2024 vs 2025 stats
 */

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';
const SKENES_MLBAM_ID = '686970';

async function checkSkenesByYear() {
  console.log('🔍 Paul Skenes Stats by Year\n');

  for (const year of [2024, 2025]) {
    console.log(`\n${year} Season:`);
    console.log('-'.repeat(40));
    
    const url = `${MLB_STATS_BASE_URL}/people/${SKENES_MLBAM_ID}/stats?stats=season&group=pitching&season=${year}&gameType=R`;
    const res = await fetch(url);
    const data = res.ok ? await res.json() : null;
    
    const splits = data?.stats?.[0]?.splits || [];
    if (splits.length > 0) {
      const stat = splits[0].stat;
      console.log(`  ✅ GAMES: ${stat.gamesPlayed}`);
      console.log(`  ✅ IP: ${stat.inningsPitched}`);
      console.log(`  ✅ SO: ${stat.strikeOuts}`);
      console.log(`  ✅ ERA: ${stat.era}`);
    } else {
      console.log(`  ❌ No stats found`);
    }
  }

  console.log('\n\nConclusion:');
  console.log('If 2024 has 187.2 IP and 2025 has 0,');
  console.log('then our database is CORRECT - he has no 2025 data yet.');
}

checkSkenesByYear();
