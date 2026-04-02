/**
 * Admin Routes
 * 
 * POST /admin/trigger-ingestion - Trigger MLB stats ingestion
 * GET /admin/ingestion-status - Check ingestion status
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { runDailyIngestion, validateIngestion } from '@cbb/worker';
import { prisma } from '@cbb/infrastructure';

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
}
