/**
 * Scheduler
 * 
 * Runs on a schedule (cron) to trigger recurring jobs:
 * - Data refresh every 15 minutes
 * - Valuation updates
 * - End-of-day processing
 */

import { v4 as uuidv4 } from 'uuid';
import { getMlbWallClock } from '@cbb/core';

import { 
  addDataSync, 
  addValuationJob,
  prisma,
  closeQueues 
} from '@cbb/infrastructure';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[SCHEDULER] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[SCHEDULER ERROR] ${msg}`, meta || ''),
};

async function runScheduledTasks() {
  const now = new Date();
  const easternClock = getMlbWallClock(now);
  const hour = easternClock.hour;
  const minute = easternClock.minute;
  const today = easternClock.isoDate;
  
  logger.info('Running scheduled tasks', { 
    timestamp: now.toISOString(),
    timezone: 'America/New_York',
    easternDate: today,
    hour,
    minute,
  });
  
  try {
    // Always run: Data refresh
    await addDataSync('player_data');
    await addDataSync('schedule');
    
    // On the hour: Weather update
    if (minute === 0 || minute === 30) {
      logger.info('Running weather sync');
      await addDataSync('weather');
    }
    
    // Every 6 hours: Full valuation refresh
    if (hour % 6 === 0 && minute === 0) {
      logger.info('Running full valuation refresh');
      
      // Get all active players from database
      const players = await prisma.playerValuation.findMany({
        distinct: ['playerId'],
        select: { playerId: true },
        take: 1000, // Limit to avoid overwhelming the queue
      });
      
      if (players.length > 0 && process.env.ALLOW_MOCK_VALUATIONS === 'true') {
        await addValuationJob(
          players.map((p: { playerId: string }) => p.playerId),
          { start: today, end: today },
          uuidv4()
        );
      } else if (players.length > 0) {
        logger.info('Skipping valuation refresh because mock valuations are disabled');
      }
    }
    
    // Daily at 6 AM: Pre-game optimization prep
    if (hour === 6 && minute === 0) {
      logger.info('Running pre-game optimization prep');
      // This would queue up lineup optimizations for all configured leagues
    }
    
    // Daily at 11 PM: End-of-day processing
    if (hour === 23 && minute === 0) {
      logger.info('Running end-of-day processing');
      await addDataSync('scores');
    }
    
    logger.info('Scheduled tasks completed');
    
  } catch (error) {
    logger.error('Scheduled tasks failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// Run immediately
runScheduledTasks()
  .then(() => {
    logger.info('Scheduler run complete, exiting');
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('Scheduler failed', { error: error.message });
    await closeQueues();
    await prisma.$disconnect();
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
});
