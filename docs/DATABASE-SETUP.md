# Database Setup & Migration Guide

## Prerequisites

1. **Database URL**: You need the `DATABASE_URL` from Railway
2. **API Key**: Your balldontlie GOAT tier API key

## Step 1: Get Database URL from Railway

### Option A: Via Railway Dashboard
1. Go to https://railway.app/dashboard
2. Select your project
3. Click on the PostgreSQL service
4. Go to "Connect" tab
5. Copy the "Database URL"

### Option B: Via CLI (if logged in)
```bash
railway variables get DATABASE_URL
```

## Step 2: Run Migrations

### Option A: On Railway (Recommended)

The migrations are already defined in the schema. Deploy to Railway and they will run automatically:

```bash
# From project root
railway login
railway link
railway up
```

### Option B: Local Development

If you want to run migrations locally (not recommended for production):

```bash
# Set environment variables
export DATABASE_URL="postgresql://..."

# Run migrations
cd packages/infrastructure
pnpm prisma migrate deploy
```

## Step 3: Verify Schema

After migration, these tables should exist:

| Table | Purpose |
|-------|---------|
| `player_game_logs` | Stores individual game stats |
| `player_derived_stats` | Stores computed 7/14/30 day stats |
| `raw_ingestion_logs` | Audit trail for data sources |
| `verified_players` | Canonical player registry |

## Step 4: Run Ingestion Pipeline

### Test Mode (Dry Run)
```bash
cd /root/.openclaw/workspace/cbb-edge-analyzer
export DATABASE_URL="postgresql://..."
export BALLDONTLIE_API_KEY="ec48a218-d8eb-4de7-8388-1eef528c9e4e"

# Test with single player
npx tsx scripts/ingest-balldontlie.ts --dry-run --verbose --player=592450
```

### Full Ingestion
```bash
# Ingest all verified players
npx tsx scripts/ingest-balldontlie.ts --verbose
```

### Specific Players
```bash
npx tsx scripts/ingest-balldontlie.ts --player=592450 --player=677951 --verbose
```

## Step 5: Compute Derived Stats

### Test Mode
```bash
npx tsx scripts/compute-derived-stats.ts --dry-run --verbose --player=592450
```

### Full Computation
```bash
npx tsx scripts/compute-derived-stats.ts --verbose
```

## Pipeline Schedule (Railway)

Add these to your `railway.toml`:

```toml
[scheduler-balldontlie-ingest]
cron = "0 6 * * *"  # Daily at 6 AM
command = "npx tsx scripts/ingest-balldontlie.ts"

[scheduler-derived-stats]
cron = "0 7 * * *"  # Daily at 7 AM (after ingestion)
command = "npx tsx scripts/compute-derived-stats.ts"
```

## Troubleshooting

### "No players found"
- Run verified player sync first
- Or specify players with `--player=` flag

### "No games found"
- Check that player has games in the season
- API returns demo data (2024 season)

### Rate limit errors
- The adapter has built-in rate limiting
- Wait a minute and retry

### Database connection errors
- Verify DATABASE_URL is correct
- Check that Railway service is running

## Verification

After running the pipeline, verify data:

```sql
-- Check game logs
SELECT COUNT(*) FROM player_game_logs;
SELECT player_mlbam_id, COUNT(*) as games 
FROM player_game_logs 
GROUP BY player_mlbam_id 
LIMIT 10;

-- Check derived stats
SELECT * FROM player_derived_stats 
WHERE player_mlbam_id = '592450' 
ORDER BY computed_date DESC 
LIMIT 1;

-- Check for data gaps
SELECT player_mlbam_id, MIN(game_date), MAX(game_date), COUNT(*)
FROM player_game_logs
GROUP BY player_mlbam_id
HAVING COUNT(*) < 10;
```
