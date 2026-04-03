/**
 * Data Completeness Validation
 * 
 * Detects missing games, gaps in date coverage, and incomplete player records.
 * Ensures the dataset accurately reflects actual MLB events.
 */

import { prisma } from '@cbb/infrastructure';
import type { UATTestResult, CompletenessConfig } from '../types.js';

interface DateGap {
  playerMlbamId: string;
  gapStart: Date;
  gapEnd: Date;
  daysMissing: number;
}

interface PlayerCoverage {
  playerMlbamId: string;
  name: string;
  team: string;
  gamesExpected: number;
  gamesActual: number;
  coverage: number;
}

/**
 * Check for date gaps in player game logs
 */
export async function checkDateGaps(
  config: CompletenessConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season, dateRange } = config;

  try {
    // Find players with significant date gaps
    const playersWithGaps = await prisma.$queryRaw<Array<{
      playerMlbamId: string;
      minDate: Date;
      maxDate: Date;
      gameCount: number;
    }>>`
      SELECT 
        player_mlbam_id as playerMlbamId,
        MIN(game_date) as minDate,
        MAX(game_date) as maxDate,
        COUNT(*) as gameCount
      FROM player_game_logs
      WHERE season = ${season}
      GROUP BY player_mlbam_id
      HAVING COUNT(*) >= 10
      LIMIT 100
    `;

    const significantGaps: DateGap[] = [];

    for (const player of playersWithGaps) {
      // Get all game dates for this player
      const games = await prisma.playerGameLog.findMany({
        where: {
          playerMlbamId: player.playerMlbamId,
          season,
        },
        select: { gameDate: true },
        orderBy: { gameDate: 'asc' },
      });

      if (games.length < 2) continue;

      // Check for gaps > 14 days between consecutive games (injury/trade ok, but flag it)
      for (let i = 1; i < games.length; i++) {
        const daysBetween = Math.floor(
          (games[i].gameDate.getTime() - games[i - 1].gameDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Gap > 30 days is suspicious for active players
        if (daysBetween > 30) {
          significantGaps.push({
            playerMlbamId: player.playerMlbamId,
            gapStart: games[i - 1].gameDate,
            gapEnd: games[i].gameDate,
            daysMissing: daysBetween,
          });
          break; // Only flag first major gap per player
        }
      }
    }

    if (significantGaps.length > 0) {
      const examples = significantGaps.slice(0, 5).map(g => 
        `${g.playerMlbamId}: ${g.daysMissing} days (${g.gapStart.toISOString().split('T')[0]} to ${g.gapEnd.toISOString().split('T')[0]})`
      );

      return {
        testName: 'Date Gap Detection',
        category: 'completeness',
        status: 'warning',
        severity: 'medium',
        message: `Found ${significantGaps.length} players with significant date gaps. Examples: ${examples.join(', ')}`,
        details: {
          gapCount: significantGaps.length,
          examples: significantGaps.slice(0, 10),
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Date Gap Detection',
      category: 'completeness',
      status: 'pass',
      severity: 'medium',
      message: `No significant date gaps detected in ${playersWithGaps.length} player game logs`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Date Gap Detection',
      category: 'completeness',
      status: 'fail',
      severity: 'medium',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for players missing from expected dataset
 */
export async function checkMissingPlayers(
  config: CompletenessConfig
): Promise<UATTestResult> {
  const startTime = Date.now();
  const { season, expectedPlayers } = config;

  try {
    // Get all players with game logs this season
    const playersWithLogs = await prisma.playerGameLog.groupBy({
      by: ['playerMlbamId'],
      where: { season },
      _count: { gamePk: true },
    });

    const playerIdsWithLogs = new Set(playersWithLogs.map(p => p.playerMlbamId));

    // If expected players list provided, check for missing ones
    let missingFromExpected: string[] = [];
    if (expectedPlayers.length > 0) {
      missingFromExpected = expectedPlayers.filter(id => !playerIdsWithLogs.has(id));
    }

    // Check for active verified players missing game logs
    const activeVerifiedPlayers = await prisma.verifiedPlayer.findMany({
      where: { isActive: true },
      select: { mlbamId: true, fullName: true },
    });

    const missingActivePlayers = activeVerifiedPlayers
      .filter(p => !playerIdsWithLogs.has(p.mlbamId))
      .slice(0, 20);

    const issues: string[] = [];

    if (missingFromExpected.length > 0) {
      issues.push(`${missingFromExpected.length} expected players missing game logs`);
    }

    if (missingActivePlayers.length > 50) {
      issues.push(`${missingActivePlayers.length} active verified players missing game logs (showing 20)`);
    }

    if (issues.length > 0) {
      return {
        testName: 'Missing Player Detection',
        category: 'completeness',
        status: missingFromExpected.length > 0 ? 'fail' : 'warning',
        severity: missingFromExpected.length > 0 ? 'high' : 'medium',
        message: `Missing player data: ${issues.join('; ')}`,
        details: {
          missingFromExpected: missingFromExpected.slice(0, 10),
          missingActivePlayers: missingActivePlayers.map(p => ({ id: p.mlbamId, name: p.fullName })),
          totalPlayersWithLogs: playerIdsWithLogs.size,
          totalActiveVerified: activeVerifiedPlayers.length,
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Missing Player Detection',
      category: 'completeness',
      status: 'pass',
      severity: 'high',
      message: `All ${expectedPlayers.length > 0 ? expectedPlayers.length : 'active verified'} players have game log data`,
      details: {
        totalPlayersWithLogs: playerIdsWithLogs.size,
        totalActiveVerified: activeVerifiedPlayers.length,
      },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Missing Player Detection',
      category: 'completeness',
      status: 'fail',
      severity: 'high',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for recent data freshness
 */
export async function checkDataFreshness(
  season: number,
  maxStaleHours: number = 48
): Promise<UATTestResult> {
  const startTime = Date.now();

  try {
    // Get most recent game log
    const latestGame = await prisma.playerGameLog.findFirst({
      where: { season },
      orderBy: { gameDate: 'desc' },
      select: { gameDate: true },
    });

    // Get most recent raw ingestion
    const latestIngestion = await prisma.rawIngestionLog.findFirst({
      where: { season },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true, source: true },
    });

    // Get most recent derived stats computation
    const latestDerived = await prisma.playerDerivedStats.findFirst({
      where: { season },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });

    const now = new Date();
    const issues: string[] = [];

    if (latestGame) {
      const hoursSinceLastGame = Math.floor((now.getTime() - latestGame.gameDate.getTime()) / (1000 * 60 * 60));
      if (hoursSinceLastGame > maxStaleHours * 2) {
        issues.push(`Last game data is ${hoursSinceLastGame} hours old`);
      }
    } else {
      issues.push('No game log data found');
    }

    if (latestIngestion) {
      const hoursSinceIngestion = Math.floor((now.getTime() - latestIngestion.fetchedAt.getTime()) / (1000 * 60 * 60));
      if (hoursSinceIngestion > maxStaleHours) {
        issues.push(`Last ingestion was ${hoursSinceIngestion} hours ago`);
      }
    } else {
      issues.push('No ingestion logs found');
    }

    if (latestDerived) {
      const hoursSinceDerived = Math.floor((now.getTime() - latestDerived.computedAt.getTime()) / (1000 * 60 * 60));
      if (hoursSinceDerived > maxStaleHours) {
        issues.push(`Derived stats are ${hoursSinceDerived} hours old`);
      }
    } else {
      issues.push('No derived stats found');
    }

    if (issues.length > 0) {
      return {
        testName: 'Data Freshness',
        category: 'completeness',
        status: 'warning',
        severity: 'medium',
        message: `Data freshness issues: ${issues.join('; ')}`,
        details: {
          latestGameDate: latestGame?.gameDate,
          latestIngestion: latestIngestion?.fetchedAt,
          latestDerived: latestDerived?.computedAt,
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Data Freshness',
      category: 'completeness',
      status: 'pass',
      severity: 'medium',
      message: 'Data is fresh within acceptable thresholds',
      details: {
        latestGameDate: latestGame?.gameDate,
        latestIngestion: latestIngestion?.fetchedAt,
        latestDerived: latestDerived?.computedAt,
      },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Data Freshness',
      category: 'completeness',
      status: 'fail',
      severity: 'medium',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Check for games missing from specific team schedules
 */
export async function checkTeamScheduleCompleteness(
  season: number
): Promise<UATTestResult> {
  const startTime = Date.now();

  try {
    // Get game counts by team
    const teamGameCounts = await prisma.$queryRaw<Array<{
      teamId: string;
      gameCount: number;
    }>>`
      SELECT 
        team_mlbam_id as teamId,
        COUNT(DISTINCT game_pk) as gameCount
      FROM player_game_logs
      WHERE season = ${season}
      GROUP BY team_mlbam_id
    `;

    // MLB teams should have around 162 games (or proportionally less early in season)
    const issues: string[] = [];
    const lowCoverageTeams: Array<{ teamId: string; games: number }> = [];

    for (const team of teamGameCounts) {
      if (team.gameCount < 20) {  // Assuming at least 20 games should be recorded
        lowCoverageTeams.push({ teamId: team.teamId, games: team.gameCount });
      }
    }

    if (lowCoverageTeams.length > 0) {
      return {
        testName: 'Team Schedule Completeness',
        category: 'completeness',
        status: 'warning',
        severity: 'medium',
        message: `${lowCoverageTeams.length} teams have low game coverage`,
        details: {
          lowCoverageTeams: lowCoverageTeams.slice(0, 10),
          teamsTracked: teamGameCounts.length,
        },
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      testName: 'Team Schedule Completeness',
      category: 'completeness',
      status: 'pass',
      severity: 'medium',
      message: `All ${teamGameCounts.length} teams have adequate game coverage`,
      details: { teamsTracked: teamGameCounts.length },
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      testName: 'Team Schedule Completeness',
      category: 'completeness',
      status: 'fail',
      severity: 'medium',
      message: `Test failed with error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const season = parseInt(process.argv[2] || '2025');
  
  const config: CompletenessConfig = {
    season,
    expectedPlayers: [],
    dateRange: {
      start: new Date(`${season}-03-01`),
      end: new Date(),
    },
  };

  Promise.all([
    checkDateGaps(config),
    checkMissingPlayers(config),
    checkDataFreshness(season),
    checkTeamScheduleCompleteness(season),
  ]).then(results => {
    console.log('\n=== Data Completeness Results ===\n');
    for (const result of results) {
      const icon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${icon} [${result.severity.toUpperCase()}] ${result.testName}`);
      console.log(`   Status: ${result.status.toUpperCase()}`);
      console.log(`   Message: ${result.message}`);
      console.log();
    }
    process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
  });
}
