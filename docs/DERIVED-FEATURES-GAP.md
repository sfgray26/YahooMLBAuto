# Derived Features Gap Analysis

## Current Derived Stats (Basic)

### Hitters
- Rolling AVG, OBP, SLG, OPS (30-day)
- K%, BB% (30-day)
- BABIP
- Stabilization flags (reliable?)
- Volatility metrics
- Playing time trends

### Pitchers
- Same structure (but calculated wrong - using AB instead of BF)
- Missing most pitcher-specific features

---

## What We Actually Need for Fantasy Edge

### Hitters - Advanced
| Feature | Why It Matters | Data Source |
|---------|----------------|-------------|
| **wOBA** | Better than OPS for run creation | MLB Stats API |
| **wRC+** | Park/league adjusted production | Calc from wOBA |
| **Hard Hit %** | Quality of contact predictive | Baseball Savant |
| **Exit Velocity** | Power indicator | Baseball Savant |
| **Sprint Speed** | SB potential, defensive value | Baseball Savant |
| **Barrel %** | Best predictor of power | Baseball Savant |
| **GB/FB Ratio** | Batted ball profile | MLB Stats API |
| **Pull %** | Shift vulnerability | Baseball Savant |
| **vs LHP Splits** | Platoon advantage | MLB Stats API |
| **vs RHP Splits** | Platoon advantage | MLB Stats API |
| **Home/Away Splits** | Park effects | MLB Stats API |
| **Clutch (2-out RISP)** | High leverage performance | MLB Stats API |
| **Recent Trajectory** | 7d vs 14d vs 30d trend | Computed |
| **Rest Day Effect** | Performance after rest | Computed |

### Pitchers - Advanced
| Feature | Why It Matters | Data Source |
|---------|----------------|-------------|
| **FIP** | Defense-independent ERA | MLB Stats API |
| **xFIP** | Park-adjusted FIP | Calc from FB% |
| **SIERA** | Best predictive ERA | Calc from K/BB/GB |
| **K/9** | Strikeout rate per 9 | MLB Stats API |
| **BB/9** | Walk rate per 9 | MLB Stats API |
| **K-BB%** | Best single pitching metric | Calc from totals |
| **SwStr%** | Swing-and-miss ability | Baseball Savant |
| **CStr%** | Called strikes (control) | Baseball Savant |
| **O-Swing%** | Chase rate | Baseball Savant |
| **Z-Contact%** | Contact in zone (stuff) | Baseball Savant |
| **Barrel %** | Hard contact allowed | Baseball Savant |
| **Avg Exit Velo** | Quality of contact against | Baseball Savant |
| **Pitch Velocity Trend** | Arm health indicator | MLB Stats API |
| **Pitch Mix Changes** | Strategy shifts | MLB Stats API |

---

## The Real Question

For **Phase 2 UAT**, what level of validation do we need?

### Option A: Basic Validation (Current)
- Verify our rolling averages match manual calc
- Fix pitcher calculation bug
- Document gaps for future enhancement

### Option B: Enhanced Derived Features
- Add wOBA, FIP, advanced metrics
- Integrate Baseball Savant API
- Build comprehensive feature set
- Then validate

### Option C: Fantasy-Specific Features
- Skip generic derived stats
- Jump directly to fantasy value calculations
- Points per game projections
- Category-specific z-scores

---

## Recommendation

**Option A for now** - Validate basic stats are correct, document gaps.

**Why:**
1. Basic stats must be accurate before building on them
2. Advanced features need stable foundation
3. UAT Phase 2 is about data integrity, not feature completeness
4. Can add advanced features in Phase 3

**Next Phase (Phase 3):** Add fantasy-specific derived features
- wOBA/FIP calculations
- Baseball Savant integration
- Projection models
