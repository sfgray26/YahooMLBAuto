import { prisma } from '@cbb/infrastructure';

export interface VerifiedPlayerIdentity {
  mlbamId: string;
  fullName: string;
  team: string | null;
  position: string | null;
}

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
