/**
 * Pitcher Derived Features (Parallel to hitters/derived)
 * 
 * Raw data → deterministic pitcher features.
 * No opinions, just objectively true pitcher-specific features.
 */

// ============================================================================
// Types
// ============================================================================

export interface PitcherDerivedFeatures {
  // Identity (shared with hitters)
  playerId: string;
  playerMlbamId: string;
  season: number;
  computedAt: Date;

  // Volume features (rolling windows)
  volume: {
    appearancesLast7: number;
    appearancesLast14: number;
    appearancesLast30: number;
    inningsPitchedLast7: number;
    inningsPitchedLast14: number;
    inningsPitchedLast30: number;
    battersFacedLast7: number;
    battersFacedLast14: number;
    battersFacedLast30: number;
    gamesSavedLast30: number;
    gamesStartedLast30: number;
    pitchesPerInning: number | null;
    daysSinceLastAppearance: number | null;
  };

  // Rate features (rolling averages)
  rates: {
    eraLast30: number | null;
    whipLast30: number | null;
    fipLast30: number | null;           // Fielding Independent Pitching
    xfipLast30: number | null;          // Expected FIP
    strikeoutRateLast30: number | null; // K%
    walkRateLast30: number | null;      // BB%
    kToBBRatioLast30: number | null;    // K/BB
    swingingStrikeRate: number | null;  // SwStr%
    firstPitchStrikeRate: number | null;// FPS%
    avgVelocity: number | null;         // Average fastball velocity
    gbRatio: number | null;             // Ground ball ratio
    hrPer9: number | null;              // HR/9
  };

  // Stabilization (stat reliability)
  stabilization: {
    eraReliable: boolean;
    whipReliable: boolean;
    fipReliable: boolean;
    kRateReliable: boolean;
    bbRateReliable: boolean;
    battersToReliable: number; // How many more BF until reliable
  };

  // Volatility (consistency)
  volatility: {
    qualityStartRate: number | null;    // % of starts with 6+ IP, 3- ER
    blowUpRate: number | null;          // % of appearances with 5+ ER
    eraVolatility: number | null;       // Std dev of game ERA
    consistencyScore: number;           // 0-100, higher = more consistent
  };

  // Context/matchup
  context: {
    opponentOps: number | null;         // Opponent OPS vs handedness
    parkFactor: number | null;          // Park factor (100 = neutral)
    isHome: boolean | null;
    isCloser: boolean | null;           // Is currently the closer
    scheduledStartNext7: boolean;       // Has a scheduled start next 7 days
    opponentNextStart: string | null;   // Team abbreviation
  };
}

// ============================================================================
// Constants
// ============================================================================

// Stabilization thresholds (batters faced needed)
const STABILIZATION_BF = {
  strikeoutRate: 100,
  walkRate: 150,
  era: 200,
  whip: 200,
  fip: 200,
};

// Rolling window sizes in days
const WINDOWS = {
  short: 7,
  medium: 14,
  long: 30,
};

// ============================================================================
// Types for Raw Input
// ============================================================================

interface RawPitcherStats {
  statDate: Date;
  gamesPlayed: number;
  gamesStarted: number;
  gamesSaved: number;
  inningsPitched: number;  // Can be decimal (e.g., 5.1 = 5 1/3)
  battersFaced: number;
  hitsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRunsAllowed: number;
  pitches: number;
  strikes: number;
  firstPitchStrikes: number;
  swingingStrikes: number;
  groundBalls: number;
  flyBalls: number;
}

// ============================================================================
// Feature Computation
// ============================================================================

/**
 * Compute derived pitcher features.
 * Deterministic: same raw stats always produce same features.
 */
export function computePitcherDerivedFeatures(
  playerId: string,
  playerMlbamId: string,
  season: number,
  rawStats: RawPitcherStats[],
  referenceDate: Date = new Date()
): PitcherDerivedFeatures {
  // Sort by date descending
  const sortedStats = [...rawStats].sort(
    (a, b) => b.statDate.getTime() - a.statDate.getTime()
  );

  // Filter to rolling windows
  const last7 = filterByWindow(sortedStats, referenceDate, WINDOWS.short);
  const last14 = filterByWindow(sortedStats, referenceDate, WINDOWS.medium);
  const last30 = filterByWindow(sortedStats, referenceDate, WINDOWS.long);

  // Compute volume features
  const volume = computeVolumeFeatures(last7, last14, last30, sortedStats);

  // Compute rate features
  const rates = computeRateFeatures(last30);

  // Compute stabilization
  const stabilization = computeStabilization(last30, volume.battersFacedLast30);

  // Compute volatility
  const volatility = computeVolatility(last30);

  // Compute context (placeholder for external data)
  const context = computeContext(playerMlbamId);

  return {
    playerId,
    playerMlbamId,
    season,
    computedAt: referenceDate,
    volume,
    rates,
    stabilization,
    volatility,
    context,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function filterByWindow(
  stats: RawPitcherStats[],
  referenceDate: Date,
  days: number
): RawPitcherStats[] {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - days);
  return stats.filter((s) => s.statDate >= cutoff);
}

function computeVolumeFeatures(
  last7: RawPitcherStats[],
  last14: RawPitcherStats[],
  last30: RawPitcherStats[],
  allStats: RawPitcherStats[]
): PitcherDerivedFeatures['volume'] {
  const sumAppearances = (stats: RawPitcherStats[]) =>
    stats.reduce((sum, s) => sum + (s.gamesPlayed || 0), 0);

  const sumInnings = (stats: RawPitcherStats[]) =>
    stats.reduce((sum, s) => sum + (s.inningsPitched || 0), 0);

  const sumBattersFaced = (stats: RawPitcherStats[]) =>
    stats.reduce((sum, s) => sum + (s.battersFaced || 0), 0);

  const sumGamesSaved = (stats: RawPitcherStats[]) =>
    stats.reduce((sum, s) => sum + (s.gamesSaved || 0), 0);

  const sumGamesStarted = (stats: RawPitcherStats[]) =>
    stats.reduce((sum, s) => sum + (s.gamesStarted || 0), 0);

  const sumPitches = (stats: RawPitcherStats[]) =>
    stats.reduce((sum, s) => sum + (s.pitches || 0), 0);

  const appearancesLast30 = sumAppearances(last30);
  const inningsLast30 = sumInnings(last30);

  // Pitches per inning
  const pitchesPerInning = inningsLast30 > 0
    ? sumPitches(last30) / inningsLast30
    : null;

  // Days since last appearance
  const daysSinceLastAppearance = allStats.length > 0
    ? Math.floor(
        (new Date().getTime() - allStats[0].statDate.getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;

  return {
    appearancesLast7: sumAppearances(last7),
    appearancesLast14: sumAppearances(last14),
    appearancesLast30,
    inningsPitchedLast7: sumInnings(last7),
    inningsPitchedLast14: sumInnings(last14),
    inningsPitchedLast30: inningsLast30,
    battersFacedLast7: sumBattersFaced(last7),
    battersFacedLast14: sumBattersFaced(last14),
    battersFacedLast30: sumBattersFaced(last30),
    gamesSavedLast30: sumGamesSaved(last30),
    gamesStartedLast30: sumGamesStarted(last30),
    pitchesPerInning,
    daysSinceLastAppearance,
  };
}

function computeRateFeatures(last30: RawPitcherStats[]): PitcherDerivedFeatures['rates'] {
  // Aggregate totals
  const totals = last30.reduce(
    (acc, s) => ({
      innings: acc.innings + (s.inningsPitched || 0),
      battersFaced: acc.battersFaced + (s.battersFaced || 0),
      hits: acc.hits + (s.hitsAllowed || 0),
      runs: acc.runs + (s.runsAllowed || 0),
      earnedRuns: acc.earnedRuns + (s.earnedRuns || 0),
      walks: acc.walks + (s.walks || 0),
      strikeouts: acc.strikeouts + (s.strikeouts || 0),
      homeRuns: acc.homeRuns + (s.homeRunsAllowed || 0),
      firstPitchStrikes: acc.firstPitchStrikes + (s.firstPitchStrikes || 0),
      swingingStrikes: acc.swingingStrikes + (s.swingingStrikes || 0),
      groundBalls: acc.groundBalls + (s.groundBalls || 0),
      flyBalls: acc.flyBalls + (s.flyBalls || 0),
    }),
    {
      innings: 0,
      battersFaced: 0,
      hits: 0,
      runs: 0,
      earnedRuns: 0,
      walks: 0,
      strikeouts: 0,
      homeRuns: 0,
      firstPitchStrikes: 0,
      swingingStrikes: 0,
      groundBalls: 0,
      flyBalls: 0,
    }
  );

  // Need minimum innings to compute rates
  if (totals.innings < 5) {
    return {
      eraLast30: null,
      whipLast30: null,
      fipLast30: null,
      xfipLast30: null,
      strikeoutRateLast30: null,
      walkRateLast30: null,
      kToBBRatioLast30: null,
      swingingStrikeRate: null,
      firstPitchStrikeRate: null,
      avgVelocity: null,
      gbRatio: null,
      hrPer9: null,
    };
  }

  // ERA (earned runs per 9 innings)
  const era = (totals.earnedRuns / totals.innings) * 9;

  // WHIP (walks + hits per inning)
  const whip = (totals.walks + totals.hits) / totals.innings;

  // K% and BB%
  const kRate = totals.battersFaced > 0 ? totals.strikeouts / totals.battersFaced : null;
  const bbRate = totals.battersFaced > 0 ? totals.walks / totals.battersFaced : null;
  const kToBB = bbRate && bbRate > 0 && kRate ? kRate / bbRate : null;

  // SwStr% and FPS%
  const swStrRate = totals.battersFaced > 0 ? totals.swingingStrikes / (totals.battersFaced * 3.5) : null; // Approx 3.5 pitches per PA
  const fpsRate = totals.battersFaced > 0 ? totals.firstPitchStrikes / totals.battersFaced : null;

  // FIP (simplified): (13*HR + 3*BB - 2*K) / IP + constant (~3.1)
  const fip = ((13 * totals.homeRuns + 3 * totals.walks - 2 * totals.strikeouts) / totals.innings) + 3.1;

  // xFIP would need league average HR/FB rate - using FIP as proxy
  const xfip = fip;

  // Ground ball ratio
  const totalBallsInPlay = totals.groundBalls + totals.flyBalls;
  const gbRatio = totalBallsInPlay > 0 ? totals.groundBalls / totalBallsInPlay : null;

  // HR/9
  const hrPer9 = (totals.homeRuns / totals.innings) * 9;

  return {
    eraLast30: era,
    whipLast30: whip,
    fipLast30: fip,
    xfipLast30: xfip,
    strikeoutRateLast30: kRate,
    walkRateLast30: bbRate,
    kToBBRatioLast30: kToBB,
    swingingStrikeRate: swStrRate,
    firstPitchStrikeRate: fpsRate,
    avgVelocity: null, // Would need pitch-level data
    gbRatio,
    hrPer9,
  };
}

function computeStabilization(
  last30: RawPitcherStats[],
  totalBF: number
): PitcherDerivedFeatures['stabilization'] {
  return {
    kRateReliable: totalBF >= STABILIZATION_BF.strikeoutRate,
    bbRateReliable: totalBF >= STABILIZATION_BF.walkRate,
    eraReliable: totalBF >= STABILIZATION_BF.era,
    whipReliable: totalBF >= STABILIZATION_BF.whip,
    fipReliable: totalBF >= STABILIZATION_BF.fip,
    battersToReliable: Math.max(
      0,
      Math.ceil((STABILIZATION_BF.era - totalBF) / 4) // Assume ~4 BF per inning
    ),
  };
}

function computeVolatility(last30: RawPitcherStats[]): PitcherDerivedFeatures['volatility'] {
  // Quality starts: 6+ IP, 3- ER
  const qualityStarts = last30.filter(
    (s) => s.inningsPitched >= 6 && s.earnedRuns <= 3
  ).length;
  const starts = last30.filter((s) => s.gamesStarted > 0).length;
  const qualityStartRate = starts > 0 ? qualityStarts / starts : null;

  // Blow-ups: 5+ ER
  const blowUps = last30.filter((s) => s.earnedRuns >= 5).length;
  const blowUpRate = last30.length > 0 ? blowUps / last30.length : null;

  // Game-by-game ERA volatility
  const gameEras = last30
    .filter((s) => s.inningsPitched > 0)
    .map((s) => (s.earnedRuns / s.inningsPitched) * 9);

  const meanEra = gameEras.reduce((a, b) => a + b, 0) / (gameEras.length || 1);
  const variance = gameEras.reduce((acc, e) => acc + Math.pow(e - meanEra, 2), 0) / (gameEras.length || 1);
  const eraVolatility = Math.sqrt(variance);

  // Consistency score (0-100)
  const consistencyScore = last30.length > 0
    ? Math.round(
        ((last30.length - blowUps) / last30.length) * 50 +
        (qualityStartRate || 0) * 50
      )
    : 0;

  return {
    qualityStartRate,
    blowUpRate,
    eraVolatility,
    consistencyScore,
  };
}

function computeContext(playerMlbamId: string): PitcherDerivedFeatures['context'] {
  // Placeholder - would integrate with schedule/opponent data
  return {
    opponentOps: null,
    parkFactor: null,
    isHome: null,
    isCloser: null,
    scheduledStartNext7: false,
    opponentNextStart: null,
  };
}

export type { RawPitcherStats };
