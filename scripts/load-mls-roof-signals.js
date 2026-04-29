#!/usr/bin/env node
/**
 * load-mls-roof-signals.js  (2026-04-29)
 *
 * The PM2 redfin workers (mls-redfin-w1..w8) scrape Redfin listings into
 * `_mls_listings_raw` and run a regex on each listing's `description` /
 * `meta_description`, populating:
 *   roof_year         int     — year extracted from "new roof YYYY" patterns
 *   roof_year_quote   text    — the matched substring (for audit)
 *   roof_category     text    — one of: new-roof, metal-roof, age-mention,
 *                                shingle-mention, recent-replace, warranty-implied
 *   roof_all_quotes   jsonb   — every roof-related sentence found
 *
 * Snapshot 2026-04-29: 5,028 listings staged, of which
 *   114 have explicit roof_year
 *   262 have roof_category (some without year)
 *
 * This loader resolves each listing to a propertyId via address lookup and
 * emits property_signals:
 *
 *   roof_year present:                signalType='mls_roof_year'   conf=0.80
 *     (homeowner-asserted via realtor — strong, but realtor copy can stretch
 *      "newer roof" into "new roof YYYY", so cap below permit-derived 0.95)
 *   roof_category in ('new-roof','recent-replace','warranty-implied'):
 *                                     signalType='mls_roof_mention' conf=0.50
 *     (no year given but listing implies recent replacement; useful when
 *      year context lets us back into a window)
 *   metal-roof:                       signalType='mls_roof_material' conf=0.60
 *     (metal roofs last 40-70yr — the material itself is the relevant signal,
 *      not the age, so it gets its own signalType)
 *
 * Idempotent re-runs via property_signals unique
 *   (propertyId, signalType, source, sourceRecordId).
 *   sourceRecordId = 'redfin:{listing_id}'.
 *
 * Usage:
 *   node scripts/load-mls-roof-signals.js                # dry-run
 *   node scripts/load-mls-roof-signals.js --commit
 *   node scripts/load-mls-roof-signals.js --commit --since=2024-01-01
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { emitSignal, resolvePropertyId } = require('./lib/property-signal-emit');

const DB = {
  host: 'localhost', port: 5433, user: 'eavesight', password: 'eavesight', database: 'eavesight',
};

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit') || argv.includes('--no-dry-run');
const SINCE = (argv.find((a) => a.startsWith('--since=')) || '').slice('--since='.length) || null;
const SOURCE = 'mls.redfin';
const LOG_FILE = path.join(__dirname, '..', 'logs', 'load-mls-roof-signals.log');

function makeLogger() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return (...args) => {
    const line = `[${new Date().toISOString()}] ${args.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`;
    console.log(line); stream.write(line + '\n');
  };
}

async function main() {
  const log = makeLogger();
  log(`Starting MLS roof-signal loader (commit=${COMMIT}, since=${SINCE || '(any)'})`);

  const pool = new Pool(DB);
  try {
    const where = ['(roof_year IS NOT NULL OR roof_category IS NOT NULL)'];
    const params = [];
    if (SINCE) {
      where.push(`scraped_at >= $${params.length + 1}`);
      params.push(SINCE);
    }
    const sql = `
      SELECT id AS listing_id, source_id, address, city, state, zip, lat, lon,
             year_built, list_date, sold_date, status,
             roof_year, roof_year_quote, roof_category, roof_all_quotes
      FROM _mls_listings_raw
      WHERE ${where.join(' AND ')}
      ORDER BY scraped_at DESC
    `;
    const { rows: listings } = await pool.query(sql, params);
    log(`scanning ${listings.length} listings with any roof signal`);

    const byKind = { mls_roof_year: 0, mls_roof_mention: 0, mls_roof_material: 0 };
    let inserted = 0, dedupedSkipped = 0, unmatched = 0, ambiguous = 0, validationSkipped = 0;

    for (const r of listings) {
      let signalType = null;
      let confidence = null;
      let signalDate = null;
      const cat = r.roof_category;
      if (r.roof_year != null && r.roof_year >= 1950 && r.roof_year <= 2030) {
        signalType = 'mls_roof_year';
        confidence = 0.80;
        signalDate = `${r.roof_year}-06-01`;
      } else if (cat === 'metal-roof') {
        signalType = 'mls_roof_material';
        confidence = 0.60;
      } else if (cat && ['new-roof', 'recent-replace', 'warranty-implied'].includes(cat)) {
        signalType = 'mls_roof_mention';
        confidence = 0.50;
      } else {
        validationSkipped++;
        continue;
      }

      // Sanity check: roof_year shouldn't be far-future or before yearBuilt
      if (signalType === 'mls_roof_year' && r.year_built && r.roof_year < r.year_built - 1) {
        // Roof claims it's older than the building — bogus, skip
        validationSkipped++;
        continue;
      }

      const fullAddr = r.address ? `${r.address}, ${r.city || ''}, ${r.state || 'AL'} ${r.zip || ''}`.trim() : null;
      const match = await resolvePropertyId({
        pool,
        address: fullAddr,
        lat: typeof r.lat === 'number' ? r.lat : null,
        lon: typeof r.lon === 'number' ? r.lon : null,
      });

      if (!match) {
        unmatched++;
        continue;
      }

      if (!COMMIT) {
        byKind[signalType]++;
        log(`PLAN ${signalType} conf=${confidence} ${r.address}, ${r.city}, ${r.zip} → ${match.id} (${match.match}) yr=${r.roof_year || '-'} cat=${cat || '-'}`);
        continue;
      }

      const result = await emitSignal({
        pool,
        propertyId: match.id,
        signalType,
        signalValue: {
          listing_id: r.listing_id,
          source_id: r.source_id,
          roof_year: r.roof_year,
          roof_year_quote: r.roof_year_quote,
          roof_category: r.roof_category,
          roof_all_quotes: r.roof_all_quotes,
          listing_status: r.status,
          listing_year_built: r.year_built,
        },
        signalDate,
        confidence,
        source: SOURCE,
        sourceRecordId: `redfin:${r.source_id || r.listing_id}`,
      });
      byKind[signalType]++;
      if (result.inserted) inserted++; else dedupedSkipped++;
    }

    log(`done. signalsByKind=${JSON.stringify(byKind)} inserted=${inserted} dedupedSkipped=${dedupedSkipped} unmatched=${unmatched} validationSkipped=${validationSkipped}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
