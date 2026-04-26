# Eavesight Data Audit — 2026-04-22

**DB:** `eavesight` @ `<host>:5433`  **Codebase:** `<repo-root>`
**Scope:** 5-county North Alabama AOI (Madison, Limestone, Morgan, Marshall, Jackson)

---

## 1. Executive Summary

Eavesight's Postgres holds **~9.1M rows across 37 public tables**, dominated by the storm-event join graph. The canonical lead table `properties` has **242,987 rows** covering all 5 target counties with **100% yearBuilt coverage** (96% of it inferred, not observed), **100% hail exposure (from MRMS 2015+)**, **~61% owner-name**, **0% owner phone/email**. The failed NAIP roof-age approach is not represented in the schema. The only real roof-install-date signal comes from **1,660 Huntsville Certificate-of-Occupancy new-construction records (0.68% coverage)**; beyond those, every other "roof age" is a `yearBuilt`-derived heuristic. Permit portals yield 30,417 permits, zero flagged `is_roofing=true`, all from the City of Huntsville. No data yet from Madison City, Madison County, Decatur, Cullman, Athens, or Scottsboro permit portals — all documented in `docs/roof-age-dragnet.md` as NOT BUILT.

---

## 2. Postgres Schema Inventory

### Core data tables (populated)

| Table | Rows | Primary purpose | Key columns |
|---|---:|---|---|
| `property_storms` | 6,586,732 | Spatial join of every property x nearby storm_event | `propertyId` FK, `stormEventId` FK, `distanceMeters`, `damageLevel` |
| `storm_events` | 2,115,226 | SPC/NOAA/FEMA severe weather catalog 1950-present | `type`, `date`, `lat`, `lon`, `hailSizeInches`, `source` |
| `building_footprints` | 242,987 | MS US Buildings footprint per property | `propertyId` FK, `geometry`, `areaSqft`, `geom` (PostGIS) |
| `properties` | 242,987 | **Canonical lead table** — see section 3 | 83 columns, `id` PK |
| `property_pin_cards` | 242,987 | Per-property rendered map payload | `propertyId` FK, `payloadFree`, `payloadPro`, `score` |
| `property_enrichments` | 242,987 | 1:1 enrichment sidecar (mostly empty) | `propertyId` FK, 25 columns, mostly NULL |
| `madison_parcel_data` | 174,026 | Raw Madison assessor parcel dump | `pin`, `propertyAddress`, `accountOwner`, `geom` |
| `building_permits` | 30,417 | City of Huntsville permits + CoCs only | `source`, `permit_number`, `permit_type`, `property_id` FK |
| `spatial_ref_sys` | 8,500 | PostGIS reference (system) | |
| `property_hex_aggregates` | 4,660 | H3 hex r6+r8 rollups for map tiles | `metroCode`, `h3Cell`, `resolution`, `scoreP50` |
| `tiger_bg_al` | 3,925 | TIGER/Census Bureau 2020 block groups AL | `geoid`, `geom` |
| `sessions` | 258 | User sessions (app) | |
| `contractor_licenses` | 185 | Huntsville business license scrape | `business_name`, `license_years`, `is_roofing_kw` |
| `organization_members`, `users`, `organizations` | 15/15/14 | App auth/tenant | |
| `data_ingestion_jobs` | 10 | Harvest job log (stale) | `type`, `status`, `county` |
| `_prisma_migrations` | 8 | Migration history | |
| `leads` | 4 | Test CRM leads | |
| `metros` | 1 | Metro definitions — only `north-alabama` active | `code`, `tier`, `status` |

### Empty / unused tables

`campaigns`, `territories`, `activities`, `canvass_sessions`, `dnc_entries`, `property_alerts`, `roof_data`, `api_usage`, `api_quotas`, `api_keys`, `_acs`, `_bg`, `_harvest_ext`, `_fema_flood`, `_harvest_parcels`, `_osm_poi`, `_harvest_mj` — all 0 rows. The `_*` tables are transient scratch tables dropped/recreated by harvesters.

### Foreign keys observed
`property_storms.propertyId -> properties.id`, `property_storms.stormEventId -> storm_events.id`, `leads.{orgId,propertyId,assigneeId}`, `property_enrichments.propertyId`, `roof_data.propertyId`, `building_footprints.propertyId`, `activities.{leadId,propertyId,userId}`, `property_hex_aggregates.metroCode`, `property_pin_cards.{propertyId,metroCode}`, `organization_members.{orgId,userId}`, `sessions.userId`, `api_keys.orgId`, `campaigns.orgId`, `territories.orgId`.

### Audit / log tables
None — no dedicated audit schema. `data_ingestion_jobs` has 10 stale COMPLETED rows for CENSUS/FEMA_DECLARATIONS/SPC_WIND/SPC_HAIL/SPC_TORNADO.

---

## 3. Properties Table Deep-Dive

**Total rows: 242,987.** 83 columns. Broken out by county:

| County | Total | yearBuilt | roofInstalled | ownerName | ownerMail | assessedVal | lastSale | sqft | lotSize | hailIndex |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Madison | 153,627 | 100.0% | 0.99% | 96.8% | 20.2% | 96.5% | 61.1% | 1.66% | 27.7% | 100% |
| Limestone | 42,354 | 100.0% | 0.34% | 98.9% | 47.6% | 98.9% | 0.00% | 0.00% | 98.6% | 100% |
| Morgan | 42,258 | 100.0% | 0.00% | 98.6% | 0.00% | 98.6% | 96.9% | 76.2% | 98.6% | 100% |
| Marshall | 3,284 | 100.0% | 0.00% | 63.5% | 63.2% | 63.2% | 50.1% | 0.03% | 56.6% | 100% |
| Jackson | 1,464 | 100.0% | 0.00% | 64.4% | 63.3% | 64.4% | 0.00% | 0.00% | 63.0% | 100% |

### Column population (whole table, 242,987 rows)

**>90% populated:** `id`, `address`, `city`, `state`, `zip`, `lat/lon`, `yearBuilt` (100%), `county`, `source`, `parcelId` (96.8%), `assessedValue` (96.7%), `marketValue` (96.7%), `propertyType`, `hailExposureIndex` (100%), `hailEventCount` (100%), `femaFloodZone` (100%, all "X"), `femaFloodRisk` (100%, all "MINIMAL"), `medianHouseholdIncome` (97.5%), `censusTract/BlockGroup`, `solarScore`, `opportunityScore`, `urgencyScore`, `score`, `h3r6/h3r8`, `metroCode`.

**50-90%:** `ownerFullName` (96.8% — but drops to ~64% in Marshall/Jackson), `lastSaleDate` (56.3%), `lotSizeSqft` (53.0%).

**10-50%:** `lastSalePrice` (9.8%), `ownerMailAddress` (22.3%), `sqft` (14.3%).

**<10%:** `roofInstalledAt` (**0.68%**), `roofInstalledSource` (**0.68%**), `bathrooms` (0.79%), `bedrooms` (0%), `attomId` (0%), `rentcastId` (0%), `ownerEmail` (0%), `ownerPhone` (0%), `ownerFirstName/LastName` (0%), `ownerOccupied` (22.3%), `taxAmount` (0%), `zoning` (0%), `businessName/Category` (4.1%), `roofAreaSqft/SizeClass` (1.05%), `dormantFlag` (0 true), `isEarmarked` (1 row), `stories` (0%), `legalDesc` (0%), `address2` (0%), `claimWindowEndsAt` (0%).

### `yearBuiltConfidence` distribution
- `NEIGHBOR_KNN` (spatial 5-nearest median): **125,603** (51.7%)
- `ACS_MEDIAN` (Census block-group median yr built): **113,205** (46.6%)
- `VERIFIED` (real assessor/CoC): **4,179** (1.7%)

**Only 1.7% of yearBuilt values are observed; 98.3% are heuristic.**

### Address quality
- Placeholder addresses (`address LIKE 'ms-%'`, from microsoft-footprint-only rows): **80,635 (33.2%)**
  - Madison 37,638 / Limestone 21,359 / Morgan 16,989 / Marshall 3,213 / Jackson 1,436

---

## 4. Building Permits Inventory

**Total: 30,417 rows, all from City of Huntsville.**

| Source | Rows | Earliest | Latest | is_roofing=true | Matched to property |
|---|---:|---|---|---:|---:|
| `huntsville` (permits layer) | 17,516 | 2020-11-02 | 2026-04-10 | 0 | 10,974 (62.7%) |
| `huntsville-coc` (CoC layer) | 12,901 | 2003-09-29 | 2026-03-17 | 0 | 6,629 (51.4%) |

**Total matched to a property_id: 17,603 (57.9%).**

### By `permit_type`
| Type | Count |
|---|---:|
| New Construction | 19,242 |
| Alteration | 7,323 |
| Addition | 3,127 |
| Demolition | 719 |
| Moving | 6 |

**No permit is flagged `is_roofing=true`.** The harvester regex (`/roof|re-roof|reroof|hail|shingle/i`) only matches `description`, and no Huntsville permits in this dataset have those tokens — the portal layer surfaced does not include roof-only permits (they require a different permit type code in Huntsville's system). `is_exterior=true` count is also 0.

### Not represented
No rows from: Madison City Tyler eSuite, Madison County Tyler eSuite, Decatur CityView, Cullman iWorQ, Athens govBuilt, Scottsboro Cloudpermit. See section 8.

---

## 5. Harvester Script Inventory

Files under `<repo-root>/scripts/`.

### Parcel / owner harvesters

| Script | Source URL(s) | Writes to | Match strategy |
|---|---|---|---|
| `enrich-properties.js` | Madison KCSGIS MapServer/141 (AL47_GAMAWeb) | `properties` (address, owner, assessedValue, parcelId) | Spatial centroid->property 30m |
| `enrich-all-counties.js` | Madison/141, Limestone/Parcels/0, Morgan/Mapping/132 | `properties` | Spatial 30m; grid index |
| `harvest-limestone-morgan.js` | `gis.limestonecounty-al.gov/.../MapServer/103`, `al52portal.kcsgis.com/.../Morgan_Public_ISV/MapServer/132` | `properties` | Spatial 50m via KNN |
| `harvest-marshall-jackson.js` | `web5.kcsgis.com/.../Marshall/Public/MapServer/37`, `web3.kcsgis.com/.../Jackson/Public_ISV_Jackson/MapServer/1` | `_harvest_mj` -> `properties` (UPDATE only) | Spatial 50m KNN via `apply-marshall-jackson.js` |
| `apply-marshall-jackson.js` | n/a | `properties` | Applies `_harvest_mj` with deadlock retry |
| `reharvest-extended-fields.js` | Madison/185, Limestone/103, Morgan/132 | `properties` (sqft, lotSizeSqft, lastSaleDate, yearBuilt) | By parcelId |

### Building characteristics harvesters

| Script | Source | Writes to | Match strategy |
|---|---|---|---|
| `enrich-yearbuilt.js`, `enrich-yearbuilt-v2.js`, `enrich-yearbuilt-v3.js` | `madisonproperty.countygovservices.com/Property/Property/Details` (HTML scrape, 3-6s delay, 429-backoff) | `properties` (yearBuilt, sqft, stories, bathrooms, roofType, roofMaterial, etc.) — Madison only | By parcelId (PIN) |
| `import-footprints.js` | `usbuildingdata.blob.core.windows.net/usbuildings-v2/Alabama.geojson.zip` (Microsoft) | `building_footprints` + creates stub `properties` rows | New inserts by lat/lon |
| `expand-footprints.js` | Same Alabama.geojson | `building_footprints` | Extends BBOX, dedupes by lat/lon |

### Permit / license harvesters

| Script | Source | Writes to | Match strategy |
|---|---|---|---|
| `harvest-huntsville-permits.js` | `maps.huntsvilleal.gov/.../Licenses/BuildingPermits/MapServer/{0,1}` | `building_permits` + `properties.yearBuilt` (for CoC new construction) | Lat/lon nearest 30m |
| `harvest-huntsville-licenses.js` | `apps.huntsvilleal.gov/licTaxSearch/` (ASP.NET WebForms scrape with ViewState) | `contractor_licenses` | Dedup by license_number |

### Hazard / weather harvesters

| Script | Source | Writes to | Match strategy |
|---|---|---|---|
| `harvest-mrms-mesh.js` | `mtarchive.geol.iastate.edu/.../mrms/ncep/MESH_Max_1440min/` (NOAA MRMS daily grids 2015+) | `properties.hailExposureIndex`, `hailEventCount`, `hailExposureDetails` | Point sample at property lat/lon |
| `fetch-mrms-mesh.py` | Same | Same (Python variant) | Same |
| `import-mesh-data.js` | Precomputed MESH CSV | Same | Same |
| `harvest-fema-flood.js` | `hazards.fema.gov/.../NFHL/MapServer/28` | `properties.femaFloodZone`, `femaFloodRisk` | ST_Within polygon (BBOX -87.4,34.0,-85.4,35.3) |
| `import-nws-warnings.js` | IEM archive SV/TO warnings (Huntsville HUN office), shapefile ZIP | `damage_surveys` (table not present in schema) | n/a |
| `import-damage-surveys.js` | NWS DAT + SPC SVRGIS tornado tracks | `damage_surveys` (also absent) | n/a |

### Enrichment harvesters

| Script | Source | Writes to | Match strategy |
|---|---|---|---|
| `harvest-census-acs.js`, `census-acs-backfill.js` | `tigerweb.geo.census.gov/.../TIGERweb/Tracts_Blocks/MapServer/{5,8,11}` + ACS 5-yr B19013/B25002/B25003/B25035 | `properties.medianHouseholdIncome, censusTract, censusBlockGroup, yearBuilt` (ACS_MEDIAN) | ST_Within block group |
| `harvest-osm-overpass.js` | overpass-api.de / .kumi.systems / .private.coffee | `_osm_poi` then `properties.businessName, businessCategory, businessWebsite, businessPhone` | Spatial nearest to COMMERCIAL/INDUSTRIAL props |

### Geocoding helpers

| Script | Source | Writes to |
|---|---|---|
| `batch-geocode.js/.ts` | Census Batch Geocoder | `properties.lat, lon` |
| `max-coverage.js` | Census Batch Geocoder (street+city fallback) | Same |
| `nominatim-fallback.js` | nominatim.openstreetmap.org (1 req/sec) | Same |
| `backfill-ms-addresses.js` | nominatim + Census geographies | `properties.address, city, zip` replacing `ms-*` placeholders |
| `run-geocode.sh`, `test-geocode-batch.js`, `test-census.ts` | Test harnesses | n/a |

### Pipeline / build scripts

`assign-h3-metro.js` (populates h3r6/h3r8/metroCode), `compute-scores.sql`, `apply-scores-and-flood.sql`, `build-hex-aggregates.sql`, `build-pin-cards.sql`, `estimate-roof-cost.js`, `generate-pmtiles.js`, `assign_pmtiles_ids.py`, `build_tiles.sh`, `seed-roofing-costs.sql`, `recover-missing.js`, `run-metro-pipeline.sh`, `yearbuilt-watchdog.sh`, `import-data.ts`.

---

## 6. External API / Data Sources Catalog

| Source | Endpoint / product | Auth | Rate limit | What we get | Status |
|---|---|---|---|---|---|
| NOAA MRMS MESH_Max_1440min | `mtarchive.geol.iastate.edu/{Y}/{M}/{D}/mrms/ncep/MESH_Max_1440min/` | None | Anonymous HTTP | 1km daily max hail size grids 2015+ | **LIVE** — 100% property coverage |
| NOAA SPC Storm Events | (FEMA/NOAA bulk, pre-loaded) | None | n/a | Historical wind/hail/tornado 1950-2026 | **LIVE** — 2,111,585 rows |
| NOAA NWS / IEM | `mesonet.agron.iastate.edu` IEM archive (SV/TO warning shapefiles, HUN WFO) | None | Anonymous | Severe warning polygons | Script exists (`import-nws-warnings.js`), target table `damage_surveys` not in schema — **UNUSED** |
| NWS DAT + SPC SVRGIS | (bulk) | None | n/a | Damage survey polygons, tornado tracks | Script exists (`import-damage-surveys.js`), target table missing — **UNUSED** |
| FEMA NFHL | `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` | None | Public ArcGIS | Flood zone polygons | **LIVE** but result stored as all "X" / all "MINIMAL" — harvest artifact, see section 9 |
| FEMA Declarations | (bulk) | None | n/a | 64 rows in storm_events source=FEMA | **LIVE** |
| US Census ACS 5-yr (2022/2023) | `api.census.gov` B19013/B25002/B25003/B25035 | API key optional | Unrestricted | Median HH income, owner-occ rate, median yr built | **LIVE** — 97.5% property coverage |
| US Census TIGER/web | `tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/{5,8,11}` | None | Public ArcGIS | AL FIPS 01 county 089/083/103/095/071 block groups | **LIVE** — 3,925 BG rows in `tiger_bg_al` |
| US Census Batch Geocoder | `geocoding.geo.census.gov/geocoder/` | None | 10k rows/batch | Street->lat/lon + tract/block | **LIVE** (used in geocoding pass) |
| OpenStreetMap Nominatim | `nominatim.openstreetmap.org/reverse` | None | 1 req/sec (policy) | Reverse geocode | **LIVE** (fallback for `ms-*` placeholders) |
| OSM Overpass | overpass-api.de, .kumi.systems, .private.coffee | None | ~2s spacing | Commercial/industrial POIs in AOI | **LIVE** — populated `businessName` on 9,982 rows (4.1%) |
| Microsoft US Buildings | `usbuildingdata.blob.core.windows.net/usbuildings-v2/Alabama.geojson.zip` | None | Anonymous | Footprint polygons | **LIVE** — 242,987 footprints all sourced |
| Limestone County ArcGIS | `gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Public_ISV/MapServer/103` | None | Public ArcGIS paginated | Parcel polygons, owner, mail address, TotalValue, TotalImpValue | **LIVE** — 42,354 parcels |
| Morgan County ArcGIS | `al52portal.kcsgis.com/al52server/rest/services/Mapping/Morgan_Public_ISV/MapServer/132` | None | Public ArcGIS | Parcel + owner, sale date, heated area | **LIVE** — 42,258 parcels |
| Madison County KCSGIS | `web3.kcsgis.com/kcsgis/rest/services/Madison/AL47_GAMAWeb/MapServer/141` and `Madison_Public_ISV/MapServer/185` | None | Public ArcGIS | Parcel polygons, PIN, owner, assessedValue | **LIVE** — 153,627 properties, 174,026 raw parcel rows |
| Marshall County KCSGIS | `web5.kcsgis.com/kcsgis/rest/services/Marshall/Public/MapServer/37` | None | Public ArcGIS | Parcels (smaller layer) | **LIVE** — only 3,284 properties (low) |
| Jackson County KCSGIS | `web3.kcsgis.com/kcsgis/rest/services/Jackson/Public_ISV_Jackson/MapServer/1` | None | Public ArcGIS | Parcels | **LIVE** — only 1,464 properties (low) |
| Madison County Gov HTML | `madisonproperty.countygovservices.com/Property/Property/Details` | None | 429 rate-limited, ~0.67 req/s safe | Year built, sqft, stories, bathrooms, roof type/material per PIN | **LIVE** — 2,518 properties with `yearBuiltSource='madison-assessor-scrape'` |
| City of Huntsville ArcGIS | `maps.huntsvilleal.gov/server/rest/services/Licenses/BuildingPermits/MapServer/{0,1}` | None | Paged 1000/call | Permits + Certificates of Occupancy | **LIVE** — 30,417 permits |
| Huntsville License Tax | `apps.huntsvilleal.gov/licTaxSearch/` (WebForms, ViewState) | None | Polite | Business license records | **LIVE** — 185 contractors (54 roofing kw) |
| Planetary Computer STAC (NAIP etc.) | — | — | — | — | **NOT INTEGRATED** — no Planetary Computer code in `scripts/`. Failed NAIP approach is deprecated per user, and there is no STAC client present. |

---

## 7. Roof-Age Signal Coverage

### Anchored install dates (`properties.roofInstalledAt IS NOT NULL`)

| County | Anchored | % of county | Source tag |
|---|---:|---:|---|
| Madison | 1,515 | 0.99% | `coc-new-construction` |
| Limestone | 145 | 0.34% | `coc-new-construction` |
| Morgan | 0 | 0.00% | — |
| Marshall | 0 | 0.00% | — |
| Jackson | 0 | 0.00% | — |
| **Total** | **1,660** | **0.68%** | 100% from Huntsville CoCs, date range 2020-12-09 -> 2026-04-10 |

**All 1,660 are "real" (permit-backed) — specifically, Certificate of Occupancy new-construction issue dates.** 0 rows come from re-roof / roof-replacement permits. 0 from inferred/heuristic sources. The roof-age-dragnet design intended a `permit-reroof` tag with 0.85 multiplier; none exist yet.

### yearBuilt coverage x confidence

| County | Total | yearBuilt populated | VERIFIED | ACS_MEDIAN | NEIGHBOR_KNN |
|---|---:|---:|---:|---:|---:|
| Madison | 153,627 | 100% | (subset of 4,179) | 25,680 | 123,915 |
| Limestone | 42,354 | 100% | 145 | 40,521 | 1,688 |
| Morgan | 42,258 | 100% | (2) | 42,256 | 0 |
| Marshall | 3,284 | 100% | 0 | 3,284 | 0 |
| Jackson | 1,464 | 100% | 0 | 1,464 | 0 |

**yearBuiltSource detail (whole table):**
- `census-acs-b25035-2023` (ACS median year built for the block group): 113,205 rows
- `knn-r1000m-k5` (median of 5 nearest neighbors within 1 km): 125,603 rows
- `madison-assessor-scrape` (HTML scrape of countygovservices.com): 2,520 rows
- `huntsville-coc-new-construction` (matched CoC): 1,659 rows

**In other words: 98.3% of yearBuilt values are spatial/statistical inferences, not observations.** Those inferences drive the roof-age model in `apps/backend/src/leads/roof-age.util.ts` and `data-pipeline/maintenance.processor.ts`, which cap any derived roof age at 35 years and fall back to NULL above that.

### Consumers of roofInstalledAt
- `apps/backend/src/leads/roof-age.util.ts:103` — anchor-first roof-age calc, 35-year cap
- `apps/backend/src/data-pipeline/maintenance.processor.ts:62-337` — `canonical_roof_age` expression reused across opportunity score + hex aggregates + pin cards
- `apps/backend/src/map/map.service.ts:40-132` — map tile roof-age coloring
- `apps/backend/src/analytics/analytics.service.ts:342` — analytics dashboards
- `property_pin_cards.roofAgeSource` — column exists, not yet populated

---

## 8. Docs: Planned vs Built

### `docs/roof-age-dragnet.md` — Tier classification

| Source | Doc tier | Status | Evidence |
|---|---|---|---|
| City of Madison (Tyler eSuite) | 1 | **NOT BUILT** | No script, no rows in `building_permits`, no planned `source='madison-city'` |
| Madison County (Tyler eSuite) | 1 | **NOT BUILT** | No script, no rows with `source='madison-county-al'` |
| Decatur CityView | 2 | **NOT BUILT** | No script |
| Cullman iWorQ | 2 | **NOT BUILT** | No script |
| Athens govBuilt | 2 | **NOT BUILT** | No script |
| Scottsboro Cloudpermit | 2 | **NOT BUILT** | No script |
| Montgomery Open Data (ArcGIS) | 2 | **NOT BUILT** | No script |
| Morgan CaptureCAMA assessor | 3 | **PARTIAL** | Morgan ArcGIS MapServer/132 is used (`harvest-limestone-morgan.js`) but CaptureCAMA web-details are NOT scraped — yearBuilt for Morgan is 100% ACS-median, zero verified |
| Madison County Probate liens | 3 | **NOT BUILT** | No script |
| Google Solar API `imageryDate` | 3 | **NOT BUILT** | No script, no `GOOGLE_SOLAR_KEY` config found |
| IBHS FORTIFIED | dead end | Skipped (correct) | — |
| SAH grant recipients | dead end | Skipped (correct) | — |
| AL SoS UCC | dead end | Skipped (correct) | — |
| HUD CDBG-DR | dead end | Skipped (correct) | — |
| MLS (Zillow/Realtor/Redfin) | dead end | Skipped (correct) | — |
| NAIP aerial imagery | deferred | **NOT BUILT** (explicitly abandoned per user) | — |

### `docs/predictive-storm-model.md` — Layer checklist

**Section 7 "When to build" pre-reqs:**
- Roof age accuracy fixed -> **NOT DONE.** Anchors exist for 0.68% of properties; 98.3% yearBuilt is inferred.
- Scoring engine consolidated -> **PARTIAL.** Single composite score exists (`properties.score`), but legacy `opportunityScore`, `urgencyScore`, `solarScore`, `revenuePotential` all still populated.
- FEMA flood + disaster data ingested -> **PARTIAL.** Flood-zone harvest ran but stored all-"X"/all-"MINIMAL" (harvest bug — see section 9). FEMA declarations: 64 rows.
- Storm path/swath polygons ingested -> **NOT BUILT.** `storm_events.pathGeometry` column exists, row-level population not verified; point reports only in use.

**Layer 1 (pure climatology):** **NOT BUILT.** `property_storms` is pre-joined (6.5M rows), but no Poisson rate/probability compute pipeline exists; no `hailProbability5yr` column/endpoint.

**Layer 2 (vulnerability):** **NOT BUILT.** Neither XGBoost training set nor ground-truth labels exist.

**Layer 3 (composite adaptive):** **NOT BUILT.** Per-roofer Bayesian weight update not implemented (only 4 leads in the whole `leads` table, no outcome feedback).

### Additional docs
No other `docs/*.md` — only `roof-age-dragnet.md` and `predictive-storm-model.md`.

---

## 9. Gaps and Deferred Work

### (a) Get >10% roof-install-date coverage on Madison

Requires one or more of:
1. **Huntsville permit Layer 0 `permit_type` expansion** — the harvester currently pulls all Huntsville permits but finds 0 roofing-flagged ones because the regex `/roof|re-roof|reroof|hail|shingle/i` does not match the `TypeOfWork` taxonomy used on MapServer/0. Need to inspect actual `TypeOfWork` values and/or broaden to an additional permit subtype endpoint.
2. **Build `harvest-madison-city-permits.js`** — per dragnet doc, Tyler eSuite at `buildportal.madisonal.gov/esuite.permits/...`. Est. 8-15k roofing permits.
3. **Build `harvest-madison-county-permits.js`** — Tyler eSuite at `esuite-madisonco-al.tylertech.com/nwprod/esuite.permits/...`. Est. 5-10k roofing.

Combined theoretical ceiling: ~13-25k Madison roofing permits -> ~8-16% coverage of Madison's 153,627 properties. Hitting 10% is achievable only with both Madison portals.

### (b) Expand beyond Madison to the 4 other counties

Each county's block:
- **Limestone** — Huntsville Limestone overflow exists but Limestone-proper permits not harvested. No Tyler/iWorQ portal scraped. Only CoC backfill is the 145 Huntsville CoCs that fall inside Limestone.
- **Morgan** — Decatur CityView (Tyler) and Morgan CaptureCAMA — both NOT BUILT. yearBuilt is 100% ACS-median.
- **Marshall** — Albertville/Arab/Boaz — dragnet calls out "no online portals." Marshall also has the smallest property count (3,284) — there is likely a harvest gap where `harvest-marshall-jackson.js` only spatial-joined to existing footprint-derived properties.
- **Jackson** — Scottsboro Cloudpermit — NOT BUILT. Only 1,464 properties total (footprint-gap).

### (c) Validate roof age claims against ground truth

- **Madison County Probate mechanic's liens** — dragnet Tier 3, NOT BUILT. Proposed as training validator.
- **User feedback loop on leads** — `leads` table has 4 rows. No `outcomeLabel` / `roofReplacedAt` field on leads.
- **Google Solar `imageryDate`** — dragnet Tier 3, NOT BUILT. Paid API.
- **IBHS FORTIFIED** — gated (correctly skipped).

### Other data-quality gaps found

1. **`femaFloodZone` is all "X" and `femaFloodRisk` all "MINIMAL" for all 242,987 rows.** The harvester ran, but the ST_Within pipeline evidently defaults anything not in an SFHA polygon to "X" and never writes V/A/AE zones. Either the NFHL polygons were not loaded into `_fema_flood` or the spatial match is writing X as a placeholder. **Investigate before scoring on flood.**
2. **`hailEventCount` capped at 2** (max value observed), and only 4,668 properties have `hailEventCount >= 1` (1.9%). MRMS runs correctly but threshold of 0.75" hail might be too high for North AL.
3. **`ownerPhone` and `ownerEmail` are 0% populated** across the whole table. Skip-tracing / RentCast / ATTOM integration absent (`attomId` 0%, `rentcastId` 0%).
4. **`parcelNumber` column unused** (0 rows). All parcel identifiers are in `parcelId`. Consider dropping.
5. **`address LIKE 'ms-%'` placeholder rows = 80,635 (33%)** — these came from `import-footprints.js` creating stub properties from footprints alone. `backfill-ms-addresses.js` has not cleared them all.
6. **Marshall + Jackson undersized.** 3,284 + 1,464 vs ~40k each expected — import-footprints BBOX likely did not cover those counties. Check `expand-footprints.js` coverage and either re-run with a bigger BBOX or harvest parcel polygons directly for Marshall/Jackson.

---

## 10. Appendix

### Grand row totals
- Grand total across 37 public tables: **~9,074,900 rows**
- Dominated by `property_storms` (6.59M) + `storm_events` (2.12M) = 95.8% of all rows
- "Business" data (properties + permits + contractor_licenses + madison_parcel_data + footprints + enrichments): ~936k rows

### Storm events by source
| source | rows | earliest | latest |
|---|---:|---|---|
| SPC | 2,111,585 | 1950-01-03 | 2026-04-22 |
| NOAA | 3,577 | 2024-01-05 | 2026-01-25 |
| FEMA | 64 | 1973-05-29 | 2025-02-15 |

### Storm type mix
WIND 1,122,383 / HAIL 845,528 / TORNADO 147,257 / TSTM 32 / FLOOD 16 / OTHER 8 / HURRICANE 2.

### Building footprints
242,987 total — 241,327 `source='unknown'` (legacy tag from initial MS import), 1,660 `source='coc'` (added by Huntsville CoC matcher).

### Key file:line references
- `scripts/harvest-huntsville-permits.js:204` — writes `properties.yearBuilt` from CoC (note: **not** `roofInstalledAt`)
- `scripts/harvest-huntsville-permits.js:164` — upserts `building_permits` ON CONFLICT (source, permit_number)
- `scripts/harvest-mrms-mesh.js:24` — MRMS archive URL template, START_YEAR=2015
- `scripts/harvest-fema-flood.js:14` — NFHL MapServer 28 endpoint + BBOX
- `scripts/harvest-census-acs.js:16` — AL FIPS county list [089,083,103,095,071]
- `scripts/harvest-osm-overpass.js:19-26` — AOI BBOXes per county
- `apps/backend/src/leads/roof-age.util.ts:103` — anchor-first roof-age calc
- `apps/backend/src/data-pipeline/maintenance.processor.ts:62` — canonical_roof_age 35-yr cap
- `apps/backend/src/data-pipeline/maintenance.processor.ts:223` — roof-age `source='permit'` tag when anchor present
- `apps/backend/prisma/migrations/20260421170000_add_roof_installed_at/migration.sql:7` — `roofInstalledAt` + `roofInstalledSource` column adds (dated 2026-04-21)

### Where `coc-new-construction` came from
The 1,660 rows with `roofInstalledSource='coc-new-construction'` predate the current `scripts/harvest-huntsville-permits.js` (2026-04-21 rewrite), which only writes `properties.yearBuilt`. A prior one-shot backfill populated these values. **No current harvester writes `roofInstalledAt`.** Any new Tier 1 / Tier 2 permit harvesters will be the first writers.
