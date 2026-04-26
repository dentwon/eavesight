#!/usr/bin/env node
/**
 * geocode-ms-batched.js
 *
 * Faster rewrite of geocode-ms-placeholders.js.
 *
 * Differences from the original:
 *   - Streams: each Census reverse-geocode response is staged immediately
 *     in batches of 100, instead of building a full in-memory array of
 *     80K records and then doing 80K serial INSERTs at the end.
 *   - Resumable: skips properties that already exist in
 *     staging_ms_geocode_proposals AND have census_ok=true. Re-running
 *     after partial completion only fetches the rest.
 *   - Lower DB pressure: each batch is ONE multi-row INSERT VALUES, not
 *     N round-trips. Drops staging time from ~9 hours to ~1 minute once
 *     all responses arrive.
 *
 * Writes ONLY to staging_ms_geocode_proposals. Does NOT touch the
 * `properties` table — apply that with a separate UPDATE FROM staging
 * after Madison's scrape finishes (avoids lock contention with workers).
 *
 * Usage:
 *   node scripts/geocode-ms-batched.js              # all unstaged ms-* rows
 *   node scripts/geocode-ms-batched.js --limit=500  # smoke test
 */

const https = require('https');
const { Pool } = require('pg');

const args = process.argv.slice(2);
const arg = (k, def) => {
  const a = args.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : def;
};
const LIMIT = parseInt(arg('limit', '0'), 10) || null;
const CONC = parseInt(arg('conc', '8'), 10);
const BATCH = parseInt(arg('batch', '100'), 10);

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  user: process.env.DB_USER || 'eavesight',
  password: process.env.DB_PASS || 'eavesight',
  database: process.env.DB_NAME || 'eavesight',
};

function fetchCensus(lat, lon) {
  const url =
    'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'
    + '?x=' + lon
    + '&y=' + lat
    + '&benchmark=Public_AR_Current'
    + '&vintage=Current_Current'
    + '&format=json';
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 30000 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject)
      .on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function parseCensus(json) {
  const g = json && json.result && json.result.geographies;
  if (!g) return { ok: false, reason: 'no-geographies' };

  const counties = g['Counties'] || [];
  if (!counties.length) return { ok: false, reason: 'no-county' };
  const county = counties[0];

  const places = g['Incorporated Places'] || [];
  const city = places.length ? places[0].BASENAME : null;

  const tracts = g['Census Tracts'] || [];
  const tract = tracts.length ? tracts[0].GEOID : null;

  const blocks = g['2020 Census Blocks'] || [];
  const blockGeoid = blocks.length ? blocks[0].GEOID : null;
  const blockGroup = blocks.length ? blocks[0].BLKGRP : null;

  return {
    ok: true,
    state: 'AL',
    county: county.BASENAME,
    fips: county.GEOID,
    city,
    tract,
    blockGeoid,
    blockGroup,
  };
}

async function getTargets(pool) {
  // Find ms-* rows that aren't yet successfully staged.
  const res = await pool.query(
    `SELECT p.id, p.address, p.city, p.zip, p.county, p.lat, p.lon
     FROM properties p
     LEFT JOIN staging_ms_geocode_proposals s
       ON s.property_id = p.id AND s.census_ok = true
     WHERE p.address LIKE 'ms-%'
       AND p.lat IS NOT NULL AND p.lon IS NOT NULL
       AND s.property_id IS NULL
     ${LIMIT ? 'LIMIT ' + LIMIT : ''}`,
  );
  return res.rows;
}

async function flushBatch(pool, batch) {
  if (batch.length === 0) return 0;
  const cols = '(property_id, old_address, old_city, old_zip, old_county, lat, lon, new_city, new_county, new_state, new_fips, new_tract, new_block_geoid, new_block_group, census_ok, census_reason, raw_response)';
  const placeholders = [];
  const vals = [];
  let i = 1;
  for (const r of batch) {
    placeholders.push(
      '($' + i++ + ',$' + i++ + ',$' + i++ + ',$' + i++ + ',$' + i++
      + ',$' + i++ + ',$' + i++ + ',$' + i++ + ',$' + i++ + ',$' + i++
      + ',$' + i++ + ',$' + i++ + ',$' + i++ + ',$' + i++ + ',$' + i++
      + ',$' + i++ + ',$' + i++ + ')'
    );
    vals.push(
      r.property_id,
      r.old.address, r.old.city, r.old.zip, r.old.county,
      r.lat, r.lon,
      r.proposed && r.proposed.city,
      r.proposed && r.proposed.county,
      r.proposed && r.proposed.state,
      r.proposed && r.proposed.fips,
      r.proposed && r.proposed.tract,
      r.proposed && r.proposed.blockGeoid,
      r.proposed && r.proposed.blockGroup,
      r.ok,
      r.reason || null,
      r.raw ? JSON.stringify(r.raw) : null,
    );
  }
  const sql =
    'INSERT INTO staging_ms_geocode_proposals ' + cols + ' VALUES ' + placeholders.join(',') + ' '
    + 'ON CONFLICT (property_id) DO UPDATE SET '
    + 'new_city=EXCLUDED.new_city, new_county=EXCLUDED.new_county, new_state=EXCLUDED.new_state, '
    + 'new_fips=EXCLUDED.new_fips, new_tract=EXCLUDED.new_tract, new_block_geoid=EXCLUDED.new_block_geoid, '
    + 'new_block_group=EXCLUDED.new_block_group, census_ok=EXCLUDED.census_ok, '
    + 'census_reason=EXCLUDED.census_reason, raw_response=EXCLUDED.raw_response, created_at=NOW()';
  await pool.query(sql, vals);
  return batch.length;
}

async function runWithConcurrency(items, n, work, onProgress) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, () =>
      (async () => {
        while (true) {
          const idx = i++;
          if (idx >= items.length) return;
          await work(items[idx]);
          done++;
          if (onProgress) onProgress(done);
        }
      })(),
    ),
  );
}

(async () => {
  const pool = new Pool(DB);
  console.log('=== geocode-ms-batched ===');
  console.log('targeting unstaged ms-* rows...');
  const targets = await getTargets(pool);
  console.log('targets: ' + targets.length);
  if (!targets.length) { await pool.end(); return; }

  const start = Date.now();
  const batch = [];
  let staged = 0;
  let failures = 0;

  await runWithConcurrency(targets, CONC, async (row) => {
    let raw = null, parsed = null, errMsg = null;
    try {
      raw = await fetchCensus(row.lat, row.lon);
      parsed = parseCensus(raw);
    } catch (e) {
      errMsg = e.message;
      parsed = { ok: false, reason: 'http-error: ' + errMsg };
    }
    const record = {
      property_id: row.id,
      old: { address: row.address, city: row.city, zip: row.zip, county: row.county },
      lat: row.lat,
      lon: row.lon,
      proposed: parsed.ok ? {
        city: parsed.city, county: parsed.county, state: parsed.state,
        fips: parsed.fips, tract: parsed.tract,
        blockGeoid: parsed.blockGeoid, blockGroup: parsed.blockGroup,
      } : null,
      ok: parsed.ok,
      reason: parsed.ok ? null : parsed.reason,
      raw,
    };
    if (!parsed.ok) failures++;
    batch.push(record);
    if (batch.length >= BATCH) {
      const flush = batch.splice(0, batch.length);
      try {
        const n = await flushBatch(pool, flush);
        staged += n;
      } catch (e) {
        console.error('  flush err:', e.message);
        failures += flush.length;
      }
    }
  }, (n) => {
    if (n % 200 === 0) {
      const rate = (n / ((Date.now() - start) / 1000)).toFixed(1);
      console.log('  ' + n + '/' + targets.length + ' (' + rate + ' req/s, staged=' + staged + ')');
    }
  });

  // Final flush
  if (batch.length) {
    try {
      staged += await flushBatch(pool, batch);
    } catch (e) {
      console.error('  final flush err:', e.message);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('done. staged=' + staged + ' failures=' + failures + ' elapsed=' + elapsed + 's');

  // Quick summary
  const sum = await pool.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE census_ok) AS ok,
            COUNT(*) FILTER (WHERE new_city IS NOT NULL) AS with_city
     FROM staging_ms_geocode_proposals`,
  );
  console.log('staging now: total=' + sum.rows[0].total + ' ok=' + sum.rows[0].ok + ' with_city=' + sum.rows[0].with_city);

  await pool.end();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
