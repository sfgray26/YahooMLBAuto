/**
 * Stat Inflation Detection
 * 
 * Validates that aggregated statistics from game logs match season totals.
 * Prevents double-counting and ensures data consistency.
 */

import { prisma } from '@cbb/infrastructure';
import type { UATTestResult, StatAggregationConfig } from '../types.js';

interface StatComparison {
  playerMlbamId: string;
  statName: string;
  gameLogTotal: number;
  seasonStat: number;
  variance: number;
  variancePercent: number;
}

const COUNTING_STATS = [
  'gamesPlayed',
  'atBats', 
  'hits',
  'homeRuns',
  'rbi',
  'runs',
  'walks',
  'strikeouts',
  'stolenBases',
  'totalBases',
] as const;

/**
 * Compare game log aggregates against season stats for sample players
 */
export async function checkGameLogAggregation(
  config: StatAggregationConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season, playerMlbamIds, statsToValidate = ['gamesPlayed', 'atBats', 'hits', 'homeRuns'] } = config;

  try {
    // If no specific players provided, sample from database
    let samplePlayers = playerMlbamIds;
    if (samplePlayers.length === 0) {
      const players = await prisma.playerGameLog.groupBy({
        by: ['playerMlbamId'],
        where: { season },
        _count: { gamePk: true },
        having: { gamePk: { _count: { gte: 10 } } }, // Players with 10+ games
        take: 20,
      });
      samplePlayers = players.map(p => p.playerMlbamId);
    }

    if (samplePlayers.length === 0) {
      return {
        testName: 'Game Log Aggregation Consistency',
        category: 'stat_inflation',
        status: 'warning',
        severity: 'medium',
        message: 'No players with sufficient game logs for aggregation test',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    const mismatches: StatComparison[] = [];

    for (const mlbamId of samplePlayers) {
      // Get game log aggregates
      const gameLogAgg = await prisma.playerGameLog.aggregate({
        where: { 
          playerMlbamId: mlbamId,
          season,
        },
        _sum: {
          gamesPlayed: true,
          atBats: true,
          hits: true,
          homeRuns: true,
          rbi: true,
          runs: true,
          walks: true,
          strikeouts: true,
          stolenBases: true,
          totalBases: true,
        },
      });

      // Get season stat (from daily stats)
      const seasonStat = await prisma.playerDailyStats.findFirst({
        where: {
          playerMlbamId: mlbamId,
          season,
          rawDataSource: 'mlb_stats_api',
        },
        orderBy: { statDate: 'desc' },
      });

      if (!seasonStat) continue;

      // Compare each stat
      for (const statName of statsToValidate) {
        const gameLogTotal = (gameLogAgg._sum as Record<string, number | null>)[statName] || 0;
        const seasonTotal = (seasonStat as Record<string, number | null>)[statName] || 0;

        const variance = Math.abs(gameLogTotal - seasonTotal);
        const variancePercent = seasonTotal > 0 ? (variance / seasonTotal) * 100 : 0;

        // Allow 5% variance for rounding, substitutions, etc.
        if (variancePercent > 5 && variance > 2) {
          mismatches.push({
            playerMlbamId: mlbamId,
            statName,
            gameLogTotal,
            seasonStat: seasonTotal,
            variance,
            variancePercent,
          });
        }
      }
    }

    if (mismatches.length > 0) {
      const summary = mismatches.slice(0, 5).map(m => 
        `${m.playerMlbamId}.${m.statName}: ${m.gameLogTotal} vs ${m.seasonStat} (${m.variancePercent.toFixed(1)}%)`
      );

      return {
        testName: 'Game Log Aggregation Consistency',
        category: 'stat_inflation',
        status: 'fail',
        severity: 'critical',
        message: `Found ${mismatches.length} stat mismatches between game logs and season totals. Examples: ${summary.join(', ')}`,
        details: {
          mismatchCount: mismatches.length,
          playersTested: samplePlayers.length,
          examples: mismatches.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Game Log Aggregation Consistency',
      category: 'stat_inflation',
      status: 'pass',
      severity: 'critical',
      message: `Game log aggregates match season stats for ${samplePlayers.length} sampled players`,
      details: { playersTested: samplePlayers.length },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Game Log Aggregation Consistency',
      category: 'stat_inflation',
      status: 'fail',
      severity: 'critical',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for derived stats that don't match source game logs
 */
export async function checkDerivedStatsAccuracy(
  config: StatAggregationConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season, playerMlbamIds } = config;

  try {
    // Sample players with both game logs and derived stats
    const players = await prisma.$queryRaw<Array<{ playerMlbamId: string; gameCount: number }>>`
      SELECT 
        gl.player_mlbam_id as playerMlbamId,
        COUNT(*) as gameCount
      FROM player_game_logs gl
      JOIN player_derived_stats ds 
        ON gl.player_mlbam_id = ds.player_mlbam_id 
        AND gl.season = ds.season
      WHERE gl.season = ${season}
      GROUP BY gl.player_mlbam_id
      HAVING COUNT(*) >= 10
      LIMIT 20
    `;

    if (players.length === 0) {
      return {
        testName: 'Derived Stats Accuracy',
        category: 'stat_inflation',
        status: 'warning',
        severity: 'medium',
        message: 'No players with both game logs and derived stats for comparison',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    const issues: Array<{
      playerMlbamId: string;
      issue: string;
      expected: number;
      actual: number;
    }> = [];

    for (const { playerMlbamId } of players) {
      // Get game log aggregates for 30-day window
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const gameLogAgg = await prisma.playerGameLog.aggregate({
        where: {
          playerMlbamId,
          season,
          gameDate: { gte: thirtyDaysAgo },
        },
        _sum: {
          gamesPlayed: true,
          plateAppearances: true,
        },
      });

      // Get latest derived stats
      const derived = await prisma.playerDerivedStats.findFirst({
        where: { playerMlbamId, season },
        orderBy: { computedAt: 'desc' },
      });

      if (!derived) continue;

      const gameLogGames = gameLogAgg._sum.gamesPlayed || 0;
      const derivedGames = derived.gamesLast30;

      // Check for significant variance
      if (Math.abs(gameLogGames - derivedGames) > 2) {
        issues.push({
          playerMlbamId,
          issue: 'gamesLast30 mismatch',
          expected: gameLogGames,
          actual: derivedGames,
        });
      }
    }

    if (issues.length > 0) {
      return {
        testName: 'Derived Stats Accuracy',
        category: 'stat_inflation',
        status: 'fail',
        severity: 'high',
        message: `Found ${issues.length} derived stat accuracy issues. Examples: ${issues.slice(0, 3).map(i => `${i.playerMlbamId}: ${i.issue}`).join(', ')}`,
        details: {
          issueCount: issues.length,
          playersTested: players.length,
          examples: issues.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Derived Stats Accuracy',
      category: 'stat_inflation',
      status: 'pass',
      severity: 'high',
      message: `Derived stats accurately reflect source data for ${players.length} sampled players`,
      details: { playersTested: players.length },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Derived Stats Accuracy',
      category: 'stat_inflation',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for anomalous stat values that could indicate double counting
 */
export async function checkAnomalousStats(
  season: number
): Promise<UATTestResult> {
  const startTime = Date.now();

  try {
    const anomalies: Array<{
      playerMlbamId: string;
      statName: string;
      value: number;
      threshold: number;
    }> = [];

    // Check for impossible game counts (>180 games in a season)
    const highGameCounts = await prisma.playerDailyStats.findMany({
      where: {
        season,
        gamesPlayed: { gt: 180 },
      },
      select: {
        playerMlbamId: true,
        gamesPlayed: true,
      },
      take: 10,
    });

    for (const player of highGameCounts) {
      anomalies.push({
        playerMlbamId: player.playerMlbamId,
        statName: 'gamesPlayed',
        value: player.gamesPlayed,
        threshold: 180,
      });
    }

    // Check for extreme plate appearance counts (>800 PA)
    const highPA = await prisma.playerGameLog.groupBy({
      by: ['playerMlbamId'],
      where: { season },
      _sum: { plateAppearances: true },
      having: { plateAppearances: { _sum: { gt: 800 } } },
      take: 10,
    });

    for (const player of highPA) {
      anomalies.push({
        playerMlbamId: player.playerMlbamId,
        statName: 'plateAppearances',
        value: player._sum.plateAppearances || 0,
        threshold: 800,
      });
    }

    if (anomalies.length > 0) {
      const summary = anomalies.slice(0, 5).map(a => 
        `${a.playerMlbamId}: ${a.value} ${a.statName} (threshold: ${a.threshold})`
      );

      return {
        testName: 'Anomalous Stat Detection',
        category: 'stat_inflation',
        status: 'fail',
        severity: 'critical',
        message: `Found ${anomalies.length} anomalous stat values indicating possible double counting: ${summary.join(', ')}`,
        details: {
          anomalyCount: anomalies.length,
          examples: anomalies.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Anomalous Stat Detection',
      category: 'stat_inflation',
      status: 'pass',
      severity: 'critical',
      message: 'No anomalous stat values detected',
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Anomalous Stat Detection',
      category: 'stat_inflation',
      status: 'fail',
      severity: 'critical',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const season = parseInt(process.argv[2] || '2025');
  
  const config: StatAggregationConfig = {
    season,
    playerMlbamIds: [],
    statsToValidate: ['gamesPlayed', 'atBats', 'hits', 'homeRuns', 'rbi'],
  };

  Promise.all([
    checkGameLogAggregation(config),
    checkDerivedStatsAccuracy(config),
    checkAnomalousStats(season),
  ]).then(results => {
    console.log('\n=== Stat Inflation Detection Results ===\n');
    for (const result of results) {
      const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${icon} [${result.severity.toUpperCase()}] ${result.testName}`);
      console.log(`   Status: ${result.status.toUpperCase()}`);
      console.log(`   Message: ${result.message}`);
      console.log();
    }
    process.exit(results.some(r => r.status === 'fail' && r.severity === 'critical') ? 1 : 0);
  });
}
