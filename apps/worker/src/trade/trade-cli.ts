#!/usr/bin/env node
/**
 * Trade Evaluator CLI
 *
 * Command-line interface for evaluating trade proposals.
 * Example usage:
 *   npx tsx trade-cli.ts --give "player1,player2" --get "player3,player4" --format text
 */

import { evaluateTrade } from './evaluator.js';
import { formatTradeEvaluation, formatPlayerList } from './formatter.js';
import type { TradeProposal, TradePlayer, TeamState } from './types.js';

interface CLIOptions {
  give: string[];
  get: string[];
  format: 'text' | 'markdown' | 'json';
  verbose: boolean;
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  leagueFormat: 'roto' | 'h2h_points' | 'h2h_categories';
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    give: [],
    get: [],
    format: 'text',
    verbose: false,
    riskTolerance: 'balanced',
    leagueFormat: 'roto',
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--give':
      case '-g':
        options.give = args[++i].split(',').map(s => s.trim());
        break;
      case '--get':
      case '-r': // receive
        options.get = args[++i].split(',').map(s => s.trim());
        break;
      case '--format':
      case '-f':
        const format = args[++i] as CLIOptions['format'];
        if (['text', 'markdown', 'json'].includes(format)) {
          options.format = format;
        }
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--risk':
        const risk = args[++i] as CLIOptions['riskTolerance'];
        if (['conservative', 'balanced', 'aggressive'].includes(risk)) {
          options.riskTolerance = risk;
        }
        break;
      case '--format-type':
        const fmt = args[++i] as CLIOptions['leagueFormat'];
        if (['roto', 'h2h_points', 'h2h_categories'].includes(fmt)) {
          options.leagueFormat = fmt;
        }
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }
  
  if (options.give.length === 0 && options.get.length === 0) {
    console.error('Error: Must specify players to give and/or receive');
    printHelp();
    process.exit(1);
  }
  
  return options;
}

function printHelp(): void {
  console.log(`
Trade Evaluator CLI

Usage: npx tsx trade-cli.ts [options]

Options:
  --give, -g <players>      Comma-separated list of players you give
  --get, -r <players>       Comma-separated list of players you receive
  --format, -f <fmt>        Output format: text | markdown | json (default: text)
  --verbose, -v             Include detailed analysis
  --risk <tolerance>        Risk tolerance: conservative | balanced | aggressive
  --format-type <type>      League format: roto | h2h_points | h2h_categories
  --help, -h                Show this help message

Examples:
  npx tsx trade-cli.ts --give "Judge,Strider" --get "Soto,Burnes"
  npx tsx trade-cli.ts -g "Judge" -r "Soto" -v
`);
}

function createMockTeamState(): TeamState {
  return {
    version: 'v1',
    identity: {
      teamId: 'your-team',
      leagueId: 'league-1',
      teamName: 'Your Team',
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

function createMockTrade(options: CLIOptions): TradeProposal {
  const playersYouGive: TradePlayer[] = options.give.map((name, i) => ({
    playerId: `give-${i}`,
    playerMlbamId: `mlbam-${i}`,
    name,
    positions: ['OF'],
    team: 'NYY',
    isInjured: false,
    gamesThisWeek: 6,
  }));
  
  const playersYouGet: TradePlayer[] = options.get.map((name, i) => ({
    playerId: `get-${i}`,
    playerMlbamId: `mlbam-get-${i}`,
    name,
    positions: ['OF'],
    team: 'LAD',
    isInjured: false,
    gamesThisWeek: 6,
  }));
  
  return {
    id: `trade-${Date.now()}`,
    proposedAt: new Date().toISOString(),
    yourTeamId: 'your-team',
    playersYouGive,
    playersYouGet,
    otherTeamId: 'other-team',
    otherTeamName: 'Other Team',
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  
  console.log('Loading trade evaluator...\n');
  
  // Create mock state and trade
  const teamState = createMockTeamState();
  const trade = createMockTrade(options);
  
  // Show trade details
  console.log('TRADE PROPOSAL');
  console.log('─'.repeat(40));
  console.log('You give:');
  console.log(formatPlayerList(trade.playersYouGive));
  console.log('');
  console.log('You get:');
  console.log(formatPlayerList(trade.playersYouGet));
  console.log('');
  
  // Evaluate trade
  const analysis = evaluateTrade(teamState, trade, {
    format: options.leagueFormat,
    riskTolerance: options.riskTolerance,
  });
  
  // Format output
  const output = formatTradeEvaluation(analysis, {
    format: options.format,
    verbose: options.verbose,
    includeTrace: options.verbose,
  });
  
  console.log(output);
}

// Run main
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
