# Alabama Free Data Prospectus for Eavesight

Date: 2026-04-25
Scope: net-new free public datasets to layer onto our 5-county (Madison/Limestone/Morgan/Marshall/Jackson) property graph.
Already have: SPC storms, NOAA NWS warnings, MRMS hail, ACS B25035, MS building footprints, Madison Tyler eSuite assessor, Huntsville CoC permits, FEMA flood (zeroed - re-ingest planned).

---

## 1. Census ACS Extended Tables (B25034 / B25024 / B25040 / B25041)

- VERIFIED: tested live against `api.census.gov/data/2022/acs/acs5`.
- ACCESS: free JSON API, no key needed at this volume.
- COUNT: ~600 block groups across 5 counties, 39 vars each.
- FIELDS: B25034 year-built decade buckets (11), B25024 units in structure (11), B25040 heating fuel (10), B25041 bedrooms (7). B25117 (tenure x units x year-built) also reachable.
- EFFORT: 3-4 hrs (DB writes + BG join via existing `tiger_bg_al`).
- VALUE: B25034 is a much richer roof-age signal than B25035 median — bimodal age distributions are hidden by a single number. B25040 (heating fuel) is a renovation-history proxy. B25024 distinguishes SFH vs duplex/multi for cost models.
- SAMPLE (Madison BG 010890002031): total 461; built 2010-19=54; 1990-99=88; 1970-79=22; 1960-69=60; 1950-59=95; pre-1939=13.
- TEST: `scripts/harvest-census-acs-extended.js --test` PASS (4/4 tables, 245 BGs Madison).

## 2. Alabama Home Builders Licensure Board (HBLB)

- VERIFIED: public search at `alhobv7prod.glsuite.us/GLSuiteWeb/Clients/ALHOB/Public/LicenseeSearch.aspx`.
- ACCESS: ASP.NET WebForms with strict `EnableEventValidation` — raw curl/node POST returns HTTP 500 ("Invalid postback") because the server MAC-validates dropdown values against the session+ViewState that issued them. County option values discovered (Madison=5793, Limestone=5790, Morgan=5800, Marshall=5796, Jackson=5784); submit button is `btnSubmit` via __doPostBack.
- SCRAPE PATH: needs headless browser (Playwright/Puppeteer). Pure Node fetch will not work.
- COUNT: state directory ~14k active licensees; expect 800-1,200 across our 5 counties. Roofing is a sub-classification on the result row, not a separate license type.
- FIELDS: License#, Name, Address, City, County, License Type, Status, Issue/Expiration dates.
- EFFORT: 8-10 hrs (Playwright + parser + 5-county loop), +2 hrs to address-match licensees to properties.
- VALUE: ground-truth roofer roster. Powers (a) prior-roofer-still-in-business lookup, (b) lead routing to nearby active licensees, (c) fraud signal when permits are pulled by suspended licenses.
- TEST: `scripts/harvest-hblb-licensees.js --test` — form harvested, POST blocked by event validation; HTML saved to /tmp/hblb-Madison.html.

## 3. AL Department of Insurance

- VERIFIED EXISTS: partial. ALDOI runs the Property Insurance Clarity Act which collects loss data by hurricane / non-hurricane wind / hail, but **does not publish aggregates publicly** as of 4/2026. Bulletins, rate filings, and complaint stats are available individually via Companies/Search but not as a downloadable dataset.
- DROPPED: no machine-readable open data portal exists; FOIA-only path. Revisit if state legislature mandates publication.

## 4. AL Department of Revenue Bulk Parcels

- VERIFIED: NO statewide bulk export — AL DOR delegates assessment to 67 county assessors.
- PER-COUNTY ACCESS:
  - Limestone: ArcGIS MapServer `gis.limestonecounty-al.gov/.../Limestone_Parcels/MapServer` — REST queryable.
  - Morgan: KCS-GIS ISV3 at `isv.kcsgis.com/al.morgan_revenue/` (parcel REST extractable).
  - Marshall: same KCS pattern at `isv.kcsgis.com/al.marshall_revenue/`.
  - Jackson: county GIS site exists, REST endpoint not confirmed this pass.
- COUNT: ~80k Morgan, ~65k Limestone, ~65k Marshall, ~30k Jackson — aligns with our `properties` table.
- EFFORT: 6 hrs/county; Morgan + Marshall likely share KCS schema -> ~10 hrs total for 3 counties.
- VALUE: assessor parcels carry actual yearBuilt, totalLivingArea, structureValue, last-sale, ownerName. Highest-value enrichment available.

## 5. AL Department of Environmental Management (ADEM)

- VERIFIED EXISTS: yes, ArcGIS Hub at `alabama-department-of-environmental-management-algeohub.hub.arcgis.com` and AEPACS at `aepacs.adem.alabama.gov`.
- ACCESS: free ArcGIS Hub downloads (CSV/KML/GeoJSON).
- VALUE for roofing: LOW. Datasets are NPDES discharges, brownfields, contaminated sites, drinking-water systems. No direct property-level structure or roof signal. Brownfields could mark a property as commercially complicated but the volume in our 5 counties is small. DROP for now.

## 6. FEMA NFHL Re-ingest (v2)

- VERIFIED: endpoint live at `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query` (Layer 28 Flood Hazard Zones, max 2000/page). Test pull of 100 polygons: 68 AE + 32 A with full geometry.
- COUNT (5 counties): 9,924 polygons via DFIRM_ID filter (01089C, 01083C, 01103C, 01095C, 01071C).
- ROOT CAUSE OF ZEROING: existing `_fema_flood` is UNLOGGED -> wiped on pg restart.
- EFFORT: 2 hrs (clone existing harvester, drop UNLOGGED, re-run, re-assign property zones).
- VALUE: 100% of 242,987 properties currently have femaFloodZone='X' default. Re-ingest corrects the 5-15% in real A/AE zones — direct insurance underwriting impact.
- TEST: `scripts/harvest-fema-flood-v2.js --test` PASS (100 polygons in ~3 sec).

## 7. TIGER Address Ranges (TIGER2024 ADDR)

- VERIFIED: `www2.census.gov/geo/tiger/TIGER2024/ADDR/` — `tl_2024_01089_addr.zip` 725K, 01083 245K, 01103 248K, 01095 250K, 01071 155K. 1.6 MB total, updated 2025-06-27.
- FIELDS: TLID, FROMHN/TOHN (block-face ranges), ZIP, parity. Joins to TIGER edges for address->lat/lon interpolation.
- EFFORT: 4 hrs (ogr2ogr to PostGIS, interpolation fn, replace `ms-*` placeholder geocoder fallback).
- VALUE: free, deterministic, offline last-mile geocoder.

## 8. NOAA Storm Events Database (CSV bulk)

- VERIFIED: `ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/` annual files (`StormEvents_details_d2026_c20260421.csv.gz` 1.09 MB, locations 21 MB).
- DELTA vs SPC: adds `TOR_F_SCALE`, `TOR_LENGTH`, `TOR_WIDTH`, `BEGIN_LAT/LON + END_LAT/LON` per tornado segment, narrative damage text.
- EFFORT: 5 hrs (25 yrs of CSVs filtered to AL, build tornado_path polygons via ST_Buffer scaled to EF rating, intersect with properties).
- VALUE: deterministic "was this house in the EF-2 path of the 4/27/2011 outbreak" — beats point+radius from SPC alone.

## 9. County Open-Data Portals

- Madison ArcGIS Hub `madison-county-gis-data-download-madcoengineer.hub.arcgis.com` — parcels, address points, structures, zoning, free CSV/GeoJSON.
- Limestone `gis.limestonecounty-al.gov/arcgis/rest/services` — parcel MapServer queryable.
- Morgan/Marshall — KCS-GIS ISV3 viewers (parcel REST extractable).
- Jackson — needs deeper investigation.
- State: `data-algeohub.opendata.arcgis.com` (Virtual Alabama GeoHub) often duplicates county layers.
- EFFORT: covered by #4 (parcels are the dominant sub-item).
- VALUE: Madison address points could replace Nominatim fallback there; marginal value lives in the other 4 counties.

## 10. AL Secretary of State Business Filings

- VERIFIED: free per-name search at `arc-sos.state.al.us/CGI/CORPNAME.MBR/INPUT`; bulk downloads are paid/FOIA-only.
- DROP: no free bulk feed. Useful only as a per-licensee cross-check from #2.

---

## Top 5 prioritized (by yield / effort)

1. **FEMA NFHL re-ingest v2** - 2 hrs, fixes a real correctness bug affecting 100% of properties. Endpoint already verified.
2. **Census ACS extended (B25034 + B25024 + B25040)** - 3-4 hrs, immediately enriches every property's age and structure-type signal with no scrape risk. Test already passing.
3. **Limestone + Morgan + Marshall county parcels (ArcGIS REST)** - 12-15 hrs combined, gets us actual yearBuilt/livingArea/saleHistory on ~210k of our 243k properties. Highest information yield in the prospectus.
4. **TIGER 2024 ADDR ranges** - 4 hrs, replaces the placeholder geocoder fallback with deterministic offline interpolation. Pure cost-saver and reliability win.
5. **NOAA Storm Events tornado tracks** - 5 hrs, upgrades tornado damage signal from point-radius to actual path geometry. Direct lift to dragnet target lists.

## Investigated and dropped

- ALDOI (no public dataset of loss/complaint aggregates).
- AL DOR statewide bulk parcels (does not exist - county-only).
- ADEM (no roofing-relevant signal at structure resolution).
- AL Secretary of State bulk LLC feed (not free at bulk).
- HBLB licensee scrape via raw HTTP (blocked by EnableEventValidation; defer until we accept a Playwright dependency or stand up a small headless-browser worker).

## Test artifacts produced

- `<repo-root>/scripts/harvest-census-acs-extended.js` - tested OK (Madison, 4 tables, 245 BGs each).
- `<repo-root>/scripts/harvest-fema-flood-v2.js` - tested OK (100 polygons, AE+A confirmed).
- `<repo-root>/scripts/harvest-hblb-licensees.js` - test runs without crash but POST is rejected by ASP.NET event validation; raw HTML saved to /tmp/hblb-Madison.html. Path forward documented in source comments.

Word count: ~1,420.
