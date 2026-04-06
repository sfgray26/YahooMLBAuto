# Trade Evaluator

The Trade Evaluator is the top layer of the intelligence stack. It compares **World A** (current roster) vs **World B** (post-trade) using ROS simulations to compute:

- **Net trade value** - Overall value assessment
- **Category impact** - How the trade affects each scoring category
- **Risk profile** - Changes in volatility, floor, and ceiling
- **Roster construction** - Positional balance and flexibility

## Architecture

```
Trade Evaluator (Consumer Layer)
    │
    ├─→ World A Projection (current roster)
    │   └─→ Uses: Momentum + Probabilistic + Scoring
    │
    ├─→ World B Projection (post-trade roster)
    │   └─→ Uses: Momentum + Probabilistic + Scoring
    │
    └─→ Comparison & Recommendation
        ├─ Category deltas
        ├─ Risk deltas
        ├─ Roster impact
        └─ Final recommendation
```

## Usage

### Basic Trade Evaluation

```typescript
import { evaluateTrade, formatTradeEvaluation } from '@cba/worker';
import type { TradeProposal, TeamState } from '@cba/worker';

const trade: TradeProposal = {
  id: 'trade-123',
  proposedAt: new Date().toISOString(),
  yourTeamId: 'team-1',
  otherTeamId: 'team-2',
  otherTeamName: 'Other Team',
  playersYouGive: [{ playerId: '1', name: 'Aaron Judge', ... }],
  playersYouGet: [{ playerId: '2', name: 'Juan Soto', ... }],
};

const analysis = evaluateTrade(teamState, trade, {
  format: 'roto',
  riskTolerance: 'balanced',
});

console.log(formatTradeEvaluation(analysis, { format: 'text' }));
```

### Risk Tolerance Settings

```typescript
// Conservative - values floor outcomes
const conservative = evaluateTrade(teamState, trade, { 
  riskTolerance: 'conservative' 
});

// Aggressive - values ceiling outcomes
const aggressive = evaluateTrade(teamState, trade, { 
  riskTolerance: 'aggressive' 
});
```

### Monte Carlo Simulation

```typescript
import { simulateTradeScenarios } from '@cba/worker';

const simulation = simulateTradeScenarios(
  playersYouGive,
  playersYouGet,
  config,
  500  // number of runs
);

// Win probability
console.log(`Trade wins ${(simulation.winProbability * 100).toFixed(1)}% of simulations`);

// Outcome distribution
console.log(`P50 outcome: ${simulation.outcomeDistribution.p50.toFixed(1)}`);
```

## Output Format

### Text Format
```
╔════════════════════════════════════════╗
║                                        ║
║            LEAN ACCEPT                 ║
║                 +2.3                   ║
║                                        ║
╚════════════════════════════════════════╝

SUMMARY
----------------------------------------
Trade value: +2.3 points

KEY POINTS
----------------------------------------
  ✓ Improves projected standing by +3.2 category points
  ✓ Fills positional holes at: C, SS

CONCERNS
----------------------------------------
  ⚠ Increases roster volatility

CATEGORY IMPACT
----------------------------------------
Strengthens: HR, RBI; Weakens: SB

RISK IMPACT
----------------------------------------
Trade makes your roster riskier. Floor changes by -2.5, ceiling by +4.2

VERDICT
----------------------------------------
Overall score: +2.3. Recommendation: LEAN ACCEPT. Key benefits: Improves projected standing by +3.2 category points. Main concern: Increases roster volatility.
```

### Recommendation Scale

| Score | Recommendation | Action |
|-------|---------------|--------|
| ≥ +5.0 | `strong_accept` | Clear win, execute immediately |
| +2.0 to +5.0 | `lean_accept` | Probable win, favorable terms |
| -2.0 to +2.0 | `neutral` | Fair trade, no clear advantage |
| -5.0 to -2.0 | `lean_reject` | Probable loss, avoid |
| ≤ -5.0 | `hard_reject` | Clear loss, decline |

## CLI Usage

```bash
# Evaluate a trade
npx tsx trade-cli.ts --give "Judge,Strider" --get "Soto,Burnes"

# Verbose output
npx tsx trade-cli.ts -g "Judge" -r "Soto" -v

# Markdown format
npx tsx trade-cli.ts -g "Judge" -r "Soto" -f markdown

# Conservative risk tolerance
npx tsx trade-cli.ts -g "Volatile Player" -r "Stable Player" --risk conservative
```

## Testing

```bash
# Run trade evaluator tests
npx vitest run src/trade/evaluator.test.ts

# Run with coverage
npx vitest run src/trade/ --coverage
```

## Integration with Intelligence Stack

The Trade Evaluator is a **pure consumer** - it does not compute any intelligence itself but orchestrates the existing layers:

1. **Scoring Layer** - Provides player scores (0-100 scale)
2. **Momentum Layer** - Detects breakout/collapse trends
3. **Probabilistic Layer** - Generates ROS percentile distributions
4. **Lineup Layer** - Optimizes roster construction (optional)

This ensures the trade evaluator always uses the most current intelligence without duplicating logic.
