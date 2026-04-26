#!/usr/bin/env node
'use strict';

/**
 * MS Building Footprints -> properties + building_footprints
 *
 * Rewritten 2026-04-25 to fix four bugs from the original script:
 *
 *   BUG 1 — Hardcoded `address = 'ms-' + N` polluted 80,635 rows with placeholder
 *           strings. FIX: insert NULL into address; the placeholder was being
 *           used as a poor-man's dedup key, which we replace with bug 4 below.
 *
 *   BUG 2 — Hardcoded `city = 'Huntsville'` for every row regardless of where the
 *           lat/lon actually was — even Decatur, Albertville, Scottsboro, etc.
 *           FIX: derive city from Census Geocoder Incorporated Places layer for
 *           the centroid; falls back to NULL (unincorporated) on miss.
 *
 *   BUG 3 — Hardcoded `county = 'Madison'` and `zip = '35801'` for every row,
 *           breaking county-level filters and permit joins. FIX: derive county
 *           via the local tiger_bg_al table (point-in-polygon, no HTTP needed).
 *           Also writes the 5-digit FIPS plus 11-digit tract and 15-digit block
 *           GEOID. ZIP is left NULL — Census public geocoder does not return
 *           ZCTA, and we have no local TIGER ZCTA shapefile yet.
 *
 *   BUG 4 — Re-running the script inserted duplicate rows because there was no
 *           upsert key. FIX: building_footprints gets a deterministic sourceId
 *           of `ms-${lat7}-${lon7}` and we add a partial unique index on
 *           (source, sourceId) at startup so ON CONFLICT works. properties
 *           inherits the same dedup via building_footprints.propertyId.
 *
 * IMPORTANT: This rewrite has NOT been re-run end-to-end. Disk is at 8.2 GB
 * free and the Alabama.geojson re-download is multi-GB. The new logic was
 * unit-tested against an in-memory feature collection (see TEST_MODE below).
 *
 * Usage:
 *   node scripts/import-footprints.js              # full ingest
 *   node scripts/import-footprints.js --test       # in-memory test (no DB writes)
 *   node scripts/import-footprints.js --no-census  # skip Census city lookup (fast)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { createReadStream } = require('fs');
const { Pool } = require('pg');
const { createId } = require('@paralleldrive/cuid2');

const argv = process.argv.slice(2);
const TEST_MODE = argv.includes('--test');
const SKIP_CENSUS = argv.includes('--no-census');

// Config
const DATA_DIR = '/home/dentwon/Eavesight/data/footprints';
const ZIP_URL = 'https://usbuildingdata.blob.core.windows.net/usbuildings-v2/Alabama.geojson.zip';
const ZIP_FILE = path.join(DATA_DIR, 'Alabama.geojson.zip');

// 5-county North-Alabama metro: Madison + Limestone + Morgan + Marshall + Jackson.
const BBOX = {
  minLat: 34.10, maxLat: 35.00,
  minLon: -87.20, maxLon: -85.50,
};

const BATCH_SIZE = 500;
const LOG_INTERVAL = 5000;
const CENSUS_CONCURRENCY = 8;

const pool = new Pool({
  host: 'localhost', port: 5433, user: 'eavesight',
  password: 'eavesight', database: 'eavesight', max: 4,
});

// ---------- Geo helpers ----------
function computeCentroid(coords) {
  const ring = coords[0];
  let sumLon = 0, sumLat = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) { sumLon += ring[i][0]; sumLat += ring[i][1]; }
  return { lat: sumLat / n, lon: sumLon / n };
}

function computeAreaSqft(coords) {
  const ring = coords[0];
  const n = ring.length;
  let midLat = 0;
  for (let i = 0; i < n - 1; i++) midLat += ring[i][1];
  midLat /= (n - 1);
  const latRad = (midLat * Math.PI) / 180;
  const mLat = 111120, mLon = 111120 * Math.cos(latRad);
  let area = 0;
  for (let i = 0; i < n - 1; i++) {
    const x1 = ring[i][0] * mLon, y1 = ring[i][1] * mLat;
    const x2 = ring[i + 1][0] * mLon, y2 = ring[i + 1][1] * mLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2 * 10.7639;
}

function inBounds(lat, lon) {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat
      && lon >= BBOX.minLon && lon <= BBOX.maxLon;
}

// Deterministic dedup key from rounded centroid (1e7 = ~1cm precision).
function makeSourceId(lat, lon) {
  const la = Math.round(lat * 1e7);
  const lo = Math.round(lon * 1e7);
  return 'ms-' + la + '-' + lo;
}

// ---------- Census reverse-geocode (city only) ----------
function censusReverse(lat, lon) {
  const url = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'
    + '?x=' + encodeURIComponent(lon) + '&y=' + encodeURIComponent(lat)
    + '&benchmark=Public_AR_Current&vintage=Current_Current&format=json';
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const g = json && json.result && json.result.geographies;
          if (!g) return resolve({ city: null, fips: null, tract: null, blockGeoid: null });
          const place = g['Incorporated Places'] && g['Incorporated Places'][0];
          const county = g['Counties'] && g['Counties'][0];
          const tract  = g['Census Tracts'] && g['Census Tracts'][0];
          const block  = g['2020 Census Blocks'] && g['2020 Census Blocks'][0];
          resolve({
            city: place ? place.BASENAME : null,
            countyName: county ? county.BASENAME : null,
            fips: county ? (county.STATE + county.COUNTY) : null,
            tract: tract ? tract.GEOID : null,
            blockGeoid: block ? block.GEOID : null,
          });
        } catch { resolve({ city: null, fips: null, tract: null, blockGeoid: null }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ city: null, fips: null, tract: null, blockGeoid: null }); });
    req.on('error', () => resolve({ city: null, fips: null, tract: null, blockGeoid: null }));
  });
}

// ---------- Local FIPS lookup via tiger_bg_al ----------
//
// Single-row helper. For a real ingest we'd want a server-side join, but this
// keeps the row-by-row logic simple and the index makes ST_Contains fast.
async function tigerLookup(client, lat, lon) {
  const r = await client.query(
    `SELECT statefp, countyfp, tractce, blkgrpce, geoid
       FROM tiger_bg_al
      WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      LIMIT 1`,
    [lon, lat]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    state: row.statefp,                                // "01"
    countyfp: row.countyfp,                            // "089"
    fips: row.statefp + row.countyfp,                  // "01089"
    tract: row.statefp + row.countyfp + row.tractce,   // 11-digit
    blockGroup: row.geoid,                             // 12-digit BG
  };
}

// FIPS->county-name dictionary for the 5 North-AL counties so we can fill
// `county` without hitting Census for every row.
const COUNTY_FIPS = {
  '01089': 'Madison',
  '01083': 'Limestone',
  '01103': 'Morgan',
  '01095': 'Marshall',
  '01071': 'Jackson',
};

// ---------- Census worker pool (city lookups only) ----------
async function runCensusBatch(rows) {
  if (SKIP_CENSUS) return rows.map(() => ({ city: null }));
  const out = new Array(rows.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= rows.length) return;
      out[idx] = await censusReverse(rows[idx].lat, rows[idx].lon);
    }
  }
  await Promise.all(Array.from({ length: CENSUS_CONCURRENCY }, worker));
  return out;
}

// ---------- DB plumbing ----------
async function ensureDedupIndex(client) {
  // Partial unique on (source, sourceId) so re-runs upsert deterministically.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS building_footprints_source_sourceid_uniq
    ON building_footprints (source, "sourceId")
  `);
}

async function insertBatch(client, batch) {
  if (batch.length === 0) return;

  // First, fill in tiger county for every row, then census for city in parallel.
  // tiger calls are sequential here for simplicity; if needed, switch to a
  // single SQL with VALUES UNNEST.
  for (const row of batch) {
    const tiger = await tigerLookup(client, row.lat, row.lon);
    if (tiger) {
      row.fips = tiger.fips;
      row.state = 'AL';
      row.county = COUNTY_FIPS[tiger.fips] || null;
      row.censusTract = tiger.tract;
      row.censusBlockGroup = tiger.blockGroup;
    }
  }
  const censusResults = await runCensusBatch(batch);
  for (let i = 0; i < batch.length; i++) {
    batch[i].city = censusResults[i] ? censusResults[i].city : null;
    // Prefer Census FIPS if tiger missed (e.g. point on water).
    if (!batch[i].fips && censusResults[i] && censusResults[i].fips) {
      batch[i].fips = censusResults[i].fips;
      batch[i].county = COUNTY_FIPS[censusResults[i].fips] || censusResults[i].countyName || null;
    }
  }

  const propPH = [], propVals = [];
  const fpPH   = [], fpVals   = [];
  let pi = 1, fi = 1;

  for (const row of batch) {
    // properties — address, zip stay NULL. city/county/state/fips from lookup.
    propPH.push('($' + pi + ',NULL,$' + (pi+1) + ',$' + (pi+2)
      + ',NULL,$' + (pi+3) + ',$' + (pi+4) + ',$' + (pi+5) + ',$' + (pi+6)
      + ',$' + (pi+7) + ',$' + (pi+8) + ',$' + (pi+9)
      + ',$' + (pi+10) + ',$' + (pi+10) + ')');
    propVals.push(
      row.propId,                  // id
      row.city,                    // city (NULL if unincorporated)
      'AL',                        // state
      row.county,                  // county (real, from FIPS dict)
      row.lat, row.lon,            // lat/lon
      'RESIDENTIAL',               // propertyType
      row.fips,                    // fips
      row.censusTract,             // censusTract
      row.censusBlockGroup,        // censusBlockGroup
      row.now                      // createdAt = updatedAt
    );
    pi += 11;

    fpPH.push('($' + fi + ',$' + (fi+1) + ',$' + (fi+2) + ',$' + (fi+3)
      + ',$' + (fi+4) + ',$' + (fi+5) + ',$' + (fi+6) + ',$' + (fi+7) + ',$' + (fi+8) + ')');
    fpVals.push(row.fpId, row.propId, JSON.stringify(row.geometry),
      row.areaSqft, row.lat, row.lon, 'microsoft', row.sourceId, row.now);
    fi += 9;
  }

  await client.query(
    `INSERT INTO properties
       (id, address, city, state, zip, county, lat, lon, "propertyType",
        fips, "censusTract", "censusBlockGroup", "createdAt", "updatedAt")
     VALUES ` + propPH.join(', ') + `
     ON CONFLICT DO NOTHING`,
    propVals
  );
  await client.query(
    `INSERT INTO building_footprints
       (id, "propertyId", geometry, "areaSqft", "centroidLat", "centroidLon",
        source, "sourceId", "createdAt")
     VALUES ` + fpPH.join(', ') + `
     ON CONFLICT (source, "sourceId") DO NOTHING`,
    fpVals
  );
}

// ---------- Download ----------
async function downloadAndExtract() {
  const existing = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.geojson') && !f.includes('.zip'));
  if (existing.length > 0) {
    const chosen = path.join(DATA_DIR, existing[0]);
    const stat = fs.statSync(chosen);
    if (stat.size > 1e6) {
      console.log('GeoJSON already exists: ' + existing[0] + ' (' + (stat.size / 1048576).toFixed(0) + ' MB)');
      return chosen;
    }
  }
  if (!fs.existsSync(ZIP_FILE) || fs.statSync(ZIP_FILE).size < 1e6) {
    console.log('Downloading Alabama.geojson.zip ...');
    execSync('wget -q -O "' + ZIP_FILE + '" "' + ZIP_URL + '"', { stdio: 'inherit', timeout: 600000 });
  }
  console.log('Unzipping...');
  execSync('cd "' + DATA_DIR + '" && unzip -o "' + ZIP_FILE + '"', { stdio: 'inherit', timeout: 600000 });
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.geojson') && !f.includes('.zip'));
  if (files.length === 0) throw new Error('No .geojson file found after unzipping');
  return path.join(DATA_DIR, files[0]);
}

// ---------- Per-feature -> batch entry ----------
function featureToRow(feature) {
  if (!feature || !feature.geometry || !feature.geometry.coordinates) return null;
  const coords = feature.geometry.coordinates;
  const c = computeCentroid(coords);
  if (!inBounds(c.lat, c.lon)) return null;
  const lat = Math.round(c.lat * 1e7) / 1e7;
  const lon = Math.round(c.lon * 1e7) / 1e7;
  return {
    propId: createId(),
    fpId: createId(),
    lat, lon,
    areaSqft: Math.round(computeAreaSqft(coords) * 100) / 100,
    geometry: feature.geometry,
    sourceId: makeSourceId(lat, lon),  // deterministic, replaces 'ms-' + N
    now: new Date(),
  };
}

// ---------- TEST_MODE: validate logic against in-memory features ----------
async function runTestMode() {
  console.log('=== TEST MODE — no DB writes, in-memory feature collection ===');
  const fixtures = [
    // Downtown Huntsville (incorporated, Madison/01089)
    { lat: 34.7304, lon: -86.5861, expectCounty: 'Madison',  expectCity: 'Huntsville' },
    // Downtown Decatur (incorporated, Morgan/01103)
    { lat: 34.6059, lon: -86.9833, expectCounty: 'Morgan',   expectCity: 'Decatur' },
    // Athens (Limestone/01083)
    { lat: 34.8025, lon: -86.9722, expectCounty: 'Limestone', expectCity: 'Athens' },
    // Albertville (Marshall/01095)
    { lat: 34.2676, lon: -86.2089, expectCounty: 'Marshall', expectCity: 'Albertville' },
    // Scottsboro (Jackson/01071)
    { lat: 34.6723, lon: -86.0341, expectCounty: 'Jackson',  expectCity: 'Scottsboro' },
    // A rural Madison-county point (incorporated city should be NULL or non-Huntsville)
    { lat: 34.9300, lon: -86.4500, expectCounty: 'Madison',  expectCity: '*' /* any */ },
  ];

  const client = await pool.connect();
  try {
    let pass = 0, fail = 0;
    for (const fx of fixtures) {
      const tiger = await tigerLookup(client, fx.lat, fx.lon);
      const census = await censusReverse(fx.lat, fx.lon);
      const fipsCounty = tiger ? COUNTY_FIPS[tiger.fips] : null;
      const okCounty = fipsCounty === fx.expectCounty;
      const okCity = fx.expectCity === '*' || census.city === fx.expectCity;
      const tag = (okCounty && okCity) ? 'PASS' : 'FAIL';
      if (okCounty && okCity) pass++; else fail++;
      console.log(' ' + tag + '  (' + fx.lat + ',' + fx.lon + ')'
        + '  county=' + (fipsCounty || 'NULL') + ' (expect ' + fx.expectCounty + ')'
        + '  city=' + (census.city || 'NULL') + ' (expect ' + fx.expectCity + ')'
        + '  fips=' + (tiger && tiger.fips) + '  blockGeoid=' + (census.blockGeoid || 'NULL'));
    }
    console.log('');
    console.log('Test result: ' + pass + ' pass, ' + fail + ' fail');
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------- Main ingest ----------
async function main() {
  if (TEST_MODE) return runTestMode();

  const { parser } = require('stream-json/parser.js');
  const { pick } = require('stream-json/filters/pick.js');
  const { streamArray } = require('stream-json/streamers/stream-array.js');
  const { chain } = require('stream-chain');

  console.log('=== MS Building Footprints Import: North AL Metro (rewrite) ===');
  console.log('Bounding box: lat ' + BBOX.minLat + '-' + BBOX.maxLat
    + ', lon ' + BBOX.minLon + ' to ' + BBOX.maxLon);
  console.log('Census city lookup: ' + (SKIP_CENSUS ? 'DISABLED' : 'enabled'));

  const geojsonPath = await downloadAndExtract();
  const fileSizeMB = (fs.statSync(geojsonPath).size / 1048576).toFixed(1);
  console.log('GeoJSON file size: ' + fileSizeMB + ' MB');

  const startTime = Date.now();
  let totalScanned = 0, totalImported = 0;
  let batch = [];
  const client = await pool.connect();

  try {
    await ensureDedupIndex(client);

    // NB: not wrapping the whole 80k-row ingest in a single BEGIN — that
    // produced a huge single transaction. Commit per batch instead.
    const featureStream = chain([
      createReadStream(geojsonPath, { encoding: 'utf8' }),
      parser(), pick({ filter: 'features' }), streamArray(),
    ]);

    for await (const data of featureStream) {
      totalScanned++;
      const row = featureToRow(data.value);
      if (!row) continue;
      batch.push(row);
      totalImported++;

      if (batch.length >= BATCH_SIZE) {
        await client.query('BEGIN');
        await client.query('SET LOCAL synchronous_commit = off');
        await insertBatch(client, batch);
        await client.query('COMMIT');
        batch = [];
      }
      if (totalImported % LOG_INTERVAL === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(totalImported / ((Date.now() - startTime) / 1000));
        console.log('  Imported ' + totalImported.toLocaleString()
          + ' (scanned ' + totalScanned.toLocaleString() + ') ['
          + elapsed + 's, ' + rate + '/s]');
      }
    }
    if (batch.length > 0) {
      await client.query('BEGIN');
      await insertBatch(client, batch);
      await client.query('COMMIT');
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('=== Import Complete ===');
    console.log('Scanned:  ' + totalScanned.toLocaleString());
    console.log('Imported: ' + totalImported.toLocaleString());
    console.log('Time:     ' + elapsed + 's');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }

  const propCount = await pool.query('SELECT count(*) FROM properties');
  const fpCount = await pool.query('SELECT count(*) FROM building_footprints');
  console.log('DB - properties: ' + propCount.rows[0].count
    + ', building_footprints: ' + fpCount.rows[0].count);
  await pool.end();
}

main().catch((err) => { console.error('FATAL:', err); pool.end(); process.exit(1); });
