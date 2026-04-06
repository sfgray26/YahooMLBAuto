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
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { prisma, closeQueues } from '@cbb/infrastructure';

import { lineupRoutes } from './routes/lineup.js';
import { waiverRoutes } from './routes/waiver.js';
import { waiverTestRoutes } from './routes/waiver-test.js';
import { playerRoutes } from './routes/player.js';
import { playerScoreRoutes } from './routes/playerScore.js';
import { decisionRoutes } from './routes/decisions.js';
import { adminRoutes } from './routes/admin.js';
import { monteCarloTestRoutes } from './routes/monte-carlo.js';
import { tradeRoutes } from './routes/trade.js';
import { momentumRoutes } from './routes/momentum.js';
import { simulationRoutes } from './routes/simulation.js';

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
// Swagger / OpenAPI Documentation
// ============================================================================

await server.register(swagger, {
  openapi: {
    info: {
      title: 'CBB Edge Analyzer API',
      description: 'Fantasy Baseball Intelligence API - Trade Evaluation, Momentum Detection, ROS Simulation',
      version: '1.0.0',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    tags: [
      { name: 'Health', description: 'Service health checks' },
      { name: 'Trade', description: 'Trade evaluation and analysis' },
      { name: 'Momentum', description: 'Player momentum and trend detection' },
      { name: 'Simulation', description: 'Monte Carlo ROS projections' },
      { name: 'Lineup', description: 'Lineup optimization' },
      { name: 'Waiver', description: 'Waiver wire recommendations' },
      { name: 'Players', description: 'Player scoring and data' },
    ],
  },
});

await server.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false,
  },
  staticCSP: true,
});

// ============================================================================
// Health Check
// ============================================================================

server.get('/health', async (_request, reply) => {
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
    server.log.error('Health check failed: %s', error instanceof Error ? error.message : String(error));
    return reply.status(503).send({
      status: 'error', 
      timestamp: new Date().toISOString(),
      services: {
        database: 'disconnected',
      }
    });
  }
});

// ============================================================================
// Routes
// ============================================================================

await server.register(lineupRoutes, { prefix: '/lineup' });
await server.register(waiverRoutes, { prefix: '/waiver' });
await server.register(waiverTestRoutes, { prefix: '/waiver' });
await server.register(playerRoutes, { prefix: '/players' });
await server.register(playerScoreRoutes, { prefix: '/players' });
await server.register(decisionRoutes, { prefix: '/decisions' });
await server.register(adminRoutes, { prefix: '/admin' });
await server.register(monteCarloTestRoutes, { prefix: '/monte-carlo' });
await server.register(tradeRoutes, { prefix: '/trade' });
await server.register(momentumRoutes, { prefix: '/momentum' });
await server.register(simulationRoutes, { prefix: '/simulate' });

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
