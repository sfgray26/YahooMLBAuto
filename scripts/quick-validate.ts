#!/usr/bin/env node
/**
 * Quick Basic Stats Validation
 * Compares derived stats against expected MLB values
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const PLAYERS = [
  // Hitters with well-known stats
  { mlbamId: '592450', name: 'Aaron Judge', expAvg: .331, expOps: 1.143 },
  { mlbamId: '677951', name: 'Bobby Witt Jr.', expAvg: .295, expOps: .848 },
  { mlbamId: '518692', name: 'Freddie Freeman', expAvg: .295, expOps: .865 },
  // Pitchers (corrected IDs)
  { mlbamId: '669203', name: 'Tarik Skubal', expK: .238, expBB: .098 },
  { mlbamId: '694973', name: 'Paul Skenes', expK: .255, expBB: .050 }, // 42/840 BF
];

async function quickValidate() {
  console.log('⚡ Quick Basic Stats Validation\n');
  console.log('Player                | Type    | Stat    | Expected | Derived  | Diff   | Status');
  console.log('-'.repeat(90));

  for (const p of PLAYERS) {
    const derived = await prisma.playerDerivedStats.findFirst({
      where: { playerMlbamId: p.mlbamId, season: 2025 },
    });

    if (!derived) {
      console.log(`${p.name.padEnd(20)} | MISSING IN DATABASE`);
      continue;
    }

    // Hitter checks
    if (p.expAvg) {
      const diff = Math.abs((derived.battingAverageLast30 || 0) - p.expAvg);
      const status = diff < 0.01 ? '✅' : diff < 0.02 ? '⚠️' : '❌';
      console.log(
        `${p.name.padEnd(20)} | Hitter  | AVG     | ${p.expAvg.toFixed(3).padEnd(8)} | ${(derived.battingAverageLast30 || 0).toFixed(3).padEnd(8)} | ${diff.toFixed(3).padEnd(6)} | ${status}`
      );
    }
    if (p.expOps) {
      const ops = (derived.onBasePctLast30 || 0) + (derived.sluggingPctLast30 || 0);
      const diff = Math.abs(ops - p.expOps);
      const status = diff < 0.02 ? '✅' : diff < 0.04 ? '⚠️' : '❌';
      console.log(
        `${''.padEnd(20)} |         | OPS     | ${p.expOps.toFixed(3).padEnd(8)} | ${ops.toFixed(3).padEnd(8)} | ${diff.toFixed(3).padEnd(6)} | ${status}`
      );
    }

    // Pitcher checks
    if (p.expK) {
      const diff = Math.abs((derived.strikeoutRateLast30 || 0) - p.expK);
      const status = diff < 0.05 ? '✅' : diff < 0.10 ? '⚠️' : '❌';
      console.log(
        `${p.name.padEnd(20)} | Pitcher | K%      | ${(p.expK * 100).toFixed(1).padEnd(7)}% | ${((derived.strikeoutRateLast30 || 0) * 100).toFixed(1).padEnd(7)}% | ${(diff * 100).toFixed(1).padEnd(5)}% | ${status}`
      );
    }
    if (p.expBB) {
      const diff = Math.abs((derived.walkRateLast30 || 0) - p.expBB);
      const status = diff < 0.03 ? '✅' : diff < 0.05 ? '⚠️' : '❌';
      console.log(
        `${''.padEnd(20)} |         | BB%     | ${(p.expBB * 100).toFixed(1).padEnd(7)}% | ${((derived.walkRateLast30 || 0) * 100).toFixed(1).padEnd(7)}% | ${(diff * 100).toFixed(1).padEnd(5)}% | ${status}`
      );
    }
  }

  console.log('\n' + '-'.repeat(90));
  console.log('Legend: ✅ = Good (<1-2% diff), ⚠️ = Borderline, ❌ = Needs fix');
  console.log('Note: Pitcher K%/BB% may be wrong due to AB vs BF calculation bug');
  
  await prisma.$disconnect();
}

quickValidate();
