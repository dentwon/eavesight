## Pre-flight findings — 2026-04-29 overnight session

### Existing infrastructure (verified)
- `scripts/permit-common.js` — shared `upsertPermit()`, `classify()`, `ROOF_RE`, `makePool()`. DB: `localhost:5433/eavesight`.
- `scripts/lib/property-signal-emit.js` — `emitSignal()` with ON CONFLICT-safe insert; `resolvePropertyId()` with three-strategy fallback (parcelId → lat/lon ±50m → address ILIKE).
- `scripts/harvest-huntsville-licenses.js` — ASP.NET ViewState pattern (`extractViewState()` parses `__VIEWSTATE / __VIEWSTATEGENERATOR / __VIEWSTATEENCRYPTED / __EVENTVALIDATION`).
- `scripts/permits-decatur.js` — concrete reference: parse → upsertPermit → resolvePropertyId → emitSignal('reroof_permit', confidence: 0.95, source: 'permit.decatur').
- `scripts/compute-scores-v3.sh`, `scripts/compute-scores-v3.sql`, `scripts/build-pin-cards-v4.sql` — all present.
- `building_permits` table — present (raw SQL, not Prisma-tracked). Unique on `(source, permit_number)` for idempotent re-runs.

### `property_signals` index audit
Existing indexes cover the cross-validation join cleanly:
- Unique constraint on `(propertyId, signalType, source, sourceRecordId)` → prefix-scan covers any `WHERE propertyId=? AND signalType=? AND source=?` query.
- `property_signals_property_idx (propertyId)` covers JOIN USING (propertyId).
- `property_signals_type_idx (signalType, signalDate DESC)` covers type-filtered scans.
- **No new index needed** for tonight's workload (Decatur + Madison-City + Madison-County permits + Prithvi roof-age rows).

### Source-naming convention (correction to handoff)
Existing convention is **dot-separated**: `permit.decatur`, not `permits-decatur`. Following this for new scrapers:
- Madison City: `source='permit.madison-city'`
- Madison County: `source='permit.madison-county'`
- Prithvi: `source='prithvi.travis-v1'` (already locked)
- OSM: `source='osm'`

### MS v2 sourceId mapping (correction to handoff)
Handoff said: *"your existing sourceId like `ms-87310` should ALREADY map to MS feature IDs in this dataset."* **Not true.** Existing `building_footprints.sourceId` follows two patterns:
- `ms-NNNNN` (e.g. `ms-87310`)
- `ms-exp-NNNNN` (e.g. `ms-exp-79553`)

These are internal IDs from a prior MS v1 + expansion-set ingest, NOT MS v2 GeoJSON feature IDs. **Will fall back to spatial-centroid match** with ~30m tolerance, using existing btree index on `(centroidLat, centroidLon)`.

### Connectivity check (verified)
- Madison City Tyler eSuite (https://buildportal.madisonal.gov/...): HTTP 200, sets `esuite-session` cookie, ASP.NET 4.0.30319, IIS 10. Walkme + Duo in CSP (decorative).
- Madison County Tyler eSuite (https://esuite-madisonco-al.tylertech.com/nwprod/...): HTTP 200, identical shape. Different host = Tyler-hosted multi-tenant.
- MS v2 Alabama.geojson.zip: HTTP 200, 89.3 MB, last modified 2024-11-07.

### Permit type IDs (per `docs/roof-age-dragnet.md`)
- Madison City: types **31** (commercial roofing) + **32** (residential roofing)
- Madison County: types **33** (residential roofing) + **34** (commercial roofing)

### Prior `permits.cullman.js` lesson — captcha gating
Cullman's iWorQ portal renders rows only after a reCAPTCHA-validated POST. If Madison-City/County portals exhibit similar gating after first GET, log + halt rather than burn cycles. Watch for empty `<tbody>` + `g-recaptcha`/`recaptcha` markers in response body.

### Pre-flight verdict
Green light to proceed. All assumed infrastructure confirmed; two handoff corrections noted above (source naming + MS v2 ID mapping) will be reflected in the actual scrapers and backfill scripts.
