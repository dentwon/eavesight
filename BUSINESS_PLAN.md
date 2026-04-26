# Eavesight Business Plan

**Version 1.0 | March 2026**

---

## Executive Summary

### The Problem

U.S. roofing contractors lose thousands of dollars in potential revenue every year because they can't quickly identify which properties were hit by storms, when roofs were last replaced, or who owns properties in their service area. Existing tools force roofers to manually piece together data from multiple sources - if they can afford it at all.

### The Solution

Eavesight is an integrated B2B SaaS platform that gives roofing contractors a single dashboard to:
1. View historical storm damage zones overlaid on property maps
2. Identify properties with aging roofs likely to need replacement
3. Generate and manage leads for targeted outreach
4. Access property details and ownership information
5. Track storm events that create immediate business opportunities

### Market Opportunity

- **Total Addressable Market**: $76B U.S. roofing industry
- **Serviceable Available Market**: ~100,000 roofing businesses actively seeking leads
- **Serviceable Obtainable Market**: 1% of SAM = 1,000 customers × $200/month = $2.4M ARR potential

### Business Model

**Subscription SaaS with metered property reveals, no per-user fees:**

- **Scout**: Free — 5 property reveals/month, county-wide storm alerts, basic property data (try before you buy)
- **Business**: $99/month — 50 reveals/month, zip-code storm alerts, Hot/Warm/Cold lead tiers, 1 county map, 1 canvassing route/day, 5 roof-measurement credits (solo roofers / small crews)
- **Pro**: $249/month — 200 reveals/month, property-level push alerts, full 0-100 lead scoring, multi-county access, unlimited canvassing routes, owner name/phone/mailing address, 15 roof-measurement credits (serious outbound)
- **Enterprise**: Talk to Sales — unlimited reveals, custom scoring, API access, territory locking, team routing + GPS, 40 roof-measurement credits, priority support (multi-crew ops)

All paid plans: 14-day free trial, no contract, cancel anytime. Launch promo: **first 100 users get 3 months free** (currently live on landing page).

### Current Status (April 2026)

The MVP is live and in closed beta. Data loaded:
- 242,987 properties (Madison, Limestone, Morgan, Marshall, Jackson counties)
- 2.1M historical storm events (SPC, 1950-present, nationwide)
- 6.6M property↔storm associations
- 243K Microsoft building footprints
- 174K raw Huntsville parcels, 30K Huntsville building permits

Next revenue milestone: convert beta users to paid Business/Pro tier and stand up the second metro (Nashville).

---

## Problem & Solution

### The Problem

#### Market Pain Points

1. **Fragmented Data**: No single platform combines storm maps, property records, and contact info
2. **Expensive Solutions**: Competitors charge $500-2,000/month for partial functionality
3. **Time Waste**: Roofers spend 3-4 hours/day manually researching leads
4. **Missed Opportunities**: Storm events create 2-week windows when roofers can approach homeowners
5. **No Scoring**: Existing tools don't prioritize leads by conversion probability

#### Current Alternatives

| Solution | Cost | Functionality |
|----------|------|---------------|
| HailTrace | $500+/month | Storm tracking only |
| Telefi | $300+/month | Owner data only |
| Manual Research | 20+ hrs/week | Time-intensive |
| In-house CRM | $50-200/month | No storm integration |

### Our Solution

Eavesight integrates ALL data sources into ONE platform at a price point 60-80% lower than competitors.

---

## Target Market

### Primary Customer Profile

**Roofer Type**: Small to medium residential roofing contractor
- Annual revenue: $500K - $5M
- Crew size: 3-15 employees
- Active in storm-damaged areas
- Currently using 2-3 separate tools
- Willing to pay $100-300/month for integrated solution

### Secondary Markets

1. **Storm Restoration Companies** (higher ACV)
2. **Insurance Adjuster Firms** (enterprise pricing)
3. **Home inspectors** (adjacent use case)

### Geographic Focus

**Initial Launch**: Huntsville / North Alabama
- Marketed coverage: Madison, Limestone, and Morgan counties (Huntsville, Athens, Decatur)
- High storm frequency (Dixie Alley tornado + hail corridor)
- Home market; full parcel + owner + permit data already loaded
- Adjacent county data (Marshall, Jackson) also ingested and ready when demand warrants
- Storm-event data covers the entire United States; only *property* coverage is metro-gated

**Expansion**: Nashville (next), then broader Southeast storm belt.

---

## Value Proposition

### For Roofers

**Primary Benefit**: Close more jobs faster by targeting the right properties at the right time

**Supporting Benefits**:
- Save 15+ hours/week on lead research
- Increase close rate by 40% with storm-context data
- Win jobs competitors miss during storm windows
- Know exactly when to knock doors based on storm data

### ROI Calculation

| Metric | Before Eavesight | After Eavesight |
|--------|------------------|------------------|
| Leads researched/week | 20 | 80 |
| Time per lead | 45 min | 5 min |
| Close rate | 10% | 15% |
| Jobs closed/month | 6 | 12 |
| Average job value | $8,000 | $8,000 |
| Monthly revenue | $48,000 | $96,000 |

**ROI**: Investment pays back in first 2 weeks

---

## Competitive Analysis

### Direct Competitors

| Competitor | Strengths | Weaknesses | Pricing |
|-------------|-----------|------------|---------|
| HailTrace | Best storm data | No property/owner data | $500+/mo |
| Telefi | Good owner data | No storm analytics | $300+/mo |
| SalesRabbit | CRM features | No roof-specific data | $200+/mo |
| AccuLynx | Full CRM suite | Expensive, complex | $400+/mo |

### Our Advantages

1. **Integration**: Only platform combining storm + property + owner + roof age
2. **Price**: 60-80% lower than competitors
3. **Simplicity**: Designed specifically for roofers, not general contractors
4. **Speed**: MVP ships in 8 weeks vs 6+ months for competitors

### Barriers to Entry

1. **Data Relationships**: Established partnerships with property data providers
2. **Network Effects**: More roofers using = better data insights
3. **Switching Cost**: CRM and lead history creates stickiness

---

## Go-to-Market Strategy

### Launch Timeline

MVP is live (closed beta as of April 2026). Remaining sequence:

**Now: Closed beta**
- Recruit 10-20 Huntsville-area roofers (free via "first 100 users get 3 months free" landing-page offer)
- Finish filling the biggest data gaps (owner phone/email via skip-trace, roof anchors, permit is_roofing classifier) — see DATA_AUDIT_GAP_ANALYSIS.md
- Wire Stripe billing + quota enforcement before ending free trials

**+30 days: Paid conversion**
- Convert first-cohort beta users to Business / Pro
- Begin content marketing (blog, YouTube)
- Start referral incentive (1 month free for a successful referral)

**+60-90 days: Second-metro readiness**
- Ingest Nashville parcels (Davidson / Williamson / Rutherford / Sumner / Wilson CAD)
- Register Nashville `Metro` record, run pin-card + hex aggregation
- Open Nashville waitlist on landing page

**+90-120 days: Nashville launch**
- Paid acquisition in Nashville metro
- Enterprise pilot conversations with multi-crew operations

### Acquisition Channels

1. **Content Marketing** (long-term)
   - Blog: "How to use storm data for roofing leads"
   - YouTube: Tutorial videos
   - SEO: "roofing leads software", "hail storm tracking"

2. **Paid Advertising** (scaling)
   - Google Ads: $500-1,000/month initial budget
   - Facebook/Instagram: Contractor-focused groups
   - LinkedIn: B2B targeting

3. **Partnerships** (efficiency)
   - Roofing material suppliers (GAF, Owens Corning)
   - Roofing associations (NRCA)
   - Adjacent software (Jobber, Housecalls Pro)

4. **Referrals** (low-cost)
   - Incentive: 1 month free for successful referral
   - Target: 30% of new customers from referrals

### Pricing Strategy

**Live pricing (see landing page):**
- **Scout — Free** (5 reveals/mo; funnel opener, drives signups without friction)
- **Business — $99/mo** (50 reveals/mo; solo roofers + small crews)
- **Pro — $249/mo** (200 reveals/mo; serious outbound teams — *featured, "most popular"*)
- **Enterprise — Custom** (unlimited reveals + API + territory locking)

**Launch promo:** First 100 users get 3 months free on any paid plan.

**Rationale:** Flat company pricing (no per-user fees) removes the "how many seats do I need?" objection. Metered property reveals make the value obvious — each reveal unlocks the full owner + contact + storm + roof profile for one address, which is the unit of work a roofer actually consumes. Pro at $249 is anchored against the plan's "1 closed job = 56× monthly cost" math. Still priced materially below HailTrace ($500+) / Telefi ($300+) / AccuLynx ($400+).

---

## Financial Projections

### 12-Month Forecast

**Assumptions**

- **Paid tier mix** (of paying customers): 60% Business @ $99, 35% Pro @ $249, 5% Enterprise @ ~$500 avg → blended paid ARPU **~$175/mo**.
- **Total-base mix**: ~30% stay on Scout (free). Paying users = ~70% of total signups once the base stabilizes, lower early as promo trials absorb.
- **Launch promo**: "first 100 users get 3 months free" means months 1-3 produce ~zero paid revenue — the first cohorts graduate to paid in month 4.
- **Churn**: assume 4% monthly on paid in year 1 (embedded in paying-user counts).
- **Nashville**: ingest Q3, open waitlist, launch month 10 → second-metro boost late Q4.

| Month | Total signups | Paying users | Blended paid ARPU | MRR | Notes |
|-------|---|---|---|---|-------|
| 1 | 10 | 0 | — | $0 | Closed beta; Huntsville cohort on promo |
| 2 | 25 | 0 | — | $0 | Organic + local outreach; promo absorbing |
| 3 | 50 | 0 | — | $0 | Content/SEO indexing; first conversions queued |
| 4 | 75 | 8 | $170 | $1,360 | First promo grads convert to paid |
| 5 | 105 | 20 | $172 | $3,440 | Referral program activates |
| 6 | 145 | 38 | $174 | $6,612 | Partnerships (suppliers / NRCA) warm up |
| 7 | 190 | 60 | $175 | $10,500 | Paid ads scale; content ranking |
| 8 | 240 | 85 | $176 | $14,960 | First Enterprise pilot |
| 9 | 290 | 115 | $177 | $20,355 | Inbound from SEO matures |
| 10 | 355 | 150 | $178 | $26,700 | **Nashville launch** (new-metro promo) |
| 11 | 420 | 190 | $178 | $33,820 | Nashville promo conversions |
| 12 | 500 | 235 | $180 | $42,300 | Year-end; multi-metro scale |

**Year 1 Target**: ~500 total signups, ~235 paying customers, **~$42K exit MRR ≈ $500K run-rate ARR**. Year-1 booked revenue is materially lower (~$170K) because the first three months yield near-zero MRR and ramp is back-loaded.

### 3-Year Projection

| Year | Total signups | Paying | Exit MRR | ARR run-rate | Notes |
|------|---|---|---|---|---|
| Year 1 | 500 | 235 | $42K | **~$500K** | Huntsville + Nashville launch |
| Year 2 | 2,000 | ~1,050 | $195K | **~$2.3M** | Add Birmingham, Atlanta, Austin; Enterprise book grows |
| Year 3 | 5,000 | ~2,800 | $560K | **~$6.7M** | 8-12 metros live; Enterprise mix climbs to ~15% of revenue |

### Cost Structure

Costs scale with the user base; launch-phase run-rate differs materially from year-end.

**Launch phase (Months 1-6)**

| Category | Monthly | Notes |
|----------|---------|-------|
| Hosting (Postgres, Redis, Vercel, CDN) | $150 | Managed DB is the biggest line |
| Data APIs (SPC, Census, skip-trace pilot) | $400 | Skip-trace metered per reveal |
| Roof measurement credits (Roofr/EagleView) | $300 | Metered, ~$3-6 per measurement |
| Marketing (ads, content, conferences) | $1,000 | Ramps with spend appetite |
| Tooling (Stripe, Twilio, Resend, Sentry) | $200 | |
| **Total** | **~$2,050** | |

**Year-end run-rate (Month 12)**

| Category | Monthly | Notes |
|----------|---------|-------|
| Hosting | $500 | Dedicated Postgres, Redis cluster, CDN |
| Data APIs + skip trace | $2,000 | Scales with reveals; ~60% gross margin after pass-through |
| Roof measurement credits | $1,500 | Pro/Enterprise volume |
| Marketing | $5,000 | Paid search + programmatic + events |
| Tooling | $500 | |
| **Total** | **~$9,500** | |

Annualized year-1 opex ≈ **~$65K** blended (ramping from $2K → $9.5K across the year); against Year-1 booked revenue of ~$170K, contribution margin is positive from Q2.

---

## Product Roadmap

### Phase 1: MVP (Months 1-3)
- [x] Storm event map overlays
- [x] Property search
- [x] Basic lead management
- [x] User authentication
- [x] Single metro area

### Phase 2: Growth (Months 4-6)
- [ ] Multi-metro support
- [ ] Lead scoring algorithm
- [ ] Email/SMS integrations
- [ ] Mobile app (iOS/Android)
- [ ] Team collaboration features

### Phase 3: Scale (Months 7-12)
- [ ] AI roof age estimation
- [ ] Insurance claim integration
- [ ] API for third-party integrations
- [ ] Marketplace for roofers
- [ ] Automated outreach workflows

### Phase 4: Enterprise (Year 2)
- [ ] Enterprise dashboard
- [ ] SSO/SAML support
- [ ] Custom integrations
- [ ] Dedicated support
- [ ] White-label options

---

## Operations Plan

### Team Structure (Year 1)

**Solo Founder + Contractors**
- Founder: Product, sales, customer success
- Contractor: Development (part-time)
- Contractor: Design (as needed)

### Key Metrics

| Metric | Target |
|--------|--------|
| Monthly Churn | < 3% |
| Customer Acquisition Cost | < $100 |
| Lifetime Value | > $2,000 |
| Net Promoter Score | > 50 |
| Time to First Value | < 7 days |

### Customer Support

- Email support for all tiers
- Live chat for Professional+
- Monthly onboarding webinars
- Comprehensive knowledge base

---

## Risk Analysis

### Technical Risks
1. **Data Provider Reliability**: Mitigation - have backup providers
2. **API Rate Limits**: Mitigation - implement caching strategy
3. **Scalability**: Mitigation - use proven infrastructure

### Market Risks
1. **Competitor Response**: Mitigation - move fast, build loyalty
2. **Economic Downturn**: Mitigation - focus on essential value
3. **Market Adoption**: Mitigation - validate with beta users first

### Regulatory Risks
1. **Data Privacy**: Mitigation - GDPR/CCPA compliant from day 1
2. **TCPA/DNC**: Mitigation - use compliant contact providers
3. **State Licensing**: Mitigation - consult legal counsel

---

## Success Metrics

### Primary KPIs
1. **Monthly Recurring Revenue (MRR)**: Growth rate target 15-20% month-over-month
2. **Customer Acquisition Cost (CAC)**: Target < $100
3. **Customer Lifetime Value (LTV)**: Target > $2,000
4. **LTV:CAC Ratio**: Target > 3:1
5. **Monthly Churn Rate**: Target < 3%

### Secondary KPIs
1. **Daily Active Users**: > 60% of subscribers
2. **Feature Adoption**: > 70% use map features weekly
3. **NPS Score**: > 40
4. **Support Response Time**: < 4 hours

---

## Conclusion

Eavesight represents an unprecedented opportunity to transform how roofing contractors find and convert customers. By integrating fragmented data sources into a single, affordable platform, we can capture significant market share from expensive, partial solutions.

With $100 initial investment and focused execution, we can:
1. Build and launch MVP in 8-12 weeks
2. Acquire first 50 customers in 6 months
3. Reach $10K MRR within 12 months
4. Establish Eavesight as the industry standard

**The time to act is now.** Storm events create constant demand, competitors are overpriced, and roofers are hungry for better tools.

---

*Prepared by Eavesight Team*
*March 2026*