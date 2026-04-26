# Eavesight — Executive Summary

**Date:** 2026-04-26
**Scope:** B2B storm-intelligence + lead-flow SaaS for roofers. Live launch metro: Huntsville / N-AL (Madison + Limestone + Morgan + partial Marshall + Jackson). Marketing site live with paid tiers ($99 Business / $249 Pro).

## Verdict

**Demo-ready in ~1 week of focused work. Revenue-ready in ~2.** The product has a genuinely impressive core (storm intelligence + map + alerts) sitting on top of four unresolved holes: anonymous PII access, no Stripe, no DNC compliance, and contradicting prices in the UI vs the marketing site. None are hard; all are blocking.

## What works (the asset)

- **Storm pipeline.** 2.1M storm events, 6.6M property-storm joins, NWS poller every 3 min, polygon→property `ST_Within` matching, SSE alert fan-out. This is the centerpiece and it actually works.
- **MetroMap.** MapLibre + PMTiles building footprints + H3 hex heatmap + viewport-streamed pins + score buckets + click-to-property + live alert overlay. Crown jewel of the demo.
- **Property dataset.** 242,987 properties across 5 counties, 100% geocoded, 97% with owner names, 54% with mailing addresses, current scoring (avg 41, range 7–84).
- **Auth.** JWT + refresh-rotate + Zustand persistence + redirect guard. Won't bounce on refresh.
- **Cron.** Storm sync, nightly score recompute, hex/pin-card rebuild, daily permit scrape, weekly ownership refresh — all wired and running.

## What's broken (the four P0s)

1. **Anonymous PII leak.** `MapController` and `MadisonParcelController` have no auth guard at all and serve `ownerPhone`/`ownerEmail`/`ownerMailAddress`. `PropertiesController` is JWT-guarded but has no orgId filter — any authed user from any org sees every property's PII.
2. **Zero Stripe.** No SDK, no checkout, no webhook, no portal. `Organization.stripeCustomerId` exists in schema but is never written. You cannot accept money today.
3. **DNC theatre.** `DncService` exists but is not registered in any module; `dnc_entries` table has 0 rows; every property defaults to `onDncList = false`. Marketing claims compliance — that creates real exposure under TCPA + state UDAP at $500–$1,500/call.
4. **Pricing contradiction in product.** Landing page says $99 / $249. Settings → Billing tab shows $0 / $49 / $149 with "Coming Soon" buttons. A roofer will see this in five seconds.

## What's misleading (the honesty gaps)

- **Analytics funnel is fabricated.** `dashboard/analytics/page.tsx` multiplies `totalLeads × 0.6 / 0.35 / 0.2` to invent Contacted/Qualified/Quoted counts. `avgJobValue` hardcoded to $12,500. "Cost Per Lead $0" hardcoded. Roofers know their own numbers.
- **YearBuilt is mostly a guess.** Only 1.7% (4,179 of 242,987) is verified — the rest is assessor-scrape, census ACS block-group, or KNN interpolation. Recent `DataConfidence` work is the right answer; verify it renders everywhere yearBuilt appears.
- **FEMA flood data is dead.** All 242,987 rows have flood data, but only 1 distinct flood zone and 1 distinct risk across the whole table — backfill is broken. Either fix it or hide the flood badge.
- **Owner phone/email = 0 across the board.** No skip-trace has been run. The "call/text the owner" demo story has no data behind it. `TracerfyService` is fully implemented but never wired to a controller.
- **80,635 placeholder addresses (33%)** — Marshall and Jackson are 97-98% placeholder; Limestone 50%. Geocoding script is running. Restrict the demo to Madison (24% placeholder) until backfill finishes.
- **Landing page hero** has a fake property card (`1423 Oakwood Dr · J. Williams`) and fake stats (47/203/12). `/demo`, `/about`, `/contact`, `/terms`, `/privacy`, `/forgot-password` all 404.

## Margin risk

At 10 active users × ~50 reveals/day, third-party API cost is **$80–150 per active org per month** (Google Geocoding, Solar, Places + Tracerfy + RentCast) — before any rate limiting. The $99 Business tier goes negative without a per-org meter. `@nestjs/throttler` is not installed; `RATE_LIMIT_*` env vars are unused.

## Ops fragility

Production runs as a single PM2 cluster on this VM. One ad-hoc Postgres dump from earlier today; **no cron, no off-host backup, no Sentry, no uptime probe, no CI**. VM disk failure = total loss. JWT secret falls back to `'default-secret-change-me'` if env unset.

## The two-week plan

**Week 1 — demo hardening.** Add JWT guards to Map + Madison + Huntsville + KCS controllers. Strip owner PII from default property SELECTs. Remove or relabel the Settings billing tab. Replace the fabricated funnel. Hard-fail on missing `JWT_SECRET`. Wire the inert property-page buttons. Stub `/terms` `/privacy` `/demo` `/forgot-password`. Fix the FEMA backfill or hide the badge. Finish geocoding (or restrict the demo to Madison). Verify `DataConfidence` chips render everywhere yearBuilt is shown. Add `@nestjs/throttler` + per-org meter on Google + Tracerfy.

**Week 2 — commerce.** Wire Stripe end-to-end (`/checkout` `/portal` `/webhook`, persist `stripeCustomerId`, gate paid endpoints when `inactive`). Reconcile the Plan enum (schema, marketing, settings UI all disagree — pick one). Build the reveal meter (`PropertyReveal` table, decrement quota in `findOne`, mask PII over quota). Make DNC real (register `DncService`, buy a list, mask `ownerPhone` when `onDncList=true`). Add nightly off-host `pg_dump` + Sentry + UptimeRobot.

**Series A diligence (sprint 3).** Audit log of reveals, member-invite flow, email verification, secret vault + key rotation, CI, per-org SSE filter.

## One-line bottom line

You're not far. The map and storm pipeline are real and impressive; the gaps are billing, compliance theatre, anonymous PII, and a few UI lies that a roofer would catch. Two focused weeks closes both the demo and the revenue gates.
