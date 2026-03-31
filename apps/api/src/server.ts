/**
 * Decision Engine API Server
 * 
 * Stateless API that exposes decision endpoints.
 * All processing happens asynchronously via the worker queue.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { prisma, closeQueues } from '@cbb/infrastructure';

import { lineupRoutes } from './routes/lineup.js';
import { waiverRoutes } from './routes/waiver.js';
import { playerRoutes } from './routes/player.js';
import { decisionRoutes } from './routes/decisions.js';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// ============================================================================
// Plugins
// ============================================================================

await server.register(helmet);
await server.register(cors);
await server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// ============================================================================
// Health Check
// ============================================================================

server.get('/health', async () => {
  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
      }
    };
  } catch (error) {
    server.log.error('Health check failed:', error);
    return { 
      status: 'error', 
      timestamp: new Date().toISOString(),
      services: {
        database: 'disconnected',
      }
    };
  }
});

// ============================================================================
// Routes
// ============================================================================

await server.register(lineupRoutes, { prefix: '/lineup' });
await server.register(waiverRoutes, { prefix: '/waiver' });
await server.register(playerRoutes, { prefix: '/players' });
await server.register(decisionRoutes, { prefix: '/decisions' });

// ============================================================================
// Error Handler
// ============================================================================

server.setErrorHandler((error, request, reply) => {
  server.log.error(error);
  
  reply.status(error.statusCode || 500).send({
    error: error.message || 'Internal Server Error',
    traceId: request.id,
  });
});

// ============================================================================
// Start Server
// ============================================================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`Decision Engine API running on ${HOST}:${PORT}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  server.log.info('SIGTERM received, closing server...');
  await server.close();
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  server.log.info('SIGINT received, closing server...');
  await server.close();
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
});

start();
