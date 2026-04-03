/**
 * Test Game Log Ingestion
 * 
 * Tests the game log ingestion for a single player to verify the flow works.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { ingestGameLogs } from '../apps/worker/src/ingestion/gameLogs.js';

const mlbamId = process.argv[2] || '660271'; // Default: Shohei Ohtani
const season = parseInt(process.argv[3] || '2025');

async function testGameLogIngestion() {
  console.log(`\n🧪 Testing Game Log Ingestion`);
  console.log(`Player MLBAM ID: ${mlbamId}`);
  console.log(`Season: ${season}\n`);

  // Check current game log count for this player
  const beforeCount = await prisma.playerGameLog.count({
    where: { playerMlbamId: mlbamId, season },
  });
  console.log(`Game logs before: ${beforeCount}`);

  // Run ingestion
  console.log('\n📥 Running game log ingestion...\n');
  const startTime = Date.now();
  
  try {
    const result = await ingestGameLogs(mlbamId, season);
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Ingestion complete in ${duration}ms`);
    console.log(`Success: ${result.success}`);
    console.log(`Total games: ${result.totalGames}`);
    
    if (result.errors.length > 0) {
      console.log(`\n⚠️ Errors (${result.errors.length}):`);
      result.errors.forEach(e => console.log(`  - ${e}`));
    }

    // Verify count after
    const afterCount = await prisma.playerGameLog.count({
      where: { playerMlbamId: mlbamId, season },
    });
    console.log(`\nGame logs after: ${afterCount}`);
    console.log(`New games added: ${afterCount - beforeCount}`);

    // Show sample game logs
    if (afterCount > 0) {
      const samples = await prisma.playerGameLog.findMany({
        where: { playerMlbamId: mlbamId, season },
        orderBy: { gameDate: 'desc' },
        take: 3,
      });
      
      console.log('\n📋 Sample game logs:');
      samples.forEach(game => {
        console.log(`  ${game.gameDate.toISOString().split('T')[0]}: ${game.hits}H, ${game.homeRuns}HR, ${game.rbi}RBI`);
      });
    }

    console.log('\n' + '='.repeat(60));
    if (result.success && result.totalGames > 0) {
      console.log('✅ Game log ingestion is working!');
    } else {
      console.log('⚠️  Game log ingestion returned no games');
      console.log('   Possible reasons:');
      console.log('   - Player has no games this season');
      console.log('   - MLB Stats API issue');
      console.log('   - Wrong season/year');
    }
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Ingestion failed:', error);
    process.exit(1);
  }
}

testGameLogIngestion()
  .catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
