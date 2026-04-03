import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';

async function check() {
  // Check player 621439 in detail
  const playerMlbamId = '621439';
  
  // Get all game logs
  const gameLogs = await prisma.playerGameLog.findMany({
    where: { playerMlbamId, season: 2025 },
    orderBy: { gameDate: 'desc' },
  });
  
  console.log(`Player ${playerMlbamId} has ${gameLogs.length} game logs`);
  console.log('\nRecent 15 games:');
  gameLogs.slice(0, 15).forEach((g, i) => {
    console.log(`  ${i+1}. ${g.gameDate.toISOString().split('T')[0]} - ${g.gamesPlayed} GP, ${g.atBats} AB, ${g.hits} H`);
  });
  
  // Calculate using latest game date
  const latestGame = gameLogs[0];
  console.log(`\nLatest game date: ${latestGame.gameDate.toISOString()}`);
  
  // Calculate cutoff dates
  const d7 = new Date(latestGame.gameDate); d7.setDate(d7.getDate() - 7);
  const d14 = new Date(latestGame.gameDate); d14.setDate(d14.getDate() - 14);
  const d30 = new Date(latestGame.gameDate); d30.setDate(d30.getDate() - 30);
  
  console.log('\nCutoff dates:');
  console.log(`  7-day:  >= ${d7.toISOString()}`);
  console.log(`  14-day: >= ${d14.toISOString()}`);
  console.log(`  30-day: >= ${d30.toISOString()}`);
  
  // Count games in each window
  const g7 = gameLogs.filter(g => g.gameDate >= d7);
  const g14 = gameLogs.filter(g => g.gameDate >= d14);
  const g30 = gameLogs.filter(g => g.gameDate >= d30);
  
  console.log('\nGame counts:');
  console.log(`  Last 7 days:  ${g7.length} games (expected from derived: 6)`);
  console.log(`  Last 14 days: ${g14.length} games (expected from derived: 12)`);
  console.log(`  Last 30 days: ${g30.length} games (expected from derived: 25)`);
  
  // Get derived stats
  const derived = await prisma.playerDerivedStats.findFirst({
    where: { playerMlbamId, season: 2025 },
  });
  
  console.log('\nStored derived stats:');
  console.log(`  gamesLast7:  ${derived?.gamesLast7}`);
  console.log(`  gamesLast14: ${derived?.gamesLast14}`);
  console.log(`  gamesLast30: ${derived?.gamesLast30}`);
  console.log(`  plateAppearancesLast7: ${derived?.plateAppearancesLast7}`);
  console.log(`  plateAppearancesLast30: ${derived?.plateAppearancesLast30}`);
  console.log(`  atBatsLast30: ${derived?.atBatsLast30}`);
  
  // Now let's see what happens with date-only comparison
  console.log('\n--- Date-only comparison ---');
  const normalizeDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const latestNormalized = normalizeDate(latestGame.gameDate);
  console.log(`Latest (normalized): ${latestNormalized.toISOString()}`);
  
  const d7n = new Date(latestNormalized); d7n.setDate(d7n.getDate() - 7);
  const d14n = new Date(latestNormalized); d14n.setDate(d14n.getDate() - 14);
  const d30n = new Date(latestNormalized); d30n.setDate(d30n.getDate() - 30);
  
  console.log(`Cutoff 7-day (normalized):  >= ${d7n.toISOString()}`);
  
  const g7n = gameLogs.filter(g => normalizeDate(g.gameDate) >= d7n);
  console.log(`Games >= normalized cutoff: ${g7n.length}`);
  
  // Check specific games around the cutoff
  console.log('\nGames around Sep 20 cutoff:');
  gameLogs.filter(g => {
    const date = g.gameDate.toISOString().split('T')[0];
    return date >= '2025-09-19' && date <= '2025-09-22';
  }).forEach(g => {
    console.log(`  ${g.gameDate.toISOString()} - normalized: ${normalizeDate(g.gameDate).toISOString()}`);
  });
}

check().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
