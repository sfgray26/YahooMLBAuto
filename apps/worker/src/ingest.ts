#!/usr/bin/env node
/**
 * Standalone Ingestion Script
 * 
 * Run manually to trigger data ingestion:
 *   pnpm --filter @cbb/worker ingest
 * 
 * Or with specific season:
 *   SEASON=2024 pnpm --filter @cbb/worker ingest
 */

import { runDailyIngestion, validateIngestion } from './ingestion/index.js';

async function main() {
  const season = parseInt(process.env.SEASON || String(new Date().getFullYear()));
  
  console.log(`[CLI] Starting ingestion for season ${season}...\n`);
  
  // Run ingestion
  const result = await runDailyIngestion({
    season,
    gameType: 'R',
    dryRun: false,
  });
  
  console.log('\n[CLI] Ingestion result:', JSON.stringify(result, null, 2));
  
  // Validate if successful
  if (result.success) {
    console.log('\n[CLI] Validating ingestion...');
    const validation = await validateIngestion(season);
    console.log('[CLI] Validation:', JSON.stringify(validation, null, 2));
    
    if (validation.valid) {
      console.log('\n✅ Ingestion validated successfully');
      process.exit(0);
    } else {
      console.error('\n⚠️ Validation issues:', validation.issues);
      process.exit(1);
    }
  } else {
    console.error('\n❌ Ingestion failed:', result.errors);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[CLI] Fatal error:', error);
  process.exit(1);
});
