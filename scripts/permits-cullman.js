#!/usr/bin/env node
/**
 * permits-cullman.js  (2026-04-25)
 *
 * Cullman uses the iWorQ Citizen Portal:
 *   https://cullmanal.portal.iworq.net/CULLMANAL/permits/600
 *
 * Search form is a GET with reCAPTCHA gating, but the unfiltered list page
 * itself returns no rows (empty <tbody>). The portal renders permits only
 * after a captcha-validated POST. This script attempts the public list and
 * detects the captcha gate.
 *
 * Usage:
 *   node scripts/permits-cullman.js                 # dry-run, last 25 yrs
 *   node scripts/permits-cullman.js --commit
 *   node scripts/permits-cullman.js --since=2024-01-01 --until=2024-12-31
 *   node scripts/permits-cullman.js --limit=50
 *   node scripts/permits-cullman.js --log=logs/permits-cullman.log
 */
const path = require('path');
const { fetchText, parseArgs, makeLogger, makePool, upsertPermit, ROOF_RE } = require('./permit-common');

const SOURCE = 'cullman';
const BASE = 'https://cullmanal.portal.iworq.net/CULLMANAL/permits/600';

function fmtDate(d) { return d.toISOString().slice(0, 10); }

function parsePermitRows(html) {
  // Extract <tbody>...</tbody>, then each <tr>; parse <td> cells.
  const tb = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tb) return [];
  const rows = tb[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const out = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length < 5) continue;
    // iWorQ column order: Permit#, Date, Type, Address, Description, Status, Inspection, View
    const [permit_number, dateStr, permit_type, address, description, status] = cells;
    if (!permit_number) continue;
    const issued_at = dateStr ? new Date(dateStr) : null;
    out.push({
      source: SOURCE,
      permit_number,
      permit_type,
      description,
      status,
      address,
      city: 'Cullman',
      issued_at: issued_at && !isNaN(issued_at) ? issued_at : null,
      raw: { permit_number, dateStr, permit_type, address, description, status },
    });
  }
  return out;
}

async function fetchSearch(since, until, log) {
  // Public form action is GET to same URL with searchField=permit_dt_range
  const url = `${BASE}?searchField=permit_dt_range&startDate=${fmtDate(since)}&endDate=${fmtDate(until)}`;
  log(`GET ${url}`);
  const r = await fetchText(url);
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  // Detect captcha gate (recaptcha is on the form; if no rows returned, the
  // server requires a token that we can't generate without a browser)
  const rows = parsePermitRows(r.body);
  if (rows.length === 0 && /g-recaptcha|recaptcha/i.test(r.body)) {
    log('WARNING: Cullman iWorQ portal gates result rows behind reCAPTCHA. Direct HTTP returns 0 rows.');
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = makeLogger(args.log || path.join(__dirname, '..', 'logs', 'permits-cullman.log'));
  log(`Starting Cullman permit harvest (dryRun=${args.dryRun}) since=${args.since.toISOString().slice(0, 10)} until=${args.until.toISOString().slice(0, 10)} limit=${args.limit}`);

  let rows = [];
  try {
    rows = await fetchSearch(args.since, args.until, log);
  } catch (e) {
    log(`Fetch failed: ${e.message}`);
  }

  log(`Fetched ${rows.length} permit rows from Cullman portal`);
  const sample = rows.slice(0, args.limit);

  const pool = args.dryRun ? null : makePool();
  let inserted = 0, roofing = 0, plannedInserts = 0;
  try {
    for (const p of sample) {
      if (ROOF_RE.test(`${p.permit_type} ${p.description}`)) roofing++;
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
