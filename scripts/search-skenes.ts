#!/usr/bin/env node
/**
 * Search for Skenes by name
 */

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

async function searchSkenes() {
  console.log('🔍 Searching for Paul Skenes by name\n');
  
  // Search for player
  const searchUrl = `${MLB_STATS_BASE_URL}/people/search?names=skenes&sportId=1`;
  const res = await fetch(searchUrl);
  
  if (!res.ok) {
    console.log(`Search API not available (status: ${res.status})`);
    
    // Try direct player lookup with different ID
    console.log('\nTrying alternate player ID lookup...');
    
    // Let's check known rookie IDs around 2024
    const possibleIds = ['686970', '695243', '700000', '675911'];
    
    for (const id of possibleIds) {
      const url = `${MLB_STATS_BASE_URL}/people/${id}`;
      const playerRes = await fetch(url);
      if (playerRes.ok) {
        const player = await playerRes.json();
        const p = player.people?.[0];
        if (p) {
          console.log(`\nID ${id}: ${p.fullName} (${p.primaryPosition.abbreviation})`);
          console.log(`  MLB debut: ${p.mlbDebutDate || 'N/A'}`);
          console.log(`  Current team: ${p.currentTeam?.name || 'N/A'}`);
        }
      }
    }
    
    return;
  }
  
  const data = await res.json();
  console.log('Search results:', JSON.stringify(data, null, 2));
}

searchSkenes();
