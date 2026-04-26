# Data Pipelines — Where Each Field Comes From, How Often It Refreshes
Every ingestion job and transformation, organized by source-of-truth.
The goal of this doc: when something looks wrong, you know which job
to suspect.
## Pipeline categories
1. [Property assessor scrapers](#assessors) — yearBuilt, sqft, roofType, owners
2. [Building footprints](#footprints) — polygon + centroid lat/lon
3. [Storm ingestion](#storms) — SPC + MRMS + NWS + NOAA
4. [Permits](#permits) — REROOF + new-construction + alterations
5. [Census / demographic](#census) — ACS + TIGER block groups
6. [Flood](#flood) — FEMA NFHL polygons
7. [Geographic enrichment](#geo) — geocoding, address matching, FIPS resolution
8. [Scoring + pin cards](#scoring) — derived presentation layer
9. [Real-time pipeline](#realtime) — NWS alerts polling, daily syncs
---
## <a id="assessors"></a>1. Property assessor scrapers
### Madison County (Tyler eSuite)
- **Source**: `madison.countygovservices.com` parcel detail pages
- **Driver**: `scripts/enrich-yearbuilt-supervisor.js` orchestrates 8 PIA-VPN-tunneled workers (`scripts/enrich-yearbuilt-worker.js`)
- **Why VPN**: Tyler bans repeat IPs after ~few hundred requests. 8 workers in 8 PIA regions sustain ~3,400 parcels/hour
- **Cadence**: One-shot batch (currently running). Re-run yearly or when permits suggest new construction
- **Output**: `properties.yearBuilt`, `sqft`, `roofType`, `roofMaterial`, owner fields, `ownerHistory`, valuation fields, `yearBuiltSource='madison-assessor-scrape'`
- **State**: 96,962/153,627 done, ETA ~5am tomorrow
- **Failure modes**: 403/429 rotate region; HTTP 500 on parcel 527798 marked `madison-assessor-500-skip`
- **Logs**: `<repo-root>/logs/supervisor.log`
### Marshall County (Tyler — different subdomain)
- **Source**: `marshall.countygovservices.com`
- **Driver**: `scripts/enrich-marshall.js` (built today)
- **Cadence**: Single-script, no VPN, 8s delay
- **State**: Just relaunched with `--limit=2100`, ETA ~5h
### Limestone + Morgan (E-Ring CAMA, blocked)
- **Source**: `express.limestonerevenue.net`, `morgan.capturecama.com`
- **Status**: **Blocked** — APIs require Cognito JWT from anonymous SPA bootstrap
- **Next step**: Build Playwright helper to extract JWT hourly, then existing scripts work
### Jackson (no public detail surface)
- **Status**: **Blocked** — Tyler payment-only portal returns 404 on all detail patterns; ISV map is reCAPTCHA-gated
- **Workaround**: File ALDOR Section 13 public-records request — only 943 parcels, cheaper than building a captcha solver
---
## <a id="footprints"></a>2. Building footprints
### Microsoft GlobalMLBuildingFootprints v1 (current)
- **Source**: GitHub release ZIP per-state
- **Driver**: `scripts/import-footprints.js` — **HAS KNOWN BUG**: hardcodes city=Huntsville, zip=35801, county=Madison, address=`ms-N`. Do NOT re-run as-is for new counties — would mis-tag thousands of rows
- **Fix priority**: HIGH (blocks expanding to other counties)
### MS GlobalMLBuildingFootprints v2 (pending backfill)
- **What's new**: `capture_dates_range` (date span when imagery was captured) + `release` field
- **Why we want it**: Gives us a "building existed by year X" lower bound — supplements yearBuilt
- **Cadence**: One-shot backfill onto our existing 242,987 footprints
- **State**: Agent built investigation, backfill script pending
---
## <a id="storms"></a>3. Storm ingestion
### SPC Storm Reports (Storm Prediction Center)
- **Source**: `spc.noaa.gov/climo/reports/`
- **Driver**: `scripts/import-spc-storm-reports.js`
- **Cadence**: Every 30 min (real-time tail) + daily 2am gap-fill + Sunday 4am weekly backfill
- **What it gives**: `storm_events` rows for every reported hail / wind / tornado in the US since 1950
- **Volume**: ~1.5M historical + ~50/day new
### MRMS MESH (Multi-Radar)
- **Source**: NOAA MRMS GRIB2 archives
- **Driver**: `scripts/fetch-mrms-mesh.py` (Python — uses pygrib for GRIB2 parsing)
- **Cadence**: Every hour (real-time)
- **What it gives**: Pixel-level hail-size estimates → `_mrms_mesh` table → aggregated to `properties.hailEventCount`, `hailExposureIndex`
### NWS Severe Weather Alerts
- **Source**: api.weather.gov
- **Driver**: `apps/backend/src/storms/storms.processor.ts` (NestJS BullMQ scheduled job)
- **Cadence**: Every 3 minutes
- **What it gives**: Active warning polygons → users in affected polygons can be alerted
### NOAA Storm Events DB
- **Source**: `ncei.noaa.gov/stormevents/`
- **Driver**: `scripts/import-damage-surveys.js`
- **Cadence**: 3am daily
- **What it gives**: NWS county-level reports + narratives — supplements SPC points
### IEM warning polygons
- **Source**: Iowa Environmental Mesonet — historical NWS warning polygons
- **Driver**: `scripts/import-nws-warnings.js`
- **Cadence**: One-shot historical, then incremental
### SVRGIS tornado tracks (PENDING)
- **Source**: SPC SVRGIS shapefile archive
- **Will populate**: `storm_events.pathGeometry` for 32,635 tornadoes in our area
- **Status**: Designed, not yet built
---
## <a id="permits"></a>4. Permits
### Huntsville CoC (City of Construction)
- **Source**: Huntsville new-construction permit feed
- **Output**: 1,078 properties tagged `huntsville-coc-new-construction` with `roofInstalledAt = construction year`
### Madison County
- **Source**: Madison County building permits portal
- **Volume**: 30,417 permits, only 202 matched to properties (0.7%) — limited by ms-* placeholder addresses
### Decatur CityView (added today)
- **Source**: PDFs at decaturalabamausa.com (monthly bulk PDFs)
- **Driver**: `scripts/permits-decatur.js`
- **State**: 99 new permits inserted, 3 marked roofing
- **Cadence**: Monthly (when new PDF posts)
### Pending scrapers
- **Athens GovBuilt** — needs Playwright + Cloudflare Turnstile bypass
- **Cullman** — needs reCAPTCHA solver
- **Scottsboro Cloudpermit** — login wall, no public surface
- **Marshall trio (Albertville/Boaz/Guntersville)** — no online portal found
- **Madison Probate liens** — separate court database
### Hail × Permit Correlation Engine (NEW today)
- **Driver**: `scripts/hail-permit-correlation.sql`
- **Logic**: For every property, find permits issued 0-18 months after a hail ≥ 1.25" storm. Infer `roofInstalledAt = MIN(permit.issued_at)`.
- **Result today**: 519 properties got real roof install dates
- **Cadence**: Re-run after any new permit ingest
---
## <a id="census"></a>5. Census / demographic
### TIGER Block Groups
- **Source**: `tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/`
- **Driver**: `scripts/import-tiger-bg-al.js`
- **Cadence**: One-shot annually (boundaries change with each decennial census)
- **Output**: `tiger_bg_al` table (~4K rows for Alabama)
### ACS Extended (RUNNING NOW)
- **Source**: `api.census.gov/data/2023/acs/acs5`
- **Driver**: `scripts/harvest-census-acs-extended.js`
- **Tables pulled**: B25035 (median year built), B25034 (year-built decade), B25024 (units in structure), B25040 (heating fuel), B25041 (bedrooms)
- **Cadence**: Annual when new ACS 5-year vintage drops (December)
### Census Geocoding (RUNNING NOW for ms-* placeholders)
- **Source**: `geocoding.geo.census.gov/geocoder/geographies/coordinates`
- **Driver**: `scripts/geocode-ms-placeholders.js`
- **Cadence**: One-shot batch + on-demand for new properties
- **State**: 81% phase 1, will batch-stage 80K rows shortly
---
## <a id="flood"></a>6. Flood
### FEMA NFHL v2 (RUNNING NOW)
- **Source**: `hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28`
- **Driver**: `scripts/harvest-fema-flood-v2.js` (LOGGED replacement for wiped v1)
- **Cadence**: Quarterly (FEMA updates DFIRM panels infrequently)
- **Output**: `_fema_flood_v2` table → properties.femaFloodZone via polygon-point JOIN
---
## <a id="geo"></a>7. Geographic enrichment
### Address normalization
- **Driver**: `apps/backend/src/properties/normalizer.service.ts`
- **What it does**: USPS-style standardization for matching ("123 main st, apt 4" → "123 MAIN ST APT 4")
- **Updates**: `properties.addressNorm` (indexed)
### H3 metro assignment
- **Driver**: `scripts/assign-h3-metro.js`
- **What it does**: Tags each property with an H3 cell ID at resolution 6/8/12 for hex aggregation
### PMTiles export
- **Driver**: `scripts/generate-pmtiles.js`
- **Cadence**: After major data updates
- **Output**: Static `.pmtiles` files served from CDN, consumed by frontend MapLibre
---
## <a id="scoring"></a>8. Scoring + pin cards (derived)
### Scorer v3
- **Drivers**: `scripts/compute-scores-v3.sh` + `scripts/compute-scores-v3-fixup.sh`
- **Logic**: 45% urgency + 25% revenue + 20% trigger + 10% occupancy
- **Cadence**: Re-run after any input change (storms, owner history, yearBuilt)
- **Output**: `properties.score`, `urgencyScore`, `opportunityScore`, `triggerScore`, `revenueScore`, `occupancyScore`, `scoreReasons` (jsonb), `scoreBucket`
### Pin cards v3
- **Drivers**: `scripts/build-pin-cards-v3.sql` + `apps/backend/src/data-pipeline/maintenance.processor.ts` `pinCardsSql()`
- **Output**: `property_pin_cards.payloadFree` + `payloadPro`
- **Cadence**: Same as scorer
### Hex aggregates
- **Driver**: `scripts/build-hex-aggregates.sql`
- **Output**: `property_hex_aggregates`
- **Cadence**: Same as scorer
---
## <a id="realtime"></a>9. Real-time pipeline (NestJS BullMQ)
| Job | Cadence | What it does |
|---|---|---|
| NWS warning poll | 3 min | Pulls active warnings, matches polygon to properties, queues alerts |
| SPC report sync | 30 min | New storm reports → storm_events |
| SPC daily gap-fill | 2am | Backfills any missed reports |
| NOAA daily | 3am | Storm events DB |
| Weekly backfill | Sun 4am | Catches anything missed |
| Score rebuild | (manual) | After yearBuilt or storm changes |
| Pin card rebuild | (manual) | After score changes |
---
## Pipeline dependency graph
             SPC reports + MRMS radar          County assessor (Tyler)
                     ↓                                  ↓
               storm_events ←─ SVRGIS               yearBuilt
                     ↓                            roofType, sqft
               property_storms                    ownerHistory
                     ↓
              hail/wind exposure ──────────┐         ↓
                                            ↓     Permits (CoC, county, city)
        FEMA NFHL ─── femaFloodZone         ↓         ↓
                                        ┌──────────────┐
                                        │   Scorer v3  │
                                        └──────────────┘
                                               ↓
                                        score + scoreReasons
                                               ↓
                                        ┌──────────────┐
                                        │ Pin cards v3 │
                                        └──────────────┘
                                               ↓
                                      payloadFree, payloadPro
                                               ↓
                                          Frontend map

---

## Failure / drift detection

- **SESSION_STATE.md** has the daily snapshot — check there before debugging
- Missing data? Look at `yearBuiltSource` distribution first
- Stale storm data? Check NestJS BullMQ job dashboard
- Broken pin cards? Re-run `build-pin-cards-v3.sql`                                          