-- CreateTable
CREATE TABLE "verified_players" (
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

-- CreateIndex
CREATE INDEX "verified_players_isActive_idx" ON "verified_players"("isActive");

-- CreateIndex
CREATE INDEX "verified_players_lastChecked_idx" ON "verified_players"("lastChecked");

-- CreateIndex
CREATE INDEX "verified_players_fullName_idx" ON "verified_players"("fullName");
