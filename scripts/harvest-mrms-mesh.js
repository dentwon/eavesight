#!/usr/bin/env node
/**
 * harvest-mrms-mesh.js
 *
 * For every property in AL, computes a Hail Exposure Index (HEI) from NOAA
 * MRMS MESH_Max_1440min (daily maximum hail size) archive hosted by Iowa
 * State's MTARCHIVE. Back to 2015 by default; expand via START_YEAR env.
 *
 * Moat: no competitor publishes a property-level physics-grounded hail
 * exposure score. We do — all from a free 1km grid archive.
 *
 * Output: properties.hailExposureIndex  (cumulative hail-inch exposure)
 *         properties.hailEventCount     (# days with >= 0.75" hail over property)
 *         properties.hailExposureDetails (jsonb: top 10 worst days)
 */
const { Pool } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB = { host:'localhost', port:5433, user:'stormvault', password:'stormvault', database:'stormvault' };
const CACHE_DIR = '/home/dentwon/.mrms-cache';
const START_YEAR = parseInt(process.env.START_YEAR || '2015');
const END_YEAR = parseInt(process.env.END_YEAR || String(new Date().getFullYear()));
// 5-county AL bounding box
const BBOX = { west: -87.2, east: -85.55, south: 34.02, north: 35.05 };

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function fetchBinary(url, outPath) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(outPath);
    https.get(url, { timeout: 120000 }, res => {
      if (res.statusCode === 404) { res.resume(); f.close(); try { fs.unlinkSync(outPath); } catch {} return resolve(null); }
      if (res.statusCode !== 200) { res.resume(); f.close(); return reject(new Error('HTTP '+res.statusCode)); }
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(outPath)));
    }).on('error', reject);
  });
}

function ymd(d) {
  return [d.getUTCFullYear(), String(d.getUTCMonth()+1).padStart(2,'0'), String(d.getUTCDate()).padStart(2,'0')];
}

async function downloadMeshDay(date) {
  const [Y,M,D] = ymd(date);
  // Iowa State archive: MESH files are written every 30m at elevation 00.50.
  // The 23:30 file has the rolling 24h max through end-of-day.
  const fn = `MESH_Max_1440min_00.50_${Y}${M}${D}-233000.grib2.gz`;
  const cachedGz = path.join(CACHE_DIR, fn);
  const cachedTif = cachedGz.replace('.grib2.gz', '_clip.tif');
  if (fs.existsSync(cachedTif)) return cachedTif;

  const url = `https://mtarchive.geol.iastate.edu/${Y}/${M}/${D}/mrms/ncep/MESH_Max_1440min/${fn}`;
  try {
    const got = await fetchBinary(url, cachedGz);
    if (!got) return null; // 404 — day missing from archive
    // Clip to AL bbox + convert GRIB2→GeoTIFF in one gdal call. Fast because
    // GDAL streams the relevant tiles only.
    execSync(
      `gdal_translate -q -projwin ${BBOX.west} ${BBOX.north} ${BBOX.east} ${BBOX.south} ` +
      `-of GTiff /vsigzip/${cachedGz} ${cachedTif} 2>/dev/null`,
      { stdio: 'pipe' }
    );
    fs.unlinkSync(cachedGz); // don't keep the 20MB source once clipped
    return cachedTif;
  } catch (e) {
    // Don't let single-day failures kill the run
    if (fs.existsSync(cachedGz)) try { fs.unlinkSync(cachedGz); } catch {}
    console.log(`    ${Y}-${M}-${D}: ${e.message}`);
    return null;
  }
}

/**
 * Sample the clipped raster at every property coordinate using gdallocationinfo.
 * MESH values are in millimeters; we convert to inches.
 */
function sampleRasterForProperties(tif, props) {
  // Write property coords to stdin-friendly file
  const coordFile = path.join(CACHE_DIR, 'coords.txt');
  fs.writeFileSync(coordFile, props.map(p => `${p.lon} ${p.lat}`).join('\n'));
  try {
    const out = execSync(`gdallocationinfo -valonly -geoloc ${tif} < ${coordFile}`, { encoding: 'utf8' });
    const values = out.trim().split('\n').map(v => {
      const n = parseFloat(v);
      return isFinite(n) && n > 0 ? n / 25.4 : 0; // mm → inches, zero out no-data
    });
    return values;
  } catch (e) {
    return props.map(() => 0);
  }
}

async function main() {
  const pool = new Pool(DB);

  // Add columns if missing
  await pool.query(`
    ALTER TABLE properties
      ADD COLUMN IF NOT EXISTS "hailExposureIndex" double precision DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "hailEventCount" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "hailExposureDetails" jsonb DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "hailExposureComputedAt" timestamp with time zone
  `);

  // Load all property coords
  const { rows: properties } = await pool.query(
    `SELECT id, lat, lon FROM properties WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY id`
  );
  console.log(`Loaded ${properties.length} properties`);

  // Running totals per property (in-memory, flushed at end)
  const totals = new Map();
  const events = new Map(); // propertyId -> array of {date, inches}
  for (const p of properties) {
    totals.set(p.id, { idx: 0, count: 0 });
    events.set(p.id, []);
  }

  // Iterate day-by-day
  const start = new Date(Date.UTC(START_YEAR, 0, 1));
  const end = new Date(Date.UTC(END_YEAR, 11, 31));
  let processed = 0, hits = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const tif = await downloadMeshDay(new Date(d));
    if (!tif) continue;
    const vals = sampleRasterForProperties(tif, properties);
    let dayHits = 0;
    for (let i = 0; i < properties.length; i++) {
      const v = vals[i];
      if (v > 0.25) { // meaningful hail (>1/4 inch)
        const t = totals.get(properties[i].id);
        t.idx += v;
        if (v >= 0.75) { // severe hail threshold
          t.count += 1;
          events.get(properties[i].id).push({ date: d.toISOString().slice(0,10), in: Math.round(v*100)/100 });
        }
        dayHits++;
      }
    }
    processed++;
    if (dayHits > 0) hits++;
    if (processed % 50 === 0) {
      const [Y,M,D] = ymd(d);
      console.log(`  ${Y}-${M}-${D}  processed=${processed}  days-with-hail=${hits}`);
    }
  }

  console.log(`\nFlushing to DB...`);
  // Keep only top-10 worst events per property to bound jsonb size
  const BATCH = 500;
  const entries = [...totals.entries()];
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i+BATCH);
    const params = [];
    const values = [];
    let pi = 1;
    for (const [propId, t] of chunk) {
      const top = events.get(propId)
        .sort((a,b) => b.in - a.in)
        .slice(0, 10);
      values.push(`($${pi++}::text, $${pi++}::double precision, $${pi++}::integer, $${pi++}::jsonb)`);
      params.push(propId, Math.round(t.idx*100)/100, t.count, JSON.stringify(top));
    }
    await pool.query(`
      UPDATE properties p
      SET "hailExposureIndex" = v.idx,
          "hailEventCount" = v.cnt,
          "hailExposureDetails" = v.details,
          "hailExposureComputedAt" = NOW()
      FROM (VALUES ${values.join(',')}) AS v(id, idx, cnt, details)
      WHERE p.id = v.id
    `, params);
    if ((i/BATCH) % 20 === 0) console.log(`  flushed ${i+chunk.length}/${entries.length}`);
  }

  const { rows: summary } = await pool.query(`
    SELECT
      COUNT(*) total,
      COUNT(*) FILTER (WHERE "hailExposureIndex" > 0) exposed,
      ROUND(AVG("hailExposureIndex")::numeric, 2) avg_idx,
      ROUND(MAX("hailExposureIndex")::numeric, 2) max_idx,
      ROUND(AVG("hailEventCount")::numeric, 1) avg_events
    FROM properties
  `);
  console.log('\nFinal:', summary[0]);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
