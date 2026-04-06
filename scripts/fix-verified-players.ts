#!/usr/bin/env node
/**
 * Fix Verified Players Table
 * 
 * Migrates verified players to use correct balldontlie MLBAM IDs
 */

import { PrismaClient } from '@prisma/client';
import { BalldontlieProvider } from '../packages/data/src/providers/balldontlie.js';
import { MemoryCache } from '../packages/data/src/providers/cache.js';

const prisma = new PrismaClient();

// Known correct MLBAM IDs (verified from balldontlie)
const KNOWN_PLAYERS: Record<string, { name: string; team: string; position: string }> = {
  '592450': { name: 'Aaron Judge', team: 'NYY', position: 'OF' },
  '677951': { name: 'Bobby Witt Jr.', team: 'KC', position: 'SS' },
  '694817': { name: 'Gunnar Henderson', team: 'BAL', position: 'SS' },
  '676979': { name: 'Garrett Crochet', team: 'BOS', position: 'P' },
  '650911': { name: 'Cristopher Sánchez', team: 'PHI', position: 'P' },
  '680694': { name: 'Steven Kwan', team: 'CLE', position: 'OF' },
  '665742': { name: 'Juan Soto', team: 'NYM', position: 'OF' },
  '656305': { name: 'Matt Chapman', team: 'SF', position: '3B' },
  '673237': { name: 'Yainer Diaz', team: 'HOU', position: 'C' },
  '686469': { name: 'Vinnie Pasquantino', team: 'KC', position: '1B' },
  '543760': { name: 'Marcus Semien', team: 'TEX', position: '2B' },
  '672666': { name: 'Geraldo Perdomo', team: 'ARI', position: 'SS' },
  '691023': { name: 'Jordan Walker', team: 'STL', position: 'LF' },
  '621439': { name: 'Byron Buxton', team: 'MIN', position: 'CF' },
  '650333': { name: 'Luis Arraez', team: 'SD', position: '1B' },
  '624413': { name: 'Pete Alonso', team: 'NYM', position: '1B' },
  '621043': { name: 'Brandon Nimmo', team: 'NYM', position: 'LF' },
  '691718': { name: 'Pete Crow-Armstrong', team: 'CHC', position: 'CF' },
  // Add more as needed
};

async function fixVerifiedPlayers() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    console.error('❌ BALLDONTLIE_API_KEY required');
    process.exit(1);
  }

  console.log('🔧 Fixing Verified Players Table\n');
  console.log('═'.repeat(60));

  // Get current verified players
  const currentPlayers = await prisma.verifiedPlayer.findMany();
  console.log(`Found ${currentPlayers.length} verified players`);

  // Track changes
  const fixed: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];

  // Fix known players
  for (const [mlbamId, info] of Object.entries(KNOWN_PLAYERS)) {
    const existing = await prisma.verifiedPlayer.findUnique({
      where: { mlbamId }
    });

    if (!existing) {
      // Add missing player
      await prisma.verifiedPlayer.create({
        data: {
          mlbamId,
          fullName: info.name,
          team: info.team,
          position: info.position,
          isActive: true,
          verifiedAt: new Date(),
        }
      });
      added.push(`${info.name} (${mlbamId})`);
      console.log(`  ✅ Added: ${info.name}`);
    } else if (existing.fullName !== info.name) {
      // Fix name mismatch
      await prisma.verifiedPlayer.update({
        where: { mlbamId },
        data: { fullName: info.name, team: info.team, position: info.position }
      });
      fixed.push(`${mlbamId}: ${existing.fullName} → ${info.name}`);
      console.log(`  🔧 Fixed: ${existing.fullName} → ${info.name}`);
    }
  }

  // Remove invalid players (those with 0 games in 2026)
  for (const player of currentPlayers) {
    const hasKnownMapping = Object.keys(KNOWN_PLAYERS).includes(player.mlbamId);
    
    if (!hasKnownMapping) {
      // Check if this ID returns any 2026 games
      const provider = new BalldontlieProvider({ apiKey, cache: new MemoryCache() });
      try {
        const result = await provider.getGameLogs(player.mlbamId, { season: 2026 });
        if (result.data.length === 0) {
          await prisma.verifiedPlayer.delete({ where: { mlbamId: player.mlbamId } });
          removed.push(`${player.fullName} (${player.mlbamId})`);
          console.log(`  🗑️  Removed: ${player.fullName} (no 2026 games)`);
        }
      } catch (error) {
        console.log(`  ⚠️  Error checking ${player.fullName}: ${error}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('\n📊 Summary:');
  console.log(`  Added: ${added.length}`);
  console.log(`  Fixed: ${fixed.length}`);
  console.log(`  Removed: ${removed.length}`);

  // Show final count
  const finalCount = await prisma.verifiedPlayer.count();
  console.log(`\n  Total verified players: ${finalCount}`);
}

fixVerifiedPlayers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
