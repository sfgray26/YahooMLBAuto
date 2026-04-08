import { prisma } from '@cbb/infrastructure';

export interface VerifiedPlayerIdentity {
  mlbamId: string;
  fullName: string;
  team: string | null;
  position: string | null;
}

const TEAM_ID_TO_ABBREVIATION: Record<string, string> = {
  '108': 'LAA',
  '109': 'ARI',
  '110': 'BAL',
  '111': 'BOS',
  '112': 'CHC',
  '113': 'CIN',
  '114': 'CLE',
  '115': 'COL',
  '116': 'DET',
  '117': 'HOU',
  '118': 'KC',
  '119': 'LAD',
  '120': 'WSH',
  '121': 'NYM',
  '133': 'OAK',
  '134': 'PIT',
  '135': 'SD',
  '136': 'SEA',
  '137': 'SF',
  '138': 'STL',
  '139': 'TB',
  '140': 'TEX',
  '141': 'TOR',
  '142': 'MIN',
  '143': 'PHI',
  '144': 'ATL',
  '145': 'CWS',
  '146': 'MIA',
  '147': 'NYY',
  '158': 'MIL',
};

const TEAM_NAME_TO_ABBREVIATION: Record<string, string> = {
  'Arizona Diamondbacks': 'ARI',
  'Athletics': 'OAK',
  'Atlanta Braves': 'ATL',
  'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS',
  'Chicago Cubs': 'CHC',
  'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN',
  'Cleveland Guardians': 'CLE',
  'Cleveland Indians': 'CLE',
  'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET',
  'Houston Astros': 'HOU',
  'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA',
  'Los Angeles Dodgers': 'LAD',
  'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL',
  'Minnesota Twins': 'MIN',
  'New York Mets': 'NYM',
  'New York Yankees': 'NYY',
  'Oakland Athletics': 'OAK',
  'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT',
  'San Diego Padres': 'SD',
  'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA',
  'St. Louis Cardinals': 'STL',
  'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX',
  'Toronto Blue Jays': 'TOR',
  'Washington Nationals': 'WSH',
};

const HITTER_POSITIONS = new Set([
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
  'OF',
  'DH',
  'UT',
  'UTIL',
]);

export async function loadVerifiedPlayerIdentity(
  mlbamId: string
): Promise<VerifiedPlayerIdentity | null> {
  return prisma.verifiedPlayer.findUnique({
    where: { mlbamId },
    select: {
      mlbamId: true,
      fullName: true,
      team: true,
      position: true,
    },
  });
}

export async function loadVerifiedPlayerIdentityMap(
  mlbamIds: string[]
): Promise<Map<string, VerifiedPlayerIdentity>> {
  const uniqueIds = [...new Set(mlbamIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const players = await prisma.verifiedPlayer.findMany({
    where: {
      mlbamId: {
        in: uniqueIds,
      },
    },
    select: {
      mlbamId: true,
      fullName: true,
      team: true,
      position: true,
    },
  });

  return new Map(players.map((player) => [player.mlbamId, player]));
}

export function isVerifiedHitterPosition(position: string | null | undefined): boolean {
  if (!position) {
    return false;
  }

  return position
    .split(/[\/,]/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .some((part) => HITTER_POSITIONS.has(part));
}

export function normalizeTeamLabel(team: string | null | undefined): string | null {
  if (!team) {
    return null;
  }

  const trimmed = team.trim();

  if (TEAM_ID_TO_ABBREVIATION[trimmed]) {
    return TEAM_ID_TO_ABBREVIATION[trimmed];
  }

  if (TEAM_NAME_TO_ABBREVIATION[trimmed]) {
    return TEAM_NAME_TO_ABBREVIATION[trimmed];
  }

  return trimmed;
}
