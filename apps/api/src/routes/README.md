# API Routes

## Intelligence Stack API Endpoints

### Health & Status
- `GET /health` - Service health check

### Player Scoring
- `GET /players/:id/score` - Get player value score (0-100)
- `GET /players/scores/top` - Get top scored players

### Lineup Optimization
- `POST /lineup/today` - Request lineup optimization
- `GET /lineup/:id/result` - Get lineup optimization result
- `GET /lineup/optimizations` - List recent optimizations

### Waiver Recommendations
- `POST /waiver/recommend` - Get waiver recommendations
- `POST /waiver/batch` - Batch waiver analysis

### Trade Evaluation (NEW)
- `POST /trade/evaluate` - Evaluate a trade proposal
  ```json
  {
    "proposal": {
      "playersYouGive": [{ "playerId": "1", "name": "Player A", "positions": ["OF"], ... }],
      "playersYouGet": [{ "playerId": "2", "name": "Player B", "positions": ["C"], ... }]
    },
    "config": {
      "format": "roto",
      "riskTolerance": "balanced"
    },
    "outputFormat": "json"
  }
  ```
- `POST /trade/quick-estimate` - Quick value estimate
- `GET /trade/examples` - Example trade proposals

### Momentum Detection (NEW)
- `POST /momentum/analyze` - Analyze player momentum from Z-scores
  ```json
  {
    "zScore14d": 0.8,
    "zScore30d": 0.5,
    "games14d": 12,
    "games30d": 20
  }
  ```
- `GET /momentum/:playerId` - Get momentum for a player
- `POST /momentum/batch` - Batch momentum analysis
- `GET /momentum/leaders/hot` - Get hottest players

### ROS Simulation (NEW)
- `POST /simulate/ros` - Run Monte Carlo ROS projection
  ```json
  {
    "playerId": "660271",
    "config": {
      "simulations": 1000,
      "weeksRemaining": 12
    }
  }
  ```
- `POST /simulate/batch` - Batch ROS projections
- `POST /simulate/compare` - Compare players probabilistically
- `GET /simulate/:playerId/distribution` - Get percentile distribution

### Admin
- `POST /admin/ingestion/run` - Run data ingestion
- `POST /admin/ingestion/validate` - Validate ingestion
- `GET /admin/ingestion/status` - Get ingestion status

## Response Format

All endpoints return JSON with the following structure:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2025-01-15T12:00:00Z",
    "duration": 45
  }
}
```

## Error Format

```json
{
  "success": false,
  "error": "Error message",
  "traceId": "uuid"
}
```

## Testing

Use the examples endpoints to get sample payloads:

```bash
# Get trade examples
curl http://localhost:3000/trade/examples

# Test trade evaluation
curl -X POST http://localhost:3000/trade/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "proposal": {
      "playersYouGive": [
        { "playerId": "1", "playerMlbamId": "605141", "name": "Player A", "positions": ["OF"], "team": "NYY", "isInjured": false, "gamesThisWeek": 6 }
      ],
      "playersYouGet": [
        { "playerId": "2", "playerMlbamId": "592450", "name": "Player B", "positions": ["C"], "team": "BOS", "isInjured": false, "gamesThisWeek": 6 }
      ]
    },
    "outputFormat": "text"
  }'
```
