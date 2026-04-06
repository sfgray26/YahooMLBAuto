#!/usr/bin/env node
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const { assertValidationEnvironment } = await import('./lib/validation-preflight.js');
  const environment = await assertValidationEnvironment({
    requiredTables: ['player_game_logs', 'player_derived_stats', 'raw_ingestion_logs'],
  });

  console.log('📊 Database Verification\n');
  console.log('═'.repeat(60));
  console.log(`\nDatabase: ${environment.databaseName} @ ${environment.databaseHost}`);
  
  // Count game logs
  const totalGames = await prisma.playerGameLog.count();
  console.log(`\nTotal game logs: ${totalGames.toLocaleString()}`);
  
  // Count by season
  const bySeason = await prisma.playerGameLog.groupBy({
    by: ['season'],
    _count: { id: true }
  });
  console.log('\nBy season:');
  bySeason.forEach(s => console.log(`  ${s.season}: ${s._count.id.toLocaleString()} games`));
  
  // Count derived stats
  const derivedCount = await prisma.playerDerivedStats.count();
  console.log(`\nDerived stats records: ${derivedCount.toLocaleString()}`);
  
  // Sample player data
  const playerGames = await prisma.playerGameLog.findMany({
    where: { playerMlbamId: '592450' },
    orderBy: { gameDate: 'desc' },
    take: 5
  });
  
  console.log('\nSample games for player 592450:');
  playerGames.forEach(g => {
    console.log(`  ${g.gameDate.toISOString().split('T')[0]}: ${g.hits}H/${g.atBats}AB, ${g.homeRuns}HR, ${g.rbi}RBI`);
  });
  
  // Raw ingestion logs
  const ingestionCount = await prisma.rawIngestionLog.count();
  console.log(`\nRaw ingestion logs: ${ingestionCount.toLocaleString()}`);
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
