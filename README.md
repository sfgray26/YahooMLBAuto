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

## CI / GitHub Actions

Two separate workflows keep the build fast, secretless, and observable.

---

### 1 · PR CI (`ci.yml`)

Runs on **every push to `master` and every pull request**.  
No external credentials required — all checks are deterministic.

| Step | Command | Notes |
|------|---------|-------|
| Lint | `pnpm lint` | ESLint across all workspaces |
| Typecheck | `pnpm typecheck` | TypeScript strict check across all workspaces |
| Unit tests | `pnpm test` | Vitest via Turborepo |
| Scoring validation | `pnpm validate:scoring` | Pure-function, no DB required |
| Derived validation | `pnpm validate:derived` | Skipped unless `DATABASE_URL` secret is set |

#### Running PR CI checks locally

```bash
pnpm install

# Same gates as CI
pnpm lint
pnpm typecheck
pnpm test
pnpm validate:scoring

# Derived-layer validation (needs a running PostgreSQL instance)
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname pnpm validate:derived
```

---

### 2 · Pipeline E2E (`pipeline-e2e.yml`)

Runs **all ingestion jobs, backfills, data tests, and validations** against real
external APIs and a local Postgres/Redis instance (spun up via docker-compose).

**Triggers:**
- **Manual** – from the GitHub UI: Actions → *Pipeline E2E* → *Run workflow*
- **Nightly** – automatically at 06:00 UTC every day

**Does NOT trigger on pull requests.**

#### Triggering manually from GitHub UI

1. Open the repository on GitHub.
2. Click the **Actions** tab.
3. In the left sidebar select **Pipeline E2E**.
4. Click **Run workflow** (top-right of the runs list).
5. Choose a **mode**:
   - `full` *(default)* – ingestion + game-log backfill + all tests + full UAT
   - `smoke` – ingestion + `backfill:small` + core validations + `uat:simple`
6. Click the green **Run workflow** button.

Results and captured logs are available as a downloadable artifact named
`pipeline-e2e-logs-<run-number>` (retained for 14 days).

#### Pipeline E2E – Required secrets

Add these under **Settings → Secrets and variables → Actions → Secrets**:

| Secret name | Required | Description |
|-------------|----------|-------------|
| `BALLDONTLIE_API_KEY` | **Yes** | API key for [balldontlie.io](https://mlb.balldontlie.io/) MLB data (used by `data:ingest`, `test:balldontlie`, backfills) |
| `MLB_API_KEY` | No | Optional MLB Stats API key for additional data sources |

> **Note:** `DATABASE_URL` and `REDIS_URL` are **not** required as secrets for the
> Pipeline E2E workflow — it spins up local Postgres and Redis via `docker-compose`
> and sets these values automatically.

#### Running the full pipeline locally

```bash
# 1. Start local infrastructure
docker compose up -d postgres redis

# 2. Run migrations
pnpm db:migrate

# 3. Ingestion
BALLDONTLIE_API_KEY=your_key pnpm data:ingest
pnpm data:compute

# Worker-level pipeline
cd apps/worker
BALLDONTLIE_API_KEY=your_key pnpm ingest
pnpm derive
pnpm score
cd ../..

# 4. Backfills
BALLDONTLIE_API_KEY=your_key pnpm backfill:small
BALLDONTLIE_API_KEY=your_key pnpm backfill:game-logs   # heavy – optional

# 5. Tests
BALLDONTLIE_API_KEY=your_key pnpm test:balldontlie
pnpm test:derived
pnpm test:game-logs

# 6. Validations
pnpm validate:scoring
pnpm validate:derived

# 7. UAT
pnpm uat:simple   # quick
pnpm uat          # full

# 8. Teardown
docker compose down --volumes
```

## License

MIT
