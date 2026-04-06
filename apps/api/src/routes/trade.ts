/**
 * Trade Evaluator Routes
 *
 * POST /trade/evaluate - Evaluate a trade proposal
 *
 * Pure, deterministic trade analysis using the complete intelligence stack.
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { evaluateTrade, formatTradeEvaluation } from '@cbb/worker';
import type { TradeProposal, TradePlayer, TradeEvaluatorConfig, TeamState } from '@cbb/worker';

// Validation schemas
const TradePlayerSchema = z.object({
  playerId: z.string(),
  playerMlbamId: z.string(),
  name: z.string(),
  positions: z.array(z.string()),
  team: z.string(),
  isInjured: z.boolean().default(false),
  injuryStatus: z.string().optional(),
  gamesThisWeek: z.number().default(6),
});

const TradeProposalSchema = z.object({
  playersYouGive: z.array(TradePlayerSchema).min(1, 'Must give at least one player'),
  playersYouGet: z.array(TradePlayerSchema).min(1, 'Must receive at least one player'),
  otherTeamId: z.string().optional(),
  otherTeamName: z.string().optional(),
  faabYouGive: z.number().default(0),
  faabYouGet: z.number().default(0),
});

const TradeEvaluateSchema = z.object({
  proposal: TradeProposalSchema,
  teamState: z.object({
    teamId: z.string(),
    teamName: z.string().optional(),
  }).optional(),
  config: z.object({
    format: z.enum(['roto', 'h2h_points', 'h2h_categories']).default('roto'),
    riskTolerance: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
    leagueSize: z.number().default(12),
    currentWeek: z.number().default(12),
    weeksRemaining: z.number().default(14),
  }).optional(),
  outputFormat: z.enum(['json', 'text', 'markdown']).default('json'),
});

type TradeEvaluateBody = z.infer<typeof TradeEvaluateSchema>;

export async function tradeRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // ==========================================================================
  // POST /trade/evaluate
  // Evaluate a trade proposal
  // ==========================================================================
  fastify.post('/evaluate', async (request, reply) => {
    const traceId = uuidv4();
    const body = TradeEvaluateSchema.parse(request.body);
    
    try {
      // Build trade proposal
      const proposal: TradeProposal = {
        id: `trade-${Date.now()}`,
        proposedAt: new Date().toISOString(),
        yourTeamId: body.teamState?.teamId || 'your-team',
        playersYouGive: body.proposal.playersYouGive,
        playersYouGet: body.proposal.playersYouGet,
        otherTeamId: body.proposal.otherTeamId || 'other-team',
        otherTeamName: body.proposal.otherTeamName || 'Other Team',
        faabYouGive: body.proposal.faabYouGive,
        faabYouGet: body.proposal.faabYouGet,
      };

      // Build minimal team state
      const teamState: TeamState = createMinimalTeamState(body.teamState);

      // Build config
      const config: Partial<TradeEvaluatorConfig> = {
        format: body.config?.format || 'roto',
        riskTolerance: body.config?.riskTolerance || 'balanced',
        leagueSize: body.config?.leagueSize || 12,
        currentWeek: body.config?.currentWeek || 12,
        weeksRemaining: body.config?.weeksRemaining || 14,
      };

      // Evaluate trade (pure function call)
      const startTime = Date.now();
      const analysis = evaluateTrade(teamState, proposal, config);
      const duration = Date.now() - startTime;

      // Format output based on requested format
      if (body.outputFormat === 'text' || body.outputFormat === 'markdown') {
        const formatted = formatTradeEvaluation(analysis, {
          format: body.outputFormat,
          verbose: true,
          includeTrace: false,
        });
        reply.type(body.outputFormat === 'markdown' ? 'text/markdown' : 'text/plain');
        return formatted;
      }

      // JSON response
      return {
        success: true,
        traceId,
        evaluation: analysis.forYourTeam,
        fairness: analysis.fairness,
        likelihoodOfAcceptance: analysis.likelihoodOfAcceptance,
        yourLeverage: analysis.yourLeverage,
        theirLeverage: analysis.theirLeverage,
        meta: {
          duration,
          evaluatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        traceId,
        error: error instanceof Error ? error.message : 'Trade evaluation failed',
      });
    }
  });

  // ==========================================================================
  // POST /trade/quick-estimate
  // Quick value estimate without full simulation
  // ==========================================================================
  fastify.post('/quick-estimate', async (request, reply) => {
    const body = z.object({
      playersYouGive: z.array(z.object({
        name: z.string(),
        score: z.number().default(50),
      })),
      playersYouGet: z.array(z.object({
        name: z.string(),
        score: z.number().default(50),
      })),
    }).parse(request.body);

    const giveValue = body.playersYouGive.reduce((sum, p) => sum + p.score, 0);
    const getValue = body.playersYouGet.reduce((sum, p) => sum + p.score, 0);
    const netValue = getValue - giveValue;

    let recommendation: string;
    if (netValue >= 10) recommendation = 'strong_accept';
    else if (netValue >= 5) recommendation = 'lean_accept';
    else if (netValue <= -10) recommendation = 'hard_reject';
    else if (netValue <= -5) recommendation = 'lean_reject';
    else recommendation = 'neutral';

    return {
      giveValue,
      getValue,
      netValue,
      recommendation,
      summary: netValue > 0 ? `+${netValue} in your favor` : `${netValue} against you`,
    };
  });

  // ==========================================================================
  // GET /trade/examples
  // Get example trade proposals for testing
  // ==========================================================================
  fastify.get('/examples', async () => {
    return {
      examples: [
        {
          name: '2-for-1 Star Trade',
          description: 'Trade two good players for one star',
          proposal: {
            playersYouGive: [
              { playerId: '1', playerMlbamId: '605141', name: 'Player A', positions: ['OF'], team: 'NYY', isInjured: false, gamesThisWeek: 6 },
              { playerId: '2', playerMlbamId: '592450', name: 'Player B', positions: ['1B'], team: 'BOS', isInjured: false, gamesThisWeek: 6 },
            ],
            playersYouGet: [
              { playerId: '3', playerMlbamId: '660271', name: 'Star Player', positions: ['OF'], team: 'LAD', isInjured: false, gamesThisWeek: 6 },
            ],
          },
        },
        {
          name: 'Position Swap',
          description: 'Trade for positional needs',
          proposal: {
            playersYouGive: [
              { playerId: '1', playerMlbamId: '605141', name: 'Excess OF', positions: ['OF'], team: 'NYY', isInjured: false, gamesThisWeek: 6 },
            ],
            playersYouGet: [
              { playerId: '2', playerMlbamId: '592450', name: 'Need C', positions: ['C'], team: 'BOS', isInjured: false, gamesThisWeek: 6 },
            ],
          },
        },
      ],
    };
  });
}

// Helper to create minimal TeamState
function createMinimalTeamState(teamInfo?: { teamId?: string; teamName?: string }): TeamState {
  return {
    version: 'v1',
    identity: {
      teamId: teamInfo?.teamId || 'your-team',
      leagueId: 'league-1',
      teamName: teamInfo?.teamName || 'Your Team',
      leagueName: 'Test League',
      platform: 'yahoo',
      season: 2025,
      scoringPeriod: {
        type: 'weekly',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        games: [],
      },
    },
    roster: {
      version: 1,
      lastUpdated: new Date().toISOString(),
      players: [],
    },
    lineupConfig: {
      slots: [],
      totalSlots: 23,
      hittingSlots: 14,
      pitchingSlots: 9,
      benchSlots: 7,
    },
    currentLineup: {
      scoringPeriod: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      assignments: [],
      lockedSlots: [],
      benchAssignments: [],
    },
    waiverState: {
      budgetRemaining: 100,
      budgetTotal: 100,
      pendingClaims: [],
      lastWaiverProcess: null,
      nextWaiverProcess: null,
    },
  };
}
