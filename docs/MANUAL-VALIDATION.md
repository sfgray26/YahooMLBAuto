# Manual DB Validation — How-To Guide

This document explains how to trigger the **DB-backed manual validation workflow**,
how to download and inspect the produced artifacts, and what each artifact contains.

## Overview

The manual validation run (`validate:manual:db`) connects to a real PostgreSQL
database and runs the full pipeline layer validation:

| Layer | What it checks |
|-------|----------------|
| **Ingestion** | Player counts, game-log counts |
| **Derived stats** | Rate sanity, window monotonicity, missing values |
| **Scoring** | Value range [0-100], confidence range [0-1] |
| **Monte Carlo** | Distribution sanity (p10 ≤ p90), seed reproducibility |
| **Recommendations** | Ranking correctness, no duplicates, reason codes |

Artifacts are written to `artifacts/run-<timestamp>/` and uploaded as a GitHub
Actions artifact (30-day retention) for download.

---

## 1. Running from GitHub Actions (recommended)

### Prerequisites

Configure the **`DATABASE_URL`** secret in your repository:
1. Navigate to **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `DATABASE_URL`
4. Value: PostgreSQL connection string for the **production read-only replica**
   ```
   postgresql://user:password@host:5432/dbname?sslmode=require
   ```

> ⚠️ **Read-only replica strongly recommended.**  The validation script does
> not write to the database, but using a replica prevents any accidental load
> on your primary.

### Trigger the workflow

1. Go to **Actions** → **Manual DB Validation**
2. Click **Run workflow**
3. Fill in the optional inputs:

| Input | Description | Default |
|-------|-------------|---------|
| `season` | MLB season year (e.g. `2026`) | current year |
| `sample_size` | Players sampled per layer | `50` |
| `max_rows` | Max rows per artifact file | `500` |
| `environment` | Label (informational only) | `production-read-only-replica` |

4. Click **Run workflow**

### Download artifacts

After the run completes:
1. Go to the **Actions** tab → open the completed run
2. Scroll to the bottom → **Artifacts**
3. Download `db-validation-artifacts-<run_number>.zip`
4. Unzip and open the files inside `run-<timestamp>/`

---

## 2. Running locally

```bash
# Set environment variables
export DATABASE_URL="postgresql://user:pass@localhost:5432/cbb"
export ARTIFACTS_ENABLED=true
export ARTIFACT_DIR=artifacts        # optional, default: artifacts
export MAX_ARTIFACT_ROWS=500         # optional, default: 500
export VALIDATION_SEASON=2026        # optional, default: current year
export VALIDATION_SAMPLE=50          # optional, default: 50

# Run
pnpm validate:manual:db
```

Artifacts are written to `artifacts/run-<timestamp>/`.

---

## 3. Artifact file reference

Each run produces a directory `artifacts/run-<YYYY-MM-DD_HH-MM-SS>/` containing:

### `run-metadata.json`

Top-level provenance for the run:

```json
{
  "runId": "run-2026-04-08_14-00-00",
  "runTimestamp": "2026-04-08T14:00:00.000Z",
  "gitSha": "abc1234",
  "nodeEnv": "production",
  "maxRows": 500,
  "artifactDir": "artifacts",
  "layers": ["ingestion", "derived", "scoring", "monte-carlo", "recommendations"]
}
```

### `validation-report.json`

Overall pass/fail + per-layer summary:

```json
{
  "runId": "run-2026-04-08_14-00-00",
  "runTimestamp": "...",
  "overallPass": true,
  "totalErrors": 0,
  "totalWarnings": 2,
  "layers": [
    {
      "layer": "ingestion",
      "totalRecords": 1400,
      "sampledRecords": 50,
      "errorCount": 0,
      "warningCount": 0,
      "stats": { "totalPlayers": 350, "totalGameLogs": 1400 },
      "errors": [],
      "warnings": []
    }
  ]
}
```

> **Decision rule**: if `overallPass` is `false` (any layer has errors),
> investigate before trusting lineup/recommendation outputs.

### `<layer>-records.json`

Sampled raw records from that layer (up to `MAX_ARTIFACT_ROWS`). Use these
to spot-check individual player data.

### `<layer>-summary.json`

Aggregated stats for the layer — same as the entry in `validation-report.json`.

---

## 4. Layer-specific notes

### Ingestion
Checks that at least one player and game-log row exists for the season.
Sampled rows include: `playerMlbamId`, `gamePk`, `gameDate`, `plateAppearances`,
`atBats`, `hits`, `homeRuns`, `rbi`, `walks`, `strikeouts`.

### Derived stats
Checks rate ranges (AVG in [0,1], OPS in [0,5], etc.) and window monotonicity
(gamesLast30 ≥ gamesLast14 ≥ gamesLast7). Any `null` values for rate fields are
flagged in the summary.

### Scoring
Runs `scorePlayer()` on each sampled derived record. Checks:
- `overallValue` in [0, 100]
- `confidence` in [0, 1]

Records include `strengths[]` and `concerns[]` for explainability.

### Monte Carlo
Runs 500 trials per player with a fixed seed (`42`) for reproducibility.
Each record includes the full `runMetadata` (seed, gitSha, trial count,
timestamp) so outputs are fully auditable. Checks that `p10 ≤ p90`.

### Recommendations
Ranks players by `overallValue` descending. Each record includes `reasonCodes[]`
such as `ELITE_OVERALL`, `HIGH_CONFIDENCE`, `LOW_CONFIDENCE`.

---

## 5. Configuration reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `ARTIFACTS_ENABLED` | `true` (for this script) | Set `false` to skip writing files |
| `ARTIFACT_DIR` | `artifacts` | Base directory for output |
| `MAX_ARTIFACT_ROWS` | `500` | Max rows per layer file |
| `VALIDATION_SEASON` | current year | MLB season to validate |
| `VALIDATION_SAMPLE` | `50` | Players sampled per layer |

---

## 6. Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| `DATABASE_URL is not set` | Secret not configured | Add `DATABASE_URL` to repo secrets |
| `0 players in ingestion layer` | DB is empty or wrong season | Check `VALIDATION_SEASON` and DB contents |
| `overallPass: false` | Rate sanity errors in derived layer | Inspect `derived-summary.json → errors` |
| Missing artifact file | Layer was skipped due to empty data | Check prior layer summary for errors |
