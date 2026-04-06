# Intelligence Layers Summary

## Complete Architecture Stack

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 8: DECISIONS (waiverAssembly, lineupAssembly)            │
│  - Consumes all intelligence signals                            │
│  - Outputs actionable recommendations                           │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 7: PROBABILISTIC OUTCOMES (Monte Carlo)                  │
│  - 1000-run simulations                                         │
│  - Percentile projections (10th/50th/90th)                      │
│  - Risk profiles (volatility, downside/upside)                  │
│  - Probability of top-10/25/50/100 value                        │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 6: MOMENTUM DETECTION                                    │
│  - Z-score slope: ΔZ = Z_14d - Z_30d                            │
│  - Trend classification (surging/hot/stable/cold/collapsing)    │
│  - Breakout detection (surge from low baseline)                 │
│  - Collapse warning (drop from high baseline)                   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 5: SCORING (Hitters + Pitchers)                          │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │   HITTERS   │  │  PITCHERS   │                               │
│  │  ┌───────┐  │  │  ┌───────┐  │                               │
│  │  │Pos-   │  │  │  │Time   │  │                               │
│  │  │Adj Z │  │  │  │Decay  │  │                               │
│  │  └───────┘  │  │  └───────┘  │                               │
│  │  ┌───────┐  │  │  ┌───────┐  │                               │
│  │  │Conf.  │  │  │  │Conf.  │  │                               │
│  │  │Regr.  │  │  │  │Regr.  │  │                               │
│  │  └───────┘  │  │  └───────┘  │                               │
│  └─────────────┘  └─────────────┘                               │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 4: DERIVED FEATURES                                      │
│  - Time-decayed rolling windows (7/14/30 day)                   │
│  - Formula: weighted = Σ(stat_i × λ^Δt_i) / Σ(λ^Δt_i)           │
│  - λ = 0.95 (~14 day half-life)                                 │
├─────────────────────────────────────────────────────────────────┤
│  LOWER LAYERS (Ingestion, Storage, External APIs)               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 6: Momentum Detection

### Formula
```
ΔZ = Z_14d - Z_30d
```

### Thresholds
| ΔZ Range | Trend | Emoji |
|----------|-------|-------|
| ≥ 0.8 | Surging | 🚀 |
| 0.4 to 0.8 | Hot | 🔥 |
| -0.4 to 0.4 | Stable | ➡️ |
| -0.8 to -0.4 | Cold | ❄️ |
| ≤ -0.8 | Collapsing | 📉 |

### Signals
- **Breakout**: ΔZ ≥ 0.6 AND Z_30d ≤ 0.5 AND Z_14d ≥ 0.8
- **Collapse**: ΔZ ≤ -0.6 AND Z_30d ≥ 0.8 AND Z_14d ≤ 0.3

### Usage
```typescript
import { calculateMomentum, formatMomentum } from './momentum';

const momentum = calculateMomentum(zScore14d, zScore30d, games14d, games30d);
console.log(formatMomentum(momentum));
// "🚀 SURGING ΔZ=+0.85 [high confidence] → BUY"
```

---

## Layer 7: Probabilistic Outcomes (Monte Carlo)

### Simulation Model
```
For each simulation (1000 runs):
  For each week (12 weeks):
    - 5% injury risk
    - games ~ N(6, 1)
    - weeklyZ ~ N(trueTalentZ, weeklyStdDev)
    - cumulativeZ += weeklyZ × games
  finalScore = 50 + 10 × (cumulativeZ / totalGames)
```

### Outputs
```typescript
interface ProbabilisticOutcome {
  rosScore: {
    p10: number;   // Floor
    p50: number;   // Median
    p90: number;   // Ceiling
  };
  probTop10: number;   // e.g., 0.15 = 15% chance
  probTop25: number;
  probTop50: number;
  probTop100: number;
  probReplacement: number;
  riskProfile: {
    volatility: 'low' | 'medium' | 'high' | 'extreme';
    downsideRisk: number;    // P(waiver-wire value)
    upsidePotential: number; // P(top-50)
  };
  valueAtRisk: {
    worstCase: number;      // 5th percentile
    expectedCase: number;   // 50th percentile
    bestCase: number;       // 95th percentile
  };
}
```

### Usage
```typescript
import { simulatePlayerOutcomes, formatProbabilities } from './probabilistic';

const outcome = simulatePlayerOutcomes(playerScore, {
  simulations: 1000,
  weeksRemaining: 12,
  regressionToMean: true,
});

console.log(formatProbabilities(outcome));
```

---

## Combined Intelligence Example

### Scenario: Breakout Candidate
```
Player Profile:
- Current Score: 68/100
- Z_14d: 1.2 (hot recently)
- Z_30d: 0.2 (was mediocre)
- Games: 12 (14d), 25 (30d)

MOMENTUM ANALYSIS:
  ΔZ = +1.0 🚀 SURGING
  BREAKOUT DETECTED
  Recommendation: BUY

MONTE CARLO SIMULATION:
  ROS Projection: 65/100 (median)
  Range: 52 - 78/100
  Top 25 Probability: 35%
  Risk: Medium

COMBINED INTELLIGENCE:
  🏆 AGGRESSIVE ADD
  High upside with momentum
```

### Scenario: Collapse Warning
```
Player Profile:
- Current Score: 62/100
- Z_14d: 0.1 (cold recently)
- Z_30d: 1.5 (was elite)
- Games: 10 (14d), 28 (30d)

MOMENTUM ANALYSIS:
  ΔZ = -1.4 📉 COLLAPSING
  COLLAPSE WARNING
  Recommendation: SELL

MONTE CARLO SIMULATION:
  ROS Projection: 48/100 (median)
  Range: 35 - 61/100
  Replacement Probability: 25%
  Risk: High

COMBINED INTELLIGENCE:
  🏆 SELL NOW
  Collapse likely
```

---

## Key Features

### 1. Position-Adjusted Scoring
- 70% league context + 30% position context
- Catchers/SS get +5-8 point premium
- DH gets -2 point penalty

### 2. Confidence Regression
- Large sample (120+ PA): 100% confidence
- Small sample (30-49 PA): 60% confidence
- Regresses toward league average (50)

### 3. Time Decay
- λ = 0.95 (14-day half-life)
- Recent games weighted more heavily
- Responsive to hot/cold streaks

### 4. Momentum Detection
- Z-score slope reveals trends
- Breakout/collapse signals
- Actionable recommendations

### 5. Monte Carlo Simulation
- 1000-run rest-of-season projections
- Percentile outcomes
- Risk quantification

---

## Decision Matrix

| Momentum | Monte Carlo | Combined Action |
|----------|-------------|-----------------|
| Breakout + High Upside | P(top-25) > 30% | AGGRESSIVE ADD |
| Stable + Low Risk | P(replacement) < 10% | SAFE HOLD |
| Collapse + High Waiver Risk | P(replacement) > 20% | SELL NOW |
| Surging + High Variance | Volatility = 'high' | SPECULATIVE ADD |
| Cold + Low Upside | P(top-50) < 30% | AVOID |

---

## Status

✅ **IMPLEMENTED**
- Position-adjusted Z-scores
- Confidence regression
- Time decay (λ=0.95)
- Momentum detection (ΔZ)
- Monte Carlo simulation
- Probabilistic outcomes

🔄 **READY FOR INTEGRATION**
- Waiver decision assembly
- Lineup optimization
- Trade evaluation
