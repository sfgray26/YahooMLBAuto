# Balldontlie Integration Test Procedure

## Prerequisites

1. Get your balldontlie GOAT tier API key from https://mlb.balldontlie.io/
2. Set environment variable: `export BALLDONTLIE_API_KEY=your_key_here`

## Phase 1: Provider Tests

Test the balldontlie adapter independently:

```bash
cd /root/.openclaw/workspace/cbb-edge-analyzer
BALLDONTLIE_API_KEY=your_key npx tsx scripts/test-balldontlie.ts
```

**Expected Output:**
- ✅ Provider Health Check (shows API connectivity)
- ✅ Game Logs Fetch (retrieves games for test players)
- ✅ Cache Functionality (cache hit on second request)
- ✅ Batch Fetch (multiple players concurrently)
- ✅ Date Range Filter (filters work correctly)
- ✅ Player Splits (contextual data retrieved)

**Pass Criteria:** All tests pass (no ❌)

## Phase 2: Derived Stats Tests

Test the 7/14/30 computation logic:

```bash
cd /root/.openclaw/workspace/cbb-edge-analyzer
BALLDONTLIE_API_KEY=your_key npx tsx scripts/test-derived-computation.ts
```

**Expected Output:**
- ✅ Basic Computation (features calculate correctly)
- ✅ Determinism (same input = same output)
- ✅ Date Window Logic (calendar-based windows)
- ✅ Rate Stat Accuracy (OPS = OBP + SLG, etc.)
- ✅ Reliability Scoring (100 PA threshold)
- ✅ Batch Computation (multiple players)

**Pass Criteria:** All tests pass

## Phase 3: Manual Verification (Optional)

Cross-check a player manually:

```bash
# Get raw game logs
BALLDONTLIE_API_KEY=your_key npx tsx -e "
const { BalldontlieProvider } = require('./packages/data/src/providers/balldontlie.js');
const { MemoryCache } = require('./packages/data/src/providers/cache.js');

const provider = new BalldontlieProvider({
  apiKey: process.env.BALLDONTLIE_API_KEY,
  cache: new MemoryCache()
});

provider.getGameLogs('592450', { season: 2025 }).then(r => {
  console.log('Aaron Judge 2025 games:', r.data.length);
  console.log('Recent:', r.data.slice(0, 3).map(g => ({
    date: g.gameDate.toISOString().split('T')[0],
    atBats: g.atBats,
    hits: g.hits,
    homeRuns: g.homeRuns
  })));
});
"
```

## Troubleshooting

### Rate Limit Errors
The adapter has built-in rate limiting (8 req/sec conservative). If you hit limits:
- Wait 1 minute and retry
- Check `X-RateLimit-Remaining` in health check

### No Data Returned
- Verify player IDs are correct MLBAM IDs
- Check season (2025 for current season)
- Some players may have no games (injured, minors, etc.)

### Cache Issues
Tests use in-memory cache. If you need fresh data:
- Restart the test process (cache is cleared)

## Next Steps After Passing Tests

1. **Database Integration**: Store game logs in `PlayerGameLog` table
2. **Scheduler Job**: Daily ingestion from balldontlie
3. **Derived Stats Pipeline**: Compute 7/14/30 features nightly
4. **Validation Layer**: Cross-check with MLB Stats API (optional)

## File Structure

```
packages/data/src/
├── providers/
│   ├── interface.ts       # Contract definitions
│   ├── balldontlie.ts     # Primary provider
│   ├── rate-limiter.ts    # Token bucket
│   └── cache.ts           # In-memory cache
├── computation/
│   └── derived-features.ts # 7/14/30 calculator
└── index.ts               # Package exports

scripts/
├── test-balldontlie.ts           # Provider tests
└── test-derived-computation.ts   # Computation tests
```
