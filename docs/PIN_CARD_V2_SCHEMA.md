# property_pin_cards v2 schema — what's now available to MetroMap.tsx

**Date:** 2026-04-29
**Migration:** `20260429090000_add_pin_card_lead_priority`
**Pin-cards script:** `scripts/build-pin-cards-v4.sql` (modified, same name)

---

## What changed

`property_pin_cards` now has 10 new top-level columns AND the `payloadFree` /
`payloadPro` JSONB blobs include matching fields. Top-level columns are
indexed for fast filtering; JSONB embeds the full detail for client-side
rendering.

## New top-level columns (queryable via `WHERE`/`ORDER BY`)

| Column | Type | What it is | Use case |
|---|---|---|---|
| `priorityRank` | int | 1-9 (1=BURNING_PRIME, 9=NOT_LEAD) | Top-N queries, color-by-priority |
| `priorityLabel` | text | `PRIORITY_1_BURNING_PRIME` etc | Filter by named tier |
| `urgencyTier` | text | `1_ON_FIRE`, `2_URGENT`, etc | Insurance-window filter |
| `severitySubrank` | int | 1-7 (1=tornado EF2+, 7=wind 70-80) | Sub-rank within priority |
| `daysUntilClaimClose` | int | Days remaining in 24-mo window | "9 DAYS LEFT" badge |
| `evidenceClass` | text | `VERIFIED_REPLACEMENT` etc | Confidence badge ("permit on file") |
| `roofAgeYearsV2` | int | current_year - best_estimate_year | Age display |
| `roofAgeConfidenceV2` | numeric(4,2) | 0.10-0.95 | Confidence indicator |
| `bestEstimateYearV2` | int | The actual year | "Built/installed YYYY" |
| `bestEstimateKindV2` | text | `replacement` or `first_install` | "Original roof" vs "replaced" |

## New indexes

```
pin_cards_priority_idx          (metroCode, priorityRank)
pin_cards_priority_burning_idx  (metroCode, priorityRank, severitySubrank, daysUntilClaimClose)
                                WHERE priorityRank IN (1, 2)
pin_cards_age_v2_idx            (metroCode, roofAgeYearsV2 DESC)
                                WHERE roofAgeYearsV2 IS NOT NULL
```

## payloadFree (Scout / anonymous tier) — limited bucket-only versions

```json
{
  ...existing fields,
  "priorityBucket": "BURNING" | "URGENT" | "PIPELINE" | "AGED" | "TOO_YOUNG" | "NOT_LEAD",
  "roofAgeV2Band": "<5 yr" | "5-10 yr" | "10-15 yr" | "15-20 yr" | "20-25 yr" | "25-35 yr" | "35+ yr",
  "roofEvidenceQuality": "verified" | "strong" | "imputed" | "weak" | null
}
```

Scout sees the bucket, not the exact rank. No exact roof age, no claim-window-days.

## payloadPro (Business / Pro / Enterprise) — full detail

```json
{
  ...existing fields,
  "priorityRank":           1,
  "priorityLabel":          "PRIORITY_1_BURNING_PRIME",
  "urgencyTier":            "1_ON_FIRE",
  "ageTier":                "B_PRIME_15_25",
  "severitySubrank":        1,
  "daysUntilClaimClose":    10,
  "recentStormDate":        "2024-05-08",
  "recentStormDaysSince":   721,
  "recentStormType":        "TORNADO",
  "recentStormHailInches":  null,
  "recentStormWindMph":     null,
  "recentStormTornadoScale": "EF2",
  "isMetalOrClay":          false,
  "hasReplacementEvidence": false,
  "roofAgeYearsV2":         25,
  "roofAgeConfidenceV2":    0.30,
  "bestEstimateYearV2":     2001,
  "bestEstimateKindV2":     "first_install",
  "evidenceClass":          "VERIFIED_FIRSTROOF",
  "evidenceCount":          3,
  "replacementSignals":     0,
  "firstInstallSignals":    3,
  "roofAgeEvidence": [
    {"kind":"first_install","year":2001,"weight":0.300,"source":"yearBuilt:morgan-assessor-scrape","record":null},
    {"kind":"first_install","year":2019,"weight":0.200,"source":"building_footprints.ms_v2:release2","record":null},
    {"kind":"replacement","year":2024,"weight":0.85,"source":"storm-window-inference","record":"storm:abc123"}
  ]
}
```

## Suggested visual treatment for MetroMap.tsx

### Pin color by `priorityRank`

| priorityRank | Suggested color | Meaning |
|---|---|---|
| 1 | `#dc2626` (red-600) | BURNING PRIME — drop-everything-now |
| 2 | `#ea580c` (orange-600) | BURNING AGED |
| 3 | `#f59e0b` (amber-500) | URGENT |
| 4 | `#eab308` (yellow-500) | LIVE |
| 5 | `#84cc16` (lime-500) | AGED no-storm |
| 6 | `#10b981` (emerald-500) | PRIME-AGED no-storm |
| 7 | `#06b6d4` (cyan-500) | FRESH-STORM |
| 8 | `#9ca3af` (gray-400) | TOO_YOUNG |
| 9, 90, 99 | `#1f2937` (gray-800, very dim) | NOT_LEAD |

### Pin size scaled by `severitySubrank`

| severitySubrank | Pin scale |
|---|---|
| 1 (tornado EF2+) | 1.6× |
| 2 (tornado EF1) | 1.4× |
| 3 (hail ≥2") | 1.3× |
| 4 (hail 1.5–2") | 1.2× |
| 5 (wind ≥80mph) | 1.15× |
| 6 (hail 1.0–1.5") | 1.05× |
| 7 (wind 70–80mph) | 1× |
| null | 1× |

### Badge overlays

- `daysUntilClaimClose < 30` → red "🔥 N DAYS LEFT" badge in pin tooltip
- `evidenceClass = 'VERIFIED_REPLACEMENT'` → green "✓ permit on file" badge
- `hasReplacementEvidence = true` AND `priorityRank IN (90)` → grey "already replaced" cross-out
- `isMetalOrClay = true` → small icon indicating metal/clay (skip target)

### Default filter on metro page load

```sql
WHERE "metroCode" = 'north-alabama'
  AND ("priorityRank" IN (1, 2, 3, 4) OR "score" >= 60)
ORDER BY COALESCE("priorityRank", 99), "score" DESC NULLS LAST
LIMIT 5000
```

This shows BURNING + URGENT + LIVE leads, plus high-score-without-storm
properties, capped at 5k for fast first paint.

### Top-N "BURNING leads now" widget (sidebar)

```sql
SELECT "propertyId", "payloadPro"->>'address' AS address,
       "priorityLabel", "severitySubrank", "daysUntilClaimClose",
       "roofAgeYearsV2"
FROM property_pin_cards
WHERE "metroCode" = 'north-alabama' AND "priorityRank" IN (1, 2)
ORDER BY "priorityRank", "severitySubrank", "daysUntilClaimClose",
         "roofAgeYearsV2" DESC
LIMIT 20
```

Renders the immediate-call-now list. Click → fly map to that pin.

---

## Refresh cadence

Pin-cards are stale after `roof_age_v2` or `lead_priority` changes. The
`scripts/refresh-roof-signals.sh` cron pipeline includes pin-cards in
its rebuild chain — run every 4 hours via cron and the map stays fresh.
