#!/usr/bin/env node
/**
 * Balldontlie Database Ingestion Pipeline
 * 
 * This script ingests game logs from balldontlie and stores them in the database.
 * It's idempotent - running it multiple times won't create duplicates.
 * 
 * Usage:
 *   DATABASE_URL=postgres://... BALLDONTLIE_API_KEY=... npx tsx scripts/ingest-balldontlie.ts
 */

import { PrismaClient } from '@prisma/client';
import { BalldontlieProvider } from '../packages/data/src/providers/balldontlie.js';
import { MemoryCache } from '../packages/data/src/providers/cache.js';

const prisma = new PrismaClient();

interface IngestionConfig {
  season: number;
  playerIds?: string[]; // If not provided, fetches all verified players
  dryRun?: boolean;
  verbose?: boolean;
}

async function ingestPlayerGameLogs(
  provider: BalldontlieProvider,
  playerId: string,
  season: number,
  options: { dryRun?: boolean; verbose?: boolean } = {}
): Promise<{ ingested: number; errors: number }> {
  const { dryRun = false, verbose = false } = options;
  
  try {
    // Fetch game logs from balldontlie
    const result = await provider.getGameLogs(playerId, { season });
    const gameLogs = result.data;
    
    if (gameLogs.length === 0) {
      if (verbose) console.log(`  No games found for player ${playerId}`);
      return { ingested: 0, errors: 0 };
    }
    
    if (verbose) console.log(`  Found ${gameLogs.length} games for player ${playerId}`);
    
    if (dryRun) {
      return { ingested: gameLogs.length, errors: 0 };
    }
    
    let ingested = 0;
    let errors = 0;
    
    for (const log of gameLogs) {
      try {
        // Upsert to database (idempotent via natural key)
        await prisma.playerGameLog.upsert({
          where: {
            playerMlbamId_gamePk: {
              playerMlbamId: log.playerMlbamId,
              gamePk: log.gamePk
            }
          },
          update: {
            // Update only if data changed
            atBats: log.atBats,
            hits: log.hits,
            homeRuns: log.homeRuns,
            rbi: log.rbi,
            updatedAt: new Date()
          },
          create: {
            id: log.id,
            playerId: log.playerId,
            playerMlbamId: log.playerMlbamId,
            season: log.season,
            gameDate: log.gameDate,
            gamePk: log.gamePk,
            homeTeamId: log.homeTeamId,
            awayTeamId: log.awayTeamId,
            isHomeGame: log.isHomeGame,
            teamId: log.teamId,
            teamMlbamId: log.teamMlbamId,
            opponentId: log.opponentId,
            position: log.position,
            gamesPlayed: log.gamesPlayed,
            atBats: log.atBats,
            runs: log.runs,
            hits: log.hits,
            doubles: log.doubles,
            triples: log.triples,
            homeRuns: log.homeRuns,
            rbi: log.rbi,
            stolenBases: log.stolenBases,
            caughtStealing: log.caughtStealing,
            walks: log.walks,
            strikeouts: log.strikeouts,
            hitByPitch: log.hitByPitch,
            sacrificeFlies: log.sacrificeFlies,
            plateAppearances: log.plateAppearances,
            totalBases: log.totalBases,
            rawDataSource: log.rawDataSource,
            ingestedAt: new Date()
          }
        });
        ingested++;
      } catch (error) {
        console.error(`    Failed to store game ${log.gamePk}:`, error);
        errors++;
      }
    }
    
    return { ingested, errors };
  } catch (error) {
    console.error(`  Failed to fetch games for player ${playerId}:`, error);
    return { ingested: 0, errors: 1 };
  }
}

async function runIngestion(config: IngestionConfig): Promise<void> {
  const { season, playerIds, dryRun = false, verbose = false } = config;
  
  console.log('🚀 Balldontlie Database Ingestion Pipeline\n');
  console.log('═'.repeat(80));
  console.log(`Season: ${season}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('═'.repeat(80));
  
  // Initialize provider
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY environment variable required');
  }
  
  const provider = new BalldontlieProvider({
    apiKey,
    cache: new MemoryCache()
  });
  
  // Get players to ingest
  let playersToIngest: string[] = [];
  
  if (playerIds && playerIds.length > 0) {
    playersToIngest = playerIds;
  } else {
    // Get verified players from database
    const verifiedPlayers = await prisma.verifiedPlayer.findMany({
      where: { isActive: true },
      select: { mlbamId: true }
    });
    playersToIngest = verifiedPlayers.map(p => p.mlbamId);
  }
  
  console.log(`\n📋 Players to ingest: ${playersToIngest.length}`);
  
  if (playersToIngest.length === 0) {
    console.log('⚠️ No players found. Run verified player sync first.');
    return;
  }
  
  // Ingest game logs for each player
  let totalIngested = 0;
  let totalErrors = 0;
  let processedCount = 0;
  
  const startTime = Date.now();
  
  for (const playerId of playersToIngest) {
    processedCount++;
    
    if (verbose || processedCount % 10 === 0) {
      console.log(`\n[${processedCount}/${playersToIngest.length}] Processing player ${playerId}...`);
    }
    
    const result = await ingestPlayerGameLogs(provider, playerId, season, { dryRun, verbose });
    totalIngested += result.ingested;
    totalErrors += result.errors;
    
    // Progress update every 10 players
    if (processedCount % 10 === 0) {
      const elapsed = Date.now() - startTime;
      const rate = processedCount / (elapsed / 1000);
      console.log(`  Progress: ${processedCount}/${playersToIngest.length} (${rate.toFixed(2)} players/sec)`);
      console.log(`  Ingested: ${totalIngested} games, Errors: ${totalErrors}`);
    }
  }
  
  const totalTime = Date.now() - startTime;
  
  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('📊 INGESTION SUMMARY\n');
  console.log(`Players processed: ${processedCount}`);
  console.log(`Games ingested: ${totalIngested}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Rate: ${(totalIngested / (totalTime / 1000)).toFixed(2)} games/sec`);
  
  if (!dryRun) {
    // Log to system events
    await prisma.systemEvent.create({
      data: {
        eventId: `ingestion-${Date.now()}`,
        eventType: 'balldontlie_ingestion_complete',
        timestamp: new Date(),
        payload: {
          season,
          playersProcessed: processedCount,
          gamesIngested: totalIngested,
          errors: totalErrors,
          durationMs: totalTime
        },
        metadata: {}
      }
    });
  }
  
  console.log('\n✅ Ingestion complete!');
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const playerIds = args
    .filter(arg => arg.startsWith('--player='))
    .map(arg => arg.split('=')[1]);
  
  const season = 2025; // TODO: Make configurable
  
  try {
    await runIngestion({ season, playerIds: playerIds.length > 0 ? playerIds : undefined, dryRun, verbose });
  } catch (error) {
    console.error('\n❌ Ingestion failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
