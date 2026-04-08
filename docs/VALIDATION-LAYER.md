# Validation Layer

This document describes the data validation architecture built into the pipeline, the required columns for each dataset, and how to run validations and tests locally.

---

## Overview

The validation layer is a set of **pure, stateless functions** that check data quality at every stage of the pipeline:

```
Game Logs (ingest) ──► Normalization ──► Derived Features ──► Scoring ──► Monte Carlo
       │                    │                   │                │              │
  schema.ts            schema.ts           schema.ts        pipeline.ts   schema.ts +
  (row-level)          (row-level)         (row-level)      (aggregate)   MC output
```

All validators return a `SchemaValidationResult`:

```ts
interface SchemaValidationResult {
  valid: boolean;     // false if any error was found
  errors: string[];   // fatal issues that must be fixed before the data can proceed
  warnings: string[]; // non-fatal signals that may indicate data quality concerns
}
```

---

## Modules

### `apps/worker/src/validation/schema.ts`

Row-level validators and utilities covering:

| Function | Validates |
|---|---|
| `validateGameLogRow` | Single game-log entry (required fields, negative counts, PA/AB arithmetic, XBH consistency) |
| `detectDuplicateGameLogs` | Finds duplicate `(playerMlbamId, gamePk)` pairs in a batch |
| `validatePlayerRecord` | Player identity record (IDs present, MLBAM ID is numeric, positions are known codes) |
| `validateSlate` | Date range for a scoring period (valid dates, start ≤ end, span ≤ 30 days, IANA timezone) |
| `validateDerivedFeatures` | Derived stats record (volume counts non-negative, window monotonicity, rate ranges) |
| `detectMismatchedJoins` | Cross-dataset join integrity (finds players present in one dataset but not another) |
| `validateMonteCarloInputs` | MC input records (`overallValue` ∈ [0, 100], `confidence` ∈ [0, 1]) |
| `validateMonteCarloOutputs` | MC output records (percentile ordering, `runs` ≥ 1, seed recorded) |

### `apps/worker/src/validation/pipeline.ts`

Aggregate (run-level) validators that operate on summary stats rather than individual rows:

| Function | Validates |
|---|---|
| `validateIngestionResult` | Overall ingestion outcome (player count, game count, error rate) |
| `validateDerivedStatsResult` | Derived-stats computation outcome (processed count, error rate) |
| `validateDerivedRates` | Sample of hitter rate stats (ranges, OPS = OBP + SLG, ISO = SLG – AVG, window monotonicity) |
| `validatePitcherDerivedRates` | Sample of pitcher rate stats (ERA/WHIP ranges, K/BB formula, window monotonicity) |
| `validatePipelineRun` | Orchestrates all stage validators for a complete pipeline run |

### `apps/worker/src/logging/logger.ts`

Structured logger used throughout the pipeline:

```ts
import { logger } from './logging/logger.js';

logger.info('Ingesting game logs', { traceId, season });
logger.warn('No game logs found', { playerMlbamId });
logger.error('Database write failed', { error: err.message });

// Debug dump (only emitted when LOG_LEVEL=debug)
logger.dump('validated-player-pool', filteredPlayers);

// Create a child logger with a sub-label
const ingestLogger = logger.child('ingest');
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Minimum log level (`debug`, `info`, `warn`, `error`) |
| `LOG_JSON` | `false` | Set to `true` to emit newline-delimited JSON |

### `apps/worker/src/monte-carlo/metadata.ts`

Attaches provenance information to every simulation run:

```ts
interface RunMetadata {
  runTimestamp: string;  // ISO-8601 UTC
  seed: number;          // RNG seed used
  trialCount: number;    // Number of simulation trials
  horizon: 'daily' | 'weekly';
  gitSha: string | null; // from GIT_SHA env var
  dataVersion: string | null; // optional input-data version
}
```

The `runMetadata` field is included in every `PlayerOutcomeDistribution` returned by `simulatePlayerOutcome`. A human-readable summary is also appended to `simulationNotes`.

---

## Required Input Columns

### Game Log Row

| Column | Type | Required | Rules |
|---|---|---|---|
| `playerMlbamId` | `string` | ✅ | Non-empty |
| `gamePk` | `string` | ✅ | Non-empty |
| `gameDate` | `Date \| string` | ✅ | Must be parseable as a date |
| `season` | `number` | ✅ | 1876–(current year + 5) |
| `stats.atBats` | `number` | if present | ≥ 0 |
| `stats.hits` | `number` | if present | ≥ 0 |
| `stats.plateAppearances` | `number` | if present | ≥ 0 and ≥ `atBats` |
| `stats.totalBases` | `number` | if present | ≥ `hits` |
| `stats.homeRuns` | `number` | if present | ≥ 0 |
| `stats.doubles + triples + homeRuns` | composite | if all present | Must not exceed `hits` |

### Player Record

| Column | Type | Required | Rules |
|---|---|---|---|
| `playerId` | `string` | ✅ | Non-empty |
| `playerMlbamId` | `string` | ✅ | Non-empty, numeric digits only |
| `name` | `string` | ⚠️ warn | Non-empty (warning if missing) |
| `positions` | `string[]` | ⚠️ warn | Known MLB position codes |

### Derived Features

| Column | Type | Required | Rules |
|---|---|---|---|
| `playerId` | `string` | ✅ | Non-empty |
| `playerMlbamId` | `string` | ✅ | Non-empty |
| `volume.gamesLast7/14/30` | `number` | ✅ | ≥ 0, monotonic (30 ≥ 14 ≥ 7) |
| `volume.plateAppearancesLast7/14/30` | `number` | ✅ | ≥ 0, monotonic |
| `volume.atBatsLast30` | `number` | ✅ | ≥ 0 and ≤ `plateAppearancesLast30` |
| `rates.battingAverageLast30` | `number \| null` | if present | [0, 1] |
| `rates.onBasePctLast30` | `number \| null` | if present | [0, 1] |
| `rates.sluggingPctLast30` | `number \| null` | if present | [0, 4] |
| `rates.opsLast30` | `number \| null` | if present | [0, 5] |
| `rates.isoLast30` | `number \| null` | if present | [0, 3] |
| `rates.walkRateLast30` | `number \| null` | if present | [0, 1] |
| `rates.strikeoutRateLast30` | `number \| null` | if present | [0, 1] |
| `rates.babipLast30` | `number \| null` | if present | [0, 1] |

### Monte Carlo Output

| Column | Type | Required | Rules |
|---|---|---|---|
| `playerId` | `string` | ✅ | Non-empty |
| `playerMlbamId` | `string` | ✅ | Non-empty |
| `runs` | `number` | ✅ | ≥ 1 |
| `seed` | `number` | ✅ | Non-zero (warn if 0) |
| `expectedValue` | `number` | ✅ | [0, 200] |
| `p10` | `number` | ✅ | ≤ `p50` |
| `p50` | `number` | ✅ | ≤ `p90` |
| `p90` | `number` | ✅ | — |

---

## Running Validations and Tests

### Unit & Integration Tests

```bash
# From the repo root (Turborepo)
pnpm test

# From the worker package directly
cd apps/worker
pnpm test
```

Tests are powered by [Vitest](https://vitest.dev/) and require no database connection or external API access.

Key test files:

| File | What it covers |
|---|---|
| `src/validation/schema.test.ts` | Unit tests for every function in `schema.ts` |
| `src/validation/integration.test.ts` | End-to-end: fixture dataset through ingestion → derived → Monte Carlo |
| `src/validation/pipeline.test.ts` | Aggregate pipeline-run validators (hitter & pitcher rates) |
| `src/scoring/compute.test.ts` | Player scoring layer (pure function tests) |
| `src/lineup/__tests__/optimizer.test.ts` | Lineup optimizer (eligibility, scarcity, determinism) |

### Scoring Validation (Pure Function, No DB)

```bash
pnpm validate:scoring
```

### Derived-Layer Validation (Requires PostgreSQL)

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname pnpm validate:derived
```

### Pipeline-Level Validation (Post-Run)

The `validatePipelineRun` function is called automatically at the end of every scheduled pipeline run. Results are logged as structured JSON when `LOG_JSON=true`.

To run it manually against the current database:

```bash
cd apps/worker
LOG_LEVEL=debug tsx src/score.ts  # triggers validation at the end
```

---

## Monte Carlo Reproducibility

Every simulation run uses a **deterministic seed**:

1. If `config.randomSeed` is provided, it is used directly.
2. Otherwise, a seed is derived from the player's MLBAM ID, player ID, horizon, trial count, overall score, and confidence.

This ensures that:
- The same inputs always produce the same distribution metrics.
- Runs can be compared across pipeline versions by fixing the seed.
- Seeds are recorded in `runMetadata.seed` and in `simulationNotes`.

To override the global seed for a batch run:

```ts
simulatePlayerOutcomes(inputs, { runs: 10_000, horizon: 'daily', randomSeed: 42 });
```

To set the git SHA provenance (e.g. in CI):

```bash
GIT_SHA=$(git rev-parse --short HEAD) node dist/worker.js
```

---

## Extending the Validation Layer

To add a new validator:

1. Add a function to `apps/worker/src/validation/schema.ts` returning `SchemaValidationResult`.
2. Add corresponding tests to `apps/worker/src/validation/schema.test.ts`.
3. Call the validator at the appropriate pipeline stage and act on errors (e.g. skip invalid rows, abort the run).
4. Update this document with the new required columns.
