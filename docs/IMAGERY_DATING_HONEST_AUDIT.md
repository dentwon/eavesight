# Imagery-Derived Building/Roof Dating: Honest Audit (N-AL)

**Date**: 2026-04-25
**Scope**: 242,987 properties across Madison, Limestone, Morgan, Marshall, Jackson counties, AL
**Constraint**: Free sources only; no multi-GB downloads; live verification required.

> Why this audit exists: Pixel-level NAIP temporal differencing for residential roofs is unreliable due to sun-angle variance, sensor differences, granule boundary drift, tree canopy occlusion, and registration error. We need sharper alternatives, evaluated honestly against actual data — not plausibility.

---

## 1. Microsoft US Building Footprints (legacy v2 release) — VERIFIED

**Status**: VERIFIED. Per-polygon `capture_dates_range` field exists and is populated.

**Verification method**: Downloaded `Alabama.geojson.zip` (89 MB) from `https://minedbuildings.z5.web.core.windows.net/legacy/usbuildings-v2/Alabama.geojson.zip`, unzipped, parsed actual feature properties.

**Actual schema observed** (from real polygons):

```
{ "release": 1 | 2,
  "capture_dates_range": "" | "M/D/YYYY-M/D/YYYY" }
```

**Actual sample values** (from N-AL polygons):
- `release=2, capture_dates_range="3/26/2020-7/22/2020"`
- `release=2, capture_dates_range="1/24/2020-2/14/2020"`
- `release=1, capture_dates_range=""`

**Coverage in Alabama (full state, verified by grep over the 705 MB GeoJSON)**:
- Total AL footprints: **2,455,168**
- Release 2 (date range populated): **1,773,491** (72.2%)
- Release 1 (date range empty): **681,677** (27.8%)

**Date-range start year distribution (release 2 only)**:
- 2019: 1,331,609 (75%)
- 2018: 257,591 (15%)
- 2020: 167,123 (9%)
- 2009-2017: ~17K combined

**Date-range end year**: 2019 (82%), 2020 (10%), 2018 (8%), 2017 (15 polygons).

**What this gives us**: For ~72% of N-AL properties, a hard floor: "this building existed by mid-2020." That alone is weak (only tells us the building is older than ~5 years), BUT the START of the range is a useful upper bound — many polygons have start dates in 2009-2018, telling us the building was visible in the older Bing tile that fed the model. So roughly:
- ~17% of release-2 polygons have a start year ≤ 2017, giving a real "≥ N years old" signal.
- ~83% have a start year of 2018-2020, giving only "≥ 4-6 years" — weak alone but useful as a constraint.

**Cross-reference to local DB**: Our `building_footprints` table (242,987 rows, all `source=microsoft`, `sourceId` like `ms-87310` or `ms-exp-31246`) matches this dataset. The `ms-exp-` prefix suggests an experimental release; the date metadata in our DB schema is currently NOT pulled in (no `capture_dates_range` column). One-time backfill required.

**Implementation cost**: ~3-4 hours
- Download Alabama.geojson.zip (89 MB) once
- Spatially join MS polygons to our `sourceId` (or by geometry centroid match)
- Add `capture_dates_range_start`, `capture_dates_range_end`, `release` columns to `building_footprints`
- Backfill via single SQL/Python pass

**Disk/compute**: 705 MB temp, < 5 minutes processing. No GPU.

**Coverage estimate for our 242,987 N-AL properties**: ~175K (72%) gain a date range; ~67K (28%, release 1) gain nothing.

**Accuracy**: Date range is the imagery vintage, NOT the build date. It tells us "building was present by date X." For dating purposes this is a hard upper bound only (years +/- range width, often 1-9 years).

---

## 2. Microsoft GlobalMLBuildingFootprints (latest worldwide release) — UNVERIFIED-AND-DROPPED for dating

**Status**: UNVERIFIED for per-polygon dating. Dataset exists and covers AL, but the Planetary Computer / GitHub release does NOT carry per-polygon date metadata — only `geometry`, `confidence`, `height`, `bbox`. Vintage information lives only at the tile (quadkey) level, not per polygon. The README states: "Vintage of extracted building footprints depends on the vintage of the underlying imagery. The underlying imagery is from Bing Maps including Maxar and Airbus between 2014 and 2021." That is a 7-year window with no per-polygon attribution.

**Conclusion**: For dating, use the US-specific v2 release (Section 1) instead. The global release adds nothing dating-wise.

---

## 3. Google Open Buildings v3 — UNVERIFIED-AND-DROPPED (no US coverage)

**Status**: DROPPED. Confirmed via Google Earth Engine catalog and Open Buildings official page. v3 covers Africa, South Asia, SE Asia, Latin America, Caribbean — **no North America**. Not on the public roadmap.

---

## 4. OpenStreetMap `start_date` tags — VERIFIED but SPARSE

**Status**: VERIFIED via live Overpass API call.

**Verification method**: POST to `https://overpass-api.de/api/interpreter` with bbox query.

**Actual sample values** (Madison-area bbox 34.5,-87.0 to 35.1,-86.3):
- `1860 | train_station`
- `1957 | house`
- `1962 | house`
- `1976 | yes`
- `2002-03-13 | retail`
- `July 1, 2019 | retail`

Note: tag values are free-text — sometimes a 4-digit year, sometimes ISO date, sometimes English. Need normalization.

**Verified count, all 5 N-AL counties (bbox 34.2,-87.0 to 35.2,-85.5)**: **300 ways** total with `start_date` or `building:start_date`.

**Coverage estimate**: 300 / 242,987 = **0.12%**. Extremely sparse; biased toward landmarks and downtown commercial.

**Implementation cost**: ~1 hour. Single Overpass query, normalize date strings, spatial join to our footprints by centroid distance.

**Use case**: Trust signal for the tiny fraction that has it (likely older landmarks). Not a population-scale solution.

---

## 5. Zillow Research public datasets — UNVERIFIED-AND-DROPPED

**Status**: DROPPED. Per https://www.zillow.com/research/data/ the free CSVs are aggregated to ZIP/metro/county level (ZHVI, ZORI, sales metrics, inventory, etc.). The historical property-level free dataset (ZTRAX) was discontinued. There is no free Zillow source carrying per-property `lastRenovated` or roof-age data today.

---

## 6. Sentinel-2 (free via Element84 STAC / AWS Open Data) — VERIFIED, narrow utility

**Status**: VERIFIED via live STAC query.

**Verification method**: GET `https://earth-search.aws.element84.com/v1/search?collections=sentinel-2-l2a&bbox=-86.62,34.69,-86.58,34.73&datetime=2020-01-01/2024-12-31`

**Actual response (most recent scenes for Huntsville bbox)**:
- `S2B_16SED_20241229_0_L2A | 2024-12-29 | cloud=88%`
- `S2A_16SED_20241224_0_L2A | 2024-12-24 | cloud=14%`
- `S2B_16SED_20241222_0_L2A | 2024-12-22 | cloud=0.0%`

5-day revisit confirmed. Hundreds of usable scenes per year.

**Practical limit**: 10 m GSD = each pixel covers 100 m^2 = an entire small house. **Useless for residential roof dating.** A single residential roof (~150 m^2) is 1.5 pixels.

**Useful for**: Commercial / industrial parcels > 5,000 m^2 (~50 pixels). Roughly Eavesight commercial tier only — ballpark 2-5K parcels in N-AL out of 242,987 (1-2%).

**Implementation cost**: 1-2 days for a commercial-only pipeline (median compositing, change detection). Defer until commercial tier is a product.

---

## 7. Google Street View timeline — VERIFIED programmatically (third-party)

**Status**: VERIFIED via `streetlevel` Python library (no key required, scrapes public endpoints).

**Verification method**: Test address ~ Huntsville (34.7304, -86.5861).

**Actual response**:

```
Latest pano: vOho2N-EY9nOt6KLd-abyQ | date: 2024-06
Historical: 2019-04, 2016-02, 2013-08, 2007-10
```

That is 5 epochs spanning 17 years, year-month granularity, free. **A roof replacement that occurred between 2013-08 and 2016-02 would be visible.**

**Caveats**:
- The official Street View Static API has a per-image cost ($7 per 1,000 after 28K free) and does NOT expose historical pano IDs. Free quota gets only the latest image.
- `streetlevel` uses Google internal endpoints (no documented contract). Could break or be rate-limited at any time. Not contractually free, just de-facto free.
- Coverage skews to streets — rural / private roads get nothing or very stale panos.
- This is metadata-only verification; actually downloading 242K x 5 pano images would be many GB and breach the no-download rule. Use the dates only.

**Coverage estimate**: Most addressed urban / suburban properties have at least 2 historical panos. Rural Jackson / Marshall: spottier. Realistic ~60-75% of properties dateable to year-month.

**Implementation cost**: 6-10 hours
- Per property: `streetview.find_panorama(lat, lon)` -> store `[(date, pano_id), ...]`
- Rate limit conservatively (1 req / sec) to avoid bans -> 67 hours wall clock for 242K properties. Run overnight in batches.
- Store dates only; do NOT bulk-download images.

**Accuracy**: ±1 month per epoch. Roof-replacement detection requires ML on the actual pano images (expensive); but the **bare timestamp gradient itself** is a feature: a property with panos in 2007/2013/2019/2024 is well-observed; a property with only a 2024 pano is opaque.

**Risk**: If Google clamps the unofficial endpoint, this whole channel dies. Have a Plan B.

---

## 8. NAIP at the OBJECT level (per-polygon mean reflectance per year) — VERIFIED but expensive

**Status**: VERIFIED that NAIP scenes exist for N-AL via Element84 STAC.

**Verification method**: STAC query for `collections=naip` over Huntsville bbox.

**Actual NAIP epochs returned for Huntsville**:
- 2011-09-10, 2013-08-29, 2015-08-27, 2017-09-08, 2019-09-09, 2021-11-27

**6 epochs in 10 years**. 0.6 m GSD => ~250 pixels per residential roof — enough signal for object-level statistics.

**The proposal**: For each MS polygon, compute mean R/G/B/NIR per NAIP year. Track step-changes in mean reflectance vector >> noise threshold. Step = re-roof candidate.

**Why this is better than pixel diffing**: Object-level aggregation collapses sun-angle/sensor noise via averaging across hundreds of pixels. Registration error matters less because we sample the polygon interior with a small inward buffer. Tree canopy still hurts but is a per-property constant — shows up as elevated NIR baseline, not a temporal step.

**Practicality without GPU**:
- 242,987 polygons * 6 NAIP epochs = 1.46 M polygon-reads
- COG range-reads of ~200 pixels each via `rasterio` window I/O: ~50-150 ms / read
- Sequential: 242,987 * 6 * 0.1 s = ~40 hours wall clock CPU
- Parallelizable to 4-6 hours on the VM (4 vCPU)
- Storage: store mean reflectance vectors only (~5 floats * 6 epochs * 242K = 60 MB)
- No GPU needed. Compute is I/O-bound, not arithmetic.

**Honest limits**:
- A re-roof from light-grey to slightly-different-light-grey shingle is below the band-mean noise floor.
- A re-roof from dark to light asphalt -> aluminum is detectable.
- Empirically, expect 5-15% true-positive flag rate vs ground truth (no ground truth available cheaply, so this is a model that needs calibration before trust).

**Implementation cost**: 12-20 hours dev (pipeline + calibration on a labeled subset).

**Accuracy**: ±1 NAIP epoch (~2 years). Maybe 30-50% recall on actual re-roofs (best guess; needs validation set).

---

## Other free imagery sources — evaluated honestly

- **NOAA NGS Emergency Response Imagery** (https://storms.ngs.noaa.gov/): VERIFIED to exist for Alabama (April 2011 super outbreak coverage of Tuscaloosa/Birmingham especially). Not used for dating; useful for damage validation in known storm zones. Not population-scale for roof age.
- **NASA Earthdata / Landsat**: 30 m GSD. Worse than Sentinel-2 for residential. Useful only for very large commercial parcels and broad LULC. DROPPED for this use case.
- **USGS HCMM**: 1970s thermal imagery, 600 m resolution. Historical curiosity. DROPPED.

---

## Aggregate honest coverage

**Best case** (combining all VERIFIED sources, with N-AL footprint count = 242,987):

| Signal | Coverage | Useful resolution |
|---|---|---|
| MS v2 capture_dates_range (release 2) | ~175K (72%) | ±2-9 years |
| OSM start_date | ~300 (0.12%) | Often exact year |
| Street View timeline | ~150K-180K (60-75%) | ±1 month per epoch |
| NAIP object-level reflectance steps | ~243K (100% imagery, but flags only on ~5-15%) | ±2 years |
| Sentinel-2 commercial only | ~3K (1-2%) | ±5 days |

**Best-case combined**: For ~190K-210K (78-87%) of properties, at least one verified time anchor before 2020. For ~30K-50K (12-22%), nothing better than "exists today" — these are rural Jackson/Marshall and recently-developed parcels with only release-1 footprints, no Street View history, no OSM tag.

**Worst case**: Even with everything stacked, **the actual ROOF-REPLACEMENT date** is verified for ~0% of properties without ML on Street View / NAIP imagery. All these sources give us *upper bounds on building age* and *change-detection candidates*, not roof events. Anything claiming "roof replaced in year X" for the population at scale will be a model output, not a measurement, and must be calibrated against a labeled subset (parcel records, permits, insurance claims) before being shipped as truth.

---

## Recommended path

1. **Now (3-4h)**: Backfill `capture_dates_range_start/end` and `release` from MS v2 GeoJSON. Free, fast, real data.
2. **Now (1h)**: Pull OSM `start_date` for the 300 tagged buildings. Trust signal for landmarks.
3. **Next (6-10h dev + 67h batch)**: Street View timeline scrape via `streetlevel`. Store dates only. Highest single ROI for residential.
4. **Later (12-20h dev)**: NAIP object-level reflectance pipeline. Calibrate against a labeled subset before trusting flags.
5. **Defer**: Sentinel-2 (commercial tier only); NOAA NGS (damage-zone overlay later); pixel-level NAIP differencing (do not attempt, per the original push-back).
