#!/usr/bin/env node
/**
 * Recompute Derived Stats from Game Logs
 * 
 * This script recomputes all derived stats from game logs,
 * ensuring they reflect the latest game log data.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { batchComputeDerivedStatsFromGameLogs } from '../apps/worker/src/derived/fromGameLogs';

const season = parseInt(process.argv[2] || '2025');

async function main() {
  console.log(`🚀 Recomputing derived stats for season ${season} from game logs\n`);
  
  // Generate a trace ID for this run
  const traceId = `backfill-derived-${Date.now()}`;
  
  console.log('Step 1: Computing derived stats from game logs...');
  const result = await batchComputeDerivedStatsFromGameLogs(season, undefined, traceId);
  
  console.log(`\n✅ Computed derived stats for ${result.processed} players`);
  if (result.errors.length > 0) {
    console.log(`⚠️ ${result.errors.length} errors:`);
    result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }
  
  // Verify by checking one player
  console.log('\nStep 2: Verification spot-check...');
  const checkPlayer = await prisma.playerDerivedStats.findFirst({
    where: { season },
    orderBy: { computedAt: 'desc' },
  });
  
  if (checkPlayer) {
    console.log(`Latest derived record for ${checkPlayer.playerMlbamId}:`);
    console.log(`  gamesLast7: ${checkPlayer.gamesLast7}`);
    console.log(`  gamesLast14: ${checkPlayer.gamesLast14}`);
    console.log(`  gamesLast30: ${checkPlayer.gamesLast30}`);
    console.log(`  computedAt: ${checkPlayer.computedAt}`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
