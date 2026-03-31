/**
 * Derived Features Storage
 *
 * Idempotent storage of computed derived features.
 * Recomputable from normalized data only.
 */

import { prisma } from '@cbb/infrastructure';
import type { DerivedFeatures } from './compute.js';

interface StoreDerivedFeaturesInput {
  features: DerivedFeatures;
  traceId: string;
}

/**
 * Store derived features.
 * Idempotent: same player/season/computedAt overwrites previous.
 */
export async function storeDerivedFeatures(
  input: StoreDerivedFeaturesInput
): Promise<void> {
  const { features, traceId } = input;

  // Natural key: player + season + computation date
  const dateKey = features.computedAt.toISOString().split('T')[0];

  await prisma.playerDerivedStats.upsert({
    where: {
      playerMlbamId_season_computedDate: {
        playerMlbamId: features.playerMlbamId,
        season: features.season,
        computedDate: new Date(dateKey),
      },
    },
    create: {
      playerId: features.playerId,
      playerMlbamId: features.playerMlbamId,
      season: features.season,
      computedAt: features.computedAt,
      computedDate: new Date(dateKey),

      // Volume
      gamesLast7: features.volume.gamesLast7,
      gamesLast14: features.volume.gamesLast14,
      gamesLast30: features.volume.gamesLast30,
      plateAppearancesLast7: features.volume.plateAppearancesLast7,
      plateAppearancesLast14: features.volume.plateAppearancesLast14,
      plateAppearancesLast30: features.volume.plateAppearancesLast30,
      atBatsLast30: features.volume.atBatsLast30,

      // Rates
      battingAverageLast30: features.rates.battingAverageLast30,
      onBasePctLast30: features.rates.onBasePctLast30,
      sluggingPctLast30: features.rates.sluggingPctLast30,
      opsLast30: features.rates.opsLast30,
      isoLast30: features.rates.isoLast30,
      walkRateLast30: features.rates.walkRateLast30,
      strikeoutRateLast30: features.rates.strikeoutRateLast30,
      babipLast30: features.rates.babipLast30,

      // Stabilization
      battingAverageReliable: features.stabilization.battingAverageReliable,
      obpReliable: features.stabilization.obpReliable,
      slgReliable: features.stabilization.slgReliable,
      opsReliable: features.stabilization.opsReliable,
      gamesToReliable: features.stabilization.gamesToReliable,

      // Volatility
      hitConsistencyScore: features.volatility.hitConsistencyScore,
      productionVolatility: features.volatility.productionVolatility,
      zeroHitGamesLast14: features.volatility.zeroHitGamesLast14,
      multiHitGamesLast14: features.volatility.multiHitGamesLast14,

      // Opportunity
      gamesStartedLast14: features.opportunity.gamesStartedLast14,
      lineupSpot: features.opportunity.lineupSpot,
      platoonRisk: features.opportunity.platoonRisk,
      playingTimeTrend: features.opportunity.playingTimeTrend,

      // Replacement
      positionEligibility: features.replacement.positionEligibility,
      waiverWireValue: features.replacement.waiverWireValue,
      rosteredPercent: features.replacement.rosteredPercent,

      // Audit
      traceId,
    },
    update: {
      // Recompute updates all fields
      computedAt: features.computedAt,

      // Volume
      gamesLast7: features.volume.gamesLast7,
      gamesLast14: features.volume.gamesLast14,
      gamesLast30: features.volume.gamesLast30,
      plateAppearancesLast7: features.volume.plateAppearancesLast7,
      plateAppearancesLast14: features.volume.plateAppearancesLast14,
      plateAppearancesLast30: features.volume.plateAppearancesLast30,
      atBatsLast30: features.volume.atBatsLast30,

      // Rates
      battingAverageLast30: features.rates.battingAverageLast30,
      onBasePctLast30: features.rates.onBasePctLast30,
      sluggingPctLast30: features.rates.sluggingPctLast30,
      opsLast30: features.rates.opsLast30,
      isoLast30: features.rates.isoLast30,
      walkRateLast30: features.rates.walkRateLast30,
      strikeoutRateLast30: features.rates.strikeoutRateLast30,
      babipLast30: features.rates.babipLast30,

      // Stabilization
      battingAverageReliable: features.stabilization.battingAverageReliable,
      obpReliable: features.stabilization.obpReliable,
      slgReliable: features.stabilization.slgReliable,
      opsReliable: features.stabilization.opsReliable,
      gamesToReliable: features.stabilization.gamesToReliable,

      // Volatility
      hitConsistencyScore: features.volatility.hitConsistencyScore,
      productionVolatility: features.volatility.productionVolatility,
      zeroHitGamesLast14: features.volatility.zeroHitGamesLast14,
      multiHitGamesLast14: features.volatility.multiHitGamesLast14,

      // Opportunity
      gamesStartedLast14: features.opportunity.gamesStartedLast14,
      lineupSpot: features.opportunity.lineupSpot,
      platoonRisk: features.opportunity.platoonRisk,
      playingTimeTrend: features.opportunity.playingTimeTrend,

      // Replacement
      positionEligibility: features.replacement.positionEligibility,
      waiverWireValue: features.replacement.waiverWireValue,
      rosteredPercent: features.replacement.rosteredPercent,

      // Audit
      traceId,
    },
  });
}

/**
 * Get derived features for a player.
 */
export async function getDerivedFeatures(
  playerMlbamId: string,
  season: number
): Promise<DerivedFeatures | null> {
  const record = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' },
  });

  if (!record) return null;

  // Reconstruct DerivedFeatures from flat record
  return {
    playerId: record.playerId,
    playerMlbamId: record.playerMlbamId,
    season: record.season,
    computedAt: record.computedAt,

    volume: {
      gamesLast7: record.gamesLast7,
      gamesLast14: record.gamesLast14,
      gamesLast30: record.gamesLast30,
      plateAppearancesLast7: record.plateAppearancesLast7,
      plateAppearancesLast14: record.plateAppearancesLast14,
      plateAppearancesLast30: record.plateAppearancesLast30,
      atBatsLast30: record.atBatsLast30,
    },

    rates: {
      battingAverageLast30: record.battingAverageLast30,
      onBasePctLast30: record.onBasePctLast30,
      sluggingPctLast30: record.sluggingPctLast30,
      opsLast30: record.opsLast30,
      isoLast30: record.isoLast30,
      walkRateLast30: record.walkRateLast30,
      strikeoutRateLast30: record.strikeoutRateLast30,
      babipLast30: record.babipLast30,
    },

    stabilization: {
      battingAverageReliable: record.battingAverageReliable,
      obpReliable: record.obpReliable,
      slgReliable: record.slgReliable,
      opsReliable: record.opsReliable,
      gamesToReliable: record.gamesToReliable,
    },

    volatility: {
      hitConsistencyScore: record.hitConsistencyScore,
      productionVolatility: record.productionVolatility,
      zeroHitGamesLast14: record.zeroHitGamesLast14,
      multiHitGamesLast14: record.multiHitGamesLast14,
    },

    opportunity: {
      gamesStartedLast14: record.gamesStartedLast14,
      lineupSpot: record.lineupSpot,
      platoonRisk: record.platoonRisk as
        | 'low'
        | 'medium'
        | 'high'
        | null,
      playingTimeTrend: record.playingTimeTrend as
        | 'up'
        | 'stable'
        | 'down'
        | null,
    },

    replacement: {
      positionEligibility: record.positionEligibility,
      waiverWireValue: record.waiverWireValue,
      rosteredPercent: record.rosteredPercent,
    },
  };
}

/**
 * Get all derived features for a season.
 */
export async function getAllDerivedFeatures(
  season: number
): Promise<DerivedFeatures[]> {
  // Get most recent computation for each player
  const records = await prisma.playerDerivedStats.findMany({
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
      gamesLast7: record.gamesLast7,
      gamesLast14: record.gamesLast14,
      gamesLast30: record.gamesLast30,
      plateAppearancesLast7: record.plateAppearancesLast7,
      plateAppearancesLast14: record.plateAppearancesLast14,
      plateAppearancesLast30: record.plateAppearancesLast30,
      atBatsLast30: record.atBatsLast30,
    },

    rates: {
      battingAverageLast30: record.battingAverageLast30,
      onBasePctLast30: record.onBasePctLast30,
      sluggingPctLast30: record.sluggingPctLast30,
      opsLast30: record.opsLast30,
      isoLast30: record.isoLast30,
      walkRateLast30: record.walkRateLast30,
      strikeoutRateLast30: record.strikeoutRateLast30,
      babipLast30: record.babipLast30,
    },

    stabilization: {
      battingAverageReliable: record.battingAverageReliable,
      obpReliable: record.obpReliable,
      slgReliable: record.slgReliable,
      opsReliable: record.opsReliable,
      gamesToReliable: record.gamesToReliable,
    },

    volatility: {
      hitConsistencyScore: record.hitConsistencyScore,
      productionVolatility: record.productionVolatility,
      zeroHitGamesLast14: record.zeroHitGamesLast14,
      multiHitGamesLast14: record.multiHitGamesLast14,
    },

    opportunity: {
      gamesStartedLast14: record.gamesStartedLast14,
      lineupSpot: record.lineupSpot,
      platoonRisk: record.platoonRisk as
        | 'low'
        | 'medium'
        | 'high'
        | null,
      playingTimeTrend: record.playingTimeTrend as
        | 'up'
        | 'stable'
        | 'down'
        | null,
    },

    replacement: {
      positionEligibility: record.positionEligibility,
      waiverWireValue: record.waiverWireValue,
      rosteredPercent: record.rosteredPercent,
    },
  }));
}
