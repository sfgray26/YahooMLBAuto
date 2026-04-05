/**
 * Duplicate Detection
 * 
 * Identifies duplicate records that violate natural key constraints.
 * Duplicates lead to stat inflation and incorrect aggregations.
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import type { UATTestResult, DuplicateCheckConfig } from '../types.js';

interface DuplicateGroup {
  key: string;
  count: number;
  ids: string[];
}

/**
 * Check for duplicate game logs (same player + game)
 */
export async function checkDuplicateGameLogs(
  config: DuplicateCheckConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season } = config;

  try {
    // Find duplicate game logs by natural key
    const duplicates = await prisma.$queryRaw<Array<{ player_mlbamId: string; gamePk: string; count: number }>>`
      SELECT player_mlbam_id as playerMlbamId, game_pk as gamePk, COUNT(*) as count
      FROM player_game_logs
      WHERE season = ${season}
      GROUP BY player_mlbam_id, game_pk
      HAVING COUNT(*) > 1
      LIMIT 50
    `;

    if (duplicates.length > 0) {
      const examples = duplicates.slice(0, 5).map(d => 
        `${d.playerMlbamId}:${d.gamePk} (${d.count} copies)`
      );

      return {
        testName: 'Duplicate Game Logs',
        category: 'duplicates',
        status: 'fail',
        severity: 'critical',
        message: `Found ${duplicates.length} duplicate game log entries. Examples: ${examples.join(', ')}`,
        details: {
          duplicateCount: duplicates.length,
          examples: duplicates.slice(0, 10),
          totalDuplicateRecords: duplicates.reduce((sum, d) => sum + d.count, 0),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Duplicate Game Logs',
      category: 'duplicates',
      status: 'pass',
      severity: 'critical',
      message: 'No duplicate game logs detected (natural key: playerMlbamId + gamePk)',
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Duplicate Game Logs',
      category: 'duplicates',
      status: 'fail',
      severity: 'critical',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for duplicate daily stats (same player + date + source)
 */
export async function checkDuplicateDailyStats(
  config: DuplicateCheckConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season } = config;

  try {
    const duplicates = await prisma.$queryRaw<Array<{ playerMlbamId: string; statDate: Date; rawDataSource: string; count: number }>>`
      SELECT player_mlbam_id as playerMlbamId, stat_date as statDate, raw_data_source as rawDataSource, COUNT(*) as count
      FROM player_daily_stats
      WHERE season = ${season}
      GROUP BY player_mlbam_id, stat_date, raw_data_source
      HAVING COUNT(*) > 1
      LIMIT 50
    `;

    if (duplicates.length > 0) {
      const examples = duplicates.slice(0, 5).map(d => 
        `${d.playerMlbamId}:${d.statDate.toISOString().split('T')[0]}:${d.rawDataSource} (${d.count} copies)`
      );

      return {
        testName: 'Duplicate Daily Stats',
        category: 'duplicates',
        status: 'fail',
        severity: 'critical',
        message: `Found ${duplicates.length} duplicate daily stat entries. Examples: ${examples.join(', ')}`,
        details: {
          duplicateCount: duplicates.length,
          examples: duplicates.slice(0, 10),
          totalDuplicateRecords: duplicates.reduce((sum, d) => sum + d.count, 0),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Duplicate Daily Stats',
      category: 'duplicates',
      status: 'pass',
      severity: 'critical',
      message: 'No duplicate daily stats detected (natural key: playerMlbamId + statDate + rawDataSource)',
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Duplicate Daily Stats',
      category: 'duplicates',
      status: 'fail',
      severity: 'critical',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for duplicate raw ingestion logs
 */
export async function checkDuplicateRawIngestion(
  config: DuplicateCheckConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season } = config;

  try {
    const duplicates = await prisma.$queryRaw<Array<{ cacheKey: string; count: number }>>`
      SELECT cache_key as cacheKey, COUNT(*) as count
      FROM raw_ingestion_logs
      WHERE season = ${season}
      GROUP BY cache_key
      HAVING COUNT(*) > 1
      LIMIT 50
    `;

    if (duplicates.length > 0) {
      const examples = duplicates.slice(0, 5).map(d => 
        `${d.cacheKey} (${d.count} copies)`
      );

      return {
        testName: 'Duplicate Raw Ingestion Logs',
        category: 'duplicates',
        status: 'fail',
        severity: 'high',
        message: `Found ${duplicates.length} duplicate raw ingestion entries. Examples: ${examples.join(', ')}`,
        details: {
          duplicateCount: duplicates.length,
          examples: duplicates.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Duplicate Raw Ingestion Logs',
      category: 'duplicates',
      status: 'pass',
      severity: 'high',
      message: 'No duplicate raw ingestion logs detected (natural key: cacheKey)',
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Duplicate Raw Ingestion Logs',
      category: 'duplicates',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for duplicate player entries in verified registry
 */
export async function checkDuplicateVerifiedPlayers(): Promise<UATTestResult> {
  const startTime = Date.now();

  try {
    const duplicates = await prisma.$queryRaw<Array<{ mlbamId: string; count: number }>>`
      SELECT mlbam_id as mlbamId, COUNT(*) as count
      FROM verified_players
      GROUP BY mlbam_id
      HAVING COUNT(*) > 1
      LIMIT 50
    `;

    if (duplicates.length > 0) {
      return {
        testName: 'Duplicate Verified Players',
        category: 'duplicates',
        status: 'fail',
        severity: 'critical',
        message: `Found ${duplicates.length} duplicate verified player entries: ${duplicates.slice(0, 5).map(d => d.mlbamId).join(', ')}`,
        details: {
          duplicateCount: duplicates.length,
          examples: duplicates.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Duplicate Verified Players',
      category: 'duplicates',
      status: 'pass',
      severity: 'critical',
      message: 'No duplicate verified players detected (primary key: mlbamId)',
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Duplicate Verified Players',
      category: 'duplicates',
      status: 'fail',
      severity: 'critical',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for duplicate derived stats
 */
export async function checkDuplicateDerivedStats(
  config: DuplicateCheckConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season } = config;

  try {
    const duplicates = await prisma.$queryRaw<Array<{ playerMlbamId: string; computedDate: Date; count: number }>>`
      SELECT player_mlbam_id as playerMlbamId, computed_date as computedDate, COUNT(*) as count
      FROM player_derived_stats
      WHERE season = ${season}
      GROUP BY player_mlbam_id, computed_date
      HAVING COUNT(*) > 1
      LIMIT 50
    `;

    if (duplicates.length > 0) {
      const examples = duplicates.slice(0, 5).map(d => 
        `${d.playerMlbamId}:${d.computedDate.toISOString().split('T')[0]} (${d.count} copies)`
      );

      return {
        testName: 'Duplicate Derived Stats',
        category: 'duplicates',
        status: 'fail',
        severity: 'high',
        message: `Found ${duplicates.length} duplicate derived stat entries. Examples: ${examples.join(', ')}`,
        details: {
          duplicateCount: duplicates.length,
          examples: duplicates.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Duplicate Derived Stats',
      category: 'duplicates',
      status: 'pass',
      severity: 'high',
      message: 'No duplicate derived stats detected (natural key: playerMlbamId + computedDate)',
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Duplicate Derived Stats',
      category: 'duplicates',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const season = parseInt(process.argv[2] || '2025');
  const config: DuplicateCheckConfig = {
    season,
    tables: ['playerGameLog', 'playerDailyStats', 'rawIngestionLog'],
  };

  Promise.all([
    checkDuplicateGameLogs(config),
    checkDuplicateDailyStats(config),
    checkDuplicateRawIngestion(config),
    checkDuplicateVerifiedPlayers(),
    checkDuplicateDerivedStats(config),
  ]).then(results => {
    console.log('\n=== Duplicate Detection Results ===\n');
    for (const result of results) {
      const icon = result.status === 'pass' ? '✅' : '❌';
      console.log(`${icon} [${result.severity.toUpperCase()}] ${result.testName}`);
      console.log(`   Status: ${result.status.toUpperCase()}`);
      console.log(`   Message: ${result.message}`);
      console.log();
    }
    process.exit(results.some(r => r.status === 'fail' && r.severity === 'critical') ? 1 : 0);
  });
}
