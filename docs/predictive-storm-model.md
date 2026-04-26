# Predictive Storm-Event Likelihood Model — Design Doc

**Status:** Parked. Design complete, not yet implemented.
**Owner:** Eavesight engineering
**Dependencies:** Core data pipeline + scoring engine must be production-quality first.
**Last updated:** 2026-04-21

---

## 1. Why we're building this

The roofing SaaS market is crowded with *historical* storm maps (HailTrace, HailStrike, Interactive Hail Maps) and a few insurance-industry actuarial risk models (ZestyAI Z-HAIL, CoreLogic, Verisk, HazardHub). Nobody is selling a **forward-looking per-property event-likelihood** product to roofing contractors or homeowners at an accessible price point.

The closest analogs are:

| Product | What it does | Why we can beat it |
|---|---|---|
| HailScore (myhailscore.com) | Homeowner-facing historical hail exposure, 2015-present | 10-yr window; no forecast |
| 8020REI Roofing Intelligence | Predictive "likely to need a roof in 6-12mo" score | Florida-only pilot; $5M+ roofers only; contractor-facing only |
| ZestyAI Z-HAIL | Actuarial frequency + severity ML | Insurance-carriers only; enterprise pricing; black box |
| Nearmap/Betterview Hail Claim Predictor | FEMA Hail Risk Index + imagery vulnerability | Regional hazard not climatology; no consumer version |

Our edge:
- **75-year SPC history** (1950–present, 2.1M storm events, 6.5M property-storm linkages already pre-computed)
- **Dual audience:** contractor leads + homeowner transparency, same model
- **Regional focus:** North Alabama first, expand outward
- **Transparency:** consumer-explainable, not a black-box underwriting score

## 2. Output shape

For any property we return:

```
{
  "propertyId": "...",
  "climatology": {
    "hailProbability5yr": 0.37,
    "hailProbability10yr": 0.62,
    "hailProbability25yr": 0.89,
    "tornadoEF2Probability25yr": 0.08,
    "windGust60mphProbability5yr": 0.41,
    "historicalEventCount": 27,
    "nearestDamagingEvent": { "date": "2019-04-27", "type": "HAIL", "size": 2.25 }
  },
  "vulnerability": {
    "roofAgeYears": 16,
    "roofMaterial": "asphalt",
    "roofAreaSqft": 2840,
    "roofComplexityScore": 0.45,
    "vulnerabilityIndex": 0.68
  },
  "composite": {
    "replacementLikelihood5yr": 0.58,
    "estimatedJobValue": 11200,
    "leadScore": 74,
    "leadScoreExplanation": [
      "roof is 16yrs old (asphalt avg life 22yrs)",
      "3 severe hail events within 1mi since 2015",
      "no permit activity in last 10yrs",
      "neighborhood had 4 re-roofs in last 12mo"
    ]
  },
  "modelVersion": "v0.1",
  "lastComputedAt": "2026-04-21T16:00:00Z"
}
```

## 3. Architecture: three layers

### Layer 1 — Pure climatology (ship first, no ML)

**Inputs:** `storm_events` (2.1M rows), property lat/lon.
**Method:** Poisson return-period estimation.

For each property `p` and event type `E` (HAIL≥1", TORNADO≥EF2, WIND≥60mph):

1. Count historical events of type `E` within radius `r` of `p` over `T` years:
   `λ(p,E) = count(E within r of p in last T years) / T`  (events per year)
2. Probability of ≥1 event in next `N` years (Poisson): `1 - exp(-λ·N)`

Radii to try: hail 1mi, tornado 2mi, wind 1.5mi.
Time window: 75 yrs for rare events, 25 yrs for wind (since wind reporting improved post-2000).

**Why it's defensible:**
- Uses data no competitor has surfaced at property level at this history depth.
- Fully explainable: "X events within Y miles in Z years → probability = P."
- Runs in milliseconds on existing indexes (we already have `idx_storm_events_geog` GIST index).

**Validation:**
- Compare 10-yr-ago prediction vs. what actually happened 2014–2024. Check calibration (ECE < 10%).
- Sanity-check that hail-alley TX/OK/CO properties score higher than coastal FL properties (which should score higher on hurricane risk, which we don't model).

**Ship to:**
- Homeowner-facing free report ("What could hit your home?") → acquisition wedge
- Roofer dashboard as a lead sorting dimension

### Layer 2 — Property vulnerability (2-3 weeks)

**Inputs:** roof age, roof material, roof area, roof complexity, stories (from footprint), neighborhood exposure pattern.

**Method:** Start with a linear index:
```
V = w1·(roofAge/22) + w2·(1 if material=="asphalt" else 0.3) + w3·(roofArea/medianArea) + w4·complexity
```

Then upgrade to gradient-boosted model once we have partial ground truth:
- **Proxy labels:** CoC new-construction dates + our permit database (who re-roofed recently).
- **Sparse true labels:** track which properties our users actually sell jobs on (feedback loop).
- Train XGBoost on `(V_features + climatology_features) → roof_replaced_in_next_12mo` from historical hindsight slices.

Cross-reference against published roof-life studies (IBHS, UL, RoofingContractor):
- Asphalt 3-tab: 15-20 yrs
- Asphalt architectural: 22-30 yrs
- Metal: 40-70 yrs
- Tile: 50+ yrs

### Layer 3 — Composite lead score (3-4 weeks)

**Inputs:**
- `climatology.*` (L1)
- `vulnerability.*` (L2)
- Financial signals: home value, ownership length, recent mortgage activity (from assessor data)
- Activity signals: recent permits (negative — they just did work), neighbor permits (positive — block-level priming)
- Demographic signals: owner-occupied vs. investor, Census income/ownership rate

**Method:** Per-roofer adaptive weights (user's vision — Netflix-style).
- Start everyone at a baseline weighting.
- As a roofer marks leads as "won," "lost," "stale," or "scheduled appt," re-weight the prior via Bayesian update.
- Each roofer ends up with their own model optimized for their close rate and territory.

**Cold-start:** Use population-level weights (pooled across all Eavesight roofers) until that roofer has 50+ labeled outcomes.

## 4. Math reference

### Poisson return period
```
λ = annual event rate = count / years_observed
P(≥1 event in N years) = 1 - exp(-λ·N)
expected_return_period_years = 1 / λ
```

### Poisson uncertainty (for transparency UI)
```
95% CI on λ ≈ (k/T) ± 1.96·sqrt(k/T²)  where k = observed count
```
Show this as "based on X events over 75 years, we estimate a hail probability of Y% ± Z%."

### Why 22 years for asphalt (the current inference heuristic)
Average of 3-tab (17.5 yr median) and architectural (26 yr median) weighted by market share. Source: IBHS roofing-life studies.

## 5. Risks + mitigations

| Risk | Mitigation |
|---|---|
| SPC hail reports are biased toward populated areas | Use the climatology for relative risk within zip code, not absolute |
| NWS started tracking severe storms more comprehensively post-1990 | Use two windows: 1950+ for tornadoes (rare, well-reported); 1990+ for hail/wind |
| Hail swaths are bigger than point reports suggest | Upgrade to SPC hail polygon shapefiles (Tier 2 data task) |
| No ground-truth replacement labels | Use CoC + permits as imperfect proxies; add user-labeled outcomes as primary signal later |
| Competitive response from ZestyAI / 8020REI | Ship consumer wedge first — insurance players won't cannibalize B2B |
| Model drift from climate change | Recompute λ quarterly; track year-over-year frequency shifts |

## 6. Go-to-market angle

**Homeowner hook:** "See 75 years of storm history for your home and what to expect next, free."
Generates traffic → entry-point for roofer Directory referrals.

**Roofer hook:** "The only lead list ranked by actual storm return periods and roof-specific vulnerability."
$X/month/territory with ZIP-code exclusivity (mirror 8020REI's territory lock).

**Insurance angle (later):** Sell anonymized risk insights to regional carriers without competing head-on with Zesty/CoreLogic.

## 7. When to build

**Before starting Layer 1:**
- [ ] Roof age accuracy fixed (currently always-inferred, never uses CoC anchors)
- [ ] Scoring engine stress-tested, consolidated down to one algorithm
- [ ] FEMA flood + disaster data ingested
- [ ] Storm path/swath polygons ingested (not point reports)

**Layer 1 triggers:**
- [ ] Core data ≥95% clean
- [ ] 5+ beta roofers onboarded to validate signal

**Layer 2 triggers:**
- [ ] 500+ labeled roof replacements (from CoC + permits + user feedback)
- [ ] Nearmap or Microsoft footprints → roof-complexity features

**Layer 3 triggers:**
- [ ] 10+ roofers with 50+ outcome labels each
- [ ] Production feedback loop for per-roofer weight updates

## 8. Open questions

- Do we license SPC hail polygons (ArcGIS hosted layer) or mirror them? (Free either way, storage vs. latency trade-off.)
- How do we handle the SPC reporting bias for pre-1990 hail? (Possibly weight recent data 2x.)
- Should homeowners pay for the report, or keep free as a funnel? (Recommendation: free; paywall only the "who will re-roof it" contractor-matching tier.)

---

*This doc is parked until core data + scoring work completes. Revisit when checklist in §7 is green.*
