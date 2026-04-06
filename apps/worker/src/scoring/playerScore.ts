/**
 * Player Scoring Module
 *
 * Computes fantasy-relevant scores from derived stats.
 * This is called ONLY after identity verification is complete.
 */

import { prisma } from '@cbb/infrastructure';
import { classifyPlayerRole } from '../verification/playerIdentity.js';

export interface PlayerScore {
  overallValue: number;
  components: {
    hitting: number;
    power: number;
    speed: number;
    plateDiscipline: number;
    consistency: number;
    opportunity: number;
  };
  confidence: number;
  reliability: {
    sampleSize: 'small' | 'large' | 'adequate' | 'insufficient';
    gamesToReliable: number;
    statsReliable: boolean;
  };
}

/**
 * Compute player score from derived stats
 *
 * PRECONDITION: Player identity is already verified
 */
export async function computePlayerScore(mlbamId: string): Promise<PlayerScore> {
  const traceId = `score-${mlbamId}-${Date.now()}`;
  console.log(`[${traceId}] Computing score for: ${mlbamId}`);

  const verifiedPlayer = await prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
    select: {
      fullName: true,
      position: true,
    },
  });

  if (verifiedPlayer) {
    const role = classifyPlayerRole(verifiedPlayer.position);
    if (role !== 'hitter') {
      throw new Error(
        `Player ${verifiedPlayer.fullName} (${mlbamId}) is classified as ${role}; hitter scoring does not support this role.`
      );
    }
  }

  // Fetch derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId: mlbamId },
    orderBy: { computedAt: 'desc' },
  });

  if (!derived) {
    console.warn(`[${traceId}] No derived stats found for ${mlbamId}`);
    return createDefaultScore();
  }

  // Compute component scores (simplified for Phase 1)
  const hitting = computeHittingScore(derived);
  const power = computePowerScore(derived);
  const speed = computeSpeedScore(derived);
  const plateDiscipline = computePlateDisciplineScore(derived);
  const consistency = computeConsistencyScore(derived);
  const opportunity = computeOpportunityScore(derived);

  // Overall value (weighted average)
  const overallValue = Math.round(
    (hitting * 0.25 +
      power * 0.25 +
      speed * 0.1 +
      plateDiscipline * 0.15 +
      consistency * 0.15 +
      opportunity * 0.1)
  );

  // Reliability assessment
  const gamesCount = derived.gamesLast30;
  let sampleSize: 'small' | 'large' | 'adequate' | 'insufficient';
  if (gamesCount >= 100) sampleSize = 'large' as const;
  else if (gamesCount >= 50) sampleSize = 'adequate' as const;
  else if (gamesCount >= 20) sampleSize = 'small' as const;
  else sampleSize = 'insufficient' as const;

  const score: PlayerScore = {
    overallValue,
    components: {
      hitting,
      power,
      speed,
      plateDiscipline,
      consistency,
      opportunity,
    },
    confidence: derived.gamesToReliable > 0 ? 0.6 : 0.4,
    reliability: {
      sampleSize,
      gamesToReliable: derived.gamesToReliable,
      statsReliable: derived.opsReliable || false,
    },
  };

  console.log(`[${traceId}] Score computed: ${overallValue}`);
  return score;
}

// Helper functions for component scoring
function computeHittingScore(derived: {
  battingAverageLast30: number | null;
  opsLast30: number | null;
}): number {
  if (!derived.battingAverageLast30 || !derived.opsLast30) return 50;
  const avgScore = Math.min(100, Math.max(0, derived.battingAverageLast30 * 300));
  const opsScore = Math.min(100, Math.max(0, derived.opsLast30 * 100));
  return Math.round((avgScore + opsScore) / 2);
}

function computePowerScore(derived: {
  isoLast30: number | null;
}): number {
  if (!derived.isoLast30) return 50;
  return Math.min(100, Math.max(0, derived.isoLast30 * 400));
}

function computeSpeedScore(derived: {
  gamesLast30: number;
}): number {
  // Simplified - would need actual SB data from game logs
  if (derived.gamesLast30 === 0) return 50;
  return 50; // Placeholder
}

function computePlateDisciplineScore(derived: {
  walkRateLast30: number | null;
  strikeoutRateLast30: number | null;
}): number {
  if (!derived.walkRateLast30 || !derived.strikeoutRateLast30) return 50;
  const bbScore = Math.min(100, derived.walkRateLast30 * 1500);
  const kScore = Math.max(0, 100 - derived.strikeoutRateLast30 * 200);
  return Math.round((bbScore + kScore) / 2);
}

function computeConsistencyScore(derived: {
  hitConsistencyScore: number;
}): number {
  return derived.hitConsistencyScore || 50;
}

function computeOpportunityScore(derived: {
  gamesLast30: number;
  plateAppearancesLast30: number;
}): number {
  if (derived.gamesLast30 === 0) return 0;
  const paPerGame = derived.plateAppearancesLast30 / derived.gamesLast30;
  return Math.min(100, Math.round(paPerGame * 15));
}

function createDefaultScore(): PlayerScore {
  return {
    overallValue: 50,
    components: {
      hitting: 50,
      power: 50,
      speed: 50,
      plateDiscipline: 50,
      consistency: 50,
      opportunity: 50,
    },
    confidence: 0.3,
    reliability: {
      sampleSize: 'insufficient',
      gamesToReliable: 0,
      statsReliable: false,
    },
  };
}
