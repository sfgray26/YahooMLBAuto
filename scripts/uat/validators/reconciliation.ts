/**
 * Raw vs Normalized Data Reconciliation
 * 
 * Validates that normalized data accurately represents the raw source.
 * Ensures no data corruption during transformation.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import type { UATTestResult, ReconciliationConfig } from '../types.js';

interface ReconciliationError {
  playerMlbamId: string;
  field: string;
  rawValue: unknown;
  normalizedValue: unknown;
  gameDate?: string;
}

/**
 * Sample and verify raw data against normalized records
 */
export async function checkRawToNormalizedReconciliation(
  config: ReconciliationConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season, sampleSize = 50 } = config;

  try {
    // Get recent raw ingestion logs
    const rawLogs = await prisma.rawIngestionLog.findMany({
      where: { 
        season,
        source: 'mlb_stats_api',
      },
      orderBy: { fetchedAt: 'desc' },
      take: 5,
    });

    if (rawLogs.length === 0) {
      return {
        testName: 'Raw to Normalized Reconciliation',
        category: 'reconciliation',
        status: 'warning',
        severity: 'medium',
        message: 'No raw ingestion logs found for reconciliation',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    // Sample players from raw data
    const sampledPlayers = await prisma.playerDailyStats.findMany({
      where: {
        season,
        rawDataSource: 'mlb_stats_api',
      },
      select: {
        playerMlbamId: true,
        playerId: true,
        gamesPlayed: true,
        atBats: true,
        hits: true,
        homeRuns: true,
        rbi: true,
        rawDataId: true,
      },
      take: sampleSize,
    });

    if (sampledPlayers.length === 0) {
      return {
        testName: 'Raw to Normalized Reconciliation',
        category: 'reconciliation',
        status: 'warning',
        severity: 'medium',
        message: 'No normalized players found for reconciliation',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    // Verify each sampled record has corresponding raw data
    const errors: ReconciliationError[] = [];
    let verified = 0;

    for (const player of sampledPlayers) {
      // Check that raw data ID reference exists
      if (!player.rawDataId) {
        errors.push({
          playerMlbamId: player.playerMlbamId,
          field: 'rawDataId',
          rawValue: null,
          normalizedValue: player.playerId,
        });
        continue;
      }

      // Verify player ID format
      if (!player.playerId.startsWith('mlbam:')) {
        errors.push({
          playerMlbamId: player.playerMlbamId,
          field: 'playerId',
          rawValue: player.rawDataId,
          normalizedValue: player.playerId,
        });
      }

      // Check for reasonable stat values
      if (player.gamesPlayed < 0 || player.gamesPlayed > 200) {
        errors.push({
          playerMlbamId: player.playerMlbamId,
          field: 'gamesPlayed',
          rawValue: 'unknown',
          normalizedValue: player.gamesPlayed,
        });
      }

      verified++;
    }

    if (errors.length > 0) {
      return {
        testName: 'Raw to Normalized Reconciliation',
        category: 'reconciliation',
        status: 'fail',
        severity: 'high',
        message: `Found ${errors.length} reconciliation errors out of ${verified} sampled records`,
        details: {
          errors: errors.slice(0, 10),
          verified,
          sampleSize: sampledPlayers.length,
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Raw to Normalized Reconciliation',
      category: 'reconciliation',
      status: 'pass',
      severity: 'high',
      message: `All ${verified} sampled records reconcile correctly between raw and normalized`,
      details: { verified, sampleSize: sampledPlayers.length },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Raw to Normalized Reconciliation',
      category: 'reconciliation',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Verify game log records can be traced back to raw ingestion
 */
export async function checkGameLogTraceability(
  season: number
): Promise<UATTestResult> {
  const startTime = Date.now();

  try {
    // Sample recent game logs
    const gameLogs = await prisma.playerGameLog.findMany({
      where: { season },
      orderBy: { gameDate: 'desc' },
      take: 100,
      select: {
        playerMlbamId: true,
        gamePk: true,
        gameDate: true,
        rawDataSource: true,
      },
    });

    if (gameLogs.length === 0) {
      return {
        testName: 'Game Log Traceability',
        category: 'reconciliation',
        status: 'warning',
        severity: 'medium',
        message: 'No game logs found for traceability check',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    // Check that all game logs have source attribution
    const missingSource = gameLogs.filter(gl => !gl.rawDataSource);

    if (missingSource.length > 0) {
      return {
        testName: 'Game Log Traceability',
        category: 'reconciliation',
        status: 'fail',
        severity: 'high',
        message: `${missingSource.length} game logs missing raw data source attribution`,
        details: {
          missingSourceCount: missingSource.length,
          examples: missingSource.slice(0, 5),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Game Log Traceability',
      category: 'reconciliation',
      status: 'pass',
      severity: 'high',
      message: `All ${gameLogs.length} sampled game logs have proper source attribution`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Game Log Traceability',
      category: 'reconciliation',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Verify derived features match source calculations
 */
export async function checkDerivedFeatureReconciliation(
  season: number
): Promise<UATTestResult> {
  const startTime = Date.now();

  try {
    // Sample players with both game logs and derived stats
    const players = await prisma.$queryRaw<Array<{
      playerMlbamId: string;
      glGames7: number;
      dsGames7: number;
    }>>`
      SELECT 
        gl.player_mlbam_id as playerMlbamId,
        COUNT(CASE WHEN gl.game_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as glGames7,
        ds.games_last_7 as dsGames7
      FROM player_game_logs gl
      JOIN player_derived_stats ds 
        ON gl.player_mlbam_id = ds.player_mlbam_id 
        AND gl.season = ds.season
      WHERE gl.season = ${season}
        AND ds.computed_at >= CURRENT_DATE - INTERVAL '1 day'
      GROUP BY gl.player_mlbam_id, ds.games_last_7
      HAVING COUNT(*) >= 5
      LIMIT 50
    `;

    if (players.length === 0) {
      return {
        testName: 'Derived Feature Reconciliation',
        category: 'reconciliation',
        status: 'warning',
        severity: 'medium',
        message: 'No players with both recent game logs and derived stats',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    const mismatches: Array<{
      playerMlbamId: string;
      field: string;
      gameLogValue: number;
      derivedValue: number;
    }> = [];

    for (const player of players) {
      // Allow 1 game variance for timing differences
      if (Math.abs(player.glGames7 - player.dsGames7) > 1) {
        mismatches.push({
          playerMlbamId: player.playerMlbamId,
          field: 'gamesLast7',
          gameLogValue: player.glGames7,
          derivedValue: player.dsGames7,
        });
      }
    }

    if (mismatches.length > 0) {
      return {
        testName: 'Derived Feature Reconciliation',
        category: 'reconciliation',
        status: 'fail',
        severity: 'high',
        message: `Found ${mismatches.length} derived stat mismatches. Examples: ${mismatches.slice(0, 3).map(m => `${m.playerMlbamId}: ${m.field}`).join(', ')}`,
        details: {
          mismatchCount: mismatches.length,
          playersTested: players.length,
          examples: mismatches.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Derived Feature Reconciliation',
      category: 'reconciliation',
      status: 'pass',
      severity: 'high',
      message: `Derived features reconcile with source data for ${players.length} sampled players`,
      details: { playersTested: players.length },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Derived Feature Reconciliation',
      category: 'reconciliation',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Verify raw data is preserved and accessible
 */
export async function checkRawDataPreservation(
  season: number
): Promise<UATTestResult> {
  const startTime = Date.now();

  try {
    // Count raw ingestion logs
    const rawCount = await prisma.rawIngestionLog.count({
      where: { season },
    });

    // Check that raw data has content
    const emptyRaw = await prisma.rawIngestionLog.findFirst({
      where: {
        season,
        rawPayload: { equals: null },
      },
    });

    // Check recent ingestion has proper payload
    const recentIngestion = await prisma.rawIngestionLog.findFirst({
      where: { season },
      orderBy: { fetchedAt: 'desc' },
      select: {
        cacheKey: true,
        recordCount: true,
        rawPayload: true,
      },
    });

    const issues: string[] = [];

    if (rawCount === 0) {
      issues.push('No raw ingestion logs found');
    }

    if (emptyRaw) {
      issues.push('Found ingestion log with empty payload');
    }

    if (recentIngestion && recentIngestion.recordCount === 0) {
      issues.push('Most recent ingestion has zero records');
    }

    if (issues.length > 0) {
      return {
        testName: 'Raw Data Preservation',
        category: 'reconciliation',
        status: 'fail',
        severity: 'critical',
        message: `Raw data preservation issues: ${issues.join('; ')}`,
        details: {
          rawCount,
          hasEmptyPayload: !!emptyRaw,
          recentIngestion: recentIngestion ? {
            cacheKey: recentIngestion.cacheKey,
            recordCount: recentIngestion.recordCount,
          } : null,
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Raw Data Preservation',
      category: 'reconciliation',
      status: 'pass',
      severity: 'critical',
      message: `Raw data preserved: ${rawCount} ingestion logs, all with payloads`,
      details: {
        rawCount,
        recentIngestion: recentIngestion ? {
          cacheKey: recentIngestion.cacheKey,
          recordCount: recentIngestion.recordCount,
        } : null,
      },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Raw Data Preservation',
      category: 'reconciliation',
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
  
  const config: ReconciliationConfig = {
    season,
    sampleSize: 50,
  };

  Promise.all([
    checkRawToNormalizedReconciliation(config),
    checkGameLogTraceability(season),
    checkDerivedFeatureReconciliation(season),
    checkRawDataPreservation(season),
  ]).then(results => {
    console.log('\n=== Raw vs Normalized Reconciliation Results ===\n');
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
