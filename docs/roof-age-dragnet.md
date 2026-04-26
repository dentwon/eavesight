# Roof-Age Data Dragnet — North Alabama

Status: research complete 2026-04-21. Harvester build queued under Phase 5.

## TL;DR

After surveying every permit portal, state program, federal dataset, and
imagery source touching Alabama roofs, the only actionable sources for
per-property roof install dates in North AL are:

| Source | Type | Est. records | Build effort | Tier |
|---|---|---|---|---|
| City of Madison (Tyler eSuite) | ASP.NET WebForms | 8-15k roofing | 1-2d | **1** |
| Madison County (Tyler eSuite) | ASP.NET WebForms | 5-10k roofing | 1d (shares code) | **1** |
| Decatur CityView (Tyler)       | JS/REST | Unknown | 2-3d | 2 |
| Cullman iWorQ                  | SaaS portal | Unknown | 2-3d | 2 |
| Athens govBuilt                | JS SPA (Playwright) | Unknown | 2-3d | 2 |
| Scottsboro Cloudpermit         | JS SPA | Unknown | 2-3d | 2 |
| Montgomery Open Data           | ArcGIS REST | Statewide validator | 2-4h | 2 |
| Morgan CaptureCAMA assessor    | JSON | ~100k year-built | 4-8h | 3 |
| Madison County Probate liens   | Login + manual | ~hundreds/yr | 1d | 3 |
| Google Solar `imageryDate`     | API (paid) | Selective | 1d | 3 |

## Confirmed dead ends (stop here)

- **IBHS FORTIFIED Address Lookup** — member-only. Alabama has 50k+
  FORTIFIED roofs but the database is gated. No unauth'd endpoint found on
  ibhs.org or designations.fortifiedhome.org.
- **Strengthen Alabama Homes grant recipients** — FOIA-only. Program also
  only covers Mobile/Baldwin/Jeff/Tusc/Escambia counties through 2025 —
  no North AL coverage.
- **AL SoS UCC filings** — covers personal-property collateral, NOT real
  property mechanic's liens.
- **HUD CDBG-DR reroof grants** — ADECA-managed, addresses PII-stripped.
- **MLS aggregators (Zillow/Realtor/Redfin)** — licensed data, no public
  sitemap of roof year.
- **NAIP aerial imagery** — feasible but it's a CV pipeline, not a public
  data harvest. Defer to predictive-model phase.
- **Google / Nextdoor historical Street View** — no public dated API.
- **Hartselle, Florence, Muscle Shoals, Albertville** — no online portals.

## Build order (Phase 5)

**Week 1 — Tyler eSuite twins.** One scraper class, two configs:
- `harvest-madison-city-permits.js` targeting
  https://buildportal.madisonal.gov/esuite.permits/AdvancedSearchPage/AdvancedSearch.aspx
  with permit types 31 (commercial roofing) and 32 (residential roofing).
- `harvest-madison-county-permits.js` targeting
  https://esuite-madisonco-al.tylertech.com/nwprod/esuite.permits/AdvancedSearchPage/AdvancedSearch.aspx
  with permit types 33 (residential roofing) and 34 (commercial roofing).
- Reuse ASP.NET ViewState handling from scripts/harvest-huntsville-licenses.js.
- Upsert to building_permits with source='madison-city' / 'madison-county-al'
  and is_roofing=true.
- Each row that matches a property via matchPropertyByPoint populates
  properties.roofInstalledAt with source='permit-reroof' (multiplier 0.85).

**Week 2 — Broaden.** Spike Decatur CityView, Cullman iWorQ, Athens govBuilt
in that order. Commit only to whichever has confirmed roofing permit type
and a stable public search.

**Week 3 — Enrich.** Add assessor harvesters (Morgan CaptureCAMA, Limestone
revenue, Madison ISV) to fill yearBuilt baselines. These are lower-priority
because yearBuilt already has 96% coverage via Census ACS — this only helps
promote NEIGHBOR_KNN / ACS_MEDIAN rows to ENRICHED confidence.

**Later.** Madison County Probate mechanic's liens as a ground-truth validator
for ML training. Google Solar API selectively on top-funnel leads.

## Not building (stop after Phase 5)

- Anything requiring FOIA
- Anything behind a paid license
- Any CV inference pipeline (belongs in predictive-storm-model.md phase 2)
