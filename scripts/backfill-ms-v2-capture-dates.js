#!/usr/bin/env node
/**
 * backfill-ms-v2-capture-dates.js  (2026-04-29)
 *
 * Microsoft GlobalMLBuildingFootprints v2 (legacy/usbuildings-v2) ships per-
 * polygon `release` (1 or 2) and `capture_dates_range` (e.g. "3/26/2020-7/22/2020").
 *
 *   Source:  https://minedbuildings.z5.web.core.windows.net/legacy/usbuildings-v2/Alabama.geojson.zip
 *   Format:  GeoJSON FeatureCollection, one feature per line in this build.
 *            Each feature: properties.release ∈ {1,2}, properties.capture_dates_range
 *            ("M/D/YYYY-M/D/YYYY" when known; empty for release=1 features).
 *
 * Pipeline:
 *   1) ALTER TABLE building_footprints ADD COLUMNS for capture_dates_range_start,
 *      capture_dates_range_end, release. Idempotent (IF NOT EXISTS).
 *   2) Stream-parse Alabama.geojson, filter to a generous N-AL bounding box (so
 *      we don't carry hundreds of thousands of irrelevant Birmingham/Mobile
 *      polygons through the spatial join), compute polygon centroid, COPY into
 *      a temp table (ms_v2_candidates).
 *   3) Build a btree index on (lat, lon) of the temp table.
 *   4) For each existing building_footprints row, find the nearest ms_v2_candidate
 *      within ~30m using a bbox prefilter then exact distance — single SQL UPDATE.
 *
 * The handoff doc claimed our existing building_footprints.sourceId values map
 * cleanly to MS v2 feature IDs ("ms-87310" etc.). They DO NOT — verified
 * 2026-04-29 in pre-flight. Falling back to centroid-spatial match.
 *
 * Usage:
 *   node scripts/backfill-ms-v2-capture-dates.js                   # dry-run
 *   node scripts/backfill-ms-v2-capture-dates.js --commit
 *   node scripts/backfill-ms-v2-capture-dates.js --commit --geojson=/tmp/ms-v2/Alabama.geojson
 *   node scripts/backfill-ms-v2-capture-dates.js --commit --bbox=33.5,-88.5,35.5,-85.5
 */
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');

const DB = {
  host: 'localhost',
  port: 5433,
  user: 'eavesight',
  password: 'eavesight',
  database: 'eavesight',
};

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit') || argv.includes('--no-dry-run');
const GEOJSON = (argv.find((a) => a.startsWith('--geojson=')) || '--geojson=/tmp/ms-v2/Alabama.geojson').slice('--geojson='.length);
const BBOX = (argv.find((a) => a.startsWith('--bbox=')) || '--bbox=33.5,-88.5,35.5,-85.5')
  .slice('--bbox='.length).split(',').map(Number);
const [BBOX_S, BBOX_W, BBOX_N, BBOX_E] = BBOX; // south, west, north, east
// Spatial-match tolerance: ~30m at 34°N latitude is ~0.00027° lat, ~0.00033° lon.
// We use 0.0004° as a single tolerance (~44m) to be tolerant of polygon-vs-property
// centroid drift and footprint-source noise. Final scoring picks the closest.
const MATCH_TOLERANCE_DEG = 0.0004;
const LOG_FILE = path.join(__dirname, '..', 'logs', 'backfill-ms-v2-capture-dates.log');

function makeLogger() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return (...args) => {
    const line = `[${new Date().toISOString()}] ${args.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`;
    console.log(line);
    stream.write(line + '\n');
  };
}

function parseDateRange(s) {
  // "3/26/2020-7/22/2020" → ["2020-03-26", "2020-07-22"]; "" → [null, null]
  if (!s) return [null, null];
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})-(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return [null, null];
  const fmt = (mm, dd, yyyy) => `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return [fmt(m[1], m[2], m[3]), fmt(m[4], m[5], m[6])];
}

function polygonCentroid(coords) {
  // GeoJSON Polygon: coordinates is [outerRing, innerRing1, ...]; outerRing is array of [lon,lat] pairs.
  // For tiny building polygons, simple centroid (mean of outer ring vertices)
  // is within a meter of the area-weighted centroid — fine for matching.
  const ring = coords && coords[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sumLon = 0, sumLat = 0, n = 0;
  for (const pt of ring) {
    if (Array.isArray(pt) && pt.length >= 2) {
      sumLon += pt[0];
      sumLat += pt[1];
      n++;
    }
  }
  if (n === 0) return null;
  return [sumLon / n, sumLat / n];
}

async function main() {
  const log = makeLogger();
  log(`Starting MS v2 capture-dates backfill (commit=${COMMIT}) geojson=${GEOJSON} bbox=[${BBOX.join(',')}] tolerance=${MATCH_TOLERANCE_DEG}°`);

  if (!fs.existsSync(GEOJSON)) throw new Error(`GEOJSON file not found: ${GEOJSON}`);

  if (!COMMIT) {
    log('DRY-RUN MODE: no DB writes. Re-run with --commit to write.');
    // In dry-run, just count features inside bbox to validate the pipeline
    const rl = readline.createInterface({
      input: fs.createReadStream(GEOJSON),
      crlfDelay: Infinity,
    });
    let scanned = 0, in_bbox = 0, withDate = 0, byRelease = { 1: 0, 2: 0, other: 0 };
    for await (const raw of rl) {
      let s = raw.trim();
      if (s.endsWith(',')) s = s.slice(0, -1);
      if (!s.startsWith('{')) continue;
      let f;
      try { f = JSON.parse(s); } catch { continue; }
      if (!f || f.type !== 'Feature') continue;
      scanned++;
      const c = polygonCentroid(f.geometry && f.geometry.coordinates);
      if (!c) continue;
      const [lon, lat] = c;
      if (lat < BBOX_S || lat > BBOX_N || lon < BBOX_W || lon > BBOX_E) continue;
      in_bbox++;
      const rel = f.properties && Number.isFinite(f.properties.release) ? f.properties.release : null;
      if (rel === 1) byRelease[1]++; else if (rel === 2) byRelease[2]++; else byRelease.other++;
      const [s0] = parseDateRange(f.properties && f.properties.capture_dates_range);
      if (s0) withDate++;
      if (scanned % 200000 === 0) log(`dry-run: scanned=${scanned} in_bbox=${in_bbox} withDate=${withDate}`);
    }
    log(`dry-run complete: scanned=${scanned} in_bbox=${in_bbox} withDate=${withDate} release1=${byRelease[1]} release2=${byRelease[2]} other=${byRelease.other}`);
    log(`Re-run with --commit to ALTER TABLE + load + UPDATE building_footprints.`);
    return;
  }

  const pool = new Pool(DB);
  try {
    // 1) ALTER TABLE — idempotent
    log('ALTER TABLE building_footprints ADD COLUMNS (idempotent)');
    await pool.query(`
      ALTER TABLE building_footprints
        ADD COLUMN IF NOT EXISTS capture_dates_range_start date,
        ADD COLUMN IF NOT EXISTS capture_dates_range_end   date,
        ADD COLUMN IF NOT EXISTS release int;
    `);

    // 2) Stream-parse GeoJSON → write CSV to disk
    const csvPath = '/tmp/ms-v2-candidates.csv';
    log(`Streaming MS v2 features into CSV at ${csvPath}…`);
    const out = fs.createWriteStream(csvPath);
    let scanned = 0, in_bbox = 0;
    const rl = readline.createInterface({
      input: fs.createReadStream(GEOJSON),
      crlfDelay: Infinity,
    });
    for await (const raw of rl) {
      let s = raw.trim();
      if (s.endsWith(',')) s = s.slice(0, -1);
      if (!s.startsWith('{')) continue;
      let f;
      try { f = JSON.parse(s); } catch { continue; }
      if (!f || f.type !== 'Feature' || !f.geometry || f.geometry.type !== 'Polygon') continue;
      const c = polygonCentroid(f.geometry.coordinates);
      if (!c) continue;
      const [lon, lat] = c;
      scanned++;
      if (lat < BBOX_S || lat > BBOX_N || lon < BBOX_W || lon > BBOX_E) continue;
      in_bbox++;
      const release = f.properties && Number.isFinite(f.properties.release) ? f.properties.release : null;
      const [startDate, endDate] = parseDateRange(f.properties && f.properties.capture_dates_range);
      const csv = [
        lon.toFixed(7),
        lat.toFixed(7),
        release == null ? '\\N' : release,
        startDate || '\\N',
        endDate || '\\N',
      ].join(',') + '\n';
      if (!out.write(csv)) await new Promise((r) => out.once('drain', r));
      if (scanned % 200000 === 0) log(`scan: ${scanned} features parsed, ${in_bbox} inside bbox`);
    }
    await new Promise((r) => out.end(r));
    log(`scan complete: scanned=${scanned} in_bbox=${in_bbox}`);

    // 3) Load CSV to a permanent staging table via psql \copy (much faster than per-row INSERTs).
    //    Use a regular table (not TEMP) so it survives the psql session and we
    //    can UPDATE FROM it via the pg pool afterward.
    log('Loading CSV into ms_v2_candidates staging table via psql \\copy…');
    await pool.query(`
      DROP TABLE IF EXISTS ms_v2_candidates;
      CREATE TABLE ms_v2_candidates (
        lon double precision NOT NULL,
        lat double precision NOT NULL,
        release int,
        capture_start date,
        capture_end date
      );
    `);
    const env = { ...process.env, PGPASSWORD: DB.password };
    execFileSync('psql', [
      '-h', DB.host, '-p', String(DB.port), '-U', DB.user, '-d', DB.database,
      '-c', `\\copy ms_v2_candidates (lon, lat, release, capture_start, capture_end) FROM '${csvPath}' WITH (FORMAT csv, NULL '\\N')`,
    ], { env, stdio: 'inherit' });
    await pool.query(`CREATE INDEX IF NOT EXISTS ms_v2_candidates_latlon_idx ON ms_v2_candidates (lat, lon)`);
    const r = await pool.query(`SELECT COUNT(*) AS n FROM ms_v2_candidates`);
    log(`ms_v2_candidates row count: ${r.rows[0].n}`);

    // 4) UPDATE building_footprints from nearest match within tolerance.
    //    DISTINCT ON keeps one match per footprint (the closest).
    log('UPDATE building_footprints from nearest ms_v2_candidates within tolerance…');
    const updRes = await pool.query(`
      WITH nearest AS (
        SELECT DISTINCT ON (bf.id)
          bf.id AS bf_id,
          c.release,
          c.capture_start,
          c.capture_end,
          (bf."centroidLat" - c.lat) * (bf."centroidLat" - c.lat)
            + (bf."centroidLon" - c.lon) * (bf."centroidLon" - c.lon) AS sqd
        FROM building_footprints bf
        JOIN ms_v2_candidates c
          ON c.lat BETWEEN bf."centroidLat" - $1 AND bf."centroidLat" + $1
         AND c.lon BETWEEN bf."centroidLon" - $1 AND bf."centroidLon" + $1
        WHERE bf."centroidLat" IS NOT NULL AND bf."centroidLon" IS NOT NULL
        ORDER BY bf.id, sqd
      )
      UPDATE building_footprints bf
      SET capture_dates_range_start = nearest.capture_start,
          capture_dates_range_end   = nearest.capture_end,
          release                   = nearest.release
      FROM nearest
      WHERE bf.id = nearest.bf_id
        AND (bf.capture_dates_range_start IS DISTINCT FROM nearest.capture_start
          OR bf.capture_dates_range_end   IS DISTINCT FROM nearest.capture_end
          OR bf.release                   IS DISTINCT FROM nearest.release)
    `, [MATCH_TOLERANCE_DEG]);
    log(`UPDATE done. rows affected: ${updRes.rowCount}`);

    // Sanity-check distribution
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(release) AS with_release,
        COUNT(*) FILTER (WHERE release = 1) AS release_1,
        COUNT(*) FILTER (WHERE release = 2) AS release_2,
        COUNT(capture_dates_range_end) AS with_capture_end,
        MIN(capture_dates_range_start) AS earliest_start,
        MAX(capture_dates_range_end)   AS latest_end
      FROM building_footprints
    `);
    log(`post-backfill stats: ${JSON.stringify(stats.rows[0])}`);

    // Cleanup staging table
    await pool.query(`DROP TABLE IF EXISTS ms_v2_candidates`);
    log('Dropped ms_v2_candidates staging table.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
