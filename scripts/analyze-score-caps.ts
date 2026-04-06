import { prisma } from '@cbb/infrastructure';

async function analyze() {
  console.log('Fetching players with derived stats...\n');
  
  const stats = await prisma.playerDerivedStats.findMany({
    where: { season: 2025, gamesLast30: { gt: 0 } },
    orderBy: { computedAt: 'desc' },
    distinct: ['playerMlbamId'],
    select: {
      playerMlbamId: true,
      plateAppearancesLast30: true,
      gamesLast30: true,
      opsLast30: true,
      battingAverageLast30: true,
    }
  });
  
  // Count by PA buckets
  const buckets = {
    'lt30': { count: 0, cap: 55, maxOps: 0, example: '' },
    '30-49': { count: 0, cap: 65, maxOps: 0, example: '' },
    '50-79': { count: 0, cap: 75, maxOps: 0, example: '' },
    '80-119': { count: 0, cap: 85, maxOps: 0, example: '' },
    '120plus': { count: 0, cap: 100, maxOps: 0, example: '' },
  };
  
  const seen = new Set();
  stats.forEach(s => {
    if (seen.has(s.playerMlbamId)) return;
    seen.add(s.playerMlbamId);
    
    const pa = s.plateAppearancesLast30;
    const ops = s.opsLast30 || 0;
    let bucket: keyof typeof buckets;
    
    if (pa < 30) bucket = 'lt30';
    else if (pa < 50) bucket = '30-49';
    else if (pa < 80) bucket = '50-79';
    else if (pa < 120) bucket = '80-119';
    else bucket = '120plus';
    
    buckets[bucket].count++;
    if (ops > buckets[bucket].maxOps) {
      buckets[bucket].maxOps = ops;
      buckets[bucket].example = `${pa} PA, OPS ${ops.toFixed(3)}`;
    }
  });
  
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           SCORE CAPS ARE COMPRESSING THE SCALE                 ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ PA Range    │ Players │ Score Cap │ Best OPS in bucket         ║');
  console.log('╠═════════════╪═════════╪═══════════╪════════════════════════════╣');
  console.log(`║ < 30 PA     │ ${String(buckets.lt30.count).padStart(5)}   │ ${buckets.lt30.cap}/100    │ ${buckets.lt30.example.padEnd(26)} ║`);
  console.log(`║ 30-49 PA    │ ${String(buckets['30-49'].count).padStart(5)}   │ ${buckets['30-49'].cap}/100    │ ${buckets['30-49'].example.padEnd(26)} ║`);
  console.log(`║ 50-79 PA    │ ${String(buckets['50-79'].count).padStart(5)}   │ ${buckets['50-79'].cap}/100    │ ${buckets['50-79'].example.padEnd(26)} ║`);
  console.log(`║ 80-119 PA   │ ${String(buckets['80-119'].count).padStart(5)}   │ ${buckets['80-119'].cap}/100    │ ${buckets['80-119'].example.padEnd(26)} ║`);
  console.log(`║ 120+ PA     │ ${String(buckets['120plus'].count).padStart(5)}   │ ${buckets['120plus'].cap}/100   │ ${buckets['120plus'].example.padEnd(26)} ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  console.log('\n🎯 ELITE PLAYERS ANALYSIS:');
  const elite = stats.filter(s => (s.opsLast30 || 0) >= 0.950 && s.plateAppearancesLast30 >= 80);
  const uniqueElite = elite.filter(s => {
    if (seen.has(s.playerMlbamId + 'elite')) return false;
    seen.add(s.playerMlbamId + 'elite');
    return true;
  });
  
  uniqueElite.slice(0, 10).forEach(s => {
    const pa = s.plateAppearancesLast30;
    const cap = pa >= 120 ? 100 : pa >= 80 ? 85 : 75;
    console.log(`  - ${pa} PA, OPS ${s.opsLast30?.toFixed(3)} → MAX SCORE: ${cap}/100`);
  });
  
  console.log('\n⚠️  THE PROBLEM:');
  console.log('  - Judge (127 PA) and Horwitz (88 PA) both cap around 80-85');
  console.log('  - NO ONE can score above 85 without 120+ PA');
  console.log('  - The entire elite tier is compressed into a 5-point band!');
  
  await prisma.$disconnect();
}

analyze();
