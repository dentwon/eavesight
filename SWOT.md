# Eavesight SWOT Analysis

**Updated: April 2026** (product is live in closed beta)

---

## Strengths

### Internal Advantages

1. **Integrated Data Approach**
   - Only platform combining nationwide storm history, parcel-level property records, permit history, and lead scoring on one map
   - 2.1M storm events + 243K North Alabama properties + 6.6M property↔storm links already loaded
   - Unified 0-100 score with dormant-flag and claim-window signals

2. **Shipped Product**
   - MVP live, not vaporware; dashboard, mobile bottom-sheet, metro-scoped map all working
   - Scale-ready infrastructure already in place: H3 hex aggregates, pin-card denormalization, metro registry for drop-in new-market launches
   - 8 migrations deployed; nightly worker pipeline runs unattended

3. **Cost Structure & Pricing**
   - Flat company pricing with metered reveals (no per-user fees)
   - Business at $99 and Pro at $249 materially undercut HailTrace ($500+) / Telefi ($300+) / AccuLynx ($400+)
   - Scout Free tier removes signup friction and drives funnel

4. **Agility**
   - Solo/small team — can ship without enterprise bureaucracy
   - Iterate based on closed-beta feedback
   - Adapt quickly to data-source changes and market signals

5. **Technical Architecture**
   - Prisma + PostgreSQL/PostGIS + Redis/BullMQ + MapLibre
   - Viewport-bound pin queries replace expensive "top-N" map fetches
   - Pin-card payloads tiered by entitlement (Free / Pro) at the API layer
   - Metro-scoped routing (`/m/[metro]`) ready for second-metro launch without UI changes

6. **Brand & Positioning**
   - Clear, memorable name (Eavesight)
   - Landing-page value prop anchored on ROI math ("1 closed job = 56× monthly cost")
   - Live beta promo ("first 100 users get 3 months free") reduces objection to signing up

---

## Weaknesses

### Internal Limitations

1. **Contact Data Gap**
   - Zero owner phones / emails / DNC entries across 243K properties
   - Blocks the TCPA-compliant outreach the business plan sells
   - Skip-trace integration is the highest-priority unlock (see DATA_AUDIT_GAP_ANALYSIS.md)

2. **Roof Data is Empty**
   - The `roof_data` table (material, pitch, facets, squares, cost estimates) has zero rows
   - This is the keystone differentiator vs HailTrace and it ships blank today
   - Need to pick a source (Roofr / EagleView / Nearmap / GeoX, or geometry-based estimator)

3. **Billing & Metering Not Wired**
   - No Stripe customer IDs on any org; `ApiUsage`/`ApiQuota` tables empty
   - No property-reveal meter — the metered unit of value has no backing ledger
   - No roof-measurement credit ledger
   - Tiers cannot be enforced on day one of paid launch

4. **Single-Metro Depth**
   - 100% of property data is Alabama; Nashville not yet ingested
   - Year-built confidence is 98% inferred (ACS median or KNN) — only 1.7% VERIFIED
   - "Aging roofs" pitch needs better ground truth

5. **Limited Founder Bandwidth**
   - Solo-to-small team wearing product, sales, ops, dev hats
   - Closed beta under 20 users; operational load will climb fast

6. **Storm Overlays Are Points, Not Polygons**
   - `pathGeometry` is empty; tornado/wind swath polygons not stored
   - Reduces the visual impact of storm overlays compared to HailTrace-style maps

---

## Opportunities

### External Growth Drivers

1. **Market Gap**
   - No direct competitor offers full storm + property + owner + roof-age integration
   - Competitors are fragmented and priced 2-4× our tiers
   - Roofers are actively seeking better tools

2. **Market Size**
   - $76B+ U.S. roofing industry; 100,000+ roofing businesses
   - Storm events create continuous demand cycles
   - Aging housing stock (38% of homes are 30+ years old) drives replacement cycles

3. **Geographic Expansion Template**
   - Metro-scoped API + pin-card denorm means new metros drop in by ingesting data + registering a `Metro` record
   - Nashville queued as second metro; Austin/Atlanta/Birmingham follow
   - Dixie Alley + Southeast storm belt is our natural expansion path

4. **Partnerships**
   - Material suppliers (GAF, Owens Corning)
   - Roofing associations (NRCA)
   - Adjacent software (Jobber, Housecall Pro) for CRM handoff
   - Insurance adjuster firms (Enterprise tier)

5. **Network Effects**
   - More active roofers = more claim/permit/status signals feeding the score
   - User-flagged earmarks and dormant-flag feedback improve future scoring

6. **Enterprise Upsell**
   - Multi-crew operations are the highest-ARPU segment
   - Territory locking + team routing + GPS + API → Enterprise tier justifies 5-10× Pro pricing
   - First Enterprise pilot planned for H2

7. **Economic / Regulatory Tailwinds**
   - Climate change increasing storm frequency + severity
   - Insurers increasingly requiring professional documentation
   - Aging housing stock + high material costs push replacement over repair

---

## Threats

### External Challenges

1. **Competitive Response**
   - HailTrace, Telefi, AccuLynx could cut price or add missing features
   - Well-funded incumbents could replicate our integration faster than we expand metros

2. **Regulatory Risk (TCPA / DNC)**
   - Outbound call/SMS rules are strict; single enforcement action could kneecap trust
   - DNC compliance isn't optional — `dnc_entries` table is empty today
   - State-level lead-generation laws vary

3. **Data Source Risk**
   - County ArcGIS services change schema or rate limits with no notice
   - Microsoft building footprints are a free gift that could go away
   - SPC data format changes would disrupt ingest

4. **Skip-Trace Cost Risk**
   - Contact-data vendors (Endato, BatchSkipTrace, Telnyx) price per lookup; scales with reveal volume
   - Must be priced into reveal unit economics; if vendor raises prices, margins compress

5. **Economic Volatility**
   - Recession → contractors cut software subscriptions
   - Construction slowdown → fewer reveals → lower metered revenue

6. **Market Saturation**
   - Low-barrier segments attract commodity competitors
   - Race-to-bottom pricing risk once differentiation erodes

7. **Technical Risk**
   - Single-instance Postgres through Year 1; a disk-full or replication lag incident is unrecoverable without good backup discipline
   - Rate limits on free geocoders (Nominatim) can throttle nightly backfills

---

## SWOT Matrix

|  | **Helpful** | **Harmful** |
|----------------|-------------------------------|----------------------------------|
| **Internal** | **Strengths** | **Weaknesses** |
|  | • Integrated storm + property stack | • Zero owner phones/emails |
|  | • Live shipped product | • Roof data table empty |
|  | • 40-70% below competitor pricing | • Stripe billing + reveal meter not wired |
|  | • Scale-ready metro architecture | • Single-metro depth today |
|  | • Clear brand + live beta promo | • Solo / small team bandwidth |
| **External** | **Opportunities** | **Threats** |
|  | • $76B market with no integrated competitor | • Competitors cutting prices or copying |
|  | • Southeast storm-belt expansion path | • TCPA / DNC enforcement risk |
|  | • Partnership + integration channels | • Data-source schema / pricing changes |
|  | • Enterprise multi-crew upsell | • Skip-trace cost compression on margins |
|  | • Network effects from user signals | • Recession reducing contractor spend |

---

## Strategic Recommendations

### Leverage Strengths to Capture Opportunities

1. **S1 + O1 + O2**: Lead all marketing with the integration story (storm + property + owner + roof age on one map); anchor pricing against HailTrace/Telefi/AccuLynx stack cost ($900+/mo).
2. **S2 + O3**: Use metro-scoped architecture to launch Nashville cleanly, prove the expansion template works, then move on Birmingham/Atlanta/Austin in Year 2.
3. **S5 + O6**: Enterprise tier's API + territory locking + team routing is already schema-supported — pilot with multi-crew ops early in H2.

### Counter Weaknesses Before Paid Launch

1. **W1 + T2 (contact data + TCPA)**: Wire skip-trace + load federal DNC registry before any outreach-related feature goes paid. This is the single biggest launch blocker.
2. **W2 + S1 (roof data + integrated story)**: Pick a roof-measurement source this quarter; even 10% coverage beats 0%. Without this, the "integrated" pitch is a three-legged stool.
3. **W3 (billing/meter)**: Build the property-reveal meter and Stripe webhook before the first paid cohort graduates from the promo.

### Protect Against Threats Using Strengths

1. **T1 + S3**: Pricing advantage is defensive — keep the flat-company / no-per-user story front-and-center; competitors with per-seat models can't match without breaking their own economics.
2. **T3 + S5**: Backup ingest paths for parcel data (if one county's ArcGIS breaks, cached nightly snapshot lets the map keep working).
3. **T4 + S3**: Pass-through skip-trace cost by metering reveals — don't subsidize it out of the flat tier.

### Minimize Weaknesses, Avoid Threats

1. **W5 + T5 (founder bandwidth + recession)**: Keep fixed costs low through Year 1; resist hiring until reveal-meter revenue is live and predictable.
2. **W6 + S1 (polygon gaps)**: Backfill `pathGeometry` from SPC swath shapefiles — polygon overlays make the map look like HailTrace without changing the backend.

---

## Key Takeaways

### Top 3 Strengths to Emphasize
1. Integrated storm + property + owner + roof-age stack (no competitor has all four)
2. Shipped, scale-ready product with metro-expansion template
3. 40-70% pricing advantage with flat company pricing + no per-user fees

### Top 3 Weaknesses to Address (by next paid launch)
1. Owner phone/email (skip-trace integration)
2. Roof data source (measurement vendor or geometry estimator)
3. Reveal meter + Stripe billing wired end-to-end

### Top 3 Opportunities to Pursue
1. Nashville launch in H2 to prove multi-metro expansion template
2. First Enterprise pilot with a multi-crew operation (highest ARPU)
3. Partnership with a material supplier (distribution channel at scale)

### Top 3 Threats to Monitor
1. Competitor price cuts or integration catch-up
2. TCPA / DNC exposure if outreach ships without compliance hardening
3. Data-source schema / pricing changes (county ArcGIS, skip-trace vendor)

---

## Conclusion

Eavesight has a live, integrated product in a fragmented market, with pricing that undercuts every direct competitor and a scale-ready architecture that makes multi-metro expansion a data problem, not a rewrite. The three critical gaps before paid launch are contact data, roof data, and the metering/billing plumbing. Closing those, launching Nashville in Q3, and piloting Enterprise in Q4 should put the company at ~$500K run-rate ARR by the end of Year 1 (see `BUSINESS_PLAN.md § Financial Projections` for the full ramp).

---

*Eavesight SWOT Analysis*
*April 2026*
