/**
 * Admin Routes
 * 
 * POST /admin/trigger-ingestion - Trigger MLB stats ingestion
 * GET /admin/ingestion-status - Check ingestion status
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { runDailyIngestion, validateIngestion } from '@cbb/worker';
import { prisma } from '@cbb/infrastructure';
import { v4 as uuidv4 } from 'uuid';

// UAT Seed Data - Real MLB Players
const UAT_ROSTER = [
  { mlbamId: '669128', name: 'Yainer Diaz', team: 'HOU', position: 'C', games: 142, avg: '.278', ops: '.825' },
  { mlbamId: '686469', name: 'Vinnie Pasquantino', team: 'KC', position: '1B', games: 135, avg: '.265', ops: '.810' },
  { mlbamId: '543760', name: 'Marcus Semien', team: 'TEX', position: '2B', games: 158, avg: '.258', ops: '.780' },
  { mlbamId: '656305', name: 'Matt Chapman', team: 'SF', position: '3B', games: 148, avg: '.245', ops: '.790' },
  { mlbamId: '672666', name: 'Geraldo Perdomo', team: 'ARI', position: 'SS', games: 132, avg: '.262', ops: '.755' },
  { mlbamId: '691023', name: 'Jordan Walker', team: 'STL', position: 'LF', games: 118, avg: '.251', ops: '.745' },
  { mlbamId: '621439', name: 'Byron Buxton', team: 'MIN', position: 'CF', games: 98, avg: '.268', ops: '.820' },
  { mlbamId: '665742', name: 'Juan Soto', team: 'NYM', position: 'RF', games: 155, avg: '.285', ops: '.915' },
  { mlbamId: '650333', name: 'Luis Arraez', team: 'SD', position: '1B', games: 152, avg: '.310', ops: '.780' },
  { mlbamId: '624413', name: 'Pete Alonso', team: 'NYM', position: '1B', games: 148, avg: '.245', ops: '.835' },
  { mlbamId: '621043', name: 'Brandon Nimmo', team: 'NYM', position: 'LF', games: 145, avg: '.270', ops: '.820' },
  { mlbamId: '691738', name: 'Pete Crow-Armstrong', team: 'CHC', position: 'CF', games: 112, avg: '.248', ops: '.720' },
  { mlbamId: '680694', name: 'Steven Kwan', team: 'CLE', position: 'LF', games: 150, avg: '.285', ops: '.775' },
  { mlbamId: '676979', name: 'Garrett Crochet', team: 'BOS', position: 'SP', games: 28, avg: '.150', ops: '.300' },
  { mlbamId: '650911', name: 'Cristopher Sánchez', team: 'PHI', position: 'SP', games: 26, avg: '.140', ops: '.280' },
];

const UAT_WAIVER = [
  { mlbamId: '694817', name: 'Gunnar Henderson', team: 'BAL', position: 'SS', games: 156, avg: '.280', ops: '.890' },
  { mlbamId: '682985', name: 'Corbin Carroll', team: 'ARI', position: 'LF', games: 162, avg: '.265', ops: '.825' },
  { mlbamId: '660670', name: 'Bobby Witt Jr.', team: 'KC', position: 'SS', games: 160, avg: '.295', ops: '.920' },
  { mlbamId: '677594', name: 'Julio Rodriguez', team: 'SEA', position: 'CF', games: 150, avg: '.275', ops: '.865' },
  { mlbamId: '683011', name: 'Spencer Torkelson', team: 'DET', position: '1B', games: 140, avg: '.245', ops: '.790' },
];

export async function adminRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // POST /admin/trigger-ingestion
  // Trigger MLB stats ingestion manually
  // ==========================================================================
  fastify.post('/trigger-ingestion', async (request, reply) => {
    const { season, dryRun = false } = request.body as { 
      season?: number;
      dryRun?: boolean;
    };
    
    const targetSeason = season || new Date().getFullYear();
    const startTime = Date.now();
    
    console.log(`[ADMIN] Triggering ingestion for season ${targetSeason}...`);
    
    try {
      const result = await runDailyIngestion({
        season: targetSeason,
        gameType: 'R',
        dryRun,
      });
      
      const durationMs = Date.now() - startTime;
      
      if (result.success) {
        console.log(`[ADMIN] Ingestion completed in ${durationMs}ms`);
        
        // Get current counts
        const playerCount = await prisma.playerDailyStats.count({
          where: { season: targetSeason },
        });
        
        const rawLogCount = await prisma.rawIngestionLog.count({
          where: { season: targetSeason },
        });
        
        return {
          success: true,
          message: 'Ingestion completed successfully',
          season: targetSeason,
          durationMs,
          stats: {
            ...result.stats,
            totalPlayersInDb: playerCount,
            rawLogsInDb: rawLogCount,
          },
          traceId: result.traceId,
        };
      } else {
        console.error(`[ADMIN] Ingestion failed:`, result.errors);
        return reply.status(500).send({
          success: false,
          message: 'Ingestion failed',
          season: targetSeason,
          durationMs,
          errors: result.errors,
          traceId: result.traceId,
        });
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[ADMIN] Fatal error during ingestion:`, error);
      
      return reply.status(500).send({
        success: false,
        message: 'Fatal error during ingestion',
        season: targetSeason,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // GET /admin/ingestion-status
  // Check current ingestion status and data counts
  // ==========================================================================
  fastify.get('/ingestion-status', async (request, reply) => {
    const { season } = request.query as { season?: string };
    const targetSeason = season ? parseInt(season) : new Date().getFullYear();
    
    try {
      // Get validation results
      const validation = await validateIngestion(targetSeason);
      
      // Get table counts
      const [
        playerDailyStatsCount,
        rawIngestionLogCount,
        playerDerivedStatsCount,
        persistedDecisionCount,
      ] = await Promise.all([
        prisma.playerDailyStats.count({ where: { season: targetSeason } }),
        prisma.rawIngestionLog.count({ where: { season: targetSeason } }),
        prisma.playerDerivedStats.count({ where: { season: targetSeason } }),
        prisma.persistedDecision.count(),
      ]);
      
      // Get latest ingestion
      const latestIngestion = await prisma.rawIngestionLog.findFirst({
        where: { season: targetSeason },
        orderBy: { fetchedAt: 'desc' },
        select: {
          fetchedAt: true,
          recordCount: true,
          traceId: true,
        },
      });
      
      return {
        season: targetSeason,
        status: validation.valid ? 'healthy' : 'needs_data',
        validation: {
          valid: validation.valid,
          playerCount: validation.playerCount,
          issues: validation.issues,
        },
        counts: {
          playerDailyStats: playerDailyStatsCount,
          rawIngestionLogs: rawIngestionLogCount,
          playerDerivedStats: playerDerivedStatsCount,
          persistedDecisions: persistedDecisionCount,
        },
        latestIngestion: latestIngestion ? {
          fetchedAt: latestIngestion.fetchedAt,
          recordCount: latestIngestion.recordCount,
          traceId: latestIngestion.traceId,
        } : null,
      };
    } catch (error) {
      console.error('[ADMIN] Error checking status:', error);
      return reply.status(500).send({
        error: 'Failed to check ingestion status',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // POST /admin/compute-derived
  // Trigger derived stats computation
  // ==========================================================================
  fastify.post('/compute-derived', async (request, reply) => {
    const { season } = request.body as { season?: number };
    const targetSeason = season || new Date().getFullYear();
    
    console.log(`[ADMIN] Computing derived stats for season ${targetSeason}...`);
    
    return reply.status(501).send({
      success: false,
      error: 'Not implemented',
      message: 'Derived stats computation endpoint not yet implemented',
    });
  });

  // ==========================================================================
  // POST /admin/seed-uat
  // Seed database with real MLB players for UAT
  // ==========================================================================
  fastify.post('/seed-uat', async (request, reply) => {
    console.log('[ADMIN] Seeding UAT data with real MLB players...');
    
    try {
      // Clear old data
      await prisma.playerDerivedStats.deleteMany({ where: { season: 2025 } });
      await prisma.playerDailyStats.deleteMany({ where: { season: 2025 } });
      
      let seededCount = 0;
      
      // Seed roster players
      for (const player of [...UAT_ROSTER, ...UAT_WAIVER]) {
        const playerId = `mlbam:${player.mlbamId}`;
        const avg = parseFloat(player.avg);
        const ops = parseFloat(player.ops);
        
        // Create daily stats
        await prisma.playerDailyStats.create({
          data: {
            playerId,
            playerMlbamId: player.mlbamId,
            statDate: new Date('2025-09-30'),
            season: 2025,
            teamId: player.team,
            teamMlbamId: player.team,
            gamesPlayed: player.games,
            atBats: Math.floor(player.games * 3.2),
            runs: Math.floor(player.games * 0.5),
            hits: Math.floor(player.games * 0.85),
            doubles: Math.floor(player.games * 0.18),
            triples: Math.floor(player.games * 0.02),
            homeRuns: Math.floor(player.games * 0.12),
            rbi: Math.floor(player.games * 0.55),
            walks: Math.floor(player.games * 0.35),
            strikeouts: Math.floor(player.games * 0.85),
            battingAvg: player.avg,
            onBasePct: String((ops - 0.070).toFixed(3)),
            sluggingPct: String((ops - 0.080).toFixed(3)),
            ops: player.ops,
            rawDataSource: 'uat_seed',
          },
        });
        
        // Create derived stats
        await prisma.playerDerivedStats.create({
          data: {
            playerId,
            playerMlbamId: player.mlbamId,
            season: 2025,
            gamesLast7: 6,
            gamesLast14: 12,
            gamesLast30: 25,
            plateAppearancesLast7: 28,
            plateAppearancesLast14: 52,
            plateAppearancesLast30: 105,
            atBatsLast30: 95,
            battingAverageLast30: avg,
            onBasePctLast30: ops - 0.070,
            sluggingPctLast30: ops - 0.080,
            opsLast30: ops,
            isoLast30: (ops - 0.080) - avg,
            walkRateLast30: 0.09,
            strikeoutRateLast30: 0.21,
            babipLast30: 0.295,
            battingAverageReliable: player.games >= 100,
            obpReliable: player.games >= 100,
            slgReliable: player.games >= 100,
            opsReliable: player.games >= 100,
            gamesToReliable: Math.max(0, 40 - player.games),
            hitConsistencyScore: 75,
            productionVolatility: 0.15,
            zeroHitGamesLast14: 3,
            multiHitGamesLast14: 4,
            gamesStartedLast14: 12,
            lineupSpot: 5,
            platoonRisk: 'low',
            playingTimeTrend: 'stable',
            positionEligibility: [player.position],
            waiverWireValue: 50 + (ops - 0.700) * 100,
            rosteredPercent: 85,
            computedAt: new Date(),
            computedDate: new Date(),
            traceId: 'uat-seed',
          },
        });
        
        seededCount++;
      }
      
      return {
        success: true,
        message: `Seeded ${seededCount} players for UAT`,
        rosterPlayers: UAT_ROSTER.length,
        waiverPlayers: UAT_WAIVER.length,
        players: [...UAT_ROSTER, ...UAT_WAIVER].map(p => ({ mlbamId: p.mlbamId, name: p.name })),
      };
    } catch (error) {
      console.error('[ADMIN] Seed error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
