/**
 * Row Count Drift Detection
 * 
 * Validates that record counts are consistent across pipeline stages.
 * Critical for ensuring no data loss or unexpected duplication.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import type { UATTestResult, DriftCheckConfig } from '../types.js';

interface StageCount {
  stage: string;
  count: number;
  details?: Record<string, number>;
}

/**
 * Check for row count drift between raw ingestion and normalized data
 */
export async function checkRawToNormalizedDrift(
  config: DriftCheckConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season, acceptableVariancePercent } = config;

  try {
    // Get raw ingestion counts
    const rawCounts = await prisma.rawIngestionLog.groupBy({
      by: ['source'],
      where: { season },
      _sum: { recordCount: true },
    });

    const rawSeasonStats = rawCounts.find(r => r.source === 'mlb_stats_api')?._sum.recordCount || 0;
    const rawGameLogs = rawCounts.find(r => r.source === 'mlb_stats_api:gamelog')?._sum.recordCount || 0;

    // Get normalized counts
    const normalizedSeasonStats = await prisma.playerDailyStats.count({
      where: { 
        season,
        rawDataSource: 'mlb_stats_api'
      },
    });

    const normalizedGameLogs = await prisma.playerDailyStats.count({
      where: { 
        season,
        rawDataSource: 'mlb_stats_api:gamelog'
      },
    });

    // Get derived feature counts
    const derivedStats = await prisma.playerDerivedStats.count({
      where: { season },
    });

    // Get game log table count (more accurate for game-by-game)
    const gameLogTableCount = await prisma.playerGameLog.count({
      where: { season },
    });

    const stages: StageCount[] = [
      { stage: 'raw_season_stats', count: rawSeasonStats },
      { stage: 'raw_game_logs', count: rawGameLogs },
      { stage: 'normalized_season_stats', count: normalizedSeasonStats },
      { stage: 'normalized_game_logs', count: normalizedGameLogs },
      { stage: 'game_log_table', count: gameLogTableCount },
      { stage: 'derived_features', count: derivedStats },
    ];

    // Check for drift between raw and normalized season stats
    const seasonStatsDrift = calculateDriftPercent(rawSeasonStats, normalizedSeasonStats);
    const gameLogDrift = calculateDriftPercent(rawGameLogs, normalizedGameLogs);

    const issues: string[] = [];
    
    if (seasonStatsDrift > acceptableVariancePercent) {
      issues.push(`Season stats drift: ${seasonStatsDrift.toFixed(2)}% (raw=${rawSeasonStats}, normalized=${normalizedSeasonStats})`);
    }
    
    if (gameLogDrift > acceptableVariancePercent && rawGameLogs > 0) {
      issues.push(`Game log drift: ${gameLogDrift.toFixed(2)}% (raw=${rawGameLogs}, normalized=${normalizedGameLogs})`);
    }

    // Critical: Game log table should match or exceed raw game logs
    if (gameLogTableCount < rawGameLogs * 0.95) {
      issues.push(`Game log table undercount: ${gameLogTableCount} vs raw ${rawGameLogs}`);
    }

    if (issues.length > 0) {
      return {
        testName: 'Raw to Normalized Row Count Drift',
        category: 'row_count',
        status: 'fail',
        severity: 'critical',
        message: `Row count drift detected: ${issues.join('; ')}`,
        details: { stages, issues, thresholds: { acceptableVariancePercent } },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Raw to Normalized Row Count Drift',
      category: 'row_count',
      status: 'pass',
      severity: 'critical',
      message: `Row counts consistent across all stages. Max drift: ${Math.max(seasonStatsDrift, gameLogDrift).toFixed(2)}%`,
      details: { stages },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Raw to Normalized Row Count Drift',
      category: 'row_count',
      status: 'fail',
      severity: 'critical',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for count stability across multiple ingestion runs
 */
export async function checkIngestionStability(
  config: DriftCheckConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season } = config;

  try {
    // Get recent ingestion runs
    const recentIngestions = await prisma.rawIngestionLog.findMany({
      where: { season },
      orderBy: { fetchedAt: 'desc' },
      take: 5,
      select: {
        cacheKey: true,
        recordCount: true,
        fetchedAt: true,
      },
    });

    if (recentIngestions.length < 2) {
      return {
        testName: 'Ingestion Stability',
        category: 'row_count',
        status: 'warning',
        severity: 'medium',
        message: 'Insufficient ingestion history for stability check (need 2+ runs)',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    // Group by source type
    const bySource = new Map<string, Array<{ count: number; date: Date }>>();
    
    for (const ingestion of recentIngestions) {
      const source = ingestion.cacheKey.split(':').slice(0, 2).join(':');
      if (!bySource.has(source)) {
        bySource.set(source, []);
      }
      bySource.get(source)!.push({
        count: ingestion.recordCount,
        date: ingestion.fetchedAt,
      });
    }

    const issues: string[] = [];
    
    for (const [source, runs] of bySource) {
      if (runs.length < 2) continue;
      
      const counts = runs.map(r => r.count);
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      const variance = max - min;
      const variancePercent = min > 0 ? (variance / min) * 100 : 0;

      if (variancePercent > config.acceptableVariancePercent) {
        issues.push(`${source}: ${variancePercent.toFixed(2)}% variance (${min}-${max} records)`);
      }
    }

    if (issues.length > 0) {
      return {
        testName: 'Ingestion Stability',
        category: 'row_count',
        status: 'fail',
        severity: 'high',
        message: `Unstable ingestion counts detected: ${issues.join('; ')}`,
        details: { recentIngestions: recentIngestions.length, issues },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Ingestion Stability',
      category: 'row_count',
      status: 'pass',
      severity: 'high',
      message: `Ingestion counts stable across ${recentIngestions.length} recent runs`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Ingestion Stability',
      category: 'row_count',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Verify player coverage completeness
 */
export async function checkPlayerCoverage(
  config: DriftCheckConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season, sampleSize = 100 } = config;

  try {
    // Get unique player counts from different tables
    const [gameLogPlayers, dailyStatsPlayers, derivedStatsPlayers, verifiedPlayers] = await Promise.all([
      prisma.playerGameLog.groupBy({
        by: ['playerMlbamId'],
        where: { season },
        _count: { playerMlbamId: true },
      }),
      prisma.playerDailyStats.groupBy({
        by: ['playerMlbamId'],
        where: { season },
        _count: { playerMlbamId: true },
      }),
      prisma.playerDerivedStats.groupBy({
        by: ['playerMlbamId'],
        where: { season },
        _count: { playerMlbamId: true },
      }),
      prisma.verifiedPlayer.count({
        where: { isActive: true },
      }),
    ]);

    const gameLogPlayerCount = gameLogPlayers.length;
    const dailyStatsPlayerCount = dailyStatsPlayers.length;
    const derivedStatsPlayerCount = derivedStatsPlayers.length;

    const issues: string[] = [];

    // Check for player coverage gaps
    if (dailyStatsPlayerCount < verifiedPlayers * 0.5) {
      issues.push(`Low player coverage: ${dailyStatsPlayerCount} stats vs ${verifiedPlayers} verified active players`);
    }

    // Check for pipeline stage consistency
    const gameLogToDailyDrift = calculateDriftPercent(gameLogPlayerCount, dailyStatsPlayerCount);
    if (gameLogToDailyDrift > 20) {
      issues.push(`Player coverage drift between game logs (${gameLogPlayerCount}) and daily stats (${dailyStatsPlayerCount})`);
    }

    // Find players with game logs but missing derived stats
    const gameLogPlayerIds = new Set(gameLogPlayers.map(p => p.playerMlbamId));
    const derivedPlayerIds = new Set(derivedStatsPlayers.map(p => p.playerMlbamId));
    
    const missingDerived: string[] = [];
    for (const playerId of gameLogPlayerIds) {
      if (!derivedPlayerIds.has(playerId)) {
        missingDerived.push(playerId);
        if (missingDerived.length >= 10) break;
      }
    }

    if (missingDerived.length > 0) {
      issues.push(`${missingDerived.length}+ players have game logs but no derived stats (examples: ${missingDerived.slice(0, 3).join(', ')})`);
    }

    if (issues.length > 0) {
      return {
        testName: 'Player Coverage Completeness',
        category: 'row_count',
        status: 'fail',
        severity: 'high',
        message: `Player coverage issues: ${issues.join('; ')}`,
        details: {
          gameLogPlayers: gameLogPlayerCount,
          dailyStatsPlayers: dailyStatsPlayerCount,
          derivedStatsPlayers: derivedStatsPlayerCount,
          verifiedActivePlayers: verifiedPlayers,
          missingDerived: missingDerived.length,
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Player Coverage Completeness',
      category: 'row_count',
      status: 'pass',
      severity: 'high',
      message: `Player coverage consistent: ${gameLogPlayerCount} with game logs, ${dailyStatsPlayerCount} with stats, ${derivedStatsPlayerCount} with derived features`,
      details: {
        gameLogPlayers: gameLogPlayerCount,
        dailyStatsPlayers: dailyStatsPlayerCount,
        derivedStatsPlayers: derivedStatsPlayerCount,
        verifiedActivePlayers: verifiedPlayers,
      },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Player Coverage Completeness',
      category: 'row_count',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

function calculateDriftPercent(expected: number, actual: number): number {
  if (expected === 0) return actual === 0 ? 0 : 100;
  return Math.abs((actual - expected) / expected) * 100;
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const season = parseInt(process.argv[2] || '2025');
  const config: DriftCheckConfig = {
    season,
    acceptableVariancePercent: 5,
  };

  Promise.all([
    checkRawToNormalizedDrift(config),
    checkIngestionStability(config),
    checkPlayerCoverage(config),
  ]).then(results => {
    console.log('\n=== Row Count Drift Detection Results ===\n');
    for (const result of results) {
      const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${icon} [${result.severity.toUpperCase()}] ${result.testName}`);
      console.log(`   Status: ${result.status.toUpperCase()}`);
      console.log(`   Message: ${result.message}`);
      if (result.details) {
        console.log(`   Details:`, JSON.stringify(result.details, null, 2));
      }
      console.log();
    }
    process.exit(results.some(r => r.status === 'fail' && r.severity === 'critical') ? 1 : 0);
  });
}
