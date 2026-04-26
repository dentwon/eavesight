#!/usr/bin/env node
/**
 * backfill-ms-bf-dates.js (v2 - fixed)
 *
 * Backfill capture_date_start / capture_date_end / bf_release columns onto
 * existing building_footprints rows from Microsoft US Building Footprints
 * v2 Alabama release.
 *
 * Fixes vs the prior attempt:
 *   - Uses stream-json (already in node_modules) for robust streaming
 *     instead of homemade brace counting (which stopped at ~7K of 2.4M).
 *   - Uses correct column names (centroidLat / centroidLon, not lat / lon).
 *   - Uses the PostGIS geom column + GiST index via ST_DWithin for the
 *     spatial match — much faster than bbox + Euclidean.
 *
 * Source: https://usbuildingdata.blob.core.windows.net/usbuildings-v2/Alabama.geojson.zip
 *   (2.4M features statewide; ~72% have a capture_dates_range populated)
 *
 * Strategy:
 *   1. Schema: ALTER TABLE building_footprints ADD ... IF NOT EXISTS.
 *   2. Download + unzip Alabama.geojson to /tmp.
 *   3. Stream-parse with stream-json. Filter features inside the 5-county
 *      bbox (lat 34.10-35.00, lon -87.20 to -85.50). Compute polygon
 *      centroid via signed-area formula.
 *   4. Batched INSERT (1000/batch) into staging table _ms_bf_v2_raw with
 *      lat, lon, capture_date_start/end, bf_release.
 *   5. Build a GiST index on _ms_bf_v2_raw geom.
 *   6. UPDATE building_footprints joined to _ms_bf_v2_raw via
 *      ST_DWithin(bf.geom::geography, raw.geom::geography, 5).
 *   7. Report distribution. Drop staging table on success.
 *
 * Usage:
 *   node scripts/backfill-ms-bf-dates.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const chain = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/pick.js');
const { streamArray } = require('stream-json/streamers/stream-array.js');

const DOWNLOAD_URLS = [
  'https://minedbuildings.z5.web.core.windows.net/legacy/usbuildings-v2/Alabama.geojson.zip',
  'https://usbuildingdata.blob.core.windows.net/usbuildings-v2/Alabama.geojson.zip',
];

const TMP_DIR = '/tmp';
const ZIP_PATH = path.join(TMP_DIR, 'Alabama.geojson.zip');
const GEOJSON_PATH = path.join(TMP_DIR, 'Alabama.geojson');

const BBOX = { latMin: 34.10, latMax: 35.00, lonMin: -87.20, lonMax: -85.50 };

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  user: process.env.DB_USER || 'eavesight',
  password: process.env.DB_PASS || 'eavesight',
  database: process.env.DB_NAME || 'eavesight',
};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}`);
}

function downloadIfMissing() {
  if (fs.existsSync(GEOJSON_PATH)) {
    const sz = fs.statSync(GEOJSON_PATH).size;
    log(`reusing ${GEOJSON_PATH} (${(sz / 1024 / 1024).toFixed(1)} MB)`);
    return;
  }
  if (!fs.existsSync(ZIP_PATH)) {
    let last;
    for (const url of DOWNLOAD_URLS) {
      try { log(`downloading ${url}`); sh('curl', ['-fL', '-o', ZIP_PATH, url]); break; }
      catch (e) { last = e; log(`  failed: ${e.message}`); }
    }
    if (!fs.existsSync(ZIP_PATH)) throw last || new Error('no download URL worked');
  }
  log(`unzipping ${ZIP_PATH}`);
  sh('unzip', ['-o', ZIP_PATH, '-d', TMP_DIR]);
  if (!fs.existsSync(GEOJSON_PATH)) {
    const found = fs.readdirSync(TMP_DIR).filter((f) => f.toLowerCase().endsWith('.geojson'));
    if (!found.length) throw new Error('no .geojson after unzip');
    fs.renameSync(path.join(TMP_DIR, found[0]), GEOJSON_PATH);
  }
}

function parseDateRange(s) {
  if (!s || typeof s !== 'string') return [null, null];
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})-(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return [null, null];
  const start = `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  const end = `${m[6]}-${String(m[4]).padStart(2, '0')}-${String(m[5]).padStart(2, '0')}`;
  return [start, end];
}

function polygonCentroid(coords) {
  const ring = coords[0];
  if (!ring || ring.length < 4) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0, n = 0;
    for (const [x, y] of ring) { sx += x; sy += y; n++; }
    return [sx / n, sy / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

async function ensureSchema(pool) {
  log('schema: ALTER TABLE building_footprints + create staging');
  await pool.query(`ALTER TABLE building_footprints ADD COLUMN IF NOT EXISTS capture_date_start date`);
  await pool.query(`ALTER TABLE building_footprints ADD COLUMN IF NOT EXISTS capture_date_end date`);
  await pool.query(`ALTER TABLE building_footprints ADD COLUMN IF NOT EXISTS bf_release int`);
  await pool.query(`DROP TABLE IF EXISTS _ms_bf_v2_raw`);
  await pool.query(`
    CREATE TABLE _ms_bf_v2_raw (
      id bigserial PRIMARY KEY,
      lat double precision NOT NULL,
      lon double precision NOT NULL,
      geom geometry(Point, 4326),
      capture_date_start date,
      capture_date_end date,
      bf_release int
    )
  `);
}

async function streamIngest(pool) {
  log(`streaming ${GEOJSON_PATH}`);
  const t0 = Date.now();
  let total = 0, kept = 0, withDate = 0;
  let batch = [];
  const BATCH_SIZE = 1000;

  async function flush() {
    if (!batch.length) return;
    const placeholders = [];
    const vals = [];
    let i = 1;
    for (const r of batch) {
      placeholders.push(`($${i++},$${i++},ST_SetSRID(ST_MakePoint($${i++},$${i++}),4326),$${i++},$${i++},$${i++})`);
      vals.push(r.lat, r.lon, r.lon, r.lat, r.start, r.end, r.release);
    }
    await pool.query(
      `INSERT INTO _ms_bf_v2_raw (lat, lon, geom, capture_date_start, capture_date_end, bf_release) VALUES ${placeholders.join(',')}`,
      vals,
    );
    batch = [];
  }

  return new Promise((resolve, reject) => {
    const pipeline = chain([
      fs.createReadStream(GEOJSON_PATH),
      parser(),
      pick({ filter: 'features' }),
      streamArray(),
    ]);

    let paused = false;
    pipeline.on('data', async ({ value: feat }) => {
      total++;
      if (!feat || !feat.geometry || !feat.geometry.coordinates) return;
      let coords;
      if (feat.geometry.type === 'Polygon') coords = feat.geometry.coordinates;
      else if (feat.geometry.type === 'MultiPolygon') coords = feat.geometry.coordinates[0];
      else return;

      const c = polygonCentroid(coords);
      if (!c) return;
      const [lon, lat] = c;
      if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) return;

      const props = feat.properties || {};
      const [start, end] = parseDateRange(props.capture_dates_range);
      if (start) withDate++;
      const release = props.release != null ? parseInt(props.release, 10) : null;

      kept++;
      batch.push({ lat, lon, start, end, release });

      if (batch.length >= BATCH_SIZE && !paused) {
        paused = true;
        pipeline.pause();
        try {
          await flush();
        } catch (e) { return reject(e); }
        if (kept % 10000 < BATCH_SIZE) {
          const rate = (total / ((Date.now() - t0) / 1000)).toFixed(0);
          log(`  scanned=${total} kept=${kept} (${(kept * 100 / total).toFixed(1)}%) withDate=${withDate} (${rate} feat/s)`);
        }
        paused = false;
        pipeline.resume();
      }
    });
    pipeline.on('end', async () => {
      try {
        await flush();
        log(`stream done: scanned=${total} kept=${kept} withDate=${withDate}`);
        resolve({ total, kept, withDate });
      } catch (e) { reject(e); }
    });
    pipeline.on('error', reject);
  });
}

async function indexAndJoin(pool) {
  log('building GiST index on _ms_bf_v2_raw.geom');
  await pool.query(`CREATE INDEX _ms_bf_v2_raw_geom_idx ON _ms_bf_v2_raw USING gist(geom)`);
  await pool.query(`ANALYZE _ms_bf_v2_raw`);

  log('joining building_footprints to _ms_bf_v2_raw via ST_DWithin(5m)');
  const r = await pool.query(`
    WITH match AS (
      SELECT bf.id AS bf_id,
             raw.capture_date_start, raw.capture_date_end, raw.bf_release,
             ROW_NUMBER() OVER (
               PARTITION BY bf.id
               ORDER BY ST_Distance(bf.geom::geography, raw.geom::geography)
             ) AS rn
      FROM building_footprints bf
      JOIN _ms_bf_v2_raw raw
        ON ST_DWithin(bf.geom::geography, raw.geom::geography, 5)
      WHERE bf.geom IS NOT NULL
        AND bf.capture_date_end IS NULL
    )
    UPDATE building_footprints bf
    SET capture_date_start = match.capture_date_start,
        capture_date_end = match.capture_date_end,
        bf_release = match.bf_release
    FROM match
    WHERE match.bf_id = bf.id AND match.rn = 1
  `);
  log(`updated ${r.rowCount} rows`);

  const dist = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE capture_date_end IS NOT NULL) AS with_date,
      COUNT(*) FILTER (WHERE bf_release = 1) AS rel1,
      COUNT(*) FILTER (WHERE bf_release = 2) AS rel2,
      MIN(capture_date_start) AS min_start, MAX(capture_date_end) AS max_end
    FROM building_footprints
  `);
  const d = dist.rows[0];
  log(`bf coverage: total=${d.total} with_date=${d.with_date} (${((d.with_date * 100) / d.total).toFixed(1)}%) rel1=${d.rel1} rel2=${d.rel2} range=${d.min_start}..${d.max_end}`);

  // Year distribution of capture_date_end
  const years = await pool.query(`
    SELECT EXTRACT(year FROM capture_date_end)::int AS yr, COUNT(*)
    FROM building_footprints
    WHERE capture_date_end IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `);
  log('capture_date_end year distribution:');
  for (const y of years.rows) log(`  ${y.yr}: ${y.count}`);
}

(async () => {
  const pool = new Pool(DB);
  log('=== backfill-ms-bf-dates v2 ===');
  try {
    downloadIfMissing();
    await ensureSchema(pool);
    await streamIngest(pool);
    await indexAndJoin(pool);
    log('dropping staging _ms_bf_v2_raw');
    await pool.query(`DROP TABLE IF EXISTS _ms_bf_v2_raw`);
  } finally {
    await pool.end();
  }
  try {
    if (fs.existsSync(GEOJSON_PATH)) { log(`cleaning ${GEOJSON_PATH}`); fs.unlinkSync(GEOJSON_PATH); }
    if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);
  } catch (e) { log(`cleanup err: ${e.message}`); }
  log('done.');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
