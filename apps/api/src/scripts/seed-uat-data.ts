/**
 * Seed real MLB players for UAT
 * Populates database with actual player names and realistic 2025 stats
 */

import { prisma } from '@cbb/infrastructure';

// Your actual roster with real MLBAM IDs
const YOUR_ROSTER = [
  // C
  { mlbamId: '669128', name: 'Yainer Diaz', team: 'HOU', position: 'C', games: 142, avg: '.278', ops: '.825' },
  // 1B
  { mlbamId: '686469', name: 'Vinnie Pasquantino', team: 'KC', position: '1B', games: 135, avg: '.265', ops: '.810' },
  // 2B
  { mlbamId: '543760', name: 'Marcus Semien', team: 'TEX', position: '2B', games: 158, avg: '.258', ops: '.780' },
  // 3B
  { mlbamId: '656305', name: 'Matt Chapman', team: 'SF', position: '3B', games: 148, avg: '.245', ops: '.790' },
  // SS
  { mlbamId: '672666', name: 'Geraldo Perdomo', team: 'ARI', position: 'SS', games: 132, avg: '.262', ops: '.755' },
  // OF
  { mlbamId: '691023', name: 'Jordan Walker', team: 'STL', position: 'LF', games: 118, avg: '.251', ops: '.745' },
  { mlbamId: '621439', name: 'Byron Buxton', team: 'MIN', position: 'CF', games: 98, avg: '.268', ops: '.820' },
  { mlbamId: '665742', name: 'Juan Soto', team: 'NYM', position: 'RF', games: 155, avg: '.285', ops: '.915' },
  // UTIL
  { mlbamId: '650333', name: 'Luis Arraez', team: 'SD', position: '1B', games: 152, avg: '.310', ops: '.780' },
  // Bench
  { mlbamId: '624413', name: 'Pete Alonso', team: 'NYM', position: '1B', games: 148, avg: '.245', ops: '.835' },
  { mlbamId: '621043', name: 'Brandon Nimmo', team: 'NYM', position: 'LF', games: 145, avg: '.270', ops: '.820' },
  { mlbamId: '691738', name: 'Pete Crow-Armstrong', team: 'CHC', position: 'CF', games: 112, avg: '.248', ops: '.720' },
  { mlbamId: '680694', name: 'Steven Kwan', team: 'CLE', position: 'LF', games: 150, avg: '.285', ops: '.775' },
  // IL
  { mlbamId: '676059', name: 'Jordan Westburg', team: 'BAL', position: '2B', games: 45, avg: '.255', ops: '.740' },
  { mlbamId: '673548', name: 'Seiya Suzuki', team: 'CHC', position: 'RF', games: 38, avg: '.275', ops: '.805' },
  // Pitchers
  { mlbamId: '676979', name: 'Garrett Crochet', team: 'BOS', position: 'SP', games: 28, era: '3.45', whip: '1.18' },
  { mlbamId: '650911', name: 'Cristopher Sánchez', team: 'PHI', position: 'SP', games: 26, era: '3.82', whip: '1.25' },
  { mlbamId: '621242', name: 'Edwin Díaz', team: 'NYM', position: 'RP', games: 58, era: '2.95', whip: '1.08' },
  { mlbamId: '605447', name: 'Jordan Romano', team: 'TOR', position: 'RP', games: 52, era: '3.25', whip: '1.15' },
  { mlbamId: '682126', name: 'Eury Pérez', team: 'MIA', position: 'SP', games: 18, era: '4.10', whip: '1.30' },
  { mlbamId: '669062', name: 'Gavin Williams', team: 'CLE', position: 'SP', games: 22, era: '3.65', whip: '1.22' },
  { mlbamId: '684858', name: 'Shota Imanaga', team: 'CHC', position: 'SP', games: 24, era: '3.25', whip: '1.15' },
  // IL Pitchers
  { mlbamId: '542881', name: 'Jason Adam', team: 'SD', position: 'RP', games: 12, era: '3.50', whip: '1.20' },
  { mlbamId: '605483', name: 'Blake Snell', team: 'LAD', position: 'SP', games: 8, era: '4.20', whip: '1.35' },
];

// Additional waiver wire players for testing
const WAIVER_WIRE = [
  { mlbamId: '694817', name: 'Gunnar Henderson', team: 'BAL', position: 'SS', games: 156, avg: '.280', ops: '.890' },
  { mlbamId: '682985', name: 'Corbin Carroll', team: 'ARI', position: 'LF', games: 162, avg: '.265', ops: '.825' },
  { mlbamId: '660670', name: 'Bobby Witt Jr.', team: 'KC', position: 'SS', games: 160, avg: '.295', ops: '.920' },
  { mlbamId: '677594', name: 'Julio Rodriguez', team: 'SEA', position: 'CF', games: 150, avg: '.275', ops: '.865' },
  { mlbamId: '683011', name: 'Spencer Torkelson', team: 'DET', position: '1B', games: 140, avg: '.245', ops: '.790' },
];

async function seedPlayers() {
  console.log('[SEED] Starting player seed...');
  
  // Clear existing data
  console.log('[SEED] Clearing existing data...');
  await prisma.playerDerivedStats.deleteMany({});
  await prisma.playerDailyStats.deleteMany({});
  await prisma.rawIngestionLog.deleteMany({});
  
  // Seed your roster
  console.log('[SEED] Seeding your roster...');
  for (const player of YOUR_ROSTER) {
    const playerId = `mlbam:${player.mlbamId}`;
    
    // Create daily stats
    await prisma.playerDailyStats.create({
      data: {
        playerId,
        playerMlbamId: player.mlbamId,
        statDate: new Date('2025-09-30'), // End of season
        season: 2025,
        teamId: player.team,
        teamMlbamId: player.team,
        gamesPlayed: player.games,
        atBats: Math.floor(player.games * 3.2),
        runs: Math.floor(player.games * 0.5),
        hits: Math.floor(player.games * 0.85),
        doubles: Math.floor(player.games * 0.18),
        triples: Math.floor(player.games * 0.02),
        homeRuns: Math.floor(player.games * 0.12),
        rbi: Math.floor(player.games * 0.55),
        stolenBases: Math.floor(player.games * 0.08),
        caughtStealing: Math.floor(player.games * 0.02),
        walks: Math.floor(player.games * 0.35),
        strikeouts: Math.floor(player.games * 0.85),
        battingAvg: player.avg || '.250',
        onBasePct: player.ops ? String(parseFloat(player.ops) - 0.100).substring(0, 4) : '.320',
        sluggingPct: player.ops ? String(parseFloat(player.ops) - 0.070).substring(0, 4) : '.420',
        ops: player.ops || '.740',
        rawDataSource: 'uat_seed',
      },
    });
    
    // Create derived stats
    const avg = parseFloat(player.avg || '0.250');
    const ops = parseFloat(player.ops || '0.740');
    
    await prisma.playerDerivedStats.create({
      data: {
        playerId,
        playerMlbamId: player.mlbamId,
        season: 2025,
        gamesLast7: 6,
        gamesLast14: 12,
        gamesLast30: 25,
        plateAppearancesLast7: 28,
        plateAppearancesLast14: 52,
        plateAppearancesLast30: 105,
        atBatsLast30: 95,
        battingAverageLast30: avg,
        onBasePctLast30: ops - 0.100,
        sluggingPctLast30: ops - 0.070,
        opsLast30: ops,
        isoLast30: (ops - 0.070) - avg,
        walkRateLast30: 0.09,
        strikeoutRateLast30: 0.21,
        babipLast30: 0.295,
        battingAverageReliable: player.games >= 100,
        obpReliable: player.games >= 100,
        slgReliable: player.games >= 100,
        opsReliable: player.games >= 100,
        gamesToReliable: Math.max(0, 40 - player.games),
        hitConsistencyScore: 75,
        productionVolatility: 0.15,
        zeroHitGamesLast14: 3,
        multiHitGamesLast14: 4,
        gamesStartedLast14: 12,
        lineupSpot: 5,
        platoonRisk: 'low',
        playingTimeTrend: 'stable',
        positionEligibility: [player.position],
        waiverWireValue: 50 + (ops - 0.700) * 100,
        rosteredPercent: 85,
        computedAt: new Date(),
      },
    });
  }
  
  // Seed waiver wire players
  console.log('[SEED] Seeding waiver wire players...');
  for (const player of WAIVER_WIRE) {
    // Similar seeding logic...
    const playerId = `mlbam:${player.mlbamId}`;
    
    await prisma.playerDailyStats.create({
      data: {
        playerId,
        playerMlbamId: player.mlbamId,
        statDate: new Date('2025-09-30'),
        season: 2025,
        teamId: player.team,
        teamMlbamId: player.team,
        gamesPlayed: player.games,
        atBats: Math.floor(player.games * 3.3),
        runs: Math.floor(player.games * 0.6),
        hits: Math.floor(player.games * 0.92),
        homeRuns: Math.floor(player.games * 0.18),
        rbi: Math.floor(player.games * 0.62),
        battingAvg: player.avg,
        ops: player.ops,
        rawDataSource: 'uat_seed',
      },
    });
    
    await prisma.playerDerivedStats.create({
      data: {
        playerId,
        playerMlbamId: player.mlbamId,
        season: 2025,
        gamesLast7: 6,
        gamesLast14: 13,
        gamesLast30: 26,
        plateAppearancesLast30: 110,
        atBatsLast30: 98,
        battingAverageLast30: parseFloat(player.avg),
        opsLast30: parseFloat(player.ops),
        gamesStartedLast14: 13,
        positionEligibility: [player.position],
        waiverWireValue: 60 + (parseFloat(player.ops) - 0.800) * 150,
        rosteredPercent: 92,
        computedAt: new Date(),
      },
    });
  }
  
  console.log('[SEED] Complete!');
  console.log(`  - Roster players: ${YOUR_ROSTER.length}`);
  console.log(`  - Waiver players: ${WAIVER_WIRE.length}`);
}

seedPlayers().catch(console.error);
