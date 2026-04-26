---

# Eavesight pre-launch audit

## 1. TL;DR (5 bullets)

- **Most legally dangerous gap**: TCPA/DNC enforcement is theatre. `DncService` exists at `apps/backend/src/data-pipeline/dnc.service.ts` but is **not registered as a provider in any NestJS module**, and `dnc_entries` table holds **0 rows**. Any user with a paid plan can pull `ownerPhone` for 240k+ properties and get sued at $500–$1,500/call.
- **Biggest blocker to charging money**: There is **zero Stripe code** anywhere — no SDK, no webhook, no checkout, no portal, no plan‑change flow. The settings "Billing" tab (`apps/frontend/src/app/(dashboard)/dashboard/settings/page.tsx:325`) renders three hardcoded plans with a "Coming Soon" disabled button.
- **Most-likely silent margin killer**: Google Geocoding API. `GOOGLE_GEOCODING_API_KEY` is single‑shared, called from at least two services, and a script `geocode-ms-placeholders.js --all` was running live during this audit. No quota wall, no rate limiter on the Nest app at all (no `@nestjs/throttler`). At ~$5 / 1k after the 10k free tier, one bad pipeline iteration burns $100s overnight.
- **Biggest tenant-isolation risk**: `PropertiesService.findOne(id)`, `findInBounds`, `lookup`, `nearest`, and the `/map/*`, `/madison/*`, `/harvester/*` controllers serve owner PII (name, phone, email, mailing address) **without any orgId scoping or reveal counter** — and several of those controllers have **no auth guard at all**. Org A doesn't need to manipulate paths to query Org B's data; the property data is just a flat tenant-shared pool.
- **Biggest ops single‑point‑of‑failure**: Production runs as **single PM2 cluster on this VM** (`pm2 list` shows backend + frontend, 12h uptime, no replicas), Postgres on `localhost:5433` with one ad‑hoc dump in `<host-backups>/` from 04:29 today. No cron, no off‑host backup, no Sentry, no log shipping. VM reboot or disk failure = total data loss + hours of downtime.

## 2. Billing readiness checklist

| Piece | Status | Location |
|---|---|---|
| Stripe SDK installed | **MISSING** | not in `apps/backend/package.json` |
| Checkout / Subscription create | **MISSING** | grep returned 0 results |
| Webhook endpoint (`/stripe/webhook`) | **MISSING** | no controller |
| Customer portal link | **MISSING** | settings tab is a static disabled UI |
| `Organization.stripeCustomerId` field | exists in schema but **never written** | `prisma/schema.prisma:60` |
| `Organization.trialEndsAt` field | exists, **never set** by `auth.service.register()` | `prisma/schema.prisma:61` |
| Plan enum vs. site | **DRIFT**: schema=`STARTER/PROFESSIONAL/ENTERPRISE`; landing page=`Scout/Business/Pro/Enterprise`; settings UI=`Starter/Pro/Team` at $49/$149 (all three sources disagree) | `schema.prisma:79`, `app/page.tsx:516-672`, `settings/page.tsx:340-343` |
| Property reveal meter (5/50/200/∞) | **MISSING** — no counter, no decrement, no enforcement | nowhere |
| Roof measurement credits | **MISSING** | nowhere |
| 14-day trial logic | **MISSING** — landing copy says "14-day free trial", signup page says "3 months free, then $49/month", code sets nothing | `signup/page.tsx:74` |
| "First 100 users 3 months free" promo | **MISSING** — marketing copy only (`page.tsx:36`) |
| `ApiUsageService.checkQuota` callable | **dead** — only `TracerfyService.skipTraceProperty` ever calls it; tracerfy endpoint isn't even routed | `common/api-usage.service.ts` |
| `api_quotas` / `api_usage` rows | **0 / 0** in live DB | psql |
| `/auth/register` flow | creates user + org + `OWNER` membership but **does not collect plan, payment, or trial** | `auth/auth.service.ts:17-72` |

Bottom line: **you cannot accept money today**. There is no path from "sign up" to "card on file."

## 3. Compliance checklist

| Item | Status |
|---|---|
| Federal DNC scrub before reveal/outreach | **NOT ENFORCED**. `DncService` is not in `DataPipelineModule.providers` (`data-pipeline.module.ts:14-26`). Methods are uncallable. `dnc_entries` table = **0 rows**. `Property.onDncList = false` for everyone by default. |
| Per-property "do not contact" override | schema-only flag, no UI to set, no API to toggle |
| Quiet hours / TZ-aware calling rules | **MISSING** |
| TCPA written-consent capture | **MISSING** |
| CAN-SPAM unsubscribe footer | **N/A** — no email sender wired (no nodemailer/SendGrid/SES in deps) |
| `/terms` page | **404** — `signup/page.tsx:160` links to `/terms` and `/privacy`; no `app/terms/` or `app/privacy/` directories exist |
| `/privacy` page | **404** — same |
| `/demo` page | **404** — landing CTA links to it, doesn't exist |
| Cookie banner / GDPR / CCPA | **MISSING** (B2B SaaS — okay to defer, but CCPA for data brokers is non-trivial since you sell PII) |
| Audit trail of contact reveals | **MISSING** — no `audit_log` table; `ApiUsage` table records cost but never gets written for property views |
| Email verification | `User.emailVerified` field exists, **never set** in register path; no token table, no sender |
| Password reset | login page links `/forgot-password` (route doesn't exist); zero backend support |

The "data broker" side of this product (selling owner phone numbers) creates real exposure under TCPA, FCRA-like state laws (NY, IL, CA), and the Alabama UDAP statute. The DNC stub is worse than nothing because the marketing claims compliance.

## 4. Tenant-isolation audit

Endpoints checked → finding:

| Endpoint | Guard | Org-scoped query | Verdict |
|---|---|---|---|
| `GET /api/leads/:id` | JWT | yes (`leads.service.ts:77` rechecks `lead.orgId !== orgId`) | **OK** |
| `POST /api/leads` | JWT | yes (orgId from `req.user`) | **OK** |
| `GET /api/orgs/:id` | JWT | yes (membership check) | **OK** |
| `POST /api/orgs/:id/members` | JWT | OWNER/ADMIN check, but **looks up user by email and silently adds them with no invitation/email confirmation** (`organizations.service.ts:115`) | **DANGEROUS** — anyone in your org can add an external user by typing their email; no consent flow |
| `GET /api/properties/:id` | JWT | **NO orgId filter** — returns full record incl. `ownerPhone`, `ownerEmail`, `ownerMailAddress` | **TENANT BREAK** |
| `GET /api/properties/in-bounds` | JWT | **NO orgId filter**, returns `ownerPhone`/`ownerEmail` selected explicitly (`properties.service.ts:255-258`) | **TENANT BREAK + PII LEAK** |
| `POST /api/properties/lookup` | JWT | **NO filter** | **TENANT BREAK** |
| `GET /api/map/scores`, `GET /api/map/pmtiles/:id/property` | **NO @UseGuards** | n/a | **PUBLIC** to internet |
| `GET/POST /api/madison/*` (6 routes) | `@Public()` | n/a — incl. `POST /madison/leads` which **accepts orgId in the body** and creates leads for any org | **PUBLIC + IDOR**: any unauthenticated caller can manufacture leads against any org |
| `POST /api/harvester/start`, `/harvester/reset`, `/harvester/batch` | **NO guard** | n/a | **PUBLIC** — anyone can kick off a multi-hour scrape job that consumes Census/Google quota |
| `GET /api/alerts/stream` (SSE) | JWT | filter is **TODO** in code (`alerts.controller.ts:47-58` says "we let every batch through; the client filters") | every connected user receives every other org's storm alert payload |

The pattern: **lead/org tables are scoped, but the underlying Property + parcel data is treated as a shared global pool**, and PII sits inside it.

## 5. Ops readiness

| Item | Status |
|---|---|
| Production host | **single VM**, PM2 cluster (1 instance each, max_memory_restart 512M). Frontend bound to `0.0.0.0:3000`, backend `0.0.0.0:4000`. No reverse proxy / TLS visible. |
| `deploy.sh` | references **Vercel CLI** (drift) — not used; PM2 is the actual production. |
| CI/CD | **none** — no `.github/` directory. |
| Postgres backups | **one** ad-hoc dump `<host-backups>/eavesight-pre-rename-20260425-042941.dump` (497 MB, today 04:53) + an April 23 pre-VPN burn. **No cron, no off-host copy.** `crontab` not even installed. |
| Error tracking | **none** — no Sentry/Datadog/Newrelic packages installed |
| Log aggregation | **PM2 stdout files only** |
| Health checks | `/api/health` and `/api/health/db` exist (`health/health.controller.ts`); **nothing is probing them** (no uptime monitor configured) |
| Secrets in repo | `.gitignore` correctly excludes `apps/backend/.env`, `apps/frontend/.env`, `apps/frontend/.env.local`. **BUT `apps/frontend/.env.production` IS COMMITTED** (`git ls-files` confirms). It currently only has the LAN URL, which is fine — but lock it down before adding a Mapbox token there. |
| Plaintext secrets on disk | `apps/backend/.env` contains live `RENTCAST_API_KEY`, `TRACERFY_API_KEY` (JWT good through year 3000), `GOOGLE_GEOCODING_API_KEY` (shared across geocoding/places/solar) — also leaked into this audit transcript via `Read`. JWT secret is the dev placeholder `"eavesight-dev-jwt-secret-change-in-production-2024"`. |
| Migrations | **clean**: 8 sequential migrations under `prisma/migrations/`, with `migration_lock.toml` |
| CORS | **single-origin allowlist** = `NEXT_PUBLIC_APP_URL || http://localhost:3000` (`main.ts:10-13`) — fine |
| Auth tokens | access 15m / refresh 7d; refresh-on-rotate; logout deletes ALL sessions for the user (logs out every device). No revocation endpoint per-token. JWT default secret fallback `'default-secret-change-me'` (`jwt.strategy.ts:16`) — **fatal if `JWT_SECRET` env ever unset**. JWT also accepts `?token=` query param, which leaks into server access logs. |
| Rate limiting | **none**. `@nestjs/throttler` not installed. `RATE_LIMIT_*` env vars are unused. /auth/login can be brute-forced. |

## 6. Cost-per-paying-user estimate

Third-party APIs the running code calls:

| Service | Where called | Cost tier | Margin risk on $99 plan |
|---|---|---|---|
| **Google Geocoding** | `common/geocoding.service.ts`, `properties/geocoding.service.ts`, plus `scripts/geocode-ms-placeholders.js` (running live now) | $5/1k after 10k free | **HIGH** — no per-org meter, batch script can blast 50k overnight (~$200) |
| **Google Solar** | `properties/solar.service.ts` | "Building Insights" tier ~$5/1k for basic; HD imagery much more | Medium — only called on demand, but no quota |
| **Google Places** | env key set | $17/1k Place Details after free tier | Medium |
| **Tracerfy skip-trace** | `properties/tracerfy.service.ts` | $0.04/record (advanced) — quota-checked, but quota record never created so `checkQuota` returns "unlimited" | **HIGH** — if exposed (it's not currently routed in any controller, but the DI is wired), one user could $40 you per 1k properties |
| **RentCast** | `properties/rentcast.service.ts` | 50 free/mo, then ~$74/mo for 1k | Medium — depends on cache hit rate |
| **Census/FEMA/NOAA** | `data-pipeline/census.service.ts`, `fema.service.ts`, `storms/spc.service.ts` | free | none |
| **Mapbox / MapLibre tiles** | frontend = MapLibre + Carto basemap (free) | free as configured | none — but switch to Mapbox = $0.50/1k tile loads |
| **MRMS / GDAL processing** | local cron `scripts/maintenance.processor.ts` | local CPU only | watch disk I/O |

**Auto-running burn jobs**:
- `MaintenanceProcessor` cron at 04:00 / 05:00 / 06:00 / Sun 02:00 / monthly / quarterly — gated by `ENABLE_MAINTENANCE_JOBS=true` (currently TRUE in `.env`). Spawns shell scripts in `<repo-root>/scripts/` with 1-hour timeout. Several of those scripts hit Google Geocoding.
- `StormsProcessor`: 5 cron jobs incl. every 3 minutes, every 15 minutes, twice daily (NOAA scrape) — NOAA is free.
- `SpcService`: 7am + 7pm daily (NOAA SPC) — free.

Worst-case cost-per-user at 10 active users running ~50 reveals/day each: ~$60/mo geocoding + RentCast pass-through + $20–80 skip-trace = **$80–150/mo per active org** before you charge them. Margin on the $99 plan can go negative fast.

## 7. Punch list

### Before demo (≤ 1 day each)

1. **Create `/terms`, `/privacy`, `/demo` stub pages** — signup form already references them and the landing CTA points at `/demo`. Currently 404s. (1h)
2. **Remove the "Billing" tab from settings or relabel it "Coming soon"** — current $49/$149 tiers contradict the $99/$249 marketing. (15m)
3. **Add `@UseGuards(JwtAuthGuard)` to `MapController`, `HuntsvilleParcelController`, `KcsParcelController`; `@Public` → JWT on `MadisonParcelController`** — close the obvious anonymous holes before any prospect pokes around. (30m)
4. **Hard-fail boot if `JWT_SECRET` env not set** instead of falling back to `'default-secret-change-me'` (`jwt.strategy.ts:16`). (10m)

### Before first paying user (1–5 days each)

5. **Wire Stripe** — install `stripe`, add `BillingController` with `/billing/checkout`, `/billing/portal`, `/billing/webhook`; persist `stripeCustomerId` + `stripeSubscriptionId` (new column) + `currentPeriodEnd`; block paid-tier endpoints when subscription `inactive`. (3 days)
6. **Reconcile Plan enum with marketing**. Pick one: rename schema to `SCOUT/BUSINESS/PRO/ENTERPRISE` and migrate; update settings UI to read live `org.plan`. Add `plan_features` map server-side with reveal/measurement quotas. (1 day)
7. **Implement reveal meter**. New `PropertyReveal` table (`orgId`, `propertyId`, `userId`, `createdAt`); `PropertiesService.findOne` checks if first reveal this period; if no, decrement quota and write audit row; if over quota, return masked record (city/zip/score, no `ownerPhone/Email/Name/MailAddress`). Strip the same fields from `findInBounds` regardless. (2 days)
8. **Fix tenant isolation on PII fields**. Default `properties.findOne` and `findInBounds` SELECTs should exclude `ownerPhone`, `ownerEmail`, `ownerMailAddress`, `ownerFullName`. Re-include only after reveal-meter check. (4h, included in #7)
9. **Make DNC real or remove the marketing claim**. (a) Register `DncService` in `DataPipelineModule.providers`. (b) Buy a DNC subscription ($75–250/yr from Possible NOW etc.) and write the import. (c) In the reveal endpoint, if `onDncList = true`, return `ownerPhone = null` with reason. (d) Add an internal opt-out endpoint per phone. (2 days)
10. **Backups**: install `cron`, add nightly `pg_dump | gzip | rclone copy` to S3/B2/Drive (any off-host). One-liner. **Add Sentry** to backend + frontend (free tier). **Add an UptimeRobot probe** of `/api/health`. (3h total)

### Before Series A diligence (defer, but track)

- Audit log table (`who revealed which property when`) — needed for any data-broker compliance defense.
- Email verification + password reset (need a transactional email provider — Resend or Postmark, $0/mo to start).
- `@nestjs/throttler` on `/auth/login`, `/auth/register`, and any reveal endpoint.
- Replace `?token=` query JWT with header-only.
- Per-org alert filter on the SSE stream.
- Member invitation flow (email link, accept page) instead of "type the email and they're in."
- Move secrets out of `apps/backend/.env` to a vault (1Password CLI / SOPS) and rotate Google + Tracerfy + RentCast keys (they were just exposed in this transcript).
- CI: at minimum a GitHub Action that runs `pnpm tsc --noEmit` + `prisma validate` on PR.
- Multi-instance / failover plan: at least a warm Postgres replica or a managed DB (Neon/RDS).
- Strip three `.bak` schema files and three `.bak`/`.v3` processor files from `src/` so they stop appearing in greps and confusing future contributors.

### Key files referenced

- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/auth/auth.service.ts`, `auth.controller.ts`, `jwt.strategy.ts`
- `apps/backend/src/properties/properties.service.ts`, `properties.controller.ts`, `tracerfy.service.ts`
- `apps/backend/src/data-pipeline/dnc.service.ts`, `data-pipeline.module.ts`, `maintenance.processor.ts`
- `apps/backend/src/data-pipeline/madison-parcel.controller.ts`, `huntsville-parcel.controller.ts`, `kcs-parcel.controller.ts`
- `apps/backend/src/map/map.controller.ts`, `alerts/alerts.controller.ts`
- `apps/backend/src/common/api-usage.service.ts`, `geocoding.service.ts`
- `apps/backend/src/main.ts`, `app.module.ts`
- `apps/backend/.env` (live secrets, not committed)
- `apps/frontend/src/app/page.tsx` (pricing copy), `signup/page.tsx`, `(dashboard)/dashboard/settings/page.tsx`
- `ecosystem.config.js`, `ecosystem.frontend.config.js`, `deploy.sh`, `docker-compose.yml`
- `<host-backups>/` (only place backups live)
