/**
 * Valuation Handler
 * 
 * Generates player valuations with projections and risk profiles.
 * Placeholder - would use Monte Carlo simulations, factor models, etc.
 */

import { v4 as uuidv4 } from 'uuid';

import { prisma } from '@cbb/infrastructure';
import type { 
  PlayerValuationReport, 
  Distribution,
  AppliedFactor,
  PlayerRiskProfile 
} from '@cbb/core';

export async function handleValuation(
  playerIds: string[],
  scoringPeriod: { start: string; end: string },
  traceId: string
): Promise<PlayerValuationReport[]> {
  if (process.env.ALLOW_MOCK_VALUATIONS !== 'true') {
    throw new Error(
      'Mock valuations are disabled. Set ALLOW_MOCK_VALUATIONS=true for development or implement a real valuation pipeline.'
    );
  }

  
  const valuations: PlayerValuationReport[] = [];
  
  for (const playerId of playerIds) {
    // Placeholder: Generate mock valuation
    const valuation = generateMockValuation(playerId, scoringPeriod, traceId);
    
    // Store in database
    await prisma.playerValuation.create({
      data: {
        id: uuidv4(),
        version: valuation.version,
        playerId: valuation.player.id,
        playerMlbamId: valuation.player.mlbamId,
        playerName: valuation.player.name,
        playerTeam: valuation.player.team,
        playerPositions: valuation.player.position,
        scoringPeriodStart: new Date(scoringPeriod.start),
        scoringPeriodEnd: new Date(scoringPeriod.end),
        generatedAt: new Date(valuation.generatedAt),
        validUntil: new Date(valuation.validUntil),
        pointProjection: valuation.pointProjection as any,
        valueOverReplacement: valuation.valueOverReplacement,
        floorProjection: valuation.floorProjection,
        ceilingProjection: valuation.ceilingProjection,
        overallRisk: valuation.riskProfile.overallRisk,
        injuryRisk: valuation.riskProfile.injuryRisk,
        playingTimeRisk: valuation.riskProfile.playingTimeRisk,
        performanceVariance: valuation.riskProfile.performanceVariance,
        modelType: valuation.methodology.modelType,
        modelVersion: valuation.methodology.modelVersion,
        featuresUsed: valuation.methodology.featuresUsed,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        factors: valuation.factors as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dataSources: valuation.dataSources as any,
        traceId,
      },
    });
    
    valuations.push(valuation);
  }
  
  return valuations;
}

function generateMockValuation(
  playerId: string,
  scoringPeriod: { start: string; end: string },
  traceId: string
): PlayerValuationReport {
  const now = new Date();
  const validUntil = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  
  const pointProjection: Distribution = {
    mean: Math.random() * 15 + 5,
    median: Math.random() * 15 + 5,
    standardDeviation: Math.random() * 3 + 1,
    variance: Math.random() * 9 + 1,
    percentiles: {
      p5: Math.random() * 10,
      p10: Math.random() * 12,
      p25: Math.random() * 13,
      p50: Math.random() * 15,
      p75: Math.random() * 17,
      p90: Math.random() * 20,
      p95: Math.random() * 22,
    },
  };
  
  const riskProfile: PlayerRiskProfile = {
    injuryRisk: ['low', 'moderate', 'high'][Math.floor(Math.random() * 3)] as PlayerRiskProfile['injuryRisk'],
    playingTimeRisk: ['low', 'moderate', 'high'][Math.floor(Math.random() * 3)] as PlayerRiskProfile['playingTimeRisk'],
    performanceVariance: ['low', 'moderate', 'high'][Math.floor(Math.random() * 3)] as PlayerRiskProfile['performanceVariance'],
    overallRisk: ['low', 'moderate', 'high'][Math.floor(Math.random() * 3)] as PlayerRiskProfile['overallRisk'],
    confidenceInterval: {
      lower: pointProjection.mean - pointProjection.standardDeviation,
      upper: pointProjection.mean + pointProjection.standardDeviation,
    },
  };
  
  const factors: AppliedFactor[] = [
    {
      factorType: 'ballpark',
      impact: 1.05,
      confidence: 'high',
      rawData: { parkName: 'Coors Field', hrFactor: 1.2 },
    },
    {
      factorType: 'platoon_split',
      impact: 0.95,
      confidence: 'moderate',
      rawData: { vsHandedness: 'L', split: -0.02 },
    },
  ];
  
  return {
    id: uuidv4(),
    version: 'v1',
    generatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    player: {
      id: playerId,
      mlbamId: String(600000 + Math.floor(Math.random() * 10000)),
      name: 'Player ' + playerId.slice(0, 8),
      team: ['LAD', 'NYY', 'ATL', 'HOU'][Math.floor(Math.random() * 4)],
      position: [['1B'], ['OF'], ['SP'], ['RP']][Math.floor(Math.random() * 4)],
    },
    context: {
      scoringPeriod: {
        type: 'daily',
        startDate: scoringPeriod.start,
        endDate: scoringPeriod.end,
        games: [],
      },
      leagueScoring: {
        batting: { R: 1, HR: 4, RBI: 1, SB: 2, BB: 1 },
        pitching: { IP: 3, SO: 1, W: 5, SV: 5, ER: -1 },
      },
    },
    pointProjection,
    valueOverReplacement: Math.random() * 5 - 2,
    positionalScarcity: {
      position: 'OF',
      replacementLevel: 3.5,
      availableAlternatives: 15,
      scarcityScore: 0.3,
    },
    riskProfile,
    floorProjection: pointProjection.mean - pointProjection.standardDeviation,
    ceilingProjection: pointProjection.mean + pointProjection.standardDeviation * 2,
    factors,
     methodology: {
       modelType: 'mock',
       simulationCount: 10000,
       featuresUsed: ['mock_random_baseline', 'recent_performance', 'matchup_quality', 'ballpark', 'weather'],
       modelVersion: 'mock-dev',
       trainedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
     },
     dataSources: [
       {
         source: 'mock_generator',
         endpoint: 'internal://mock-valuation',
         fetchedAt: now.toISOString(),
         cacheKey: `stats_${playerId}`,
       },
    ],
  };
}
