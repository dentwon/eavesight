# Eavesight Data Audit — Gap Analysis vs Business Plan

**Date:** 2026-04-22
**Scope:** Full audit of the live `eavesight` Postgres DB, every table and column, compared against `BUSINESS_PLAN.md`.

---

## 1. What the plan promises (BUSINESS_PLAN.md)

- **Product:** one dashboard combining **storm data + property records + owner contact + roof age**
- **First launch metro:** Huntsville / North Alabama → Nashville next, then broader Southeast / Midwest storm belt
- **Pricing (live on site):** Scout Free (5 reveals/mo) / Business $99 (50 reveals/mo) / Pro $249 (200 reveals/mo) / Enterprise custom. No per-user fees. 14-day trial. Metered property reveals are the unit of value.
- **Phase 1 MVP:** storm overlay, property search, lead mgmt, auth, single metro (claimed done)
- **Key KPIs:** CAC <$100, LTV >$2K, churn <3%. Year-1 target (rebuilt April 2026 against live pricing): ~500 total signups, ~235 paying, **~$42K exit MRR / ~$500K run-rate ARR** (see BUSINESS_PLAN.md § Financial Projections)
- **Compliance:** TCPA/DNC-compliant from day one, skip-traced contacts for outreach

## 2. What's actually in the database

### Core tables — row counts

| Table | Rows | Notes |
|---|---|---|
| `storm_events` | **2,115,226** | SPC 1950-2026, nationwide — strongest asset |
| `property_storms` | **6,586,732** | AL properties × historical storms |
| `properties` | **242,987** | 100% Alabama |
| `building_footprints` | **242,987** | 100% Microsoft polygons |
| `property_enrichments` | **242,987** | census data only |
| `property_pin_cards` | **242,987** | map-tile denorm |
| `madison_parcel_data` | 174,026 | raw Huntsville parcels |
| `building_permits` | 30,417 | Huntsville only |
| `property_hex_aggregates` | 4,660 | R6+R8 for the one metro |
| `contractor_licenses` | 185 | Huntsville-licensing only |
| `sessions` | 258 | |
| `users` | 15 | 1 admin, 14 test/smoke |
| `organizations` | 14 | all STARTER, no Stripe IDs |
| `leads` | **4** | all test, all NEW |
| `metros` | **1** | `north-alabama` only |
| `roof_data` | **0** | empty |
| `property_alerts` | **0** | empty |
| `activities` | **0** | empty |
| `campaigns` | **0** | empty |
| `canvass_sessions` | **0** | empty |
| `territories` | **0** | empty |
| `api_keys` / `api_usage` / `api_quotas` | **0 / 0 / 0** | empty |
| `dnc_entries` | **0** | empty |
| `_harvest_*`, `_acs`, `_bg`, `_fema_flood`, `_osm_poi` | 0 | staging tables drained |

### Property-level field coverage (of 242,987 rows)

| Field | Populated | % |
|---|---|---|
| lat/lon | 242,987 | 100% |
| yearBuilt | 242,987 | 100% |
| … `VERIFIED` confidence | 4,179 | **1.7%** |
| … `NEIGHBOR_KNN` | 125,603 | 51.7% |
| … `ACS_MEDIAN` | 113,205 | 46.6% |
| roofInstalledAt (anchor) | 1,660 | **0.7%** — only CoC new-construction permits |
| roofAreaSqft | 242,987 | 100% (from footprints) |
| assessedValue | 231,994 | 95.5% |
| ownerFullName | 235,227 | 96.8% |
| ownerMailAddress | 54,249 | **22.3%** |
| parcelId | 235,227 | 96.8% |
| **ownerPhone** | **0** | **0%** |
| **ownerEmail** | **0** | **0%** |
| phoneVerified / emailVerified | 0 | 0% |
| lastSaleDate | 136,431 | 56.1% |
| lastSalePrice | 23,890 | 9.8% |
| sqft | 34,768 | 14.3% |
| bedrooms | 0 | 0% |
| bathrooms | 1,909 | 0.8% |
| hailExposureIndex > 0 | 70,830 | 29.2% (max 2.32, max events 371) |
| businessName (OSM adjacency) | 9,982 | 4.1% |
| isEarmarked | 1 | — |
| dormantFlag | 0 | 0% |
| unified `score` | 242,987 | 100%, but **range only 4-63** (ceiling low — p99=56) |

### PropertyEnrichment — the "pro-tier" columns are all empty

| Column | Populated |
|---|---|
| censusTract / medianHouseholdIncome / medianYearBuilt / homeownershipRate | 97-100% |
| **femaRiskScore, floodZone** | 0 |
| **stormDamageScore, leadQualityScore, roofReplacementLikelihood** | 0 |
| **estimatedRoofSqft, estimatedJobValue** | 0 |
| **ownerPhone, ownerEmail, skipTraceData** | 0 |

### Madison parcels (raw scrape)

174K rows; 91% geocoded; 98% owner/mailing; **0 deed dates** despite 171K marked `lastOwnerEnrichedAt`. Deed-date enrichment is broken.

### Building permits

30K rows, 2003→2026; 97% geocoded, 58% linked to a `Property`. **`is_roofing` and `is_exterior` booleans are 0 everywhere** — the classifier column exists but nothing ran. This silently guts the whole "recent roof job = dormant lead" signal.

### Storm events — the one genuinely strong asset

- Covers every state. Top: TX 196K, KS 141K, OK 113K, MO 89K, NE 83K, IA 78K, IL 76K.
- Types: WIND 1.12M, HAIL 845K, TORNADO 147K, FLOOD 16, HURRICANE 2.
- Date range: 1950-01-03 → 2026-04-22 (ingested yesterday).
- But: `pathGeometry` is **0 everywhere** — no tornado/storm polygons stored, only points. Hurts the "overlay" story.
- Only **1,502 distinct storms** linked to properties (of 2.1M available) because only AL properties exist to link against.

### Roof data — the keystone feature

`roof_data` table is literally **empty**. No roof material, pitch, condition, facets, squares, ridge/hip/valley lengths, cost estimates. The schema exists; zero data. This is the plan's top differentiator vs HailTrace/Telefi/AccuLynx and it ships blank.

### Metros / scale-ready

Only `north-alabama` is registered. The scale-ready tables (`metros`, `property_hex_aggregates`, `property_pin_cards`) and H3 denorm are wired and working — but every value in them points to AL.

---

## 3. Gap analysis vs Business Plan

### Gap 1 — Launch-metro coverage is real but shallow outside Huntsville proper; Nashville not yet ingested

Plan: **launch Huntsville/North Alabama, Nashville next (Q3)**. Reality: 243K AL properties across Madison (154K), Limestone (42K), Morgan (42K), Marshall (3K), Jackson (1.5K) — solid Huntsville-metro footprint. Live site markets Madison/Limestone/Morgan only (Huntsville/Athens/Decatur); Marshall and Jackson are pre-loaded and ready when demand surfaces. But **0 TN properties** means Nashville is not pre-loaded; you'll need Davidson / Williamson / Rutherford / Sumner / Wilson CAD ingestion before the second-metro launch in month 10 of the business-plan forecast. Also: only 1.7% of AL `yearBuilt` is `VERIFIED` — the home-metro depth is thinner than raw row counts suggest.

### Gap 2 — Zero contact data = zero TCPA outreach product

Plan positions Eavesight as a lead-generation and outreach tool, with DNC compliance called out as a launch requirement. Reality: **0 phone numbers, 0 emails, 0 DNC entries, 0 verified contacts** across 243K properties. A "roofing leads" SaaS whose leads cannot be called or emailed is not shippable at any tier, and the $99 Starter promise ("100 leads/month") is undeliverable — what you have are property records, not leads.

### Gap 3 — Roof data is the feature differentiator and it's empty

`roof_data` (0 rows) is the core edge vs HailTrace. No roof material, pitch, condition, squares, or cost estimates. `property_enrichments.estimatedRoofSqft` and `estimatedJobValue` are both 0/243K. The plan's ROI table ("jobs closed 6 → 12") assumes the tool surfaces roof age + damage + quote value. Right now the dashboard can only surface inferred year-built from census medians.

### Gap 4 — Year-built is inferred, not measured

Only **1.7% VERIFIED**; the other 98% is ACS block-group median or KNN imputation. The plan's "aging roofs likely to need replacement" pitch rests on knowing roof age to within a few years — today the median property's year-built is accurate to ±10 years at best. The `roofInstalledAt` anchor (the preferred signal) exists on **0.7%** of properties.

### Gap 5 — Scoring ceiling is broken

Unified `score` ranges 4-63, p99=56. Either the scoring function under-weighs available signals or it was calibrated for a scale that hasn't materialized. No property can ever rank "hot." The `dormantFlag` is 0 across the board despite it being central to the "storm window" narrative in the plan.

### Gap 6 — Enrichment pipeline half-installed

Census + homeownership rate landed; FEMA risk, flood zone, storm-damage score, lead-quality score, roof-replacement likelihood, job-value estimate all **0**. The schema anticipated these; the jobs never ran. Same pattern in `building_permits.is_roofing` (flagger didn't run) and `madison_parcel_data.deedDate` (enricher didn't run).

### Gap 7 — CRM is vestigial

4 test leads, 0 activities, 0 campaigns, 0 canvass sessions, 0 territories. Lead-status pipeline (NEW → CONTACTED → … → WON/LOST) is defined in enums; no production row has ever progressed past NEW. Phase-2 roadmap items ("email/SMS integrations", "team collaboration") are not represented in data.

### Gap 8 — Billing and entitlement infrastructure absent

14 orgs, all on STARTER, **zero Stripe customer IDs**, 0 API keys, 0 quotas, 0 API usage records. The live Scout / Business $99 / Pro $249 / Enterprise tiers cannot be enforced. `ApiQuota` and `ApiUsage` tables exist; nothing writes to them. Critically: the **property-reveal meter** (5 / 50 / 200 / unlimited) — the core unit of value the site advertises — has no counter anywhere. Nothing is decrementing a user's monthly allowance when they open a pin card, which means pricing is un-defendable on day one of paid launch. Same concern for the **roof-measurement credits** (5 / 15 / 40 / mo by tier): no credit table, no ledger. The `Plan` enum is also behind the live packaging — it has `STARTER`/`PROFESSIONAL`/`ENTERPRISE`; the live tiers are Scout/Business/Pro/Enterprise.

### Gap 9 — Storm overlays are points, not shapes

`storm_events.pathGeometry` is 0/2.1M. Plan says "view historical storm damage zones overlaid on property maps." Today you can pin storm events to lat/lon centroids and draw hail-exposure hexes (working), but the tornado/wind **swath polygons** that make storm maps legible to a roofer don't exist.

### Gap 10 — Storm ingest freshness regressed

Last `data_ingestion_jobs` completion: **2026-03-27** for SPC wind/hail/tornado, Census, FEMA. The raw `storm_events` table has records dated 2026-04-22 (yesterday), so something is writing, but the ingest-job log hasn't been updated in 26 days. Either the nightly job row isn't being persisted or a separate pathway is bypassing it — operationally you don't have a dashboard view of "is ingest healthy."

### Gap 11 — Single-tenant orgs with no territory, no users with roofer identity

All 14 orgs are unconfigured (no address, no plan upgrades, no Stripe). Users are 1 admin + 14 `test*@storm.io`. No real beta roofer has touched this. Plan's "10 beta customers" milestone is at 0/10.

---

## 4. Priority ladder (what to fix first, by blast radius)

**Blocker tier — cannot credibly sell:**

1. **Acquire a real contact source** (Endato, BatchSkipTracing, or Telnyx lookup) and backfill `ownerPhone/ownerEmail`. Without this, no product. Also populate `dnc_entries` from the federal DNC registry before any outreach.
2. **Lock in Huntsville as the sellable launch metro and queue Nashville ingest.** Huntsville data is there — finish the enrichment (deed dates, permit is_roofing, roof anchors) so it actually looks complete to a roofer. For Nashville, start Davidson / Williamson / Rutherford / Sumner / Wilson CAD pulls now so the second-metro story has data behind it when sales needs it.
3. **Load at least one roof-source** into `roof_data`. EagleView / Roofr API / Nearmap AI / GeoX — any one populated for even 10% of properties beats empty. Alternative: a cheap geometry-based estimator (facets + pitch from footprint + LiDAR).

**Shipping tier — the product "works" but thinly:**

4. Run the permit `is_roofing` classifier and wire it into the dormant-flag logic.
5. Fix the scoring ceiling (investigate why `score` maxes at 63; recalibrate or remove cap).
6. Backfill `pathGeometry` from SPC swath shapefiles so tornado/wind overlays draw as polygons.
7. Drop or populate the enrichment columns that are 0/243K — either build the jobs or delete the columns so the schema stops advertising features you don't ship.

**Commerce tier — needed before charging:**

8. Wire Stripe → `Organization.stripeCustomerId`, populate `ApiQuota`, emit `ApiUsage` from the backend per-call.
9. Build the actual lead-funnel flow so `activities`, `campaigns`, `territories` get exercised.

**Roadmap tier (plan's Phase 2-3):**

10. Multi-metro Metro registration + onboarding per-metro.
11. Email/SMS integration (Resend + Twilio) tied to `campaigns`.
12. Mobile app — schema supports it; no data yet.

---

## 5. One-line summary

**You have a very strong national storm-history dataset and a solid Huntsville/North-Alabama parcel map (right where the plan wants to launch), wrapped in a schema that anticipates the full product — but the two things the business plan sells on (owner contacts + roof data) are both zero rows, Nashville isn't pre-loaded for the next metro, and the CRM/billing side has never been exercised.** Closing gaps 2-3 above is the difference between a demo and a sellable product.
