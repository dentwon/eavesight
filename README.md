# Eavesight — Roofing Intelligence Platform

**Eavesight** is a B2B SaaS platform for roofing professionals. One dashboard combines storm intelligence, property records, owner contact, and roof age so roofers show up first, prepared, and close more jobs.

Live in closed beta (April 2026). Serving Huntsville / North Alabama. Nashville next.

## What's in the box

- 🗺️ **Interactive map** with per-property pins, hex-aggregate overlays, and hail-exposure heatmap
- 🌩️ **2.1M storm events** (SPC 1950-present, nationwide) — hail, wind, tornado, flood, hurricane
- 🏠 **243K properties** across 5 North Alabama counties — fully geocoded, with Microsoft building footprints
- 🧾 **30K Huntsville building permits** + parcel-level owner / appraised-value / deed data
- 🎯 **Unified 0-100 lead score** recomputed nightly, with dormant-flag + claim-window signals
- 🚚 **Canvassing** + lead pipeline (NEW → CONTACTED → ... → WON/LOST)
- 📱 **Mobile bottom-sheet** for on-the-ground property-to-lead capture
- 🏙️ **Metro-scoped routing** (`/m/[metro]`) — drop-in ready for multi-metro expansion

## Pricing (live)

- **Scout — Free** · 5 reveals/mo, county-wide alerts
- **Business — $99/mo** · 50 reveals/mo, 1 county
- **Pro — $249/mo** (featured) · 200 reveals/mo, multi-county, full scoring
- **Enterprise — Talk to Sales** · unlimited reveals, API, territory locking, team GPS

14-day free trial on all paid plans. No per-user fees. Metered property reveals.

**Promo:** First 100 users get 3 months free.

## Docs

- [Business Plan](./BUSINESS_PLAN.md)
- [Market Research](./MARKET_RESEARCH.md)
- [Implementation Overview](./IMPLEMENTATION_OVERVIEW.md)
- [Data Audit & Gap Analysis](./DATA_AUDIT_GAP_ANALYSIS.md)
- [SWOT](./SWOT.md)
- [Architecture](./architecture/)
- [API docs](./docs/)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)

## Getting Started (dev)

### Prerequisites

- Node.js 18+
- PostgreSQL 14 with PostGIS
- Redis 7+
- Docker + Docker Compose (recommended for local Postgres + Redis)

### Local setup

```bash
# Clone and install
git clone <repo>
cd Eavesight
npm install

# Spin up Postgres + Redis
docker compose up -d

# Backend env
cp apps/backend/.env.example apps/backend/.env
# Fill in DATABASE_URL, REDIS_URL, JWT_SECRET, etc.

# Migrate
cd apps/backend
npx prisma migrate deploy
npx prisma generate

# Run backend + frontend (from repo root)
cd ../..
npm run dev        # starts both via pm2 ecosystem
```

Backend: `http://localhost:4000` · Frontend: `http://localhost:3003` · Postgres: `localhost:5433`

## Tech Stack

### Frontend
- Next.js 14 (React + TypeScript, App Router)
- Tailwind CSS + shadcn/ui
- MapLibre GL (open-source map renderer)
- TanStack Query (server state)
- Zustand (client state)

### Backend
- NestJS (TypeScript)
- Prisma ORM over PostgreSQL 14 + PostGIS
- Redis + BullMQ (workers for storm ingest, scoring, hex aggregation, pin-card rebuild)
- JWT authentication + multi-tenant orgs
- Scheduled jobs via `MaintenanceProcessor`

### Data Sources
- **SPC** — national storm events (bulk CSV + API)
- **NOAA** — supplementary storm data
- **FEMA** — disaster declarations
- **Microsoft Building Footprints** — national polygon dataset
- **ArcGIS** — Madison / Limestone / Morgan / Marshall / Jackson county assessor services
- **City of Huntsville CoC / permit services** — building permits and new construction
- **MRMS** — per-property hail exposure
- **US Census ACS** — block-group demographics + median year built

### Infrastructure
- Vercel (frontend)
- Managed Postgres (production) / Docker (dev)
- Object storage for PMTiles + exported layers

## Feature Status

### Shipped (Phase 1 MVP)
- Storm ingest + map overlays
- Property search + detail view with pin cards
- Lead management (CRUD, pipeline, activities, assignment)
- Hail exposure scoring + unified lead score
- Canvassing with route tracking
- User auth + multi-tenant orgs
- Metro-scoped API (H3 hex aggregates, viewport queries, pin-card tiers)
- Mobile bottom-sheet

### In flight
- Skip-trace integration (owner phone/email backfill)
- `roof_data` population (measurement source TBD — EagleView / Roofr / Nearmap / GeoX / geometry-based)
- Property-reveal meter + roof-measurement credit ledger
- Stripe billing wiring
- Nashville data ingestion

### Future
- ML roof-condition detection from imagery
- Insurance-claim automation
- Public API (Enterprise tier)
- White-label for large roofing chains

See [DATA_AUDIT_GAP_ANALYSIS.md](./DATA_AUDIT_GAP_ANALYSIS.md) for a full gap list against the business plan.

## License

Proprietary — all rights reserved.
