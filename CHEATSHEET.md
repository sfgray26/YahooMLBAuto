# CBB Edge Analyzer - API Testing Cheat Sheet

## Quick Start Commands

### Start Local Dev Server
```bash
# From project root
pnpm install
pnpm --filter @cbb/api dev

# Server runs on http://localhost:3000
```

### Health Check
```bash
curl http://localhost:3000/health
```

---

## Trade Evaluator API

### POST /trade/evaluate
```bash
curl -X POST http://localhost:3000/trade/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "proposal": {
      "playersYouGive": [
        { "playerId": "1", "playerMlbamId": "605141", "name": "Aaron Judge", "positions": ["OF"], "team": "NYY", "isInjured": false, "gamesThisWeek": 6 }
      ],
      "playersYouGet": [
        { "playerId": "2", "playerMlbamId": "660271", "name": "Shohei Ohtani", "positions": ["DH", "SP"], "team": "LAD", "isInjured": false, "gamesThisWeek": 6 }
      ]
    },
    "config": {
      "format": "roto",
      "riskTolerance": "balanced",
      "leagueSize": 12
    },
    "outputFormat": "json"
  }'
```

**Response:** Recommendation, category impact, risk analysis, roster impact

### POST /trade/quick-estimate
```bash
curl -X POST http://localhost:3000/trade/quick-estimate \
  -H "Content-Type: application/json" \
  -d '{
    "playersYouGive": [{ "name": "Judge", "score": 85 }],
    "playersYouGet": [{ "name": "Ohtani", "score": 90 }]
  }'
```

### GET /trade/examples
```bash
curl http://localhost:3000/trade/examples
```

---

## Momentum Detection API

### POST /momentum/analyze (Raw Z-Scores)
```bash
curl -X POST http://localhost:3000/momentum/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "zScore14d": 1.2,
    "zScore30d": 0.5,
    "games14d": 12,
    "games30d": 25,
    "playerName": "Test Player"
  }'
```

**Response:** Trend (surging/hot/stable/cold/collapsing), breakout/collapse signals, recommendation

### GET /momentum/:playerId (From DB)
```bash
curl http://localhost:3000/momentum/660271
```

### POST /momentum/batch
```bash
curl -X POST http://localhost:3000/momentum/batch \
  -H "Content-Type: application/json" \
  -d '{
    "players": [
      { "playerId": "660271", "zScore14d": 1.2, "zScore30d": 0.5 },
      { "playerId": "605141", "zScore14d": -0.3, "zScore30d": 0.8 }
    ]
  }'
```

### GET /momentum/leaders/hot
```bash
curl http://localhost:3000/momentum/leaders/hot?limit=10
```

---

## ROS Simulation API

### POST /simulate/ros
```bash
curl -X POST http://localhost:3000/simulate/ros \
  -H "Content-Type: application/json" \
  -d '{
    "playerId": "660271",
    "config": {
      "simulations": 1000,
      "weeksRemaining": 12,
      "regressionToMean": true
    }
  }'
```

**Response:** P10/P25/P50/P75/P90 percentiles, top-X probabilities, risk profile

### POST /simulate/batch
```bash
curl -X POST http://localhost:3000/simulate/batch \
  -H "Content-Type: application/json" \
  -d '{
    "players": [
      { "playerId": "660271", "name": "Ohtani" },
      { "playerId": "605141", "name": "Judge" }
    ],
    "config": { "simulations": 500 }
  }'
```

### POST /simulate/compare (Player vs Player)
```bash
curl -X POST http://localhost:3000/simulate/compare \
  -H "Content-Type: application/json" \
  -d '{
    "players": [
      { "playerId": "a", "name": "Player A", "currentScore": 85, "confidence": 0.8 },
      { "playerId": "b", "name": "Player B", "currentScore": 78, "confidence": 0.75 }
    ],
    "config": { "simulations": 1000 }
  }'
```

**Response:** Pairwise comparisons, rankings, win probabilities

### GET /simulate/:playerId/distribution
```bash
curl http://localhost:3000/simulate/660271/distribution
```

---

## Player Scoring API

### GET /players/:id/score
```bash
curl http://localhost:3000/players/660271/score
```

### GET /players/scores/top
```bash
curl "http://localhost:3000/players/scores/top?limit=20&season=2025"
```

--- $env:DATABASE_URL=postgresql://postgres:RBmybKskUFblHfOficOuElblwOGSAMeP@postgres.railway.internal:5432/railway  

## Lineup Optimization API

### POST /lineup/today
```bash
curl -X POST http://localhost:3000/lineup/today \
  -H "Content-Type: application/json" \
  -d '{
    "leagueId": "test-league",
    "platform": "yahoo",
    "format": "h2h",
    "riskTolerance": "balanced"
  }'
```

### GET /lineup/:id/result
```bash
curl http://localhost:3000/lineup/REQUEST_ID/result
```

---

## Testing Checklist

### Smoke Tests
- [ ] `GET /health` returns 200
- [ ] `GET /trade/examples` returns sample payloads

### Trade Evaluator
- [ ] Evaluate 1-for-1 trade (favorable)
- [ ] Evaluate 2-for-1 trade (depth vs quality)
- [ ] Test text output format (`"outputFormat": "text"`)
- [ ] Test markdown output format
- [ ] Test different risk tolerances (conservative/balanced/aggressive)

### Momentum
- [ ] Analyze player with positive ΔZ (surging)
- [ ] Analyze player with negative ΔZ (collapsing)
- [ ] Get momentum for real player from DB
- [ ] Batch analyze multiple players

### Simulation
- [ ] Run ROS sim for single player
- [ ] Run batch sim for 3+ players
- [ ] Compare 2 players probabilistically
- [ ] Get percentile distribution

### Error Handling
- [ ] Request with invalid player ID (404)
- [ ] Request with missing required fields (400)
- [ ] Malformed JSON (400)

---

## Example Test Script

```bash
#!/bin/bash
BASE="http://localhost:3000"

echo "=== Health Check ==="
curl -s $BASE/health | jq .

echo -e "\n=== Trade Evaluation ==="
curl -s -X POST $BASE/trade/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "proposal": {
      "playersYouGive": [{"playerId":"1","playerMlbamId":"605141","name":"Judge","positions":["OF"],"team":"NYY","isInjured":false,"gamesThisWeek":6}],
      "playersYouGet": [{"playerId":"2","playerMlbamId":"660271","name":"Ohtani","positions":["DH"],"team":"LAD","isInjured":false,"gamesThisWeek":6}]
    }
  }' | jq '.recommendation, .summaryScore'

echo -e "\n=== Momentum Analysis ==="
curl -s -X POST $BASE/momentum/analyze \
  -H "Content-Type: application/json" \
  -d '{"zScore14d":1.2,"zScore30d":0.5,"games14d":12}' | jq '.momentum.trend'

echo -e "\n=== ROS Simulation ==="
curl -s -X POST $BASE/simulate/ros \
  -H "Content-Type: application/json" \
  -d '{"playerId":"660271","config":{"simulations":1000}}' | jq '.projection.rosScore.p50'
```

---

## Deployment Commands (Railway)

```bash
# Deploy to Railway
railway login
railway link
railway up

# View logs
railway logs

# Set environment variables
railway vars set DATABASE_URL="postgresql://..."
railway vars set REDIS_URL="redis://..."
```

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/api/src/routes/trade.ts` | Trade evaluator routes |
| `apps/api/src/routes/momentum.ts` | Momentum detection routes |
| `apps/api/src/routes/simulation.ts` | Monte Carlo routes |
| `apps/worker/src/trade/` | Trade evaluator engine |
| `apps/worker/src/momentum/` | Momentum detection engine |
| `apps/worker/src/probabilistic/` | Monte Carlo engine |

---

## Troubleshooting

### Build Errors
```bash
# Clean and rebuild
rm -rf apps/*/dist packages/*/dist node_modules
pnpm install
pnpm --filter @cbb/core build
pnpm --filter @cbb/infrastructure build
pnpm --filter @cbb/worker build
pnpm --filter @cbb/api build
```

### Database Connection
```bash
# Test DB connection
pnpm --filter @cbb/infrastructure prisma db pull
```

### Port Already in Use
```bash
# Kill process on port 3000
npx kill-port 3000
```
