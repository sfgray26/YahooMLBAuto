/**
 * Admin Routes
 * 
 * POST /admin/trigger-ingestion - Trigger MLB stats ingestion
 * GET /admin/ingestion-status - Check ingestion status
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { runDailyIngestion, validateIngestion } from '@cbb/worker';
import { ingestGameLogsForPlayers, batchComputeDerivedStatsFromGameLogs } from '@cbb/worker';
import { validatePlayerIdentity, validatePlayerBatch, suggestCorrectId } from '@cbb/worker';
import { prisma } from '@cbb/infrastructure';
import { v4 as uuidv4 } from 'uuid';

// UAT Seed Data - Real MLB Players
const UAT_ROSTER = [
  { mlbamId: '673237', name: 'Yainer Diaz', team: 'HOU', position: 'C', games: 142, avg: '.278', ops: '.825' },
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
  { mlbamId: '691718', name: 'Pete Crow-Armstrong', team: 'CHC', position: 'CF', games: 112, avg: '.248', ops: '.720' },
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
    const { season } = request.body as { season?: number } || {};
    const targetSeason = season || 2026;
    console.log(`[ADMIN] Seeding UAT data with real MLB players for ${targetSeason}...`);
    
    try {
      // Clear old UAT data for the target season
      await prisma.playerDerivedStats.deleteMany({ where: { season: targetSeason, traceId: 'uat-seed' } });
      await prisma.playerDailyStats.deleteMany({ where: { season: targetSeason, rawDataSource: 'uat_seed' } });
      
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
            statDate: new Date(`${targetSeason}-09-30`),
            season: targetSeason,
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
            season: targetSeason,
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

  // ==========================================================================
  // POST /admin/ingest-game-logs
  // Ingest game-by-game stats for specific players
  // ==========================================================================
  fastify.post('/ingest-game-logs', async (request, reply) => {
    const { playerIds, season } = request.body as {
      playerIds?: string[]; // Array of MLBAM IDs
      season?: number;
    };

    const targetSeason = season || new Date().getFullYear();
    const traceId = uuidv4();

    console.log(`[ADMIN] Ingesting game logs for season ${targetSeason}...`);

    if (!playerIds || playerIds.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'playerIds required',
        message: 'Provide array of MLBAM IDs to ingest game logs for',
      });
    }

    try {
      const players = playerIds.map((mlbamId) => ({
        playerId: `mlbam:${mlbamId}`,
        mlbamId,
      }));

      const startTime = Date.now();
      const result = await ingestGameLogsForPlayers(players, targetSeason, traceId);
      const durationMs = Date.now() - startTime;

      return {
        success: true,
        message: `Ingested game logs for ${result.totalPlayers} players`,
        season: targetSeason,
        durationMs,
        totalGames: result.totalGames,
        errors: result.errors.length > 0 ? result.errors : undefined,
        traceId,
      };
    } catch (error) {
      console.error('[ADMIN] Game log ingestion error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        traceId,
      });
    }
  });

  // ==========================================================================
  // POST /admin/migrate-game-logs
  // Run migration to create PlayerGameLog table
  // ==========================================================================
  fastify.post('/migrate-game-logs', async (request, reply) => {
    console.log('[ADMIN] Running game logs migration...');
    
    try {
      // Create the table using raw SQL
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "player_game_logs" (
          "id" TEXT NOT NULL,
          "playerId" TEXT NOT NULL,
          "playerMlbamId" TEXT NOT NULL,
          "season" INTEGER NOT NULL,
          "gameDate" TIMESTAMP(3) NOT NULL,
          "gamePk" TEXT NOT NULL,
          "homeTeamId" TEXT NOT NULL,
          "awayTeamId" TEXT NOT NULL,
          "isHomeGame" BOOLEAN NOT NULL,
          "teamId" TEXT NOT NULL,
          "teamMlbamId" TEXT NOT NULL,
          "opponentId" TEXT NOT NULL,
          "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
          "atBats" INTEGER NOT NULL DEFAULT 0,
          "runs" INTEGER NOT NULL DEFAULT 0,
          "hits" INTEGER NOT NULL DEFAULT 0,
          "doubles" INTEGER NOT NULL DEFAULT 0,
          "triples" INTEGER NOT NULL DEFAULT 0,
          "homeRuns" INTEGER NOT NULL DEFAULT 0,
          "rbi" INTEGER NOT NULL DEFAULT 0,
          "stolenBases" INTEGER NOT NULL DEFAULT 0,
          "caughtStealing" INTEGER NOT NULL DEFAULT 0,
          "walks" INTEGER NOT NULL DEFAULT 0,
          "strikeouts" INTEGER NOT NULL DEFAULT 0,
          "hitByPitch" INTEGER NOT NULL DEFAULT 0,
          "sacrificeFlies" INTEGER NOT NULL DEFAULT 0,
          "groundIntoDp" INTEGER NOT NULL DEFAULT 0,
          "leftOnBase" INTEGER NOT NULL DEFAULT 0,
          "plateAppearances" INTEGER NOT NULL DEFAULT 0,
          "totalBases" INTEGER NOT NULL DEFAULT 0,
          "position" TEXT,
          "rawDataSource" TEXT NOT NULL DEFAULT 'mlb_stats_api',
          "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "player_game_logs_pkey" PRIMARY KEY ("id")
        )
      `);
      
      // Create unique index
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "player_game_logs_playerMlbamId_gamePk_key" 
          ON "player_game_logs"("playerMlbamId", "gamePk")
      `);
      
      // Create indexes
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "player_game_logs_playerId_idx" 
          ON "player_game_logs"("playerId")
      `);
      
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "player_game_logs_playerMlbamId_idx" 
          ON "player_game_logs"("playerMlbamId")
      `);
      
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "player_game_logs_gameDate_idx" 
          ON "player_game_logs"("gameDate")
      `);
      
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "player_game_logs_season_idx" 
          ON "player_game_logs"("season")
      `);
      
      return {
        success: true,
        message: 'PlayerGameLog table created successfully',
      };
    } catch (error) {
      console.error('[ADMIN] Migration error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // POST /admin/compute-derived-from-logs
  // Compute derived stats from stored game logs
  // ==========================================================================
  fastify.post('/compute-derived-from-logs', async (request, reply) => {
    const { season } = request.body as { season?: number };

    const targetSeason = season || new Date().getFullYear();
    const traceId = uuidv4();

    console.log(`[ADMIN] Computing derived stats from game logs for season ${targetSeason}...`);

    try {
      const startTime = Date.now();
      // Pass undefined for asOfDate to use the latest game date in the dataset
      const result = await batchComputeDerivedStatsFromGameLogs(targetSeason, undefined, traceId);
      const durationMs = Date.now() - startTime;

      return {
        success: true,
        message: `Computed derived stats for ${result.processed} players`,
        season: targetSeason,
        durationMs,
        processed: result.processed,
        errors: result.errors.length > 0 ? result.errors : undefined,
        traceId,
      };
    } catch (error) {
      console.error('[ADMIN] Derived stats computation error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        traceId,
      });
    }
  });

  // ==========================================================================
  // GET /admin/game-logs/:mlbamId - Get raw game logs for validation
  // ==========================================================================
  fastify.get('/game-logs/:mlbamId', async (request, reply) => {
    const { mlbamId } = request.params as { mlbamId: string };
    const { season } = request.query as { season?: string };
    const targetSeason = season ? parseInt(season) : new Date().getFullYear();

    console.log(`[ADMIN] Fetching game logs for ${mlbamId}, season ${targetSeason}`);

    try {
      const gameLogs = await prisma.playerGameLog.findMany({
        where: {
          playerMlbamId: mlbamId,
          season: targetSeason,
        },
        orderBy: { gameDate: 'desc' },
        select: {
          gameDate: true,
          gamePk: true,
          opponentId: true,
          isHomeGame: true,
          atBats: true,
          runs: true,
          hits: true,
          doubles: true,
          triples: true,
          homeRuns: true,
          rbi: true,
          walks: true,
          strikeouts: true,
          stolenBases: true,
          plateAppearances: true,
          hitByPitch: true,
          sacrificeFlies: true,
        },
      });

      // Calculate running totals for validation
      let cumulativePA = 0;
      let cumulativeHits = 0;
      let cumulativeAB = 0;
      let cumulativeTB = 0;
      let cumulativeBB = 0;
      let cumulativeHBP = 0;
      let cumulativeSF = 0;

      const gamesWithTotals = gameLogs.map((game: { gameDate: Date; plateAppearances: number; hits: number; atBats: number; doubles: number; triples: number; homeRuns: number; walks: number; hitByPitch?: number; sacrificeFlies?: number }) => {
        cumulativePA += game.plateAppearances;
        cumulativeHits += game.hits;
        cumulativeAB += game.atBats;
        cumulativeTB += (game.hits + game.doubles + game.triples * 2 + game.homeRuns * 3);
        cumulativeBB += game.walks;
        cumulativeHBP += game.hitByPitch || 0;
        cumulativeSF += game.sacrificeFlies || 0;

        const avg = cumulativeAB > 0 ? (cumulativeHits / cumulativeAB).toFixed(3) : '.000';
        const obpDenominator = cumulativeAB + cumulativeBB + cumulativeHBP + cumulativeSF;
        const obp = obpDenominator > 0 ? ((cumulativeHits + cumulativeBB + cumulativeHBP) / obpDenominator).toFixed(3) : '.000';
        const slg = cumulativeAB > 0 ? (cumulativeTB / cumulativeAB).toFixed(3) : '.000';

        return {
          ...game,
          gameDate: game.gameDate.toISOString().split('T')[0],
          cumulativePA,
          runningAVG: avg,
          runningOBP: obp,
          runningSLG: slg,
          runningOPS: (parseFloat(obp) + parseFloat(slg)).toFixed(3),
        };
      });

      return {
        playerMlbamId: mlbamId,
        season: targetSeason,
        totalGames: gameLogs.length,
        games: gamesWithTotals,
      };
    } catch (error) {
      console.error('[ADMIN] Game logs fetch error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // POST /admin/validate-player-id
  // Validate that an MLBAM ID matches the expected player name
  // ==========================================================================
  fastify.post('/validate-player-id', async (request, reply) => {
    const { mlbamId, name } = request.body as {
      mlbamId: string;
      name: string;
    };

    if (!mlbamId || !name) {
      return reply.status(400).send({
        success: false,
        error: 'mlbamId and name are required',
      });
    }

    console.log(`[ADMIN] Validating player ID: ${name} (${mlbamId})`);

    try {
      const result = await validatePlayerIdentity(mlbamId, name);
      const suggestion = !result.valid ? await suggestCorrectId(name) : null;

      return {
        success: true,
        valid: result.valid,
        expectedName: result.expectedName,
        actualIdentity: result.actualIdentity,
        errors: result.errors,
        warnings: result.warnings,
        suggestion: suggestion ? {
          mlbamId: suggestion.mlbamId,
          confidence: suggestion.confidence,
        } : null,
      };
    } catch (error) {
      console.error('[ADMIN] Player validation error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // POST /admin/validate-player-batch
  // Validate multiple player IDs in one request
  // ==========================================================================
  fastify.post('/validate-player-batch', async (request, reply) => {
    const { players } = request.body as {
      players: Array<{ mlbamId: string; name: string }>;
    };

    if (!players || !Array.isArray(players) || players.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'players array is required',
        message: 'Provide array of { mlbamId, name } objects to validate',
      });
    }

    if (players.length > 50) {
      return reply.status(400).send({
        success: false,
        error: 'Batch size exceeded',
        message: 'Maximum 50 players per batch',
      });
    }

    console.log(`[ADMIN] Validating batch of ${players.length} players`);

    try {
      const results = await validatePlayerBatch(players);
      const valid = results.filter((r) => r.valid).length;
      const invalid = results.filter((r) => !r.valid).length;

      return {
        success: true,
        summary: {
          total: players.length,
          valid,
          invalid,
        },
        results: results.map((r, i) => ({
          mlbamId: players[i].mlbamId,
          name: r.expectedName,
          valid: r.valid,
          actualName: r.actualIdentity?.fullName || null,
          active: r.actualIdentity?.active || false,
          currentTeam: r.actualIdentity?.currentTeam || null,
          errors: r.errors,
          warnings: r.warnings,
        })),
      };
    } catch (error) {
      console.error('[ADMIN] Batch validation error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // POST /admin/migrate-verified-players
  // Run database migration for VerifiedPlayer table
  // ==========================================================================
  fastify.post('/migrate-verified-players', async (_request, reply) => {
    console.log('[ADMIN] Running VerifiedPlayer migration...');
    
    try {
      // Create the verified_players table
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "verified_players" (
          "mlbamId" TEXT NOT NULL,
          "fullName" TEXT NOT NULL,
          "team" TEXT,
          "position" TEXT,
          "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "verificationSource" TEXT NOT NULL DEFAULT 'mlb_api',
          "lastChecked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          "baseballReferenceId" TEXT,
          "crossValidatedAt" TIMESTAMP(3),
          CONSTRAINT "verified_players_pkey" PRIMARY KEY ("mlbamId")
        );
      `;
      
      // Create indexes
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS "verified_players_isActive_idx" ON "verified_players"("isActive");
      `;
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS "verified_players_lastChecked_idx" ON "verified_players"("lastChecked");
      `;
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS "verified_players_fullName_idx" ON "verified_players"("fullName");
      `;
      
      console.log('[ADMIN] VerifiedPlayer migration completed successfully');
      
      return {
        success: true,
        message: 'VerifiedPlayer table created successfully',
        table: 'verified_players',
      };
    } catch (error) {
      console.error('[ADMIN] Migration failed:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // POST /admin/ingest-player-gated
  // Ingest a single player with mandatory identity verification
  // ==========================================================================
  fastify.post<{
    Body: {
      mlbamId: string;
      season?: number;
    };
  }>('/ingest-player-gated', async (request, reply) => {
    const { mlbamId, season } = request.body;
    const targetSeason = season || new Date().getFullYear();
    
    console.log(`[ADMIN] Gated ingestion for player: ${mlbamId}, season: ${targetSeason}`);
    
    try {
      const { ingestPlayer } = await import('@cbb/worker');
      const result = await ingestPlayer(mlbamId);
      
      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
          mlbamId,
          traceId: result.traceId,
        });
      }
      
      return {
        success: true,
        mlbamId,
        playerName: result.identity?.fullName,
        gamesIngested: result.gamesIngested,
        traceId: result.traceId,
      };
    } catch (error) {
      console.error('[ADMIN] Gated ingestion error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // POST /admin/recommend-waiver
  // Get waiver recommendation with verified identity
  // ==========================================================================
  fastify.post<{
    Body: {
      mlbamId: string;
    };
  }>('/recommend-waiver', async (request, reply) => {
    const { mlbamId } = request.body;
    
    console.log(`[ADMIN] Waiver recommendation for: ${mlbamId}`);
    
    try {
      const { recommendWaiverPickup } = await import('@cbb/worker');
      const result = await recommendWaiverPickup(mlbamId);
      
      if (!result.verified) {
        return reply.status(400).send({
          success: false,
          verified: false,
          error: result.error,
          mlbamId,
          traceId: result.traceId,
        });
      }
      
      return {
        success: true,
        verified: true,
        player: result.player,
        score: result.score,
        computedAt: result.computedAt,
        traceId: result.traceId,
      };
    } catch (error) {
      console.error('[ADMIN] Waiver recommendation error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // GET /admin/verified-players
  // List all verified players in registry
  // ==========================================================================
  fastify.get('/verified-players', async (_request, reply) => {
    console.log('[ADMIN] Fetching verified players registry...');
    
    try {
      const players = await prisma.verifiedPlayer.findMany({
        orderBy: { verifiedAt: 'desc' },
        take: 100,
      });
      
      return {
        success: true,
        count: players.length,
        players: players.map((p: { mlbamId: string; fullName: string; team: string | null; position: string | null; isActive: boolean; verifiedAt: Date }) => ({
          mlbamId: p.mlbamId,
          fullName: p.fullName,
          team: p.team,
          position: p.position,
          isActive: p.isActive,
          verifiedAt: p.verifiedAt,
        })),
      };
    } catch (error) {
      console.error('[ADMIN] Fetch verified players error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================================================
  // GET /admin/derived-stats/:mlbamId
  // Check derived stats for a player
  // ==========================================================================
  fastify.get<{
    Params: {
      mlbamId: string;
    };
    Querystring: {
      season?: string;
    };
  }>('/derived-stats/:mlbamId', async (request, reply) => {
    const { mlbamId } = request.params;
    const season = parseInt(request.query.season || '2026');
    
    console.log(`[ADMIN] Fetching derived stats for: ${mlbamId}, season: ${season}`);
    
    try {
      const derived = await prisma.playerDerivedStats.findFirst({
        where: { playerMlbamId: mlbamId, season },
        orderBy: { computedAt: 'desc' },
      });
      
      if (!derived) {
        return reply.status(404).send({
          success: false,
          error: 'No derived stats found',
          mlbamId,
          season,
        });
      }
      
      return {
        success: true,
        mlbamId,
        season,
        computedAt: derived.computedAt,
        computedDate: derived.computedDate,
        volume: {
          gamesLast7: derived.gamesLast7,
          gamesLast14: derived.gamesLast14,
          gamesLast30: derived.gamesLast30,
          plateAppearancesLast7: derived.plateAppearancesLast7,
          plateAppearancesLast14: derived.plateAppearancesLast14,
          plateAppearancesLast30: derived.plateAppearancesLast30,
          atBatsLast30: derived.atBatsLast30,
        },
        rates: {
          battingAverageLast30: derived.battingAverageLast30,
          onBasePctLast30: derived.onBasePctLast30,
          sluggingPctLast30: derived.sluggingPctLast30,
          opsLast30: derived.opsLast30,
          isoLast30: derived.isoLast30,
          walkRateLast30: derived.walkRateLast30,
          strikeoutRateLast30: derived.strikeoutRateLast30,
          babipLast30: derived.babipLast30,
        },
        reliability: {
          battingAverageReliable: derived.battingAverageReliable,
          obpReliable: derived.obpReliable,
          slgReliable: derived.slgReliable,
          opsReliable: derived.opsReliable,
          gamesToReliable: derived.gamesToReliable,
        },
        volatility: {
          hitConsistencyScore: derived.hitConsistencyScore,
          productionVolatility: derived.productionVolatility,
          zeroHitGamesLast14: derived.zeroHitGamesLast14,
          multiHitGamesLast14: derived.multiHitGamesLast14,
        },
        hasNulls: {
          rates: {
            battingAverageLast30: derived.battingAverageLast30 === null,
            onBasePctLast30: derived.onBasePctLast30 === null,
            sluggingPctLast30: derived.sluggingPctLast30 === null,
            opsLast30: derived.opsLast30 === null,
            isoLast30: derived.isoLast30 === null,
            walkRateLast30: derived.walkRateLast30 === null,
            strikeoutRateLast30: derived.strikeoutRateLast30 === null,
            babipLast30: derived.babipLast30 === null,
          }
        }
      };
    } catch (error) {
      console.error('[ADMIN] Fetch derived stats error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}