/**
 * Derived Facts Layer
 *
 * Deterministic, idempotent, reproducible transformations of raw data.
 * No opinions, no strategy — just objectively true features.
 *
 * Features computed:
 * - Recent volume (games, PA over window)
 * - Recent rates (AVG, OBP, SLG over window)
 * - Opportunity signals (playing time, lineup spot)
 * - Stabilization (stat reliability)
 * - Volatility (consistency)
 * - Replacement context (vs waiver baseline)
 */

import { prisma } from '@cbb/infrastructure';

// ============================================================================
// Types
// ============================================================================

export interface DerivedFeatures {
  // Identity
  playerId: string;
  playerMlbamId: string;
  season: number;
  computedAt: Date;

  // Volume features (rolling windows)
  volume: {
    gamesLast7: number;
    gamesLast14: number;
    gamesLast30: number;
    plateAppearancesLast7: number;
    plateAppearancesLast14: number;
    plateAppearancesLast30: number;
    atBatsLast30: number;
  };

  // Rate features (rolling averages)
  rates: {
    battingAverageLast30: number | null;
    onBasePctLast30: number | null;
    sluggingPctLast30: number | null;
    opsLast30: number | null;
    isoLast30: number | null; // Isolated power
    walkRateLast30: number | null; // BB%
    strikeoutRateLast30: number | null; // K%
    babipLast30: number | null; // Batting average on balls in play
  };

  // Stabilization (stat reliability)
  stabilization: {
    battingAverageReliable: boolean;
    obpReliable: boolean;
    slgReliable: boolean;
    opsReliable: boolean;
    gamesToReliable: number; // How many more games until reliable
  };

  // Volatility (consistency)
  volatility: {
    hitConsistencyScore: number; // 0-100, higher = more consistent
    productionVolatility: number; // Coefficient of variation
    zeroHitGamesLast14: number;
    multiHitGamesLast14: number;
  };

  // Opportunity signals
  opportunity: {
    gamesStartedLast14: number;
    lineupSpot: number | null; // Avg batting order position
    platoonRisk: 'low' | 'medium' | 'high' | null;
    playingTimeTrend: 'up' | 'stable' | 'down' | null;
  };

  // Replacement context
  replacement: {
    positionEligibility: string[];
    waiverWireValue: number | null; // Percentile vs replacement
    rosteredPercent: number | null; // If available from external source
  };
}

// ============================================================================
// Constants
// ============================================================================

// Stabilization thresholds (plate appearances needed)
const STABILIZATION_PAs = {
  battingAverage: 100,
  onBasePct: 150,
  sluggingPct: 200,
  ops: 200,
};

// Rolling window sizes in days
const WINDOWS = {
  short: 7,
  medium: 14,
  long: 30,
};

// ============================================================================
// Feature Computation
// ============================================================================

interface RawStats {
  statDate: Date;
  gamesPlayed: number;
  atBats: number;
  plateAppearances?: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  battingAvg?: string;
  onBasePct?: string;
  sluggingPct?: string;
}

/**
 * Compute derived features for a player.
 * Deterministic: same raw stats always produce same features.
 */
export function computeDerivedFeatures(
  playerId: string,
  playerMlbamId: string,
  season: number,
  rawStats: RawStats[],
  referenceDate: Date = new Date()
): DerivedFeatures {
  // Sort by date descending
  const sortedStats = [...rawStats].sort(
    (a, b) => b.statDate.getTime() - a.statDate.getTime()
  );

  // Filter to rolling windows
  const last7 = filterByWindow(sortedStats, referenceDate, WINDOWS.short);
  const last14 = filterByWindow(sortedStats, referenceDate, WINDOWS.medium);
  const last30 = filterByWindow(sortedStats, referenceDate, WINDOWS.long);

  // Compute volume features
  const volume = computeVolumeFeatures(last7, last14, last30);

  // Compute rate features
  const rates = computeRateFeatures(last30);

  // Compute stabilization
  const stabilization = computeStabilization(last30, volume.plateAppearancesLast30);

  // Compute volatility
  const volatility = computeVolatility(last14);

  // Compute opportunity signals
  const opportunity = computeOpportunitySignals(last14, sortedStats);

  // Compute replacement context (placeholder for now)
  const replacement = computeReplacementContext(playerId);

  return {
    playerId,
    playerMlbamId,
    season,
    computedAt: referenceDate,
    volume,
    rates,
    stabilization,
    volatility,
    opportunity,
    replacement,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function filterByWindow(
  stats: RawStats[],
  referenceDate: Date,
  days: number
): RawStats[] {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - days);

  return stats.filter((s) => s.statDate >= cutoff);
}

function computeVolumeFeatures(
  last7: RawStats[],
  last14: RawStats[],
  last30: RawStats[]
): DerivedFeatures['volume'] {
  const sumGames = (stats: RawStats[]) =>
    stats.reduce((sum, s) => sum + (s.gamesPlayed || 0), 0);

  const sumPA = (stats: RawStats[]) =>
    stats.reduce(
      (sum, s) => sum + (s.plateAppearances || s.atBats + (s.walks || 0)),
      0
    );

  const sumAB = (stats: RawStats[]) =>
    stats.reduce((sum, s) => sum + (s.atBats || 0), 0);

  return {
    gamesLast7: sumGames(last7),
    gamesLast14: sumGames(last14),
    gamesLast30: sumGames(last30),
    plateAppearancesLast7: sumPA(last7),
    plateAppearancesLast14: sumPA(last14),
    plateAppearancesLast30: sumPA(last30),
    atBatsLast30: sumAB(last30),
  };
}

function computeRateFeatures(last30: RawStats[]): DerivedFeatures['rates'] {
  // Aggregate totals
  const totals = last30.reduce(
    (acc, s) => ({
      atBats: acc.atBats + (s.atBats || 0),
      hits: acc.hits + (s.hits || 0),
      doubles: acc.doubles + (s.doubles || 0),
      triples: acc.triples + (s.triples || 0),
      homeRuns: acc.homeRuns + (s.homeRuns || 0),
      walks: acc.walks + (s.walks || 0),
      strikeouts: acc.strikeouts + (s.strikeouts || 0),
    }),
    {
      atBats: 0,
      hits: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      walks: 0,
      strikeouts: 0,
    }
  );

  const pa = totals.atBats + totals.walks;

  // Compute rates (null if insufficient sample)
  const battingAverage =
    totals.atBats >= 10 ? totals.hits / totals.atBats : null;

  const onBasePct = pa >= 10 ? (totals.hits + totals.walks) / pa : null;

  const totalBases =
    totals.hits +
    totals.doubles +
    totals.triples * 2 +
    totals.homeRuns * 3;
  const sluggingPct =
    totals.atBats >= 10 ? totalBases / totals.atBats : null;

  const ops =
    onBasePct !== null && sluggingPct !== null
      ? onBasePct + sluggingPct
      : null;

  const iso =
    battingAverage !== null && sluggingPct !== null
      ? sluggingPct - battingAverage
      : null;

  const walkRate = pa >= 10 ? totals.walks / pa : null;
  const strikeoutRate = pa >= 10 ? totals.strikeouts / pa : null;

  // BABIP = (H - HR) / (AB - SO - HR + SF)
  // Simplified: (H - HR) / (AB - SO - HR)
  const babipDenominator = totals.atBats - totals.strikeouts - totals.homeRuns;
  const babip =
    babipDenominator >= 10
      ? (totals.hits - totals.homeRuns) / babipDenominator
      : null;

  return {
    battingAverageLast30: battingAverage,
    onBasePctLast30: onBasePct,
    sluggingPctLast30: sluggingPct,
    opsLast30: ops,
    isoLast30: iso,
    walkRateLast30: walkRate,
    strikeoutRateLast30: strikeoutRate,
    babipLast30: babip,
  };
}

function computeStabilization(
  last30: RawStats[],
  totalPA: number
): DerivedFeatures['stabilization'] {
  return {
    battingAverageReliable: totalPA >= STABILIZATION_PAs.battingAverage,
    obpReliable: totalPA >= STABILIZATION_PAs.onBasePct,
    slgReliable: totalPA >= STABILIZATION_PAs.sluggingPct,
    opsReliable: totalPA >= STABILIZATION_PAs.ops,
    gamesToReliable: Math.max(
      0,
      Math.ceil((STABILIZATION_PAs.ops - totalPA) / 4)
    ), // Assume ~4 PA per game
  };
}

function computeVolatility(last14: RawStats[]): DerivedFeatures['volatility'] {
  // Count games with 0 hits vs multi-hit games
  const zeroHitGames = last14.filter((s) => s.hits === 0).length;
  const multiHitGames = last14.filter((s) => s.hits >= 2).length;

  // Compute hit consistency score (0-100)
  // Higher = more consistent (fewer 0-hit games, more multi-hit games)
  const gamesWithHits = last14.length - zeroHitGames;
  const consistencyScore =
    last14.length > 0
      ? Math.round(((gamesWithHits * 0.7 + multiHitGames * 0.3) / last14.length) * 100)
      : 0;

  // Production volatility: coefficient of variation of hits per game
  const hitsPerGame = last14.map((s) => s.hits);
  const mean =
    hitsPerGame.reduce((a, b) => a + b, 0) / (hitsPerGame.length || 1);
  const variance =
    hitsPerGame.reduce((acc, h) => acc + Math.pow(h - mean, 2), 0) /
    (hitsPerGame.length || 1);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  return {
    hitConsistencyScore: consistencyScore,
    productionVolatility: cv,
    zeroHitGamesLast14: zeroHitGames,
    multiHitGamesLast14: multiHitGames,
  };
}

function computeOpportunitySignals(
  last14: RawStats[],
  allStats: RawStats[]
): DerivedFeatures['opportunity'] {
  // Games started (approximated by games with >0 PA)
  const gamesStarted = last14.filter(
    (s) => (s.plateAppearances || s.atBats) > 0
  ).length;

  // Playing time trend: compare last 7 to previous 7
  const last7 = allStats.slice(0, 7);
  const previous7 = allStats.slice(7, 14);

  const last7Games = last7.reduce((sum, s) => sum + (s.gamesPlayed || 0), 0);
  const prev7Games = previous7.reduce(
    (sum, s) => sum + (s.gamesPlayed || 0),
    0
  );

  let playingTimeTrend: 'up' | 'stable' | 'down' | null = 'stable';
  if (last7Games > prev7Games + 1) playingTimeTrend = 'up';
  else if (last7Games < prev7Games - 1) playingTimeTrend = 'down';

  // Platoon risk: high if inconsistent playing time
  const gamesWithZeroPA = last14.filter(
    (s) => (s.plateAppearances || s.atBats) === 0
  ).length;
  let platoonRisk: 'low' | 'medium' | 'high' | null = 'low';
  if (gamesWithZeroPA >= 3) platoonRisk = 'high';
  else if (gamesWithZeroPA >= 1) platoonRisk = 'medium';

  // Lineup spot: placeholder (would need external data)
  const lineupSpot = null;

  return {
    gamesStartedLast14: gamesStarted,
    lineupSpot,
    platoonRisk,
    playingTimeTrend,
  };
}

function computeReplacementContext(
  playerId: string
): DerivedFeatures['replacement'] {
  // Placeholder - would integrate with external roster data
  return {
    positionEligibility: [], // Would populate from roster data
    waiverWireValue: null,
    rosteredPercent: null,
  };
}
