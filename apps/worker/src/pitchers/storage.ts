/**
 * Pitcher Derived Features Storage
 *
 * Idempotent storage of computed pitcher-derived features.
 */

import { prisma } from '@cbb/infrastructure';
import type { PitcherDerivedFeatures } from './derived.js';

export async function storePitcherDerivedFeatures(
  features: PitcherDerivedFeatures,
  traceId: string
): Promise<void> {
  const dateKey = features.computedAt.toISOString().split('T')[0];
  const computedDate = new Date(dateKey);

  await prisma.pitcherDerivedStats.upsert({
    where: {
      playerMlbamId_season_computedDate: {
        playerMlbamId: features.playerMlbamId,
        season: features.season,
        computedDate,
      },
    },
    create: {
      playerId: features.playerId,
      playerMlbamId: features.playerMlbamId,
      season: features.season,
      computedAt: features.computedAt,
      computedDate,
      appearancesLast7: features.volume.appearancesLast7,
      appearancesLast14: features.volume.appearancesLast14,
      appearancesLast30: features.volume.appearancesLast30,
      inningsPitchedLast7: features.volume.inningsPitchedLast7,
      inningsPitchedLast14: features.volume.inningsPitchedLast14,
      inningsPitchedLast30: features.volume.inningsPitchedLast30,
      battersFacedLast7: features.volume.battersFacedLast7,
      battersFacedLast14: features.volume.battersFacedLast14,
      battersFacedLast30: features.volume.battersFacedLast30,
      gamesSavedLast30: features.volume.gamesSavedLast30,
      gamesStartedLast30: features.volume.gamesStartedLast30,
      pitchesPerInning: features.volume.pitchesPerInning,
      daysSinceLastAppearance: features.volume.daysSinceLastAppearance,
      eraLast30: features.rates.eraLast30,
      whipLast30: features.rates.whipLast30,
      fipLast30: features.rates.fipLast30,
      xfipLast30: features.rates.xfipLast30,
      strikeoutRateLast30: features.rates.strikeoutRateLast30,
      walkRateLast30: features.rates.walkRateLast30,
      kToBBRatioLast30: features.rates.kToBBRatioLast30,
      swingingStrikeRate: features.rates.swingingStrikeRate,
      firstPitchStrikeRate: features.rates.firstPitchStrikeRate,
      avgVelocity: features.rates.avgVelocity,
      gbRatio: features.rates.gbRatio,
      hrPer9: features.rates.hrPer9,
      eraReliable: features.stabilization.eraReliable,
      whipReliable: features.stabilization.whipReliable,
      fipReliable: features.stabilization.fipReliable,
      kRateReliable: features.stabilization.kRateReliable,
      bbRateReliable: features.stabilization.bbRateReliable,
      battersToReliable: features.stabilization.battersToReliable,
      qualityStartRate: features.volatility.qualityStartRate,
      blowUpRate: features.volatility.blowUpRate,
      eraVolatility: features.volatility.eraVolatility,
      consistencyScore: features.volatility.consistencyScore,
      opponentOps: features.context.opponentOps,
      parkFactor: features.context.parkFactor,
      isHome: features.context.isHome,
      isCloser: features.context.isCloser,
      scheduledStartNext7: features.context.scheduledStartNext7,
      opponentNextStart: features.context.opponentNextStart,
      traceId,
    },
    update: {
      computedAt: features.computedAt,
      appearancesLast7: features.volume.appearancesLast7,
      appearancesLast14: features.volume.appearancesLast14,
      appearancesLast30: features.volume.appearancesLast30,
      inningsPitchedLast7: features.volume.inningsPitchedLast7,
      inningsPitchedLast14: features.volume.inningsPitchedLast14,
      inningsPitchedLast30: features.volume.inningsPitchedLast30,
      battersFacedLast7: features.volume.battersFacedLast7,
      battersFacedLast14: features.volume.battersFacedLast14,
      battersFacedLast30: features.volume.battersFacedLast30,
      gamesSavedLast30: features.volume.gamesSavedLast30,
      gamesStartedLast30: features.volume.gamesStartedLast30,
      pitchesPerInning: features.volume.pitchesPerInning,
      daysSinceLastAppearance: features.volume.daysSinceLastAppearance,
      eraLast30: features.rates.eraLast30,
      whipLast30: features.rates.whipLast30,
      fipLast30: features.rates.fipLast30,
      xfipLast30: features.rates.xfipLast30,
      strikeoutRateLast30: features.rates.strikeoutRateLast30,
      walkRateLast30: features.rates.walkRateLast30,
      kToBBRatioLast30: features.rates.kToBBRatioLast30,
      swingingStrikeRate: features.rates.swingingStrikeRate,
      firstPitchStrikeRate: features.rates.firstPitchStrikeRate,
      avgVelocity: features.rates.avgVelocity,
      gbRatio: features.rates.gbRatio,
      hrPer9: features.rates.hrPer9,
      eraReliable: features.stabilization.eraReliable,
      whipReliable: features.stabilization.whipReliable,
      fipReliable: features.stabilization.fipReliable,
      kRateReliable: features.stabilization.kRateReliable,
      bbRateReliable: features.stabilization.bbRateReliable,
      battersToReliable: features.stabilization.battersToReliable,
      qualityStartRate: features.volatility.qualityStartRate,
      blowUpRate: features.volatility.blowUpRate,
      eraVolatility: features.volatility.eraVolatility,
      consistencyScore: features.volatility.consistencyScore,
      opponentOps: features.context.opponentOps,
      parkFactor: features.context.parkFactor,
      isHome: features.context.isHome,
      isCloser: features.context.isCloser,
      scheduledStartNext7: features.context.scheduledStartNext7,
      opponentNextStart: features.context.opponentNextStart,
      traceId,
    },
  });
}

export async function getPitcherDerivedFeatures(
  playerMlbamId: string,
  season: number
): Promise<PitcherDerivedFeatures | null> {
  const record = await prisma.pitcherDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' },
  });

  if (!record) {
    return null;
  }

  return {
    playerId: record.playerId,
    playerMlbamId: record.playerMlbamId,
    season: record.season,
    computedAt: record.computedAt,
    volume: {
      appearancesLast7: record.appearancesLast7,
      appearancesLast14: record.appearancesLast14,
      appearancesLast30: record.appearancesLast30,
      inningsPitchedLast7: record.inningsPitchedLast7,
      inningsPitchedLast14: record.inningsPitchedLast14,
      inningsPitchedLast30: record.inningsPitchedLast30,
      battersFacedLast7: record.battersFacedLast7,
      battersFacedLast14: record.battersFacedLast14,
      battersFacedLast30: record.battersFacedLast30,
      gamesSavedLast30: record.gamesSavedLast30,
      gamesStartedLast30: record.gamesStartedLast30,
      pitchesPerInning: record.pitchesPerInning,
      daysSinceLastAppearance: record.daysSinceLastAppearance,
    },
    rates: {
      eraLast30: record.eraLast30,
      whipLast30: record.whipLast30,
      fipLast30: record.fipLast30,
      xfipLast30: record.xfipLast30,
      strikeoutRateLast30: record.strikeoutRateLast30,
      walkRateLast30: record.walkRateLast30,
      kToBBRatioLast30: record.kToBBRatioLast30,
      swingingStrikeRate: record.swingingStrikeRate,
      firstPitchStrikeRate: record.firstPitchStrikeRate,
      avgVelocity: record.avgVelocity,
      gbRatio: record.gbRatio,
      hrPer9: record.hrPer9,
    },
    stabilization: {
      eraReliable: record.eraReliable,
      whipReliable: record.whipReliable,
      fipReliable: record.fipReliable,
      kRateReliable: record.kRateReliable,
      bbRateReliable: record.bbRateReliable,
      battersToReliable: record.battersToReliable,
    },
    volatility: {
      qualityStartRate: record.qualityStartRate,
      blowUpRate: record.blowUpRate,
      eraVolatility: record.eraVolatility,
      consistencyScore: record.consistencyScore,
    },
    context: {
      opponentOps: record.opponentOps,
      parkFactor: record.parkFactor,
      isHome: record.isHome,
      isCloser: record.isCloser,
      scheduledStartNext7: record.scheduledStartNext7,
      opponentNextStart: record.opponentNextStart,
    },
  };
}

export async function getAllPitcherDerivedFeatures(
  season: number
): Promise<PitcherDerivedFeatures[]> {
  const records = await prisma.pitcherDerivedStats.findMany({
    where: { season },
    distinct: ['playerMlbamId'],
    orderBy: { computedAt: 'desc' },
  });

  return records.map((record) => ({
    playerId: record.playerId,
    playerMlbamId: record.playerMlbamId,
    season: record.season,
    computedAt: record.computedAt,
    volume: {
      appearancesLast7: record.appearancesLast7,
      appearancesLast14: record.appearancesLast14,
      appearancesLast30: record.appearancesLast30,
      inningsPitchedLast7: record.inningsPitchedLast7,
      inningsPitchedLast14: record.inningsPitchedLast14,
      inningsPitchedLast30: record.inningsPitchedLast30,
      battersFacedLast7: record.battersFacedLast7,
      battersFacedLast14: record.battersFacedLast14,
      battersFacedLast30: record.battersFacedLast30,
      gamesSavedLast30: record.gamesSavedLast30,
      gamesStartedLast30: record.gamesStartedLast30,
      pitchesPerInning: record.pitchesPerInning,
      daysSinceLastAppearance: record.daysSinceLastAppearance,
    },
    rates: {
      eraLast30: record.eraLast30,
      whipLast30: record.whipLast30,
      fipLast30: record.fipLast30,
      xfipLast30: record.xfipLast30,
      strikeoutRateLast30: record.strikeoutRateLast30,
      walkRateLast30: record.walkRateLast30,
      kToBBRatioLast30: record.kToBBRatioLast30,
      swingingStrikeRate: record.swingingStrikeRate,
      firstPitchStrikeRate: record.firstPitchStrikeRate,
      avgVelocity: record.avgVelocity,
      gbRatio: record.gbRatio,
      hrPer9: record.hrPer9,
    },
    stabilization: {
      eraReliable: record.eraReliable,
      whipReliable: record.whipReliable,
      fipReliable: record.fipReliable,
      kRateReliable: record.kRateReliable,
      bbRateReliable: record.bbRateReliable,
      battersToReliable: record.battersToReliable,
    },
    volatility: {
      qualityStartRate: record.qualityStartRate,
      blowUpRate: record.blowUpRate,
      eraVolatility: record.eraVolatility,
      consistencyScore: record.consistencyScore,
    },
    context: {
      opponentOps: record.opponentOps,
      parkFactor: record.parkFactor,
      isHome: record.isHome,
      isCloser: record.isCloser,
      scheduledStartNext7: record.scheduledStartNext7,
      opponentNextStart: record.opponentNextStart,
    },
  }));
}
