# Complete Fantasy Baseball Intelligence Architecture

## Final Architecture Stack

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         LAYER 9: API / UI                               │
│  - REST endpoints for recommendations                                   │
│  - Real-time lineup updates                                             │
│  - Visualization of intelligence signals                                │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 8: DECISIONS                                                     │
│  ┌─────────────────┬─────────────────┬─────────────────┐               │
│  │  Waiver Asm     │  Lineup Opt     │  Trade Eval     │               │
│  │  - Priority     │  - Constraints  │  - Value calc   │               │
│  │  - FAAB bids    │  - Greedy+swap  │  - Risk comps   │               │
│  └─────────────────┴─────────────────┴─────────────────┘               │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 7: PROBABILISTIC OUTCOMES (Monte Carlo)                          │
│  - 1000-run simulations                                                 │
│  - Percentile projections (10/25/50/75/90)                              │
│  - Risk profiles (volatility, VaR)                                      │
│  - P(top-10/25/50/100)                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 6: MOMENTUM DETECTION                                            │
│  - Z-score slope: ΔZ = Z_14d - Z_30d                                    │
│  - Trend classification (surging/hot/stable/cold/collapsing)            │
│  - Breakout detection (surge from low baseline)                         │
│  - Collapse warning (drop from high baseline)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 5: SCORING (Hitters + Pitchers with PARITY)                      │
│  ┌─────────────────────┐  ┌─────────────────────┐                       │
│  │      HITTERS        │  │     PITCHERS        │                       │
│  │  ┌───────────────┐  │  │  ┌───────────────┐  │                       │
│  │  │ Position-Adj  │  │  │  │ Time Decay    │  │                       │
│  │  │ Z-Scores      │  │  │  │ (λ=0.95)      │  │                       │
│  │  │ (70/30 blend) │  │  │  └───────────────┘  │                       │
│  │  └───────────────┘  │  │  ┌───────────────┐  │                       │
│  │  ┌───────────────┐  │  │  │ Confidence    │  │                       │
│  │  │ Confidence    │  │  │  │ Regression    │  │                       │
│  │  │ Regression    │  │  │  │ (sample-size) │  │                       │
│  │  │ (sample-size) │  │  │  └───────────────┘  │                       │
│  │  └───────────────┘  │  └─────────────────────┘                       │
│  └─────────────────────┘                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 4: DERIVED FEATURES                                              │
│  - Time-decayed rolling windows (7/14/30 day)                           │
│  - Formula: weighted = Σ(stat_i × λ^Δt_i) / Σ(λ^Δt_i)                   │
│  - λ = 0.95 (~14 day half-life)                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 3: IDENTITY RESOLUTION                                           │
│  - MLBAM ID verification                                                │
│  - Name matching                                                        │
│  - Gating before persistence                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 2: INGESTION                                                     │
│  - MLB Stats API integration                                            │
│  - Game log normalization                                               │
│  - Error handling & retry                                               │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 1: STORAGE                                                       │
│  - PostgreSQL (game logs, players, derived stats)                       │
│  - Redis (caching, sessions)                                            │
│  - External: MLB Stats API                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Lineup Optimizer Specification

### Objective Function

```
Objective = w₁·Score + w₂·ΔZ + w₃·RiskAdj + w₄·CategoryFit + w₅·Games

Where:
- Score      = 0-100 overall value
- ΔZ         = Momentum (Z_14d - Z_30d), normalized to 0-100
- RiskAdj    = Monte Carlo adjusted (p25/p50/p75 based on tolerance)
- CategoryFit = Team weakness matching
- Games      = This week's projected games (0-100)

Default weights:
- w₁ (Score)     = 0.40
- w₂ (Momentum)  = 0.15
- w₃ (Risk)      = 0.20
- w₄ (Category)  = 0.15
- w₅ (Schedule)  = 0.10
```

### Constraints (Hard Rules)

| Constraint | Rule | Violation |
|------------|------|-----------|
| Roster | Required positions filled | Illegal lineup |
| Eligibility | Player eligible at slot | Illegal assignment |
| Injury | IL players cannot start | Automatic bench |
| Schedule | 0 games = bench (weekly) | Automatic bench |
| Pitching | SP with starts > SP without | Priority rule |

### Algorithm

```
1. GREEDY FILL (scarce positions first)
   - C, SS, 2B, 3B (scarce)
   - 1B, OF (flexible)
   - UTIL (most flexible)
   - Pitching (SP, RP)

2. BACKTRACKING SWAPS
   - Try swapping each starter with bench
   - Accept if objective improves by >1
   - Max depth: 3 swaps

3. LOCK & EXPLAIN
   - Generate decision trace
   - Build human-readable explanation
   - Return optimized lineup
```

---

## Test Strategy Summary

### 1. Unit Tests (5 scenarios)
| Test | Scenario | Expected |
|------|----------|----------|
| Scarcity | Catcher 64 vs 1B 62 | C starts |
| Eligibility | 1B/3B vs 1B only | Multi fills 3B |
| Momentum | 68/+1.0 vs 72/-0.8 | Surging starts |
| Injury | Injured 85 vs healthy 55 | Healthy starts |
| Zero Games | 75/0 games vs 65/6 | With games starts |

### 2. Property Tests (5 invariants)
- Always produces legal lineup
- Never assigns player to multiple slots
- Never starts ineligible player
- Deterministic (same input → same output)
- Monotonic (higher score ≥ starting)

### 3. Scenario Tests (5 cases)
- Speed-starved team → prioritizes speed
- Pitching volume → 2-start SP preferred
- Breakout detection → surging player starts
- Late season conservative → prioritizes floor
- Playoffs aggressive → prioritizes ceiling

### 4. Regression Tests (2 snapshots)
- Early season: prioritizes large samples
- Playoffs: aggressive risk tolerance

---

## Key Intelligence Formulas

### Time Decay
```
weighted_stat = Σ(stat_i × λ^Δt_i) / Σ(λ^Δt_i)
λ = 0.95 (14-day half-life)
```

### Position-Adjusted Z-Score
```
Z_adj = 0.7 × Z_league + 0.3 × Z_position
Score = 50 + 10 × Z_adj
```

### Confidence Regression
```
FinalScore = (RawScore × Confidence) + (50 × (1 - Confidence))

Confidence levels:
- 120+ PA: 100%
- 80-119 PA: 90%
- 50-79 PA: 75%
- 30-49 PA: 60%
- <30 PA: 45%
```

### Momentum
```
ΔZ = Z_14d - Z_30d

Trend thresholds:
- Surging:   ΔZ ≥ 0.8
- Hot:       0.4 ≤ ΔZ < 0.8
- Stable:   -0.4 < ΔZ < 0.4
- Cold:     -0.8 < ΔZ ≤ -0.4
- Collapsing: ΔZ ≤ -0.8
```

### Monte Carlo
```
For 1000 simulations:
  For each week (12 weeks):
    - 5% injury risk
    - games ~ N(6, 1)
    - weeklyZ ~ N(trueTalentZ, weeklyStdDev)
    - cumulativeZ += weeklyZ × games
  finalScore = 50 + 10 × (cumulativeZ / totalGames)
```

---

## Status: Production Ready

| Layer | Status | Tests |
|-------|--------|-------|
| Time Decay | ✅ | Unit tests |
| Position Z-Scores | ✅ | Unit tests |
| Confidence Regression | ✅ | Unit tests |
| Hitter-Pitcher Parity | ✅ | Integration |
| Momentum Detection | ✅ | Unit + property |
| Monte Carlo | ✅ | Unit + property |
| Lineup Optimizer | ✅ | 17 test cases |

---

## Usage Examples

### Basic Lineup Optimization
```typescript
import { optimizeLineup } from './lineup';

const lineup = optimizeLineup(players, teamState, {
  weightMomentum: 0.20,
  riskTolerance: 'balanced',
});

console.log(lineup.explanation.summary);
// "Optimized lineup: 13 starters, 3 key decisions"
```

### Momentum Check
```typescript
import { calculateMomentum, formatMomentum } from './momentum';

const momentum = calculateMomentum(z14, z30, games14, games30);
console.log(formatMomentum(momentum));
// "🚀 SURGING ΔZ=+0.85 [high confidence] 🚨 BREAKOUT → BUY"
```

### Monte Carlo Projection
```typescript
import { simulatePlayerOutcomes, formatProbabilities } from './probabilistic';

const outcome = simulatePlayerOutcomes(playerScore);
console.log(formatProbabilities(outcome));
// Floor: 58/100 | Median: 72/100 | Ceiling: 85/100
// P(top-25): 40% | Risk: Medium
```

---

## Next Steps

1. **Backtesting**: Run historical simulations vs actual outcomes
2. **API Integration**: Expose endpoints for real-time optimization
3. **UI Visualization**: Show percentile ranges, trend arrows, risk meters
4. **Machine Learning**: Learn optimal weights from win/loss data
