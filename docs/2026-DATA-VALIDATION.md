# 2026 MLB Data Validation Summary

**Date:** April 3, 2026  
**Status:** ⚠️ 2026 Data Not Available - Using 2025 as Primary Season

## Key Findings

### Balldontlie API Behavior
When requesting **2026 season** data from balldontlie API:
- API returns **100 games per player**
- However, game dates are from **2022-2024** (historical data)
- **Zero actual 2026 games** found in the returned data

### Test Results

| Player | 2025 Games | 2026 Games | Actual 2026 Games | Date Range (2026 Request) |
|--------|-----------|-----------|-------------------|---------------------------|
| Aaron Judge | 100 | 100 | **0** | 2022-08-27 to 2024-10-31 |
| Bobby Witt Jr. | 100 | 100 | **0** | 2022-08-27 to 2024-10-31 |
| Jeremy Peña | 100 | 100 | **0** | 2022-08-27 to 2024-10-31 |

## Root Cause

The balldontlie API appears to:
1. Not have actual 2026 season data yet (season started ~March 27, 2026)
2. Return fallback/historical data instead of empty results for invalid seasons
3. Not validate that returned games match the requested season parameter

## Current Configuration

All API routes and ingestion scripts now default to **2025**:

```typescript
// API routes (admin.ts, monte-carlo.ts, trade.ts)
const season = 2025; // Primary season with available data

// Ingestion script (ingest-balldontlie.ts)
const season = 2025; // NOTE: 2026 data not available from API
```

## Impact on Intelligence Stack

| Layer | Impact | Status |
|-------|--------|--------|
| Ingestion | Using 2025 data | ✅ Operational |
| Identity | No changes needed | ✅ Operational |
| Derived | Computing from 2025 game logs | ✅ Operational |
| Scoring | 2025-based scores | ✅ Operational |
| Momentum | 2025 trend detection | ✅ Operational |
| Probabilistic | 2025 ROS projections | ✅ Operational |
| Trade | World comparisons using 2025 baselines | ✅ Operational |

## Migration Plan to 2026

When 2026 data becomes available:

1. **Verify API Data Quality**
   ```bash
   npx tsx scripts/check-2026-data.ts
   ```

2. **Update Season Constants** (single source of truth recommended):
   - `scripts/ingest-balldontlie.ts`
   - `apps/api/src/routes/admin.ts`
   - `apps/api/src/routes/monte-carlo.ts`
   - `apps/api/src/routes/trade.ts`
   - `apps/worker/src/handlers/waiver.ts`

3. **Re-ingest Game Logs**
   ```bash
   pnpm data:ingest
   ```

4. **Recompute Derived Stats**
   ```bash
   pnpm data:compute
   ```

5. **Validate Pipeline**
   ```bash
   pnpm uat:simple
   ```

## Monitoring

To check 2026 data availability periodically:

```bash
# Run validation script
$env:BALLDONTLIE_API_KEY="your_key"; npx tsx scripts/check-2026-data.ts
```

Look for:
- `Actual 2026 games: >0` (currently shows 0)
- Date range containing 2026 dates

## Recommendation

**Continue using 2025 data** until balldontlie API returns actual 2026 games. The 2025 season data provides:
- Complete game logs for accurate derived stats
- Reliable momentum calculations
- Valid ROS projections
- Sound trade evaluations

Switching to 2026 prematurely would result in:
- Missing/inaccurate player statistics
- Broken momentum detection
- Invalid trade recommendations
- Incorrect ROS projections
