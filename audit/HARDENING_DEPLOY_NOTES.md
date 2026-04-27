# Hardening Deploy Notes — 2026-04-26

This branch (`harden/security-2026-04-26`) makes large code-level security
changes. Read before merging and deploying.

## Order of operations

1. **Merge to main** in a Friday-style window (the morning is fine).
2. **Install new deps** — `npm install` at repo root and in
   `apps/backend` + `apps/frontend`. New deps:
    - backend: `helmet@^8.1.0`, `cookie-parser@^1.4.7`,
      `@types/cookie-parser@^1.4.7`, `axios` bumped to `^1.15.0`
    - frontend: `next@14.2.35`, `axios@^1.15.0`
3. **Apply pending migration** —
   `audit/PENDING_MIGRATION_security_2026-04-26.sql`. See the file for
   full details. **The migration TRUNCATES the `sessions` table** —
   every currently-logged-in user is silently logged out at next refresh.
   Plan a banner on the frontend.
4. **Restart PM2** — `pm2 restart eavesight-backend eavesight-frontend`.
5. **Smoke test**:
   - `/auth/login`, `/auth/refresh`, `/auth/me`
   - `/billing/plans` (public), `/billing/checkout` (OWNER/ADMIN only),
     `/billing/webhook` (with a Stripe CLI replay)
   - `/users` (admin), `/users/:id` (self/admin), `PATCH /users/:id`
     (cannot escalate role on self)
   - `/map/pmtiles/:id/property` — verify only own org's leads attached
   - `/alerts/stream` — verify SSE only emits own org's properties

## What changed

### Critical
- **Privilege escalation closed** — `PATCH /users/:id` no longer accepts
  arbitrary fields; only SUPER_ADMIN may mutate `role`, never on self.
- **DELETE /users/:id** now requires ADMIN/SUPER_ADMIN.
- **GET /users / GET /users/:id** restricted to admins / self.
- **Map property** scopes leads include to caller's `orgId` — no more
  cross-org lead exposure on building click.
- **Alerts SSE** filters per-batch server-side: a connection only sees
  properties matching the user's leads or territory zips.
- **Stripe webhook** boots with `rawBody: true`, signature verification
  now actually works (was 400-ing every Stripe POST).

### High
- **JWT** algorithm pinned to HS256 on sign and verify; issuer/audience
  set; query-string `?token=` extractor removed.
- **OAuth** state param enabled (login CSRF closed). Tokens delivered as
  `httpOnly; Secure; SameSite=Lax` cookies on `.eavesight.com` rather than
  via URL fragment to localStorage.
- **Refresh tokens** stored in DB as SHA-256 hash, not plaintext.
- **Trust proxy + throttler tracker** — `cf-connecting-ip` is now used as
  the rate-limit key instead of `127.0.0.1` for everyone.
- **Security headers** on Next.js: CSP, X-Frame-Options DENY, HSTS,
  Referrer-Policy, Permissions-Policy, X-Content-Type-Options, no
  `X-Powered-By`.
- **Earmark mutations** scoped per-org — different org cannot overwrite or
  clear a property earmark held by another org.
- **Storms `/sync/*` + properties `/enrich-all`** require SUPER_ADMIN.
- **Lead `/score-all`, `/generate*`, `/bulk`** require OWNER/ADMIN.
- **Billing `/checkout` and `/portal`** require OWNER/ADMIN — junior
  team members can no longer cancel the org subscription.
- **`ensureCustomer`** wrapped in transactional re-check + orphan cleanup
  to defeat the Stripe-customer race condition.
- **Stripe boot validation** — fails fast if `STRIPE_SECRET_KEY` is set
  without `STRIPE_WEBHOOK_SECRET`.

### Medium
- **`/register` account enumeration** removed — same response shape and
  timing for taken/free emails.
- **`/refresh`** throttled (10/min/IP).
- **`LoginDto`** password capped at 100 chars (bcrypt DoS).
- **CORS** allowlist explicitly enumerates eavesight.com / www / app /
  api with credentials.

### Pending (loop overnight, then user reviews)
- Plan enum migration (queued in `PENDING_MIGRATION_security_2026-04-26.sql`).
- ProcessedStripeEvent dedup (same migration).
- Subscription cancel/refund handlers (same migration adds the columns).
- `User.tokenVersion` for access-JWT invalidation on logout (same migration).
- `Session.tokenFamily` for refresh reuse detection (same migration).
- `properties/lookup` PII whitelist (service-level edit).
- `leads.bulkCreate` cross-org propertyId/assigneeId validation.
- `typescript.ignoreBuildErrors=false` after type cleanup.
- NestJS 10 → 11 major bump (CVE coverage).
- Per-account login lockout.
- Password-reset flow.

## Deploy rollback

If anything explodes after PM2 restart:

```bash
ssh dentwon@192.168.86.230 "cd ~/Eavesight && git checkout main && \
  pm2 restart eavesight-backend eavesight-frontend"
```

The pending migration is `BEGIN; … COMMIT;` so a single transaction —
rollback is automatic if any step fails.

## Audit summary

See `audit/SECURITY_AUDIT_2026-04-26.md` for the full finding list with
file:line and fix details.
