#!/usr/bin/env node
/**
 * permits-madison-county.js  (2026-04-29)
 *
 * Madison County, AL — Tyler Technologies eSuite ASP.NET WebForms portal
 * (Tyler-hosted multi-tenant; same template as Madison-City but separate dataset):
 *   https://esuite-madisonco-al.tylertech.com/nwprod/esuite.permits/AdvancedSearchPage/AdvancedSearch.aspx
 *
 * Permit types here differ from Madison-City:
 *   33 = ROOFING RESIDENTIAL
 *   34 = ROOFING COMMERCIAL
 *
 * Otherwise pipeline is identical to Madison-City:
 *   GET form → POST with ddlPermitType → parse table-data result rows →
 *   walk pagination via pagingRepeater$Articles{N}/lnkMore (POST to ?page=N+1) →
 *   fetch ContractorPermitDetails.aspx?id=NNNN per row → upsertPermit +
 *   emitSignal('reroof_permit', confidence=0.95, source='permit.madison-county').
 *
 * Idempotent re-runs via building_permits unique (source, permit_number) and
 * property_signals unique (propertyId, signalType, source, sourceRecordId).
 *
 * Usage:
 *   node scripts/permits-madison-county.js                  # dry-run, both types
 *   node scripts/permits-madison-county.js --commit
 *   node scripts/permits-madison-county.js --commit --types=33
 *   node scripts/permits-madison-county.js --commit --max-pages=5
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { fetchText, parseArgs, makeLogger, makePool, upsertPermit } = require('./permit-common');
const { emitSignal, resolvePropertyId } = require('./lib/property-signal-emit');

/**
 * Madison-City-specific property resolver. The shared resolvePropertyId() is
 * too strict here because Madison-City permit addresses arrive in a different
 * shape than properties.address (uppercase, abbreviated, w/ city/state/zip)
 * and many house-number+street-word patterns produce >1 match across N-AL
 * (e.g. "117 BRIDGE" hits 11 properties). Strategy:
 *
 *   1. Prefer parcelId match (when scraper got one)
 *   2. Filter candidates by zip if known — drops most cross-metro collisions
 *   3. Try ILIKE with house# + first 2 street words ("117%BRIDGE%HOUSE%")
 *   4. Fall back to house# + first street word
 *   5. Return single match only — refuse ambiguous attribution
 */
async function resolveMadisonProperty({ pool, address, addr, parcelId }) {
  // 1) parcelId path — Madison-City parcel IDs are internal, but scrapers may pass through
  if (parcelId) {
    const r = await pool.query(`SELECT id FROM properties WHERE "parcelId" = $1 LIMIT 1`, [parcelId]);
    if (r.rows[0]?.id) return { id: r.rows[0].id, confidence: 0.99, match: 'parcelId' };
  }
  if (!address || !addr) return null;

  const houseNum = (address.match(/^\s*(\d+)/) || [])[1];
  if (!houseNum) return null;
  const tokens = address.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  const streetWords = [];
  for (let i = 1; i < tokens.length && streetWords.length < 3; i++) {
    const t = tokens[i];
    if (/^[A-Za-z]{3,}$/.test(t) && !/^(MADISON|AL|ALABAMA|BLDG)$/i.test(t)) {
      streetWords.push(t.toUpperCase());
    }
  }
  if (streetWords.length === 0) return null;

  const zip = addr.zip || null;

  // 2) ILIKE with as many street words as we have. Try most-specific (2 words)
  //    first — that's typically unique enough to land on a single property.
  //    Fall back to 1 word, optionally narrowed by zip when multiple match.
  //    NOTE: properties.zip is sometimes wrong (e.g. Madison-City addresses
  //    are tagged Huntsville zip 35801 in our DB), so we treat zip as a
  //    TIEBREAKER, not a filter.
  for (let n = Math.min(streetWords.length, 2); n >= 1; n--) {
    const pattern = `${houseNum}%${streetWords.slice(0, n).join('%')}%`;
    const r = await pool.query(`SELECT id, zip FROM properties WHERE address ILIKE $1 LIMIT 5`, [pattern]);
    if (r.rows.length === 1) {
      return { id: r.rows[0].id, confidence: n >= 2 ? 0.85 : 0.75, match: `address-ilike-${n}word` };
    }
    if (r.rows.length > 1 && zip) {
      const zipMatches = r.rows.filter((row) => row.zip === zip);
      if (zipMatches.length === 1) {
        return { id: zipMatches[0].id, confidence: 0.80, match: `address-ilike-${n}word+zip` };
      }
    }
  }

  // 3) As a last resort, fall back to the shared resolver (uses house# +
  //    first significant street word + LIMIT 2 single-match policy).
  return resolvePropertyId({ pool, address });
}

const SOURCE = 'permit.madison-county';
const BASE = 'https://esuite-madisonco-al.tylertech.com/nwprod';
const SEARCH_URL = `${BASE}/esuite.permits/AdvancedSearchPage/AdvancedSearch.aspx`;
const DETAIL_URL = (id) => `${BASE}/esuite.permits/ContractorPermitDetailsPage/ContractorPermitDetails.aspx?id=${id}`;
const PACE_MS = 700;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Eavesight-Permits/1.0 (admin@eavesight.io)';

// Permit type IDs — confirmed from Madison-County portal HTML 2026-04-29.
// (Different from Madison-City which uses 31/32.)
const TYPE_COMMERCIAL_ROOFING = 34;
const TYPE_RESIDENTIAL_ROOFING = 33;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#13;/g, '')
    .replace(/&#10;/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Cookie jar: ASP.NET session cookies persist across the session.
const cookieJar = {};
function applySetCookie(headers) {
  const sc = headers && headers['set-cookie'];
  if (!sc) return;
  for (const line of Array.isArray(sc) ? sc : [sc]) {
    const m = String(line).match(/^([^=]+)=([^;]*)/);
    if (m) cookieJar[m[1]] = m[2];
  }
}
function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOpts = {
      method: opts.method || 'GET',
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      timeout: 30000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
        ...(opts.headers || {}),
      },
    };
    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        applySetCookie(res.headers);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout ${url}`)));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function extractViewState(html) {
  const get = (name) => {
    const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`);
    const m = html.match(re);
    return m ? m[1] : '';
  };
  return {
    __VIEWSTATE: get('__VIEWSTATE'),
    __VIEWSTATEGENERATOR: get('__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: get('__EVENTVALIDATION'),
    __PREVIOUSPAGE: get('__PREVIOUSPAGE'),
  };
}

function buildFormBody(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : v)}`)
    .join('&');
}

function parseAddress(raw) {
  // Result rows look like "1234 SOMETHING DR HUNTSVILLE, AL 35803" or
  // "21 ABC RD MADISON, AL 35758" — county jurisdictions span many cities.
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?)\s+([A-Z][A-Z\s]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);
  if (m) {
    return { street: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] };
  }
  const zip = s.match(/(\d{5})(?:-\d{4})?\b/);
  return { street: s, city: null, state: 'AL', zip: zip ? zip[1] : null };
}

function parseResultRows(html) {
  // Result table: 4 columns. Permit number is inside an <a> within the first <td>.
  // Address is the 4th column.
  // The form's "searchTable" closes before results render — results live in a
  // separate `<table class="table-data">` further down the page.
  const out = [];
  const tableMatch = html.match(/<table[^>]*class="[^"]*table-data[^"]*"[\s\S]*?<\/table>/i);
  if (!tableMatch) return out;
  const tbl = tableMatch[0];
  const rowRe = /<tr class="(?:even|odd)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(tbl))) {
    const rowHtml = m[1];
    const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((t) => t[1]);
    if (tds.length < 4) continue;

    // Cell 0: contains permit_number link + type
    const linkMatch = tds[0].match(/href="[^"]*ContractorPermitDetails\.aspx\?id=(\d+)"[^>]*>\s*([^<]+?)\s*</);
    if (!linkMatch) continue;
    const detailId = linkMatch[1];
    const permitNumber = decodeHtml(linkMatch[2]).trim();
    if (!permitNumber) continue;

    // Type is the first visible div in cell 0 (before the link)
    const typeMatch = tds[0].match(/<div[^>]*visibility:visible[^>]*>\s*([A-Z][A-Z\s/]+)\s*</);
    const permitType = typeMatch ? decodeHtml(typeMatch[1]).trim() : null;

    // Cell 2: status (some markup)
    const status = decodeHtml(tds[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

    // Cell 3: address
    const address = decodeHtml(tds[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

    out.push({ detailId, permitNumber, permitType, status, address });
  }
  return out;
}

function getLabelValue(html, labelId) {
  const re = new RegExp(`<span id="ctl00_ctl00_Content_DefaultContent_${labelId}"[^>]*>([\\s\\S]*?)</span>`);
  const m = html.match(re);
  if (!m) return null;
  return decodeHtml(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function parseDetail(html) {
  // Status looks like "Permit Completed on 09/06/2012" or "Permit In Process"
  const status = getLabelValue(html, 'lblStatusValue') || '';
  const completedMatch = status.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const completedAt = completedMatch ? `${completedMatch[3]}-${completedMatch[1]}-${completedMatch[2]}` : null;

  const paidStr = getLabelValue(html, 'lblPaidValue') || '';
  const paidMatch = paidStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const paidAt = paidMatch ? `${paidMatch[3]}-${paidMatch[1]}-${paidMatch[2]}` : null;

  const valuationStr = getLabelValue(html, 'lblEstimatedImprovementValueValue') || '';
  const valuationMatch = valuationStr.match(/[\d.,]+/);
  const valuation = valuationMatch ? Number(valuationMatch[0].replace(/,/g, '')) : null;

  return {
    permit_type: getLabelValue(html, 'lblPermitTypeValue'),
    permit_number: getLabelValue(html, 'lblPermitNumberValue'),
    application_number: getLabelValue(html, 'lblApplicationNumberValue'),
    status,
    issued_to: getLabelValue(html, 'lblIssuedToValue'),
    primary_owner: getLabelValue(html, 'lblPrimaryOwnerValue'),
    parcel_id: getLabelValue(html, 'lblParcelIdValue'),
    description: getLabelValue(html, 'lblDescriptionValue') || getLabelValue(html, 'lblLocationDescription'),
    valuation,
    valuation_raw: valuationStr,
    expiration: getLabelValue(html, 'lblExpirationDate'),
    contractor: getLabelValue(html, 'lblOtherParty'),
    completed_at: completedAt,
    paid_at: paidAt,
    // The "issued at" we use is the BEST-AVAILABLE date for the permit, in
    // priority order: completed date (most reliable; signals work was finished),
    // paid date (signals permit was issued), expiration (rough fallback).
    issued_at: completedAt || paidAt || null,
  };
}

async function fetchSearchPage(state, type, log, permitNumberPrefix = '') {
  // The page-size dropdown isn't part of the EVENTVALIDATION whitelist on the
  // initial GET — including it here causes a server-side validation failure.
  // Set page size via postback AFTER the initial search instead.
  //
  // Tyler eSuite caps unfiltered result lists at 100 rows. Pass a permit-number
  // prefix (e.g. "0524" for Madison-County 2024 permits) to narrow the query.
  const fields = {
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __VIEWSTATE: state.__VIEWSTATE,
    __VIEWSTATEGENERATOR: state.__VIEWSTATEGENERATOR,
    __EVENTVALIDATION: state.__EVENTVALIDATION,
    'ctl00$ctl00$Content$DefaultContent$txtPermitNumber': permitNumberPrefix,
    'ctl00$ctl00$Content$DefaultContent$ddlPermitType': String(type),
    'ctl00$ctl00$Content$DefaultContent$txtServiceAddress': '',
    'ctl00$ctl00$Content$DefaultContent$btnSearch': 'Search',
  };
  const r = await httpRequest(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: SEARCH_URL },
    body: buildFormBody(fields),
  });
  if (r.status >= 400) throw new Error(`Search POST ${r.status} for type=${type}`);
  return r.body;
}

async function setPageSize(state, pageSize, log) {
  // Postback on ddlNoOFRows to change page size — keeps current search state.
  const fields = {
    __EVENTTARGET: 'ctl00$ctl00$Content$DefaultContent$ddlNoOFRows',
    __EVENTARGUMENT: '',
    __VIEWSTATE: state.__VIEWSTATE,
    __VIEWSTATEGENERATOR: state.__VIEWSTATEGENERATOR,
    __EVENTVALIDATION: state.__EVENTVALIDATION,
    'ctl00$ctl00$Content$DefaultContent$txtPermitNumber': '',
    'ctl00$ctl00$Content$DefaultContent$ddlPermitType': '',
    'ctl00$ctl00$Content$DefaultContent$txtServiceAddress': '',
    'ctl00$ctl00$Content$DefaultContent$ddlNoOFRows': pageSize,
  };
  const r = await httpRequest(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: SEARCH_URL },
    body: buildFormBody(fields),
  });
  if (r.status >= 400) throw new Error(`Page-size postback ${r.status}`);
  return r.body;
}

async function fetchPaginatedPage(state, pageIndex, log) {
  // pageIndex is 0-based on the "Articles{n}" anchor; first 10 pages are direct links,
  // beyond that we'd need the lnkMore button. For now we just walk Articles0..ArticlesN.
  const target = `ctl00$ctl00$Content$DefaultContent$pagingRepeater$Articles${pageIndex}`;
  const fields = {
    __EVENTTARGET: target,
    __EVENTARGUMENT: '',
    __VIEWSTATE: state.__VIEWSTATE,
    __VIEWSTATEGENERATOR: state.__VIEWSTATEGENERATOR,
    __EVENTVALIDATION: state.__EVENTVALIDATION,
    'ctl00$ctl00$Content$DefaultContent$txtPermitNumber': '',
    'ctl00$ctl00$Content$DefaultContent$ddlPermitType': '',
    'ctl00$ctl00$Content$DefaultContent$txtServiceAddress': '',
  };
  const r = await httpRequest(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: SEARCH_URL },
    body: buildFormBody(fields),
  });
  if (r.status >= 400) throw new Error(`Pagination POST ${r.status} page=${pageIndex}`);
  return r.body;
}

async function fetchPermitDetail(detailId) {
  const r = await httpRequest(DETAIL_URL(detailId));
  if (r.status >= 400) throw new Error(`Detail ${r.status} id=${detailId}`);
  return r.body;
}

async function harvestType(type, args, log) {
  log(`--- type=${type} (${type === TYPE_COMMERCIAL_ROOFING ? 'commercial' : 'residential'} roofing) ---`);

  const pageSize = args.pageSize || '50';

  // 1) GET form
  const formGet = await httpRequest(SEARCH_URL);
  if (formGet.status >= 400) throw new Error(`Initial GET ${formGet.status}`);
  let state = extractViewState(formGet.body);
  if (!state.__VIEWSTATE) throw new Error('VIEWSTATE not found on initial GET');

  // 2) POST initial search (default page size — Tyler eSuite serves 10 rows
  //    per page; the ddlNoOFRows postback resets the filter on the server side
  //    so we accept the smaller pages and walk pagination instead).
  await sleep(PACE_MS);
  let html = await fetchSearchPage(state, type, log);
  state = extractViewState(html);
  let rows = parseResultRows(html);
  log(`page=1 rows=${rows.length}`);
  if (process.env.DEBUG_DUMP === '1' && rows.length === 0) {
    const dumpPath = `/tmp/madison-city-debug-type${type}.html`;
    fs.writeFileSync(dumpPath, html);
    log(`DEBUG: dumped ${html.length} bytes to ${dumpPath}`);
  }

  // Total reported by the portal — useful for sanity / progress
  const foundMatch = html.match(/lblPermitsFoundValue[^>]*>([\d,]+)</);
  const totalReported = foundMatch ? Number(foundMatch[1].replace(/,/g, '')) : null;
  if (totalReported != null) log(`portal reports total=${totalReported}`);

  // 3) Walk pagination (Articles0..Articles9 covers 10 server pages; lnkMore beyond that)
  const allRows = [...rows];
  const seenPermitNumbers = new Set(rows.map((r) => r.permitNumber));
  // Use observed first-page size (Tyler default is 10; postback to enlarge it
  // server-side resets the search filter, so we accept page size 10).
  const expectedPerPage = rows.length;
  let pageIdx = 1;
  let usedLnkMore = 0;
  while (pageIdx < (args.maxPages || 200)) {
    // If a page returned fewer rows than the per-page setting, it's the tail — stop.
    if (rows.length < expectedPerPage) break;
    let target;
    let postUrl = SEARCH_URL;
    if (html.includes(`pagingRepeater_Articles${pageIdx}`)) {
      target = `ctl00$ctl00$Content$DefaultContent$pagingRepeater$Articles${pageIdx}`;
      // The __doPostBackWithOptions for paging anchors changes the form action
      // to `AdvancedSearch.aspx?page=N+1` — replicate that or the server
      // treats the postback as a fresh form load.
      postUrl = `${SEARCH_URL}?page=${pageIdx + 1}`;
    } else if (html.includes('pagingRepeater_lnkMore')) {
      target = 'ctl00$ctl00$Content$DefaultContent$pagingRepeater$lnkMore';
      postUrl = `${SEARCH_URL}?action=next`;
      usedLnkMore++;
    } else {
      break;
    }
    await sleep(PACE_MS);
    try {
      // Re-send the active filter AND the post-search cross-page state
      // (__PREVIOUSPAGE + watermark client state) so the postback target
      // arrives in a fully-rehydrated form context. Drop any of these and
      // ASP.NET treats the postback as a fresh blank search.
      const fields = {
        __EVENTTARGET: target,
        __EVENTARGUMENT: '',
        __VIEWSTATE: state.__VIEWSTATE,
        __VIEWSTATEGENERATOR: state.__VIEWSTATEGENERATOR,
        __EVENTVALIDATION: state.__EVENTVALIDATION,
        __PREVIOUSPAGE: state.__PREVIOUSPAGE || '',
        'ctl00$ctl00$Content$DefaultContent$txtPermitNumber': '',
        'ctl00$ctl00$Content$DefaultContent$ddlPermitType': String(type),
        'ctl00$ctl00$Content$DefaultContent$txtServiceAddress': '',
        'ctl00$ctl00$Content$DefaultContent$txtServiceAddress_TextBoxWatermarkExtender_ClientState': '',
        'ctl00$ctl00$Content$DefaultContent$ddlNoOFRows': '10',
      };
      const r = await httpRequest(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: SEARCH_URL },
        body: buildFormBody(fields),
      });
      if (r.status >= 400) throw new Error(`pagination POST ${r.status}`);
      html = r.body;
    } catch (e) {
      log(`pagination failed at idx=${pageIdx}: ${e.message}`);
      break;
    }
    state = extractViewState(html);
    rows = parseResultRows(html);
    let added = 0;
    for (const r of rows) {
      if (!seenPermitNumbers.has(r.permitNumber)) {
        seenPermitNumbers.add(r.permitNumber);
        allRows.push(r);
        added++;
      }
    }
    log(`page=${pageIdx + 1} rows=${rows.length} new=${added} cumulative=${allRows.length}${totalReported ? '/' + totalReported : ''} (target=${target.endsWith('lnkMore') ? 'next' : 'idx' + pageIdx})`);
    if (process.env.DEBUG_DUMP === '1' && added === 0) {
      const dumpPath = `/tmp/madison-city-debug-page${pageIdx + 1}.html`;
      fs.writeFileSync(dumpPath, html);
      log(`DEBUG: dumped page ${pageIdx + 1} response to ${dumpPath}`);
    }
    if (added === 0) {
      log(`no new rows at page=${pageIdx + 1} — stopping (likely end of repeater window)`);
      break;
    }
    pageIdx++;
  }

  log(`type=${type} total unique rows=${allRows.length} (portalReported=${totalReported ?? 'n/a'}, lnkMoreClicks=${usedLnkMore})`);
  return allRows;
}

async function main() {
  const argvRaw = process.argv.slice(2);
  const args = parseArgs(argvRaw);
  const typesArg = argvRaw.find((a) => a.startsWith('--types='));
  const skipDetails = argvRaw.includes('--skip-details');
  const maxPagesArg = argvRaw.find((a) => a.startsWith('--max-pages='));
  args.maxPages = maxPagesArg ? Number(maxPagesArg.slice(12)) : 50;
  const types = typesArg
    ? typesArg.slice('--types='.length).split(',').map(Number).filter(Boolean)
    : [TYPE_COMMERCIAL_ROOFING, TYPE_RESIDENTIAL_ROOFING];

  const logFile = args.log || path.join(__dirname, '..', 'logs', 'permits-madison-county.log');
  const log = makeLogger(logFile);
  log(`Starting Madison-County permit harvest (dryRun=${args.dryRun}, types=${types.join(',')}, skipDetails=${skipDetails}, maxPages=${args.maxPages})`);

  const pool = args.dryRun ? null : makePool();
  let totalRows = 0, totalUpserts = 0, totalSignals = 0, totalSignalsInserted = 0;
  let totalUnmatched = 0, totalDetailFailures = 0;

  try {
    for (const type of types) {
      let rows;
      try {
        rows = await harvestType(type, args, log);
      } catch (e) {
        log(`harvestType(${type}) FAILED: ${e.message}`);
        continue;
      }
      totalRows += rows.length;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let detail = null;
        if (!skipDetails) {
          try {
            await sleep(PACE_MS);
            const detailHtml = await fetchPermitDetail(r.detailId);
            detail = parseDetail(detailHtml);
          } catch (e) {
            totalDetailFailures++;
            log(`detail fetch failed id=${r.detailId} permit=${r.permitNumber}: ${e.message}`);
          }
        }

        const addr = parseAddress(r.address);
        const permitNumber = (detail && detail.permit_number) || r.permitNumber;
        const permitType = (detail && detail.permit_type) || r.permitType || '';
        const description = detail && detail.description ? detail.description : '';
        const status = (detail && detail.status) || r.status;
        const issuedAt = detail && detail.issued_at ? new Date(detail.issued_at) : null;
        const finaledAt = detail && detail.completed_at ? new Date(detail.completed_at) : null;

        const permit = {
          source: SOURCE,
          permit_number: permitNumber,
          permit_type: permitType,
          description,
          status,
          issued_at: issuedAt,
          finaled_at: finaledAt,
          address: r.address,
          city: addr.city || 'Madison',
          zip: addr.zip,
          parcel_id: detail && detail.parcel_id ? `madison-city:${detail.parcel_id}` : null,
          contractor: (detail && detail.contractor) || null,
          valuation: detail ? detail.valuation : null,
          lat: null,
          lon: null,
          raw: { detailId: r.detailId, type, ...(detail || {}), addressParsed: addr },
        };

        if (args.dryRun) {
          log(`PLAN: ${permitNumber} | ${permitType} | ${r.address} | issued=${issuedAt ? issuedAt.toISOString().slice(0,10) : '?'} | val=${permit.valuation} | contractor=${permit.contractor}`);
          continue;
        }

        // Upsert raw permit row
        const up = await upsertPermit(pool, permit, false);
        if (up.inserted) totalUpserts++;

        // Resolve property + emit reroof_permit signal at confidence 0.95
        if (up.is_roofing && permit.address) {
          const fullAddr = addr.street ? `${addr.street}, ${addr.city || ''}, AL ${addr.zip || ''}`.trim() : permit.address;
          const match = await resolveMadisonProperty({ pool, address: fullAddr, addr, parcelId: null });
          if (match) {
            const sig = await emitSignal({
              pool,
              propertyId: match.id,
              signalType: 'reroof_permit',
              signalValue: {
                permitNumber,
                permitType,
                description,
                status,
                contractor: permit.contractor,
                valuation: permit.valuation,
                source: SOURCE,
              },
              signalDate: issuedAt || finaledAt || null,
              confidence: 0.95,
              source: SOURCE,
              sourceRecordId: `madison-city:${permitNumber}`,
            });
            totalSignals++;
            if (sig.inserted) totalSignalsInserted++;
          } else {
            totalUnmatched++;
          }
        }
      }
    }
  } finally {
    if (pool) await pool.end();
  }

  log(`done. rows=${totalRows} upserts=${totalUpserts} signalsAttempted=${totalSignals} signalsNew=${totalSignalsInserted} unmatched=${totalUnmatched} detailFailures=${totalDetailFailures}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
