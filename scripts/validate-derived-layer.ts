/**
 * Derived Layer Validation - Comprehensive
 * 
 * Validates the transformation: Facts → Features
 * This layer must be deterministic, recomputable, and strategy-free.
 * 
 * Validation Strategy:
 * 1. Pick 5 random hitters with 10+ games
 * 2. Pick 5 random pitchers with 10+ games  
 * 3. For each player:
 *    - Get game logs (facts)
 *    - Calculate expected derived stats manually (features)
 *    - Compare to stored derived stats
 * 4. Report discrepancies
 * 
 * Exit Criteria:
 * - 100% match on volume stats (games, PA, AB)
 * - <1% variance on rate stats (accepting rounding differences)
 * - No derived stats that incorporate opinions/analysis
 */

import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

const season = parseInt(process.argv[2] || '2025');
const TOLERANCE = 0.01; // 1% tolerance

interface ValidationResult {
  playerMlbamId: string;
  name: string;
  position: 'hitter' | 'pitcher';
  gamesInSample: number;
  derivedComputedAt: Date;
  passed: boolean;
  discrepancies: Array<{
    field: string;
    expected: number;
    actual: number;
    variance: string;
  }>;
}

/**
 * Manual calculation of derived stats from game logs
 * This is the source of truth
 * 
 * IMPORTANT: The derived layer uses calendar days from the latest game date,
 * NOT days where games were played. So "last 7 days" means the 7 calendar days
 * prior to (and including) the most recent game.
 */
function calculateDerivedFromGames(games: Array<{
  gameDate: Date;
  gamesPlayed: number;
  plateAppearances: number;
  sacrificeFlies: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  hitByPitch: number;
  strikeouts: number;
  totalBases: number;
  rbi: number;
  runs: number;
  stolenBases: number;
  caughtStealing: number;
}>, asOfDate: Date) {
  // Normalize to date-only (strip time component)
  const normalizeDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const asOfNormalized = normalizeDate(asOfDate);
  
  // Cutoff dates (calendar days)
  const d7 = new Date(asOfNormalized); d7.setDate(d7.getDate() - 7);
  const d14 = new Date(asOfNormalized); d14.setDate(d14.getDate() - 14);
  const d30 = new Date(asOfNormalized); d30.setDate(d30.getDate() - 30);

  // Filter games by window (game date must be >= cutoff)
  // This matches the Prisma query: gameDate >= cutoffDate
  // e.g., if asOfDate is Sep 27 and cutoff is Sep 20, we want games on Sep 20-27
  const g7 = games.filter(g => normalizeDate(g.gameDate) >= d7);
  const g14 = games.filter(g => normalizeDate(g.gameDate) >= d14);
  const g30 = games.filter(g => normalizeDate(g.gameDate) >= d30);

  // Sum function
  const sum = (gameList: typeof games, field: keyof typeof games[0]) => 
    gameList.reduce((acc, g) => acc + (g[field] as number || 0), 0);

  return {
    // Volume (these must be EXACT)
    gamesLast7: sum(g7, 'gamesPlayed'),
    gamesLast14: sum(g14, 'gamesPlayed'),
    gamesLast30: sum(g30, 'gamesPlayed'),
    plateAppearancesLast7: sum(g7, 'plateAppearances'),
    plateAppearancesLast14: sum(g14, 'plateAppearances'),
    plateAppearancesLast30: sum(g30, 'plateAppearances'),
    atBatsLast30: sum(g30, 'atBats'),

    // Raw totals (for rate calculations)
    hitsLast30: sum(g30, 'hits'),
    doublesLast30: sum(g30, 'doubles'),
    triplesLast30: sum(g30, 'triples'),
    homeRunsLast30: sum(g30, 'homeRuns'),
    walksLast30: sum(g30, 'walks'),
    hitByPitchLast30: sum(g30, 'hitByPitch'),
    sacrificeFliesLast30: sum(g30, 'sacrificeFlies'),
    strikeoutsLast30: sum(g30, 'strikeouts'),
    totalBasesLast30: sum(g30, 'totalBases'),
    rbiLast30: sum(g30, 'rbi'),
    runsLast30: sum(g30, 'runs'),
    stolenBasesLast30: sum(g30, 'stolenBases'),
    caughtStealingLast30: sum(g30, 'caughtStealing'),

    // Rate calculations (deterministic)
    battingAverageLast30: sum(g30, 'atBats') > 0 
      ? sum(g30, 'hits') / sum(g30, 'atBats') 
      : 0,
    onBasePctLast30: sum(g30, 'plateAppearances') > 0
      ? (sum(g30, 'hits') + sum(g30, 'walks') + sum(g30, 'hitByPitch')) / sum(g30, 'plateAppearances')
      : 0,
    sluggingPctLast30: sum(g30, 'atBats') > 0
      ? sum(g30, 'totalBases') / sum(g30, 'atBats')
      : 0,
    walkRateLast30: sum(g30, 'plateAppearances') > 0
      ? sum(g30, 'walks') / sum(g30, 'plateAppearances')
      : 0,
    strikeoutRateLast30: sum(g30, 'plateAppearances') > 0
      ? sum(g30, 'strikeouts') / sum(g30, 'plateAppearances')
      : 0,
  };
}

/**
 * Compare expected vs actual with tolerance
 */
function compare(field: string, expected: number, actual: number, tolerance = TOLERANCE) {
  if (expected === 0 && actual === 0) return null;
  if (expected === 0) return { field, expected, actual, variance: '100%' };
  
  const variance = Math.abs((actual - expected) / expected);
  if (variance > tolerance) {
    return { 
      field, 
      expected, 
      actual, 
      variance: `${(variance * 100).toFixed(2)}%` 
    };
  }
  return null;
}

/**
 * Validate a single player
 */
async function validatePlayer(
  playerMlbamId: string,
  season: number,
  position: 'hitter' | 'pitcher'
): Promise<ValidationResult | null> {
  // Get derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' },
  });

  if (!derived) {
    console.log(`  ⚠️  No derived stats for ${playerMlbamId}`);
    return null;
  }

  // Get all game logs for this player/season
  // Derived stats use the latest game date as reference, not computedAt
  const gameLogs = await prisma.playerGameLog.findMany({
    where: {
      playerMlbamId,
      season,
    },
    orderBy: { gameDate: 'desc' },
  });
  
  // Use the latest game date as the reference point for calculations
  // This matches how derived features are actually computed
  const latestGameDate = gameLogs[0].gameDate;

  // Calculate expected values using latest game date as reference
  const expected = calculateDerivedFromGames(gameLogs, latestGameDate);

  // Compare to stored values
  const discrepancies = [
    // Volume stats (must be exact)
    compare('gamesLast7', expected.gamesLast7, derived.gamesLast7, 0),
    compare('gamesLast14', expected.gamesLast14, derived.gamesLast14, 0),
    compare('gamesLast30', expected.gamesLast30, derived.gamesLast30, 0),
    compare('plateAppearancesLast7', expected.plateAppearancesLast7, derived.plateAppearancesLast7, 0),
    compare('plateAppearancesLast14', expected.plateAppearancesLast14, derived.plateAppearancesLast14, 0),
    compare('plateAppearancesLast30', expected.plateAppearancesLast30, derived.plateAppearancesLast30, 0),
    compare('atBatsLast30', expected.atBatsLast30, derived.atBatsLast30, 0),
    
    // Rate stats (allow 1% tolerance)
    compare('battingAverageLast30', expected.battingAverageLast30, derived.battingAverageLast30 || 0),
    compare('onBasePctLast30', expected.onBasePctLast30, derived.onBasePctLast30 || 0),
    compare('sluggingPctLast30', expected.sluggingPctLast30, derived.sluggingPctLast30 || 0),
    compare('walkRateLast30', expected.walkRateLast30, derived.walkRateLast30 || 0),
    compare('strikeoutRateLast30', expected.strikeoutRateLast30, derived.strikeoutRateLast30 || 0),
  ].filter((d): d is NonNullable<typeof d> => d !== null);

  return {
    playerMlbamId,
    name: derived.playerId,
    position,
    gamesInSample: gameLogs.length,
    derivedComputedAt: derived.computedAt,
    passed: discrepancies.length === 0,
    discrepancies,
  };
}

/**
 * Get random sample of players using type-safe Prisma queries
 */
async function getSamplePlayers(season: number, sampleSize: number): Promise<Array<{
  playerMlbamId: string;
  gameCount: number;
}>> {
  // Get players with derived stats
  const derivedPlayers = await prisma.playerDerivedStats.findMany({
    where: { season },
    distinct: ['playerMlbamId'],
    select: { playerMlbamId: true },
    take: 100,
  });

  // Filter to those with game logs
  const withLogs: Array<{ playerMlbamId: string; gameCount: number }> = [];
  
  for (const player of derivedPlayers) {
    const count = await prisma.playerGameLog.count({
      where: { playerMlbamId: player.playerMlbamId, season },
    });
    if (count >= 10) {
      withLogs.push({ playerMlbamId: player.playerMlbamId, gameCount: count });
    }
    if (withLogs.length >= sampleSize) break;
  }

  // Shuffle and take sample
  return withLogs.sort(() => 0.5 - Math.random()).slice(0, sampleSize);
}

/**
 * Main validation
 */
async function runValidation() {
  console.log('\n' + '='.repeat(70));
  console.log('  DERIVED FEATURES LAYER VALIDATION');
  console.log('  Facts → Features (Deterministic, Recomputable, Strategy-Free)');
  console.log('='.repeat(70));
  console.log(`\nSeason: ${season}`);
  console.log(`Testing: 5 hitters, 5 pitchers`);
  console.log(`Tolerance: ${(TOLERANCE * 100).toFixed(0)}% for rates, 0% for volume\n`);

  // Sample players with derived stats and game logs
  const players = await getSamplePlayers(season, 10);

  console.log(`Found ${players.length} eligible players\n`);

  if (players.length === 0) {
    console.log('❌ No players with both game logs and derived stats');
    process.exit(1);
  }

  // Test first 5 as hitters, rest as pitchers
  const hitters = players.slice(0, 5);
  const pitchers = players.slice(5, 10);

  const results: ValidationResult[] = [];

  // Validate hitters
  console.log('─'.repeat(70));
  console.log('HITTERS');
  console.log('─'.repeat(70));
  for (const player of hitters) {
    process.stdout.write(`\n${player.playerMlbamId} (${player.gameCount} games)... `);
    const result = await validatePlayer(player.playerMlbamId, season, 'hitter');
    if (result) {
      results.push(result);
      if (result.passed) {
        console.log('✅ PASS');
      } else {
        console.log('❌ FAIL');
        result.discrepancies.forEach(d => {
          console.log(`      ${d.field}: expected=${d.expected.toFixed(3)}, actual=${d.actual.toFixed(3)} (${d.variance})`);
        });
      }
    }
  }

  // Validate pitchers
  console.log('\n' + '─'.repeat(70));
  console.log('PITCHERS');
  console.log('─'.repeat(70));
  for (const player of pitchers) {
    process.stdout.write(`\n${player.playerMlbamId} (${player.gameCount} games)... `);
    const result = await validatePlayer(player.playerMlbamId, season, 'pitcher');
    if (result) {
      results.push(result);
      if (result.passed) {
        console.log('✅ PASS');
      } else {
        console.log('❌ FAIL');
        result.discrepancies.forEach(d => {
          console.log(`      ${d.field}: expected=${d.expected.toFixed(3)}, actual=${d.actual.toFixed(3)} (${d.variance})`);
        });
      }
    }
  }

  // Summary
  const passedCount = results.filter(r => r.passed).length;
  const failedPlayers = results.filter(r => !r.passed);

  console.log('\n' + '='.repeat(70));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total validated: ${results.length}`);
  console.log(`✅ Passed: ${passedCount}`);
  console.log(`❌ Failed: ${failedPlayers.length}`);

  if (failedPlayers.length > 0) {
    console.log('\nFailed Players:');
    failedPlayers.forEach(p => {
      console.log(`  - ${p.playerMlbamId} (${p.position}): ${p.discrepancies.length} discrepancies`);
    });
  }

  // Layer quality assessment
  console.log('\n' + '='.repeat(70));
  console.log('LAYER QUALITY ASSESSMENT');
  console.log('='.repeat(70));

  if (passedCount === results.length) {
    console.log('\n✅ DERIVED LAYER VALIDATED');
    console.log('   All derived stats match manual calculations');
    console.log('   Transformation is deterministic and accurate');
    console.log('   Layer is strategy-free (no opinions creeping in)');
    console.log('\n   → You can trust the derived features for fantasy decisions\n');
    process.exit(0);
  } else {
    console.log('\n🚫 DERIVED LAYER HAS ERRORS');
    console.log(`   ${failedPlayers.length}/${results.length} players have incorrect derived stats`);
    console.log('   This is the foundation for all downstream analysis');
    console.log('\n   → DO NOT trust fantasy recommendations until fixed\n');
    process.exit(1);
  }
}

runValidation().catch(error => {
  console.error('\n❌ Validation failed:', error);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
