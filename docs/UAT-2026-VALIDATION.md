# 2026 Season UAT Validation Plan

## Objective
Validate accuracy of game log ingestion, rolling 7/14/30 day stats, and decision pipeline before any Yahoo integration.

## Test Players - 2026 Season (Week 2)

| Player | MLBAM ID | Games | Status |
|--------|----------|-------|--------|
| Aaron Judge | 592450 | 6 | ✅ Ingested |
| Bobby Witt Jr | 677951 | 6 | ✅ Ingested |
| Yainer Diaz | 669128 | 0 | ⚠️ No games (injured/DH?) |

---

## Validation Checklist

### 1. Game Count Accuracy

**Aaron Judge (592450)**
- [ ] Verify 6 games played in 2026 season
- [ ] Cross-reference: https://baseball-reference.com/players/j/judgeaa01.shtml
- [ ] Check game dates align with Yankees schedule

**Bobby Witt Jr (677951)**
- [ ] Verify 6 games played in 2026 season
- [ ] Cross-reference: https://baseball-reference.com/players/w/wittbo02.shtml
- [ ] Check game dates align with Royals schedule

### 2. Plate Appearance Counts

**Aaron Judge**
- [ ] Database shows: 25 plate appearances (last 30 days)
- [ ] Manual count from game logs: ___
- [ ] Official source: ___

**Bobby Witt Jr**
- [ ] Database shows: 24 plate appearances (last 30 days)
- [ ] Manual count from game logs: ___
- [ ] Official source: ___

### 3. Rate Statistics Accuracy

**Aaron Judge - AVG / OPS / ISO**
- [ ] Database AVG: .125
- [ ] Database OPS: .535
- [ ] Database ISO: .250
- [ ] Baseball-Reference: ___
- [ ] Variance explanation: ___

**Bobby Witt Jr - AVG / OPS / ISO**
- [ ] Database AVG: .273
- [ ] Database OPS: .564
- [ ] Database ISO: .000
- [ ] Baseball-Reference: ___
- [ ] Variance explanation: ___

### 4. Rolling Window Logic

**Test: 7-Day vs 14-Day vs 30-Day**

Since it's early season (6 games played):
- [ ] gamesLast7 should equal games played (all games within 7 days)
- [ ] gamesLast14 should equal games played (all games within 14 days)
- [ ] gamesLast30 should equal games played (all games within 30 days)

**Aaron Judge:**
- [ ] gamesLast7: 6 ✓ (expected: all games)
- [ ] gamesLast14: 6 ✓ (expected: all games)
- [ ] gamesLast30: 6 ✓ (expected: all games)

**Bobby Witt Jr:**
- [ ] gamesLast7: 6 ✓ (expected: all games)
- [ ] gamesLast14: 6 ✓ (expected: all games)
- [ ] gamesLast30: 6 ✓ (expected: all games)

### 5. Reliability Scoring

**Sample Size Classification**
- [ ] Both players show "small" sample size (correct for 6 games)
- [ ] gamesToReliable: 57 (need 57 more games to reach reliable sample)
- [ ] Threshold: 50 games for reliability

**Confidence Scoring**
- [ ] confidence: 0.6 (60% confidence due to small sample)
- [ ] Verify this feels right for early season

### 6. Decision Explanation Test

**Scenario: Waiver Recommendation**

If the system recommends picking up Bobby Witt Jr over Aaron Judge:
- [ ] Can we explain why? (higher AVG, better consistency score)
- [ ] Is the logic transparent? (data sources, calculation methods)
- [ ] Would we trust this decision without automation? ___

---

## Manual Validation Steps

### Step 1: Export Raw Game Logs
```bash
# Get raw game logs from database (via API or direct query)
# Verify each game date, opponent, and stats
```

### Step 2: Cross-Reference Official Sources
1. Go to https://www.baseball-reference.com/
2. Search player name
3. Navigate to 2026 game log
4. Compare each stat to our database

### Step 3: Calculate Rates Manually
```
AVG = Hits / At Bats
OPS = OBP + SLG
ISO = SLG - AVG
```

### Step 4: Verify Rolling Windows
```
For each player:
1. List all game dates
2. Count games within last 7 days from most recent
3. Count games within last 14 days from most recent
4. Count games within last 30 days from most recent
5. Compare to database values
```

---

## Acceptance Criteria

Before advancing to Yahoo integration:

- [ ] All game counts match official sources (100% accuracy)
- [ ] Plate appearance counts match official sources (±1 PA acceptable)
- [ ] Rate stats (AVG, OPS) within ±10 points of official sources
- [ ] Rolling windows calculated correctly from game dates
- [ ] Can explain every decision the system makes
- [ ] Can identify and explain any discrepancies found

---

## Known Limitations

1. **Early Season Small Samples**: 6 games is not statistically significant
2. **MLB Stats API Data Lag**: Some players (e.g., Yainer Diaz) may show 0 games in our system while Baseball-Reference shows 5+ games. This is a data source limitation.
3. **OPS Calculation**: We use stored OBP/SLG from raw data - verify source accuracy

### Data Source Discrepancy - Yainer Diaz

| Source | 2026 Games | Status |
|--------|------------|--------|
| Baseball-Reference | 5 games (Mar 26-31) | User validated |
| MLB Stats API | 0 games | Our data source |
| Our Database | 0 games | Ingested from MLB API |

**Impact**: Player will not appear in waiver recommendations until MLB API updates.
**Mitigation**: Document known data gaps; consider secondary data source in future.

---

## Sign-Off

**Date**: ___________

**Validator**: ___________

**Status**: 
- [ ] PASS - Ready for Yahoo integration
- [ ] FAIL - Issues found (document below)

**Issues Found**:
```
Document any discrepancies, bugs, or concerns here.
```

**Decision**: 
- [ ] Proceed to Yahoo integration
- [ ] Fix issues and re-validate
- [ ] Need more data (wait for more games)
