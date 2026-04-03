import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

async function check() {
  const playerMlbamId = '621439';
  const season = 2025;
  
  // Get derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season },
  });
  
  console.log('Stored derived stats:');
  console.log(JSON.stringify({
    gamesLast7: derived?.gamesLast7,
    gamesLast14: derived?.gamesLast14,
    gamesLast30: derived?.gamesLast30,
    plateAppearancesLast7: derived?.plateAppearancesLast7,
    plateAppearancesLast14: derived?.plateAppearancesLast14,
    plateAppearancesLast30: derived?.plateAppearancesLast30,
    atBatsLast30: derived?.atBatsLast30,
    computedAt: derived?.computedAt,
  }, null, 2));
  
  // Get latest game
  const latestGame = await prisma.playerGameLog.findFirst({
    where: { playerMlbamId, season },
    orderBy: { gameDate: 'desc' },
  });
  console.log('\nLatest game:', latestGame?.gameDate);
  
  // Calculate cutoffs the same way as derived layer
  const cutoff7 = new Date(latestGame!.gameDate);
  cutoff7.setDate(cutoff7.getDate() - 7);
  
  console.log('\nDerived layer cutoff calculation:');
  console.log(`  Latest: ${latestGame?.gameDate.toISOString()}`);
  console.log(`  Cutoff: ${cutoff7.toISOString()}`);
  
  // Query games the same way as derived layer
  const games7 = await prisma.playerGameLog.findMany({
    where: {
      playerMlbamId,
      season,
      gameDate: { gte: cutoff7, lte: latestGame!.gameDate }
    },
    orderBy: { gameDate: 'desc' },
  });
  
  console.log(`\nGames in last 7 days (gte cutoff): ${games7.length}`);
  games7.forEach((g, i) => {
    console.log(`  ${i+1}. ${g.gameDate.toISOString()} - ${g.gamesPlayed} GP`);
  });
  
  // Now manually calculate what the derived layer should produce
  const manualGames7 = games7.reduce((acc, g) => acc + g.gamesPlayed, 0);
  const manualPA7 = games7.reduce((acc, g) => acc + g.plateAppearances, 0);
  
  console.log('\nManual calculation from same query:');
  console.log(`  gamesLast7: ${manualGames7}`);
  console.log(`  plateAppearancesLast7: ${manualPA7}`);
  
  console.log('\nDiscrepancy:');
  console.log(`  Stored gamesLast7: ${derived?.gamesLast7}, Calculated: ${manualGames7}`);
  console.log(`  Stored PA7: ${derived?.plateAppearancesLast7}, Calculated: ${manualPA7}`);
  
  // Check if there are multiple derived records
  const allDerived = await prisma.playerDerivedStats.findMany({
    where: { playerMlbamId, season },
    orderBy: { computedAt: 'desc' },
  });
  console.log(`\nTotal derived records: ${allDerived.length}`);
  allDerived.forEach((d, i) => {
    console.log(`  ${i+1}. computedAt=${d.computedAt}, games7=${d.gamesLast7}, PA7=${d.plateAppearancesLast7}`);
  });
}

check().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
