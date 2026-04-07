# CBB Edge Analyzer

> Quantitative fantasy baseball decision engine

## Architecture

```
┌─────────────────────────────────────────┐
│  API (apps/api)                         │
│  - POST /lineup/today                   │
│  - POST /waiver/recommendations         │
│  - GET  /players/:id/valuation          │
│  - GET  /decisions/pending              │
└──────────────┬──────────────────────────┘
               │ Decision Contracts
               ▼
┌─────────────────────────────────────────┐
│  Worker (apps/worker)                   │
│  - Data sync (every 15 min)             │
│  - Valuation generation                 │
│  - Decision processing                  │
│  - Alert triggers                       │
└─────────────────────────────────────────┘
```

## Decision Contracts

The system revolves around three immutable contracts:

1. **LineupOptimizationRequest** - Request lineup optimization with league config, player pool, risk tolerance
2. **PlayerValuationReport** - Probabilistic valuation with uncertainty quantification
3. **ExecutionDecision** - Recommendation with reasoning, alternatives, and safety controls

## Development

```bash
# Install dependencies
pnpm install

# Start local infrastructure
docker-compose up -d

# Run database migrations
pnpm db:migrate

# Start API and worker in dev mode
pnpm dev
```

## API Endpoints

### Lineup Optimization
```bash
POST /lineup/today
{
  "leagueId": "your-league",
  "platform": "yahoo",
  "format": "h2h",
  "riskTolerance": "balanced",
  "availablePlayers": {
    "players": [
      {
        "player": {
          "id": "player-1",
          "mlbamId": "660271",
          "name": "Mookie Betts",
          "team": "LAD",
          "position": ["OF"]
        },
        "isAvailable": true,
        "currentRosterStatus": "starting"
      }
    ]
  }
}

GET /lineup/:id/result
```

### Waiver Recommendations
```bash
POST /waiver/recommendations
{
  "leagueId": "your-league",
  "platform": "yahoo",
  "format": "h2h",
  "scope": "add_drop",
  "currentRoster": [
    {
      "player": {
        "id": "player-1",
        "mlbamId": "660271",
        "name": "Mookie Betts",
        "team": "LAD",
        "position": ["OF"]
      },
      "position": "OF",
      "isLocked": false
    }
  ],
  "availablePlayers": {
    "players": [
      {
        "player": {
          "id": "player-2",
          "mlbamId": "592450",
          "name": "William Contreras",
          "team": "MIL",
          "position": ["C"]
        },
        "isAvailable": true
      }
    ]
  }
}

GET /waiver/:id/result
```

### Player Valuations
```bash
GET /players/:id/valuation?date=2025-07-15
GET /players/search?q=Ohtani
GET /players/top?position=OF&limit=50
```

### Decisions
```bash
GET /decisions/pending
GET /decisions/:id
POST /decisions/:id/approve
POST /decisions/:id/reject
```

## Railway Deployment

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link project
railway login
railway link

# Deploy
railway up
```

## Environment Variables

```bash
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
PORT=3000
LOG_LEVEL=info
WORKER_CONCURRENCY=5
ALLOW_MOCK_VALUATIONS=false
```

## CI

GitHub Actions runs automatically on every push to `master` and on every pull request.

### What the CI job checks

| Step | Command | Notes |
|------|---------|-------|
| Lint | `pnpm lint` | ESLint across all workspaces |
| Typecheck | `pnpm typecheck` | TypeScript strict check across all workspaces |
| Unit tests | `pnpm test` | Vitest via Turborepo |
| Scoring validation | `pnpm validate:scoring` | Pure-function validation, always runs |
| Derived validation | `pnpm validate:derived` | Requires `DATABASE_URL` secret; skipped in CI if absent |

### Running CI checks locally

```bash
# Install dependencies
pnpm install

# Quality gates (same as CI)
pnpm lint
pnpm typecheck
pnpm test

# Data-pipeline validation (no DB required)
pnpm validate:scoring

# Full derived-layer validation (requires a running PostgreSQL instance)
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname pnpm validate:derived
```

To enable derived-layer validation in GitHub Actions, add `DATABASE_URL` as a
[repository secret](https://docs.github.com/en/actions/security-guides/encrypted-secrets).

## License

MIT
