import 'dotenv/config';
import { prisma } from '@cbb/infrastructure';
import { scoreSinglePlayer } from '../apps/worker/src/scoring/orchestrator';

const season = 2025;

async function debug() {
  console.log('Debugging Star/Bench Separation Issue\n');
  
  // Find bench bats (low PA)
  const benchBats = await prisma.playerDerivedStats.findMany({
    where: { 
      season, 
      plateAppearancesLast30: { lte: 50 }
    },
    take: 10,
  });
  
  console.log('Bench Bats (<=50 PA) with their scores:\n');
  for (const player of benchBats) {
    const score = await scoreSinglePlayer(player.playerMlbamId, season);
    if (score) {
      const isHighScore = score.overallValue >= 55;
      console.log(`${isHighScore ? '⚠️' : '✓'} ${player.playerMlbamId}: Overall=${score.overallValue} (${player.gamesLast30}G, ${player.plateAppearancesLast30}PA)`);
      console.log(`   OPP=${score.components.opportunity} | HIT=${score.components.hitting} | POW=${score.components.power}`);
      console.log(`   Stats: ${player.battingAverageLast30?.toFixed(3)} AVG, ${player.opsLast30?.toFixed(3)} OPS`);
      console.log(`   Confidence: ${(score.confidence * 100).toFixed(0)}%`);
      console.log();
    }
  }
  
  // Find full-time players
  const fullTime = await prisma.playerDerivedStats.findMany({
    where: { 
      season, 
      gamesLast30: { gte: 25 },
      plateAppearancesLast30: { gte: 100 }
    },
    take: 5,
  });
  
  console.log('\nFull-Time Players (25+ G, 100+ PA):\n');
  for (const player of fullTime) {
    const score = await scoreSinglePlayer(player.playerMlbamId, season);
    if (score) {
      console.log(`${player.playerMlbamId}: Overall=${score.overallValue} (${player.gamesLast30}G, ${player.plateAppearancesLast30}PA)`);
      console.log(`   OPP=${score.components.opportunity} | HIT=${score.components.hitting} | POW=${score.components.power}`);
      console.log(`   Stats: ${player.battingAverageLast30?.toFixed(3)} AVG, ${player.opsLast30?.toFixed(3)} OPS`);
      console.log();
    }
  }
}

debug().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
