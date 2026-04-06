# Time-Decay Architecture

## Overview

Time-decayed stats give more weight to recent games, making the system responsive to hot/cold streaks without overreacting to small samples.

## Formula

```
weighted_stat = Σ(stat_i × λ^Δt_i) / Σ(λ^Δt_i)
```

Where:
- `λ` (lambda) = decay constant (0.95 = ~14 day half-life)
- `Δt` = days ago
- Games are weighted by recency, then normalized

## Decay Modes

| Mode | Lambda | Half-Life | Use Case |
|------|--------|-----------|----------|
| `responsive` | 0.90 | 7 days | Hot/cold streak detection |
| `balanced` | 0.93 | 10 days | Default |
| `stable` | 0.95 | 14 days | Reliable trends |
| `very_stable` | 0.97 | 21 days | Season-long view |

## Implementation

```typescript
// In derived/fromGameLogs.ts
const DECAY_LAMBDA = 0.95;

function calculateDecayWeight(gameDate: Date, referenceDate: Date, lambda: number): number {
  const daysAgo = Math.floor((referenceDate - gameDate) / (1000 * 60 * 60 * 24));
  return Math.pow(lambda, Math.max(0, daysAgo));
}

// Weighted calculation
const weightedStat = games.reduce((acc, game) => {
  const weight = calculateDecayWeight(game.gameDate, referenceDate, lambda);
  return acc + (game.stat * weight);
}, 0) / totalWeight;
```

## Pipeline Integration

```
Raw Game Logs
     ↓
Time-Decayed Aggregation (λ=0.95)
     ↓
Rolling Stats (30/14/7 day windows)
     ↓
Z-Scores (League + Position context)
     ↓
Component Scores
     ↓
Confidence Regression
     ↓
Final Score (0-100)
```

## Usage

```typescript
// Enable time decay
const stats = await computeDerivedStatsFromGameLogs(
  playerId,
  playerMlbamId,
  season,
  {
    useTimeDecay: true,
    decayMode: 'stable'  // 14-day half-life
  }
);

// Or explicit lambda
const stats = await computeDerivedStatsFromGameLogs(
  playerId,
  playerMlbamId,
  season,
  {
    useTimeDecay: true,
    decayLambda: 0.93  // Custom decay
  }
);
```

## Example Impact

Player with declining performance:

| Game | Date | AVG (Game) | Weight (λ=0.95) | Weighted Contribution |
|------|------|------------|-----------------|----------------------|
| 1 | Today | 0.400 | 1.00 | 0.400 |
| 2 | -3 days | 0.300 | 0.86 | 0.258 |
| 3 | -7 days | 0.250 | 0.70 | 0.175 |
| 4 | -14 days | 0.200 | 0.49 | 0.098 |
| 5 | -21 days | 0.350 | 0.34 | 0.119 |

**Simple Average:** 0.300
**Time-Decayed:** 0.283 (closer to recent 0.250)

## Benefits

1. **Responsive:** Captures momentum/hot streaks
2. **Stable:** Normalized weights prevent overreaction
3. **Configurable:** Different decay rates for different use cases
4. **Consistent:** Same formula for hitters and pitchers

## Next Steps

1. Apply same decay logic to pitcher derived stats
2. Add volatility-adjusted decay (more decay for volatile players)
3. Expose decay mode in API for user preference
