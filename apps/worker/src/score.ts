#!/usr/bin/env node
/**
 * Standalone Scoring Script
 *
 * Run manually to compute player scores:
 *   pnpm --filter @cbb/worker score
 *
 * Or with specific season:
 *   SEASON=2024 pnpm --filter @cbb/worker score
 */

import { batchScorePlayers } from './scoring/index.js';

async function main() {
  const season = parseInt(process.env.SEASON || String(new Date().getFullYear()));
  const dryRun = process.env.DRY_RUN === 'true';

  console.log(`[CLI] Scoring players for season ${season}...`);
  if (dryRun) console.log('[CLI] DRY RUN MODE\n');

  const result = await batchScorePlayers({
    season,
    dryRun,
  });

  console.log('\n[CLI] Result:', JSON.stringify({
    success: result.success,
    playersScored: result.playersScored,
    durationMs: result.durationMs,
    errors: result.errors,
  }, null, 2));

  // Show top 10 players
  if (result.scores.length > 0) {
    const topPlayers = [...result.scores]
      .sort((a, b) => b.overallValue - a.overallValue)
      .slice(0, 10);

    console.log('\n[CLI] Top 10 Players:');
    topPlayers.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.playerMlbamId}: ${p.overallValue} (${p.explanation.summary})`);
    });
  }

  if (result.success) {
    console.log(`\n✅ Scored ${result.playersScored} players`);
    process.exit(0);
  } else {
    console.error('\n❌ Scoring failed:', result.errors);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[CLI] Fatal error:', error);
  process.exit(1);
});
