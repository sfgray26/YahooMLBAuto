-- CreateTable
CREATE TABLE "pitcher_game_logs" (
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
    "gamesStarted" INTEGER NOT NULL DEFAULT 0,
    "gamesFinished" INTEGER NOT NULL DEFAULT 0,
    "gamesSaved" INTEGER NOT NULL DEFAULT 0,
    "holds" INTEGER NOT NULL DEFAULT 0,
    "inningsPitched" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "battersFaced" INTEGER NOT NULL DEFAULT 0,
    "hitsAllowed" INTEGER NOT NULL DEFAULT 0,
    "runsAllowed" INTEGER NOT NULL DEFAULT 0,
    "earnedRuns" INTEGER NOT NULL DEFAULT 0,
    "walks" INTEGER NOT NULL DEFAULT 0,
    "strikeouts" INTEGER NOT NULL DEFAULT 0,
    "homeRunsAllowed" INTEGER NOT NULL DEFAULT 0,
    "hitByPitch" INTEGER NOT NULL DEFAULT 0,
    "pitches" INTEGER,
    "strikes" INTEGER,
    "firstPitchStrikes" INTEGER,
    "swingingStrikes" INTEGER,
    "groundBalls" INTEGER,
    "flyBalls" INTEGER,
    "position" TEXT,
    "rawDataSource" TEXT NOT NULL DEFAULT 'mlb_stats_api',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pitcher_game_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pitcher_derived_stats" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerMlbamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedDate" TIMESTAMP(3) NOT NULL,
    "appearancesLast7" INTEGER NOT NULL DEFAULT 0,
    "appearancesLast14" INTEGER NOT NULL DEFAULT 0,
    "appearancesLast30" INTEGER NOT NULL DEFAULT 0,
    "inningsPitchedLast7" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inningsPitchedLast14" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inningsPitchedLast30" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "battersFacedLast7" INTEGER NOT NULL DEFAULT 0,
    "battersFacedLast14" INTEGER NOT NULL DEFAULT 0,
    "battersFacedLast30" INTEGER NOT NULL DEFAULT 0,
    "gamesSavedLast30" INTEGER NOT NULL DEFAULT 0,
    "gamesStartedLast30" INTEGER NOT NULL DEFAULT 0,
    "pitchesPerInning" DOUBLE PRECISION,
    "daysSinceLastAppearance" INTEGER,
    "eraLast30" DOUBLE PRECISION,
    "whipLast30" DOUBLE PRECISION,
    "fipLast30" DOUBLE PRECISION,
    "xfipLast30" DOUBLE PRECISION,
    "strikeoutRateLast30" DOUBLE PRECISION,
    "walkRateLast30" DOUBLE PRECISION,
    "kToBBRatioLast30" DOUBLE PRECISION,
    "swingingStrikeRate" DOUBLE PRECISION,
    "firstPitchStrikeRate" DOUBLE PRECISION,
    "avgVelocity" DOUBLE PRECISION,
    "gbRatio" DOUBLE PRECISION,
    "hrPer9" DOUBLE PRECISION,
    "eraReliable" BOOLEAN NOT NULL DEFAULT false,
    "whipReliable" BOOLEAN NOT NULL DEFAULT false,
    "fipReliable" BOOLEAN NOT NULL DEFAULT false,
    "kRateReliable" BOOLEAN NOT NULL DEFAULT false,
    "bbRateReliable" BOOLEAN NOT NULL DEFAULT false,
    "battersToReliable" INTEGER NOT NULL DEFAULT 0,
    "qualityStartRate" DOUBLE PRECISION,
    "blowUpRate" DOUBLE PRECISION,
    "eraVolatility" DOUBLE PRECISION,
    "consistencyScore" INTEGER NOT NULL DEFAULT 0,
    "opponentOps" DOUBLE PRECISION,
    "parkFactor" DOUBLE PRECISION,
    "isHome" BOOLEAN,
    "isCloser" BOOLEAN,
    "scheduledStartNext7" BOOLEAN NOT NULL DEFAULT false,
    "opponentNextStart" TEXT,
    "traceId" TEXT NOT NULL,

    CONSTRAINT "pitcher_derived_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pitcher_game_logs_playerMlbamId_gamePk_key" ON "pitcher_game_logs"("playerMlbamId", "gamePk");
CREATE INDEX "pitcher_game_logs_playerId_idx" ON "pitcher_game_logs"("playerId");
CREATE INDEX "pitcher_game_logs_playerMlbamId_idx" ON "pitcher_game_logs"("playerMlbamId");
CREATE INDEX "pitcher_game_logs_gameDate_idx" ON "pitcher_game_logs"("gameDate");
CREATE INDEX "pitcher_game_logs_season_idx" ON "pitcher_game_logs"("season");

CREATE UNIQUE INDEX "pitcher_derived_stats_playerMlbamId_season_computedDate_key" ON "pitcher_derived_stats"("playerMlbamId", "season", "computedDate");
CREATE INDEX "pitcher_derived_stats_playerId_idx" ON "pitcher_derived_stats"("playerId");
CREATE INDEX "pitcher_derived_stats_season_idx" ON "pitcher_derived_stats"("season");
CREATE INDEX "pitcher_derived_stats_computedAt_idx" ON "pitcher_derived_stats"("computedAt");
