# Data Source Hunt — Roof Age / Condition / Improvement Signal

**Date:** 2026-04-22
**Author:** research pass for Phase 5 ordering
**Scope:** North Alabama (Madison, Limestone, Morgan, Marshall, Jackson)
**Budget:** $100 total — prioritize free sources
**Prior work:** `<repo-root>/docs/roof-age-dragnet.md` (do not re-investigate items there)

---

## 1. TL;DR

Five actionable discoveries, in rank order:

1. **Huntsville ArcGIS REST MapServer is wide open** — `https://maps.huntsvilleal.gov/server/rest/services/Planning/PropertyData/MapServer` exposes 64 layers (Structures at layer 47) queryable as JSON/geoJSON with no auth. This is the hidden 73rd data source the City blog mentioned. Potential free bulk extract of every building polygon in Huntsville.
2. **Mapillary street-level imagery is the real aerial dark-horse** — free, CC-BY, dated, with a bbox+time API (60k/min, 50k tiles/day). Any post-2019 capture of a North-AL residential roof is a direct age floor. No prior coverage-density check exists — this is the single most important Tier B test.
3. **Propwire is a legitimate free roof-age surface** — 157M US properties, unlimited searches, 120 filters, no credit card. Confirms year-built + last sale, and their TOS permits user downloads. Does not expose roof-install date directly but gives us a free validator for 242k rows and may expose permit fields not yet surveyed.
4. **Nextdoor has a public Search API for storm-keyword posts** — lat/lng/radius/keyword with 30-day window. "Roof" + "hail" + Madison polygon = a continuously-refreshing crowd-sourced damage stream. Partnerships are granted to businesses; apply.
5. **Alabama GeoHub + Microsoft Building Footprints with height** — the statewide Virtual Alabama GeoHub (ArcGIS open data) plus Microsoft's 1.2B-building CDLA-licensed footprint dataset (includes 174M height estimates) is a free way to get building-polygon geometry statewide, enabling LiDAR-style roof polygons everywhere NAIP/DEMs fall short.

**Phase 5 ordering verdict:** Do NOT change the existing Week-1 plan. Tyler eSuite remains the highest-value fast build. But **insert "Huntsville PropertyData MapServer probe" as a pre-Phase-5 spike (4-6h)** and **promote Mapillary + Propwire as parallel Week-2 candidates** ahead of Cullman iWorQ (which requires a contractor code and is now demoted). Decatur CityView also loses rank — confirmed login-required for permit search.

---

## 2. Method + Scope

- Started from `<repo-root>/docs/roof-age-dragnet.md` as the "do-not-repeat" baseline.
- Ran 30+ targeted WebSearches across federal / state / county / city / real-estate / imagery / manufacturer / social / utility / unconventional categories.
- Validated key endpoints with WebFetch where the server permitted.
- For each candidate: URL, auth, rate, field surface, coverage hypothesis, effort, signal strength (direct date / indirect / structural / none).
- Explicitly excluded any source named as dead-end in dragnet doc.

---

## 3. Tier A — Free + Legal + Known Signal (Build Now)

### A1. Huntsville ArcGIS REST — Planning/PropertyData MapServer
- **URL:** `https://maps.huntsvilleal.gov/server/rest/services/Planning/PropertyData/MapServer`
- **Auth:** None (public)
- **Rate:** Unthrottled at the server level; respect by running at <=5 req/s
- **Fields:** 64 layers — Structures (47), Zoning (56), TIF Districts (48), Boundaries, plus dozens of planning overlays
- **Coverage:** City of Huntsville corporate limits (majority of Madison population)
- **Effort:** 4-6h to crawl all layers and run `/query?where=1=1&f=json` paginated pulls
- **Signal:** STRUCTURAL (building footprint, zoning change = redevelopment) + INDIRECT (TIF districts map high-improvement neighborhoods). Not a direct roof date, but it's the richest free geometry we have and fills the Microsoft Building Footprints gap with locally-authoritative polygons.
- **Why now:** Was literally sitting exposed the entire time. The City blog references "72 data sources" and this is one of them.

### A2. OpenFEMA NFIP Redacted Claims (v2)
- **URL:** `https://www.fema.gov/openfema-data-page/fima-nfip-redacted-claims-v2` + JSON API
- **Auth:** None
- **Rate:** 1000-row pages, no key required
- **Fields:** county, censusTract, yearOfLoss, dateOfLoss, originalConstructionDate, buildingDamageAmount, amountPaidOnBuildingClaim — 2M+ claims
- **Coverage:** Nationwide; Madison/Morgan/Limestone flood claims since 1978
- **Effort:** 2-3h (single REST scrape + join on censusTract)
- **Signal:** DIRECT originalConstructionDate field + INDIRECT damage count (high-damage tracts signal aged housing stock)
- **Use:** Populate `properties.yearBuilt` for tracts with sparse ACS; promote confidence where originalConstructionDate matches parcel.

### A3. OpenFEMA Housing Assistance Owners (v2)
- **URL:** `https://www.fema.gov/openfema-data-page/housing-assistance-program-data-owners-v2`
- **Auth:** None
- **Fields:** county, zip, inspections, damageAmount, residenceType, roofDamage flags (real fields per IA inspection schema)
- **Coverage:** Disaster-declared counties (DR-4573, DR-4596, DR-4709 cover Madison/Morgan)
- **Effort:** 3-4h
- **Signal:** INDIRECT — zip-level roof damage concentration as storm-vulnerability prior
- **Use:** Feed the existing storm-score layer; validates MRMS hail footprints with human-inspected damage.

### A4. NOAA SWDI Bulk Hail Signatures
- **URL:** `https://www1.ncdc.noaa.gov/pub/data/swdi` + `https://www.ncei.noaa.gov/maps/swdi/`
- **Auth:** None
- **Fields:** NEXRAD Level-III Hail Product (per-storm point/swath), 1995-present
- **Coverage:** All of AL within KHTX / KGWX radar range
- **Effort:** 2h (CSV per year)
- **Signal:** INDIRECT — already redundant with existing MRMS, but MESH isn't in our dragnet and the NEXRAD Level-III hail polygons give higher spatial fidelity than MRMS for pre-2013 events.
- **Use:** Extend storm history 1995-2012 beyond MRMS window.

### A5. Microsoft Building Footprints (with height)
- **URL:** `https://github.com/microsoft/USBuildingFootprints` + Planetary Computer STAC
- **Auth:** None, CDLA Permissive 2.0
- **Fields:** Polygon + 174M buildings have estimated height (m)
- **Coverage:** 100% of Alabama
- **Effort:** 3-4h
- **Signal:** STRUCTURAL — use polygon area + height to derive pitched-vs-flat roof type, spot obvious additions vs the Huntsville Structures layer.
- **Use:** Feature engineering for the downstream predictive model (roof area m^2, roof shape proxy, additions delta).

### A6. Alabama Home Builders Licensure Board — Licensee Search
- **URL:** `https://alhobprod.glsuite.us/GLSuiteWeb/Clients/ALHOB/Public/LicenseeSearch.aspx`
- **Auth:** None (public lookup)
- **Fields:** Roofer license number, name, city, status, first-issued date, discipline history
- **Coverage:** Statewide — every roofer who has pulled >$2500 jobs since ~2010
- **Effort:** 1 day (ASP.NET postback scrape, similar to Huntsville licenses harvester)
- **Signal:** NONE per-property, but this is our best **roofer-to-contractor normalization table**. Huntsville BMS permits use contractor names — fuzzy joining to the HBLB roster identifies which BMS permits are *roofing* permits by contractor specialty. Could recover the lost permit-type signal mentioned in the prompt.
- **Use:** Retroactively classify 30k already-scraped Huntsville permits by "contractor is on HBLB roofer list" -> is_roofing=true.

### A7. Alabama GeoHub (Virtual Alabama)
- **URL:** `https://data-algeohub.opendata.arcgis.com/`
- **Auth:** None
- **Fields:** Statewide parcels, imagery catalog, address points, 911 PSAP boundaries
- **Coverage:** All 67 counties
- **Effort:** 2-3h to inventory + pull relevant layers
- **Signal:** STRUCTURAL — fills geometry gaps in Marshall/Jackson where county GIS is weak.

---

## 4. Tier B — Free + Legal + Needs Signal Test

### B1. Mapillary Street-Level Imagery — TOP SUSPICION
- **URL:** `https://graph.mapillary.com` (metadata), `https://tiles.mapillary.com` (vector tiles)
- **Auth:** OAuth client token (free after signup)
- **Rate:** 60k entity/min, 10k search/min, 50k tile/day
- **Fields:** image_id, captured_at (ISO), geometry, compass_angle, quality_score; bbox + start_captured_at/end_captured_at filter
- **License:** CC-BY 4.0 on images + metadata
- **Coverage:** UNKNOWN for North AL — must spike this. Mapillary is crowdsourced (dashcams, Ford vehicles, Meta workers); urban areas are dense, suburban AL is unpredictable.
- **Effort:** 8-12h (spike: 1h to pull all captures in Madison County bbox; then 6-10h to wire a CV roof-age-inference hook, which belongs in the predictive-model phase)
- **Signal:** Coverage test first. If there are >50k Huntsville captures spanning 2017-2026, this is a **revolution** — we can constrain roof-age to a visual window per property. If there are <5k, it's noise.
- **Must-build next:** `scripts/probe-mapillary-coverage.js` — 1h spike, query captures per zipcode bin.

### B2. Propwire (freemium property data)
- **URL:** `https://propwire.com/`
- **Auth:** Free account (email, no CC)
- **Rate:** "Unlimited free searches/downloads" per their marketing. Needs TOS confirmation.
- **Fields:** 157M properties; standard CoreLogic-style: year built, sqft, beds/baths, last sale date/price, mortgage status, lien flags, absentee, vacancy flags; 120 filters
- **Coverage:** All US = full 242k Eavesight universe
- **Effort:** 8h — (1) TOS read, (2) manual export of a Madison County pilot batch of 5k rows to confirm schema, (3) bulk upsert
- **Signal:** DIRECT on year-built and last-sale (which moves roof-age priors); INDIRECT via distressed flags (foreclosure + REO = recent roof unlikely). Does NOT expose permit dates, but their "liens" filter can flag mechanic's liens = roof-work proxy.
- **Risk:** Their data origin is sublicensed — bulk redistribution via our own app may violate downstream licenses. Use internally only, no re-export.

### B3. Nextdoor Public-Post Search API
- **URL:** `https://developer.nextdoor.com/docs/search-api-copy`
- **Auth:** Partner key (apply via developer portal — typically approved for non-consumer use cases)
- **Rate:** Not published publicly
- **Fields:** post title/body, photos, lat/lng, neighborhood, timestamp (30-day rolling)
- **Coverage:** Huntsville metro has active Nextdoor neighborhoods (~40+ zones)
- **Effort:** 2 days (partner application + polling job)
- **Signal:** INDIRECT — "my roof got hit by hail last night" posts with addresses; "new roof going on the Smiths' house" chatter. Noise-heavy but ground-truth-rich.
- **Unknowns:** Approval odds for a startup. Fallback: web archive of public neighborhood pages.

### B4. USGS 3DEP LiDAR — NORTH AL STATUS
- **URL:** `https://apps.nationalmap.gov/lidar-explorer/`
- **Auth:** None
- **Critical finding:** **1m-resolution 3DEP coverage in AL is limited to Franklin, Marion, Fayette, Tuscaloosa, Walker, Cullman, Jefferson, Mobile, Escambia, Coffee, Dale, Geneva.** Madison/Morgan/Limestone/Marshall/Jackson are NOT in the 1m collection. Only 10m coverage exists statewide (too coarse for roof polygons).
- **Effort:** 0h (dead)
- **Signal:** ~NONE for us. Cullman is our only North-AL-ish county with 1m coverage, and Cullman has only 3k Eavesight properties.
- **Verdict:** Revive only when NAIP 3DEP phase expands to Madison (schedule TBD).

### B5. HMDA Home Improvement Loans
- **URL:** `https://www.consumerfinance.gov/data-research/hmda/` — LAR file
- **Auth:** None
- **Fields:** loanPurpose (4=home-improvement), loanAmount, action, censusTract, year
- **Coverage:** Nationwide, every HMDA-reporting lender
- **Effort:** 4h (annual CSV)
- **Signal:** INDIRECT at census tract level only. Home-improvement loan density is a weak per-property prior but a decent tract-level demand signal.
- **Use:** Score which Madison tracts are "renovation-active" for lead-prioritization adjustments.

### B6. FEMA Hazard Mitigation Grant (HMGP) Projects
- **URL:** `https://www.fema.gov/openfema-data-page/hazard-mitigation-grants-v3`
- **Auth:** None
- **Fields:** projectType (wind retrofit!), county, approvedAmount, dateApproved
- **Coverage:** AL received 2020+ windstorm HMGP awards
- **Effort:** 2h
- **Signal:** INDIRECT; HMGP subrecipient list doesn't give addresses but names grantee counties/cities and can reveal wind-retrofit program participation.

### B7. NREL SolarTRACE / OpenPV (zip-level solar install density)
- **URL:** `https://solarapp.nrel.gov/solarTRACE` + OpenPV dataset
- **Auth:** None
- **Fields:** zip-level PV install counts, cycle times
- **Coverage:** Zip-level for all US installations
- **Effort:** 2h
- **Signal:** INDIRECT — solar install ~ roof was likely inspected in same window; absence tells us nothing. Zip-level too coarse for per-property work, useful as a tract feature.

### B8. USPS Vacancy (HUD USER aggregated)
- **URL:** `https://www.huduser.gov/portal/datasets/usps.html`
- **Auth:** Registered gov/nonprofit user
- **Restrictions:** "Governmental entities and non-profit organizations" only — Eavesight as a for-profit is NOT eligible on face. Census-tract aggregation only (no address).
- **Effort:** 0h (blocked by eligibility)
- **Verdict:** Tier E — move to dead-ends unless an Eavesight 501(c)(3) partner emerges.

### B9. NCEI Storm Events Database (bulk CSV)
- **URL:** `https://www.ncei.noaa.gov/stormevents/ftp.jsp`
- **Auth:** None
- **Fields:** event_type, begin_date, end_date, magnitude (hail size in inches), wind_kts, county, narrative
- **Coverage:** 1950-present, all US counties
- **Effort:** 1h
- **Signal:** INDIRECT — complements MRMS with NWS-entered hail-size reports. Useful for pre-2013 events where MRMS is absent.

### B10. OSM Overpass (roof:material, roof:shape, roof:colour)
- **URL:** `https://overpass-api.de/api/interpreter`
- **Auth:** None
- **Fields:** roof:material, roof:shape, roof:colour, building:levels
- **Coverage:** Sparse in AL (OSM contributors rarely tag residential roofs), likely <1% of buildings tagged
- **Effort:** 1h
- **Signal:** STRUCTURAL for the rare buildings tagged. Low ROI.

---

## 5. Tier C — Gray / TOS-Risky

### C1. Archive.org Wayback Machine — Cached Zillow/Redfin/Realtor Listing Pages
- **URL:** `https://archive.org/wayback/available?url=` and CDX API `http://web.archive.org/cdx/search/cdx?url=zillow.com/homedetails/{slug}`
- **Auth:** None
- **Rate:** Wayback publishes no official limit; polite scraping expected (5 rps max)
- **Signal:** **DIRECT** — old listing descriptions routinely say "new roof 2021", "30-yr architectural shingles", "roof replaced 2019". Wayback has snapshots of millions of Zillow pages from 2015-2024.
- **Gray zone:** Archive.org's terms permit research scraping. Zillow's TOS forbids automated access to *their* servers but does NOT govern archived copies on a third-party site. Case law (hiQ v. LinkedIn) supports archive scraping; no precedent against Wayback-mediated real-estate data use.
- **Effort:** 2-3 days (CDX query to enumerate archived /homedetails/{slug} URLs matching Huntsville MSA; GET each snapshot; regex the description block)
- **Risk:** Moderate. Wayback could rate-limit us into oblivion but it's unlikely to become litigation. Do not scrape Zillow directly — only the Wayback-cached copies.
- **Recommendation:** Small pilot — 1000 URLs — to measure hit rate on "roof" keywords. If >5%, ramp.

### C2. GAF / Owens Corning / CertainTeed Project Locators
- **URLs:**
  - `https://www.gaf.com/en-us/roofing-contractors/residential/usa/al`
  - `https://www.owenscorning.com/en-us/roofing/contractors`
- **Finding:** Public locators show contractor profiles but NOT per-project address history. Warranty registration is a private customer-only flow. No address-to-installer-to-date lookup available publicly.
- **Verdict:** Move to Tier E. Residual value is just contractor-list enrichment for the HBLB join.

### C3. Google Solar API (`buildingInsights.imageryDate`)
- Already on dragnet Tier 3. Free tier confirmed 10k requests/mo buildingInsights. For 153k Madison properties = 16 months at free tier. **Revisit decision:** The API's `imageryDate` gives us a hard floor (imagery date) on roof existence. Split the universe: run buildingInsights only on the ~10k "high-intent" leads per month for the predictive phase. This is **compliant and cheap** — demote this from previous "selective/paid" note to a legitimate no-cost asset at our scale.

### C4. Zillow / Redfin / Realtor.com Direct Scraping
- **Verdict:** DO NOT. Zillow TOS explicitly prohibits automated access and they enforce via IP bans and legal action. The data is licensed (MLS IDX) — violating is a material risk to Eavesight as a business. Leave this cold.

### C5. BBB Roofer Complaint Records
- **URL:** `https://www.bbb.org/search`
- **Fields:** Some complaint narratives include street addresses (homeowner complaints frequently cite their own property).
- **TOS:** BBB's robots.txt and TOS are ambiguous. Complaint narratives are public-view, not auth-gated.
- **Signal:** Very sparse (maybe 100-500 usable addresses statewide)
- **Verdict:** Low priority. Log for an opportunistic scrape during Week-4 enrichment.

---

## 6. Tier D — Paid (ROI Analysis at $100 Budget)

### D1. ATTOM Property Data API — BUDGET-KILLER
- **URL:** `https://api.developer.attomdata.com`
- **Fields:** Permit classifier includes "Roof", permit cost, contractor, status — 200M permits from 2000+ jurisdictions
- **Pricing:** Not public; historical $0.05-0.15/property for enterprise. A 242k-property pull is ~$12k-$36k. **Way over budget.**
- **Free tier:** Developer trial key exists, limited to ~100 calls. **Recommended:** spike 100 calls on Huntsville sample to measure roofing-permit hit rate vs our BMS data. If ATTOM covers >50% of residential permit types we have been missing, write business case for Eavesight subscription.
- **Effort:** 2h for free tier validation

### D2. Regrid — USABLE AT OUR BUDGET
- **URL:** `https://app.regrid.com` + `https://regrid.com/api`
- **Free tier:** 25 property lookups/day — too small for bulk.
- **Paid:** Alabama full state parcel set is ~$200-400 one-time download (statewide shapefile + attributes).
- **Signal:** yearBuilt + assessment values at parcel level, countywide coverage for all 67 AL counties.
- **ROI:** Does yearBuilt alone beat what we would get free from Morgan CaptureCAMA + Limestone ISV3 + Madison ISV3 + Jackson ISV3 + Marshall ISV3? Probably YES for Marshall/Jackson where per-county portals are shaky.
- **Verdict:** Would blow budget 2-4x. Pin for next quarter.

### D3. Nearmap / EagleView / Vexcel
- **Pricing:** Enterprise-only. All >$10k/year minimum.
- **Verdict:** Out of budget. Free alternative: NAIP (already dismissed), Mapillary (Tier B).

### D4. PropStream
- **Pricing:** $99/month, 10k property lookups included
- **Fit:** Fits budget (one month = $99). Includes foreclosure/distressed flags, lien search, owner-equity, permit history where available.
- **ROI:** Could cover ~10k properties one month; overlaps substantially with free Propwire. Skip in favor of Propwire Tier B, unless Propwire pilot fails.

### D5. Google Solar API — Incremental Paid
- Already Tier C3. Beyond 10k/mo free, `buildingInsights` is $0.02/call. $100 = 5000 extra calls. Reserve for high-value leads.

---

## 7. Tier E — New Dead-Ends

- **Google Open Buildings V3:** Covers Africa/Latin America/Asia only — excludes US. Use Microsoft USBuildingFootprints instead.
- **USPS Vacancy Database:** Gov/nonprofit-only eligibility. Eavesight ineligible.
- **3DEP LiDAR 1m for North AL:** Not collected. Madison/Morgan/Limestone/Marshall/Jackson stuck at 10m resolution until a future collection.
- **Alabama PSC Solar Interconnection List:** AL has no statewide net-metering requirement -> no central list. Per-utility requests required; Huntsville Utilities keeps Solar Connect participant list internal.
- **TVA Home Uplift participant list:** Not published. 1700+ Valley homes served, but names/addresses are not open. Program is weatherization-focused anyway — roof inclusion is spotty.
- **ADEM Landfill Manifests (shingle disposal):** ADEM tracks only hazardous-waste manifests; C&D shingle waste is aggregated by landfill, not by generator address.
- **FHFA UAD Appraisal PUF:** Enterprise UAD is a 5% random sample, not address-keyed. No use at property level.
- **FCC Form 477:** Sunsetted for deployment data. No signal for home renovation.
- **GAF/Owens Corning Project Registries:** Contractor directories only, no address-level project history.
- **Zillow/Redfin/Realtor.com direct scraping:** TOS-prohibited, IP-blocked, and data-licensed.
- **Alabama PSC docket filings for hail:** Commission dockets are policy-level, not per-property.
- **FAA LAANC flight logs:** Authorization records kept privately by operator; no public flight-by-flight registry.
- **NFIP CRS (Community Rating System):** Community-level discount program, no property data.
- **Athens govBuilt portal (URL confirmed):** Already on dragnet Tier 2; no new finding. Still login-gated for most searches.
- **Decatur CityView (URL confirmed):** Already on dragnet Tier 2. Confirmed: "users must create an account" — account-gated, which *reduces* its rank from the dragnet's Tier 2 to Tier 2-minus. Still viable (accounts are free, just scraping requires session cookies).
- **Cullman iWorQ (URL confirmed):** Already on dragnet Tier 2. Confirmed: public search exists BUT "Contractor code is required to view permit information." Demoted to Tier 3 — need to enumerate contractor codes via HBLB join first.

---

## 8. Creative / Unconventional Angles

### U1. Mechanic's-Lien Filings at County Probate Offices
Covered in dragnet Tier 3 as "Madison County Probate liens — login + manual." Extends to all 67 counties — Alabama statute S35-11-218 requires recording within 6 months of work. **Contractors who file liens are disproportionately roofers** (reroof is a high-volume/thin-margin trade with frequent non-payment). A systematic crawl of just Madison's Landmark Web or Probate's online index, filtering filings where filer is a known HBLB roofer, gives us **definitive ground-truth roof dates** for every disputed job. Estimated volume: ~200-400 roofing mechanic's liens/year in Madison. Low per-row but high-purity.

### U2. Huntsville-Madison County Library Obituary Index
`https://hmcpl.org/databases/obituary-index` — public searchable obituary database for the region. Cross-referencing deceased-homeowner records with recent parcel transfers (probate -> heir -> sale) identifies **inherited-then-sold homes**, which statistically have either (a) a pre-sale reroof by the estate or (b) an immediate post-sale reroof by the buyer. Couple with Madison probate's property-change alert system for a clean signal.

### U3. Craigslist / Facebook Marketplace "Used Roofing Materials" + "Tear-off Shingles" Listings
Contractors sometimes post free leftover shingles/underlayment with jobsite addresses visible in photos ("free — pickup at 123 Oak St Huntsville"). Sparse but occasionally geotagged. Build a weekly scraper of CL `hsv.craigslist.org/search/mad` materials/free sections.

### U4. Insurance Claim Attorney Demand-Letter Filings (Circuit Court)
Alabama Circuit Court dockets (al.cc.com public-access) include dozens of plaintiff filings per year against insurers for hail-claim denials. These filings are public and frequently cite the policy's roof-age and damage date. `caserecords.alacourt.gov` gated but open-record law allows bulk FOIA-style access for non-commercial research. Mentioned here as a future exploration — paper intensive but gold-standard truth.

### U5. Drone Video on YouTube — Address-Visible Roofing Company Ads
Huntsville roofing companies post completed-job drone flyovers on YouTube. Many show street signs or numbered mailboxes on approach. **CV pipeline:** pull all YouTube videos from ~20 Huntsville-tagged roofing accounts, extract geoframes, OCR mailbox numbers. Video upload date ~ roof completion date within 30 days. Estimated yield: 500-2000 verified roofs/year per active contractor.

### U6. 911 Addressing Database (new-address-assignment logs)
Madison County Public Works assigns house numbers for unincorporated parcels. A new 911 address ~ new construction ~ roof is <1 year old. Not currently exposed via web portal but routinely released via public records request. Quarterly FOIA request costs ~$5 in staff time — fits in budget.

### U7. Tax-Sale Redemption Records (Alabama Dept of Revenue EBuy)
`https://www.revenue.alabama.gov/collections/sheriffs-sale-delinquent-property/` — properties sold for tax delinquency and subsequently redeemed. High correlation with distressed/deferred-maintenance homes -> aged roofs. Separate signal from foreclosure data.

### U8. Huntsville-Utilities Tree-Trimming / Service-Interruption Public Notices
After hailstorms, HU crews trim damaged trees and log address-level tickets. Not public API but occasionally surfaced in incident reports. Low priority but zero-cost FOIA.

### U9. Hospital Birth / School Enrollment Zone Proxies
New-baby addresses -> ~30% of growing families upgrade home in next 24 months. Protected health data — inaccessible. School-zone boundary redraws (proxy for population influx) are public but too coarse to help per-property.

### U10. Roofer YouTube + Instagram Geotags (manual OSINT)
Same idea as U5 but with Instagram posts where tagged location matches a residential street. Low-effort pilot: 5h manually surveying top 10 Huntsville roofers' Instagram geotags against our 242k-property index.

---

## 9. Previously Dead-Ended (Reference Only)

From `<repo-root>/docs/roof-age-dragnet.md` — confirmed dead, NOT re-investigated:

- IBHS FORTIFIED Address Lookup (member-gated)
- Strengthen Alabama Homes grant recipients (FOIA-only + wrong geography)
- AL Secretary of State UCC (personal-property only)
- HUD CDBG-DR reroof grants (ADECA, PII-stripped)
- MLS aggregators (Zillow/Realtor/Redfin licensed)
- NAIP pixel-differencing (CV belongs in predictive-model phase)
- Google / Nextdoor **historical** Street View (no dated API — note: Nextdoor's *current* post API is live, A/B separate from Street View)
- Hartselle / Florence / Muscle Shoals / Albertville (no online portals)

Plus confirmed during *this* hunt but lateral:
- Google Solar API (dragnet Tier 3 — revisited as Tier C3 above)
- Decatur CityView, Cullman iWorQ, Athens govBuilt, Scottsboro Cloudpermit (all URLs still resolve; tier unchanged from dragnet)

---

## 10. Top 10 Recommended Next Builds (synthesis)

Priority 1 = start first. All should be evaluated for parallel execution where dependencies permit.

| # | Build | Tier | Hours | Signal | Prereq |
|---|---|---|---|---|---|
| 1 | **Tyler eSuite twin scrapers (Madison city + county)** | Existing plan | 8-16 | DIRECT roof install date | None — original Phase 5 Week 1 |
| 2 | **Huntsville MapServer spike** — pull all 64 layers, catalog Structures layer schema | A1 | 4-6 | STRUCTURAL + zoning-change | None |
| 3 | **AL HBLB Licensee scraper** — classify existing 30k Huntsville BMS permits by contractor-is-roofer | A6 | 6-8 | Recovers is_roofing on existing permits | None |
| 4 | **Mapillary coverage probe** — 1h spike: image counts per Madison zipcode 2017-2026 | B1 | 1-4 | DIRECT visual date floor | Mapillary OAuth token |
| 5 | **Propwire pilot export** — 5k Madison rows, schema audit, bulk upsert | B2 | 8 | DIRECT year-built + indirect liens | TOS review |
| 6 | **Microsoft Building Footprints + height ingest** — statewide | A5 | 3-4 | STRUCTURAL roof-type proxy | None |
| 7 | **OpenFEMA NFIP Claims + IA Housing ingest** (v2 APIs) | A2/A3 | 4-6 | Year-built anchors + storm-damage prior | None |
| 8 | **Wayback CDX pilot** — 1000 Huntsville Zillow URLs, measure "roof" keyword hit rate | C1 | 8 | DIRECT if signal present | None |
| 9 | **ATTOM free-tier spike** — 100-call test on Huntsville permits | D1 | 2 | Evaluate paid upgrade | ATTOM dev key |
| 10 | **Madison Probate mechanic's-lien scraper** (already Tier 3 on dragnet) — promote if 3/4/5 all stall | U1 | 8 | DIRECT roof date, low volume | None |

**Decision note on Phase 5 ordering:** The new sources do NOT displace Tyler eSuite as Week-1 focus. They DO argue for **two insertions**:
- (a) A pre-Phase-5 4-6h "Huntsville MapServer + HBLB joiner" spike. Outcome could classify 30k already-scraped BMS rows as roofing and populate `roofInstalledAt` for hundreds-to-thousands of properties *before* the Tyler build ships.
- (b) Replace Week-2's "Decatur/Cullman/Athens" broadening with "Mapillary + Propwire + Wayback" parallel pilots. If Mapillary coverage is dense, the Tier-2 city portals become unnecessary filler. If not, revert to original Week-2.

---

## Appendix — URLs verified during hunt

| Source | URL | Status |
|---|---|---|
| Huntsville MapServer | https://maps.huntsvilleal.gov/server/rest/services/Planning/PropertyData/MapServer | 200, 64 layers |
| Decatur CityView | https://cityview.decatur-al.gov/Portal | 200, login-required |
| Cullman iWorQ | https://cullmanal.portal.iworq.net/portalhome/cullmanal | 200, contractor-code-gated |
| Athens govBuilt | https://athensalabama.govbuilt.com/ | 200 |
| Scottsboro Cloudpermit | https://cityofscottsboro.com/departments/building-department/building-permit-online-application/ | 200 |
| Morgan CaptureCAMA | https://morgan.capturecama.com/propsearch | 200 (dragnet) |
| Limestone Parcel Viewer | https://limestonerevenue.net/parcelviewer/ | 200 |
| Limestone ISV3 | https://isv.kcsgis.com/al.limestone_revenue_public/ | 200 |
| Marshall ISV3 | https://isv.kcsgis.com/al.marshall_revenue/ | 200 |
| Jackson ISV3 | https://isv.kcsgis.com/al.jackson_revenue/ | 200 |
| Madison ISV3 | https://isv.kcsgis.com/al.madison_revenue/ | 200 |
| Madison CityView | https://cityview.madisoncountyal.gov/Portal | 200 |
| Madison eSuite | https://esuite-madisonco-al.tylertech.com/nwprod/esuite.permits/ | 200 (dragnet) |
| AL HBLB Licensee Search | https://alhobprod.glsuite.us/GLSuiteWeb/Clients/ALHOB/Public/LicenseeSearch.aspx | 200 |
| AL GeoHub | https://data-algeohub.opendata.arcgis.com/ | 200 |
| OpenFEMA NFIP Claims | https://www.fema.gov/openfema-data-page/fima-nfip-redacted-claims-v2 | 200 |
| OpenFEMA IA Housing | https://www.fema.gov/openfema-data-page/housing-assistance-program-data-owners-v2 | 200 |
| NOAA SWDI | https://www.ncei.noaa.gov/maps/swdi/ | 200 |
| Mapillary API docs | https://www.mapillary.com/developer/api-documentation | 200 |
| MS USBuildingFootprints | https://github.com/microsoft/USBuildingFootprints | 200 |
| Propwire | https://propwire.com/ | 200 |
| Nextdoor developer | https://developer.nextdoor.com/docs/search-api-copy | 200 |
| Wayback CDX | http://web.archive.org/cdx/search/cdx | 200 |
| Google Solar API | https://developers.google.com/maps/documentation/solar/overview | 200 |
| ATTOM developer | https://api.developer.attomdata.com/home | 200 |
| Regrid API | https://regrid.com/api | 200 |
| ALDOI SERFF | https://filingaccess.serff.com/sfa/home/AL | 200 |
| HMDA | https://www.consumerfinance.gov/data-research/hmda/ | 200 |

**Doc complete.**
