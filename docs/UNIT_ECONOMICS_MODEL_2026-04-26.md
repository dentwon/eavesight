# Eavesight unit economics & financial outlook

**Date:** 2026-04-26 (revised to reflect Tracerfy Normal-tier pricing + Path B-Lite metro plan + 5-year three-scenario forecast)
**Scope:** Integrated cost stack + gross/net MRR/ARR forecast through Year 5 across three scenarios (Floor / Base / Stretch). Reflects post-redesign tier pricing (Scout free + 25-cap overage, Business $99, Pro $249, Enterprise from $499 with $0.25 overage), Path B-Lite metro sequencing (Huntsville → +Nashville+Atlanta → +Memphis+Birmingham → +DFW+Charlotte → +Austin+Knoxville), and includes per-org infrastructure cost (cloud, satellite, roof paint AI, roof-age data refresh, support).

**Companion doc:** `STRATEGIC_PLAN_2026-04-26.md` (path comparison + per-metro sequencing rationale + Y10 ceiling).

---

## 1. Cost stack (the full picture)

### A. Variable cost per reveal (`ApiUsage.service='reveal'`)

**Critical update from prior version:** Tracerfy publishes two trace tiers — **Normal Trace at $0.02/record** (when caller provides the owner's name) and Advanced Trace at $0.04/record (address-only). Eavesight already has owner names for 235k of 242k properties (97%) from county assessor scrapes, so we should be using Normal Trace, not Advanced. The codebase currently hardcodes `'advanced'` (`apps/backend/src/properties/tracerfy.service.ts:73`) — switching to conditional Normal-when-name-known cuts the dominant per-reveal cost in half with zero negotiation required.

| Line | Y1 | Y2-3 (cache + minor renegotiation) | Y4-5 (cache mature + 100k/mo volume tier) | Source |
|---|---|---|---|---|
| Tracerfy Normal Trace | $0.020 | $0.018 | $0.015 | tracerfy.com/pricing — published Normal tier |
| Tracerfy DNC scrub | $0.020 | $0.015 | $0.012 | tracerfy.service.ts:246 |
| Geocoding (amortized at ingest) | $0.005 | $0.005 | $0.005 | Google Geocoding $5/1k after free tier |
| **Total per reveal (worst case, no cache hit)** | **$0.045** | **$0.038** | **$0.032** | — |
| **With 50% cache-hit assumption (Y3+)** | n/a | **~$0.020** | **~$0.016** | Cached via `Property.ownerPhone` once first reveal succeeds |

**Renegotiation context:** Tracerfy publishes volume discounts as "contact sales" with a formal Enterprise tier triggered at 1M+ records/mo. Eavesight won't hit that threshold until full Y10 saturation across all metros. Realistic Y3 ask once we're consistently at 50-100k records/mo: ~$0.015/record Normal Trace (25% off published) for retention. Modeled as the Y4-5 line above.

### B. Variable cost per roof measurement

| Line | Cost | Notes |
|---|---|---|
| Google Solar Building Insights (basic) | $0.05 → $0.035 with volume | Used for default roof-age verification |
| HD aerial (Nearmap / EagleView, optional add-on) | $5–25 | Gated as separate paid credit, not in default per-org math |

### C. Stripe processing (post cloud migration)

- 2.9% + $0.30 per successful charge

### D. Fixed per-org infrastructure (scales DOWN per-org as we scale UP in subscribers)

| Line | At 100 subs | At 500 subs | At 1,000 subs | At 2,500 subs |
|---|---|---|---|---|
| Cloud DB (managed Postgres, ~1.25M property rows × 5 metros, growing to 9) | $4.00 | $3.00 | $2.00 | $1.50 |
| Compute (NestJS + Next.js autoscale) | $6.00 | $4.00 | $3.00 | $2.00 |
| CDN egress (PMTiles, building footprints, static) | $2.00 | $1.50 | $1.00 | $0.80 |
| Redis cache | $1.00 | $0.50 | $0.30 | $0.20 |
| Sentry + UptimeRobot + observability | $2.00 | $1.00 | $0.50 | $0.30 |
| Off-host backups (S3/B2) | $1.00 | $0.80 | $0.60 | $0.50 |
| **Satellite imagery refresh (Nearmap/Planet, cached per property)** | $5.00 | $4.00 | $3.00 | $2.50 |
| **Roof paint condition AI (GPU inference on cached imagery)** | $1.00 | $0.80 | $0.50 | $0.40 |
| **Roof-age data continuous refresh (county scrapes, ACS, permit polls)** | $2.00 | $1.50 | $1.00 | $0.80 |
| Email/SMS (Postmark + Twilio for storm alerts) | $1.50 | $1.00 | $0.80 | $0.60 |
| Support headcount (1 CSM per ~150 subs at $80k loaded) | $5.00 | $5.00 | $4.50 | $4.00 |
| **Total per-org overhead** | **~$30/mo** | **~$23/mo** | **~$17/mo** | **~$14/mo** |

---

## 2. Per-tier net contribution at the 1,000-subscriber stage

Y2 cost basis: $0.038/reveal (no cache) → $0.020/reveal (50% cache hits), $17/org overhead, Stripe 2.9% + $0.30.

| Tier | Usage scenario | Gross Rev | Reveal Var (50% cache) | Per-Org Fixed | Stripe | **Net $** | **Net GM%** |
|---|---|---|---|---|---|---|---|
| Scout | quota (5) | $0 | $0.10 | $17 | — | -$17.10 | acquisition cost |
| Scout | overage to cap (25) | $30 | $0.50 | $17 | $1.17 | $11.33 | 38% |
| Business | quota (50) | $99 | $1.00 | $17 | $3.17 | $77.83 | **79%** |
| Business | fair-use (500) | $549 | $10.00 | $17 | $16.22 | $505.78 | **92%** |
| Pro | quota (200) | $249 | $4.00 | $17 | $7.52 | $220.48 | **89%** |
| Pro | fair-use (1,500) | $899 | $30.00 | $17 | $26.37 | $825.63 | **92%** |
| Enterprise | quota (2,500) | $499 | $50.00 | $17 | $14.77 | $417.23 | **84%** |
| Enterprise | 5,000 reveals | $1,124 | $100.00 | $17 | $32.90 | $974.10 | **87%** |
| Enterprise | fair-use (15,000) | $3,624 | $300.00 | $17 | $105.40 | $3,201.60 | **88%** |

### Margin landscape

- **Scout overage at $1.50** generates 38% GM after overhead — thin margin, primarily a conversion lever to Business.
- **Business at quota = 79% GM**, climbs to 92% with overage. Workhorse tier.
- **Pro is the highest-margin paid tier** — 89-92% GM. Marketing should push Pro hard.
- **Enterprise GM = 84-88%** (improved from 71-78% in prior model thanks to Tracerfy Normal Trace switch). Plus 5× absolute dollar contribution per sub.

---

## 3. Subscriber forecast (Path B-Lite, three scenarios)

Per-metro penetration constraint: ~46-1,050 SAM per metro depending on size. New metros take 2-4 years to hit 30-50% of SAM.

| Year | Active metros (cumulative) | Floor | Base | Stretch |
|---|---|---|---|---|
| Y1 | Huntsville | 16 | 35 | 60 |
| Y2 | + Nashville + **Atlanta** | 35 | 80 | 130 |
| Y3 | + Memphis + Birmingham | 75 | 165 | 280 |
| Y4 | + **DFW** + Charlotte | 130 | 320 | 520 |
| Y5 | + **Austin** + Knoxville | 200 | 525 | 950 |

**What separates the scenarios:**

- **Floor** = organic word-of-mouth only, no paid promotion, founder-led sales
- **Base** = first-100-free promo + Facebook ads + referral incentive + 1-2 trade shows + supply-house partnership in each new metro
- **Stretch** = all of base + 1 PR hit per metro + paid SDR for Enterprise outreach + Chamber/AGC sponsorships + brand equity by Y3

---

## 4. Gross MRR / Gross ARR by scenario

| Year | Floor MRR | Floor ARR | Base MRR | Base ARR | Stretch MRR | Stretch ARR |
|---|---|---|---|---|---|---|
| Y1 | $2,782 | **$33k** | $6,249 | **$75k** | $10,650 | **$128k** |
| Y2 | $6,249 | **$75k** | $15,396 | **$185k** | $25,120 | **$301k** |
| Y3 | $14,565 | **$175k** | $31,670 | **$380k** | $55,008 | **$660k** |
| Y4 | $27,300 | **$328k** | $68,080 | **$817k** | $112,944 | **$1.36M** |
| Y5 | $42,550 | **$511k** | $113,495 | **$1.36M** | $207,575 | **$2.49M** |

## 5. Net MRR / Net ARR (after per-reveal var + per-org overhead + Stripe)

| Year | Floor Net MRR | Floor Net ARR | Base Net MRR | Base Net ARR | Stretch Net MRR | Stretch Net ARR |
|---|---|---|---|---|---|---|
| Y1 | $2,205 | **$26.5k** | $4,978 | **$60k** | $8,465 | **$102k** |
| Y2 | $5,050 | **$61k** | $12,855 | **$154k** | $21,231 | **$255k** |
| Y3 | $12,411 | **$149k** | $27,246 | **$327k** | $47,735 | **$573k** |
| Y4 | $24,028 | **$288k** | $60,256 | **$723k** | $100,640 | **$1.21M** |
| Y5 | $37,924 | **$455k** | $101,735 | **$1.22M** | $187,121 | **$2.25M** |

## 6. Net contribution margin trajectory

| Year | Floor GM% | Base GM% | Stretch GM% |
|---|---|---|---|
| Y1 | 79% | 80% | 79% |
| Y2 | 81% | 83% | 85% |
| Y3 | 85% | 86% | 87% |
| Y4 | 88% | 88% | 89% |
| Y5 | 89% | 90% | 90% |

GM expansion is the SaaS scale story: per-org overhead amortizes, var cost drops as we cache + renegotiate, ARPU climbs from mix shift toward Pro/Enterprise.

---

## 7. Headcount opex (NOT in COGS — layered on top)

The above is gross/net contribution from the subscription business. People + non-pass-through opex on top:

| Year | Headcount stage | Loaded annual opex |
|---|---|---|
| Y1 | Solo founder (deferred comp) | ~$0 |
| Y2 | + 1 PT CSM (~30 hrs/wk) + part-time contractor | ~$60k |
| Y3 | + 1 engineer + 1 SDR + Atlanta market manager | ~$320k |
| Y4 | + 2 engineers + 1 sales + DFW launch lead | ~$680k |
| Y5 | Full team (~12 ppl across product, sales, ops) | ~$1.1M |

Plus paid acquisition roughly **$200 CAC × new subs/year**:

| Year | Base CAC budget | Stretch CAC budget |
|---|---|---|
| Y1 | $7k | $12k |
| Y2 | $9k | $14k |
| Y3 | $17k | $30k |
| Y4 | $31k | $48k |
| Y5 | $41k | $86k |

---

## 8. EBITDA picture (Base scenario, Path B-Lite)

| Year | Net ARR | Headcount opex | CAC | **EBITDA** |
|---|---|---|---|---|
| Y1 | $60k | $0 | $7k | **+$53k** (cash positive on paper, before founder comp) |
| Y2 | $154k | $60k | $9k | **+$85k** |
| Y3 | $327k | $320k | $17k | **-$10k** (investment year — Atlanta scaling + first hires) |
| Y4 | $723k | $680k | $31k | **+$12k** |
| Y5 | $1.22M | $1.1M | $41k | **+$79k** |

Y3 is the deliberate investment year. EBITDA dips just below zero as you hire the team to handle Atlanta + DFW prep. Y4 and Y5 expand again as the team's productivity catches the headcount cost.

## 9. EBITDA picture (Stretch scenario, Path B-Lite)

| Year | Net ARR | Headcount + CAC | **EBITDA** |
|---|---|---|---|
| Y1 | $102k | $12k | **+$90k** |
| Y2 | $255k | $74k | **+$181k** |
| Y3 | $573k | $350k | **+$223k** |
| Y4 | $1.21M | $728k | **+$482k** |
| Y5 | $2.25M | $1.19M | **+$1.06M** |

Stretch case at Y5 = **$2.25M Net ARR, $1.06M EBITDA** = a real, fundable, sellable business. The kind of outcome that attracts strategic acquirer interest at $20-40M valuation.

---

## 10. Summary headlines

| Year | Exit subs | Gross ARR (Base/Stretch) | **Net ARR (Base/Stretch)** |
|---|---|---|---|
| Y1 | 16 / 35 / 60 | $33k / $75k / $128k | $26k / $60k / $102k |
| Y2 | 35 / 80 / 130 | $75k / $185k / $301k | $61k / $154k / $255k |
| Y3 | 75 / 165 / 280 | $175k / $380k / $660k | $149k / $327k / $573k |
| Y4 | 130 / 320 / 520 | $328k / $817k / $1.36M | $288k / $723k / $1.21M |
| Y5 | 200 / 525 / 950 | $511k / $1.36M / $2.49M | $455k / $1.22M / $2.25M |

(Booked revenue in Y1 is lower than the run-rate above — ~$170-300k over the year, not $33-128k — because of "first 100 users 3 months free" promo + back-loaded ramp. The exit-Y1 run-rate is what feeds Y2.)

---

## 11. What changed vs the prior version of this doc

| Lever | Prior model | Updated model | Why |
|---|---|---|---|
| Tracerfy per-reveal cost | $0.04 (Advanced Trace) | $0.02 (Normal Trace) | We have owner names for 97% of properties — should be using Normal tier; one-line code fix |
| Y1 cost-per-reveal worst case | $0.065 | $0.045 | Tracerfy switch + minor geocoding amortization revision |
| Subscriber forecast structure | Single-track (one number per year) | Three scenarios (Floor / Base / Stretch) | Conservative single number undersold the range; promotion lever isn't binary |
| Forecast horizon | Y4 | **Y5** | Strategic decisions (Atlanta, DFW launch) play through Y5 |
| Metro plan | 4 metros (Hsv → Nash → Birm/Memph → 5th metro TBD) | **9 metros (Path B-Lite)** | Atlanta in Y2, DFW in Y4 unlocks $10M+ Y10 ceiling |
| Y5 stretch Net ARR | n/a (Y4 was $301k) | **$2.25M** | New cost basis + aggressive metro plan + stretch scenario |
| Net GM at Y5 | 87% | 89-90% | Tracerfy savings compound at scale |

---

## 12. Strategic implications

1. **Y1 is sub-scale by design.** 16-60 subs / $26-102k Net ARR is the realistic Huntsville range. Don't anchor to "$500k Y1 ARR" from the original BUSINESS_PLAN — that target requires multi-metro live in Y1 which isn't operationally feasible.

2. **Multi-metro execution is the lever, not pricing.** $1M+ Net ARR requires Atlanta (Y2 launch) + Birmingham/Memphis (Y3) + DFW (Y4) all live and growing. The data-loading work happening now (Limestone/Marshall/Jackson backfills + Nashville ingest) is the critical path for Y2.

3. **Net GM hits 89-90% at the 1,000-sub stage.** Per-org overhead drops from $30 → $14 as we scale; per-reveal cost drops from $0.045 → $0.020 with cache + Tracerfy renegotiation. SaaS leverage curve in full effect.

4. **Cash flow break-even lands at ~30-40 paying subs** (covers ~$1k/mo of fixed cost beyond per-org overhead). That's mid-Y2 in the base case, end-of-Y1 in the stretch case.

5. **Pro is the leverage tier.** Every additional Pro sub adds ~$220/mo Net at 89% GM. A shift in mix from 60/35/5 toward 50/40/10 raises blended ARPU by ~$25 and accelerates Net ARR ~15% with no extra sales effort.

6. **Free Scout users have a real cost.** ~$17-30/mo overhead per active free user. Need ≥10% Scout-to-Business conversion to justify the funnel; below that, Scout is a money pit. Keep Scout intentionally limited (no PII reveal, view-only pipeline, 25-reveal hard cap) so there's a real upgrade reason.

7. **Atlanta in Y2 is the key strategic bet.** Atlanta SAM is 1,050 — five times Huntsville. Y2 traction in Atlanta means 10-30 subs by exit; by Y5 stretch, Atlanta alone contributes ~250-400 subs (~30-40% of total Y5 stretch).

8. **DFW in Y4 is the scale lever.** SAM 1,560 (largest single metro on the plan). Y4 launch with team + capital in place; by Y5 contributes ~150-300 subs and grows to dominant share by Y8-Y10.

---

## 13. What's still missing from this model

- **CAC and payback period.** Modeled at $200 blended; real number won't be known until ~50 paid customers in Y2.
- **Churn.** Assumed 4%/mo throughout (BUSINESS_PLAN baseline). 4% × $200 ARPU on 100-sub base = $800/mo MRR loss = need ~4 new subs/mo to stay flat. Real number known by Q4 of Y1.
- **Annual prepay discount.** 2 months free for annual prepay would shift ~30% of MRR to upfront cash and improve effective churn — not yet modeled.
- **Stripe wiring.** Revenue isn't collectable until Stripe is live (cloud migration deliverable).
- **Per-metro CAC variance.** Modeled at $200 blended, but DFW + Atlanta CAC could be 2-3× Huntsville/Nashville due to competition. Stretch case CAC budgets should grow accordingly.
- **Roof paint AI build cost** — included in per-org overhead at $1/sub/mo (inference) but doesn't include the one-time training/labeling investment (~$15-30k initial).
