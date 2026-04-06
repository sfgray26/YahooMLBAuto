# Architecture Layer Validation

## Layer Stack (Bottom to Top)

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 7: DECISIONS (waiverAssembly, lineupAssembly)            │
│  - Takes: TeamState + Scored Players                            │
│  - Outputs: Recommendations with reasoning                      │
│  - Pure: Yes (deterministic given TeamState)                    │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 6: SCORING (compute.ts)                                  │
│  - Takes: DerivedFeatures                                       │
│  - Outputs: PlayerScore (0-100 + components)                    │
│  - Pure: Yes (Z-score based, deterministic)                     │
│  - ✅ VALIDATED: Z-score + confidence regression working        │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 5: DERIVED FEATURES (fromGameLogs.ts)                    │
│  - Takes: Raw game logs                                         │
│  - Outputs: Rolling windows (30/14/7 day stats)                 │
│  - Pure: Yes (aggregation only)                                 │
│  - ✅ VALIDATED: Corrupt data fixed, pitcher handling correct   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 4: IDENTITY RESOLUTION (playerIdentity.ts)               │
│  - Takes: Raw player references                                 │
│  - Outputs: Verified player records                             │
│  - Pure: Yes (lookup-based)                                     │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: INGESTION (mlbStatsApi.ts)                            │
│  - Takes: MLB API responses                                     │
│  - Outputs: Normalized game logs                                │
│  - Pure: No (has side effects - DB writes)                      │
│  - Gated: Yes (verification before persistence)                 │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: RAW STORAGE (PostgreSQL)                              │
│  - Game logs, player identities, derived stats                  │
│  - Source of truth for all downstream layers                    │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1: EXTERNAL APIs (MLB Stats API)                         │
│  - Source data                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Principles

1. **Layer N only depends on Layer N-1** - No skipping layers
2. **Upper layers are pure functions** - Deterministic, testable, cacheable
3. **Lower layers handle side effects** - I/O, external APIs, persistence
4. **TeamState is the context boundary** - All decisions require TeamState

## Current Validation Status

| Layer | Status | Notes |
|-------|--------|-------|
| Ingestion | ⚠️ | Needs periodic refresh from MLB API |
| Identity | ✅ | Verification gates working |
| Derived | ✅ | Fixed corruption, pitchers handled |
| Scoring | ✅ | Z-scores + confidence regression |
| Decisions | 🔄 | Ready for integration testing |

## Next Steps

1. **Decision Layer Testing** - Validate waiver recommendations with mock TeamState
2. **End-to-End Integration** - Full pipeline from ingestion → decision
3. **Performance Testing** - Batch scoring 1000+ players
4. **Monitoring** - Alert on score anomalies
