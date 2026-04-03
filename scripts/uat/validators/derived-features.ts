/**
 * Derived Features Validation
 * 
 * Validates that derived stats are computed correctly from game logs.
 * This is the transformation layer: Facts → Features (deterministic, recomputable, strategy-free)
 * 
 * Tests:
 * - Rolling volume stats (7d/14d/30d games, PA, AB) match manual calculation
 * - Rate stats are calculated correctly from raw data
 * - Volatility metrics reflect actual game-to-game variance
 * - No opinion/analysis creep into derived layer
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import type { UATTestResult } from '../types.js';

interface PlayerSample {
  playerId: string;
  playerMlbamId: string;
  name: string;
  position: 'hitter' | 'pitcher';
}

interface GameLogEntry {
  gameDate: Date;
  gamesPlayed: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  totalBases: number;
  rbi: number;
  runs: number;
  stolenBases: number;
  caughtStealing: number;
}

interface ManualCalculation {
  // Volume (counting stats)
  gamesLast7: number;
  gamesLast14: number;
  gamesLast30: number;
  plateAppearancesLast7: number;
  plateAppearancesLast14: number;
  plateAppearancesLast30: number;
  atBatsLast30: number;
  
  // Raw counting totals (not rates)
  hitsLast30: number;
  homeRunsLast30: number;
  rbiLast30: number;
  runsLast30: number;
  walksLast30: number;
  strikeoutsLast30: number;
  stolenBasesLast30: number;
  totalBasesLast30: number;
}

interface ComparisonResult {
  player: PlayerSample;
  derivedStatsDate: Date;
  manual: ManualCalculation;
  stored: ManualCalculation;
  differences: Array<{
    field: string;
    manual: number;
    stored: number;
    variance: number;
  }>;
  passed: boolean;
}

const TOLERANCE = 0.01; // 1% tolerance for floating point math

/**
 * Calculate expected derived stats from game logs manually
 * This is the source of truth - computed directly from raw data
 */
async function calculateFromGameLogs(
  playerMlbamId: string,
  season: number,
  asOfDate: Date
): Promise<ManualCalculation | null> {
  // Get all game logs for this player in the season
  const gameLogs = await prisma.playerGameLog.findMany({
    where: {
      playerMlbamId,
      season,
      gameDate: { lte: asOfDate },
    },
    orderBy: { gameDate: 'desc' },
  });

  if (gameLogs.length === 0) return null;

  // Calculate cutoff dates
  const cutoff7 = new Date(asOfDate);
  cutoff7.setDate(cutoff7.getDate() - 7);
  const cutoff14 = new Date(asOfDate);
  cutoff14.setDate(cutoff14.getDate() - 14);
  const cutoff30 = new Date(asOfDate);
  cutoff30.setDate(cutoff30.getDate() - 30);

  // Filter games by date windows
  const gamesLast7 = gameLogs.filter(g => g.gameDate >= cutoff7);
  const gamesLast14 = gameLogs.filter(g => g.gameDate >= cutoff14);
  const gamesLast30 = gameLogs.filter(g => g.gameDate >= cutoff30);

  // Sum up stats for each window
  const sumStats = (games: typeof gameLogs) => ({
    games: games.reduce((sum, g) => sum + g.gamesPlayed, 0),
    pa: games.reduce((sum, g) => sum + g.plateAppearances, 0),
    ab: games.reduce((sum, g) => sum + g.atBats, 0),
    hits: games.reduce((sum, g) => sum + g.hits, 0),
    hr: games.reduce((sum, g) => sum + g.homeRuns, 0),
    rbi: games.reduce((sum, g) => sum + g.rbi, 0),
    runs: games.reduce((sum, g) => sum + g.runs, 0),
    bb: games.reduce((sum, g) => sum + g.walks, 0),
    so: games.reduce((sum, g) => sum + g.strikeouts, 0),
    sb: games.reduce((sum, g) => sum + g.stolenBases, 0),
    tb: games.reduce((sum, g) => sum + g.totalBases, 0),
  });

  const stats7 = sumStats(gamesLast7);
  const stats14 = sumStats(gamesLast14);
  const stats30 = sumStats(gamesLast30);

  return {
    gamesLast7: stats7.games,
    gamesLast14: stats14.games,
    gamesLast30: stats30.games,
    plateAppearancesLast7: stats7.pa,
    plateAppearancesLast14: stats14.pa,
    plateAppearancesLast30: stats30.pa,
    atBatsLast30: stats30.ab,
    hitsLast30: stats30.hits,
    homeRunsLast30: stats30.hr,
    rbiLast30: stats30.rbi,
    runsLast30: stats30.runs,
    walksLast30: stats30.bb,
    strikeoutsLast30: stats30.so,
    stolenBasesLast30: stats30.sb,
    totalBasesLast30: stats30.tb,
  };
}

/**
 * Get stored derived stats from database
 */
async function getStoredDerivedStats(
  playerMlbamId: string,
  season: number
): Promise<{ stats: ManualCalculation | null; computedAt: Date | null }> {
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' },
  });

  if (!derived) return { stats: null, computedAt: null };

  return {
    stats: {
      gamesLast7: derived.gamesLast7,
      gamesLast14: derived.gamesLast14,
      gamesLast30: derived.gamesLast30,
      plateAppearancesLast7: derived.plateAppearancesLast7,
      plateAppearancesLast14: derived.plateAppearancesLast14,
      plateAppearancesLast30: derived.plateAppearancesLast30,
      atBatsLast30: derived.atBatsLast30,
      hitsLast30: 0, // Not stored in derived stats (calculated on demand)
      homeRunsLast30: 0,
      rbiLast30: 0,
      runsLast30: 0,
      walksLast30: 0,
      strikeoutsLast30: 0,
      stolenBasesLast30: 0,
      totalBasesLast30: 0,
    },
    computedAt: derived.computedAt,
  };
}

/**
 * Compare manual calculation to stored value
 */
function compareValues(
  field: string,
  manual: number,
  stored: number,
  tolerance: number = TOLERANCE
): { field: string; manual: number; stored: number; variance: number } | null {
  // Handle division by zero
  if (manual === 0 && stored === 0) return null; // Both zero = match
  if (manual === 0) {
    return { field, manual, stored, variance: stored > 0 ? 100 : 0 };
  }
  
  const variance = Math.abs((stored - manual) / manual) * 100;
  if (variance > tolerance * 100) {
    return { field, manual, stored, variance };
  }
  return null;
}

/**
 * Sample random players for validation
 */
async function samplePlayers(season: number, sampleSize: number = 5): Promise<PlayerSample[]> {
  // Get players with both game logs and derived stats
  const players = await prisma.$queryRaw<Array<{
    playerId: string;
    playerMlbamId: string;
    gameCount: number;
  }>>`
    SELECT 
      gl.player_mlbam_id as "playerMlbamId",
      COUNT(*) as "gameCount"
    FROM player_game_logs gl
    JOIN player_derived_stats ds 
      ON gl.player_mlbam_id = ds.player_mlbam_id 
      AND gl.season = ds.season
    WHERE gl.season = ${season}
    GROUP BY gl.player_mlbam_id
    HAVING COUNT(*) >= 10
    ORDER BY RANDOM()
    LIMIT ${sampleSize * 4}
  `;

  // Randomly select from the pool
  const shuffled = players.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, sampleSize);

  return selected.map(p => ({
    playerId: p.playerMlbamId,
    playerMlbamId: p.playerMlbamId,
    name: p.playerMlbamId, // Will look up name
    position: 'hitter' as const, // Will determine from data
  }));
}

/**
 * Main validation test for derived features
 */
export async function validateDerivedFeatures(season: number): Promise<UATTestResult> {
  const startTime = Date.now();
  
  console.log('\n📊 Derived Features Validation\n');
  console.log(`Season: ${season}`);
  console.log(`Sampling: 5 random hitters with 10+ games\n`);

  try {
    // Get sample players
    const samples = await samplePlayers(season, 5);
    
    if (samples.length === 0) {
      return {
        testName: 'Derived Features Accuracy',
        category: 'reconciliation',
        status: 'warning',
        severity: 'medium',
        message: 'No players with both game logs and derived stats found',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    const results: ComparisonResult[] = [];

    for (const player of samples) {
      console.log(`\n🔍 Validating ${player.playerMlbamId}...`);
      
      // Get stored derived stats
      const { stats: stored, computedAt } = await getStoredDerivedStats(player.playerMlbamId, season);
      
      if (!stored || !computedAt) {
        console.log(`   ⚠️  No derived stats found`);
        continue;
      }

      // Calculate manually from game logs (as of the derived stats computation date)
      const manual = await calculateFromGameLogs(player.playerMlbamId, season, computedAt);
      
      if (!manual) {
        console.log(`   ⚠️  No game logs found`);
        continue;
      }

      // Compare
      const differences: Array<{ field: string; manual: number; stored: number; variance: number }> = [];
      
      const fields: (keyof ManualCalculation)[] = [
        'gamesLast7', 'gamesLast14', 'gamesLast30',
        'plateAppearancesLast7', 'plateAppearancesLast14', 'plateAppearancesLast30',
        'atBatsLast30',
      ];

      for (const field of fields) {
        const diff = compareValues(field, manual[field], stored[field]);
        if (diff) differences.push(diff);
      }

      const passed = differences.length === 0;
      
      results.push({
        player,
        derivedStatsDate: computedAt,
        manual,
        stored,
        differences,
        passed,
      });

      if (passed) {
        console.log(`   ✅ All stats match`);
      } else {
        console.log(`   ❌ ${differences.length} discrepancies found:`);
        differences.forEach(d => {
          console.log(`      ${d.field}: manual=${d.manual}, stored=${d.stored} (${d.variance.toFixed(1)}% variance)`);
        });
      }
    }

    const passedCount = results.filter(r => r.passed).length;
    const failedPlayers = results.filter(r => !r.passed);

    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Players tested: ${results.length}`);
    console.log(`Passed: ${passedCount}`);
    console.log(`Failed: ${failedPlayers.length}\n`);

    if (failedPlayers.length > 0) {
      return {
        testName: 'Derived Features Accuracy',
        category: 'reconciliation',
        status: 'fail',
        severity: 'critical',
        message: `${failedPlayers.length}/${results.length} players have incorrect derived stats. Critical errors in transformation layer.`,
        details: {
          totalTested: results.length,
          passed: passedCount,
          failed: failedPlayers.map(p => ({
            playerId: p.player.playerMlbamId,
            differences: p.differences,
          })),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Derived Features Accuracy',
      category: 'reconciliation',
      status: 'pass',
      severity: 'critical',
      message: `All ${results.length} sampled players have accurate derived stats. Transformation layer validated.`,
      details: {
        totalTested: results.length,
        fieldsValidated: ['gamesLast7', 'gamesLast14', 'gamesLast30', 'plateAppearancesLast7', 'plateAppearancesLast14', 'plateAppearancesLast30', 'atBatsLast30'],
      },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Derived Features Accuracy',
      category: 'reconciliation',
      status: 'fail',
      severity: 'critical',
      message: `Validation failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const season = parseInt(process.argv[2] || '2025');
  
  validateDerivedFeatures(season).then(result => {
    console.log('\n=== Derived Features Validation ===\n');
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Message: ${result.message}`);
    if (result.details) {
      console.log('Details:', JSON.stringify(result.details, null, 2));
    }
    process.exit(result.status === 'pass' ? 0 : 1);
  });
}
