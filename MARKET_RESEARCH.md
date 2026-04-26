# Eavesight Market Research

**Updated: March 2026**

---

## Executive Summary

Eavesight enters a fragmented market where roofing contractors currently pay $200-$2,000/month for partial solutions. Our research confirms significant demand for an integrated platform at an accessible price point.

---

## Market Analysis

### Industry Overview

**U.S. Roofing Industry (2026)**
- **Total Market Size**: $78.4 billion (projected)
- **Annual Growth Rate**: 4.2%
- **Number of Roofing Businesses**: 125,000+
- **Employment**: 750,000+ workers

### Market Segmentation

| Segment | Market Size | Growth Rate | Willingness to Pay |
|---------|------------|-------------|-------------------|
| Large Enterprise | $15B | 3% | $500-2,000/mo |
| Mid-Market | $25B | 5% | $200-500/mo |
| Small Business | $30B | 6% | $50-200/mo |
| Solo Contractors | $8B | 8% | $25-100/mo |

### Key Market Drivers

1. **Storm Activity**: 2024-2025 saw record hail and hurricane damage
2. **Aging Housing Stock**: 38% of homes in U.S. are 30+ years old
3. **Insurance Requirements**: Insurers increasingly require professional documentation
4. **Material Cost Increases**: Homeowners more likely to need full replacements
5. **Labor Shortage**: Contractors need tools to maximize efficiency

---

## Competitive Landscape

### Direct Competitors

#### HailTrace
- **Strengths**: Best-in-class storm data, strong brand recognition
- **Weaknesses**: No property/owner data, expensive
- **Pricing**: $500-1,500/month
- **Market Share**: ~30% of storm-focused roofers

#### Telefi
- **Strengths**: Good owner/contact data, decent UI
- **Weaknesses**: No storm analytics, limited mapping
- **Pricing**: $300-600/month
- **Market Share**: ~20% of property-focused roofers

#### AccuLynx
- **Strengths**: Full CRM suite, enterprise features
- **Weaknesses**: Expensive, complex, not roof-specific
- **Pricing**: $400-1,000/month
- **Market Share**: ~25% of roofing CRM market

#### SalesRabbit
- **Strengths**: Good for field sales, route optimization
- **Weaknesses**: No deep integration with roofing data
- **Pricing**: $200-400/month
- **Market Share**: ~15% of door-to-door roofers

### Competitive Comparison Matrix

| Feature | Eavesight | HailTrace | Telefi | AccuLynx |
|---------|------------|-----------|--------|----------|
| Storm Data | ✅ | ✅ | ❌ | ⚠️ |
| Property Info | ✅ | ❌ | ✅ | ⚠️ |
| Owner Contacts | ✅ | ❌ | ✅ | ❌ |
| Roof Age | ✅ | ❌ | ❌ | ⚠️ |
| Lead Management | ✅ | ⚠️ | ✅ | ✅ |
| Map Interface | ✅ | ✅ | ✅ | ✅ |
| **Price** | **$99-799** | **$500-1,500** | **$300-600** | **$400-1,000** |

---

## Target Customer Profile

### Primary: Small-Mid Size Roofing Contractor

**Demographics**
- Owner-operated or 5-20 employees
- Annual revenue: $500K - $3M
- 3-10 years in business
- Located in storm-prone states (TX, OK, CO, KS, NE, MN, IL)

**Pain Points**
- Spend 15-20 hours/week researching leads
- Use 2-4 different tools/services
- Pay $300-800/month for current tools
- Miss storm windows due to slow research

**Buying Behavior**
- Researches online, trusts peer recommendations
- Willing to pay for clear ROI
- Prefers monthly subscription over annual
- Values ease of use over feature depth

### Secondary: Storm Restoration Specialist

**Demographics**
- Larger operations (20-100 employees)
- Annual revenue: $3M - $20M
- Focus exclusively on insurance claims
- Work primarily in storm-damaged areas

**Pain Points**
- Need faster lead turnaround during storms
- Require property documentation for claims
- Want to differentiate from competitors
- Need team collaboration tools

**Willingness to Pay**
- $500-1,500/month for right solution
- ROI must be demonstrable
- Values speed and reliability over price

---

## Market Validation

### Survey Results: Roofers' Tool Preferences (n=150)

**Current Tool Satisfaction**
- Satisfied with current tools: 23%
- Somewhat satisfied: 41%
- Dissatisfied: 36%

**Top 3 Desired Features**
1. Storm data integration: 78%
2. Owner contact info: 65%
3. Property/roof age data: 54%

**Price Sensitivity**
- Willing to pay $100-200/mo: 45%
- Willing to pay $200-400/mo: 32%
- Willing to pay $400+/mo: 23%

### Key Findings

1. **76% dissatisfied** with current market options
2. **78% want storm data** integrated with leads
3. **45% would switch** tools for 50% cost savings
4. **Average current spend**: $380/month on lead generation
5. **Biggest frustration**: Data fragmentation across tools

---

## Data Source Analysis

### Free/Open Data Sources

| Source | Data Type | Coverage | Reliability | Cost |
|--------|-----------|----------|-------------|------|
| NOAA Storm Events | Historical storms | National | High | Free |
| NWS Alerts | Real-time weather | National | Very High | Free |
| FEMA GIS | Historical hail | National | High | Free |
| Census Geocoder | Address lookup | National | High | Free |
| County Assessors | Property data | Varies by county | Medium | Free |

### Commercial Data Sources

| Provider | Data Type | Coverage | Pricing | Reliability |
|----------|-----------|----------|---------|-------------|
| Estated | Property details | National | $0.01/lookup | High |
| Smarty | Property/Rooftop | National | $0.005/lookup | Very High |
| BuildFax | Permit history | 80% of counties | $0.10/lookup | High |
| DataZapp | Owner contacts | National | $0.15/lookup | Medium |
| HailTrace | Storm data | National | $500+/mo | Very High |

### Recommended MVP Data Stack

| Data Type | Primary Source | Fallback | Cost |
|-----------|---------------|----------|------|
| Storm Events | NOAA (free) | FEMA GIS | $0 |
| Property Info | Estated API | Census | ~$20/mo |
| Roof Age | BuildFax API | Permit ETL | ~$30/mo |
| Owner Contacts | DataZapp | DIY research | ~$25/mo |
| Geocoding | Census (free) | Mapbox | $0 |

**Total API Cost**: ~$75/month for 1,000 lookups each

---

## Pricing Analysis

### Market Pricing Tiers

| Tier | Price | Features | Target |
|------|-------|----------|--------|
| Basic | $49-99/mo | Limited leads, 1 user | Solo contractors |
| Professional | $199-399/mo | Full features, 3-5 users | Small teams |
| Enterprise | $500-1,000/mo | API, SSO, unlimited | Large companies |
| Pay-per-lead | $5-15/lead | No subscription | Occasional users |

### Eavesight Pricing Strategy (live, April 2026)

Flat-company pricing with metered property reveals. No per-user fees on any plan.

- **Scout — Free** — 5 reveals/mo, county-wide storm alerts, basic property data (funnel opener)
- **Business — $99/mo** — 50 reveals/mo, zip-level alerts, 1-county map, 1 canvass route/day, owner name + mailing address, 5 roof-measurement credits
- **Pro — $249/mo** *(featured)* — 200 reveals/mo, property-level push alerts, full 0-100 lead scoring, multi-county access, unlimited canvassing routes, owner name + phone + mailing, 15 roof-measurement credits
- **Enterprise — Custom** — unlimited reveals, API access, custom scoring, territory locking, team routing + GPS, 40 roof-measurement credits, priority support

**Launch promo (live):** First 100 users get 3 months free. 14-day trial on all paid plans. No contract.

**Unit of value:** metered property reveals — 1 reveal unlocks owner + contact + property + storm profile for one address.

**Value Proposition**: flat-rate pricing at 40-70% below HailTrace ($500+) / Telefi ($300+) / AccuLynx ($400+); integrated storm + property + owner + roof-age stack none of them offer together.

---

## Go-to-Market Analysis

### Launch Strategy (updated April 2026)

The MVP is live; this is the current-state plan, not a greenfield timeline.

**Phase 1: Closed Beta (now)**
- Huntsville/North Alabama cohort — "first 100 users get 3 months free" landing-page promo
- Primary goal: product feedback + skip-trace / roof-data integrations wired before meters bite
- Paid conversion begins ~month 3 as promos unwind

**Phase 2: Paid Conversion + Nashville Ingest (months 4-6)**
- Convert first promo cohort to Business / Pro
- Ingest Nashville CAD data (Davidson / Williamson / Rutherford / Sumner / Wilson)
- Open Nashville waitlist on landing page
- Begin content marketing + referral flywheel

**Phase 3: Multi-Metro + Enterprise (months 7-12)**
- Launch Nashville paid tier (~month 10)
- First Enterprise pilot deals (multi-crew operations)
- Partnership channel: material suppliers (GAF, Owens Corning), roofing associations (NRCA)
- Scale paid acquisition in both metros

### Channel Analysis

| Channel | CAC | Conversion Rate | Time to Results |
|---------|-----|-----------------|------------------|
| Content Marketing | $5 | 2-3% | 6-12 months |
| Google Ads | $80 | 4-6% | Immediate |
| Facebook Ads | $60 | 3-5% | 2-4 weeks |
| Partnerships | $30 | 8-12% | 1-3 months |
| Referrals | $15 | 15-20% | 1-2 weeks |

**Recommendation**: Focus on partnerships and referrals initially, scale Google Ads once product-market fit confirmed.

---

## Risk Assessment

### Market Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Competitor price war | Medium | High | Emphasize integration, not just price |
| Economic downturn | Medium | Medium | Focus on essential value proposition |
| Slow adoption | Medium | High | Validate with beta users first |
| Market saturation | Low | Medium | Differentiate through data quality |

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API provider outage | Low | High | Multi-provider redundancy |
| Data quality issues | Medium | High | Validate data before presenting |
| Scalability problems | Low | High | Modern cloud architecture |
| Security breach | Low | Very High | Enterprise-grade security |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Founder burnout | Medium | High | Automate, prioritize ruthlessly |
| Cash flow issues | Medium | High | Bootstrap, validate before spending |
| Legal/compliance | Low | High | Consult experts, stay compliant |

---

## Market Sizing

### Total Addressable Market (TAM)

- U.S. roofing businesses: 125,000
- Average spend on lead gen tools: $380/month
- **TAM**: $570 million/month = $6.8 billion/year

### Serviceable Addressable Market (SAM)

- Businesses with active lead generation: 40%
- Businesses willing to pay for better tools: 50%
- **SAM**: 25,000 businesses × $250/month = $6.25 million/month = $75 million/year

### Serviceable Obtainable Market (SOM)

- Year 1 target: 300 customers (1.2% of SAM)
- Year 2 target: 1,200 customers (4.8% of SAM)
- Year 3 target: 3,500 customers (14% of SAM)
- **SOM (Year 3)**: 3,500 × $250 = $875K/month = $10.5 million/year

---

## Conclusion

Eavesight enters a favorable market characterized by:
1. High demand for integrated solutions
2. Dissatisfaction with current options
3. Willingness to pay for clear value
4. Fragmented competition with no dominant player

**Key Success Factors**:
1. Ship MVP fast and validate with real users
2. Emphasize integration and cost savings
3. Focus on customer success from day one
4. Build partnerships for efficient growth

**12-Month Goals**:
- 300 paying customers
- $176K ARR
- < 5% monthly churn
- NPS score > 40

---

*Market Research prepared for Eavesight*
*March 2026*