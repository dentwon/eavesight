# Huntsville GovBuilt scrape — handoff for Claude Desktop browser extension

## Why this is the prize

Coverage gap analysis (per `docs/OVERNIGHT_2026-04-29.md`):

| Region | Total props | True roof ages | Pct | Gap to Decatur 1.81% |
|---|---|---|---|---|
| Decatur (benchmark) | 30,209 | 548 | 1.81% | — |
| Madison City | 27,973 | 250 | 0.89% | −256 |
| **Huntsville core** | **61,215** | **60** | **0.10%** | **−1,048** |
| Madison County north | 38,087 | 55 | 0.14% | −635 |

Huntsville is **the largest single gap by far** — 61k properties, 0.10% penetration. The public Huntsville ArcGIS endpoint (already scraped, 17,516 rows in `building_permits` source='huntsville') only exposes category labels (`Alteration | Single Family | None`); the actual work-description text isn't published. Roof permits exist there but are indistinguishable from kitchen renovations.

The full-detail data IS at **`huntsvilleal.govbuilt.com`** — same GovBuilt platform Athens uses. Confirmed 403 with Cloudflare "managed challenge" turnstile, 5,543-byte body returns the JS challenge page. CANNOT be scraped from CLI/cURL.

## What needs to happen

1. **Visit the portal in a browser tab** that's already cleared the Cloudflare challenge (the user's logged-in Chrome works).
2. **Walk the Public Search interface** — find the form that lets you filter by case-type (likely "ROOFING RESIDENTIAL" + "ROOFING COMMERCIAL" or similar). The Athens scraper code at `scripts/permits-athens.js` documents the GovBuilt API endpoint:
   ```
   /PublicReport/GetAllContentToolModels  → DataTables JSON
   ```
   Once the browser session has a valid cookie + the case-type GUID is known, this endpoint returns `{recordsTotal, data: [...]}`.
3. **Extract per-permit:**
   - permit number
   - issue date
   - work description (full text)
   - address (street, city, zip)
   - contractor name (if exposed)
   - valuation (if exposed)

## Format the output for Code's loader

Save scraped rows as JSONL to `/tmp/huntsville-govbuilt-permits.jsonl`, one row per permit:

```json
{"permit_number":"BR-2024-001234","permit_type":"ROOFING RESIDENTIAL","issued_at":"2024-04-12","address":"1234 Acme St NW","city":"Huntsville","zip":"35801","contractor":"ACME ROOFING","valuation":12500,"description":"Replace asphalt shingle roof"}
```

Code-side loader can be a quick Node script that reads the JSONL and:
- Inserts to `building_permits` with `source='huntsville-govbuilt'`
- Calls `resolvePropertyId` (lat/lon if you have it from geocoding, else address-ILIKE)
- Emits `reroof_permit` signal at confidence 0.95

The Census Batch Geocoder pipeline (`scripts/geocode-and-resolve-permits.js`) is already built and works for permits without lat/lon — just point it at `source='huntsville-govbuilt'` after the JSONL lands.

## Estimated yield

- Huntsville issues ~5,000-10,000 building permits per year
- Roughly 10-15% are roofing-trade (rest are alterations / additions / new construction)
- = **3,000-8,000 roof permits over 5-7 year history**
- That alone closes the entire Huntsville core gap (1,048 needed) and meaningfully improves the regional ground-truth distribution

## Same pattern, smaller scale

| Portal | URL | Estimated yield | Cloudflare? |
|---|---|---|---|
| Huntsville GovBuilt | huntsvilleal.govbuilt.com | 3,000-8,000 | Yes |
| Athens GovBuilt | athensalabama.govbuilt.com | 200-500 | Yes |
| Hartselle GovBuilt | hartselleal.govbuilt.com | 100-300 | Yes (newly found) |
| Cullman iWorQ | cullmanal.portal.iworq.net/CULLMANAL/permits/600 | 200-500 | reCAPTCHA |
| Scottsboro Cloudpermit | us.cloudpermit.com (territory=scottsboro) | unknown | Login wall |

Athens is similar in shape to Huntsville (same GovBuilt template). Cullman + Scottsboro have different gating mechanisms (reCAPTCHA + login respectively).

## Code-side state when this lands

- `building_permits` table is ready (existing schema, idempotent on `(source, permit_number)`)
- `property_signals` table ready (idempotent on `(propertyId, signalType, source, sourceRecordId)`)
- `scripts/geocode-and-resolve-permits.js` already handles Census-batch geocoding + nearest-property match within 66m
- `scripts/compute-roof-age-v2.sql` + `roof_age_v2` materialization already consume `reroof_permit` signals at confidence 0.95
- `scripts/load-prithvi-signals.js` running tomorrow at 17:00 — orthogonal lane

So the pipeline is ready. The only bottleneck is the browser-extension scrape itself.

— Code
