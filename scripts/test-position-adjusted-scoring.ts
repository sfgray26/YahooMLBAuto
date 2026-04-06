/**
 * Position-Adjusted Scoring Impact Test
 * 
 * Demonstrates how position scarcity changes player valuations.
 * Same stats, different positions = different scores.
 */

import { scorePlayer } from '../apps/worker/src/scoring/compute';
import type { DerivedFeatures } from '../apps/worker/src/scoring/compute';

// Base player with identical stats - we'll change only the position
const basePlayer: DerivedFeatures = {
  playerId: 'test-player',
  playerMlbamId: 'TEST001',
  season: 2025,
  computedAt: new Date(),
  volume: {
    gamesLast7: 5, gamesLast14: 12, gamesLast30: 26,
    plateAppearancesLast7: 22, plateAppearancesLast14: 52, plateAppearancesLast30: 110,
    atBatsLast30: 98,
  },
  rates: {
    // Decent but not elite: 0.275 AVG, 0.800 OPS
    battingAverageLast30: 0.275,
    onBasePctLast30: 0.350,
    sluggingPctLast30: 0.450,
    opsLast30: 0.800,
    isoLast30: 0.175,
    walkRateLast30: 0.095,
    strikeoutRateLast30: 0.200,
    babipLast30: 0.300,
  },
  stabilization: {
    battingAverageReliable: true, obpReliable: true, slgReliable: true, opsReliable: true,
    gamesToReliable: 0,
  },
  volatility: {
    hitConsistencyScore: 60, productionVolatility: 0.9,
    zeroHitGamesLast14: 3, multiHitGamesLast14: 5,
  },
  opportunity: {
    gamesStartedLast14: 13, lineupSpot: 6, platoonRisk: 'low', playingTimeTrend: 'stable',
  },
  replacement: { 
    positionEligibility: ['OF'], // Will override per test
    waiverWireValue: null, 
    rosteredPercent: 75 
  },
};

function testPosition(player: DerivedFeatures, position: string, label: string) {
  const result = scorePlayer({
    ...player,
    replacement: { ...player.replacement, positionEligibility: [position] }
  });
  
  return {
    position: label,
    overall: result.overallValue,
    hitting: result.components.hitting,
    power: result.components.power,
    explanation: result.explanation.summary,
  };
}

function runTest() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     POSITION-ADJUSTED SCORING IMPACT TEST                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('Player Profile:');
  console.log('  AVG: 0.275 | OPS: 0.800 | ISO: 0.175');
  console.log('  PA: 110 (reliable sample)');
  console.log('  Playing time: Full-time regular\n');

  console.log('Testing same player at different positions...\n');

  // Test at each position
  const positions = [
    { pos: 'C', label: 'Catcher' },
    { pos: 'SS', label: 'Shortstop' },
    { pos: '2B', label: 'Second Base' },
    { pos: '3B', label: 'Third Base' },
    { pos: '1B', label: 'First Base' },
    { pos: 'OF', label: 'Outfield' },
    { pos: 'DH', label: 'Designated Hitter' },
  ];

  const results = positions.map(p => testPosition(basePlayer, p.pos, p.label));

  console.log('┌─────────────────┬──────────┬─────────┬─────────┬────────────────────────────────────────┐');
  console.log('│ Position        │ Overall  │ Hitting │ Power   │ Explanation                            │');
  console.log('├─────────────────┼──────────┼─────────┼─────────┼────────────────────────────────────────┤');
  
  results.forEach(r => {
    const posStr = r.position.padEnd(15);
    const overallStr = String(r.overall).padStart(3).padEnd(8);
    const hitStr = String(r.hitting).padStart(3).padEnd(7);
    const powStr = String(r.power).padStart(3).padEnd(7);
    const explStr = r.explanation.slice(0, 38).padEnd(38);
    console.log(`│ ${posStr} │ ${overallStr} │ ${hitStr} │ ${powStr} │ ${explStr} │`);
  });
  
  console.log('└─────────────────┴──────────┴─────────┴─────────┴────────────────────────────────────────┘');

  // Calculate scarcity premium
  const catcher = results.find(r => r.position === 'Catcher')!;
  const firstBase = results.find(r => r.position === 'First Base')!;
  const dh = results.find(r => r.position === 'Designated Hitter')!;
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    SCARCITY ANALYSIS                           ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Same stats (.275 AVG, .800 OPS):                              ║`);
  console.log(`║                                                                ║`);
  console.log(`║  At Catcher:     ${String(catcher.overall).padStart(3)}/100  (+${String(catcher.overall - firstBase.overall).padStart(2)} vs 1B)                    ║`);
  console.log(`║  At 1B:          ${String(firstBase.overall).padStart(3)}/100  (baseline)                       ║`);
  console.log(`║  At DH:          ${String(dh.overall).padStart(3)}/100  (${String(dh.overall - firstBase.overall).padStart(2)} vs 1B)                    ║`);
  console.log(`║                                                                ║`);
  console.log(`║  Scarcity positions (C, SS, 2B) get +5-8 point premium         ║`);
  console.log(`║  DH gets -2 point penalty (only bats, high expectations)       ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  // Show waiver implication
  console.log('\nWAIVER DECISION IMPACT:');
  console.log('  Scenario: Need to pick up a hitter, both available:');
  console.log('    - Catcher A:  .265 AVG, .775 OPS (slightly worse stats)');
  console.log('    - 1B B:       .275 AVG, .800 OPS (better stats)');
  console.log('');
  console.log('  Old system: Pick 1B B (better raw stats)');
  console.log('  New system: Catcher A may score higher due to position scarcity');
  console.log('  Result: Smarter roster construction');
}

runTest();
