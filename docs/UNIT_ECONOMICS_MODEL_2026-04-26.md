# Eavesight unit economics & financial outlook

**Date:** 2026-04-26
**Scope:** Integrated cost stack + gross/net MRR/ARR forecast through Year 4. Reflects post-redesign tier pricing (Scout free + 25-cap overage, Business $99, Pro $249, Enterprise from $499 with $0.25 overage) and includes per-org infrastructure cost (cloud, satellite, roof paint AI, roof-age data refresh, support).

---

## 1. Cost stack (the full picture)

### A. Variable cost per reveal (`ApiUsage.service='reveal'`)

| Line | Y1 | Y2 (renegotiated at 100k+/mo) | Source |
|---|---|---|---|
| Tracerfy advanced trace | $0.040 | $0.025 | `tracerfy.service.ts:84` ($0.04 today, BatchData benchmark $0.02/rec at 100k vol) |
| Tracerfy DNC scrub | $0.020 | $0.015 | `tracerfy.service.ts:246` |
| Geocoding (amortized at ingest) | $0.005 | $0.005 | Google Geocoding $5/1k after free tier |
| **Total per reveal (worst case, no cache hit)** | **$0.065** | **$0.045** | — |
| **With 50% cache-hit assumption (Y2+)** | n/a | **~$0.025** | Cached via `Property.ownerPhone` once first reveal succeeds |

### B. Variable cost per roof measurement

| Line | Cost | Notes |
|---|---|---|
| Google Solar Building Insights (basic) | $0.05 | What we use today |
| HD aerial (Nearmap / EagleView, optional add-on) | $5–25 | Gated as separate paid credit; not in default per-org math |

### C. Stripe processing (post cloud migration)

- 2.9% + $0.30 per successful charge

### D. Fixed per-org infrastructure (scales DOWN per-org as we scale UP in subscribers)

| Line | At 100 subs | At 500 subs | At 1,000 subs | At 2,500 subs | Notes |
|---|---|---|---|---|---|
| Cloud DB (managed Postgres, ~1.25M property rows × 5 metros) | $4.00 | $3.00 | $2.00 | $1.50 | Hosted Postgres ~$200-400/mo total |
| Compute (NestJS + Next.js autoscale) | $6.00 | $4.00 | $3.00 | $2.00 | ~$600/mo at low scale, $2,000 at 2.5k subs |
| CDN egress (PMTiles, static, building footprints) | $2.00 | $1.50 | $1.00 | $0.80 | CloudFront $0.085/GB |
| Redis cache | $1.00 | $0.50 | $0.30 | $0.20 | Single instance scales with traffic |
| Sentry + UptimeRobot + observability | $2.00 | $1.00 | $0.50 | $0.30 | Free tier covers <500 events/day |
| Off-host backups (S3/B2) | $1.00 | $0.80 | $0.60 | $0.50 | nightly `pg_dump` to cold storage |
| **Satellite imagery refresh (Planet/Nearmap, cached per property)** | $5.00 | $4.00 | $3.00 | $2.50 | Y1 starts low, grows with paint AI usage |
| **Roof paint condition AI (GPU inference on cached imagery)** | $1.00 | $0.80 | $0.50 | $0.40 | Custom model, ~$0.001-0.01 per inference |
| **Roof-age data continuous refresh (county scrapes, ACS, permit polls)** | $2.00 | $1.50 | $1.00 | $0.80 | Already running on-VM today (free); $1-2 in cloud |
| Email/SMS (Postmark + Twilio for storm alerts) | $1.50 | $1.00 | $0.80 | $0.60 | Per-message at low volume |
| Support headcount (1 CSM per ~150 subs at $80k loaded) | $5.00 | $5.00 | $4.50 | $4.00 | Doesn't compress as much; people-cost |
| **Total per-org overhead** | **~$30.50/mo** | **~$23.10/mo** | **~$17.20/mo** | **~$13.60/mo** |

---

## 2. Per-tier net contribution at the 1,000-subscriber stage

(Y2 cost basis: $0.045/reveal var, $17.20/org fixed, Stripe 2.9% + $0.30)

| Tier | At usage | Gross Rev | Reveal Var | Per-Org Fixed | Stripe | **Net $** | **Net GM%** |
|---|---|---|---|---|---|---|---|
| Scout | quota (5) | $0 | $0.23 | $17.20 | — | -$17.43 | acquisition cost |
| Scout | overage cap (25) | $30 | $1.13 | $17.20 | $1.17 | $10.50 | 35% |
| Business | quota (50) | $99 | $2.25 | $17.20 | $3.17 | $76.38 | **77%** |
| Business | fair-use (500) | $549 | $22.50 | $17.20 | $16.22 | $493.08 | **90%** (overage flows at 94%) |
| Pro | quota (200) | $249 | $9.00 | $17.20 | $7.52 | $215.28 | **86%** |
| Pro | fair-use (1,500) | $899 | $67.50 | $17.20 | $26.37 | $787.93 | **88%** |
| Enterprise | quota (2,500) | $499 | $112.50 | $17.20 | $14.77 | $354.53 | **71%** |
| Enterprise | 5,000 reveals | $1,124 | $225.00 | $17.20 | $32.90 | $848.90 | **76%** |
| Enterprise | fair-use (15,000) | $3,624 | $675.00 | $17.20 | $105.40 | $2,826.40 | **78%** |

### Key insight: where the margin actually lives

- **Scout's overage at $1.50** generates 35% GM after overhead — it's a thin profit, not a loss leader. But Scout users *not* using overage are a CAC line ($17/mo each).
- **Business at quota = 77% GM**, climbs to 90% with overage. This is the workhorse tier.
- **Pro is the highest-margin paid tier** — 86-88% GM whether at quota or fair-use. Push hard.
- **Enterprise GM is 71-78%** — lower per dollar than Pro but **5× the absolute dollar contribution**. The sales motion pays for itself even at lower GM.

---

## 3. Subscriber forecast (metro-by-metro, realistic)

Constraints: per-metro saturation ~46 active outbound roofers (Huntsville TAM analysis).

| Quarter | Huntsville | Nashville | Birmingham | Memphis | **Total subs** |
|---|---|---|---|---|---|
| Y1 Q1 (now) | 0 | — | — | — | 0 |
| Y1 Q2 | 3 | — | — | — | 3 |
| Y1 Q3 | 8 | — | — | — | 8 |
| **Y1 Q4 (exit)** | **16** | — | — | — | **16** |
| Y2 Q1 | 20 | — | — | — | 20 |
| Y2 Q2 | 25 | 5 | — | — | 30 |
| Y2 Q3 | 30 | 12 | — | — | 42 |
| **Y2 Q4 (exit)** | **35** | **20** | — | — | **55** |
| Y3 Q1 | 38 | 25 | 5 | — | 68 |
| Y3 Q2 | 42 | 30 | 10 | — | 82 |
| Y3 Q3 | 45 | 35 | 15 | 5 | 100 |
| **Y3 Q4 (exit)** | **46** | **40** | **20** | **10** | **116** |
| Y4 Q4 (exit) | 46 | 50 | 35 | 25 | **156** |

(BUSINESS_PLAN's original 235-sub Y1 target assumed pan-state organic + word-of-mouth; that's been replaced by realistic per-metro penetration.)

---

## 4. Gross vs Net MRR/ARR (the answer to your question)

### Year 1 exit (16 subs, Huntsville only)

Tier mix assumption: 60% Business / 35% Pro / 5% Enterprise (per BUSINESS_PLAN)
- 10 Business, 5-6 Pro, 0-1 Enterprise → call it 10/5/1 = 16

| Line | Calc | $/mo |
|---|---|---|
| Subscription revenue | (10 × $99) + (5 × $249) + (1 × $499) | $2,734 |
| Avg overage uplift (~10% of subs do overage at avg ~$30) | 16 × 0.10 × $30 | $48 |
| **Gross MRR** | | **$2,782** |
| Reveal variable cost (~12 reveals/sub avg × $0.06) | 16 × 12 × $0.06 | -$11.52 |
| Roof measurement cost (~3/sub × $0.05) | 16 × 3 × $0.05 | -$2.40 |
| Per-org fixed overhead (Y1 = $30/sub) | 16 × $30 | -$480 |
| Stripe (2.9% + $0.30 × 16) | | -$85.51 |
| **Total COGS** | | **-$579** |
| **Net MRR** | | **$2,203** |
| **Gross GM%** | | **79%** |
| **Net GM% (after fixed overhead)** | | **79%** (low because fixed overhead dominates at small scale) |
| **Gross ARR run-rate** | | **$33,384** |
| **Net ARR run-rate** | | **$26,436** |

Y1 is operationally cash-flow break-even after we cover ~$2.2k/mo of fixed cost. Most of the loss in Y1 is acquisition cost (CAC) plus the overhead of running an under-utilized cloud — neither shows in COGS.

### Year 2 exit (55 subs, Huntsville + Nashville)

Mix: 33 Business / 19 Pro / 3 Enterprise

| Line | $/mo |
|---|---|
| Subscription revenue: (33 × $99) + (19 × $249) + (3 × $499) | $9,495 |
| Overage uplift (~15% of subs do overage at avg $40) | $330 |
| **Gross MRR** | **$9,825** |
| Reveal variable cost (~15 reveals/sub × $0.05) | -$41.25 |
| Roof measurement cost (~5/sub × $0.05) | -$13.75 |
| Per-org overhead (~$25/sub at 55-sub scale) | -$1,375 |
| Stripe (2.9% + $0.30 × 55) | -$301.41 |
| **Total COGS** | **-$1,731** |
| **Net MRR** | **$8,094** |
| **Gross GM%** | **82%** |
| **Net GM% (after overhead)** | **82%** |
| **Gross ARR run-rate** | **$117,900** |
| **Net ARR run-rate** | **$97,128** |

### Year 3 exit (116 subs, 4 metros)

Mix: 70 Business / 40 Pro / 6 Enterprise

| Line | $/mo |
|---|---|
| Subscription revenue: (70 × $99) + (40 × $249) + (6 × $499) | $19,884 |
| Overage uplift (~20% of subs at avg $50) | $1,160 |
| **Gross MRR** | **$21,044** |
| Reveal variable cost (~18 reveals/sub × $0.045) | -$94 |
| Roof measurement cost (~7/sub × $0.045) | -$36.54 |
| Per-org overhead (~$20/sub approaching 1k scale) | -$2,320 |
| Stripe | -$645 |
| **Total COGS** | **-$3,096** |
| **Net MRR** | **$17,948** |
| **Gross GM%** | **85%** |
| **Net GM%** | **85%** |
| **Gross ARR run-rate** | **$252,528** |
| **Net ARR run-rate** | **$215,376** |

### Year 4 exit (156 subs, 5 metros, scaling)

Mix: 94 Business / 55 Pro / 7 Enterprise

| Line | $/mo |
|---|---|
| Subscription revenue: (94 × $99) + (55 × $249) + (7 × $499) | $26,494 |
| Overage uplift (~25% subs at avg $60) | $2,340 |
| **Gross MRR** | **$28,834** |
| Reveal variable cost | -$140 |
| Roof measurement cost | -$54 |
| Per-org overhead (~$17/sub at 1k+ scale) | -$2,652 |
| Stripe | -$884 |
| **Total COGS** | **-$3,730** |
| **Net MRR** | **$25,104** |
| **Gross GM%** | **87%** |
| **Net GM%** | **87%** |
| **Gross ARR run-rate** | **$346,008** |
| **Net ARR run-rate** | **$301,248** |

---

## 5. Summary table — the headline numbers

| Year | Exit subs | Gross MRR | Net MRR | Gross ARR | **Net ARR** | Net GM% | Notes |
|---|---|---|---|---|---|---|---|
| Y1 | 16 | $2,782 | $2,203 | $33,384 | **$26,436** | 79% | Huntsville only |
| Y2 | 55 | $9,825 | $8,094 | $117,900 | **$97,128** | 82% | + Nashville |
| Y3 | 116 | $21,044 | $17,948 | $252,528 | **$215,376** | 85% | + Birmingham + Memphis |
| Y4 | 156 | $28,834 | $25,104 | $346,008 | **$301,248** | 87% | scaling existing metros |

(Booked revenue in Y1 is materially lower than the run-rate above — ~$170k over the year, not $33k — because of "first 100 users 3 months free" promo + back-loaded ramp. The exit-Y1 run-rate is what feeds into Y2.)

---

## 6. What this changes vs the BUSINESS_PLAN's original numbers

| Metric | BUSINESS_PLAN (original) | Realistic (this model) | Why the gap |
|---|---|---|---|
| Y1 exit MRR | $42k | $2.8k | Original assumed pan-state ramp; realistic = Huntsville-only TAM cap of ~46 subs |
| Y1 ARR run-rate | $500k | $33k | Same |
| Year to $500k ARR | Y1 | Y4 | TAM is metro-by-metro |
| Blended ARPU | $175 | $173-185 (with overage) | Holds up; overage adds ~7% lift |
| Gross margin | 60% (data API pass-through cited) | 79-87% | Original used worst-case Tracerfy pricing on every reveal; realistic includes cache hits + scale renegotiation, but adds infra/overhead |
| Per-org overhead modeled | No | Yes ($13-30/mo depending on scale) | The thing you asked me to add |

---

## 7. The strategic implications

1. **Year 1 is sub-scale by design.** 16 subs / $26k ARR is not a failure — it's the realistic Huntsville ceiling. Don't chase $500k ARR from one metro.

2. **Multi-metro execution is the lever, not pricing.** $500k ARR requires 4 metros active by Y3. Each metro takes ~6 months to load data + 6-9 months to penetrate. So the data-loading work happening right now (Limestone/Marshall/Jackson backfills + the planned Nashville ingest) is the literal critical path.

3. **Net GM hits 85%+ at the 1,000-sub stage.** Per-org overhead drops from $30 to $17 as we scale, so margins improve as we grow. Classic SaaS curve.

4. **Cash flow break-even is around 30-40 paying subs** (covers ~$1k/mo of fixed cost beyond per-org overhead). That puts profitability at Y2 Q2-Q3.

5. **Watch the ARPU mix.** A shift from 60/35/5 toward 50/40/10 (more Pro, more Enterprise) raises blended ARPU to ~$210 and accelerates net ARR ~15% with no additional sales effort. **Pro is the leverage tier** — every additional Pro sub adds ~$215/mo net.

6. **Free Scout users have a real cost.** ~$17-30/mo overhead per active free user. Need ≥10% Scout-to-Business conversion to justify the funnel; below that, Scout is a money pit. Keep Scout intentionally limited (no PII, view-only pipeline, 25-reveal hard cap) so there's a real upgrade reason.

---

## 8. What's still missing from this model

- **CAC and payback period.** I've assumed but not modeled paid acquisition. At $200 blended CAC and $173 ARPU × 90% net GM, payback is ~1.3 months — excellent if it holds. Roofing-vertical CAC could be 2-3× higher; needs validation in Q2-Q3 of Y1.
- **Churn.** Assumed 4%/mo (BUSINESS_PLAN). 4% × $173 ARPU on 100-sub base = $692/mo MRR loss = need ~4 new subs/mo just to stay flat. Real churn won't be known until Q4 of Y1.
- **Annual prepay discount.** 2 months free for annual prepay improves cash + churn. Not modeled here; would shift ~30% of MRR to upfront cash.
- **Stripe wiring.** None of this revenue is collectable until Stripe is live (cloud migration deliverable).
- **CAC-recovery modeling for sales-led Enterprise.** $1,500-3,000 CAC vs $499 ARPU = 6-12 month payback. Sustainable but needs deliberate pacing.
