/**
 * Raw Data Storage
 * 
 * Step 2: Store raw payloads before normalization.
 * Idempotent - upserts based on natural keys.
 */

import { prisma } from '@cbb/infrastructure';
import type { RawPlayerStats, RawGameLog } from '../types/raw.js';

interface StoreRawStatsInput {
  source: string;           // 'mlb_stats_api'
  endpoint: string;         // Full URL
  season: number;
  gameType: string;
  fetchedAt: Date;
  rawPayload: unknown;      // Exact JSON from API
  recordCount: number;
  traceId: string;
}

/**
 * Store raw stats payload before normalization.
 * Idempotent - uses source + season + gameType + date as natural key.
 */
export async function storeRawStats(input: StoreRawStatsInput): Promise<void> {
  const { source, endpoint, season, gameType, fetchedAt, rawPayload, recordCount, traceId } = input;
  
  // Natural key: source + season + gameType + date
  const dateKey = fetchedAt.toISOString().split('T')[0];
  const cacheKey = `${source}:${season}:${gameType}:${dateKey}`;
  
  await prisma.rawIngestionLog.upsert({
    where: { cacheKey },
    create: {
      source,
      endpoint,
      season,
      gameType,
      fetchedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawPayload: rawPayload as any,
      recordCount,
      cacheKey,
      traceId,
    },
    update: {
      // Update with fresh data - idempotent
      fetchedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawPayload: rawPayload as any,
      recordCount,
      traceId,
    },
  });
}

/**
 * Store raw game logs before normalization.
 * Idempotent - uses playerId + season + date as natural key.
 */
export async function storeRawGameLogs(
  playerId: string,
  season: number,
  fetchedAt: Date,
  rawPayload: unknown,
  recordCount: number,
  traceId: string
): Promise<void> {
  const source = 'mlb_stats_api';
  const endpoint = `/people/${playerId}/stats?stats=gameLog`;
  
  // Natural key: player + season + date
  const dateKey = fetchedAt.toISOString().split('T')[0];
  const cacheKey = `${source}:gamelogs:${playerId}:${season}:${dateKey}`;
  
  await prisma.rawIngestionLog.upsert({
    where: { cacheKey },
    create: {
      source,
      endpoint,
      playerId,
      season,
      fetchedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawPayload: rawPayload as any,
      recordCount,
      cacheKey,
      traceId,
    },
    update: {
      fetchedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawPayload: rawPayload as any,
      recordCount,
      traceId,
    },
  });
}

/**
 * Check if we already have fresh data for a given key.
 * Returns true if data exists and is less than TTL hours old.
 */
export async function hasFreshData(
  cacheKey: string,
  ttlHours: number = 24
): Promise<boolean> {
  const existing = await prisma.rawIngestionLog.findUnique({
    where: { cacheKey },
  });
  
  if (!existing) return false;
  
  const ageHours = (Date.now() - existing.fetchedAt.getTime()) / (1000 * 60 * 60);
  return ageHours < ttlHours;
}

/**
 * Get raw data by cache key.
 */
export async function getRawData(cacheKey: string): Promise<unknown | null> {
  const record = await prisma.rawIngestionLog.findUnique({
    where: { cacheKey },
  });
  
  return record?.rawPayload || null;
}

/**
 * Log ingestion event for observability.
 */
export async function logIngestionEvent(
  eventType: string,
  payload: Record<string, unknown>,
  traceId: string
): Promise<void> {
  await prisma.systemEvent.create({
    data: {
      eventId: crypto.randomUUID(),
      eventType: `ingestion:${eventType}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: payload as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: {
        source: 'ingestion_worker',
        traceId,
        timestamp: new Date().toISOString(),
      } as any,
    },
  });
}
