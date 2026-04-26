# Product Value — What the Data Lets Us Sell

The point of all this data is **to find roofers leads they couldn't find anywhere else, at a margin nobody else can match.** This doc explains how the data ties to the business model.

## The pitch in one paragraph

Eavesight gives a roofer a map of every house in their service area, ranked 0-100 by likelihood of needing a roof, with one-click access to the homeowner's contact info, the storm history of that exact roof, an estimated job value, and what triggers (probate, recent sale, claim window) are firing. Replaces 5+ tools that competitors charge $800-2,500/month combined. We charge $200-400/month flat. The moat: nobody else has fused storm + property + ownership + permit + scoring data at the property level using free public sources.

## The 3 lead categories that move the needle

### 1. Storm-driven (22% of all roof replacements)

**The signal**: Property hit by ≥ 1.5" hail or significant wind in the last 90 days.
**The data we use**: `property_storms` × `storm_events.hailSizeInches` × `storm_events.windSpeed`
**Who wins these leads**: Whoever knocks first. Speed-to-lead = 2-3x conversion.
**Eavesight's edge**: Real-time NWS warning polling + 3-min alert latency. Most competitors batch nightly.

### 2. Aging-roof attrition (78% of replacements happen for non-storm reasons)

**The signal**: Asphalt roof installed 22-30+ years ago.
**The data we use**: `roofInstalledAt` (real, ~0.7% today, growing fast) + `yearBuilt` (proxy when no install date)
**Who wins these leads**: Whoever has the contact list and timing. The homeowner doesn't know their roof is failing yet.
**Eavesight's edge**: We're the only platform actively building real `roofInstalledAt` from permits + warranty + listings + imagery. Competitors stop at yearBuilt.

### 3. Dormant leads (your zero-competition thesis)

**The signal**: Old hailstorm + aging roof + no claim filed in window + no recent permit.
**The data we use**: `dormantFlag` (computed: storm 2-5 years ago + roof age > storm-tolerance + no permit + no claim trace)
**Who wins these leads**: Anyone who knows about them. Insurance claim windows are still open in many states 2-3 years post-event.
**Eavesight's edge**: We're literally the only platform looking for this pattern. PSAI, HailTrace, etc. focus on fresh storms.

## The score (the headline number)

A 0-100 number per property, broken into:

| Component | Weight | What feeds it |
|---|---|---|
| Urgency | 45% | Hail exposure, recency, severity, roof age |
| Revenue | 25% | Appraised value, sqft, roof material, regional cost |
| Trigger | 20% | Probate, recent transfer, investor flip, dormant flag |
| Occupancy | 10% | Owner-occupied vs absentee (absentee = harder to close) |

### Buckets

| Bucket | Threshold | Volume today | Meaning |
|---|---|---|---|
| Hot | ≥ 75 | 173 | Drop everything, pursue today |
| Warm | 60-74 | 14,166 | Add to active pipeline |
| Cool | 40-59 | 131,896 | Long-tail nurture |
| Cold | < 40 | 96,752 | Skip unless other signal fires |

## Pricing strategy implications

| Tier | What's included | Roofer audience |
|---|---|---|
| Free | Map view + cluster heatmap + payloadFree (~31 keys) | Tire kickers, lead validators |
| Pro $200-400/mo | payloadPro (~56 keys) + owner contact + scoreReasons full + filters | Independent roofers, 1-3 person teams |
| Enterprise | API access + bulk export + custom geos + skip-trace credits + adaptive scoring | Multi-crew, regional fleets |

The killer pricing move: **we charge flat per company, not per seat.** Competitors charge $50-100 per user. A 10-person fleet pays them $500-1,000/mo extra. We just take the $400.

## What the data lets the homepage say

These are claims we can defend with our actual database:
- "243K homes scored across N. Alabama"
- "2.1M storm events catalogued back to 1950"
- "30,417 permits cross-referenced"
- "8 active hot leads in Huntsville hit by ≥ 1.5" hail in the last 90 days" (live count, refreshes per visit)
- "Average roof job value in your zip: $X" (from appraised value × roof material cost lookup)

These are claims we can't yet defend honestly:
- ~"Every roof's age" (we have ~25% real, the rest imputed — say so)
- ~"Real-time storm detection nationwide" (we cover N. Alabama; expanding)
- ~"Insurance claim status" (no carrier integrations yet)

## What the data CAN'T do (yet) — but competitors can't either

- Predict whether a homeowner will say yes (no behavioral telemetry across roofers yet)
- Real ROI per lead per roofer (no closed-loop "this lead became a $X job" data yet)
- Cross-roofer market signal ("this neighborhood is being worked by 3 competitors")
- Personalized adaptive scoring per roofer's preferences (planned: phase 3 of the lead-scoring vision)

## The flywheel
More roofers sign up
↓
More job-history data (with permission)
↓
Real roofInstalledAt for thousands more properties
↓
Sharper roof-age model
↓
Better lead scores
↓
More accurate lead delivery
↓
Roofers close more
↓
More roofers sign up

The flywheel is gated on **getting the first 5-10 roofer partners to share job history.** The data architecture supports it (a `roofer_job_history` table can be added cleanly). The product/sales work to land those partners is the bottleneck.