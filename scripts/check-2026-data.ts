#!/usr/bin/env node
/**
 * Check 2026 Data Availability from Balldontlie
 */

import { BalldontlieProvider } from '../packages/data/src/providers/balldontlie.js';
import { MemoryCache } from '../packages/data/src/providers/cache.js';

const apiKey = process.env.BALLDONTLIE_API_KEY;
if (!apiKey) {
  console.error('❌ BALLDONTLIE_API_KEY required');
  process.exit(1);
}

const provider = new BalldontlieProvider({ apiKey, cache: new MemoryCache() });

async function check2026Data() {
  console.log('🔍 Checking 2026 MLB Data Availability\n');
  console.log('═'.repeat(60));
  
  const testPlayers = [
    { id: '592450', name: 'Aaron Judge' },
    { id: '677951', name: 'Bobby Witt Jr.' },
    { id: '665161', name: 'Jeremy Peña' },
  ];
  
  for (const player of testPlayers) {
    console.log(`\n📊 ${player.name} (ID: ${player.id})`);
    console.log('-'.repeat(40));
    
    try {
      // Check 2025 data
      const result2025 = await provider.getGameLogs(player.id, { season: 2025 });
      const logs2025 = result2025.data;
      
      // Check 2026 data
      const result2026 = await provider.getGameLogs(player.id, { season: 2026 });
      const logs2026 = result2026.data;
      
      console.log(`  2025: ${logs2025.length} games`);
      console.log(`  2026: ${logs2026.length} games`);
      
      if (logs2026.length > 0) {
        const dates = logs2026.map(l => l.gameDate);
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
        
        console.log(`  2026 Date Range: ${minDate.toISOString().split('T')[0]} to ${maxDate.toISOString().split('T')[0]}`);
        
        // Check if dates are actually from 2026
        const actual2026Games = logs2026.filter(l => l.gameDate.getFullYear() === 2026);
        console.log(`  Actual 2026 games: ${actual2026Games.length}`);
        
        if (actual2026Games.length > 0) {
          console.log(`  ✅ 2026 data available!`);
          console.log(`     Latest: ${actual2026Games[0].gameDate.toISOString().split('T')[0]} - ${actual2026Games[0].hits}H/${actual2026Games[0].atBats}AB`);
        } else {
          console.log(`  ⚠️ No actual 2026 games found (returning historical data)`);
        }
      } else {
        console.log(`  ❌ No 2026 data returned`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('\n📅 Current Date: April 3, 2026');
  console.log('Note: MLB 2026 season should have just started (late March).');
  console.log('Expect limited 2026 game data at this time.');
}

check2026Data().catch(console.error);
