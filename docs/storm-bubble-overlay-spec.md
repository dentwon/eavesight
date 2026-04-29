# Storm Bubble Overlay — UX Spec

**Date:** 2026-04-29
**Status:** Spec only — no MetroMap.tsx changes (Desktop's lane)
**Audience:** whoever builds the map UI next (Desktop or Code, depending on lane decisions next week)

---

## Goal

A roofer demoing the dashboard to a prospect should be able to scrub a date slider and watch the map "bloom" with the storm cells that hit that day, side-by-side with hot leads in the affected area. The wow moment is **temporal alignment** — they see leads light up exactly where storms hit, on the days they hit. It makes the lead-score's "post-hail urgency" component visible instead of buried in a number.

This is the actual sales-demo feature called out in the peer-review (`docs/PRITHVI_TRACK_REVIEW_2026-04-29.md` §"Opportunity cost is real"). The Prithvi track is research; this is the live-demo feature.

---

## Data we have right now

| Metric (2020-01-01 →) | AL state | N-AL counties (12) |
|---|---|---|
| Storm events | 14,374 | 1,243 |
| Distinct days | 457 | 68 |
| Top day | 2026-04-28 (6,932 hail events nationally) | (similar; not yet aggregated) |

`storm_events` schema (already in DB):
- `id text PK`
- `type StormType` (HAIL / WIND / TORNADO / FLOOD)
- `severity Severity?`
- `date timestamp(3)` — event start
- `endDate timestamp?` — event end (often NULL)
- `lat double precision?`, `lon double precision?` — point geometry (most events)
- `pathGeometry jsonb?` — line geometry (tornado paths)
- `affectedArea jsonb?` — polygon (hail swath, when known)
- `widthYards`, `lengthMiles` — for tornado/wind tracks
- `hailSizeInches`, `windSpeedMph`, `tornadoFScale` — severity attributes
- `state varchar(2)`, `county text` — geoadmin

For hail (the dominant type for roofing), the typical row is `(lat, lon, date, hailSizeInches)` — a point with size. ~5–20 hail points cluster per cell.

---

## UX spec — three controls, one map state machine

### 1. Date slider (day-resolution)

**Position:** bottom of map, full-width, sticky to viewport.

**Range:** dynamic — earliest event in current viewport bbox to today. Typical N-AL range: 2018-01-01 → today (8+ years).

**Tick marks:**
- Major: years
- Minor: storm-event-density quartiles. The slider visually "weighs" — denser storm days have a darker band underneath the slider so the user can scrub directly to known events without trial-and-error.

**Default state on metro page load:**
- Slider position: today (rightmost)
- Window: trailing 90 days (today minus 90, today)
- This shows "all leads with recent storm exposure"

**Interaction:**
- Drag slider thumb: window slides ±90 days as one unit
- Click a tick: jump-to-day, window collapses to ±2 days around that day for "single-event" focus
- Double-click anywhere on track: reset to default trailing-90
- Keyboard: `←` / `→` advances by 1 day, `Shift+←/→` advances by 30 days

### 2. Storm-type filter chips (above slider)

**Chips:** [ All • Hail • Wind • Tornado ]

Hail is checked by default — that's the roofing-relevant signal. Multiple chips can be active.

### 3. Severity threshold (below chips, collapsed by default)

For Hail: minimum `hailSizeInches` slider 0.5 → 4.0 (default 1.0 — golf-ball-and-larger is the actionable threshold).
For Wind: minimum `windSpeedMph` slider 35 → 100 (default 60).
For Tornado: minimum `tornadoFScale` (default EF0 / no filter).

---

## Map state machine: "bloom on scrub"

### Layer stack (z-order, bottom → top)

1. Existing metro choropleth (untouched)
2. **NEW** `storm-bubbles-layer` — circles sized by severity, colored by type, opacity decays by age relative to current slider window center
3. **NEW** `storm-paths-layer` — tornado/wind path polylines (when filter includes those types)
4. Existing property pins (untouched, but drawn on TOP of bubbles)
5. Hover tooltips

### Bloom animation

When the slider moves, storm bubbles do not pop in/out — they **bloom**:
- Bubbles entering the window: opacity 0 → 1 over 250ms, scale 0.6 → 1.0
- Bubbles inside the window: opacity = `1 - (|days_from_window_center| / window_halfwidth) * 0.6` (so the center day's bubbles are full opacity, edges fade to 40%)
- Bubbles exiting: opacity 1 → 0 over 200ms, scale 1.0 → 0.6

This gives a "weather radar replay" feel as the user scrubs — the eye tracks the cells across the map without flicker.

### Bubble sizing

`radius_px = clamp(severityToRadius(event), 4, 32)` where:
- HAIL: `12 * (hailSizeInches / 1.0)` (1" = 12px, 2" = 24px, etc.)
- WIND: `8 + 0.2 * windSpeedMph` (60mph = 20px, 100mph = 28px)
- TORNADO: `16 + 4 * fScale` (EF0 = 16px, EF4 = 32px)

### Bubble color

By type:
- HAIL: `#fbbf24` (amber-400) — universally read as "hail"
- WIND: `#60a5fa` (blue-400)
- TORNADO: `#dc2626` (red-600)

Severity overlay: stroke width = `clamp(severityToStrokeW(event), 1, 3)`. Inside fill at 0.5 alpha so overlapping cells additively darken (visual "intensity").

---

## Spatial-query bounds

The browser cannot fetch all 14k AL events for a metro view. Strategy:

1. On viewport bbox change, frontend asks `/api/storms/bbox?bbox=...&since=...&until=...&types=HAIL,WIND&minHailIn=1.0` for the current window
2. Backend returns, at most, **2,000 rows** ordered by severity desc — server-side cap + tile-level supersampling for very dense days
3. If the query would exceed 2,000, server returns a `density-tile-fallback` flag and the frontend renders a simpler heatmap raster instead of per-event bubbles for that day

API endpoint already half-exists (`apps/backend/src/storms/...` if scaffolded; otherwise a new controller route). One thin SQL:

```sql
SELECT id, type, date::date AS day, lat, lon,
       "hailSizeInches", "windSpeedMph", "tornadoFScale", severity
  FROM storm_events
 WHERE state = 'AL'
   AND date BETWEEN $1 AND $2
   AND lat BETWEEN $3 AND $4
   AND lon BETWEEN $5 AND $6
   AND type = ANY($7::"StormType"[])
   AND ("hailSizeInches" IS NULL OR "hailSizeInches" >= $8)
 ORDER BY severity DESC NULLS LAST, "hailSizeInches" DESC NULLS LAST
 LIMIT 2000
```

Existing index on `(date, lat, lon)` should cover this (verify before launch).

---

## What to add to MetroMap.tsx (one-paragraph cheat-sheet)

When Desktop (or whoever) does the build, the diff is:

1. New top-level component `StormBubbleOverlay` (separate file, not inside `MetroMap.tsx`).
2. Mount it as a child of `<MetroMap>` accepting `bbox` + `dateWindow` + `filters` as props.
3. Inside `StormBubbleOverlay`, fetch via `/api/storms/bbox`, render mapbox `circle` source + layer for points and `line` source + layer for paths.
4. Add `<DateSlider>` component (separate, also not inside MetroMap.tsx) at the bottom of the dashboard layout, hoisting `dateWindow` state up to the metro-page level so multiple panels can subscribe.
5. The only MetroMap.tsx change should be the `<children>` slot accepting overlays — if that slot doesn't exist, add it (one-line change). Everything else lives in new files.

This keeps MetroMap.tsx clean (Desktop's lane) and lets the bubble overlay be developed in isolation.

---

## What we explicitly DON'T do in v1

- No per-property storm-overlap badge on the map (that's a `property_storms` materialized-view query for a different ticket)
- No timeline-style "scrub to play forward" auto-play (nice-to-have for v1.1 — the user can always drag the slider themselves)
- No mobile bottom-sheet variant (defer to mobile-app pass)
- No storm-track tooltip on tornado paths (text on hover is enough; full storm-report popover is v1.1)
- No per-metro pre-baked tile rasters (we'd want this if 2,000 cap proves too tight; not a v1 concern)

---

## Wow-moment scripted demo (60-second version)

1. Roofer prospect lands on Huntsville metro page (default trailing-90)
2. Demo presenter says "watch this" and drags the slider back to **2026-04-15**
3. Map blooms with ~70 hail bubbles spanning Madison + Limestone counties (max hail size 4 inches)
4. Demo presenter zooms to a Madison neighborhood — bubbles overlap dozens of red/orange property pins (high-urgency leads)
5. Demo presenter clicks a single property pin — popover shows "Storm exposure: hail 1.5\" on 2026-04-15. Owner: TYPE-1 dormant lead."
6. Presenter says "you'd never have known to door-knock this house. It's not on Zillow as 'storm-damaged'. But the data says it is."

That's the close. Roof age + storm overlap + the visual proof of overlap, all in one frame.

---

## Open questions before build

1. Does `/api/storms/bbox` already exist? If yes, sanity-check shape; if no, ~30 min of backend work.
2. Is there an index on `(date, state)` or `(state, date, lat, lon)` for storm_events? Probably yes; verify with `\d storm_events`.
3. Mapbox or MapLibre? (Affects `circle` layer paint expression syntax — minor.) The current MetroMap.tsx will tell us.
4. Should the slider window ±90 days be per-metro-configurable? Probably yes, store in user prefs, but ship a hardcoded default first.

When this gets built, refer back to this spec and check off "what to add to MetroMap.tsx" — keeps the lane boundary clean.
