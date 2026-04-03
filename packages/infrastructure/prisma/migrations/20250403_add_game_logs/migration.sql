-- Manual migration: Add PlayerGameLog table
-- This is the SQL equivalent of the Prisma schema change

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
);

-- Create unique index
CREATE UNIQUE INDEX IF NOT EXISTS "player_game_logs_playerMlbamId_gamePk_key" 
    ON "player_game_logs"("playerMlbamId", "gamePk");

-- Create indexes
CREATE INDEX IF NOT EXISTS "player_game_logs_playerId_idx" ON "player_game_logs"("playerId");
CREATE INDEX IF NOT EXISTS "player_game_logs_playerMlbamId_idx" ON "player_game_logs"("playerMlbamId");
CREATE INDEX IF NOT EXISTS "player_game_logs_gameDate_idx" ON "player_game_logs"("gameDate");
CREATE INDEX IF NOT EXISTS "player_game_logs_season_idx" ON "player_game_logs"("season");
