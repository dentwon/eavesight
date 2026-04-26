# Eavesight Full Implementation Showcase

**Updated: April 2026**

## Current Status

**Live, in closed beta.** The MVP is running with real production data, not samples. All core features are wired end-to-end: storm intelligence, property search, owner info, lead management, canvassing, mobile bottom-sheet, metro-scoped map views, and multi-tier pin cards.

## Technical Implementation

### Backend (NestJS API)
- **Storm ingest** — 2.1M historical storm events from SPC (Storm Prediction Center), 1950-present, nationwide. Types: WIND (1.12M), HAIL (845K), TORNADO (147K), plus FLOOD and HURRICANE.
- **Property database** — 242,987 properties across Madison, Limestone, Morgan, Marshall, and Jackson counties (North Alabama). 100% geocoded, 100% with building footprints (Microsoft OSM dataset).
- **Property ↔ storm linking** — 6,586,732 historical matches; average ~27 storms of exposure per property.
- **Hail exposure index** — MRMS-derived per-property hail event count and severity; 70,830 properties with any hail exposure.
- **Parcel layer** — 174,026 raw Madison County parcels with owner name, mailing address, appraised value, subdivision, deed book/page.
- **Permit layer** — 30,417 Huntsville building permits (2003-2026), 97% geocoded, 58% linked to properties.
- **Enrichment** — census tract, block group, ACS median household income, homeownership rate, median year built on 98-100% of properties.
- **Lead scoring** — unified 0-100 score (emitted nightly), urgency / revenue-potential / opportunity / solar sub-scores, dormant-flag signal, claim-window timing.
- **Scale-ready aggregates** — H3 hex aggregation (resolutions 6 and 8) for fast map-tile rendering; pin-card denormalization (Free + Pro payload variants) per property; metro registry for multi-metro expansion.
- **Auth** — JWT sessions, org multi-tenancy with owner/admin/member/viewer roles, per-org API keys and quota tables (schema in place; billing wiring pending).
- **Prisma + PostgreSQL + PostGIS**, Redis for cache/queues, BullMQ for the nightly score-collapse + hex-rebuild jobs.

### Frontend (Next.js 14 + MapLibre GL)
- **Landing page** — public marketing site with live pricing, FAQ, "see your area free" CTA, beta promo banner
- **Map dashboard** — viewport-aware pin loading (backend returns only the pins visible at the current zoom), hex-aggregate overlay at low zoom, per-property pin cards with Free vs Pro tier payloads, hail exposure overlay
- **Property list / prospects / leads / pipeline / canvassing / analytics / alerts / team / settings** — all built, all live
- **Mobile** — dedicated bottom-sheet flow for property details and pin-to-lead autofill
- **Metro-scoped routes** — `/m/[metro]` routing already in place for Huntsville; second-metro (Nashville) drops in without UI changes once data is ingested

## Services

- **Landing / app** — eavesight.com (production)
- **Backend API** — Nest app with Prisma + Redis + BullMQ workers
- **Database** — PostgreSQL 14 with PostGIS, local dev on port 5433

## Live Data Snapshot (as of 2026-04-22)

| Table | Rows | Notes |
|---|---|---|
| storm_events | 2,115,226 | SPC, nationwide, 1950-2026 |
| property_storms | 6,586,732 | AL properties × historical storms |
| properties | 242,987 | 5 North Alabama counties |
| building_footprints | 242,987 | 100% coverage, Microsoft |
| property_enrichments | 242,987 | census-level, 98%+ coverage |
| property_pin_cards | 242,987 | Free + Pro payload denorm |
| madison_parcel_data | 174,026 | raw Huntsville parcels |
| building_permits | 30,417 | Huntsville + CoC, 2003-2026 |
| property_hex_aggregates | 4,660 | H3 R6 + R8 |
| contractor_licenses | 185 | Huntsville |

## Pricing (live)

- **Scout** — Free. 5 property reveals/month, county-wide alerts, basic property data.
- **Business** — $99/month. 50 reveals/month, zip-code alerts, Hot/Warm/Cold lead tiers, 1-county map, 1 canvassing route/day, owner name + mailing address, 5 roof-measurement credits.
- **Pro** — $249/month *(featured, "Most Popular")*. 200 reveals/month, property-level push alerts, full 0-100 lead scoring, multi-county access, unlimited canvassing routes, owner name + phone + mailing, non-weather leads (roof age, home sales), 15 roof-measurement credits.
- **Enterprise** — Talk to Sales. Unlimited reveals, API access, custom scoring, territory locking, team routing + GPS, 40 roof-measurement credits, priority support.

All paid plans: 14-day free trial, no per-user fees, no contract.

**Live promo:** First 100 users get 3 months free (banner on landing page).

**Unit of value:** metered **property reveals** (1 reveal = full owner + contact + property + storm profile for one address). Pro at $249 is anchored against "1 closed job = 56× monthly cost."

## Target Markets

1. **Residential roofing contractors** (primary) — solo roofers and small crews ($500K-5M annual revenue, 3-15 employees)
2. **Storm restoration companies** (Pro / Enterprise)
3. **Multi-crew roofing operations** (Enterprise — territory locking, team routing, GPS)

## Geographic Coverage

- **Live metro:** Huntsville / North Alabama (Madison, Limestone, Morgan — Huntsville/Athens/Decatur; Marshall and Jackson also loaded)
- **Storm data:** nationwide
- **Next metro:** Nashville (Davidson / Williamson / Rutherford / Sumner / Wilson CAD pulls queued)
- **Further expansion:** broader Southeast storm belt

## Lead Pipeline

`NEW → CONTACTED → APPOINTMENT → INSPECTED → QUALIFIED → QUOTED → NEGOTIATING → WON / LOST`

Activities (call, email, SMS, visit, inspection, quote, note, status change) attach to both leads and properties. Canvass sessions track doors knocked / answered / leads generated per rep.

## Known Gaps (see DATA_AUDIT_GAP_ANALYSIS.md for full detail)

1. **Owner phone/email: 0 rows** across 243K properties — skip-trace integration needed before outreach is TCPA-credible
2. **Roof data (material, pitch, facets, squares, cost estimates): empty table** — the keystone differentiator vs HailTrace/Telefi
3. **Property-reveal meter + roof-measurement credit ledger** not yet implemented in DB — no way to enforce the tiered quotas the pricing sells
4. **Stripe billing not wired** — orgs have no `stripeCustomerId`, API usage/quota tables empty
5. **Nashville data** not yet ingested
6. **Storm path polygons** not stored (points only) — limits tornado/wind swath overlays

## Competitive Position

| Competitor | Cost | What Eavesight adds |
|---|---|---|
| HailTrace | $500+/mo | Integrates owner + property + permit + roof-age (they don't have this) |
| Telefi | $300+/mo | Integrates storm + roof-age (they don't have this) |
| SalesRabbit | $200+/mo | Roof-specific data, storm integration, lead scoring built around roof age |
| AccuLynx | $400+/mo | 60% lower price, roofer-focused (not general contractor), faster onboarding |

## Next Steps

Short list, in order (see DATA_AUDIT_GAP_ANALYSIS.md § 4 for full priority ladder):

1. Wire skip-trace (Endato / BatchSkipTracing / Telnyx) → populate `ownerPhone` / `ownerEmail`; load federal DNC registry into `dnc_entries`
2. Load at least one roof data source into `roof_data` (EagleView / Roofr / Nearmap / GeoX, or geometry-based estimator)
3. Build the property-reveal meter and roof-measurement credit ledger; connect Stripe billing to `Organization.stripeCustomerId`
4. Queue Nashville CAD ingestion
5. Run the existing permit `is_roofing` classifier (column exists; nothing has populated it)
6. Convert beta cohort to paid Business / Pro tiers
