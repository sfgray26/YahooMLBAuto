#!/usr/bin/env node
/**
 * Verify Gerrit Cole ID
 */

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';

async function searchCole() {
  const searchUrl = `${MLB_STATS_BASE_URL}/people/search?names=gerrit cole&sportId=1`;
  const res = await fetch(searchUrl);
  
  if (res.ok) {
    const data = await res.json();
    const p = data.people?.[0];
    if (p) {
      console.log('Gerrit Cole:');
      console.log(`  ID: ${p.id}`);
      console.log(`  Name: ${p.fullName}`);
      console.log(`  Debut: ${p.mlbDebutDate}`);
    }
  }
}

searchCole();
