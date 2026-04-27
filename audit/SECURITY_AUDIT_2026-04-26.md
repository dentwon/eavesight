# Eavesight Security Audit — 2026-04-26

Comprehensive code review across auth, billing, IDOR/authz, infra, and dependencies.
**No live probing performed** — code review only. Production exposed via Cloudflare tunnel:
- eavesight.com / www / app → `:3000` (Next.js)
- api.eavesight.com → `:4000` (NestJS)

## Scoring

- **Critical**: data exposure, privilege escalation, or revenue-impacting silent bug
- **High**: exploitable with effort, confidentiality/integrity impact
- **Medium**: defense-in-depth, slower exploitation paths, or hardening gaps
- **Low**: hygiene / hardening polish

---

## CRITICAL

### C1 — Privilege escalation via PATCH /users/:id mass assignment
- **File**: `apps/backend/src/users/users.service.ts:48-73` (called from `users.controller.ts:32`)
- **Issue**: `prisma.user.update({ where: { id }, data: updateData })` with `updateData: any`. Any logged-in user can `PATCH /api/users/<self>` `{ "role": "SUPER_ADMIN" }` and self-promote. The `forbidNonWhitelisted` global pipe is defeated by the `any` typing.
- **Fix**: Whitelist allowed fields server-side (`firstName`, `lastName`, `avatar`); strip `role`, `passwordHash`, `refreshToken`, `emailVerified`, `stripeCustomerId`, `orgId`. Type the parameter with the DTO.

### C2 — DELETE /users/:id has no role guard
- **File**: `apps/backend/src/users/users.controller.ts:39-41`, `users.service.ts:75-82`
- **Issue**: Any authenticated user can delete any user, including SUPER_ADMIN.
- **Fix**: `@Roles('ADMIN','SUPER_ADMIN')` + RolesGuard.

### C3 — User directory enumeration via GET /users and GET /users/:id
- **File**: `users.controller.ts:14-27`, `users.service.ts:8-46`
- **Issue**: Returns all users, all roles, all `organizationMemberships` cross-org.
- **Fix**: Restrict `findAll` to admins; restrict `findOne` to self or same-org membership; never include cross-org memberships.

### C4 — Map property reveals all leads cross-org
- **File**: `apps/backend/src/map/map.service.ts:62-71`
- **Issue**: `GET /api/map/pmtiles/:id/property` returns `include: { leads: true }` with no `where: { orgId }`. Any authenticated user clicks any building and gets every other org's lead names, phones, emails for that property.
- **Fix**: Pass `req.user.orgId` through and add `where: { orgId }` to the leads include.

### C5 — Alerts SSE leaks all properties cross-org
- **File**: `apps/backend/src/alerts/alerts.controller.ts:43-60`
- **Issue**: SSE fan-out emits every alert batch to every connected user with full property address/lat/lon. Filter is client-side only.
- **Fix**: Filter the batch server-side using `getActiveAlertsForOrg` logic (lead match or territory zip match).

### C6 — Stripe webhook can never succeed (rawBody missing)
- **File**: `apps/backend/src/main.ts:9`, `billing.controller.ts:108-112`
- **Issue**: `NestFactory.create(AppModule)` called without `{ rawBody: true }`. Controller checks `req.rawBody` and 400s when absent. Every legit Stripe POST returns 400 → Stripe disables the endpoint after retries.
- **Fix**: `NestFactory.create(AppModule, { rawBody: true })`.

### C7 — Plan enum mismatch crashes every successful checkout webhook
- **File**: `apps/backend/prisma/schema.prisma:80-84` defines `enum Plan { STARTER PROFESSIONAL ENTERPRISE }`; `apps/backend/src/billing/stripe.service.ts:179` writes `planCode ∈ { SCOUT, BUSINESS, PRO, ENTERPRISE }`.
- **Issue**: Only `ENTERPRISE` succeeds. BUSINESS/PRO throws Prisma enum violation → webhook 500 → Stripe retries → customer charged but never upgraded.
- **Fix**: Migrate enum to `{ SCOUT, BUSINESS, PRO, ENTERPRISE }`.

---

## HIGH

### H1 — Earmark mutation cross-tenant
- **File**: `alerts/alerts.controller.ts:62-76`, `alerts.service.ts:111-135`
- **Issue**: `prisma.property.update` for `isEarmarked`/`earmarkedByUserId` has no org check. Org A can overwrite Org B's earmark or clear it via DELETE.
- **Fix**: Move earmarks to a per-org join table `(orgId, propertyId)`, OR refuse the mutation when the existing earmark belongs to a different org.

### H2 — Lead generation/score-all not org-scoped or admin-gated
- **File**: `leads/leads.controller.ts:58-80`
- **Issue**: `POST /api/leads/generate` does not pass `req.user.orgId`; any user triggers org-wide lead generation. `score-all` is not admin-gated.
- **Fix**: Pass orgId to generator service; gate generator + score-all on ADMIN role; add `@Throttle({ expensive })`.

### H3 — Storms sync endpoints + properties enrich-all not admin-gated
- **File**: `storms.controller.ts:52-78`, `properties.controller.ts:95-101`, `:id/enrich`
- **Issue**: Any user can trigger NOAA/SPC sync (writes global storm data, hits upstream API limits). Property enrichment is "admin-only" by comment only.
- **Fix**: `@Roles('SUPER_ADMIN')` + RolesGuard.

### H4 — JWT algorithm not pinned + accepted via ?token= query string
- **File**: `auth/auth.module.ts:23-28`, `auth/jwt.strategy.ts:17-21`
- **Issue**: No `algorithms: ['HS256']` on verify; `?token=` extractor leaks JWTs into CF/nginx logs and `Referer` headers.
- **Fix**: Pin algorithm; remove query extractor; keep only `fromAuthHeaderAsBearerToken()`.

### H5 — OAuth tokens delivered via URL fragment to localStorage
- **File**: `auth/auth.controller.ts:48-61`
- **Issue**: `/auth/oauth-complete#accessToken=...&refreshToken=...` → frontend stores in `localStorage`. XSS exfiltrates both. 7-day refresh token life.
- **Fix**: Issue tokens as `Set-Cookie` with `HttpOnly; Secure; SameSite=Lax; Domain=.eavesight.com`.

### H6 — OAuth `state` parameter missing → login CSRF
- **File**: `auth/google.strategy.ts:22-27`
- **Issue**: `passport-google-oauth20` does not auto-enable `state`. Attacker initiates OAuth, victim completes, victim signs into attacker's account.
- **Fix**: `state: true` in strategy options + session middleware, OR signed state cookie.

### H7 — Refresh tokens stored plaintext in DB
- **File**: `auth/auth.service.ts:299-312, 134-137`
- **Issue**: Anyone with read access to `Session` table (DB breach, ORM logs) gets working bearer credentials for every active user.
- **Fix**: Store SHA-256 hash; look up by hash on refresh.

### H8 — Stripe webhook idempotency missing
- **File**: `billing/stripe.service.ts:128-160`
- **Issue**: No `event.id` dedup. Stripe at-least-once delivery means replays re-grant entitlements.
- **Fix**: `model ProcessedStripeEvent { id String @id, type String, receivedAt DateTime @default(now()) }`; insert-or-skip on entry.

### H9 — Cancellation/refunds don't revoke access
- **File**: `billing/stripe.service.ts:200-209, 147-160`
- **Issue**: `markSubscriptionCanceled` only logs (DB update commented). `charge.refunded`, `charge.dispute.created` not handled.
- **Fix**: On `customer.subscription.deleted` and `charge.refunded`, set `plan='SCOUT'`, `subscriptionStatus='CANCELED'`.

### H10 — Trust proxy not set → throttler broken behind CF tunnel
- **File**: `apps/backend/src/main.ts`
- **Issue**: `req.ip` is `127.0.0.1` for all requests; ThrottlerGuard treats all traffic as one bucket. Single attacker DoSes the auth bucket for everyone.
- **Fix**: `app.getHttpAdapter().getInstance().set('trust proxy', 'loopback')`; configure throttler `getTracker` to use `cf-connecting-ip`.

### H11 — No Next.js security headers
- **File**: `apps/frontend/next.config.js`
- **Issue**: No `headers()` block. Missing CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options.
- **Fix**: Add `async headers()` for `/(.*)` with strict defaults.

### H12 — Next.js 14.1.0 multiple criticals (auth bypass, SSRF, DoS)
- GHSA-f82v-jwr5-mffw (CVSS 9.1 auth bypass), GHSA-7gfc-8cq8-jh5f, GHSA-fr5h-rqp8-mj6g (SSRF), plus DoS chain.
- **Fix**: Bump to **14.2.35** (non-breaking).

### H13 — axios SSRF (NO_PROXY bypass + cloud metadata exfil)
- GHSA-3p68-rc4w-qgx5, GHSA-fvcv-3m26-pcqx. Backend `^1.13.6`, frontend `^1.6.0`.
- **Fix**: Bump both to `>=1.15.0`.

### H14 — Properties /lookup leaks raw parcel including ownerName
- **File**: `properties/properties.service.ts:157-192`
- **Issue**: Returns `...parcel` spread with no field whitelist; `findInBounds` correctly masks.
- **Fix**: Project the same masked field set.

### H15 — Billing checkout/portal accept any member (incl MEMBER role)
- **File**: `billing/billing.controller.ts:62, 89`
- **Issue**: A junior teammate can open the billing portal and cancel the org's subscription.
- **Fix**: `@Roles('OWNER','ADMIN')` on `/checkout` and `/portal`.

### H16 — ensureCustomer race creates duplicate Stripe customers
- **File**: `billing/stripe.service.ts:78-95`
- **Issue**: Concurrent `/checkout` requests create two Stripe customers; second overwrites `stripeCustomerId`, orphaning the first.
- **Fix**: `prisma.$transaction` with `SELECT … FOR UPDATE` or upsert + unique index.

---

## MEDIUM

### M1 — Account enumeration on /register
- `auth.service.ts:26-28` throws `ConflictException('Email already registered')`. Login is correctly generic; align register.

### M2 — Logout doesn't invalidate access JWT
- Only deletes refresh sessions; 15-min access JWT survives. Add per-user `tokenVersion`; check in `JwtStrategy.validate`.

### M3 — Refresh endpoint not throttled
- `auth.controller.ts:63-70`. Add `@Throttle({ auth: { ttl: 60000, limit: 10 } })`.

### M4 — Refresh-token replay detection / token family
- `auth.service.ts:130-153`. Add `tokenFamily` column; reuse of rotated token invalidates the family.

### M5 — Per-account login lockout missing
- IP-only throttle; distributed credential stuffing not blocked. Add per-email failed-attempt counter with backoff.

### M6 — Lead bulkCreate cross-org propertyId / assigneeId not validated
- `leads/leads.service.ts:171-182, 149-159`. Validate every `propertyId` and `assigneeId` belongs to caller's org.

### M7 — LoginDto password has no max length
- 10MB password → bcrypt DoS. `@MaxLength(100)`.

### M8 — Stripe key set without webhook secret should fail boot
- `stripe.service.ts:135` throws on every request; better to fail boot.

### M9 — CORS allowlist missing `www.` and `app.` subdomains
- `main.ts:21-28` hardcodes `https://eavesight.com` only.

### M10 — `typescript.ignoreBuildErrors: true` in next.config
- Hides regressions in role/auth code shipping to prod.

### M11 — @nestjs/* on 10.x; bump to 11.x for CVE coverage
- GHSA-36xv-jgw5-4q75 (CVSS 6.1 injection), platform-express + multer chain.

---

## LOW

### L1 — `poweredByHeader: false` not set in next.config
### L2 — `images.domains` deprecated form, has dead `api.eavesight.app` entry (note `.app` typo)
### L3 — Helmet CSP disabled in non-production
### L4 — No password-reset flow exists at all (functional + security gap)
### L5 — Frontend `middleware.ts` does no auth check (presence-of-cookie redirect would shave off SSR-rendered protected page leaks)
### L6 — Confirm `pg_hba.conf` `10.200.0.0/16` rule is your VPN CIDR (not routable elsewhere)
### L7 — Apply `git filter-repo` to remove historic LAN IP leak in `apps/frontend/.env.production` (low risk; was only `NEXT_PUBLIC_*` keys + LAN IP)

---

## Things checked and OK

- `JWT_SECRET` hard-fails when missing
- bcrypt cost 12, timing-safe compare
- Login error messages generic (no enumeration)
- Backend binds to 127.0.0.1 only; UFW deny-incoming
- PostgreSQL bound to 127.0.0.1, scram-sha-256
- ValidationPipe global with whitelist + forbidNonWhitelisted (defeated only where service signature accepts `any`)
- No real secrets ever committed to git history
- No supply-chain-incident packages present
- bcrypt@5.1.1, prisma@5.x, helmet@8.x, class-validator@0.14.x current

---

## Iteration plan

Hardening branch: `harden/security-2026-04-26`. Each batch: edit → typecheck → build → commit. **No prod restart overnight.** User reviews and deploys in the morning.

Batch order (by blast radius):
1. **C1–C5** — authz + IDOR
2. **C6–C7** — billing correctness (webhook + plan enum)
3. **H1–H3** — remaining authz gaps
4. **H4–H7** — auth/JWT/OAuth hardening
5. **H8–H9** — billing idempotency + lifecycle
6. **H10–H11** — infra (trust proxy + headers)
7. **H12–H13** — dependency bumps (Next 14.2.35, axios 1.15)
8. **H14–H16** — remaining highs
9. **M1–M11** — defense-in-depth
10. **L1–L7** — polish


---

## Re-audit pass — 2026-04-27 (post batch B)

Three parallel agents reviewed the harden branch for new findings.

### Closed in batch C (this commit)

- **NC1** — `OrganizationsService.update` accepted `plan` in DTO, letting any
  ADMIN self-grant ENTERPRISE. `addMember` allowed an ADMIN to assign OWNER.
  Fix: removed `plan` from `UpdateOrganizationDto`; role-ladder enforcement on
  `addMember` (only OWNER may grant OWNER; ADMIN may grant ADMIN/MEMBER/VIEWER).
- **NC2** — Madison/Huntsville/KCS parcel harvester POST routes were open to
  any authenticated user. Now `@Roles('SUPER_ADMIN')` on every POST.
- **NC10** — `/health/db` returned raw Prisma error message including DSN
  (`postgresql://user:pass@…`). Now logs internally, returns generic status.
- **Earmark holder org lookup** (re-audit #3) — was non-deterministic for
  multi-org users via `findFirst`. Now queries direct overlap (caller orgId
  ∈ holder's memberships).
- **Lockout FIFO** (re-audit #6) — eviction was insertion-order, not LRU.
  Attacker could churn 10k throwaway emails to push a target out of the map.
  Fix: bump-on-touch via delete-then-set on `recordFailure`.
- **Dummy bcrypt hash** (re-audit #8) — the constant string `$2b$12$0123…01a`
  was not a valid bcrypt format; `bcrypt.compare` rejected fast and the
  timing-equalization defense never engaged. Fix: real `bcrypt.hashSync`
  result computed once at module load.
- **NC4** — bbox/limit floats spliced into `$queryRawUnsafe` without
  finiteness checks. `parseFloat` in current callers makes this safe today,
  but a future caller bypassing parseFloat could inject. Fix: explicit
  `Number.isFinite()` guards in `MapService.scoresForBbox` + `MapController`.

### Deferred — require user attention

- **C1 + H2 + C2 (frontend)** — tokens still stored in `localStorage` (zustand
  + dedicated keys); SSE passes `?token=` in URL. The httpOnly-cookie work
  on the backend (batch A) is half-done; the frontend still uses the old
  fragment+localStorage flow. Full fix needs a coordinated frontend refactor:
  - Backend: switch `/auth/login` and `/auth/refresh` to set the same
    `eavesight_access` / `eavesight_refresh` cookies as Google OAuth, and
    have `JwtStrategy` read either the Authorization header OR the cookie.
  - Frontend: drop `localStorage.{set,get}Item('token'…)`, drop `partialize`
    of token in `auth.ts`, change `lib/api.ts` to use `credentials:'include'`
    instead of Authorization header.
  - SSE: convert `useStormAlerts.ts` from `EventSource` to `fetch` with
    `ReadableStream` (cookies sent automatically), or issue a short-lived
    single-use ticket via POST.

  Scope is too large for overnight work and risks breaking active sessions.

- **NC3** — `metros/:code/viewport` and `metros/:code/top` are unscoped, no
  rate limit, scrapeable. Add `@Throttle({ default: { ttl: 60_000, limit: 30 } })`
  + min bbox size. Affects user-visible quotas; user should review impact.

- **NC6** — Reveal-meter race (concurrent reveals double-spend). Fix needs
  a `UNIQUE INDEX api_usage_org_service_property_period_idx ON apiUsage(orgId, service, propertyId, date_trunc('month', createdAt))`
  + INSERT ON CONFLICT in `recordReveal`. Migration-dependent.
  → Add to `audit/PENDING_MIGRATION_security_2026-04-26.sql`.

- **NC7** — PII mask is block-list (`maskPii`) — easy to drift. Should be
  inverted to an explicit allow-list of public fields. Touches the entire
  property serialization layer; defer to user.

- **NC8** — `canvassing.service.ts` returns owner PII (firstName, lastName,
  phone, email, ownerFullName, ownerPhone, ownerEmail) without checking the
  reveal economy. This bypasses the metering. Service-level fix: gate owner
  fields behind `revealMeter.checkReveal` per row OR mask owner fields by
  default in canvassing responses (only return contact info from the `Lead`
  itself, not the underlying `Property`). User decides on UX.

- **CSP `unsafe-eval`** — drop in production builds (Next.js 14 prod bundles
  don't need it). Trivial follow-up.

### Status log entry

- 2026-04-27 iteration 2 (batch C): closed 7 re-audit findings. Backend tsc clean.
