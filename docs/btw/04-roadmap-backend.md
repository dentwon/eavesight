# Backend Roadmap — Engineering Work Needed

Prioritized punch list for the NestJS backend (`apps/backend/`).
Items are P0 (security/correctness — must ship before broader rollout),
P1 (correctness/UX), P2 (nice-to-have).

## P0 — Security + correctness blockers

### 1. Multi-tenant data isolation (Row-Level Security)

**Status**: Currently all users can theoretically query each other's data because there's no enforcement layer. The `orgId` field exists on `users` but isn't being used as a query filter anywhere.

**Risk**: One org's analyst can see another org's lead lists, search history, saved properties, skip-trace results.

**Plan**:
1. Add `orgId text NOT NULL` (or NULL for system-owned) to every user-data table:
   - `saved_properties`
   - `lead_lists`
   - `skip_trace_logs`
   - `search_history`
   - `org_members`
   - `notifications`
2. Enable Postgres RLS on each:
   ```sql
   ALTER TABLE saved_properties ENABLE ROW LEVEL SECURITY;
   CREATE POLICY org_isolation ON saved_properties
     USING (org_id = current_setting('app.org_id')::text);
   ```
3. In `apps/backend/src/auth/auth.guard.ts`, after JWT decode, set the session variable:
   ```sql
   await prisma.$executeRaw`SELECT set_config('app.org_id', ${user.orgId}, true)`;
   ```
4. Tests: write integration tests that try to fetch user A's data while authenticated as user B; assert 0 rows.

**Effort**: 2-3 days. Do this BEFORE any external user pilot.

### 2. PII gating on the pin endpoint

**Status**: `/api/metros/:code/properties/:id/pin` returns full `payloadPro` (owner name + mailing address + history) regardless of user tier.

**Risk**: Any authenticated free-tier user can scrape all owner data via JWT. PII leak.

**Plan**:
1. Add `tier` enum to users: `'free' / 'pro' / 'enterprise'`
2. In `metros.controller.ts` pin endpoint:
   ```ts
   const card = await this.metrosService.getPinCard(metroCode, propertyId);
   return user.tier === 'free' ? card.payloadFree : card.payloadPro;
   ```
3. Add per-user daily quota on `payloadPro` requests (default 25/day for free users, 1000/day for pro)
4. Log every `payloadPro` fetch to `audit_log` table — see #4 below

**Effort**: 1 day. SHIP IMMEDIATELY.

### 3. Skip-trace cost gating + audit trail

**Status**: Tracerfy integration exists in code but skip-trace requests are not yet being charged-back to the org or audited.

**Risk**:
- Org could rack up unbounded API spend
- No record of who looked up which homeowner (legal liability for skip-trace under FCRA-adjacent rules)

**Plan**:
1. Add `skip_trace_logs` table:
   ```sql
   CREATE TABLE skip_trace_logs (
     id uuid PRIMARY KEY,
     org_id text NOT NULL,
     user_id text NOT NULL,
     property_id text NOT NULL,
     requested_at timestamptz DEFAULT now(),
     api_cost_usd numeric(10,4),
     result_phone text,
     result_email text,
     tracerfy_request_id text
   );
   ```
2. Wrap Tracerfy call in a service that:
   - Checks org's monthly skip-trace credit balance
   - Decrements on success
   - Inserts log row regardless
3. Expose `GET /api/orgs/:id/skip-trace-usage` for billing visibility

**Effort**: 1.5 days

### 4. Audit log table + middleware

**Status**: Nothing audited.

**Plan**:
1. `audit_log` table: `(id, org_id, user_id, action, resource_type, resource_id, ip, user_agent, created_at, payload jsonb)`
2. NestJS interceptor that logs every authenticated mutation
3. Read-side: log all PII-containing reads (pin payloadPro, skip-trace, owner export)
4. Retention: 12 months hot, 36 months cold

**Effort**: 1 day

### 5. Rate limiting per user / per IP

**Status**: No rate limiting at all (`@nestjs/throttler` not installed).

**Plan**:
- Install `@nestjs/throttler`
- Default 60 req/min per IP, 200 req/min per authenticated user
- Tighter on auth endpoints: 5 login attempts / 15 min / IP
- Tighter on pin payloadPro: 25/day for free tier
- Return 429 with `Retry-After` header

**Effort**: 0.5 day

### 6. JWT secret rotation + refresh-token revocation

**Status**: `JWT_SECRET` is a static env var; refresh tokens never invalidated even after password change.

**Plan**:
- Add `revoked_refresh_tokens` table (jti claim)
- On password change / logout-all / suspicious activity → revoke all family tokens
- Document key-rotation runbook (sed env var → SIGTERM PM2 reload)

**Effort**: 0.5 day

---

## P1 — Correctness / UX

### 7. Filter-panel API extensions (already in flight)

`/api/metros/:code/viewport` and `/top` need to accept:
- `spcHailCount5y` (min)
- `spcHailMaxInches` (min)
- `spcTornadoCount` (min)
- `spcSevereOrExtremeCount` (min)
- `yearBuiltMin`, `yearBuiltMax`
- `scoreMin`, `scoreBucket` (one of hot/warm/cool/cold)
- `dormantFlag` (boolean)
- `hasProbateTrigger` / `hasRecentTransfer` / `hasInvestorFlip` (booleans)

Plus a `scoreBucket` facet count in the response for filter UI badges.

### 8. Score-reason transparency endpoint

Currently `payloadPro.scoreReasons.bullets[]` is a flat list. Add `/api/properties/:id/score-breakdown` that returns:
- Per-component contribution (urgency 32, revenue 18, trigger 25, occupancy 9)
- Top 5 storm events that drove urgency
- Triggered owner-history events with dates
- Counterfactual: "if probate trigger were absent, score would be 64 (warm) instead of 84 (hot)"

This is product differentiation — competitors don't show their work.

### 9. Per-roofer adaptive scoring (Phase 2/3 of vision)

**Now**: Static formula, same for everyone.

**Phase 2** (next): Per-org weights based on user-stated preferences (residential vs commercial, target value range, focus on storm vs aging).

**Phase 3** (later): Behavioral learning. Track which leads each user views/commits/closes. Re-rank their map.

Database support: `org_score_preferences` table, `user_lead_actions` table.

### 10. Permit matcher v2

Currently 0.7% match rate. After geocoder finishes, add:
- Address → property fuzzy match with USPS standardization
- Lat/lon → property bbox match (when permits have lat/lon)
- Confidence score (`permit_match_confidence`)
- Manual-review queue for low-confidence matches

### 11. Storm path geometry rendering

After SVRGIS ingest, expose `pathGeometry` in viewport endpoint so frontend can render tornado tracks as polygons (currently rendered as points only).

### 12. Background job dashboard

NestJS Bull-Board UI at `/admin/queues` with auth gating. Lets ops see ingestion lag at a glance.

### 13. Backend health checks beyond `/health`

Add:
- `/api/health/db` — Prisma connection + slow-query check
- `/api/health/queues` — BullMQ queue depths
- `/api/health/ingest` — last successful run of each pipeline
- Public-facing `/api/health/status` rolled-up

---

## P2 — Nice-to-have

### 14. WebSocket for live storm alerts
Currently polling. Move to WebSocket subscription per-org per-county.

### 15. Webhooks for org events
Lead-created, score-changed, storm-overhead. Signed payload (HMAC).

### 16. Bulk export (CSV) gated
Pro+ tier. Async job + S3 link. Audit-logged.

### 17. API key auth (alternative to JWT)
For enterprise integrations.

### 18. Soft-delete on user-data tables
`deletedAt timestamptz` instead of hard delete.

---

## Schema migrations needed

```sql
-- Multi-tenancy
ALTER TABLE saved_properties ADD COLUMN org_id text NOT NULL;
ALTER TABLE lead_lists ADD COLUMN org_id text NOT NULL;
ALTER TABLE search_history ADD COLUMN org_id text NOT NULL;

-- Tier
ALTER TABLE users ADD COLUMN tier text DEFAULT 'free';

-- Audit
CREATE TABLE audit_log (...);
CREATE TABLE skip_trace_logs (...);
CREATE TABLE revoked_refresh_tokens (...);

-- Per-org config
CREATE TABLE org_score_preferences (...);
CREATE TABLE user_lead_actions (...);

-- RLS
ALTER TABLE saved_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON saved_properties USING (org_id = current_setting('app.org_id')::text);
-- (repeat for every user-scoped table)
```

---

## Sequencing recommendation

- **Week 1**: P0 #1 (RLS) + #2 (PII gate) + #5 (rate limit). Ships before any user pilot.
- **Week 2**: P0 #3 (skip-trace audit) + #4 (audit log) + #6 (token revocation).
- **Week 3**: P1 #7 (filters) + #8 (score breakdown).
- **Week 4+**: P1 #9-13.
- **Backlog**: P2.
