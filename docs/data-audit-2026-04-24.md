# Data Audit — 2026-04-24 (Phase 2: JSONB & Signal Mining)

Companion to `SESSION_STATE.md` and `DATA_LOOKUP_INDEX.md`. This file captures findings from a deep-dive on JSONB columns and derived signals that the older docs didn't cover. Updates across sessions go into the CHANGELOG of SESSION_STATE.md; this file is a snapshot.

---

## 1. JSONB inventory — actual population (array_length > 0 or key-count > 0)

| Column | Rows | Coverage | Notes |
|---|---|---|---|
| `building_footprints.geometry` | 242,987 | 100% | MS Building Footprints polygon. |
| `building_permits.raw` | 30,417 | 100% | **UNTAPPED GOLD** — see §3. |
| `contractor_licenses.raw` | 185 | 100% | owner_name, business_name, license_years. |
| `properties.scoreReasons` | 125,414 | 51.6% | 16 distinct reasons; see §2. |
| `properties.ownerHistory` | 55,038 | 22.6% | Avg 21 years per parcel. **GOLD** — see §4. |
| `properties.hailExposureDetails` | 4,668 | 1.92% | MRMS strict >=0.75" only. |
| `property_pin_cards.payloadFree` | 242,987 | 100% | 17 keys: id, lat, lon, address, city, state, zip, score, scoreBucket, dormantFlag, hailExposureIndex, roofAge, roofAgeSource, scoreReasons, tier, yearBuilt, yearBuiltConfidence. Missing SPC. |
| `property_pin_cards.payloadPro` | 242,987 | 100% | 31 keys incl. contact & storm history. Missing SPC. |
| `property_enrichments.skipTraceData` | 0 | 0% | Never ran. |
| `property_enrichments.solarRoofData` | 0 | 0% | Never ran. |
| `storm_events.pathGeometry` | 0 | 0% | Never populated — **blocks tornado path viz.** |
| `storm_events.affectedArea` | 0 | 0% | Never populated. |

---

## 2. `scoreReasons` — distribution of current scorer's 16 reason types

| Reason | Count |
|---|---|
| Investor-owned | 51,783 |
| No re-roof permit on file | 50,507 |
| High-value home | 49,786 |
| 1.0" hail May '25 | 10,709 |
| 1.0" hail May '24 | 10,372 |
| 0.8" hail May '25 | 9,333 |
| 1.0" hail Feb '26 | 6,161 |
| 1.0" hail Mar '26 | 3,870 |
| 1.8" hail Feb '26 | 3,418 |
| Owner-occupied | 2,489 |
| 0.8" hail Feb '26 | 1,842 |
| 0.8" hail May '24 | 1,756 |
| 1.8" hail May '25 | 1,514 |
| 1.0" hail Aug '24 | 949 |
| 0.8" hail Aug '24 | 540 |
| 0.8" hail Apr '25 | 43 |

**Observations:** Scorer emits textual reasons, MRMS-derived (strict >=0.75"). Top-of-funnel flags are `Investor-owned`, `High-value home`, `No re-roof permit on file` — tenure & quality signals dominate. **Nothing from SPC columns** (spcHailCount, spcTornadoCount, spcSevereOrExtremeCount) — scorer predates them. Rebuilding scorer to include SPC will unlock the remaining ~78K parcels with SPC hail history that currently get no hail-based reason.

---

## 3. `building_permits.raw` — hidden fields never surfaced

All 30,417 permits have these raw keys:

| Key | Populated | What it gives us |
|---|---|---|
| `Address` | 30,417 | Raw source address (matcher fallback). |
| `AddressID` | 30,417 | Source-side parcel link. |
| `BuildingSize` | 30,417 | SQFT proxy (overrides 14.3% `properties.sqft`). |
| `CensusTract` | 30,417 | Redundant w/ properties. |
| `ContractAmount` | 30,417 | **$ value of the permit** — never exposed in app. |
| `ActualCost` | 17,516 | BMS-only actual cost on close. |
| `CouncilDistrict` | 30,417 | Huntsville political district. |
| `DemolitionType` | 30,417 | For Demolition permits. |
| `NumberOfUnits` | 30,417 | Single vs multi-unit. |
| `OBJECTID` | 30,417 | Source-side PK. |
| `Occupancy_Issue_DateTime` | 12,901 | COC-only: the **move-in date**. |
| `OccupancyNumber` | 12,901 | COC-only. |
| `OccupancySubtype` | 30,417 | Fine-grain use. |
| `OccupancyType` | 30,417 | Single Family 17,682 / Multi Apt 5,799 / Commercial 4,932 / Townhomes 1,627 / Duplex 337 / Condo 40. |
| `PermitID` | 30,417 | Source-side permit #. |
| `Permit_Issue_DateTime` | 30,417 | Issue date. |
| `ShowDetails` | 30,417 | Source URL to drill through. |
| `Subdivision` | 30,417 | **Neighborhood name** — never exposed. Good for agent territory comps. |
| `TypeOfWork` | 30,417 | New Construction 19,259 / **Alteration 7,314** / Addition 3,119 / Demolition 719 / Moving 6. |

**Actionable:** the 7,314 `Alteration` permits are the most likely class to include roof work, but `is_roofing=false` on all 30,417 rows. Description-text mining on the raw JSONB hasn't been done. A single migration to populate `is_roofing` from `raw->>'TypeOfWork' = 'Alteration'` + description/OccupancyType heuristics could unblock the reroof-permit scoring signal for free.

**Blocker:** contractor name still 100% NULL — not present in `raw` either. Needs a permit re-scrape to capture it. Until then, HBLB joiner is blocked.

---

## 4. `ownerHistory` — the sleeper goldmine (55,038 parcels, avg 21 yrs each)

Stored as `[{"year": 2025, "owner": "CAMPBELL WILLIAM M"}, ...]` on 22.6% of parcels (Madison-assessor-scraped only — expect this to climb as scraper backfills).

### Derivable signals (zero new collection needed):

| Signal | Distinct parcels | Why it matters |
|---|---|---|
| `HEIRS OF` appears in any year | **951** | **Probate trigger** — recent death, new owner now responsible for roof. |
| `ESTATE` appears in any year | **1,476** | Same pattern, alternate wording. |
| `TRUST` appears in any year | **3,386** | Estate-planning vehicle; often mailing addr != parcel addr. |
| `LLC` appears in any year | **11,450** | Investor history — flip candidates, high roof-replacement likelihood on acquisition. |
| Recently transferred (2024 to 2025) | **3,564** | New owner in last ~2 years — roof inspection decision imminent. |
| Tenure = X years | derivable | `jsonb_array_length(ownerHistory)` vs unchanged-owner streak. |

### High-value composite signal — "probate-roof-opportunity"

`HEIRS OF` OR `ESTATE` in `ownerHistory` **AND** `yearBuilt <= 2000` **AND** `spcHailCount >= 3`  
-> aging roof + probate-forced decision + real storm exposure = **premium lead**.

(Current scorer does not consider ownerHistory at all. This is a free uplift.)

### Missing fields that would unlock more:
- Actual deed-transfer dates (only yearly snapshots).
- Transaction amounts (could infer from `lastSalePrice` but 90% null).

---

## 5. `payloadPro` (property_pin_cards) — 31 keys, all stale

Current keys (all 100% populated but pre-SPC rollup):
`id`, `lat`, `lon`, `address`, `city`, `state`, `zip`, `score`, `scoreBucket`, `scoreReasons`, `tier`, `marketValue`, `assessedValue`, `lastSaleDate`, `lastSalePrice`, `yearBuilt`, `yearBuiltConfidence`, `roofAge`, `roofAgeSource`, `roofAreaSqft`, `roofSizeClass`, `hailEventCount`, `hailExposureIndex`, `claimWindowEndsAt`, `dormantFlag`, `onDncList`, `ownerFullName`, `ownerOccupied`, `ownerPhone`, `ownerEmail`, `phoneVerified`.

**Missing (should be in next rebuild):**
- All `spc*` columns (Count, Count5y, MaxInches, LastDate, Tornado, SevereOrExtreme).
- `roofInstalledAt`, `roofInstalledSource` (1,992 rows would show).
- ownerHistory-derived: tenure years, probate flag, recent-transfer flag.
- `building_permits.raw` surfaced fields: last-alteration date, subdivision, OccupancyType.

`payloadFree` actually already has 17 teaser keys (address is redacted when `address LIKE 'ms-%'`); the free tier is leaner than pro but not empty. Missing: SPC columns, recent-storms array, claimWindowEndsAt. The gap between free and pro today is primarily contact (ownerPhone, ownerEmail) and financial (marketValue, assessedValue, lastSale*) — that's the right wedge for the unlock.

---

## 6. Dead JSONB columns to decide on

| Column | Decision |
|---|---|
| `storm_events.pathGeometry` | Populate from SPC SVRGIS tornado paths. High value for tornado viz. |
| `storm_events.affectedArea` | Populate from NOAA/NWS warning polygons. |
| `property_enrichments.skipTraceData` | Wait for Tracerfy run (gated by org quota). |
| `property_enrichments.solarRoofData` | Gate behind on-demand Google Solar call ($0.06/req). Don't bulk-populate. |
| `roof_data.segments` (0 rows) | Stub table. Populate from Google Solar OR drop. |
| `canvass_sessions.route`, `territories.geometry`, `activities.metadata`, `api_usage.metadata`, `data_ingestion_jobs.metadata`, `property_alerts.metadata` | Feature-driven; populate when feature ships. |

---

## 7. `property_enrichments` — columns that exist but never populated

| Column | Coverage | Notes |
|---|---|---|
| `femaRiskScore` | 0% | Compute from `_fema_flood` (wiped) or NRI CSV. |
| `disasterDeclarationActive` | 0% | FEMA IA ZIP rollup (roadmap). |
| `lastDisasterDate` | 0% | Same. |
| `lastDisasterType` | 0% | Same. |
| `leadQualityScore` | 0% | Derived-field never computed. |
| `roofReplacementLikelihood` | 0% | Derived-field never computed. |
| `stormDamageScore` | 0% | Derived-field never computed. |
| `estimatedJobValue` | 0% | Derived from roofing-costs seed + roofAreaSqft. |
| `estimatedRoofSqft` | 0% | Trivial backfill from `properties.roofAreaSqft`. |
| `populationDensity` | 0% | Census ACS lookup. |
| `avgLaborRatePerHour`, `avgRoofCostPerSqft`, `materialCostIndex` | 0% | Join w/ seed data in `estimate-roof-cost.js`. |
| `ownerName`, `ownerEmail`, `ownerPhone`, `ownerMailingAddress` | 0% | Duplicates `properties.*`. **Drop the duplicates** or UPDATE from `properties`. |

---

## 8. Competitor roofing contractors (for lead exclusion)

`contractor_licenses` has 185 Huntsville biz licenses, 54 flagged `is_roofing_kw=true`, 23 with "ROOF" in name. Visible roofers (subset):
1 Source Roofing, 2nd2None, 5 Star, 7H, A & S, A R, AAA, ABC, Above All, A-Corp, A-Trooper, Apollo, Conyer, Mid-Western Commercial, Re-Roof It, Roof Roof, Roofer Builder, Roofers Mart, Storm Front, Storm Guard, Storm Hunters, Storm Safe, Thoughtful Roofer.

**Action:** cross-reference with `properties.ownerFullName` ILIKE those business names -> **exclude roofer-owned properties from lead lists** (they won't buy their own work). Precision uplift.

---

## 9. Key questions still open after Phase 2

1. Does `madison_parcel_data.pin` join to `properties.parcelId`? (Phase 4)
2. Duplicate-column source-of-truth between `properties` and `property_enrichments`. (Phase 4)
3. `storm_events` last-insert timestamp; is SPC daily sync actually running? (Phase 3)
4. Orphaned harvesters writing to dead tables. (Phase 3)
5. Index coverage on common filter columns (score, spcHailCount, yearBuilt, county, metroCode). (Phase 6)

---

## 10. Phase 2 -> action items

1. **Rebuild pin_cards** to add SPC columns, roofInstalledAt, ownerHistory-derived signals, and teaser fields for payloadFree.
2. **Scorer v3** incorporating: SPC columns, probate trigger, recent-transfer flag, investor rotation, permit Alteration text-mining. Target ceiling >=90.
3. **Populate property_enrichments derived fields** via scripted UPDATE — no external API.
4. **Drop or consolidate** duplicate columns between `properties` and `property_enrichments` (Phase 6).
5. **Populate storm_events.pathGeometry** from SPC SVRGIS.
6. **Permit raw-JSON upgrade migration** — populate `is_roofing` via `raw->>'TypeOfWork' = 'Alteration'` + description regex. ~7,314 candidates.

---

## 11. Phase 3 — Provenance & freshness

### Last-write timestamps per table (2026-04-24 snapshot)

| Table | Last write | Age | Notes |
|---|---|---|---|
| `storm_events` | 2026-04-24 23:00:05 | **live** | SPC 30-min sync + NWS 3-min alerts — alive. |
| `properties` | 2026-04-24 21:31:09 | live | Assessor scraper actively updating. |
| `property_pin_cards` | 2026-04-24 04:20:01 | ~19h | Bulk rebuild (all rows updated same instant). Pre-SPC. |
| `building_permits` | 2026-04-21 17:21:50 | 3d | Huntsville BMS + COC batch. |
| `contractor_licenses` | 2026-04-21 19:22:45 | 3d | One-shot Huntsville biz license harvest. |
| `property_permits` | 2026-04-22 23:41:49 | 2d | Tyler Madison-City scrape (202 rows). |
| `property_enrichments` | 2026-04-17 04:59:47 | **7d** | **Stale.** Most derived fields (stormDamageScore, leadQualityScore, estimatedJobValue) never populated anyway. |
| `property_storms` | 2026-04-20 19:04:15 | **4d** | **Stale link-sync.** New storm_events since 04-20 not yet linked to parcels → they won't appear in scoreReasons. Storm-sync pipeline is half-alive. |
| `madison_parcel_data` | 2026-04-14 07:43:41 | 10d | Periodic re-harvest, separate from assessor yearBuilt scrape. |
| `building_footprints` | 2026-03-28 | ~27d | Stable (MS dataset, no expected updates). |

**Interpretation:** the **storm-events → property_storms link step is stale 4 days.** That's why scoreReasons max out at "Mar '26". New hail events from 04-20 onward are in `storm_events` but not yet joined to parcels. Need to find & run the link job (likely `apply-scores-and-flood.sql` or a nightly cron). property_enrichments is broken — nothing writes the derived fields.

### Data-bug discovered: `properties.source` concatenation corruption

`properties.source` text column is being repeatedly appended with `+nominatim-reverse` on every geocoder fallback run. At least 4 parcels now have `source` values exceeding 10,000 characters (hundreds of repeats of the same fragment). 172,572 rows (71%) have an empty source string. Root cause: `nominatim-fallback.js` probably does `UPDATE properties SET source = source || '+nominatim-reverse'` with no idempotency check. Phase 6 migration needs to:
- DEDUPE source strings (regex-replace repeated `+nominatim-reverse` -> single occurrence)
- Backfill missing source tags from `yearBuiltSource` or other provenance columns
- Fix the backfill script to be idempotent

### properties.source top values (non-corrupted):

| Source | Count |
|---|---|
| *(empty)* | 172,572 |
| `madison-parcels-knn-200m` | 18,898 |
| `Limestone-arcgis-knn-50m` | 12,936 |
| `madison-parcels-knn-50m` | 11,607 |
| `Morgan-arcgis-knn-50m` | 8,570 |
| `Morgan-arcgis-knn-200m` | 7,057 |
| `Limestone-arcgis-knn-200m` | 6,806 |
| `Marshall-arcgis-knn-50m` | 2,038 |
| `Jackson-arcgis-knn-50m` | 916 |
| *repeated `+nominatim-reverse`* | ~2,600 (various corruption levels) |

### Scripts → tables map (writers to `properties`)

Writing scripts identified by grepping `INSERT INTO properties` and `UPDATE properties`:
- Enrichment: `enrich-yearbuilt-*.js` (v1/v2/v3 + supervisor/worker), `enrich-properties.js`, `enrich-all-counties.js`
- Harvest: `harvest-census-acs.js`, `harvest-fema-flood.js`, `harvest-huntsville-permits.js`, `harvest-limestone-morgan.js`, `harvest-marshall-jackson.js`, `harvest-mrms-mesh.js`, `harvest-osm-overpass.js`
- Import: `import-footprints.js`
- Geocode: `backfill-ms-addresses.js`, `nominatim-fallback.js` (the source-corruption script)
- Spatial: `assign-h3-metro.js`, `expand-footprints.js`
- ApplyOps: `apply-marshall-jackson.js`, `apply-scores-and-flood.sql`, `census-acs-backfill.js`

**Orphaned** (script exists, target table now 0 rows because UNLOGGED wipe):
- `harvest-fema-flood.js` → `_fema_flood` (0 rows). Didn't write to `properties.femaFloodZone` anyway.
- `harvest-osm-overpass.js` → `_osm_poi` (0 rows).
- `reharvest-extended-fields.js` → `_harvest_ext` (0 rows).

Decide per-script in Phase 6 / Phase 7 whether to re-run or delete.

### Pin-cards rebuild script status

`scripts/build-pin-cards.sql` is the canonical rebuild. It:
- Clears `property_pin_cards` by metroCode.
- Pre-computes recent-5-storms-per-parcel JSON.
- INSERTs `payloadFree` (17 keys) + `payloadPro` (27 keys per SQL; DB shows 31 keys — drift).

**Missing from current rebuild**: `spcHailCount`, `spcHailCount5y`, `spcHailMaxInches`, `spcHailLastDate`, `spcWindCount`, `spcWindCount5y`, `spcWindLastDate`, `spcTornadoCount`, `spcTornadoLastDate`, `spcSevereOrExtremeCount`, `roofInstalledAt`, `roofInstalledSource`, `ownerHistory`-derived signals.

**Drift discovery:** DB shows `roofAgeSource` in payloadFree & payloadPro, but the committed SQL file does not include that field. `roofAgeSource` is referenced in `apps/backend/src/leads/roof-age.util.ts`, `canvassing.service.ts`, `maintenance.processor.ts`, and `properties.service.ts`. The backend service is writing pin_cards via Prisma on an event trigger (maintenance.processor). The SQL file is the bulk-rebuild path; the service path runs on incremental property updates. **Two writers, inconsistent schema.** Phase 6 migration must reconcile.

---

## 12. Phase 4 — Reconciliation

### madison_parcel_data → properties match rate

| Metric | Count |
|---|---|
| `madison_parcel_data` rows | 174,026 |
| `mpd.pin` non-null | 174,026 (100%) |
| Madison properties in `properties` | 153,627 |
| Madison properties with `parcelId` set | 148,639 (97%) |
| **`mpd.pin` JOIN `properties.parcelId`** | **115,897 distinct matches (66.6% of mpd / 78.0% of Madison properties)** |
| `mpd.pin` JOIN `properties.parcelNumber` | **0** — column unused for this link |

**Gaps:**
- 58,129 mpd rows without a matching property (likely vacant land, subdivided lots, parcels outside footprints import).
- 32,742 Madison properties without an mpd row (22% of Madison — probably ms-* placeholder addresses or non-residential).

**Action:** add a FK-check report to the scorer prep step so missing links are logged.

### Duplicate columns — `properties` vs `property_enrichments`

| Column | Both in | Used where | Decision |
|---|---|---|---|
| `censusBlockGroup` | properties + property_enrichments | scorer reads properties | Drop from property_enrichments. |
| `censusTract` | both | same | Drop from property_enrichments. |
| `medianHouseholdIncome` | both | scorer reads properties | Drop from property_enrichments. |
| `ownerEmail`, `ownerPhone` | both (both 0%) | future skip-trace | Keep on `properties`. Drop duplicate on enrichments OR treat enrichments.ownerPhone/Email as "latest from skip-trace". Pick one. |
| `source` | both | provenance tag | Keep properties; enrichments.source is distinct (harvester tag). |
| `createdAt`/`updatedAt`/`id` | both | standard | Keep — they are table-local timestamps. |

### FK integrity — clean, with one known gap

| Relation | Orphans |
|---|---|
| `property_pin_cards.propertyId` → `properties.id` | 0 |
| `property_enrichments.propertyId` → `properties.id` | 0 |
| `building_footprints.propertyId` → `properties.id` | 0 |
| `building_permits.property_id` → `properties.id` (non-NULL) | 0 (good!) |
| `building_permits.property_id IS NULL` | **12,785** (42% — known matcher gap, not a FK bug) |

### Dead / stub tables (candidates for drop or backfill)

**Truly empty forever-unless-we-build-the-feature (11 stubs):**
activities, api_keys, api_quotas, api_usage, campaigns, canvass_sessions, data_ingestion_jobs, dnc_entries, property_alerts, roof_data, territories.

**UNLOGGED wipe victims (7 — Phase 1 already discussed):** _acs, _bg, _fema_flood, _harvest_ext, _harvest_mj, _harvest_parcels, _osm_poi.

**Stale planner stats (actually populated, need ANALYZE):**
building_footprints (242,987 rows per COUNT), tiger_bg_al (~3,925), metros (1), organizations (~14), organization_members (~15), users (~15), `_prisma_migrations` (check — may be 0 because migrations are raw SQL not Prisma).

---

## 13. Phase 5 — Signal extraction (derivable from current data, zero new collection)

Assuming yearBuilt is accurate enough and SPC columns are populated (they are):

| Signal | Parcels | % of DB | Notes |
|---|---|---|---|
| `yearBuiltConfidence = 'VERIFIED'` | 4,179 | 1.7% | True-assessor data; highest-confidence lead base. Growing ~1,800/hr via scraper. |
| `yearBuilt <= 2000` (aging roof heuristic) | 172,803 | 71.1% | Population-wide, but inferred data dominates. |
| `spcHailCount >= 3` (real storm history) | 185,551 | 76.4% | Strong SPC-based hail exposure. |
| aging + storm-exposed | 129,336 | 53.2% | Core dormant-lead pool. |
| aging + real hail ≥ 1" + no roofing permit | **108,031** | **44.5%** | **Premium dormant cohort** — only needs scorer change. |
| high-value + aging | 16,582 | 6.8% | Elite lead tier (marketValue > $500k AND yearBuilt ≤ 2000). |
| `HEIRS OF` / `ESTATE` / `TRUST` in ownerHistory | 5,813 distinct | 2.4% | **Probate trigger** — see §4. Only available on 22.6% scraped so far; will grow to ~25K+ as scrape completes. |
| Recent owner transfer (2024→2025) | 3,564 | 1.5% | Same caveat. |

**Composite "premium dormant" scoring = aging × real-hail × no-permit × (probate OR recent-transfer OR investor):** Current DB would classify **~10K–15K parcels** as premium dormant once the scorer is rewritten. At ~$200-400/mo per roofer license and 10k premium leads per metro, that's unit economics for a viable product without any new data collection.

---

## 14. Phase 6 — Cleanup & consolidation migration

### Missing indexes (frequently filtered, currently unindexed):

```sql
-- SPC columns (used by new viewport/top filters once wired)
CREATE INDEX CONCURRENTLY properties_spcHailCount_idx ON properties ("spcHailCount");
CREATE INDEX CONCURRENTLY properties_spcHailMaxInches_idx ON properties ("spcHailMaxInches");
CREATE INDEX CONCURRENTLY properties_spcTornadoCount_idx ON properties ("spcTornadoCount");

-- yearBuilt (scorer filters heavily)
CREATE INDEX CONCURRENTLY properties_yearBuilt_idx ON properties ("yearBuilt");

-- property_storms.propertyId alone (rollup aggregations)
CREATE INDEX CONCURRENTLY property_storms_propertyId_idx ON property_storms ("propertyId");

-- building_permits.is_roofing (lead filter)
CREATE INDEX CONCURRENTLY permits_is_roofing_idx ON building_permits (is_roofing) WHERE is_roofing = true;
```

### Drop / deprecate columns:

- `property_enrichments.censusBlockGroup`, `.censusTract`, `.medianHouseholdIncome`, `.ownerEmail`, `.ownerPhone`, `.ownerName`, `.ownerMailingAddress` → duplicates of `properties.*`. Single UPDATE to reconcile, then drop.
- `property_enrichments.femaRiskScore`, `.disasterDeclarationActive`, `.lastDisasterDate`, `.lastDisasterType`, `.leadQualityScore`, `.roofReplacementLikelihood`, `.stormDamageScore`, `.estimatedJobValue`, `.estimatedRoofSqft`, `.populationDensity`, `.avgLaborRatePerHour`, `.avgRoofCostPerSqft`, `.materialCostIndex` → 0% populated forever. Populate via scripts (§10) or drop.
- `properties.source` corruption → `UPDATE properties SET source = regexp_replace(source, '(\\+nominatim-reverse){2,}', '+nominatim-reverse', 'g')` + idempotency patch to `nominatim-fallback.js`.

### Drop dead tables (only if no future plan):

Confirm with product before running:
- `roof_data` (stubbed for roof-segment storage — Google Solar gate; keep table if on roadmap, drop rows).
- `territories`, `canvass_sessions`, `property_alerts`, `campaigns`, `dnc_entries`, `activities`, `data_ingestion_jobs`, `api_*` → all feature stubs; drop or keep based on nearest roadmap item.

### Maintenance:

```sql
VACUUM ANALYZE properties;
VACUUM ANALYZE property_enrichments;
VACUUM ANALYZE property_pin_cards;
VACUUM ANALYZE storm_events;
VACUUM ANALYZE property_storms;
VACUUM ANALYZE building_footprints;
VACUUM ANALYZE madison_parcel_data;
VACUUM ANALYZE tiger_bg_al;
VACUUM ANALYZE metros;
VACUUM ANALYZE organizations;
VACUUM ANALYZE organization_members;
VACUUM ANALYZE users;
```

(The planner's `n_live_tup` is zero for several LOGGED tables with data — ANALYZE fixes scoring plans that are currently guessing wrong.)

### Convert wiped staging to LOGGED before re-ingest:

If any UNLOGGED staging is re-ingested, first:

```sql
ALTER TABLE _fema_flood SET LOGGED;
ALTER TABLE _osm_poi SET LOGGED;
-- ... etc.
```

---

## 15. Phase 7 — Phased new-collection plan (prioritized by actual gap, not roadmap titles)

Finish the work already in flight before starting anything new:

### Phase 7-A (1 week): finish in-flight

1. **Madison yearBuilt scrape** — 2.5–3.5 days, autonomous. Do not disturb.
2. **Scorer v3** — incorporate SPC, probate, transfer, investor rotation, Alteration-permit text-mining. No new collection. 1–2 days dev.
3. **pin_cards v3** — rebuild with SPC + roofInstalledAt + ownerHistory signals + payloadFree teaser fields. Reconcile SQL vs service-path drift. 0.5 day.
4. **FIX nominatim-fallback.js** — source-string corruption. 15 min.
5. **Backfill `property_enrichments` derived fields** via UPDATE from seed data + `properties` values. 0.5 day.

### Phase 7-B (1–2 weeks): unblock existing pipelines

6. **Re-scrape Huntsville permits to capture contractor name** — unblocks HBLB joiner, permit-based reroof signal, contractor leaderboard.
7. **Fix `import-footprints.js` BBOX for Marshall + Jackson** — restore ~75K missing properties.
8. **Geocode `ms-*` placeholder addresses** (~37,638) — unblocks permit matching.
9. **Re-ingest `_fema_flood` with LOGGED table + write to `properties.femaFloodZone`**.

### Phase 7-C (2–4 weeks): new collection

10. **Remaining permit scrapers**: Athens (govBuilt), Decatur (CityView), Cullman (iWorQ), Scottsboro (Cloudpermit), Madison County Tyler (not Madison-City).
11. **AL HBLB roofer licensee import** — statewide competitor / lead-exclusion.
12. **Madison Probate liens** — dormant + probate trigger overlay.
13. **FEMA IA ZIP rollup** — populates `property_enrichments.disasterDeclarationActive` and related.

### Phase 7-D (as needed): on-demand API integrations

14. **Google Solar API** — gate behind user click per-parcel. Populates `roof_data.segments`, `property_enrichments.solarRoofData`.
15. **BatchData/Tracerfy skip-trace** — gate per-org-quota. Populates `property_enrichments.skipTraceData`, `properties.ownerPhone`, `.ownerEmail`.
16. **Appraisal-jump inference** — requires re-scraping `madison_parcel_data` with history; derives a "recent re-valuation = work done" signal.

---

## 16. Open questions for product

- Is `roof_data` still on the roadmap? If yes, keep the table; if not, drop in Phase 6.
- Are `api_usage`, `api_quotas`, `api_keys` on the imminent roadmap (org-quota metering)? If not, drop.
- Do we want `payloadFree` to remain the thin teaser it is today, or expand to create a "wow" preview? This affects whether pin_cards rebuild adds SPC to free tier.
- Are `campaigns`, `canvass_sessions`, `territories`, `activities`, `property_alerts` being built in the immediate cycle? They are currently dead weight.


