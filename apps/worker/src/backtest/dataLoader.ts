/**
 * Historical Data Loader
 *
 * Loads and reconstructs historical fantasy baseball contexts
 * from stored game logs and roster snapshots.
 */

import { prisma } from '@cbb/infrastructure';
import type {
  WorldState,
  HistoricalRoster,
  HistoricalPlayer,
  HistoricalGame,
  TeamSchedule,
  InjuryStatus,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

interface DataLoaderConfig {
  season: number;
  teamId: string;
  leagueId: string;
  startDate?: Date;
  endDate?: Date;
  weeklyMode: boolean;  // true = weekly leagues, false = daily
}

// ============================================================================
// Main Loader
// ============================================================================

export class HistoricalDataLoader {
  private config: DataLoaderConfig;
  
  constructor(config: DataLoaderConfig) {
    this.config = config;
  }
  
  /**
   * Load complete season of world states
   */
  async loadSeason(): Promise<WorldState[]> {
    const { season, startDate, endDate, weeklyMode } = this.config;
    
    // Determine date range
    const seasonStart = startDate || new Date(`${season}-03-01`);
    const seasonEnd = endDate || new Date(`${season}-10-31`);
    
    // Generate simulation dates
    const simulationDates = this.generateSimulationDates(
      seasonStart,
      seasonEnd,
      weeklyMode
    );
    
    console.log(`[DataLoader] Loading ${simulationDates.length} simulation steps...`);
    
    // Load world state for each date
    const worldStates: WorldState[] = [];
    
    for (let i = 0; i < simulationDates.length; i++) {
      const date = simulationDates[i];
      const week = i + 1;
      
      console.log(`[DataLoader] Loading week ${week}: ${date.toISOString().split('T')[0]}`);
      
      const worldState = await this.loadWorldStateForDate(date, week);
      worldStates.push(worldState);
    }
    
    console.log(`[DataLoader] Loaded ${worldStates.length} world states`);
    return worldStates;
  }
  
  /**
   * Generate simulation dates (weekly or daily)
   */
  private generateSimulationDates(
    start: Date,
    end: Date,
    weekly: boolean
  ): Date[] {
    const dates: Date[] = [];
    const current = new Date(start);
    
    while (current <= end) {
      dates.push(new Date(current));
      
      if (weekly) {
        current.setDate(current.getDate() + 7);
      } else {
        current.setDate(current.getDate() + 1);
      }
    }
    
    return dates;
  }
  
  /**
   * Load world state for a specific date
   */
  private async loadWorldStateForDate(date: Date, week: number): Promise<WorldState> {
    const { season, teamId } = this.config;
    
    // Load roster as of this date
    const roster = await this.loadRosterForDate(teamId, date);
    
    // Load game logs for all roster players
    const gameLogs = await this.loadGameLogsForRoster(roster, date);
    
    // Load schedule
    const schedule = await this.loadScheduleForWeek(date);
    
    // Load injuries
    const injuries = await this.loadInjuriesForDate(date);
    
    return {
      date: date.toISOString().split('T')[0],
      week,
      season,
      roster,
      freeAgents: [],  // Would load from historical waiver data
      gameLogs,
      schedule,
      injuries,
    };
  }
  
  /**
   * Load roster as of a specific date
   */
  private async loadRosterForDate(
    teamId: string,
    asOfDate: Date
  ): Promise<HistoricalRoster> {
    // Query roster at this point in time
    // This would use a roster history table or transaction log
    
    const rosterPlayers = await prisma.rosterPlayer.findMany({
      where: {
        teamId,
        // Active as of this date
        acquiredDate: { lte: asOfDate },
        OR: [
          { droppedDate: null },
          { droppedDate: { gt: asOfDate } },
        ],
      },
      include: {
        player: true,
      },
    });
    
    const players: HistoricalPlayer[] = rosterPlayers.map(rp => ({
      playerId: rp.playerId,
      playerMlbamId: rp.player.mlbamId,
      name: rp.player.fullName,
      positions: rp.player.positions,
      acquiredDate: rp.acquiredDate.toISOString(),
      acquisitionType: rp.acquisitionType as any,
    }));
    
    return {
      teamId,
      players,
      lineupConfig: await this.loadLineupConfig(teamId),
      waiverBudget: await this.loadWaiverBudget(teamId, asOfDate),
    };
  }
  
  /**
   * Load game logs for all roster players
   */
  private async loadGameLogsForRoster(
    roster: HistoricalRoster,
    asOfDate: Date
  ): Promise<Map<string, HistoricalGame[]>> {
    const gameLogs = new Map<string, HistoricalGame[]>();
    
    // Look back 30 days for rolling stats
    const lookbackDate = new Date(asOfDate);
    lookbackDate.setDate(lookbackDate.getDate() - 30);
    
    for (const player of roster.players) {
      const games = await prisma.playerGameLog.findMany({
        where: {
          playerId: player.playerId,
          season: this.config.season,
          gameDate: {
            gte: lookbackDate,
            lte: asOfDate,
          },
        },
        orderBy: { gameDate: 'desc' },
      });
      
      const historicalGames: HistoricalGame[] = games.map(g => ({
        date: g.gameDate.toISOString(),
        opponent: g.opponent || 'UNK',
        isHome: g.isHome || false,
        plateAppearances: g.plateAppearances || 0,
        atBats: g.atBats || 0,
        hits: g.hits || 0,
        doubles: g.doubles || 0,
        triples: g.triples || 0,
        homeRuns: g.homeRuns || 0,
        runs: g.runs || 0,
        rbi: g.rbi || 0,
        walks: g.walks || 0,
        strikeouts: g.strikeouts || 0,
        stolenBases: g.stolenBases || 0,
        caughtStealing: 0,
        inningsPitched: 0,
        hitsAllowed: 0,
        runsAllowed: 0,
        earnedRuns: 0,
        walksAllowed: 0,
        strikeoutsPitched: 0,
        wins: 0,
        losses: 0,
        saves: 0,
      }));
      
      gameLogs.set(player.playerId, historicalGames);
    }
    
    return gameLogs;
  }
  
  /**
   * Load schedule for the week
   */
  private async loadScheduleForWeek(asOfDate: Date): Promise<TeamSchedule> {
    // Load MLB schedule
    const weekStart = new Date(asOfDate);
    const weekEnd = new Date(asOfDate);
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    // This would query a schedule table
    // Simplified for now
    return {
      teamId: this.config.teamId,
      games: [],
    };
  }
  
  /**
   * Load injuries as of a date
   */
  private async loadInjuriesForDate(asOfDate: Date): Promise<Map<string, InjuryStatus>> {
    const injuries = new Map<string, InjuryStatus>();
    
    // Query injury reports
    const injuryReports = await prisma.injuryReport.findMany({
      where: {
        season: this.config.season,
        reportDate: { lte: asOfDate },
        OR: [
          { returnDate: null },
          { returnDate: { gt: asOfDate } },
        ],
      },
    });
    
    for (const report of injuryReports) {
      injuries.set(report.playerId, {
        playerId: report.playerId,
        isInjured: true,
        injuryType: report.injuryType,
        expectedReturn: report.returnDate?.toISOString(),
      });
    }
    
    return injuries;
  }
  
  /**
   * Load lineup configuration
   */
  private async loadLineupConfig(teamId: string): Promise<any> {
    // Load league settings
    const league = await prisma.league.findUnique({
      where: { id: this.config.leagueId },
    });
    
    // Default config if not found
    return {
      slots: [
        { slotId: 'C', domain: 'hitting', eligiblePositions: ['C'], required: true },
        { slotId: '1B', domain: 'hitting', eligiblePositions: ['1B', 'CI'], required: true },
        { slotId: '2B', domain: 'hitting', eligiblePositions: ['2B', 'MI'], required: true },
        { slotId: '3B', domain: 'hitting', eligiblePositions: ['3B', 'CI'], required: true },
        { slotId: 'SS', domain: 'hitting', eligiblePositions: ['SS', 'MI'], required: true },
        { slotId: 'OF1', domain: 'hitting', eligiblePositions: ['OF'], required: true },
        { slotId: 'OF2', domain: 'hitting', eligiblePositions: ['OF'], required: true },
        { slotId: 'OF3', domain: 'hitting', eligiblePositions: ['OF'], required: true },
        { slotId: 'UTIL', domain: 'hitting', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'], required: false },
        { slotId: 'SP1', domain: 'pitching', eligiblePositions: ['SP', 'P'], required: true },
        { slotId: 'SP2', domain: 'pitching', eligiblePositions: ['SP', 'P'], required: true },
        { slotId: 'RP1', domain: 'pitching', eligiblePositions: ['RP', 'CL', 'P'], required: true },
        { slotId: 'RP2', domain: 'pitching', eligiblePositions: ['RP', 'CL', 'P'], required: true },
      ],
      benchSlots: 7,
      maxPlayers: 20,
    };
  }
  
  /**
   * Load waiver budget as of a date
   */
  private async loadWaiverBudget(teamId: string, asOfDate: Date): Promise<number> {
    // Query waiver transactions
    const spent = await prisma.waiverTransaction.aggregate({
      where: {
        teamId,
        season: this.config.season,
        transactionDate: { lte: asOfDate },
      },
      _sum: { faabAmount: true },
    });
    
    return 100 - (spent._sum.faabAmount || 0);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick load function for common use case
 */
export async function loadHistoricalSeason(
  season: number,
  teamId: string,
  leagueId: string,
  weeklyMode: boolean = true
): Promise<WorldState[]> {
  const loader = new HistoricalDataLoader({
    season,
    teamId,
    leagueId,
    weeklyMode,
  });
  
  return loader.loadSeason();
}
