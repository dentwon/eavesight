#!/usr/bin/env node
'use strict';

/**
 * Reverse-geocode MS placeholder properties using the FREE Census Geocoding API.
 *
 *  Census endpoint used:
 *    https://geocoding.geo.census.gov/geocoder/geographies/coordinates
 *      ?x=<lon>&y=<lat>&benchmark=Public_AR_Current
 *      &vintage=Current_Current&format=json
 *
 *  IMPORTANT — what Census returns vs what it does NOT return:
 *    + Counties layer       -> real county name + 5-digit FIPS  (used for `county`, `fips`)
 *    + Incorporated Places  -> real city ("Huntsville", "Madison", etc.)
 *    + 2020 Census Blocks   -> 15-digit GEOID (state+county+tract+block)
 *    + Census Tracts        -> tract code
 *    - NO street address. The Census public geocoder is forward-only for street
 *      address; "geographies/coordinates" is a point-in-polygon FIPS lookup.
 *    - NO ZCTA / ZIP. We cannot derive the 5-digit ZIP from Census directly.
 *
 *  So this script DOES correctly fix:
 *      city, county, state, fips, censusTract, censusBlockGroup
 *  And it CANNOT fill (leaves NULL / staged for a separate enrichment pass):
 *      address  (need a paid or OSM/Nominatim source for street geocoding)
 *      zip      (need a TIGER ZCTA shapefile or USPS lookup)
 *
 *  By design this is *DRY-RUN ONLY*. It writes proposed updates to:
 *      scripts/output/ms-geocode-proposals.json
 *      staging_ms_geocode_proposals (table, created if missing)
 *  It NEVER touches `properties`. Apply later with a separate apply script
 *  after manual review.
 *
 *  Usage:
 *    node scripts/geocode-ms-placeholders.js --limit 100 --county Madison
 *    node scripts/geocode-ms-placeholders.js --limit 100 --random
 *    node scripts/geocode-ms-placeholders.js --all                # full 80k run
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Pool } = require('pg');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const LIMIT = parseInt(arg('--limit', '100'), 10);
const COUNTY = arg('--county', null);
const RANDOM = !!arg('--random', false);
const ALL = !!arg('--all', false);
const CONCURRENCY = parseInt(arg('--concurrency', '6'), 10);
const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'ms-geocode-proposals.json');
const OUTPUT_FAILURES = path.join(OUTPUT_DIR, 'ms-geocode-failures.json');

const pool = new Pool({
  host: 'localhost', port: 5433, user: 'eavesight',
  password: 'eavesight', database: 'eavesight', max: 4,
});

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function censusReverse(lat, lon) {
  const url = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'
    + '?x=' + encodeURIComponent(lon)
    + '&y=' + encodeURIComponent(lat)
    + '&benchmark=Public_AR_Current'
    + '&vintage=Current_Current'
    + '&format=json';
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('parse: ' + e.message + ' raw=' + data.slice(0, 200))); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

function parseCensus(json) {
  const g = json && json.result && json.result.geographies;
  if (!g) return { ok: false, reason: 'no-geographies' };

  const county   = g['Counties'] && g['Counties'][0];
  const place    = g['Incorporated Places'] && g['Incorporated Places'][0];
  const block    = g['2020 Census Blocks'] && g['2020 Census Blocks'][0];
  const tract    = g['Census Tracts'] && g['Census Tracts'][0];
  const state    = g['States'] && g['States'][0];

  if (!county) return { ok: false, reason: 'no-county' };

  return {
    ok: true,
    state:    state ? state.STUSAB : 'AL',
    county:   county.BASENAME,                    // "Madison"
    fips:     (county.STATE || '01') + county.COUNTY,  // "01089"
    city:     place ? place.BASENAME : null,      // "Huntsville" (NULL if unincorporated)
    tract:    tract ? tract.GEOID : null,         // 11-digit
    blockGeoid: block ? block.GEOID : null,       // 15-digit
    blockGroup: block ? block.BLKGRP : null,
    address:  null,  // Census does not return street address
    zip:      null,  // Census geographies layer does not include ZCTA
  };
}

async function ensureStagingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS staging_ms_geocode_proposals (
      property_id      text PRIMARY KEY,
      old_address      text,
      old_city         text,
      old_zip          text,
      old_county       text,
      lat              double precision,
      lon              double precision,
      new_city         text,
      new_county       text,
      new_state        text,
      new_fips         text,
      new_tract        text,
      new_block_geoid  text,
      new_block_group  text,
      census_ok        boolean,
      census_reason    text,
      raw_response     jsonb,
      created_at       timestamptz DEFAULT NOW()
    )
  `);
}

async function fetchTargets(client) {
  let where = "address LIKE 'ms-%'";
  const params = [];
  if (COUNTY) {
    params.push(COUNTY);
    where += ' AND county = $' + params.length;
  }
  let order;
  if (RANDOM) order = ' ORDER BY random()';
  else order = ' ORDER BY id';
  const limitClause = ALL ? '' : ' LIMIT ' + LIMIT;
  const sql = 'SELECT id, address, city, zip, county, lat, lon FROM properties WHERE '
    + where + order + limitClause;
  const r = await client.query(sql, params);
  return r.rows;
}

async function runWithConcurrency(items, n, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function next() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: n }, next));
  return out;
}

async function main() {
  console.log('=== Reverse-geocode MS placeholders (DRY-RUN) ===');
  console.log('Limit: ' + (ALL ? 'ALL' : LIMIT) + (COUNTY ? ', county=' + COUNTY : '')
    + ', random=' + RANDOM + ', concurrency=' + CONCURRENCY);

  const client = await pool.connect();
  try {
    await ensureStagingTable(client);
    const targets = await fetchTargets(client);
    console.log('Targeting ' + targets.length + ' rows.');
    if (targets.length === 0) { return; }

    const start = Date.now();
    let done = 0;
    const proposals = [];
    const failures = [];

    const results = await runWithConcurrency(targets, CONCURRENCY, async (row) => {
      let parsed, raw, errMsg;
      try {
        raw = await censusReverse(row.lat, row.lon);
        parsed = parseCensus(raw);
      } catch (e) {
        errMsg = e.message;
        parsed = { ok: false, reason: 'http-error: ' + errMsg };
      }
      done++;
      if (done % 20 === 0 || done === targets.length) {
        const rate = (done / ((Date.now() - start) / 1000)).toFixed(1);
        console.log('  ' + done + '/' + targets.length + '  (' + rate + ' req/s)');
      }
      const record = {
        property_id: row.id,
        old: { address: row.address, city: row.city, zip: row.zip, county: row.county },
        lat: row.lat, lon: row.lon,
        proposed: parsed.ok ? {
          city: parsed.city, county: parsed.county, state: parsed.state,
          fips: parsed.fips, tract: parsed.tract,
          blockGeoid: parsed.blockGeoid, blockGroup: parsed.blockGroup,
          address: null, zip: null,
        } : null,
        ok: parsed.ok, reason: parsed.ok ? null : parsed.reason,
      };
      if (parsed.ok) proposals.push(record); else failures.push(record);
      return { record, raw };
    });

    // Stage to staging table
    let staged = 0;
    for (const { record, raw } of results) {
      await client.query(
        `INSERT INTO staging_ms_geocode_proposals
           (property_id, old_address, old_city, old_zip, old_county, lat, lon,
            new_city, new_county, new_state, new_fips, new_tract,
            new_block_geoid, new_block_group, census_ok, census_reason, raw_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (property_id) DO UPDATE SET
           new_city=EXCLUDED.new_city, new_county=EXCLUDED.new_county,
           new_state=EXCLUDED.new_state, new_fips=EXCLUDED.new_fips,
           new_tract=EXCLUDED.new_tract, new_block_geoid=EXCLUDED.new_block_geoid,
           new_block_group=EXCLUDED.new_block_group,
           census_ok=EXCLUDED.census_ok, census_reason=EXCLUDED.census_reason,
           raw_response=EXCLUDED.raw_response, created_at=NOW()`,
        [
          record.property_id, record.old.address, record.old.city, record.old.zip, record.old.county,
          record.lat, record.lon,
          record.proposed && record.proposed.city,
          record.proposed && record.proposed.county,
          record.proposed && record.proposed.state,
          record.proposed && record.proposed.fips,
          record.proposed && record.proposed.tract,
          record.proposed && record.proposed.blockGeoid,
          record.proposed && record.proposed.blockGroup,
          record.ok, record.reason || null,
          raw ? JSON.stringify(raw) : null,
        ]
      );
      staged++;
    }

    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(proposals, null, 2));
    fs.writeFileSync(OUTPUT_FAILURES, JSON.stringify(failures, null, 2));

    // Summary
    const okCnt = proposals.length;
    const failCnt = failures.length;
    const cityCounts = proposals.reduce((m, r) => {
      const k = r.proposed.city || '(unincorporated)';
      m[k] = (m[k] || 0) + 1; return m;
    }, {});
    const countyCounts = proposals.reduce((m, r) => {
      const k = r.proposed.county || '?';
      m[k] = (m[k] || 0) + 1; return m;
    }, {});
    const reassign = proposals.filter(r => r.old.county && r.proposed.county
      && r.old.county !== r.proposed.county).length;

    console.log('');
    console.log('--- Summary ---');
    console.log('OK (FIPS resolved):              ' + okCnt + '/' + targets.length);
    console.log('Failures (no county FIPS found): ' + failCnt);
    console.log('Got real city (Incorporated):    '
      + proposals.filter(r => r.proposed.city).length);
    console.log('Got NULL city (unincorporated):  '
      + proposals.filter(r => !r.proposed.city).length);
    console.log('County reassigned vs. old:       ' + reassign);
    console.log('');
    console.log('City breakdown:    ' + JSON.stringify(cityCounts));
    console.log('County breakdown:  ' + JSON.stringify(countyCounts));
    console.log('');
    console.log('Street addresses produced:        0  (Census API does not reverse-geocode streets)');
    console.log('ZIPs produced:                    0  (Census geographies layer has no ZCTA)');
    console.log('');
    console.log('Staged ' + staged + ' rows to staging_ms_geocode_proposals');
    console.log('Wrote: ' + OUTPUT_JSON);
    console.log('Wrote: ' + OUTPUT_FAILURES);
    console.log('');
    console.log('NO production rows updated. Review staging_ms_geocode_proposals,');
    console.log('then run a separate apply script to UPDATE properties.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('FATAL:', e); pool.end(); process.exit(1); });
