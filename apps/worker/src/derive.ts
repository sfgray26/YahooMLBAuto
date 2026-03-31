#!/usr/bin/env node
/**
 * Standalone Derived Features Computation Script
 *
 * Run manually to compute derived features:
 *   pnpm --filter @cbb/worker derive
 *
 * Or with specific season:
 *   SEASON=2024 pnpm --filter @cbb/worker derive
 */

import { computeAllDerivedFeatures } from './derived/index.js';

async function main() {
  const season = parseInt(process.env.SEASON || String(new Date().getFullYear()));
  const dryRun = process.env.DRY_RUN === 'true';

  console.log(`[CLI] Computing derived features for season ${season}...`);
  if (dryRun) console.log('[CLI] DRY RUN MODE - no data will be saved\n');

  const result = await computeAllDerivedFeatures({
    season,
    dryRun,
  });

  console.log('\n[CLI] Result:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log(`\n✅ Computed features for ${result.playersComputed} players`);
    process.exit(0);
  } else {
    console.error('\n❌ Computation failed:', result.errors);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[CLI] Fatal error:', error);
  process.exit(1);
});
