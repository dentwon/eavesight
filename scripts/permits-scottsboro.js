#!/usr/bin/env node
/**
 * permits-scottsboro.js  (2026-04-25)
 *
 * Scottsboro uses Cloudpermit (https://us.cloudpermit.com/gov/login).
 * Cloudpermit has NO public permit search — all permit data sits behind a
 * mandatory account login. The City of Scottsboro publishes no monthly
 * permit reports either.
 *
 * This script:
 *  - Probes the Cloudpermit territory home page for any public-search hint
 *  - Records the access barrier
 *  - Provides --html=PATH path so a future Playwright-rendered authed cache
 *    can be parsed
 *
 * Usage:
 *   node scripts/permits-scottsboro.js
 *   node scripts/permits-scottsboro.js --html=/tmp/scottsboro_dump.html
 */
const path = require('path');
const fs = require('fs');
const { fetchText, parseArgs, makeLogger, makePool, upsertPermit, ROOF_RE } = require('./permit-common');

const SOURCE = 'scottsboro';
const PROBES = [
  'https://us.cloudpermit.com/gov/login',
  'https://us.cloudpermit.com/permits/public-search?territory=scottsboro',
  'https://us.cloudpermit.com/permits/public-search?territory=scottsboro-al',
  'https://us.cloudpermit.com/api/applications?territory=scottsboro',
];

async function probe(log) {
  for (const url of PROBES) {
    try {
      const r = await fetchText(url);
      log(`Probe ${url} -> ${r.status} (size=${r.body.length})`);
      if (r.status === 200 && /permit|application/i.test(r.body) && r.body.length > 5000) {
        return r.body;
      }
    } catch (e) {
      log(`Probe ${url} failed: ${e.message}`);
    }
  }
  log('BLOCKED: Cloudpermit exposes no public permit search; full login required.');
  return null;
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
      const [permit_number, permit_type, dateStr, address, description, status] = cells;
      const issued_at = dateStr ? new Date(dateStr) : null;
      return {
        source: SOURCE,
        permit_number,
        permit_type,
        description,
        status,
        address,
        city: 'Scottsboro',
        issued_at: issued_at && !isNaN(issued_at) ? issued_at : null,
        raw: { cells },
      };
    })
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const htmlArg = process.argv.find((a) => a.startsWith('--html='));
  const log = makeLogger(args.log || path.join(__dirname, '..', 'logs', 'permits-scottsboro.log'));
  log(`Starting Scottsboro permit harvest (dryRun=${args.dryRun}) limit=${args.limit}`);

  let html = null;
  if (htmlArg) {
    html = fs.readFileSync(htmlArg.slice(7), 'utf8');
    log(`Loaded cached HTML ${htmlArg}`);
  } else {
    html = await probe(log);
  }

  if (!html) {
    log('Done. fetched=0 sampled=0 roofing=0 plannedInserts=0  [need Cloudpermit authed session via Playwright]');
    return;
  }

  const rows = parseHtml(html);
  log(`Parsed ${rows.length} permit rows`);
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
