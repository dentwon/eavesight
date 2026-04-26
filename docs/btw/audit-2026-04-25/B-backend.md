
---

# Eavesight Backend Audit — 2026-04-25

## 1. TL;DR

- **Most surprising stub:** `TracerfyService` (skip-trace) is fully implemented (axios calls, quota, ledger, DNC scrub) but registered as a provider only — **no controller/service ever calls `skipTraceProperty`**, so the entire skip-trace flow is dead code (`apps/backend/src/properties/tracerfy.service.ts:34`). Same for `DncService` — never registered in any module, never injected (`apps/backend/src/data-pipeline/dnc.service.ts:24`).
- **Highest-impact fully-working feature:** Storm pipeline + AlertsService — real NWS poller every 3min, polygon-to-property `ST_Within` matching, PropertyAlert insert with idempotent unique key, EventEmitter→SSE fan-out (`storms/storms.processor.ts:36`, `alerts/alerts.service.ts:33`).
- **Most-broken-but-looks-real area:** `LeadGeneratorService.generateFromStorm` iterates **every Organization in DB** and creates a Lead per storm-affected property for **each org** (`leads/lead-generator.service.ts:89-140`). With 2 orgs and 5k storm-matched props that's 10k leads. The `@OnEvent('storm.synced')` (`:177`) is also never fired by anything — string `storm.synced` never emitted.
- **Biggest tenant-scoping risk:** `PropertiesController` and `MapController` enforce no orgId filter at all. Properties (incl. owner phone/email) are global; any authed user from any org sees every property's PII via `GET /properties/:id`, `/properties/in-bounds`, `/properties/lookup`, `/properties/nearest`, `/map/scores`, `/map/pmtiles/:id/property`. Map controller has **no JwtAuthGuard at all** — totally public (`map/map.controller.ts:7`, `map/map.module.ts`).

## 2. API matrix

All paths are prefixed with `/api` (set by `main.ts:16`).

| Module | Endpoint | Status | Backing data | Notes |
|---|---|---|---|---|
| auth | POST /auth/register | works | DB write | Creates org + OWNER membership |
| auth | POST /auth/login | works | DB read | Returns JWT + refresh + orgId |
| auth | POST /auth/refresh | works | sessions | |
| auth | POST /auth/logout | works | sessions | JWT-guarded |
| auth | GET /auth/me | works | users | |
| users | GET /users | works | users | **No auth role check — any user lists every user** |
| users | GET /users/:id | works | users | No tenant scope |
| users | PATCH /users/:id | works | users | self-or-admin gate |
| users | DELETE /users/:id | partial | users | **No role check at all** (`users.service.ts:75`) |
| orgs | GET /orgs | works | members | |
| orgs | POST /orgs | works | orgs | |
| orgs | GET /orgs/:id | works | orgs | membership check |
| orgs | PATCH /orgs/:id | works | orgs | OWNER/ADMIN gate |
| orgs | DELETE /orgs/:id | works | orgs | OWNER gate |
| orgs | POST /orgs/:id/members | works | members | |
| orgs | DELETE /orgs/:id/members/:userId | works | members | |
| properties | GET /properties | partial | properties | **No orgId filter** (`properties.service.ts:15`) |
| properties | GET /properties/in-bounds | works | properties | **No orgId filter** |
| properties | GET /properties/nearest | works | properties | **No orgId filter** — exposes owner PII via subsequent fetch |
| properties | GET /properties/:id | works | properties | **No orgId filter — full PII leak across tenants** |
| properties | POST /properties/lookup | works | properties + madisonParcelData | No orgId filter |
| properties | GET /properties/:id/roof-age | works | roofData + estimateRoofAge | |
| properties | POST /properties/:id/enrich | works | Census/FEMA | Mutates global property — any user can trigger |
| properties | GET /properties/:id/enrichment | works | propertyEnrichment | |
| properties | POST /properties/enrich-all | works | bulk | Any user can spam |
| storms | GET /storms | works | storm_events | Public-feeling but JWT-guarded |
| storms | GET /storms/active | works | storm_events | |
| storms | GET /storms/nearby | works | storm_events | |
| storms | GET /storms/zones | works | groupBy | |
| storms | POST /storms/sync/spc | works | DB writes | Any authed user can trigger sync |
| storms | POST /storms/sync/spc/history | works | DB writes | Same |
| storms | POST /storms/sync/noaa | works | DB writes | Same |
| storms | GET /storms/heatmap | works | $queryRawUnsafe | **@Public** — no auth required |
| storms | GET /storms/tracks | works | $queryRawUnsafe | **@Public** |
| storms | GET /storms/swaths | works | PostGIS | **@Public** |
| storms | GET /storms/:id | works | storm_events | |
| leads | GET /leads | works | leads | orgId scoped via `req.user.orgId` |
| leads | GET /leads/stats | works | counts | scoped |
| leads | GET /leads/canvassing | works | leads + properties | scoped — bbox + score filters |
| leads | POST /leads/score-all | works | scoring loop | scoped |
| leads | POST /leads/generate | broken | bulk write | Iterates **every org**, ignores `req.user.orgId` (`lead-generator.service.ts:89`). DoS-y if many orgs. |
| leads | POST /leads/generate/:stormId | broken | bulk write | Same |
| leads | GET /leads/:id | works | leads | orgId compared in service |
| leads | POST /leads | works | leads | orgId from JWT |
| leads | PATCH /leads/:id | works | leads | scoped |
| leads | PATCH /leads/:id/status | works | leads | scoped, sets `contactedAt`/`quotedAt`/`convertedAt`/`lostAt` |
| leads | PATCH /leads/:id/assign | works | leads | scoped |
| leads | DELETE /leads/:id | works | leads | scoped |
| leads | POST /leads/bulk | works | leads | scoped |
| analytics | GET /analytics/overview | partial | mixed | `properties.total` is **global** count, not org-scoped (`analytics.service.ts:16`) |
| analytics | GET /analytics/leads-by-month | works | leads | scoped |
| analytics | GET /analytics/storm-impact | works | leads | scoped |
| analytics | GET /analytics/team/leaderboard | works | users + leads + canvass_sessions | scoped — relies on `contractAmount`/`canvass_sessions` likely empty |
| analytics | GET /analytics/pipeline/velocity | works | leads | scoped |
| analytics | GET /analytics/leads/decay | works | leads | scoped |
| analytics | GET /analytics/territory/equity | partial | territories | Returns `{ territories: [], imbalanceFlag: false }` if no Territory rows |
| analytics | GET /analytics/forecast/revenue | partial | leads | Falls back to `avgTicket=12000` default if no WON leads |
| metros | GET /metros | works | metros | |
| metros | GET /metros/:code | works | metros + counts | |
| metros | GET /metros/:code/hexes | works | property_hex_aggregates | Pre-built nightly — empty if cron hasn't run |
| metros | GET /metros/:code/viewport | works | properties | Live query, fast path |
| metros | GET /metros/:code/top | works | property_pin_cards / properties | |
| metros | GET /metros/:code/properties/:propertyId/pin | partial | property_pin_cards | Pro tier gated by `role === 'ADMIN'`, **no Stripe** (`metros.controller.ts:191`); 404s if pin-card not built yet |
| map | GET /map/scores | works | building_footprints + leads | **NO AUTH GUARD** |
| map | GET /map/pmtiles/:pmtiles_id/property | works | building_footprints + properties | **NO AUTH GUARD** — leaks owner PII to anonymous |
| alerts | GET /alerts/active | works | property_alerts (raw SQL) | scoped via leads + territories |
| alerts | GET /alerts/stream (SSE) | partial | EventEmitter | Org filter is intentionally bypassed: comment says "we let every batch through" (`alerts.controller.ts:51-54`) — every connected user sees every org's alert stream |
| alerts | POST /alerts/properties/:id/earmark | works | property mutations | Sets earmarkedByUserId — **no orgId check** on property |
| alerts | DELETE /alerts/properties/:id/earmark | works | property mutations | **No orgId check, no userId check — any authed user can clear anyone's earmark** |
| alerts | GET /alerts/earmarks | works | properties | scoped to user |
| madison | GET /madison/search | works | madisonParcelData | **@Public** |
| madison | GET /madison/parcels | partial | searchByCity ignores bbox | **@Public** |
| madison | GET /madison/parcels/:pin | works | madisonParcelData | **@Public** |
| madison | POST /madison/leads | broken | leads | **@Public, accepts orgId in body** — anyone can write a lead into any org (`madison-parcel.controller.ts:46-53`) |
| madison | GET /madison/stats | works | counts | **@Public** |
| madison | GET /madison/map | works | madisonParcelData | **@Public** |
| harvester (HSV) | GET /harvester/stats, /count, /sample, POST /batch, /start, /reset | works | scrapers | **No auth at all** |
| harvester (KCS) | POST /harvester/start-owner-enrichment, /batch-owner, GET /harvester/owner-stats, /owner-sample, POST /harvester/reset-owner-stats | works | scrapers | **No auth at all** |
| health | GET /health, /health/db | works | prisma `SELECT 1` | |

## 3. Background jobs matrix

`ScheduleModule.forRoot()` is in `app.module.ts:25` so cron is wired. `EventEmitterModule.forRoot()` too. **No BullMQ, no @nestjs/bull, no queue infrastructure exists** — `ToolSearch select:` for queue/processor returned zero hits.

| Job | Trigger | What it updates | Status |
|---|---|---|---|
| `StormsProcessor.handleNwsAlertPoll` | `*/3 * * * *` | storm_events insert + property_alerts batch + SSE emit | works (gated by `ENABLE_STORM_SYNC=true`, set in `.env:16`) |
| `StormsProcessor.handleSpcSync` | `*/30 * * * *` | storm_events from SPC | works |
| `StormsProcessor.handleSpcGapFill` | `0 2 * * *` | 3-day SPC backfill | works |
| `StormsProcessor.handleNoaaSync` | daily 3am | storm_events from NOAA bulk | works |
| `StormsProcessor.handleWeeklyBackfill` | Sun 4am | 3-yr NOAA backfill | works |
| `StormsProcessor.handleAlertExpiry` | `*/15 * * * *` | property_alerts.active=false on expire | works (no env gate) |
| `MaintenanceProcessor.nightlyRecomputeScores` | daily 4am | properties.urgencyScore/revenuePotential/opportunityScore + unified score + dormantFlag + claimWindowEndsAt + scoreReasons + per-metro hex/pin-card rebuild | works (gated `ENABLE_MAINTENANCE_JOBS=true`, set in `.env:28`) |
| `MaintenanceProcessor.housekeeping` | daily 5am | rm MRMS cache | works |
| `MaintenanceProcessor.dailyPermitsScrape` | daily 6am | shells out to `node scripts/harvest-huntsville-permits.js` | works if script exists; "no-op if missing" |
| `MaintenanceProcessor.weeklyOwnershipRefresh` | Sun 2am | shells out to harvest-limestone-morgan/marshall-jackson | same |
| `MaintenanceProcessor.monthlyOsmRefresh` | 1st of month 4am | OSM Overpass | same |
| `MaintenanceProcessor.quarterlyFemaRefresh` | 1st of Jan/Apr/Jul/Oct 4am | FEMA flood | same |
| `MaintenanceProcessor.annualCensusRefresh` | 1st Jul 4am | Census ACS | same |
| `LeadGeneratorService.handleStormSynced` | `@OnEvent('storm.synced')` | leads | **dead** — no `emit('storm.synced', …)` exists in codebase |

No BullMQ queues defined, registered, or consumed.

## 4. Stub / TODO inventory

- `properties/tracerfy.service.ts:14` — full skip-trace impl, **never injected/called** anywhere
- `data-pipeline/dnc.service.ts:24` — full DNC service, **not registered in any module**, no controller calls `checkLeadCompliance`
- `properties/tracerfy.service.ts:234` — `checkDnc` exists but never called
- `metros/metros.controller.ts:184-193` — pro-tier gate is `role === 'ADMIN' || 'SUPER_ADMIN'` placeholder until Stripe wire-up; comment says so
- `alerts/alerts.controller.ts:50-54` — SSE stream comment "we let every batch through" — server-side org filter is TODO ("once we have millions of connections")
- `leads/roof-age.util.ts:22` — TODO collapse duplicated estimateRoofAge utility
- `data-pipeline/building-footprints.service.ts:18` — comment about "new property stubs"
- `data-pipeline/property-enrichment.service.ts:200-214` — `estimateJobValue` defined but **never called** — `enrichmentData.estimatedJobValue` is undefined when written (`:140`)
- `properties/rentcast.service.ts:11-13` — in-memory monthly rate-limit counter (`monthlyCallCount` on a singleton) resets on restart; not per-org
- `analytics/analytics.service.ts:420` — historicalWinRate fallback `0.25` if no WON leads
- `analytics/analytics.service.ts:440` — avgTicket fallback `12000` if no WON leads with contractAmount
- `data-pipeline/maintenance.processor.ts:26` — hardcoded path `<repo-root>/scripts` for cron shells; will silently break in any non-this-machine deploy
- `data-pipeline/maintenance.processor.ts:41` — script failures are caught and logged only, never surfaced
- `data-pipeline/maintenance.processor.ts.bak.phase3`, `.v3`, `metros/*.bak`, `leads/roof-age.util.ts.bak.phase2` — stray backup files in source tree
- `users/users.service.ts:8-19` — `findAll` returns ALL users globally (no orgId filter, no role check)
- `users/users.service.ts:75-82` — delete endpoint has no role check at all
- `data-pipeline/madison-parcel.controller.ts:46` — POST /madison/leads accepts `orgId` from body and is `@Public()`
- `data-pipeline/madison-parcel.controller.ts:24-37` — `getParcelsInBounds` ignores all bbox params and just calls `searchByCity('HUNTSVILLE', limit)`
- `apps/backend/src/data-pipeline/madison-parcel.service.ts:158` — lead creation may write `orgId: undefined` if the public POST omits it (Lead.orgId is required in schema — would throw, but `if (dto.orgId) leadData.orgId = dto.orgId;` means if absent the create explodes at runtime)
- No `*.spec.ts` test files exist anywhere in `apps/backend/src` or `tests/`. Zero backend tests.

## 5. Tenant-scoping audit (highest-priority risks)

| Endpoint | Risk |
|---|---|
| `GET /api/map/scores`, `GET /api/map/pmtiles/:id/property` (`map/map.controller.ts`) | **No JwtAuthGuard at all.** Returns owner PII (`ownerFullName`, `ownerPhone`, `ownerEmail` via `findUnique`+`leads`+`roofData`) to anonymous internet. |
| `GET /api/properties/:id`, `/in-bounds`, `/lookup`, `/nearest` (`properties/properties.controller.ts`) | JWT required but no orgId filter — any authed user from any org sees every org's leads attached to a property and the global property's owner PII. |
| `POST /api/madison/leads` (`madison-parcel.controller.ts:46`) | `@Public()` + accepts `orgId` in request body → write a lead into any org without auth. |
| `POST /api/leads/generate`, `/generate/:stormId` | Iterates **all** organizations and creates leads in each. Any authed user can fan out leads into competitor orgs. |
| `DELETE /api/alerts/properties/:id/earmark` (`alerts/alerts.controller.ts:74`) | No orgId, no userId, no ownership check — any authed user clears any property's earmark. |
| `POST /api/alerts/properties/:id/earmark` | No org check on property; one org can earmark a property "owned" by another rep. |
| `GET /api/alerts/stream` SSE | All connected users see all orgs' alert batches (intentional comment, but PII includes addresses). |
| `POST /api/storms/sync/*`, `POST /api/properties/:id/enrich`, `/enrich-all` | Any authed user can trigger expensive global writes / external API calls. |
| `GET /api/users`, `DELETE /api/users/:id` | No role check; any user can list/delete users. |
| `/api/harvester/*` (Huntsville + KCS controllers) | No `@UseGuards(JwtAuthGuard)`, no `@Public()` — but JwtAuthGuard is only applied where declared, so these are **fully open** to start expensive scrapers. |
| `GET /api/storms/heatmap`, `/tracks`, `/swaths` | `@Public()` — fine for demo, but expose the full historical hail dataset. |

## 6. Demo readiness — 7 things a roofer touches

1. **Login** — works. `POST /api/auth/login` returns JWT + orgId; JWT strategy reads first OrganizationMember (`auth.service.ts:107`, `jwt.strategy.ts:45`).
2. **Search property by address** — works. Frontend calls `GET /api/properties` then `POST /api/properties/lookup`. Backed by real `properties` and falls back to `madisonParcelData` (`properties.service.ts:131`).
3. **View pin card** — partial. `GET /api/metros/:code/properties/:propertyId/pin` reads `propertyPinCard` table. **Empty until `MaintenanceProcessor.nightlyRecomputeScores` has run with `ENABLE_MAINTENANCE_JOBS=true`** — if cron hasn't fired yet, pin clicks → 404. Pro tier silently downgrades to free for non-ADMIN roles.
4. **View map with storms** — works. `/api/storms/heatmap`, `/tracks`, `/swaths` are public, PostGIS-real, 60s TTL cached. `/api/map/scores` works (no auth, but returns sensible numbers from leads or canonical roof-age fallback). However — `roof_age` layer returns no scores when `roofInstalledAt` is null on most rows (Phase 3.7a anchor-only).
5. **Create a lead from the map** — works. Frontend `POST /leads` → `LeadsService.create` writes one row with orgId from JWT. QuickCaptureSheet pin-to-lead flow works.
6. **See hot leads list** — works. `GET /api/leads?status=NEW` orgId-scoped, ordered by createdAt. `GET /api/leads/canvassing` ranks by score×proximity.
7. **View a route / canvassing list** — partial. `/api/leads/canvassing` returns real lead+property+roof data. **However:** if `lat`/`lon`/`stormId` aren't provided, returns empty `{ list: [] }` immediately (`canvassing.service.ts:50`). Also no canvass session is ever **persisted** — `CanvassSession` Prisma model exists (`schema.prisma:562`) but **nothing in the backend writes a row to it**, despite `analytics.service.ts:122` SELECTing from it for the leaderboard. So leaderboard `doorsKnocked` is always 0.

**What will visibly break:**
- Pin-card 404 if nightly cron hasn't built `property_pin_cards` for the metro.
- `POST /leads/generate` from any "Generate from storms" UI button will spam leads into every org in the DB.
- Roof-age map layer looks empty for most properties (3.7a switched to anchor-only).
- Canvassing list returns empty when launched without storm/coords.
- SSE alert stream surfaces alerts from other tenants (likely none in demo, but visible).
- If user clicks owner phone, **no DNC check ever fires** before display — `onDncList` is read but the live `DncService.checkLeadCompliance` is unwired.

## 7. Punch list (top 10, demo impact × ease)

1. Add `@UseGuards(JwtAuthGuard)` to `MapController` (`map/map.controller.ts:7`). One line, kills anonymous PII leak.
2. In `LeadGeneratorService.generateFromStorm` (`leads/lead-generator.service.ts:89-140`) — accept and require an `orgId` parameter; remove the `for (org of orgs)` loop. Stop fanning out into every tenant.
3. Filter `properties.findOne` / `lookup` / `:id` reads through current org's leads or strip `leads` and owner PII from the response shape (`properties.service.ts:60`). Or at minimum, only include `lead` rows where `orgId == req.user.orgId`.
4. Remove `@Public()` from `POST /madison/leads` and stop reading orgId from body. Force `@UseGuards(JwtAuthGuard)` and use `req.user.orgId` (`madison-parcel.controller.ts:46`).
5. Persist `CanvassSession` rows when the canvassing endpoint is called (or add `POST/PATCH /canvassing/sessions`) — leaderboard's `doorsKnocked` query is silently zero.
6. Verify `MaintenanceProcessor.nightlyRecomputeScores` has run at least once before demo so `property_pin_cards` is populated (or add a manual `/admin/recompute-scores` endpoint and call once).
7. Lock down `POST /storms/sync/*`, `POST /properties/enrich-all`, `/api/harvester/*` to ADMIN role only.
8. Wire `DncService` into `DataPipelineModule` providers and call `checkLeadCompliance(leadId)` in `PropertiesController.findOne` and the canvassing item builder so phone gets masked when `onDncList` true (today the canvassing card returns `phone` regardless of `onDncList`).
9. Fix SSE: in `AlertsController.stream` (`alerts/alerts.controller.ts:48`) filter the `property.alert.batch` payloads by whether any property's `id` is in the user's org leads/territory before emitting. The cross-tenant leak is small but real.
10. Add an ownership/orgId check to `POST/DELETE /alerts/properties/:id/earmark` so reps can't unearmark each other's properties (and so cross-org earmark mutations are blocked).

**Bonus that's not in the top 10 but cheap:** delete the `*.bak`, `*.v3`, `*.bak.phase3` files from `src/` — Nest will compile them too via tsconfig if the includes are loose, and they're confusing.

**Stripe / billing:** zero code. `Organization.stripeCustomerId` column exists (`schema.prisma:64`) and `Plan` enum (STARTER/PRO/ENTERPRISE) exists (`:80`), but nothing reads or writes either. No Stripe SDK. No webhooks. No metering decrement (no reveal counters). No roof-measurement credit ledger. The `ApiQuota` / `ApiUsage` tables are only written by the unwired `TracerfyService`.

**Email/SMS:** zero. No Resend, Twilio, SendGrid, nodemailer, or postmark imports anywhere.

**Property reveal metering:** none. `findOne(id)` returns the full property + leads with no decrement, no quota check, no ledger write.
