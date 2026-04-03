# Phase 1 UAT: Foundation Integrity Tests

## Overview
This UAT suite validates that the data pipeline preserves factual truth about MLB events. As a fantasy baseball expert, you need to trust that the system tells you exactly what actually happened.

## Test Categories

### 1. Row Count Drift Detection
**Purpose:** Ensure no records are lost or duplicated between pipeline stages
**Red Flags:** 
- Raw ingest count ≠ Normalized count
- Game log count drift between ingestion runs
- Missing players from expected dataset

### 2. Duplicate Detection
**Purpose:** Verify no duplicate records exist based on natural keys
**Red Flags:**
- Duplicate game logs for same player+game
- Duplicate daily stats for same player+date+source
- Multiple raw ingestion logs for same cache key

### 3. Stat Inflation Detection
**Purpose:** Prevent double-counting by verifying aggregations match source
**Red Flags:**
- Season totals from game logs ≠ Season stats from API
- Rolling window sums inconsistent with game logs
- Player career totals drift over time

### 4. Missing Games Detection
**Purpose:** Ensure no games are skipped in game logs
**Red Flags:**
- Date gaps in player game logs
- Missing games for players who were active
- Incomplete team schedules

### 5. Raw vs Normalized Reconciliation
**Purpose:** Verify normalized data accurately reflects raw source
**Red Flags:**
- Stat values transformed incorrectly
- Player ID mismatches
- Team assignments wrong

## Exit Criteria
- ✅ Zero duplicates detected
- ✅ Row counts stable across pipeline stages
- ✅ Aggregated stats match source truth
- ✅ No missing games for tracked players
- ✅ Raw data preserved and auditable

## Usage

```bash
# Run all UAT tests
npx tsx scripts/uat/run-all.ts

# Run specific test category
npx tsx scripts/uat/validators/duplicate-detection.ts

# Run with verbose output
npx tsx scripts/uat/run-all.ts --verbose

# Generate report
npx tsx scripts/uat/run-all.ts --report > uat-report.json
```
