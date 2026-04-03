# Phase 1 UAT: Foundation Integrity - Complete

## Executive Summary

As a fantasy baseball expert, you need to trust that your data pipeline tells the **absolute truth** about what happened in MLB games. Phase 1 UAT validates that foundational trust.

## What's Been Built

### 📁 File Structure
```
scripts/uat/
├── README.md                    # Overview and usage
├── QUICKSTART.md               # Fantasy baseball expert guide
├── PHASE1_UAT_SUMMARY.md       # This file
├── types.ts                    # TypeScript interfaces
├── run-all.ts                  # Main UAT runner
└── validators/
    ├── index.ts               # Validator exports
    ├── row-count-drift.ts     # Row count validation
    ├── duplicate-detection.ts # Duplicate detection
    ├── stat-inflation.ts      # Stat accuracy validation
    ├── completeness.ts        # Data completeness
    └── reconciliation.ts      # Raw vs normalized checks
```

## The 5 Pillars of Foundation Integrity

### 1. Row Count Drift Detection 🧮
**Tests:**
- `checkRawToNormalizedDrift` - Compares record counts across pipeline stages
- `checkIngestionStability` - Validates counts are stable across runs
- `checkPlayerCoverage` - Ensures all active players have data

**Red Flags:**
- Raw: 500 players → Normalized: 520 players (5% variance)
- Game log table < 95% of raw game logs
- <50% of verified active players have stats

### 2. Duplicate Detection 👯
**Tests:**
- `checkDuplicateGameLogs` - Natural key: playerMlbamId + gamePk
- `checkDuplicateDailyStats` - Natural key: playerMlbamId + statDate + source
- `checkDuplicateRawIngestion` - Natural key: cacheKey
- `checkDuplicateVerifiedPlayers` - Primary key: mlbamId
- `checkDuplicateDerivedStats` - Natural key: playerMlbamId + computedDate

**Red Flags:**
- ANY duplicate records found
- More than 0 duplicates = immediate release block

### 3. Stat Inflation Detection 📊
**Tests:**
- `checkGameLogAggregation` - Game log sums match season stats
- `checkDerivedStatsAccuracy` - Derived features match source
- `checkAnomalousStats` - Impossible values (>180 games, >800 PA)

**Red Flags:**
- Game log aggregate differs from season stats by >5%
- Derived gamesLast30 differs from actual by >2 games
- Anomalous stat values indicating double counting

### 4. Data Completeness ✅
**Tests:**
- `checkDateGaps` - No >30 day unexplained gaps
- `checkMissingPlayers` - Expected players have data
- `checkDataFreshness` - Data within 48 hours
- `checkTeamScheduleCompleteness` - Teams have adequate coverage

**Red Flags:**
- Active players missing from game logs
- Data stale by >48 hours during season
- Teams with <20 games recorded

### 5. Raw vs Normalized Reconciliation 🔗
**Tests:**
- `checkRawToNormalizedReconciliation` - Values match after transformation
- `checkGameLogTraceability` - All records have source attribution
- `checkDerivedFeatureReconciliation` - Derived stats match calculations
- `checkRawDataPreservation` - Raw payloads stored and accessible

**Red Flags:**
- Stat values changed during normalization
- Missing raw data source attribution
- Raw payload not preserved

## Usage

### Run Full UAT Suite
```bash
pnpm uat --season 2025
# or
pnpm uat:verbose
# or
pnpm uat:json > report.json
```

### Run Individual Category
```bash
npx tsx scripts/uat/run-all.ts --category duplicates
npx tsx scripts/uat/run-all.ts --category stat_inflation
```

### Run Individual Validators
```bash
npx tsx scripts/uat/validators/duplicate-detection.ts 2025
npx tsx scripts/uat/validators/stat-inflation.ts 2025
npx tsx scripts/uat/validators/completeness.ts 2025
```

## Exit Criteria Checklist

Before trusting your system:

- [ ] **Zero Critical Issues** - All critical severity tests pass
- [ ] **Row Count Consistency** - <5% variance across pipeline stages
- [ ] **Zero Duplicates** - No duplicate records on natural keys
- [ ] **Stat Accuracy** - Game log aggregates match season stats within 5%
- [ ] **Data Freshness** - All data within 48 hours during active season
- [ ] **Raw Preservation** - 100% raw data preserved with audit trail
- [ ] **Player Coverage** - >80% of verified active players have data
- [ ] **No Anomalies** - No impossible stat values detected

## Exit Codes

| Code | Meaning | Fantasy Impact |
|------|---------|----------------|
| 0 | ✅ All clear | Deploy with confidence |
| 1 | 🚨 Critical failure | **DO NOT USE** - Data corruption detected |
| 2 | ⚠️ Warnings | Review before trusting |

## When to Run

### Mandatory
- After any pipeline code changes
- After database schema changes
- Before fantasy season starts
- After MLB API changes

### Recommended
- Weekly during active MLB season
- After any bulk data operations
- When investigating stat discrepancies

## Sample Output

```
======================================================================
  PHASE 1 UAT REPORT - FOUNDATION INTEGRITY
  MLB Season: 2025
======================================================================

📊 SUMMARY

   Total Tests:  20
   ✅ Passed:     20
   ❌ Failed:     0
   ⚠️  Warnings:   0

✅ SYSTEM TRUSTED
The system accurately reflects what happened in MLB.
You can proceed with confidence.
```

## Integration with CI/CD

Add to your deployment pipeline:

```yaml
# .github/workflows/deploy.yml
- name: Run Phase 1 UAT
  run: pnpm uat --season 2025
  
- name: Check UAT Results
  run: |
    if [ $? -eq 1 ]; then
      echo "Critical UAT failures detected. Blocking deployment."
      exit 1
    fi
```

## Next Steps (Phase 2)

After Foundation Integrity is validated:

1. **Derived Feature Validation** - Validate rolling 7/14/30 calculations
2. **Projection Accuracy** - Compare projections to actual outcomes
3. **Decision Quality** - Backtest lineup/waiver recommendations
4. **Performance Attribution** - Measure ROI of system recommendations

---

## As a Fantasy Baseball Expert...

This UAT answers the most important question:

> **"Can I trust what this system tells me about player performance?"**

When Phase 1 UAT passes:
- ✅ Your player stats reflect actual MLB events
- ✅ Your rolling averages are calculated from complete data
- ✅ Your waiver recommendations are based on accurate information
- ✅ You can make fantasy decisions with confidence

When Phase 1 UAT fails:
- 🚨 Your rankings might be based on incomplete data
- 🚨 You might drop a player on a hot streak due to missing games
- 🚨 You might add a player whose stats are inflated by duplicates

**Trust the system only when UAT passes.**
