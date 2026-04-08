import { prisma } from '@cbb/infrastructure';

export interface VerifiedPlayerIdentity {
  mlbamId: string;
  fullName: string;
  team: string | null;
  position: string | null;
}

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
