# Data Lookup Index — "Before You Search The Web"

Last verified: 2026-04-24 late (Phase 7-A scorer v3 + pin_cards v3)

**Purpose:** when a question comes up like *"what's the roof age on 123 Oak St?"* or *"do we have phone numbers?"*, this file answers in one grep **whether we already have it**, **where it lives**, and **what quality it is**, so no future session repeats research.

**How to use:** Ctrl-F for the thing you need. If you find it here, use the DB. If it says "NOT IN DB" or "EMPTY", then (and only then) consider a new harvester or external API.

---


---

## ⚠️ 2026-04-24 state note — UNLOGGED staging tables wiped

Postgres restarted 2026-04-23 06:11:59 UTC. Every UNLOGGED table lost all rows. If anything references these in harvester docs, assume they are currently empty:

| Table | Old rows | Current | Source-of-truth content? |
|---|---|---|---|
| `_harvest_ext` | 248,584 | 0 | already in `properties` / `property_enrichments` — no re-ingest needed |
| `_harvest_parcels` | 139,349 | 0 | already in `properties` |
| `_harvest_mj` | 109,086 | 0 | Marshall/Jackson BBOX bug still outstanding — re-ingest only after fixing BBOX |
| `_osm_poi` | 15,675 | 0 | re-ingest if we want POI joins (not currently wired to scorer) |
| `_fema_flood` | 6,909 | 0 | never landed in `properties.femaFloodZone` anyway; harvester bug still open |
| `_acs` | 503 | 0 | already in `property_enrichments` |
| `_bg` | 503 | 0 | block-group raw; `tiger_bg_al` (3,925 rows, LOGGED) is what we actually query |

If you re-ingest any of these, `ALTER TABLE <name> SET LOGGED` before populating so the next restart does not nuke it again.

## 📍 Quick lookup by question

### "Do we have roof age?"
- ✅ **Age-20 heuristic**: `SELECT * FROM properties WHERE "yearBuilt" >= 2006` — ~55k rows, BUT ~75% inferred (KNN + ACS-median), 25% real (madison assessor + COC) as of 2026-04-24 late
- ✅ **New-construction certain**: 1,992 rows via `roofInstalledAt IS NOT NULL AND roofInstalledSource='coc-new-construction'` (Huntsville CoC only, years 2020-2026)
- ✅ **VERIFIED yearBuilt**: **60,055 rows** (58,977 Madison assessor + 1,078 COC) — `"yearBuiltSource" IN ('madison-assessor-scrape','huntsville-coc-new-construction')`. Madison scraper exited 'no work' at 23:39Z 04-24 — scrape may be effectively done.
- ✅ **Pin-card derived `roofAgeSource`** (since 2026-04-24 v3): `coc` (~1,992), `assessor` (~59k), `unknown` (rest). Live in `property_pin_cards.payloadFree` and `payloadPro`.
- ❌ **Real reroof permits**: DB has zero. Permit scrapers (Madison City/County Tyler eSuite, Decatur CityView, etc.) not built yet.
- ❌ **Roof condition / pitch / material**: `roof_data` table EMPTY (0 rows)
- **DO NOT** search web for property age / build year — use `properties.yearBuilt` directly (acknowledging confidence)

### "Do we have homeowner contact info?"
- ✅ **Owner name**: 96.8% (`properties.ownerFullName`)
- ✅ **Owner mailing address**: 22.3% (`properties.ownerMailAddress`)
- ❌ **Phone**: 0% (`properties.ownerPhone`, `property_enrichments.ownerPhone`)
- ❌ **Email**: 0% (`properties.ownerEmail`, `property_enrichments.ownerEmail`)
- ❌ **DNC list**: `dnc_entries` table EMPTY
- → Skip-trace API (BatchData, Propstream, Propwire) needed for phone/email

### "Is this property in a flood zone?"
- ❌ **DO NOT USE** `properties.femaFloodZone` or `femaFloodRisk` — both BROKEN. All 242,987 rows = 'X' / 'MINIMAL'. Harvester has a bug.
- ✅ **Alternate**: `madison_parcel_data.floodZone` (Madison only, 76.7% populated)
- → Fix `harvest-fema-flood.js` before trusting flood data

### "Has this property been hit by storms?"
- ✅ **Raw intersections**: `property_storms` table — 6.59M rows, 237,343 distinct parcels (97.7% of DB). Join by `propertyId`.
- ✅ **Storm metadata**: `storm_events` — 2.12M rows (SPC), 2012-2026, HAIL/WIND/TORNADO typed
- ❌ **Rollup column on properties**: `hailEventCount` / `hailExposureIndex` are DESYNCED (only 4,668 / 70,830 rows > 0 — should be ~203k for hail). Re-run rollup before trusting.
- Query: `SELECT count(*) FROM property_storms ps JOIN storm_events e ON e.id=ps."stormEventId" WHERE ps."propertyId"='X' AND e.type='HAIL'`

### "What county / city / metro is this?"
- ✅ `properties.county` 100% (Madison 153,627 / Limestone 42,354 / Morgan 42,258 / Marshall 3,284 / Jackson 1,464)
- ✅ `properties.metroCode` 100%
- ✅ `properties.censusTract` / `censusBlockGroup` 100% (also in `property_enrichments`)
- ✅ `properties.h3r6` / `h3r8` 100%

### "How big is the roof / building?"
- ✅ **Roof footprint area**: `properties.roofAreaSqft` 100% (from MS Building Footprints)
- ✅ **Size class**: `properties.roofSizeClass` 100% (LARGE_RESIDENTIAL, RESIDENTIAL, SMALL_COMMERCIAL, etc.)
- ✅ **Footprint geometry**: `building_footprints.geometry` (jsonb) + `building_footprints.geom` (PostGIS point)
- ⚠️ **Interior sqft**: `properties.sqft` only 14.3% — not reliable
- ❌ **Roof pitch / facets / ridges / valleys**: `roof_data` table EMPTY

### "What's the property worth?"
- ✅ **Assessed value**: 96.6% (median $32,140, p90 $269,700)
- ✅ **Market value**: 96.7%
- ❌ **Tax amount**: 0%
- ⚠️ **Last sale price**: only 9.8%
- ⚠️ **Last sale date**: 56.1%
- ✅ **Building value (Madison only)**: `madison_parcel_data.totalBuildingValue` 82.7%

### "Who owns this? (with mailing info)"
- ✅ **Name**: `properties.ownerFullName` 96.8%, `.ownerFirstName`, `.ownerLastName`
- ✅ **Owner-occupied**: `properties.ownerOccupied` 22.3%
- ⚠️ **Mailing addr**: `ownerMailAddress`/`City`/`State`/`Zip` 22.3%
- ✅ **Madison detail**: `madison_parcel_data.propertyOwner` 98.5%, `.mailingAddressFull`, `.previousOwners`

### "What permits are on file?"
- ✅ **Huntsville BMS**: 17,516 rows, source='huntsville' (2017-2026)
- ✅ **Huntsville CoC**: 12,901 rows, source='huntsville-coc' (used for roofInstalledAt on new-construction)
- ❌ **Madison County**: Tyler eSuite not scraped
- ❌ **Madison City**: Tyler eSuite not scraped
- ❌ **Decatur / Cullman / Athens / Scottsboro**: not scraped
- ⚠️ Existing permits have **NO contractor name** (column 100% NULL). Also `is_roofing` never classified (all 0). permit_type only has 5 values — no "Roofing".
- ⚠️ Raw jsonb (`building_permits.raw`) has extra fields like `Address`, `Subdivision`, `BuildingSize`, `ContractAmount`, `OccupancyType`, `Permit_Issue_DateTime` — mine before scraping new

### "Do we know contractors / roofers?"
- ✅ `contractor_licenses` table — 185 rows, Huntsville biz licenses only, 54 flagged `is_roofing_kw=true`
- ❌ **Statewide AL HBLB roster**: not harvested yet
- ❌ **Permit-contractor join**: can't — `building_permits.contractor` is 100% NULL

### "Demographics / income / tenure / homeownership"
- ✅ `properties.medianHouseholdIncome` 97.5%
- ✅ `properties.ownerOccupancyRate` 100%
- ✅ `property_enrichments.medianHomeValue` 96.4%, `homeownershipRate` 98.9%, `medianAge` (varies)
- ✅ `property_enrichments.populationDensity` (if populated — check)

### "Storm event catalog"
- ✅ `storm_events`: 2,115,226 rows, 2012-2026
  - SPC 99.8% (hail 845,528 · wind 1,122,383 · tornado 147,257)
  - NOAA 3,577
  - FEMA 64
- Each has `lat`/`lon`, `severity` (LIGHT/MODERATE/SEVERE/EXTREME), `hailSizeInches`, `windSpeedMph`, `tornadoFScale`

### "Madison-specific parcel fields"
Use `madison_parcel_data` (174,026 rows) for:
- zones: `zoning`, `hubZone`, `opportunityZone`, `tifDistrict`, `slopeDistrict`, `eDistrictName`, `taxDistrict`
- historic: `localHistoricDistrict`, `nationalHistoricDistrict`, `historicBuilding`
- commercial: `industrialPark`, `trafficCount` (3.3%), `majorRoad`
- school: `highSchool`
- travel-time to landmarks: `bridgeStreet15/30`, `hospital15/30`, `marshall15/30`, `nhip15/30`, `toyota15/30`
- ownership: `propertyOwner` 98.5%, `previousOwners`
- subdivision: 76.7%
- ❌ `deedDate`: column exists but 0% populated (scraper gap)

### "H3 hex aggregates"
- ✅ `property_hex_aggregates` — 4,660 rows (rollups by h3 cell)
- ✅ `properties.h3r6` / `.h3r8` per-parcel 100%

### "Census / tract data"
- ✅ `properties.censusTract` 100%, `.censusBlockGroup` 100%
- ✅ `tiger_bg_al` — 3,925 block-group geometries
- ✅ `property_enrichments.medianYearBuilt` (from ACS B25035, 1938-2014)

---

## 🧭 Data-need → table/column map (condensed)

| What you're looking for | Where it lives |
|---|---|
| Property age / year built | `properties.yearBuilt` (+ `yearBuiltSource`, `yearBuiltConfidence`) |
| Roof age (trusted) | `properties.roofInstalledAt` (0.82%, new-construction only) |
| Roof age (inferred) | derive from yearBuilt via age-20 rule |
| Roof area / size | `properties.roofAreaSqft`, `.roofSizeClass` |
| Roof pitch / material | ❌ nowhere (`roof_data` empty) |
| Geo coordinates | `properties.lat`, `.lon` |
| Hex bucket | `properties.h3r6`, `.h3r8` |
| Owner name | `properties.ownerFullName` |
| Owner mailing addr | `properties.ownerMailAddress*` (22%) or `madison_parcel_data.mailingAddressFull` |
| Owner phone / email | ❌ nowhere |
| Owner-occupied flag | `properties.ownerOccupied` (22%) |
| Assessed / market value | `properties.assessedValue`, `.marketValue` |
| Tax amount | ❌ nowhere |
| Sale history | `properties.lastSaleDate` (56%), `.lastSalePrice` (10%) |
| Madison deeds | ❌ `madison_parcel_data.deedDate` empty |
| Flood zone | ❌ `properties.femaFloodZone` BROKEN · use `madison_parcel_data.floodZone` (Madison only) |
| Hail events on parcel | `property_storms` JOIN `storm_events` WHERE type='HAIL' |
| Wind / tornado / etc | same, adjust type filter |
| Rolled-up hail counts | ⚠️ `properties.hailEventCount` DESYNCED, recompute from property_storms |
| Storm catalog | `storm_events` |
| Permits on parcel | `building_permits WHERE property_id = ?` (but 42% orphans unlinked) |
| Contractor list | `contractor_licenses` (185 rows, Huntsville-only) |
| Parcel footprint | `building_footprints` |
| Subdivision | `madison_parcel_data.subdivision` (Madison only, 77%) |
| Census income | `properties.medianHouseholdIncome` |
| Census tract | `properties.censusTract` |
| Score (v3) | `properties.score` (0-84, avg 41.34) · `properties.urgencyScore` · `properties.opportunityScore` · `properties.scoreReasons` jsonb (version='v3'). Hot=173 / Warm=14,166 / Cool=131,896 / Cold=96,752. |
| Score reasons | `properties.scoreReasons` jsonb: `urgency.{score,spcHail*,yearBuilt,roofAgeClass}` · `triggers.{probate,recentTransfer,investorFlip,tenureYears}` · `revenue.{estimate,roofAreaSqft,roofSizeClass}` · `occupancy.{ownerOccupied}` · `bullets[]` |
| Owner-history triggers | derived in `_trig` CTE during pin-card / scorer build. Probate=9,065 · recent transfer=60 · investor flip (3+ owners/5y)=2,277. Exposed as `hasProbateTrigger` / `hasRecentTransfer` / `hasInvestorFlip` on pin cards. |
| Pin card payload (free) | `property_pin_cards.payloadFree` jsonb · 31 keys avg · score+yearBuilt+SPC counts+triggers+topReasons. Built by `pinCardsSql()` (v3). |
| Pin card payload (pro) | `property_pin_cards.payloadPro` jsonb · 56 keys avg · adds owner detail, ownerHistory, recentStorms[], roof material/type, distinct_owners_5y. |
| Earmark state | `properties.isEarmarked`, `.earmarkedAt`, `.earmarkReason` |
| Dormant cohort | `property_pin_cards.payloadFree.dormantFlag` (boolean, derived: high SPC exposure but no permit + roof >= 20y). `properties.dormantFlag` column itself still all false — score logic doesn't write it back. |
| API usage / quotas | `api_usage`, `api_quotas` — EMPTY |
| Canvass sessions | EMPTY |
| Leads | `leads` — 4 rows |

---

## 🔑 Source-of-truth enums

**yearBuiltSource values** (exact strings) — as of 2026-04-24 late:
- `census-acs-b25035-2023` → ACS tract median, 104,420 rows (shrinking)
- `knn-r1000m-k5` → neighbor imputation, 78,511 rows (shrinking)
- `madison-assessor-scrape` → real assessor, **58,977 rows** (+55,757 since 04-22)
- `huntsville-coc-new-construction` → CoC, 1,078 rows
- `madison-assessor-500-skip` → PERMA_SKIP sentinel, 1 row (parcel 527798 — Tyler returns HTTP 500 regardless of pacing)

**yearBuiltConfidence enum:** VERIFIED · NEIGHBOR_KNN · ACS_MEDIAN · NONE

**roofInstalledSource values:**
- `coc-new-construction` → 1,992 rows (only one; all new-construction, zero reroof)

**property_pin_cards.roofAgeSource values** (after 2026-04-24 v3 rebuild):
- `coc` → 1,992 (Huntsville new-construction certs)
- `assessor` → ~59k (madison-assessor-scrape)
- `acs` → ~104k (ACS tract median anchor — passes 35-year stale gate)
- `knn` → ~79k (neighbor imputation — passes stale gate)
- `unknown` → remainder (no anchor or stale beyond 35y)
- Builder respects 35-year stale gate: any anchor older than `CURRENT_DATE - 35y` falls through to `unknown`.

**Pin-card v3 schema (NEW 2026-04-24):**
- `payloadFree` (~31 keys): id, lat, lon, address, score, scoreBucket, yearBuilt, yearBuiltIsReal, yearBuiltConfidence, roofAge, roofAgeSource, dormantFlag, spcHailCount, spcHailCount5y, spcHailLastDate, spcHailMaxInches, spcWindCount, spcTornadoCount, spcTornadoLastDate, spcSevereOrExtremeCount, hailExposureIndex, hailEventCount, hasProbateTrigger, hasRecentTransfer, hasInvestorFlip, topReasons[], tier='free'
- `payloadPro` (~56 keys): all of free + ownerFullName, ownerOccupied, marketValue, lastSaleDate, lastSalePrice, roofAreaSqft, roofSizeClass, roofMaterial, roofType, distinct_owners_5y, tenure_years, last_transfer_year, recentStorms[] (full jsonb), urgencyScore, opportunityScore, revenuePotential, tier='pro'

**permit.source values:** `huntsville` · `huntsville-coc`

**storm_events.source values:** `SPC` · `NOAA` · `FEMA`

**storm_events.type enum:** HAIL · WIND · TORNADO · TSTM · FLOOD · HURRICANE · OTHER

**storm_events.severity enum:** LIGHT · MODERATE · SEVERE · EXTREME

**roofSizeClass values:** LARGE_RESIDENTIAL · RESIDENTIAL · SMALL_COMMERCIAL · MEDIUM_COMMERCIAL · LARGE_COMMERCIAL · WAREHOUSE_INDUSTRIAL

---

## 💡 Decision tree: do I need to go fetch data?

```
Question comes in: "do we have X?"
   │
   ├─ Ctrl-F this file for X or synonyms
   │    │
   │    ├─ FOUND and marked ✅ → use the DB (query shown)
   │    ├─ FOUND and marked ⚠️ → use the DB but note the caveat
   │    ├─ FOUND and marked ❌ → skip DB, continue decision tree
   │    └─ NOT FOUND → assume not in DB yet
   │
   ├─ Is it on the KILLED list (SESSION_STATE.md)?  → DO NOT retry
   │
   ├─ Is it in the LIVE WORK QUEUE (SESSION_STATE.md)?  → known gap, just note it
   │
   └─ New data need?
        → check roof-age-dragnet.md + data-source-hunt-2026-04-22.md
        → if genuinely new, add to work queue
```

---

## 🔁 Keep this file fresh

Update when:
- A new table starts getting rows (move from EMPTY list)
- A previously-empty column gets populated
- A broken harvester gets fixed (update the ❌/⚠️ markers)
- A new data source goes live

Quick verification command to re-sync row counts:
```bash
ssh <user>@<host> 'export PGHOST=localhost PGPORT=5433 PGUSER=eavesight PGPASSWORD=<password> PGDATABASE=eavesight
for t in $(psql -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='"'"'public'"'"' ORDER BY 1"); do
  n=$(psql -t -A -c "SELECT count(*) FROM \"$t\"")
  printf "%-28s %s\n" "$t" "$n"
done'
```
