# Eavesight Deployment Strategy

**Updated: April 2026**

Eavesight is live in closed beta. This doc describes the current hosting posture and the near-term scale-up plan. (For first-time dev setup, see [README.md](./README.md); for CLI/Vercel frontend deploy steps, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).)

## Current State

### Services running

- **Frontend (Next.js 14)** — Vercel production, `eavesight.com`
- **Backend (NestJS)** — Node process on VPS, reverse-proxied through nginx, TLS via Let's Encrypt
- **Database** — PostgreSQL 14 + PostGIS (dev: Docker on `localhost:5433`; production: managed instance)
- **Cache / Queue** — Redis 7 (dev: Docker; production: managed instance)
- **Workers** — BullMQ processors for storm ingest, nightly score-collapse, hex aggregate rebuild, pin-card rebuild, hail exposure computation

### Data footprint

- 243K properties, 2.1M storm events, 6.6M property↔storm links, 4,660 H3 hex aggregates, 30K permits, 174K raw parcels — all loaded and queryable. See [DATA_AUDIT_GAP_ANALYSIS.md](./DATA_AUDIT_GAP_ANALYSIS.md) for coverage detail.
- Postgres DB size currently dominated by `property_storms` (6.6M rows) and `storm_events` (2.1M rows). No sharding yet; single-instance is fine through Year-1 load.

### Geographic coverage

- **Live metro:** Huntsville / North Alabama (Madison, Limestone, Morgan, Marshall, Jackson counties)
- **Storm data:** nationwide (will stay nationwide — property-level metros are what's gated)
- **Next metro:** Nashville (Davidson, Williamson, Rutherford, Sumner, Wilson) — CAD ingestion queued

## Production Architecture

```
Internet
    ↓
eavesight.com (Vercel DNS)
    ↓
    ├── /                → Vercel (Next.js SSR + static)
    └── /api/*           → Backend VPS (nginx → NestJS on :4000)
                              ├─ Postgres (managed)
                              └─ Redis (managed) → BullMQ workers
```

### Key environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (with `?connection_limit=25&pool_timeout=20`) |
| `REDIS_URL` | Redis connection for cache + BullMQ |
| `JWT_SECRET` | Session signing |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | **Pending** — billing not yet wired |
| `SKIP_TRACE_API_KEY` | **Pending** — owner phone/email enrichment |
| `ROOF_MEASUREMENT_API_KEY` | **Pending** — EagleView/Roofr/Nearmap |
| `NEXT_PUBLIC_API_URL` | Frontend → backend base URL |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MapLibre style (OSM-based) |

## Deployment Flow

### Frontend (Vercel)

Push to `main` → Vercel auto-deploys. Manual deploy:

```bash
cd apps/frontend
vercel --prod
```

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for full Vercel setup.

### Backend (VPS)

```bash
# On the VPS
cd /opt/eavesight/Eavesight
git pull
cd apps/backend
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart ecosystem.config.js
```

`ecosystem.config.js` runs the API + worker processes. Logs in `logs/`.

### Database migrations

Always run `npx prisma migrate deploy` (not `migrate dev`) in production. Migrations live in `apps/backend/prisma/migrations/`. Recent migrations:

- `20260422020000_pin_card_roof_age_source` — denormalized roof-age source on pin cards
- `20260421170000_add_roof_installed_at` — roof-install anchor column
- `20260420120000_viewport_indexes` — bbox/score composite indexes for viewport queries
- `20260420000000_metros_hex_pincard` — scale-ready Metro + PropertyHexAggregate + PropertyPinCard
- `20260419120000_add_unified_score` — unified 0-100 score columns

## Scale Plan

### Now through Nashville launch (Months 1-10)

- Single VPS + managed Postgres/Redis is sufficient through ~200K API requests/day
- Postgres at ~3-5 GB; expected to hit ~8 GB after Nashville ingest
- Vercel Pro for frontend (analytics, higher build limits, commercial use)

### Year-end (Month 12) projected load

- 500 total users, ~235 paying, ~2K map-sessions/day
- Still well within single-Postgres headroom; add read replica when `EXPLAIN` timings regress

### Year 2+ (multi-metro, >1K paying users)

- Promote Postgres to primary + read replica
- BullMQ workers split into dedicated worker nodes
- PMTiles export pipeline for hex aggregates moves to object storage + CDN (already scaffolded)
- Consider partitioning `property_storms` by date (nightly-hot vs archival)

## Known Deployment Gaps

Tracked against the business plan and data audit:

1. **Stripe billing** — `Organization.stripeCustomerId` unused; tier enforcement not live. Needs webhook handler + subscription lifecycle.
2. **Property-reveal meter** — the metered unit of value (Scout 5 / Business 50 / Pro 200 / Enterprise unlimited) has no backing ledger. Must be built before paid launch.
3. **Roof-measurement credit ledger** — same issue, same priority, separate ledger.
4. **Skip-trace pipeline** — zero owner phones/emails in DB; needs API + nightly backfill.
5. **Backup / DR** — document the restore procedure; currently only nightly pg_dump to object storage.

## Customer Acquisition

### Primary channel (Huntsville)

- Landing-page promo: **first 100 users get 3 months free** (currently live)
- Direct outreach to Huntsville/Madison County roofing contractors
- Facebook roofing-contractor groups
- Local chambers + trade associations

### Secondary (Nashville, launch +6 months)

- Nashville waitlist opens on landing page during ingest phase
- Launch promo tied to first-100-users-in-Nashville
- Partnership channel: material suppliers (GAF, Owens Corning), NRCA, Jobber/Housecall Pro integrations

## Success Metrics

Pulled from the business plan; targets updated to reflect live pricing.

| Metric | Target (Year 1) |
|---|---|
| Monthly churn | < 3% |
| CAC | < $100 |
| LTV | > $2,000 |
| LTV:CAC | > 3:1 |
| Time to first value | < 7 days |
| Exit MRR (Month 12) | ~$42K |
| Exit ARR run-rate | ~$500K |

See `BUSINESS_PLAN.md § Financial Projections` for full monthly ramp and assumptions.
