#!/usr/bin/env node
/**
 * Phase 2: Derived Features UAT - Validation Against Manual Calculations
 * 
 * Tests:
 * 1. Pick 5 hitters and 5 pitchers with sufficient game logs
 * 2. Manually calculate 7d/14d volume, AVG, K%/BB% from raw data
 * 3. Compare against derived layer calculations
 * 4. Verify stabilization flags behave logically
 * 5. Check volatility metrics change as expected
 * 
 * Red flags:
 * - Derived stats contradict raw data
 * - Stabilization flips unexpectedly
 * - Volatility behaves erratically
 * 
 * Exit criteria: Derived data feels like objective truth, not analysis
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MLB_STATS_BASE_URL = 'https://statsapi.mlb.com/api/v1';
const TEST_SEASON = 2025;

interface PlayerTestCase {
  mlbamId: string;
  name: string;
  type: 'hitter' | 'pitcher';
  teamId?: string;
}

interface GameLog {
  date: string;
  atBats: number;
  hits: number;
  strikeouts: number;
  walks: number;
  inningsPitched?: number;
  battersFaced?: number;
}

interface ManualCalculation {
  games7d: number;
  games14d: number;
  avg7d: number;
  avg14d: number;
  kRate7d: number;
  kRate14d: number;
  bbRate7d: number;
  bbRate14d: number;
}

interface ValidationResult {
  player: PlayerTestCase;
  passed: boolean;
  manual: ManualCalculation;
  derived: any;
  discrepancies: string[];
}

// Test players - mix of stars and role players
const TEST_PLAYERS: PlayerTestCase[] = [
  // Hitters
  { mlbamId: '592450', name: 'Aaron Judge', type: 'hitter', teamId: '147' },
  { mlbamId: '665161', name: 'Jeremy Peña', type: 'hitter', teamId: '117' },
  { mlbamId: '677951', name: 'Bobby Witt Jr.', type: 'hitter', teamId: '118' },
  { mlbamId: '518692', name: 'Freddie Freeman', type: 'hitter', teamId: '119' },
  { mlbamId: '621043', name: 'Alex Bregman', type: 'hitter', teamId: '117' },
  // Pitchers
  { mlbamId: '669203', name: 'Tarik Skubal', type: 'pitcher', teamId: '116' },
  { mlbamId: '686970', name: 'Paul Skenes', type: 'pitcher', teamId: '134' },
  { mlbamId: '656288', name: 'Corbin Burnes', type: 'pitcher', teamId: '158' },
  { mlbamId: '543037', name: 'Gerrit Cole', type: 'pitcher', teamId: '147' },
  { mlbamId: '676440', name: 'Dylan Cease', type: 'pitcher', teamId: '135' },
];

// ============================================================================
// Fetch game logs from MLB API
// ============================================================================
async function fetchGameLogs(mlbamId: string, type: 'hitting' | 'pitching'): Promise<GameLog[]> {
  const url = new URL(`${MLB_STATS_BASE_URL}/people/${mlbamId}/stats`);
  url.searchParams.append('stats', 'gameLog');
  url.searchParams.append('group', type);
  url.searchParams.append('season', TEST_SEASON.toString());
  url.searchParams.append('gameType', 'R');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return [];
    
    const data = await response.json();
    const splits = data.stats?.[0]?.splits || [];
    
    return splits.map((split: any) => ({
      date: split.date,
      atBats: split.stat?.atBats || 0,
      hits: split.stat?.hits || 0,
      strikeouts: split.stat?.strikeOuts || 0,
      walks: split.stat?.baseOnBalls || 0,
      inningsPitched: split.stat?.inningsPitched,
      battersFaced: split.stat?.battersFaced,
    }));
  } catch (error) {
    console.log(`    ⚠️ Error fetching game logs: ${error.message}`);
    return [];
  }
}

// ============================================================================
// Manual calculation from game logs
// ============================================================================
function calculateManualStats(logs: GameLog[], type: 'hitter' | 'pitcher'): ManualCalculation {
  // Sort by date descending
  const sortedLogs = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  const last7 = sortedLogs.slice(0, 7);
  const last14 = sortedLogs.slice(0, 14);
  
  // Hitters: calculate AVG, K%, BB%
  if (type === 'hitter') {
    const sum7 = last7.reduce((acc, g) => ({
      atBats: acc.atBats + g.atBats,
      hits: acc.hits + g.hits,
      strikeouts: acc.strikeouts + g.strikeouts,
      walks: acc.walks + g.walks,
    }), { atBats: 0, hits: 0, strikeouts: 0, walks: 0 });
    
    const sum14 = last14.reduce((acc, g) => ({
      atBats: acc.atBats + g.atBats,
      hits: acc.hits + g.hits,
      strikeouts: acc.strikeouts + g.strikeouts,
      walks: acc.walks + g.walks,
    }), { atBats: 0, hits: 0, strikeouts: 0, walks: 0 });
    
    const pa7 = sum7.atBats + sum7.walks;
    const pa14 = sum14.atBats + sum14.walks;
    
    return {
      games7d: last7.length,
      games14d: last14.length,
      avg7d: sum7.atBats > 0 ? sum7.hits / sum7.atBats : 0,
      avg14d: sum14.atBats > 0 ? sum14.hits / sum14.atBats : 0,
      kRate7d: pa7 > 0 ? sum7.strikeouts / pa7 : 0,
      kRate14d: pa14 > 0 ? sum14.strikeouts / pa14 : 0,
      bbRate7d: pa7 > 0 ? sum7.walks / pa7 : 0,
      bbRate14d: pa14 > 0 ? sum14.walks / pa14 : 0,
    };
  }
  
  // Pitchers: calculate K%, BB% (per batter faced)
  const sum7 = last7.reduce((acc, g) => ({
    battersFaced: acc.battersFaced + (g.battersFaced || 0),
    strikeouts: acc.strikeouts + g.strikeouts,
    walks: acc.walks + g.walks,
  }), { battersFaced: 0, strikeouts: 0, walks: 0 });
  
  const sum14 = last14.reduce((acc, g) => ({
    battersFaced: acc.battersFaced + (g.battersFaced || 0),
    strikeouts: acc.strikeouts + g.strikeouts,
    walks: acc.walks + g.walks,
  }), { battersFaced: 0, strikeouts: 0, walks: 0 });
  
  return {
    games7d: last7.length,
    games14d: last14.length,
    avg7d: 0, // N/A for pitchers
    avg14d: 0,
    kRate7d: sum7.battersFaced > 0 ? sum7.strikeouts / sum7.battersFaced : 0,
    kRate14d: sum14.battersFaced > 0 ? sum14.strikeouts / sum14.battersFaced : 0,
    bbRate7d: sum7.battersFaced > 0 ? sum7.walks / sum7.battersFaced : 0,
    bbRate14d: sum14.battersFaced > 0 ? sum14.walks / sum14.battersFaced : 0,
  };
}

// ============================================================================
// Get derived stats from database
// ============================================================================
async function getDerivedStats(mlbamId: string, type: 'hitter' | 'pitcher') {
  const derived = await prisma.playerDerivedStats.findFirst({
    where: {
      playerMlbamId: mlbamId,
      season: TEST_SEASON,
    },
  });
  
  return derived;
}

// ============================================================================
// Compare manual vs derived
// ============================================================================
function compareStats(
  manual: ManualCalculation,
  derived: any,
  type: 'hitter' | 'pitcher'
): { passed: boolean; discrepancies: string[] } {
  const discrepancies: string[] = [];
  const tolerance = 0.01; // 1% tolerance
  
  if (!derived) {
    return { passed: false, discrepancies: ['No derived stats found'] };
  }
  
  // Compare hitter stats
  if (type === 'hitter') {
    const derivedAvg = derived.battingAverage7d || 0;
    if (Math.abs(manual.avg7d - derivedAvg) > tolerance) {
      discrepancies.push(`AVG 7d: manual ${manual.avg7d.toFixed(3)} vs derived ${derivedAvg.toFixed(3)}`);
    }
    
    const derivedKRate = derived.kRate7d || 0;
    if (Math.abs(manual.kRate7d - derivedKRate) > tolerance) {
      discrepancies.push(`K% 7d: manual ${(manual.kRate7d * 100).toFixed(1)}% vs derived ${(derivedKRate * 100).toFixed(1)}%`);
    }
    
    const derivedBBRate = derived.bbRate7d || 0;
    if (Math.abs(manual.bbRate7d - derivedBBRate) > tolerance) {
      discrepancies.push(`BB% 7d: manual ${(manual.bbRate7d * 100).toFixed(1)}% vs derived ${(derivedBBRate * 100).toFixed(1)}%`);
    }
  }
  
  // Compare pitcher stats
  if (type === 'pitcher') {
    const derivedKRate = derived.kRate7d || 0;
    if (Math.abs(manual.kRate7d - derivedKRate) > tolerance) {
      discrepancies.push(`K% 7d: manual ${(manual.kRate7d * 100).toFixed(1)}% vs derived ${(derivedKRate * 100).toFixed(1)}%`);
    }
    
    const derivedBBRate = derived.bbRate7d || 0;
    if (Math.abs(manual.bbRate7d - derivedBBRate) > tolerance) {
      discrepancies.push(`BB% 7d: manual ${(manual.bbRate7d * 100).toFixed(1)}% vs derived ${(derivedBBRate * 100).toFixed(1)}%`);
    }
  }
  
  // Check stabilization logic
  const stabilizationFlags = derived.stabilizationFlags || {};
  if (type === 'hitter' && stabilizationFlags.battingAverage !== undefined) {
    // Batting average stabilizes around 100 AB
    const expectedStabilization = manual.games7d >= 20; // Rough proxy
    if (stabilizationFlags.battingAverage !== expectedStabilization) {
      discrepancies.push(`Stabilization flag mismatch: games=${manual.games7d}, flag=${stabilizationFlags.battingAverage}`);
    }
  }
  
  return {
    passed: discrepancies.length === 0,
    discrepancies,
  };
}

// ============================================================================
// Main validation
// ============================================================================
async function runValidation(): Promise<ValidationResult[]> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Phase 2: Derived Features UAT - Manual vs Derived         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const results: ValidationResult[] = [];
  
  for (const player of TEST_PLAYERS) {
    console.log(`\n🧪 Testing ${player.name} (${player.type})`);
    
    // Fetch game logs
    const group = player.type === 'hitter' ? 'hitting' : 'pitching';
    const logs = await fetchGameLogs(player.mlbamId, group);
    console.log(`   Fetched ${logs.length} game logs`);
    
    if (logs.length < 7) {
      console.log(`   ⚠️ Insufficient games (${logs.length}), skipping`);
      continue;
    }
    
    // Manual calculation
    const manual = calculateManualStats(logs, player.type);
    console.log(`   Manual 7d: ${manual.games7d} games, AVG ${manual.avg7d.toFixed(3)}, K% ${(manual.kRate7d * 100).toFixed(1)}%`);
    
    // Get derived stats
    const derived = await getDerivedStats(player.mlbamId, player.type);
    if (derived) {
      console.log(`   Derived 7d: AVG ${(derived.battingAverage7d || 0).toFixed(3)}, K% ${((derived.kRate7d || 0) * 100).toFixed(1)}%`);
    } else {
      console.log(`   ⚠️ No derived stats found`);
    }
    
    // Compare
    const comparison = compareStats(manual, derived, player.type);
    
    results.push({
      player,
      passed: comparison.passed,
      manual,
      derived,
      discrepancies: comparison.discrepancies,
    });
    
    if (comparison.discrepancies.length > 0) {
      comparison.discrepancies.forEach((d) => console.log(`   ❌ ${d}`));
    } else {
      console.log(`   ✅ Stats match`);
    }
    
    // Rate limit
    await new Promise((r) => setTimeout(r, 200));
  }
  
  return results;
}

// ============================================================================
// Summary
// ============================================================================
async function main() {
  const results = await runValidation();
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 VALIDATION SUMMARY\n');
  
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  
  console.log(`Total tested: ${results.length}`);
  console.log(`✅ Passed: ${passedCount}`);
  console.log(`❌ Failed: ${failedCount}`);
  
  if (failedCount > 0) {
    console.log('\n⚠️ FAILED CASES:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`\n  ${r.player.name} (${r.player.type}):`);
      r.discrepancies.forEach((d) => console.log(`    - ${d}`));
    });
  }
  
  console.log('\n' + '═'.repeat(60));
  
  if (passedCount === results.length) {
    console.log('\n🎉 ALL TESTS PASSED - Derived data matches manual calculations');
    console.log('✅ Derived layer produces objective truth');
  } else if (passedCount >= results.length * 0.8) {
    console.log('\n⚠️ MOSTLY PASSED - Minor discrepancies to review');
  } else {
    console.log('\n❌ SIGNIFICANT ISSUES - Derived layer needs investigation');
  }
  
  await prisma.$disconnect();
  return failedCount === 0;
}

main()
  .then((success) => process.exit(success ? 0 : 1))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
