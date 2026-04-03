/**
 * Waiver Test Route with Hardcoded Roster (using real DB player IDs)
 * For UAT testing with specific roster
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { prisma, addDecisionRequest } from '@cbb/infrastructure';
import type { WaiverRecommendationRequest, RosterSlot } from '@cbb/core';

// Hardcoded roster using REAL player IDs from database
const HARDCODED_ROSTER: RosterSlot[] = [
  // Active Hitters - using top scored players from DB
  { player: { id: uuidv4(), mlbamId: '686555', name: 'Player 686555', team: 'NYY', position: ['C'] }, position: 'C', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '655316', name: 'Player 655316', team: 'LAD', position: ['1B'] }, position: '1B', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '656555', name: 'Player 656555', team: 'TOR', position: ['2B'] }, position: '2B', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '682842', name: 'Player 682842', team: 'NYM', position: ['3B'] }, position: '3B', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '682990', name: 'Player 682990', team: 'ATL', position: ['SS'] }, position: 'SS', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '694477', name: 'Player 694477', team: 'CHC', position: ['LF'] }, position: 'LF', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '656730', name: 'Player 656730', team: 'HOU', position: ['CF'] }, position: 'CF', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '683232', name: 'Player 683232', team: 'BOS', position: ['RF'] }, position: 'RF', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '657649', name: 'Player 657649', team: 'SF', position: ['1B', 'OF'] }, position: 'UTIL', isLocked: false },
  
  // Bench Hitters
  { player: { id: uuidv4(), mlbamId: '642239', name: 'Player 642239', team: 'CLE', position: ['1B'] }, position: 'BN', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '500779', name: 'Player 500779', team: 'TEX', position: ['OF'] }, position: 'BN', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '678011', name: 'Player 678011', team: 'SEA', position: ['OF'] }, position: 'BN', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '663368', name: 'Player 663368', team: 'MIL', position: ['2B'] }, position: 'BN', isLocked: false },
  
  // IL Hitters
  { player: { id: uuidv4(), mlbamId: '668964', name: 'Player 668964', team: 'SD', position: ['3B'] }, position: 'IL', isLocked: true },
  { player: { id: uuidv4(), mlbamId: '694819', name: 'Player 694819', team: 'PHI', position: ['SS'] }, position: 'IL', isLocked: true },
  
  // Active Pitchers
  { player: { id: uuidv4(), mlbamId: '669084', name: 'Player 669084', team: 'ARI', position: ['SP'] }, position: 'SP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '606992', name: 'Player 606992', team: 'COL', position: ['SP'] }, position: 'SP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '669003', name: 'Player 669003', team: 'MIA', position: ['RP'] }, position: 'RP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '669145', name: 'Player 669145', team: 'PIT', position: ['RP'] }, position: 'RP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '684974', name: 'Player 684974', team: 'CIN', position: ['SP'] }, position: 'P', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '605540', name: 'Player 605540', team: 'OAK', position: ['SP'] }, position: 'P', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '671162', name: 'Player 671162', team: 'DET', position: ['SP'] }, position: 'P', isLocked: false },
  
  // IL Pitchers
  { player: { id: uuidv4(), mlbamId: '692230', name: 'Player 692230', team: 'KC', position: ['RP'] }, position: 'IL', isLocked: true },
  { player: { id: uuidv4(), mlbamId: '668834', name: 'Player 668834', team: 'BAL', position: ['SP'] }, position: 'IL', isLocked: true },
];

export async function waiverTestRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // POST /waiver/test-with-roster - Test waiver with hardcoded roster
  fastify.post('/test-with-roster', async (request, reply) => {
    const traceId = uuidv4();
    const now = new Date();
    
    const decisionRequest: WaiverRecommendationRequest = {
      id: uuidv4(),
      version: 'v1',
      createdAt: now.toISOString(),
      leagueConfig: {
        platform: 'yahoo',
        format: 'h2h',
        leagueSize: 12,
        scoringRules: {
          batting: { R: 1, HR: 4, RBI: 1, SB: 2, BB: 1, H: 1, '2B': 2, '3B': 3, AVG: 0 },
          pitching: { IP: 3, SO: 1, W: 5, SV: 5, ER: -1, H: -0.5, BB: -0.5, ERA: 0, WHIP: 0, K: 0 }
        },
        rosterPositions: [
          { slot: 'C', maxCount: 1, eligiblePositions: ['C'] },
          { slot: '1B', maxCount: 1, eligiblePositions: ['1B'] },
          { slot: '2B', maxCount: 1, eligiblePositions: ['2B'] },
          { slot: '3B', maxCount: 1, eligiblePositions: ['3B'] },
          { slot: 'SS', maxCount: 1, eligiblePositions: ['SS'] },
          { slot: 'OF', maxCount: 3, eligiblePositions: ['LF', 'CF', 'RF', 'OF'] },
          { slot: 'UTIL', maxCount: 1, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF'] },
          { slot: 'SP', maxCount: 2, eligiblePositions: ['SP'] },
          { slot: 'RP', maxCount: 2, eligiblePositions: ['RP'] },
          { slot: 'P', maxCount: 3, eligiblePositions: ['SP', 'RP'] },
          { slot: 'BN', maxCount: 5, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'] },
          { slot: 'IL', maxCount: 4, eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'] },
        ],
      },
      currentRoster: HARDCODED_ROSTER,
      availablePlayers: {
        players: [],
        lastUpdated: now.toISOString(),
      },
      recommendationScope: 'add_drop',
      rosterNeeds: {
        positionalNeeds: {},
        preferredUpside: false,
      },
    };

    await prisma.decisionRequest.create({
      data: {
        id: decisionRequest.id,
        version: decisionRequest.version,
        type: 'waiver_recommendation',
        createdAt: now,
        payload: decisionRequest as any,
        status: 'pending',
        traceId,
      },
    });

    await addDecisionRequest(
      'waiver_recommendation',
      decisionRequest,
      traceId,
      8
    );

    return {
      success: true,
      message: 'Waiver recommendation request queued with hardcoded roster (DB player IDs)',
      requestId: decisionRequest.id,
      traceId,
      status: 'pending',
      rosterSummary: {
        active: HARDCODED_ROSTER.filter(r => r.position !== 'BN' && r.position !== 'IL').length,
        bench: HARDCODED_ROSTER.filter(r => r.position === 'BN').length,
        il: HARDCODED_ROSTER.filter(r => r.position === 'IL').length,
        total: HARDCODED_ROSTER.length,
      },
      checkResultAt: `/waiver/${decisionRequest.id}/result`,
    };
  });

  // GET /waiver/my-roster - View the hardcoded roster
  fastify.get('/my-roster', async (request, reply) => {
    return {
      roster: HARDCODED_ROSTER.map(r => ({
        mlbamId: r.player.mlbamId,
        name: r.player.name,
        position: r.position,
        isLocked: r.isLocked,
      })),
      summary: {
        active: HARDCODED_ROSTER.filter(r => r.position !== 'BN' && r.position !== 'IL').length,
        bench: HARDCODED_ROSTER.filter(r => r.position === 'BN').length,
        il: HARDCODED_ROSTER.filter(r => r.position === 'IL').length,
        total: HARDCODED_ROSTER.length,
      },
    };
  });
}
