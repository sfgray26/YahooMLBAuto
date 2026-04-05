#!/usr/bin/env node
/**
 * Derived Stats Computation Pipeline
 * 
 * Computes 7/14/30 day rolling stats from game logs and stores in database.
 * 
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/compute-derived-stats.ts
 */

import { PrismaClient } from '@prisma/client';
import { BalldontlieProvider } from '../packages/data/src/providers/balldontlie.js';
import { MemoryCache } from '../packages/data/src/providers/cache.js';
import { DerivedFeatureComputer } from '../packages/data/src/computation/derived-features.js';

const prisma = new PrismaClient();

interface ComputationConfig {
  season: number;
  asOfDate: Date;
  playerIds?: string[]; // If not provided, computes for all verified players
  dryRun?: boolean;
  verbose?: boolean;
}

async function computePlayerDerivedStats(
  computer: DerivedFeatureComputer,
  playerId: string,
  season: number,
  asOfDate: Date,
  options: { dryRun?: boolean; verbose?: boolean } = {}
): Promise<{ computed: boolean; error?: string }> {
  const { dryRun = false, verbose = false } = options;
  
  try {
    // Compute features
    const features = await computer.computePlayerFeatures(playerId, season, asOfDate);
    
    if (!features) {
      if (verbose) console.log(`  No features computed for player ${playerId} (no games)`);
      return { computed: false };
    }
    
    if (verbose) {
      console.log(`  Computed: ${features.gamesLast30} games, ${features.plateAppearancesLast30} PA, ${features.battingAverageLast30?.toFixed(3) || 'N/A'} AVG`);
    }
    
    if (dryRun) {
      return { computed: true };
    }
    
    // Store in database
    await prisma.playerDerivedStats.upsert({
      where: {
        playerMlbamId_season_computedDate: {
          playerMlbamId: features.playerMlbamId,
          season: features.season,
          computedDate: asOfDate
        }
      },
      update: {
        // Update all fields
        gamesLast7: features.gamesLast7,
        gamesLast14: features.gamesLast14,
        gamesLast30: features.gamesLast30,
        plateAppearancesLast7: features.plateAppearancesLast7,
        plateAppearancesLast14: features.plateAppearancesLast14,
        plateAppearancesLast30: features.plateAppearancesLast30,
        atBatsLast30: features.atBatsLast30,
        battingAverageLast30: features.battingAverageLast30,
        onBasePctLast30: features.onBasePctLast30,
        sluggingPctLast30: features.sluggingPctLast30,
        opsLast30: features.opsLast30,
        isoLast30: features.isoLast30,
        walkRateLast30: features.walkRateLast30,
        strikeoutRateLast30: features.strikeoutRateLast30,
        battingAverageReliable: features.battingAverageReliable,
        gamesToReliable: features.gamesToReliable,
        productionVolatility: features.productionVolatility,
        zeroHitGamesLast14: features.zeroHitGamesLast14,
        multiHitGamesLast14: features.multiHitGamesLast14,
        computedAt: new Date(),
        traceId: `compute-${Date.now()}`
      },
      create: {
        playerId: features.playerMlbamId,
        playerMlbamId: features.playerMlbamId,
        season: features.season,
        computedAt: new Date(),
        computedDate: asOfDate,
        gamesLast7: features.gamesLast7,
        gamesLast14: features.gamesLast14,
        gamesLast30: features.gamesLast30,
        plateAppearancesLast7: features.plateAppearancesLast7,
        plateAppearancesLast14: features.plateAppearancesLast14,
        plateAppearancesLast30: features.plateAppearancesLast30,
        atBatsLast30: features.atBatsLast30,
        battingAverageLast30: features.battingAverageLast30,
        onBasePctLast30: features.onBasePctLast30,
        sluggingPctLast30: features.sluggingPctLast30,
        opsLast30: features.opsLast30,
        isoLast30: features.isoLast30,
        walkRateLast30: features.walkRateLast30,
        strikeoutRateLast30: features.strikeoutRateLast30,
        battingAverageReliable: features.battingAverageReliable,
        gamesToReliable: features.gamesToReliable,
        productionVolatility: features.productionVolatility,
        zeroHitGamesLast14: features.zeroHitGamesLast14,
        multiHitGamesLast14: features.multiHitGamesLast14,
        traceId: `compute-${Date.now()}`
      }
    });
    
    return { computed: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`  Failed to compute stats for player ${playerId}:`, errorMsg);
    return { computed: false, error: errorMsg };
  }
}

async function runComputation(config: ComputationConfig): Promise<void> {
  const { season, asOfDate, playerIds, dryRun = false, verbose = false } = config;
  
  console.log('🧮 Derived Stats Computation Pipeline\n');
  console.log('═'.repeat(80));
  console.log(`Season: ${season}`);
  console.log(`As of date: ${asOfDate.toISOString().split('T')[0]}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('═'.repeat(80));
  
  // Initialize provider and computer
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY environment variable required');
  }
  
  const provider = new BalldontlieProvider({
    apiKey,
    cache: new MemoryCache()
  });
  
  const computer = new DerivedFeatureComputer(provider);
  
  // Get players to compute
  let playersToCompute: string[] = [];
  
  if (playerIds && playerIds.length > 0) {
    playersToCompute = playerIds;
  } else {
    // Get players that have game logs
    const playersWithLogs = await prisma.playerGameLog.groupBy({
      by: ['playerMlbamId'],
      where: { season }
    });
    playersToCompute = playersWithLogs.map(p => p.playerMlbamId);
  }
  
  console.log(`\n📋 Players to compute: ${playersToCompute.length}`);
  
  if (playersToCompute.length === 0) {
    console.log('⚠️ No players found. Run game log ingestion first.');
    return;
  }
  
  // Compute derived stats for each player
  let computedCount = 0;
  let errorCount = 0;
  let processedCount = 0;
  
  const startTime = Date.now();
  
  for (const playerId of playersToCompute) {
    processedCount++;
    
    if (verbose || processedCount % 50 === 0) {
      console.log(`\n[${processedCount}/${playersToCompute.length}] Processing player ${playerId}...`);
    }
    
    const result = await computePlayerDerivedStats(computer, playerId, season, asOfDate, { dryRun, verbose });
    
    if (result.computed) {
      computedCount++;
    } else if (result.error) {
      errorCount++;
    }
    
    // Progress update every 50 players
    if (processedCount % 50 === 0) {
      const elapsed = Date.now() - startTime;
      const rate = processedCount / (elapsed / 1000);
      console.log(`  Progress: ${processedCount}/${playersToCompute.length} (${rate.toFixed(2)} players/sec)`);
      console.log(`  Computed: ${computedCount}, Errors: ${errorCount}`);
    }
  }
  
  const totalTime = Date.now() - startTime;
  
  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('📊 COMPUTATION SUMMARY\n');
  console.log(`Players processed: ${processedCount}`);
  console.log(`Stats computed: ${computedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Rate: ${(computedCount / (totalTime / 1000)).toFixed(2)} players/sec`);
  
  if (!dryRun) {
    // Log to system events
    await prisma.systemEvent.create({
      data: {
        eventId: `computation-${Date.now()}`,
        eventType: 'derived_stats_computation_complete',
        timestamp: new Date(),
        payload: {
          season,
          asOfDate: asOfDate.toISOString(),
          playersProcessed: processedCount,
          statsComputed: computedCount,
          errors: errorCount,
          durationMs: totalTime
        },
        metadata: {}
      }
    });
  }
  
  console.log('\n✅ Computation complete!');
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const playerIds = args
    .filter(arg => arg.startsWith('--player='))
    .map(arg => arg.split('=')[1]);
  
  const season = 2025;
  const asOfDate = new Date(); // Today
  
  try {
    await runComputation({ season, asOfDate, playerIds: playerIds.length > 0 ? playerIds : undefined, dryRun, verbose });
  } catch (error) {
    console.error('\n❌ Computation failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
