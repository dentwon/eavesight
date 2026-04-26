# Eavesight Implementation Overview

**Updated: April 2026**

## Architecture

### Backend (NestJS)
- **REST API** with JWT auth + org multi-tenancy (OWNER / ADMIN / MEMBER / VIEWER roles)
- **PostgreSQL 14 + PostGIS** for spatial data; **Prisma ORM**
- **Redis + BullMQ** for background workers (nightly score-collapse, hex aggregation, pin-card rebuild, hail-exposure computation, ingestion queues)
- **Storm ingest** — SPC (Storm Prediction Center) bulk data for wind / hail / tornado / flood / hurricane; FEMA disaster declarations; NOAA supplementary
- **Property ingest** — Madison County ArcGIS (FindAProperty MapServer), Limestone / Morgan / Marshall / Jackson county ArcGIS services, Huntsville City of Huntsville CoC layer, geocoding backfill via Nominatim
- **Hail exposure** — MRMS-derived per-property event count + severity index
- **Building permits** — Huntsville + CoC scrapers (30K permits, 2003-present)
- **Scheduled tasks** — nightly maintenance processor rebuilds scores, hex aggregates, pin cards, dormant flags

### Frontend (Next.js 14)
- **Tailwind CSS** + shadcn/ui
- **MapLibre GL** for the map (not OpenLayers)
- **TanStack Query** for server state
- **Metro-scoped routing** — `/m/[metro]` pattern ready for multi-metro launch
- **Responsive + mobile bottom-sheet** for property details and pin-to-lead autofill

## Key Features

### 1. Storm Intelligence
- **2.1M storm events** (SPC, 1950-present, nationwide) — WIND (1.12M), HAIL (845K), TORNADO (147K)
- **6.6M property↔storm associations** (per-property historical exposure stack)
- **Property-level hail exposure index** with event count and max hail size
- **Hex-aggregate overlay** (H3 R6 + R8) for fast low-zoom map rendering

### 2. Property Management
- **242,987 properties** across 5 North Alabama counties (Madison, Limestone, Morgan, Marshall, Jackson)
- **100% geocoded**; 100% with Microsoft building footprints (area, centroid)
- **Roof-area denormalization** from footprint geometry; `roofSizeClass` bucketing (Residential / Large Residential / Small-Medium-Large Commercial / Warehouse-Industrial)
- **Year-built inference** with explicit confidence levels (VERIFIED / ENRICHED / DEED_FLOOR / SUBDIV_PLAT / NEIGHBOR_KNN / ACS_MEDIAN / RATIO_GUESS / NONE)
- **Roof-install anchor** (`roofInstalledAt`) populated from CoC new-construction permits; ready for future reroof-permit classifier

### 3. Lead Generation & CRM
- **Lead pipeline:** NEW → CONTACTED → APPOINTMENT → INSPECTED → QUALIFIED → QUOTED → NEGOTIATING → WON / LOST
- **Unified 0-100 score** emitted nightly, with sub-scores: urgency, revenue potential, opportunity, solar
- **Score-reasons JSON** so the UI can explain why a pin is hot
- **Dormant flag** + **claim-window timing** (derived from recent hail/wind exposure)
- **Activities**: call, email, SMS, visit, inspection, quote, note, status change — attach to lead or property
- **Canvass sessions** with per-rep route, doors-knocked/answered/leads-generated

### 4. Territories & Multi-Metro
- **`Metro` registry** — `north-alabama` active; schema supports per-metro tier (free/pro/enterprise) and bbox
- **Territory** model for org-scoped zip bundles (team routing)

### 5. Analytics & Reporting
- Dashboards for storm activity, lead pipeline, property coverage, team performance
- Hex-aggregate analytics exposed via `/metros/:code/hexes`
- Top-N queries via `/metros/:code/top`
- Viewport queries (`/metros/:code/viewport`) for efficient map pin loading at zoom ≥ 13

## API Endpoints (representative)

### Authentication
- `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh`

### Storms
- `GET /storms` · `GET /storms/active` · `GET /storms/nearby`

### Properties
- `GET /properties` · `GET /properties/nearest` · `GET /properties/:id` · `GET /properties/:id/roof-age`

### Leads
- `GET /leads` · `GET /leads/stats` · `GET /leads/:id` · `POST /leads` · `PATCH /leads/:id`

### Metros (scale-ready)
- `GET /metros` · `GET /metros/:code` · `GET /metros/:code/hexes` · `GET /metros/:code/top`
- `GET /metros/:code/viewport?lonMin=&latMin=&lonMax=&latMax=` — viewport-bound pin query
- `GET /metros/:code/properties/:id/pin?tier=free|pro` — tiered pin-card payload

### Map
- Viewport-bound queries return reduced `ViewportFeature` payloads; pin-card endpoint returns Free or Pro payload depending on entitlement

## Pricing Tiers (live)

- **Scout** — Free. 5 property reveals/month, county-wide storm alerts, basic property data.
- **Business** — $99/month. 50 reveals/month, zip-code alerts, Hot/Warm/Cold lead tiers, 1-county map, 1 canvassing route/day, owner name + mailing address, 5 roof-measurement credits.
- **Pro** — $249/month (featured, "Most Popular"). 200 reveals/month, property-level push alerts, full 0-100 lead scoring, multi-county access, unlimited canvassing routes, owner name + phone + mailing, non-weather leads (roof age, home sales), 15 roof-measurement credits.
- **Enterprise** — Talk to Sales. Unlimited reveals, API access, custom scoring, territory locking, team routing + GPS, 40 roof-measurement credits, priority support.

No per-user fees. 14-day free trial. Cancel anytime.

**Live promo:** First 100 users get 3 months free (landing page).

**Metered unit of value:** property reveals (1 reveal = full owner + contact + property + storm profile for one address).

## Target Market

### Primary
- **Residential roofing contractors** — $500K-5M annual revenue, 3-15 employees, active in storm-damaged areas
- **Storm restoration companies** (higher ACV, fits Pro / Enterprise)

### Secondary
- Multi-crew operations (Enterprise — territory locking + GPS)
- Insurance adjuster firms
- Home inspectors in storm-affected regions

## Go-to-Market

### Phase 1 — Huntsville / North Alabama (live)
- Marketed coverage: Madison, Limestone, Morgan counties (Huntsville, Athens, Decatur). Marshall and Jackson also loaded.
- Closed beta open; "first 100 users get 3 months free" promo live on landing page
- Convert beta cohort to paid Business / Pro

### Phase 2 — Nashville
- Ingest Davidson / Williamson / Rutherford / Sumner / Wilson CAD parcels
- Register `nashville` Metro record, run pin-card + hex aggregation
- Open Nashville waitlist

### Phase 3 — Southeast storm belt
- Priority targets: Birmingham, Atlanta, Austin (per-metro expansion)
- Enterprise pilots with multi-crew regional operations

## Implementation Status

### Done
- Storm ingest (SPC + NOAA + FEMA) with 2.1M events
- 243K properties ingested, geocoded, enriched with census + building footprint
- Hail exposure scoring + dormant-flag pipeline
- Unified 0-100 score + nightly recompute
- Full lead CRM (status, activities, assignee, quote tracking)
- Metro-scoped API + H3 hex aggregates + viewport queries
- Pin-card denormalization (Free + Pro payloads)
- Mobile bottom-sheet + pin-to-lead autofill
- Landing page with live pricing, signup, demo CTA
- Canvassing + canvass-session tracking

### In Progress / Gaps (see DATA_AUDIT_GAP_ANALYSIS.md for detail)
- **Owner phone/email** — 0 populated across 243K properties; blocks TCPA-credible outreach
- **Roof data** (`roof_data` table) — empty; keystone differentiator
- **Property-reveal meter + roof-measurement credit ledger** — not yet implemented
- **Stripe billing wiring** — schema ready (`stripeCustomerId`, `ApiQuota`, `ApiUsage`), no writes
- **Permit `is_roofing` classifier** — column exists, 0 populated
- **Storm path polygons** — `pathGeometry` unused (points only)
- **DNC registry** — `dnc_entries` empty

### Future Enhancements
- ML-based roof damage detection from imagery
- Drone / satellite imagery integration for condition scoring
- Insurance-claim integration (automated claim-ready documentation)
- Public API for third-party integrations (Enterprise tier)
- White-label for large roofing chains (Enterprise+)

## Success Metrics

| KPI | Target |
|---|---|
| Monthly churn | < 3% |
| Customer acquisition cost | < $100 |
| Customer lifetime value | > $2,000 |
| LTV:CAC | > 3:1 |
| Lead-to-close rate | 15-25% |
| Time to first value | < 7 days |

Near-term revenue milestones TBD once tier-mix assumptions are locked and the reveal meter + billing are wired.
