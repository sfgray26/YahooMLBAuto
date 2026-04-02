#!/usr/bin/env node
/**
 * Fetch current derived stats for UAT players
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const TEST_PLAYERS = [
  // Hitters
  { mlbamId: '592450', name: 'Aaron Judge', type: 'hitter' },
  { mlbamId: '677951', name: 'Bobby Witt Jr.', type: 'hitter' },
  { mlbamId: '518692', name: 'Freddie Freeman', type: 'hitter' },
  { mlbamId: '665161', name: 'Jeremy Peña', type: 'hitter' },
  { mlbamId: '545361', name: 'Mike Trout', type: 'hitter' },
  // Pitchers
  { mlbamId: '669203', name: 'Tarik Skubal', type: 'pitcher' },
  { mlbamId: '694973', name: 'Paul Skenes', type: 'pitcher' },  // CORRECTED ID
  { mlbamId: '656288', name: 'Corbin Burnes', type: 'pitcher' },
  { mlbamId: '543037', name: 'Gerrit Cole', type: 'pitcher' },
  { mlbamId: '676440', name: 'Dylan Cease', type: 'pitcher' },
];

async function main() {
  console.log('📊 Current Derived Stats for UAT Players\n');
  console.log('═'.repeat(80));

  for (const player of TEST_PLAYERS) {
    const derived = await prisma.playerDerivedStats.findFirst({
      where: {
        playerMlbamId: player.mlbamId,
        season: 2025,
      },
      select: {
        playerMlbamId: true,
        gamesLast7: true,
        gamesLast14: true,
        gamesLast30: true,
        battingAverageLast30: true,
        onBasePctLast30: true,
        sluggingPctLast30: true,
        strikeoutRateLast30: true,
        walkRateLast30: true,
        battingAverageReliable: true,
        productionVolatility: true,
      },
    });

    console.log(`\n🧢 ${player.name} (${player.type}) - mlbamId: ${player.mlbamId}`);
    
    if (derived) {
      console.log(`   Games: 7d=${derived.gamesLast7}, 14d=${derived.gamesLast14}, 30d=${derived.gamesLast30}`);
      console.log(`   AVG: ${derived.battingAverageLast30?.toFixed(3) || 'N/A'}`);
      console.log(`   OPS: ${derived.onBasePctLast30 && derived.sluggingPctLast30 ? (derived.onBasePctLast30 + derived.sluggingPctLast30).toFixed(3) : 'N/A'}`);
      console.log(`   K%: ${(derived.strikeoutRateLast30 ? derived.strikeoutRateLast30 * 100 : 0).toFixed(1)}%`);
      console.log(`   BB%: ${(derived.walkRateLast30 ? derived.walkRateLast30 * 100 : 0).toFixed(1)}%`);
      console.log(`   Reliable: ${derived.battingAverageReliable ? '✅' : '❌'}`);
      console.log(`   Volatility: ${derived.productionVolatility?.toFixed(3) || 'N/A'}`);
    } else {
      console.log('   ⚠️ No derived stats found');
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('\n📋 Next Steps:');
  console.log('   1. Visit https://baseballsavant.mlb.com for manual stat verification');
  console.log('   2. Use MLB Stats API endpoints in the UAT checklist');
  console.log('   3. Compare manual calculations against derived values above');

  await prisma.$disconnect();
}

main();
