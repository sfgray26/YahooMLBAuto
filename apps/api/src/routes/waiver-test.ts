/**
 * Waiver Test Route with Real MLB Roster
 * Uses actual player IDs and names for UAT
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { prisma, addDecisionRequest } from '@cbb/infrastructure';
import type { WaiverRecommendationRequest, RosterSlot, PoolPlayer } from '@cbb/core';

// Your actual roster with REAL MLBAM IDs
const YOUR_ROSTER: RosterSlot[] = [
  // Active Hitters
  { player: { id: uuidv4(), mlbamId: '669128', name: 'Yainer Diaz', team: 'HOU', position: ['C'] }, position: 'C', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '686469', name: 'Vinnie Pasquantino', team: 'KC', position: ['1B'] }, position: '1B', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '543760', name: 'Marcus Semien', team: 'TEX', position: ['2B'] }, position: '2B', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '656305', name: 'Matt Chapman', team: 'SF', position: ['3B'] }, position: '3B', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '672666', name: 'Geraldo Perdomo', team: 'ARI', position: ['SS'] }, position: 'SS', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '691023', name: 'Jordan Walker', team: 'STL', position: ['LF', 'RF'] }, position: 'LF', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '621439', name: 'Byron Buxton', team: 'MIN', position: ['CF'] }, position: 'CF', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '665742', name: 'Juan Soto', team: 'NYM', position: ['LF', 'RF'] }, position: 'RF', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '650333', name: 'Luis Arraez', team: 'SD', position: ['1B', '2B'] }, position: 'UTIL', isLocked: false },
  
  // Bench Hitters
  { player: { id: uuidv4(), mlbamId: '624413', name: 'Pete Alonso', team: 'NYM', position: ['1B'] }, position: 'BN', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '621043', name: 'Brandon Nimmo', team: 'NYM', position: ['LF', 'CF', 'RF'] }, position: 'BN', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '691738', name: 'Pete Crow-Armstrong', team: 'CHC', position: ['CF'] }, position: 'BN', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '680694', name: 'Steven Kwan', team: 'CLE', position: ['LF'] }, position: 'BN', isLocked: false },
  
  // IL Hitters
  { player: { id: uuidv4(), mlbamId: '676059', name: 'Jordan Westburg', team: 'BAL', position: ['2B', '3B'] }, position: 'IL', isLocked: true },
  { player: { id: uuidv4(), mlbamId: '673548', name: 'Seiya Suzuki', team: 'CHC', position: ['LF', 'RF'] }, position: 'IL', isLocked: true },
  
  // Active Pitchers
  { player: { id: uuidv4(), mlbamId: '676979', name: 'Garrett Crochet', team: 'BOS', position: ['SP'] }, position: 'SP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '650911', name: 'Cristopher Sánchez', team: 'PHI', position: ['SP'] }, position: 'SP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '621242', name: 'Edwin Díaz', team: 'NYM', position: ['RP'] }, position: 'RP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '605447', name: 'Jordan Romano', team: 'TOR', position: ['RP'] }, position: 'RP', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '682126', name: 'Eury Pérez', team: 'MIA', position: ['SP'] }, position: 'P', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '669062', name: 'Gavin Williams', team: 'CLE', position: ['SP'] }, position: 'P', isLocked: false },
  { player: { id: uuidv4(), mlbamId: '684858', name: 'Shota Imanaga', team: 'CHC', position: ['SP'] }, position: 'P', isLocked: false },
  
  // IL Pitchers
  { player: { id: uuidv4(), mlbamId: '542881', name: 'Jason Adam', team: 'SD', position: ['RP'] }, position: 'IL', isLocked: true },
  { player: { id: uuidv4(), mlbamId: '605483', name: 'Blake Snell', team: 'LAD', position: ['SP'] }, position: 'IL', isLocked: true },
];

// Waiver wire players (NOT on your roster - for recommendations)
const WAIVER_WIRE: PoolPlayer[] = [
  { player: { id: uuidv4(), mlbamId: '694817', name: 'Gunnar Henderson', team: 'BAL', position: ['SS', '3B'] }, isAvailable: true },
  { player: { id: uuidv4(), mlbamId: '682985', name: 'Corbin Carroll', team: 'ARI', position: ['LF', 'CF', 'RF'] }, isAvailable: true },
  { player: { id: uuidv4(), mlbamId: '660670', name: 'Bobby Witt Jr.', team: 'KC', position: ['SS'] }, isAvailable: true },
  { player: { id: uuidv4(), mlbamId: '677594', name: 'Julio Rodriguez', team: 'SEA', position: ['CF'] }, isAvailable: true },
  { player: { id: uuidv4(), mlbamId: '683011', name: 'Spencer Torkelson', team: 'DET', position: ['1B'] }, isAvailable: true },
];

export async function waiverTestRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // POST /waiver/test-with-roster - Test waiver with your real roster
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
      currentRoster: YOUR_ROSTER,
      availablePlayers: {
        players: WAIVER_WIRE,
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
      message: 'Waiver recommendation request queued with your real roster',
      requestId: decisionRequest.id,
      traceId,
      status: 'pending',
      rosterSummary: {
        active: YOUR_ROSTER.filter(r => r.position !== 'BN' && r.position !== 'IL').length,
        bench: YOUR_ROSTER.filter(r => r.position === 'BN').length,
        il: YOUR_ROSTER.filter(r => r.position === 'IL').length,
        total: YOUR_ROSTER.length,
      },
      waiverPool: WAIVER_WIRE.length,
      checkResultAt: `/waiver/${decisionRequest.id}/result`,
    };
  });

  // GET /waiver/my-roster - View your actual roster
  fastify.get('/my-roster', async (request, reply) => {
    return {
      roster: YOUR_ROSTER.map(r => ({
        mlbamId: r.player.mlbamId,
        name: r.player.name,
        team: r.player.team,
        position: r.position,
        isLocked: r.isLocked,
      })),
      waiverWire: WAIVER_WIRE.map(p => ({
        mlbamId: p.player.mlbamId,
        name: p.player.name,
        team: p.player.team,
      })),
      summary: {
        active: YOUR_ROSTER.filter(r => r.position !== 'BN' && r.position !== 'IL').length,
        bench: YOUR_ROSTER.filter(r => r.position === 'BN').length,
        il: YOUR_ROSTER.filter(r => r.position === 'IL').length,
        total: YOUR_ROSTER.length,
        waiverPool: WAIVER_WIRE.length,
      },
    };
  });
}
