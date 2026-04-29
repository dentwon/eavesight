# Alabama insurance claim window — urgency scoring

## The rule

Alabama hazard-insurance policies (the standard HO-3 written by Travelers, State Farm, Allstate, USAA, etc. in AL) typically require notice of loss within a specific window after the date of damage. Common terms:

| Carrier / Policy type | Notice-of-loss limit | Suit-against-insurer limit |
|---|---|---|
| State Farm AL HO-3 | "as soon as practical" | 1 year from date of loss (per AL stat) |
| Allstate AL HO-3 | 60 days for property | 1 year |
| Travelers AL | "as soon as practical" | 2 years (some endorsements 5) |
| USAA AL | 30 days reporting | 2 years to suit |
| Default AL stat (Ala. Code §27-14-19) | written notice within 90 days | suit within 1 year |

**Practical rule of thumb: 1-year is the floor, 2-years is the ceiling.** After 2 years, virtually all carriers will deny on grounds of "failure to provide timely notice" plus prejudice from delayed inspection (impossible to attribute damage to a specific event after 24 months).

For roofers selling insurance-paid replacements, the **lead window is the trailing 24 months from the storm date** — homeowners hit by a storm in (current_date - 730 days) onward who haven't yet filed a claim.

## Urgency tiers

For each property hit by a qualifying storm, compute:

```
urgency_days_remaining = 730 - (current_date - storm_date)::int
```

Tiers:

| `urgency_days_remaining` | Tier | Sales pitch |
|---|---|---|
| < 30 | **ON FIRE** 🔥 | "Your insurance window closes in N days — file now" |
| 30-90 | URGENT | "Limited time to file" |
| 90-365 | PRIME | "Recent storm damage — let's inspect" |
| 365-730 | EARLY WINDOW | "You're still eligible" |
| > 730 (storm > 2 yr ago) | EXPIRED | Out of insurance window — only relevant for cash sales |

## Major recent N-AL events to score against

(Pulled from `storm_events` filtered to N-AL counties)

| Event date | Type / severity | Days since (as of 2026-04-29) | Days remaining (730-days_since) |
|---|---|---|---|
| **2024-05-08** | Tornado swarm (multiple EF1+ tracks across Madison + Limestone) | 721 | **9** ← burning urgent |
| 2024-04-28 | Hail outbreak | 731 | -1 ← just expired |
| 2024-08-25 | Hail outbreak Cullman | 612 | 118 |
| 2025-04-15 | Hail outbreak | 379 | 351 |
| 2025-04-28 | Hail outbreak | 366 | 364 |
| 2025-05-15 | Hail outbreak | 349 | 381 |
| 2026-04-15 | Hail (recent) | 14 | 716 |
| 2026-04-28 | Hail (yesterday) | 1 | 729 |

The May 8 2024 tornado is the **highest-urgency event** — multiple verified-tornado-hit properties in our DB still without permits filed are leads with single-digit days of insurance window remaining.

## Implementation

Add a column to `roof_age_v2` (or compute on-the-fly):

```sql
WITH most_recent_qualifying_storm AS (
  SELECT 
    ps."propertyId",
    MAX(se.date) AS storm_date,
    EXTRACT(DAY FROM NOW() - MAX(se.date))::int AS days_since
  FROM property_storms ps
  JOIN storm_events se ON se.id = ps."stormEventId"
  WHERE se.date > NOW() - INTERVAL '24 months'
    AND ((se.type='HAIL' AND se."hailSizeInches" >= 1.0)
      OR (se.type='WIND' AND se."windSpeedMph" >= 70)
      OR (se.type='TORNADO' AND se."tornadoFScale" IN ('EF1','EF2','EF3','EF4','EF5')))
  GROUP BY ps."propertyId"
)
SELECT 
  property_id,
  days_since,
  730 - days_since AS days_remaining,
  CASE
    WHEN 730 - days_since < 30 THEN 'ON_FIRE'
    WHEN 730 - days_since < 90 THEN 'URGENT'
    WHEN 730 - days_since < 365 THEN 'PRIME'
    WHEN 730 - days_since < 730 THEN 'EARLY'
    ELSE 'EXPIRED'
  END AS urgency_tier
FROM most_recent_qualifying_storm
WHERE days_since BETWEEN 0 AND 730;
```

## Lead score combining roof-age window + urgency window

Final lead score combines both:

```
roof_age = current_year - best_estimate_year (from roof_age_v2)
material_eligible = NOT EXISTS mls_roof_material (metal/clay)
needs_replacement = (
  (best_estimate_kind = 'first_install' AND roof_age >= 15)
  OR (best_estimate_kind = 'replacement' AND roof_age >= 22)
)
has_recent_storm = days_since BETWEEN 0 AND 730

PRIORITY = 
  IF NOT material_eligible: SKIP
  IF needs_replacement AND has_recent_storm AND urgency_tier='ON_FIRE': PRIORITY_1_BURNING
  IF needs_replacement AND has_recent_storm AND urgency_tier='URGENT': PRIORITY_2_HOT
  IF needs_replacement AND has_recent_storm AND urgency_tier='PRIME': PRIORITY_3_LIVE
  IF needs_replacement AND NOT has_recent_storm: PRIORITY_4_AGED_NO_STORM
  IF roof_age BETWEEN 15 AND 21 AND NOT has_recent_storm: PRIORITY_5_PRIME_QUIET
  ELSE: NOT_LEAD
```

The PRIORITY_1_BURNING + PRIORITY_2_HOT cohorts are the immediate-call-now lead pool. PRIORITY_3_LIVE + PRIORITY_4_AGED are the medium-term sales pipeline.
