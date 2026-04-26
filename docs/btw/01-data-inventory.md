# Data Inventory — Tables, Fields, Sources, Coverage

Every table currently in the `eavesight` Postgres database (port 5433),
what each column means, where the data came from, and how complete it is.

> Counts are accurate as of 2026-04-25. They drift fast — re-run the
> coverage queries at the bottom of each section to refresh.

## Table of contents
1. [Properties (the core)](#properties)
2. [Building footprints](#building_footprints)
3. [Storm events + property↔storm](#storms)
4. [Permits](#permits)
5. [Pin cards + hex aggregates (presentation layer)](#presentation)
6. [Census / TIGER (geographic + demographic)](#census)
7. [Flood data (FEMA NFHL)](#fema)
8. [Auth / multi-tenancy](#auth)
9. [Staging / pipeline tables](#staging)

---

## <a id="properties"></a>1. `properties` — 242,987 rows

The root entity. One row per parcel/address in our 5 N-AL counties.

### Counts by county
| County | Rows | With parcelId | Real yearBuilt | KNN imputed | ACS imputed |
|---|---:|---:|---:|---:|---:|
| Madison | 153,627 | 148,639 | 96,962 (Tyler scrape) | 44,829 | 11,256 |
| Limestone | 42,354 | 41,873 | 0 | est. ~30K | est. ~12K |
| Morgan | 42,258 | 41,685 | 2 | est. ~30K | est. ~12K |
| Marshall | 3,284 | 2,087 | growing (live now) | est. ~2.5K | est. ~700 |
| Jackson | 1,464 | 943 | 0 | est. ~1K | est. ~400 |

### Fields (grouped by purpose)

#### Identity + location
| Column | Type | Source | Meaning |
|---|---|---|---|
| `id` | text (cuid) | generated | Primary key |
| `address` | text NOT NULL | MS Building Footprints | Mailing address; ~80,635 still placeholders (`ms-N`, `ms-exp-N`) |
| `address2` | text | optional unit | Apartment/suite |
| `city`, `state`, `zip` | text NOT NULL | Initial: hardcoded by buggy import-footprints. Now: Census reverse-geocoder | NOT NULL constraint blocks blanking |
| `county` | text | Census reverse-geocoder | One of: Madison, Limestone, Morgan, Marshall, Jackson |
| `lat`, `lon` | double | MS Building Footprints centroid | GPS — every property has these |
| `parcelId` | text | County tax assessor | Lets us scrape detail pages |
| `fips` | varchar(5) | Census | County FIPS code (01089=Madison, 01083=Limestone, 01103=Morgan, 01095=Marshall, 01071=Jackson) |
| `censusTract` | text | Census reverse-geocoder | 11-digit tract ID for ACS joins |
| `censusBlockGroup` | text | Census reverse-geocoder | Smaller subdivision; finest ACS resolution |

#### House characteristics (assessor scrape)
| Column | Source | Coverage |
|---|---|---|
| `yearBuilt` | Madison Tyler eSuite + ACS B25035 + KNN imputation | 100% (mixed quality) |
| `yearBuiltSource` | tag | Always populated; one of `madison-assessor-scrape`, `census-acs-b25035-2023`, `knn-r1000m-k5`, `huntsville-coc-new-construction`, `marshall-assessor-scrape`, `osm-start-date`, `madison-assessor-500-skip` |
| `yearBuiltConfidence` | derived | Trust score 0-1 based on source |
| `sqft` | Tyler scrape | ~25% (Madison + Marshall) |
| `stories` | Tyler scrape | ~25% |
| `bathrooms` | Tyler scrape | ~25% |
| `roofType` | Tyler scrape | "HIP-GABLE", "GABLE", "HIP" — ~25% |
| `roofMaterial` | Tyler scrape | "ASPH SHINGLE/HVY", "METAL", etc. — ~25% |
| `foundation` | Tyler scrape | ~25% |
| `exteriorWalls` | Tyler scrape | ~25% |
| `heatingCooling` | Tyler scrape | ~25% |
| `floorType`, `interiorFinish`, `totalAdjustedArea` | Tyler scrape | ~25% |
| `roofInstalledAt` | Permit-derived | **0.7%** — this is the one we're growing |
| `roofInstalledSource` | tag | `coc-new-construction`, `huntsville-newconstruction`, `permit-post-hail` |
| `roofAgeSource` | derived | One of: `coc`, `assessor`, `acs`, `knn`, `unknown` |

#### Valuation
| Column | Source |
|---|---|
| `landValue`, `improvementValue`, `appraisedValue`, `taxableValue`, `buildingValue` | Tyler scrape |
| `annualTaxAmount`, `taxPaidStatus`, `taxPaidBy`, `lastTaxPaidDate` | Tyler scrape |
| `exemptCode`, `taxDistrict`, `landUseCode`, `landUseDesc` | Tyler scrape |
| `totalAcres` | Tyler scrape |

#### Owner — **PII-sensitive, see `06-security-pii.md`**
| Column | Source | Sensitivity |
|---|---|---|
| `ownerFullName` | Tyler scrape | Public record but quotable PII |
| `ownerMailAddress`, `ownerMailCity`, `ownerMailState`, `ownerMailZip` | Tyler scrape | Public record |
| `ownerHistory` | Tyler scrape (jsonb array) | Prior owners + dates |
| `ownerSinceYear` | derived from history | |
| `ownerPhone`, `ownerEmail` | (planned: Tracerfy skip-trace, paid) | **Highly sensitive — gate behind paywall + audit log** |

#### Storm exposure (pre-computed for fast filtering)
- MRMS-strict: `hailEventCount`, `hailExposureIndex`
- SPC-permissive: `spcHailCount`, `spcHailCount5y`, `spcHailMaxInches`, `spcHailLastDate`, `spcWindCount`, `spcWindCount5y`, `spcWindLastDate`, `spcTornadoCount`, `spcTornadoLastDate`, `spcSevereOrExtremeCount`, `spcRolledUpAt`

#### Behavioral triggers (computed from ownerHistory)
- `hasProbateTrigger` — owner name contains ESTATE OF, HEIRS OF, etc.
- `hasRecentTransfer` — most recent owner change < 24 months ago
- `hasInvestorFlip` — 3+ distinct owners in past 5 years
- `dormantFlag` — old hail + aging roof + no claim window opened

#### Scoring
- `score` (0-100), `urgencyScore`, `opportunityScore`, `triggerScore`, `revenueScore`, `occupancyScore`
- `scoreVersion` (currently 'v3')
- `scoreReasons` (jsonb): `{ urgency, triggers, revenue, occupancy, bullets[] }`
- `scoreBucket`: hot / warm / cool / cold

#### Flood
- `femaFloodZone` (varchar(5)) — currently 100% 'X' (broken default; FEMA v2 ingest fixing now)
- `femaFloodPanel`, `femaFloodEffectiveDate` (planned)

#### Indexes
- Unique: `(address, city, state, zip)` — blocks blanking address
- B-tree: `addressNorm`, `(state, city)`, `(state, county)`, `zip`, `parcelId`
- Future: GiST on `(lat, lon)` for radius queries
- Future: GIN on `scoreReasons` for jsonb path filtering

---

## <a id="building_footprints"></a>2. `building_footprints` — 242,987 rows

The actual polygon outline of each structure.

| Column | Source | Notes |
|---|---|---|
| `id` (cuid) | generated | |
| `propertyId` | derived FK | One footprint per property currently |
| `geometry` (jsonb) | Microsoft GlobalMLBuildingFootprints v1 | GeoJSON Polygon |
| `area_sqm` | computed | For roof area estimation |
| `centroid_lat`, `centroid_lon` | computed | Used to position the property |
| **Pending** `capture_dates_range_start`, `capture_dates_range_end`, `release` | MS BF v2 backfill | "Building existed by year X" lower bound — major future signal |

**Coverage**: 100% match to properties (we built properties FROM these footprints).

---

## <a id="storms"></a>3. Storm tables

### `storm_events` — 2,121,051 rows

Source: NOAA SPC (1950→present, daily sync) + NOAA Storm Events Database (NWS county-level reports). The most comprehensive severe-weather catalog that exists.

| Column | Meaning |
|---|---|
| `id` | cuid |
| `date` | YYYY-MM-DD of event |
| `type` | HAIL / TORNADO / WIND / FLOOD / etc. |
| `lat`, `lon` | Reported location (point) |
| `hailSizeInches` | Critical for roofing — values ≥ 1.0 affect asphalt, ≥ 1.5 cause replacement-grade damage |
| `windSpeed` | mph |
| `tornadoEF` | EF0-EF5 |
| `pathGeometry` | (mostly NULL — pending SVRGIS tornado-track ingest) |
| `source` | "spc-points", "noaa-events", "ncei-bulk" |
| `narrative` | NWS event description (text) |
| `damageReported` | $ estimate when known |

### `property_storms` — 6,586,732 rows

The fan-out join: every (property, storm) pair within affected radius/path.

| Column | Meaning |
|---|---|
| `propertyId`, `stormEventId` | FK pair |
| `distanceMeters` | How close the storm point was |
| `affectedConfidence` | 0-1 — for points, decays with distance; for polygons, 1.0 if inside |

> **Why 6.6M rows for 243K properties?** Avg ~27 storms per property over 75 years. Older properties accumulate more.

### `_mrms_mesh`

Hourly hail-grid raster from NWS MRMS (Multi-Radar Multi-Sensor). Pixel-level estimates ≥ 0.75". Used to compute `hailEventCount` and `hailExposureIndex` per property — these are the "high-confidence" storm signals.

---

## <a id="permits"></a>4. `building_permits` — 30,417 rows · +99 fresh from Decatur today

Source: Huntsville City of Construction (CoC), Madison County, Decatur CityView (added today). Pending: Athens, Cullman, Scottsboro, Marshall trio (Albertville/Boaz/Guntersville), Madison Probate liens.

| Column | Meaning |
|---|---|
| `id` | cuid |
| `permit_number` | Government-issued |
| `issued_at` | When pulled |
| `address` | Permit's stated address |
| `permit_type` | "REROOF" / "ALTERATION" / "ADDITION" / etc. |
| `description` | Free-text scope |
| `contractor` | Who pulled it (currently 100% NULL — fixable with re-scrape) |
| `value` | Stated job value |
| `propertyId` | FK to properties — only **202 / 30,417 = 0.7% matched** today |

> **The matching gap** is THE bottleneck on roof-age coverage. ~80,635 properties have placeholder `ms-*` addresses, breaking string-match. The geocoder running today fixes ~80K of those, which should unlock thousands of new permit↔property links.

---

## <a id="presentation"></a>5. Presentation layer

### `property_pin_cards` — 242,987 rows · v3 schema

Pre-rendered JSON for map clicks.
- `payloadFree` (jsonb, ~31 keys avg) — free tier
- `payloadPro` (jsonb, ~56 keys avg) — paid tier
- `version` ('v3')
- `rebuiltAt`

Why pre-render? Live computation = 30-table joins per click = 800ms+ p95. Pre-render = 12ms p95.

### `property_hex_aggregates` — 4,660 rows

H3 hex bin counts. Powers the heatmap when you zoom out.

| Column | Meaning |
|---|---|
| `hexId` | H3 cell ID at given resolution |
| `resolution` | 6 / 8 / 12 (tiers) |
| `propertyCount`, `hotCount`, `warmCount`, `coolCount`, `coldCount` | |
| `avgScore`, `avgHailExposureIndex` | |

---

## <a id="census"></a>6. Census / TIGER

### `tiger_bg_al` — ~4,000 rows

Block group polygon boundaries. The geographic key for joining census stats.

### `_acs_ext_bg` (being populated now)

| `table_id` | `description` |
|---|---|
| B25035 | Median year built |
| B25034 | Year built (decade buckets) |
| B25024 | Units in structure |
| B25040 | Heating fuel |
| B25041 | Bedrooms |

Schema: `(state_fips, county_fips, tract_fips, block_group_fips, table_id, variable_id, value, moe, pulled_at)`

---

## <a id="fema"></a>7. FEMA NFHL — flood

### `_fema_flood_v2` (being populated — replaces wiped UNLOGGED `_fema_flood`)

Source: FEMA's federal ArcGIS service, Layer 28 (Flood Hazard Zones).

~9,924 polygons in our 5-county DFIRM_ID set. After ingest, a JOIN updates `properties.femaFloodZone` from polygon-point intersection.

---

## <a id="auth"></a>8. Auth / multi-tenancy

Schema is **incomplete and exposed** — see `06-security-pii.md` for the audit.

- `users` — id, email, passwordHash (bcrypt), firstName, lastName, role (UserRole enum: USER/ADMIN), emailVerified, avatar, phone — currently ~15 rows (mix of test + real)
- `orgs` — multi-tenancy container, planned but barely used
- `org_members` (planned) — join table for user↔org with role per org
- `sessions` (refresh tokens)
- `auth_events` (planned audit log) — not implemented yet

---

## <a id="staging"></a>9. Staging / pipeline tables

### `staging_ms_geocode_proposals` — growing toward 80,635

Reverse-geocoded results from Census API for `ms-*` placeholder rows. Apply via `apply-ms-geocode.js --commit`.

### `_harvest_*` tables

Were UNLOGGED, wiped on 2026-04-23 pg restart. Currently empty. Need re-ingest as LOGGED.

### `madison_parcel_data` — 174,026 rows

Raw assessor scrape data, kept for re-parsing without re-scraping Tyler.

---

## How to refresh these counts

```sql
-- Property coverage
SELECT county, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE "yearBuiltSource" IN ('madison-assessor-scrape','marshall-assessor-scrape','huntsville-coc-new-construction')) AS real_year,
       COUNT(*) FILTER (WHERE "roofInstalledAt" IS NOT NULL) AS real_roof_age
FROM properties GROUP BY county ORDER BY total DESC;

-- Score distribution
SELECT "scoreBucket", COUNT(*) FROM properties GROUP BY 1 ORDER BY 2 DESC;

-- Permits matched
SELECT COUNT(*) AS total_permits, COUNT(property_id) AS matched FROM building_permits;