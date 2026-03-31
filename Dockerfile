# ============================================================================
# CBB Edge Analyzer - Multi-service Docker Image
# Used by API, Worker, and Scheduler services on Railway
# ============================================================================

# -----------------------------------------------------------------------------
# Base Stage - Node setup
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN npm install -g pnpm@9.0.0

# -----------------------------------------------------------------------------
# Builder Stage - Install deps and build everything
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Copy all source files
COPY . .

# Install all dependencies (dev + prod)
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN cd packages/infrastructure && npx prisma generate

# Build packages (in dependency order)
RUN pnpm --filter @cbb/core build
RUN pnpm --filter @cbb/infrastructure build

# Build apps
RUN pnpm --filter @cbb/api build
RUN pnpm --filter @cbb/worker build

# -----------------------------------------------------------------------------
# Production Stage - Minimal runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production
RUN npm install -g pnpm@9.0.0

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/infrastructure/package.json ./packages/infrastructure/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/

# Copy built artifacts
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/infrastructure/dist ./packages/infrastructure/dist
COPY --from=builder /app/packages/infrastructure/prisma ./packages/infrastructure/prisma
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Generate Prisma client for production
RUN cd packages/infrastructure && npx prisma generate

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Default command (overridden by Railway service config)
CMD ["node", "apps/api/dist/server.js"]
