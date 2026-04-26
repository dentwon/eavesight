#!/usr/bin/env node
/**
 * permits-athens.js  (2026-04-25)
 *
 * Athens GovBuilt portal endpoint analysis (probed 2026-04-25):
 *   /                              -> Cloudflare turnstile/managed challenge
 *   /advancedforms                 -> intermittent (sometimes 200, sometimes 403)
 *   /activitysearchtool            -> Cloudflare challenge ~80% of requests
 *   /PublicReport/GetAllContentToolModels  -> open API (DataTables JSON), but
 *       requires session cookies + a populated `type` GUID to return data;
 *       cold GETs return {recordsTotal:0,data:[]}.
 *
 * Since the API requires a session that's only obtainable after passing the
 * Cloudflare JS challenge, this scraper has two modes:
 *  1. Try the open API endpoint (will likely return 0 records cold)
 *  2. Parse cached HTML supplied via --html=PATH for offline ingestion
 *
 * For production yield, this scraper needs a Playwright wrapper that solves
 * the turnstile challenge and forwards cookies + caseType GUIDs to the API.
 * See https://athensalabama.govbuilt.com/PublicReport/Scripts/SearchTool.js
 * for the full request schema.
 *
 * Usage:
 *   node scripts/permits-athens.js                        # probe + dry-run
 *   node scripts/permits-athens.js --type=BUILDING_GUID   # restrict by case type
 *   node scripts/permits-athens.js --html=/tmp/athens.html
 *   node scripts/permits-athens.js --commit
 */
const path = require('path');
const fs = require('fs');
const { fetchText, parseArgs, makeLogger, makePool, upsertPermit, ROOF_RE } = require('./permit-common');

const SOURCE = 'athens';
const BASE = 'https://athensalabama.govbuilt.com';
const API = `${BASE}/PublicReport/GetAllContentToolModels`;

async function fetchPage(start, length, type, log) {
  const params = new URLSearchParams({
    searchText: '',
    filter: '',
    contentType: 'case',
    type: type || '',
    days: 'All',
    subType: '',
    isHideClosedStatus: 'false',
    Start: String(start),
    Length: String(length),
    SortBy: 'Created Date',
    SortType: 'desc',
    draw: String(start),
  });
  const url = `${API}?${params}`;
  try {
    const r = await fetchText(url, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    if (r.status !== 200) {
      log(`  API ${url} -> HTTP ${r.status}`);
      return [];
    }
    if (/Just a moment|cf_chl_opt/i.test(r.body)) {
      log(`  API blocked by Cloudflare at start=${start}`);
      return [];
    }
    let json;
    try { json = JSON.parse(r.body); } catch { return []; }
    if (json.error || !json.data) return [];
    return json.data;
  } catch (e) {
    log(`  API err: ${e.message}`);
    return [];
  }
}

function rowToPermit(row) {
  const description = [row.subtype, row.type, row.submissionType, row.workDescription]
    .filter(Boolean)
    .join(' | ');
  const issued_at = row.createdDate ? new Date(row.createdDate) : null;
  return {
    source: SOURCE,
    permit_number: row.title || row.referenceNumber || row.contentItemId,
    permit_type: row.type || row.submissionType || null,
    description,
    status: row.status || null,
    address: row.address || null,
    city: 'Athens',
    issued_at: issued_at && !isNaN(issued_at) ? issued_at : null,
    contractor: row.name || null,
    raw: row,
  };
}

function parseHtml(html) {
  const tb = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tb) return [];
  const rows = tb[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return rows
    .map((row) => {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      );
      if (cells.length < 4) return null;
      const [permit_number, classification, type, subType, name, address, , dateStr, , status] = cells;
      const issued_at = dateStr ? new Date(dateStr) : null;
      return {
        source: SOURCE,
        permit_number,
        permit_type: type,
        description: [classification, type, subType].filter(Boolean).join(' | '),
        status,
        address,
        city: 'Athens',
        issued_at: issued_at && !isNaN(issued_at) ? issued_at : null,
        contractor: name,
        raw: { cells },
      };
    })
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const htmlArg = process.argv.find((a) => a.startsWith('--html='));
  const typeArg = process.argv.find((a) => a.startsWith('--type='));
  const log = makeLogger(args.log || path.join(__dirname, '..', 'logs', 'permits-athens.log'));
  log(`Starting Athens permit harvest (dryRun=${args.dryRun}) limit=${args.limit}`);

  let rows = [];
  if (htmlArg) {
    const html = fs.readFileSync(htmlArg.slice(7), 'utf8');
    log(`Loaded cached HTML ${htmlArg.slice(7)} (${html.length} bytes)`);
    rows = parseHtml(html);
  } else {
    log(`Querying open API at ${API} (caseType=${typeArg ? typeArg.slice(7) : 'ALL'})`);
    const pageSize = Math.min(args.limit || 50, 100);
    const pages = Math.ceil((args.limit || 50) / pageSize);
    for (let p = 1; p <= pages; p++) {
      const data = await fetchPage(p, pageSize, typeArg ? typeArg.slice(7) : '', log);
      if (!data.length) break;
      rows.push(...data.map(rowToPermit));
      if (data.length < pageSize) break;
    }
    if (rows.length === 0) {
      log('NOTE: Athens API returned 0 records via direct GET. This is expected for cold sessions.');
      log('       Athens public-search requires a Cloudflare-validated browser session.');
      log('       Recommended: Playwright wrapper that solves turnstile and replays /PublicReport/GetAllContentToolModels.');
    }
  }

  log(`Got ${rows.length} permit rows from Athens`);
  const sample = rows.slice(0, args.limit);
  const pool = args.dryRun ? null : makePool();
  let inserted = 0, roofing = 0, plannedInserts = 0;
  try {
    for (const p of sample) {
      const isRoof = ROOF_RE.test(`${p.permit_type} ${p.description}`);
      if (isRoof) roofing++;
      if (args.dryRun) {
        plannedInserts++;
        log(`PLAN INSERT: ${p.permit_number} | ${p.permit_type} | ${p.address} | ${p.description}`);
      } else {
        const r = await upsertPermit(pool, p, false);
        inserted += r.inserted;
        if (r.is_roofing) log(`ROOF: ${p.permit_number} ${p.address}`);
      }
    }
  } finally {
    if (pool) await pool.end();
  }
  log(`Done. fetched=${rows.length} sampled=${sample.length} roofing=${roofing} ${args.dryRun ? `plannedInserts=${plannedInserts}` : `inserted=${inserted}`}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
