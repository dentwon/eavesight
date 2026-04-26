# Security & PII Inventory

> A previous review (Claude CLI) flagged PII exposure and missing
> multi-tenant isolation. This doc enumerates every PII field in the
> system, every observed leak vector, and the compartmentalization
> plan.
>
> **Severity legend**: 🔴 Critical (fix this week) · 🟠 High (this month) · 🟡 Medium (this quarter) · 🟢 Low/known

## Part 1 — PII inventory

### Fields containing PII (sorted by sensitivity)

#### Tier A — Direct contact info (highest sensitivity)
| Field | Where | Source | Public-record? |
|---|---|---|---|
| `users.email` | users table | self-registration | No (sensitive) |
| `users.phone` | users table | self-registration | No |
| `users.passwordHash` | users table | bcrypt | N/A but treat as crown jewels |
| `properties.ownerPhone` | properties (planned, not yet populated) | Tracerfy skip-trace API | No (paid private data) |
| `properties.ownerEmail` | properties (planned) | Tracerfy | No |

#### Tier B — Quasi-PII linkable to a person (medium-high)
| Field | Where | Source | Public-record? |
|---|---|---|---|
| `properties.ownerFullName` | properties | Tyler assessor | **Yes** (public record) but quotable |
| `properties.ownerMailAddress` | properties | Tyler assessor | **Yes** but quotable |
| `properties.ownerMailCity/State/Zip` | properties | Tyler assessor | Yes |
| `properties.ownerHistory` (jsonb) | properties | Tyler assessor | Yes — but full chain implies behavior |
| `users.firstName`, `users.lastName` | users | self-registration | No |

#### Tier C — Quasi-PII (lower individual sensitivity but profiling risk)
| Field | Where |
|---|---|
| `properties.address` (when paired with ownerName) | properties |
| `properties.appraisedValue` | properties |
| `properties.lastTaxPaidDate` | properties |
| `users.avatar` URL | users |

#### Tier D — Behavioral / derived (sensitive when aggregated)
| Field | Where | Risk |
|---|---|---|
| `search_history` (planned table) | per-user | Reveals targeting patterns |
| `saved_properties` | per-user | Reveals lead-list strategy (commercially sensitive) |
| `lead_lists` | per-org | Org's pipeline |
| `skip_trace_logs` | per-user | FCRA-adjacent regulatory exposure |

---

## Part 2 — Observed / suspected leak vectors

### 🔴 V-1 — Pin endpoint returns full PII payload to all authenticated users

**Endpoint**: `GET /api/metros/:code/properties/:id/pin`
**Issue**: Returns `payloadPro` (owner name + mailing address + history) regardless of `user.tier`. A free-tier user can scrape all PII via JWT.
**Fix**: Backend P0 #2 (tier-gate the response).
**Detection**: Audit log will show after `audit_log` table ships.

### 🔴 V-2 — No row-level security on user-scoped tables

**Issue**: When `saved_properties` / `lead_lists` ship, no enforcement that user A can't see user B's records.
**Fix**: Backend P0 #1 (Postgres RLS + JWT-scoped session var).
**Detection**: Manual test with two accounts.

### 🔴 V-3 — Pin card payloadPro currently embedded in PMTiles?

**Need to verify**: Check if any owner data is being baked into the static PMTiles tile bundle. If yes, those tiles are public-CDN-cached and CANNOT be PII-gated. Tiles must contain anonymous data only.
**Fix**: Audit tile generation in `scripts/generate-pmtiles.js`. Strip any field above Tier C from tiles. Always fetch PII via authenticated API call.

### 🟠 V-4 — JWT secret static + refresh tokens never expire on password change

**Issue**: Stolen refresh token = persistent access until natural expiry (7 days).
**Fix**: Backend P0 #6 (revocation table + family tokens).

### 🟠 V-5 — No rate limiting

**Issue**: Authenticated user can call pin endpoint in tight loop, exfiltrating all 243K rows in ~1 hour.
**Fix**: Backend P0 #5 (`@nestjs/throttler` + tighter caps on PII endpoints).

### 🟠 V-6 — Skip-trace endpoint has no usage cap or audit

**Issue**: A bug (or compromised account) could rack up unbounded Tracerfy API spend AND exfil contact data.
**Fix**: Backend P0 #3 (`skip_trace_logs` + per-org credit balance).

### 🟠 V-7 — `auth_events` / audit_log doesn't exist

**Issue**: If a breach occurs, we have no record of what was accessed.
**Fix**: Backend P0 #4.

### 🟠 V-8 — Default test passwords in seed data

**Issue**: Test users (`test@stormvault.io`, `test2@stormvault.io`) have known/discoverable passwords. The login uses bcrypt so brute force is slow, but a list-based attack is plausible.
**Fix**:
1. Drop test users from prod seed
2. Use `pwgen` 24-char random for any non-prod seed
3. CI check that disallows seed files containing `password.*=.*['"](password|test|admin|123|demo)`

### 🟡 V-9 — `users.passwordHash` may be logged

**Need to verify**: Some Prisma logging modes log full row contents on update. Check that:
- `prisma.$on('query')` doesn't log to a destination that includes `passwordHash`
- NestJS interceptors don't blanket-log request bodies on `/auth/*` routes
**Fix**: Selective field logging; explicit `passwordHash` redaction in any global logger.

### 🟡 V-10 — Email enumeration on login

**Issue**: Login endpoint returns different error for "user doesn't exist" vs "wrong password". An attacker can iterate emails to find which exist.
**Fix**: Always return `{message: "Invalid credentials"}` regardless. (Verified — backend already does this.)

### 🟡 V-11 — Email verification not enforced

**Issue**: Users can register with any email; we never confirm they own it. Means a spammer can create accounts with arbitrary emails (which then bear PII once they take actions).
**Fix**: Frontend P0 #3 (verification flow).

### 🟡 V-12 — `ownerHistory` exposed even for free tier on hot leads (need to verify)

**Need to check**: Does `payloadFree` include `ownerHistory`? If yes, that's Tier B PII leaking to the free tier.
**Action**: Audit `pinCardsSql()` in `apps/backend/src/data-pipeline/maintenance.processor.ts` — confirm `ownerHistory` is in payloadPro only.

### 🟢 V-13 — HTTPS not enforced inside VM

**Issue**: Backend listens on port 4000 over HTTP; frontend talks to it over HTTP locally. If we add a reverse-proxy and external clients, must enforce TLS.
**Fix**: At deploy time. Caddy/Nginx with Let's Encrypt + HSTS.

### 🟢 V-14 — Database backups not encrypted at rest

**Issue**: `<host-backups>/eavesight-pre-rename-20260425-042941.dump` is plain pg_dump.
**Fix**: GPG-encrypt at rest, document key rotation.

---

## Part 3 — Multi-tenant compartmentalization plan

### Tenant model
Org (the customer entity that pays)
├── Members (users)
│ └── Each member has a role within the org
├── Saved leads / lead lists (org-scoped)
├── Search history (user-scoped)
├── Skip-trace credits (org-scoped)
└── Audit log (org-scoped)

### Role matrix

| Role | View map | Save leads | Skip-trace | Bulk export | Manage team | Manage billing |
|---|---|---|---|---|---|---|
| **VIEWER** | ✓ (org's saved leads only) | — | — | — | — | — |
| **ANALYST** | ✓ all | ✓ | ✓ (limited credits) | — | — | — |
| **ADMIN** | ✓ | ✓ | ✓ (unlimited within org budget) | ✓ | ✓ | — |
| **OWNER** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **SUPERADMIN** (Eavesight staff) | All orgs | All orgs | — (audit only) | — | — | — |

### Enforcement layers (defense in depth)

1. **JWT** carries `userId` + `orgId` + `role`
2. **NestJS guards** check role on each endpoint (declarative `@Roles(...)`)
3. **NestJS interceptor** sets Postgres session var `app.org_id` from JWT
4. **Postgres RLS** enforces row-level filtering as last resort
5. **Audit log** records every successful access

> Why all 4 layers? Because any one of them might be bypassed by a bug. Defense in depth means a single vulnerability doesn't equal a breach.

### Tables that need RLS policies

```sql
-- Org-scoped:
saved_properties, lead_lists, lead_actions, skip_trace_logs,
notifications, org_score_preferences, audit_log

-- User-scoped:
search_history, sessions, refresh_tokens, user_lead_actions

-- System / global (no RLS):
properties, building_footprints, storm_events, property_storms,
building_permits, property_pin_cards, property_hex_aggregates,
tiger_bg_al, _acs_ext_bg, _fema_flood_v2

---

#### Data export rules
Bulk export (CSV) is org-scoped only — never crosses orgs
Eavesight superadmins can export only with org owner's consent + audit log entry
Customer Data Subject Access Request (CCPA / future state laws) — provide their own org's data within 30 days, no other org's
Part 4 — Compliance / regulatory posture
Currently relevant (US, AL ops)
Public records (AL): Owner name + mailing address from county assessor are public record. Republishing is legal but commercially sensitive — best to gate behind paid tiers anyway, both for differentiation and for "least surprise" with homeowners.
CAN-SPAM: Email outreach must include unsubscribe + sender ID. Applies if/when we send marketing email.
TCPA: Cold-calling residential phones requires a written-consent or established-business-relationship exemption. Skip-trace data flow needs careful handling — Eavesight isn't the caller, but we're providing the list. Document in TOS that customers are responsible for their own TCPA compliance.
FCRA: Skip-trace results CAN trigger FCRA if used for credit/employment/insurance decisions. Eavesight TOS must explicitly forbid such uses.
State data-broker laws: California, Vermont, Texas have data-broker registration. We're not yet operating commercially in those states, but if we ingest national data we may trigger registration in CA.
Coming soon (likely 2026-2027)
APRA (American Privacy Rights Act) if it passes — federal CCPA-equivalent
AL HB-29 privacy bill — keep an eye on session
Insurance Data Security Model Law (NAIC) — adopted in some states
Not (yet) relevant
HIPAA — not handling health data
GDPR — no EU users
PCI-DSS — Stripe handles card data; we never touch raw cards if we use Stripe Elements
Part 5 — PII access decision tree
When designing any new endpoint/feature, ask in order:

Does it return Tier A PII (phone/email)?
Yes → Pro+ tier only · audit log · cost ledger · rate limit
No → continue
Does it return Tier B PII (owner name/address)?
Yes → Pro+ tier only · audit log
No → continue
Does it return user-scoped data (saved leads, search history)?
Yes → org-scoped via RLS · ownership check by user_id
No → continue
Public lookup data only?
Free tier OK (with rate limit)
Part 6 — Immediate action items (next 7 days)
#	Item	Owner	Effort
1	Audit pinCardsSql() — confirm Tier B fields are payloadPro-only	Backend	30 min
2	Audit generate-pmtiles.js — confirm no PII in static tiles	Backend	1 hr
3	Drop test users from prod seed	DevOps	30 min
4	Add @nestjs/throttler + sane defaults	Backend	4 hr
5	Add audit_log table + interceptor	Backend	1 day
6	Implement tier check on pin endpoint	Backend + Frontend	1 day
7	Document PII handling in TOS draft	Legal/Founder	1 day
8	Run an automated dependency vuln scan (pnpm audit + Snyk)	DevOps	30 min
Part 7 — Open questions for legal review
Does republishing public-record assessor data require attribution? (Likely no for AL, but verify.)
Are we required to honor opt-out requests from individual homeowners? (Probably yes under CCPA-like state laws.)
What's the right TOS language on skip-trace use limitations? (Should explicitly forbid FCRA-triggering uses.)
Insurance carrier IP — if we partner with a carrier and they share claim data, how is it segregated?
Right of audit — do customer orgs get to audit OUR security posture?
Appendix — Related docs
04-roadmap-backend.md — engineering tasks that ship the fixes
05-roadmap-frontend.md — UI surfaces for tier/role enforcement
01-data-inventory.md — full field inventory (for context on what's where)
apps/backend/src/auth/ — current auth code
Future: docs/btw/07-incident-response-runbook.md (when we ship audit log + alerting)