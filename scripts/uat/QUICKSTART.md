# Phase 1 UAT Quick Start Guide

## As a Fantasy Baseball Expert, Why This Matters

Your fantasy decisions are only as good as your data. If the system says Ohtani has 45 HRs but he actually has 43, you're making bad decisions. Phase 1 UAT ensures you can **trust what the system tells you**.

## The Five Pillars of Data Trust

### 1. Row Count Drift Detection 🧮
**What it checks:** Are we losing or duplicating records between pipeline stages?

**Fantasy impact:** If game logs disappear, your rolling 30-day stats are wrong. If duplicates exist, you're double-counting stats.

**Example failure:** 
- Raw API: 500 players
- Normalized table: 520 players  ← FAIL! Duplicates detected
- Game log table: 480 players  ← FAIL! Missing 20 players

**Exit criteria:** All counts match within 5% variance.

---

### 2. Duplicate Detection 👯
**What it checks:** Same player + same game = only ONE record allowed.

**Fantasy impact:** Duplicate game logs = inflated stats = overvaluing players in trades.

**Example failure:**
```
Player: Shohei Ohtani, Game: 2025-06-15
Record 1: 2-4, 1 HR, 3 RBI
Record 2: 2-4, 1 HR, 3 RBI  ← DUPLICATE! System counts as 4-8, 2 HR, 6 RBI
```

**Exit criteria:** Zero duplicates across all natural keys.

---

### 3. Stat Inflation Detection 📊
**What it checks:** Do game log aggregates match season totals?

**Fantasy impact:** If rolling calculations are wrong, you're dropping players on hot streaks or adding cold ones.

**Example failure:**
```
Player: Juan Soto
Game logs sum: 142 games
Season stats: 154 games  ← MISMATCH! Missing 12 games from logs
```

**Exit criteria:** Game log totals within 5% of official season stats.

---

### 4. Data Completeness ✅
**What it checks:** No missing games, no gaps in coverage.

**Fantasy impact:** Missing games = incomplete rolling averages = bad lineup decisions.

**Example failure:**
```
Player: Mike Trout
Last game in system: June 15
Today: July 1
Gap: 15 days with no games recorded  ← SUSPICIOUS
```

**Exit criteria:** All active players have recent data, no >30 day gaps without explanation.

---

### 5. Raw vs Normalized Reconciliation 🔗
**What it checks:** Raw data preserved, transformations correct.

**Fantasy impact:** If raw data is lost, you can't audit errors. If transformation is wrong, all derived stats are garbage.

**Example failure:**
```
Raw API: 3B = 2 (two triples)
Normalized: triples = 0  ← DATA CORRUPTION!
```

**Exit criteria:** 100% of sampled records reconcile, raw data preserved with audit trail.

---

## Running the Tests

### Full UAT Suite
```bash
npx tsx scripts/uat/run-all.ts --season 2025 --verbose
```

### Run Specific Category
```bash
# Just duplicates
npx tsx scripts/uat/run-all.ts --category duplicates

# Just stat inflation
npx tsx scripts/uat/run-all.ts --category stat_inflation
```

### Get JSON Report
```bash
npx tsx scripts/uat/run-all.ts --json > uat-report-2025.json
```

### Individual Validators
```bash
# Test specific concerns
npx tsx scripts/uat/validators/duplicate-detection.ts 2025
npx tsx scripts/uat/validators/stat-inflation.ts 2025
npx tsx scripts/uat/validators/completeness.ts 2025
```

---

## Interpreting Results

### Exit Codes
| Code | Meaning | Action |
|------|---------|--------|
| 0 | All clear ✅ | Deploy with confidence |
| 1 | Critical failure 🚨 | **DO NOT DEPLOY** - Data corruption detected |
| 2 | Warnings ⚠️ | Review before deploying |

### Severity Levels
- **CRITICAL:** Data corruption, duplicates, missing raw data → Blocks release
- **HIGH:** Row count drift, stat mismatches → Review required
- **MEDIUM:** Stale data, date gaps → Monitor closely
- **LOW:** Minor discrepancies → Acceptable for dev

---

## Red Flags Checklist

Before trusting your system, verify:

- [ ] No duplicate game logs (player + game combination)
- [ ] Game log aggregates match season stats
- [ ] Row counts stable across ingestion runs
- [ ] All active players have recent data
- [ ] Raw data preserved with audit trail
- [ ] No anomalous stat values (>180 games, >800 PA)
- [ ] Derived stats match source calculations

---

## When to Run UAT

### Mandatory
- 🚨 After any ingestion pipeline changes
- 🚨 After database migrations
- 🚨 Before fantasy season starts
- 🚨 After MLB API format changes

### Recommended
- ⚠️ Weekly during active season
- ⚠️ After bulk data imports
- ⚠️ When investigating player stat discrepancies

---

## Common Issues & Fixes

### Issue: "Game log table undercount"
**Cause:** Ingestion failed silently, or player ID mapping issues.
**Fix:** Re-run ingestion for affected players, check ID mapping.

### Issue: "Duplicate game log entries"
**Cause:** Upsert logic not matching on natural key correctly.
**Fix:** Check `playerMlbamId_gamePk` unique constraint.

### Issue: "Game log aggregates don't match season stats"
**Cause:** Missing games, or season stats include postseason.
**Fix:** Filter game logs by game type, verify date ranges.

### Issue: "Raw data not preserved"
**Cause:** Raw ingestion log not written before normalization.
**Fix:** Ensure `storeRawStats()` called before `normalizePlayerStats()`.

---

## Exit Criteria Summary

**You can trust the system when:**
1. ✅ Zero critical issues
2. ✅ All row counts match within 5%
3. ✅ Zero duplicates
4. ✅ Stat aggregates within 5% of source
5. ✅ 100% raw data preservation
6. ✅ All active players have data within 48 hours

**Then and only then** can you trust the system to tell you exactly what happened in MLB.
