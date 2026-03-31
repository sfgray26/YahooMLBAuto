/**
 * Data Sync Handler
 *
 * Handles data synchronization from external sources.
 * Uses the ingestion orchestrator for MLB Stats API data,
 * then computes derived features.
 */

import { prisma } from '@cbb/infrastructure';
import { runDailyIngestion } from '../ingestion/index.js';
import { computeAllDerivedFeatures } from '../derived/index.js';

interface DataSyncOptions {
  date?: string;
  forceRefresh?: boolean;
}

export async function handleDataSync(
  type: 'player_data' | 'schedule' | 'weather' | 'scores',
  options: DataSyncOptions
): Promise<{ synced: boolean; count?: number; traceId?: string }> {

  switch (type) {
    case 'player_data':
      // Use the proper ingestion pipeline, then compute derived features
      return syncPlayerDataWithIngestion(options);

    case 'schedule':
      return syncSchedule(options);

    case 'weather':
      return syncWeather(options);

    case 'scores':
      return syncScores(options);

    default:
      throw new Error(`Unknown sync type: ${type}`);
  }
}

async function syncPlayerDataWithIngestion(
  options: DataSyncOptions
): Promise<{ synced: boolean; count: number; traceId: string }> {
  console.log('[DATA_SYNC] Starting player data ingestion...');

  // Determine season from date or use current year
  const season = options.date
    ? parseInt(options.date.split('-')[0])
    : new Date().getFullYear();

  // Step 1: Run ingestion
  const ingestionResult = await runDailyIngestion({
    season,
    gameType: 'R',
    dryRun: false,
  });

  if (!ingestionResult.success) {
    console.error('[DATA_SYNC] Ingestion failed', {
      traceId: ingestionResult.traceId,
      errors: ingestionResult.errors,
    });

    return {
      synced: false,
      count: 0,
      traceId: ingestionResult.traceId,
    };
  }

  console.log('[DATA_SYNC] Ingestion complete', {
    recordsFetched: ingestionResult.stats.rawRecordsFetched,
    normalizedCreated: ingestionResult.stats.normalizedCreated,
  });

  // Step 2: Compute derived features
  console.log('[DATA_SYNC] Computing derived features...');

  const derivedResult = await computeAllDerivedFeatures({
    season,
    dryRun: false,
  });

  if (!derivedResult.success) {
    console.error('[DATA_SYNC] Derived feature computation failed', {
      traceId: derivedResult.traceId,
      errors: derivedResult.errors,
    });
    // Don't fail the whole sync - ingestion succeeded
  } else {
    console.log('[DATA_SYNC] Derived features computed', {
      playersComputed: derivedResult.playersComputed,
    });
  }

  return {
    synced: true,
    count: ingestionResult.stats.normalizedCreated + ingestionResult.stats.normalizedUpdated,
    traceId: ingestionResult.traceId,
  };
}

async function syncSchedule(options: DataSyncOptions): Promise<{ synced: boolean; count: number }> {
  console.log('Syncing schedule...');

  await prisma.dataSourceCache.create({
    data: {
      id: crypto.randomUUID(),
      source: 'mlb_stats_api',
      endpoint: '/schedule',
      cacheKey: `schedule_${options.date || 'today'}`,
      data: { games: [], synced: true },
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours
    },
  });

  return { synced: true, count: 0 };
}

async function syncWeather(options: DataSyncOptions): Promise<{ synced: boolean; count: number }> {
  console.log('Syncing weather...');

  await prisma.dataSourceCache.create({
    data: {
      id: crypto.randomUUID(),
      source: 'weather_api',
      endpoint: '/forecast',
      cacheKey: `weather_${options.date || 'today'}`,
      data: { forecasts: [], synced: true },
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
    },
  });

  return { synced: true, count: 0 };
}

async function syncScores(options: DataSyncOptions): Promise<{ synced: boolean; count: number }> {
  console.log('Syncing scores...');

  await prisma.dataSourceCache.create({
    data: {
      id: crypto.randomUUID(),
      source: 'mlb_stats_api',
      endpoint: '/scores',
      cacheKey: `scores_${options.date || 'yesterday'}`,
      data: { games: [], synced: true },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return { synced: true, count: 0 };
}
