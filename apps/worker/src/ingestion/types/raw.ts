/**
 * Raw data types from MLB Stats API
 * 
 * These types represent the EXACT structure returned by the API.
 * No transformation, no filtering - preserve everything.
 */

/**
 * Raw player season stats from MLB Stats API
 */
export interface RawPlayerStats {
  // Provider IDs (preserved exactly)
  player: {
    id: number;           // MLBAM player ID
    fullName: string;
    firstName: string;
    lastName: string;
    primaryNumber?: string;
    currentTeam?: {
      id: number;
      name: string;
    };
    primaryPosition?: {
      code: string;
      name: string;
      type: string;
      abbreviation: string;
    };
  };
  
  // Team context
  team: {
    id: number;
    name: string;
  };
  
  // League context  
  league: {
    id: number;
    name: string;
  };
  
  // Sport context
  sport: {
    id: number;
    abbreviation: string;
  };
  
  // Season context
  season: string;
  
  // Raw statistics (exactly as provided)
  stat: {
    // Counting stats
    gamesPlayed: number;
    atBats: number;
    runs: number;
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    rbi: number;
    stolenBases: number;
    caughtStealing: number;
    baseOnBalls: number;
    strikeOuts: number;
    leftOnBase: number;
    
    // Rate stats (if provided)
    avg?: string;
    obp?: string;
    slg?: string;
    ops?: string;
    
    // Advanced stats (if provided)
    totalBases?: number;
    groundIntoDoublePlay?: number;
    sacBunts?: number;
    sacFlies?: number;
    intentionalWalks?: number;
    hitByPitch?: number;
    
    // Extended stats
    plateAppearances?: number;
    groundOuts?: number;
    airOuts?: number;
    runsBattedIn?: number;
    
    // Timing
    games?: number;
  };
  
  // Metadata
  numTeams?: number;
  rank?: number;
}

/**
 * Raw game log entry from MLB Stats API
 */
export interface RawGameLog {
  // Provider IDs
  player: {
    id: number;
    fullName: string;
  };
  
  // Game context (preserved exactly)
  date: string;           // Format: 2024-03-31
  team: {
    id: number;
    name: string;
    link: string;
  };
  opponent: {
    id: number;
    name: string;
    link: string;
  };
  
  // Game metadata
  game: {
    gamePk: number;       // MLBAM game ID
    link: string;
    content: {
      link: string;
    };
  };
  
  // Venue
  venue?: {
    id: number;
    name: string;
  };
  
  // Result
  isHome: boolean;
  isWin: boolean;
  
  // Raw statistics for this game
  stat: {
    atBats: number;
    runs: number;
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    rbi: number;
    stolenBases: number;
    caughtStealing: number;
    baseOnBalls: number;
    strikeOuts: number;
    leftOnBase: number;
    avg?: string;
    obp?: string;
    slg?: string;
    ops?: string;
  };
}

/**
 * Raw schedule date entry
 */
export interface RawScheduleDate {
  date: string;
  totalItems: number;
  totalEvents: number;
  totalGames: number;
  totalGamesInProgress: number;
  games: RawGame[];
}

/**
 * Raw game entry
 */
export interface RawGame {
  gamePk: number;
  link: string;
  gameType: string;
  season: string;
  gameDate: string;       // ISO timestamp
  officialDate: string;   // YYYY-MM-DD
  status: {
    abstractGameState: string;
    codedGameState: string;
    detailedState: string;
    statusCode: string;
    abstractGameCode: string;
  };
  teams: {
    away: RawTeamGameInfo;
    home: RawTeamGameInfo;
  };
  venue: {
    id: number;
    name: string;
  };
  content: {
    link: string;
  };
}

/**
 * Raw team game info
 */
export interface RawTeamGameInfo {
  leagueRecord: {
    wins: number;
    losses: number;
    pct: string;
  };
  team: {
    id: number;
    name: string;
    link: string;
  };
  isWinner?: boolean;
  splitSquad: boolean;
  seriesNumber: number;
}

/**
 * Raw roster entry
 */
export interface RawRosterEntry {
  person: {
    id: number;
    fullName: string;
    link: string;
  };
  jerseyNumber: string;
  position: {
    code: string;
    name: string;
    type: string;
    abbreviation: string;
  };
  status: {
    code: string;
    description: string;
  };
}
