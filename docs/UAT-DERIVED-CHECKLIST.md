# Phase 2: Derived Features UAT Checklist

## Test Players (5 Hitters + 5 Pitchers)

### Hitters

| # | Player | Team | mlbamId | Profile | Why Selected |
|---|--------|------|---------|---------|--------------|
| 1 | **Aaron Judge** | NYY | 592450 | Elite power, high K% | Extreme stats, reliability test |
| 2 | **Bobby Witt Jr.** | KC | 677951 | 5-tool, speed+power | Rising star, balanced profile |
| 3 | **Freddie Freeman** | LAD | 518692 | Elite contact, consistency | Stable baseline, low volatility |
| 4 | **Jeremy Peña** | HOU | 665161 | Middle infield, moderate power | Mid-tier, regression candidate |
| 5 | **Mike Trout** | LAA | 545361 | Former MVP, injury history | High variance, risk testing |

### Pitchers

| # | Player | Team | mlbamId | Profile | Why Selected |
|---|--------|------|---------|---------|--------------|
| 1 | **Tarik Skubal** | DET | 669203 | Ace, high K% | Elite dominance, stat reliability |
| 2 | **Paul Skenes** | PIT | **694973** | Rookie phenom | **187.2 IP in 2025** - ID corrected |
| 3 | **Corbin Burnes** | BAL | 656288 | Cy Young winner | Consistent top-tier performer |
| 4 | **Gerrit Cole** | NYY | 543037 | Veteran ace | Injury return, data gaps |
| 5 | **Dylan Cease** | SD | 676440 | High K%, wild | High variance, volatility test |

---

## UAT Validation Checklist

### For Each Player:

#### 1. Raw Data Verification
- [ ] Fetch game logs from MLB Stats API
- [ ] Verify games played count matches database
- [ ] Spot-check 3 random games for stat accuracy

#### 2. Manual Calculation (7-Day Window)
- [ ] Sum plate appearances (PA = AB + BB + HBP + SF)
- [ ] Calculate AVG = H / AB
- [ ] Calculate K% = SO / PA
- [ ] Calculate BB% = BB / PA
- [ ] Calculate OPS if applicable

#### 3. Manual Calculation (14-Day Window)
- [ ] Repeat all 7-day calculations for 14-day window
- [ ] Verify trend direction (improving/declining/stable)

#### 4. Derived Layer Comparison
- [ ] Compare manual AVG vs `battingAverageLast30`
- [ ] Compare manual K% vs `strikeoutRateLast30`
- [ ] Compare manual BB% vs `walkRateLast30`
- [ ] Note any discrepancies > 1%

#### 5. Stabilization Flag Validation
- [ ] Check if PA >= 100 for AVG stabilization
- [ ] Check if PA >= 60 for K%/BB% stabilization
- [ ] Verify flags match manual threshold checks
- [ ] Red flag: Flag true with insufficient PA

#### 6. Volatility Assessment
- [ ] Calculate std dev of last 7 games vs previous 7
- [ ] Compare to `productionVolatility` in database
- [ ] Verify volatility direction makes sense

#### 7. Logical Consistency
- [ ] K% + BB% + BABIP-esque should roughly reconcile
- [ ] No negative rates or >100% rates
- [ ] Games played matches team schedule

---

## Red Flags to Watch

| Flag | Description | Action |
|------|-------------|--------|
| 🚩 **Stat Contradiction** | Derived AVG doesn't match manual calc | Check data source alignment |
| 🚩 **Stabilization Flip** | Player toggles reliable/unreliable daily | Review threshold logic |
| 🚩 **Volatility Spike** | 7d AVG varies >100 points from 30d | Verify game log continuity |
| 🚩 **Missing Games** | Database shows fewer games than actual | Check ingestion completeness |
| 🚩 **Duplicate Records** | Same game appears twice | Check idempotency |

---

## MLB Stats API Endpoints

```bash
# Hitter game logs
curl "https://statsapi.mlb.com/api/v1/people/{mlbamId}/stats?stats=gameLog&group=hitting&season=2025&gameType=R"

# Pitcher game logs  
curl "https://statsapi.mlb.com/api/v1/people/{mlbamId}/stats?stats=gameLog&group=pitching&season=2025&gameType=R"
```

---

## Expected Results Summary

### Hitters - Expected Derived Values (as of 2025 season)

| Player | Games | AVG | K% | BB% | Reliable? |
|--------|-------|-----|-----|-----|-----------|
| Aaron Judge | ~152 | .330 | ~24% | ~18% | ✅ Yes (high PA) |
| Bobby Witt Jr. | ~157 | .295 | ~16% | ~7% | ✅ Yes |
| Freddie Freeman | ~147 | .295 | ~14% | ~10% | ✅ Yes |
| Jeremy Peña | ~144 | .276 | ~17% | ~5% | ✅ Yes |
| Mike Trout | ~120 | .270 | ~28% | ~14% | ⚠️ Maybe (injury) |

### Pitchers - Expected Derived Values

| Player | Games/GS | ERA | K% | BB% | Reliable? |
|--------|----------|-----|-----|-----|-----------|
| Tarik Skubal | ~33 | ~2.50 | ~30% | ~6% | ✅ Yes |
| Paul Skenes | ~20 | ~2.00 | ~33% | ~6% | ⚠️ Borderline (rookie) |
| Corbin Burnes | ~32 | ~3.20 | ~24% | ~7% | ✅ Yes |
| Gerrit Cole | ~20 | ~3.50 | ~26% | ~8% | ⚠️ Partial season |
| Dylan Cease | ~32 | ~3.40 | ~28% | ~10% | ✅ Yes |

---

## Exit Criteria

✅ **PASS** if:
- 8+ of 10 players match within 1% tolerance
- Stabilization flags align with PA thresholds
- No major contradictions found

❌ **FAIL** if:
- 3+ players have >2% discrepancies
- Stabilization flags behave erratically
- Volatility metrics contradict visual trend

**Goal**: Derived data feels like *objective truth*, not analysis.
