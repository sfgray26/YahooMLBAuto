# Backtesting Quick Reference

## Installation & Setup

```typescript
// The backtesting module is part of the worker package
import {
  quickBacktest,
  loadHistoricalSeason,
  BacktestSimulator,
  NaiveBaseline,
  HumanHeuristicBaseline,
} from './backtest';
```

## Quick Start

### Run a Complete Backtest
```typescript
const results = await quickBacktest({
  season: 2024,
  teamId: 'my-team-id',
  leagueId: 'my-league-id',
  weeklyMode: true,  // false for daily leagues
  baselines: ['naive', 'human'],  // which baselines to compare
  verbose: true,
});

// View the report
console.log(results.report.summary.overallPerformance);
// "Optimizer: 145-89-6 (61.4% win rate)"

// View baseline comparisons
for (const baseline of results.report.baselineReports) {
  console.log(`${baseline.baselineName}: ${baseline.headToHead}`);
}
```

## Step-by-Step Usage

### 1. Load Historical Data
```typescript
const worldStates = await loadHistoricalSeason(
  2024,           // season year
  'team-id',      // your team ID
  'league-id',    // league ID
  true            // weekly mode
);

// worldStates is an array of WorldState, one per week
console.log(`Loaded ${worldStates.length} weeks of data`);
```

### 2. Configure Simulator
```typescript
const simulator = new BacktestSimulator({
  season: 2024,
  teamId: 'my-team',
  leagueId: 'my-league',
  weeklyMode: true,
  baselines: [
    NaiveBaseline,           // Highest raw scores
    HumanHeuristicBaseline,  // Basic rules (avoid injuries, etc.)
  ],
  verbose: true,
});
```

### 3. Run Simulation
```typescript
const { steps, metrics, report, golden } = await simulator.runSimulation(worldStates);

// steps: Array of SimulationStep (one per week)
// metrics: BacktestMetrics (aggregated performance)
// report: BacktestReport (formatted summary)
// golden: GoldenBaseline (for regression testing)
```

### 4. Analyze Results

#### View Summary
```typescript
console.log(report.summary.overallPerformance);
console.log(report.summary.vsBaselines);
```

#### View Metrics
```typescript
console.log(`Decision Accuracy: ${(metrics.decisionAccuracy.accuracy * 100).toFixed(1)}%`);
console.log(`Momentum Accuracy: ${(metrics.momentumAccuracy.correctDirection * 100).toFixed(1)}%`);
console.log(`Monte Carlo Calibration: ${metrics.monteCarloCalibration.calibrationScore.toFixed(0)}/100`);
```

#### View Baseline Comparisons
```typescript
for (const [name, comparison] of Object.entries(metrics.baselineComparisons)) {
  console.log(`${name}:`);
  console.log(`  Record: ${comparison.optimizerWins}-${comparison.baselineWins}-${comparison.ties}`);
  console.log(`  Value Added: ${comparison.totalValueAdded.toFixed(1)} points`);
}
```

### 5. Export Reports

```typescript
import { ReportGenerator } from './backtest';

const generator = new ReportGenerator(2024, steps, metrics);

// Text format (console-friendly)
console.log(generator.formatAsText(report));

// JSON format (for storage)
fs.writeFileSync('backtest-report.json', generator.exportAsJSON(report));

// CSV format (for spreadsheets)
fs.writeFileSync('backtest-weekly.csv', generator.exportAsCSV(report));
```

## Common Use Cases

### Validate a New Feature
```typescript
// Run backtest with and without new feature
const withFeature = await quickBacktest({
  season: 2024,
  teamId: 'my-team',
  baselines: ['naive'],
  // new feature enabled by default
});

const withoutFeature = await quickBacktest({
  season: 2024,
  teamId: 'my-team',
  baselines: ['naive'],
  // disable new feature in config
});

// Compare
const delta = withFeature.metrics.totalCategoryPoints - 
              withoutFeature.metrics.totalCategoryPoints;

console.log(`New feature added ${delta.toFixed(1)} category points`);
```

### Check for Regressions
```typescript
import { GoldenBaselineManager } from './backtest';

const goldenManager = new GoldenBaselineManager();

// Compare current results to golden baseline
const { matches, regressions } = goldenManager.compareToGoldenBaseline(
  steps,
  storedGoldenBaseline
);

if (!matches) {
  console.error('REGRESSIONS DETECTED:');
  for (const regression of regressions) {
    console.error(`  - ${regression}`);
  }
  process.exit(1);
}
```

### Analyze Specific Weeks
```typescript
// Find best and worst weeks
const sortedByScore = [...steps].sort((a, b) => 
  b.actualOutcomes['optimizer'].totalPoints - 
  a.actualOutcomes['optimizer'].totalPoints
);

console.log('Best week:', sortedByScore[0].date);
console.log('Worst week:', sortedByScore[sortedByScore.length - 1].date);

// Analyze decisions in best week
for (const decision of sortedByScore[0].optimizerDecisions) {
  console.log(`${decision.action}: ${decision.playerName}`);
  console.log(`  Reason: ${decision.reasoning}`);
}
```

### Momentum Validation
```typescript
// Check how often momentum predictions were correct
let correct = 0;
let total = 0;

for (const step of steps) {
  for (const player of step.worldState.roster.players) {
    if (!player.momentum) continue;
    
    total++;
    
    // Predicted trend
    const predicted = player.momentum.trend;
    
    // Actual performance
    const outcome = step.actualOutcomes['optimizer'].playerOutcomes.find(
      p => p.playerId === player.playerId
    );
    
    if (outcome) {
      const actual = outcome.fantasyPoints > 15 ? 'hot' : 
                     outcome.fantasyPoints < 5 ? 'cold' : 'neutral';
      
      if ((predicted === 'hot' && actual === 'hot') ||
          (predicted === 'cold' && actual === 'cold') ||
          (predicted === 'stable' && actual === 'neutral')) {
        correct++;
      }
    }
  }
}

console.log(`Momentum accuracy: ${(correct / total * 100).toFixed(1)}%`);
```

### Monte Carlo Calibration
```typescript
// Check if Monte Carlo percentiles are well-calibrated
let p10Count = 0;
let p50Count = 0;
let p90Count = 0;
let total = 0;

for (const step of steps) {
  for (const player of step.worldState.roster.players) {
    if (!player.probabilistic) continue;
    
    const outcome = step.actualOutcomes['optimizer'].playerOutcomes.find(
      p => p.playerId === player.playerId
    );
    
    if (outcome) {
      total++;
      
      if (outcome.fantasyPoints >= player.probabilistic.rosScore.p10) p10Count++;
      if (outcome.fantasyPoints >= player.probabilistic.rosScore.p50) p50Count++;
      if (outcome.fantasyPoints <= player.probabilistic.rosScore.p90) p90Count++;
    }
  }
}

console.log(`P10 accuracy: ${(p10Count / total * 100).toFixed(1)}% (target: ~90%)`);
console.log(`P50 accuracy: ${(p50Count / total * 100).toFixed(1)}% (target: ~50%)`);
console.log(`P90 accuracy: ${(p90Count / total * 100).toFixed(1)}% (target: ~90%)`);
```

## Troubleshooting

### "No historical data found"
- Check that season year is correct
- Verify teamId and leagueId exist in database
- Ensure game logs have been ingested for that season

### "Optimizer performs worse than naive"
- Check that all intelligence layers are enabled
- Verify weights in optimizer config
- Run with verbose: true to see decision trace

### "Monte Carlo poorly calibrated"
- Increase simulation count (default: 1000)
- Check that confidence levels are being calculated correctly
- Verify that actual outcomes are being recorded accurately

### "Slow simulation"
- Reduce Monte Carlo simulations: `simulatePlayerOutcomes(score, { simulations: 200 })`
- Run on subset of weeks for testing
- Use caching for repeated calculations

## Configuration Reference

### SimulatorConfig
```typescript
interface SimulatorConfig {
  season: number;              // Year to simulate
  teamId: string;              // Your team ID
  leagueId: string;            // League ID
  weeklyMode: boolean;         // true = weekly leagues, false = daily
  baselines: BaselineStrategy[]; // Baselines to compare
  verbose: boolean;            // Log progress
}
```

### BacktestMetrics
```typescript
interface BacktestMetrics {
  totalWeeks: number;
  wins: number;
  losses: number;
  winPercentage: number;
  
  categoryGains: Record<string, CategoryGain>;
  totalCategoryPoints: number;
  
  decisionAccuracy: {
    accuracy: number;           // % of correct decisions
    valueAddedVsNaive: number;  // Points gained vs naive
    valueAddedVsHuman: number;  // Points gained vs human
  };
  
  momentumAccuracy: {
    correctDirection: number;   // % of correct trend predictions
    breakoutHitRate: number;    // % of breakouts that materialized
  };
  
  monteCarloCalibration: {
    calibrationScore: number;   // 0-100, higher = better calibrated
  };
  
  baselineComparisons: Record<string, BaselineComparison>;
}
```

## CLI Usage (Future)

```bash
# Run backtest
pnpm backtest --season 2024 --team my-team --league my-league

# With specific baselines
pnpm backtest --season 2024 --baselines naive,human

# Export to file
pnpm backtest --season 2024 --output backtest-2024.json

# Compare to golden baseline
pnpm backtest --season 2024 --compare-to-golden
```
