#!/usr/bin/env node
/**
 * permits-marshall-cities.js  (2026-04-25)
 *
 * Combined scraper for Albertville, Boaz, and Guntersville (all in Marshall
 * County, AL). Probed (2026-04-25):
 *   Albertville: cityofalbertville.com -> no online search portal; PDF
 *                application form only; permits viewable in person.
 *   Boaz: cityofboaz.org -> no online search portal; "request an
 *          appointment with the City Clerk to view records."
 *   Guntersville: guntersvilleal.org -> no online search portal; phone-only.
 *   Marshall County (engineering): marshallco.org -> no permit search.
 *
 * Marshall County itself is already scraped via harvest-marshall-jackson.js
 * for parcel records. The three city building departments do not publish
 * permit data online in any machine-readable form.
 *
 * This script:
 *  - Probes each candidate URL and records the gate (no portal found)
 *  - Provides --html=PATH for future PDF/scrape ingestion
 *
 * Usage:
 *   node scripts/permits-marshall-cities.js
 *   node scripts/permits-marshall-cities.js --html=/tmp/albertville.html
 */
const path = require('path');
const fs = require('fs');
const { fetchText, parseArgs, makeLogger, makePool, upsertPermit, ROOF_RE } = require('./permit-common');

const CITIES = [
  {
    source: 'albertville',
    city: 'Albertville',
    probes: [
      'https://www.cityofalbertville.com/161/Building-Permit-Information',
      'https://albertvilleal.portal.iworq.net/portalhome/albertvilleal',
      'https://albertvilleal.govbuilt.com/advancedforms',
      'https://cityview.albertvilleal.gov/Portal',
    ],
  },
  {
    source: 'boaz',
    city: 'Boaz',
    probes: [
      'https://www.cityofboaz.org/177/Business-License-Building-Permit',
      'https://boazal.portal.iworq.net/portalhome/boazal',
      'https://boazal.govbuilt.com/advancedforms',
    ],
  },
  {
    source: 'guntersville',
    city: 'Guntersville',
    probes: [
      'https://guntersvilleal.org/departments/building-department/',
      'https://guntersvilleal.portal.iworq.net/portalhome/guntersvilleal',
      'https://guntersvilleal.govbuilt.com/advancedforms',
      'https://cityview.guntersvilleal.gov/Portal',
    ],
  },
];

async function probeCity(city, log) {
  log(`--- Probing ${city.city} ---`);
  for (const url of city.probes) {
    try {
      const r = await fetchText(url);
      log(`  ${url} -> ${r.status} size=${r.body.length}`);
      if (r.status === 200 && /(permit\s*#|search|<tbody)/i.test(r.body) && r.body.length > 5000) {
        log(`  CANDIDATE PORTAL: ${url}`);
        return { url, html: r.body };
      }
    } catch (e) {
      log(`  ${url} -> ERR ${e.message}`);
    }
  }
  log(`  BLOCKED: no public permit portal found for ${city.city}.`);
  return null;
}

function parseHtml(html, source, cityName) {
  const tb = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tb) return [];
  const rows = tb[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return rows
    .map((row) => {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      );
      if (cells.length < 4) return null;
      const [permit_number, dateStr, permit_type, address, description, status] = cells;
      const issued_at = dateStr ? new Date(dateStr) : null;
      return {
        source,
        permit_number,
        permit_type,
        description,
        status,
        address,
        city: cityName,
        issued_at: issued_at && !isNaN(issued_at) ? issued_at : null,
        raw: { cells },
      };
    })
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const htmlArg = process.argv.find((a) => a.startsWith('--html='));
  const cityArg = process.argv.find((a) => a.startsWith('--city='));
  const log = makeLogger(args.log || path.join(__dirname, '..', 'logs', 'permits-marshall-cities.log'));
  log(`Starting Marshall-cities permit harvest (dryRun=${args.dryRun}) limit=${args.limit}`);

  const pool = args.dryRun ? null : makePool();
  let totalRows = 0, totalRoof = 0, totalInserts = 0, totalPlanned = 0;

  try {
    for (const c of CITIES) {
      if (cityArg && cityArg.slice(7).toLowerCase() !== c.source) continue;
      let html = null;
      if (htmlArg && cityArg && cityArg.slice(7).toLowerCase() === c.source) {
        html = fs.readFileSync(htmlArg.slice(7), 'utf8');
      } else {
        const found = await probeCity(c, log);
        html = found?.html || null;
      }
      if (!html) continue;
      const rows = parseHtml(html, c.source, c.city);
      log(`  ${c.city} parsed ${rows.length} rows`);
      const sample = rows.slice(0, args.limit);
      totalRows += rows.length;
      for (const p of sample) {
        const isRoof = ROOF_RE.test(`${p.permit_type} ${p.description}`);
        if (isRoof) totalRoof++;
        if (args.dryRun) {
          totalPlanned++;
          log(`  PLAN INSERT [${c.source}]: ${p.permit_number} | ${p.permit_type} | ${p.address} | ${p.description}`);
        } else {
          const r = await upsertPermit(pool, p, false);
          totalInserts += r.inserted;
          if (r.is_roofing) log(`  ROOF [${c.source}]: ${p.permit_number} ${p.address}`);
        }
      }
    }
  } finally {
    if (pool) await pool.end();
  }
  log(`Done. fetched=${totalRows} roofing=${totalRoof} ${args.dryRun ? `plannedInserts=${totalPlanned}` : `inserted=${totalInserts}`}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
