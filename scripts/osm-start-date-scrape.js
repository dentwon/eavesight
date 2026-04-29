#!/usr/bin/env node
/**
 * osm-start-date-scrape.js  (2026-04-29)
 *
 * Per `docs/IMAGERY_DATING_HONEST_AUDIT.md` §4: ~300 buildings in N-AL
 * carry an OpenStreetMap `start_date` tag (year of construction). These
 * are mostly downtown commercial + landmarks; coverage is sparse but
 * the signal is high-confidence on the rows that have it.
 *
 * Pipeline:
 *   1) POST a single Overpass QL query for buildings within the N-AL bbox
 *      that have `start_date=*`
 *   2) Parse the JSON response (Overpass returns elements with center/
 *      polygon geometry + tags)
 *   3) Normalize start_date strings (mixed: 4-digit "1923", ISO "1923-01-01",
 *      English "January 1923" — drop anything we can't parse)
 *   4) Spatial-match each tagged building to a property via existing
 *      building_footprints centroid (within 30m)
 *   5) emitSignal('osm_start_date', source='osm', confidence=0.50)
 *
 * Idempotent re-runs via property_signals unique constraint (sourceRecordId
 * is the OSM id like 'osm:way/12345').
 *
 * Usage:
 *   node scripts/osm-start-date-scrape.js                # dry-run
 *   node scripts/osm-start-date-scrape.js --commit
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { emitSignal } = require('./lib/property-signal-emit');

const DB = {
  host: 'localhost',
  port: 5433,
  user: 'eavesight',
  password: 'eavesight',
  database: 'eavesight',
};

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit') || argv.includes('--no-dry-run');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'osm-start-date-scrape.log');

// N-AL bbox (south, west, north, east) — overpass uses (s, w, n, e).
const BBOX = [33.5, -88.5, 35.5, -85.5];
// Overpass endpoint
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'Eavesight-OSM/1.0 (admin@eavesight.io)';
const SPATIAL_TOLERANCE_DEG = 0.0004; // ~44m

function makeLogger() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return (...args) => {
    const line = `[${new Date().toISOString()}] ${args.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`;
    console.log(line);
    stream.write(line + '\n');
  };
}

function postOverpass(query) {
  return new Promise((resolve, reject) => {
    const u = new URL(OVERPASS);
    const body = `data=${encodeURIComponent(query)}`;
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname,
      timeout: 120000,
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Overpass HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 500)}`));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('overpass timeout')));
    req.write(body);
    req.end();
  });
}

function parseStartDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // 4-digit year only
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) {
    const yr = Number(yearOnly[1]);
    if (yr >= 1700 && yr <= 2030) return `${yr}-01-01`;
  }
  // ISO date
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  // ISO month
  const isoMo = s.match(/^(\d{4})-(\d{2})$/);
  if (isoMo) return `${isoMo[1]}-${isoMo[2]}-01`;
  // English "Month YYYY" or "DD Month YYYY"
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const en = s.toLowerCase().match(/(?:(\d{1,2})\s+)?(\w+)\s+(\d{4})/);
  if (en) {
    const monthIdx = monthNames.indexOf(en[2]);
    if (monthIdx >= 0) {
      const day = en[1] ? Number(en[1]) : 1;
      const yr = Number(en[3]);
      if (yr >= 1700 && yr <= 2030) {
        return `${yr}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  // Approx: "ca. 1850" / "c.1900"
  const approx = s.match(/(\d{4})/);
  if (approx) {
    const yr = Number(approx[1]);
    if (yr >= 1700 && yr <= 2030) return `${yr}-01-01`;
  }
  return null;
}

async function main() {
  const log = makeLogger();
  log(`Starting OSM start_date scrape (commit=${COMMIT}) bbox=[${BBOX.join(',')}]`);

  const query = `[out:json][timeout:90];
(
  way["building"]["start_date"](${BBOX.join(',')});
  relation["building"]["start_date"](${BBOX.join(',')});
);
out tags center;`;
  log('Posting Overpass query...');
  let resp;
  try {
    resp = await postOverpass(query);
  } catch (e) {
    log(`Overpass POST failed: ${e.message}`);
    process.exit(1);
  }
  const elements = resp.elements || [];
  log(`Overpass returned ${elements.length} tagged buildings`);

  let parsed = 0, unparseable = 0;
  const candidates = elements.map((el) => {
    const center = el.center || (el.lat && el.lon ? { lat: el.lat, lon: el.lon } : null);
    if (!center) { return null; }
    const date = parseStartDate(el.tags && el.tags.start_date);
    if (!date) { unparseable++; return null; }
    parsed++;
    return {
      osmId: `${el.type}/${el.id}`,
      lat: center.lat,
      lon: center.lon,
      date,
      tags: el.tags,
    };
  }).filter(Boolean);
  log(`Parsed dates: ${parsed} ok, ${unparseable} unparseable`);

  if (candidates.length === 0) {
    log('No candidates with parseable dates — exiting.');
    return;
  }

  // Output a sample so we can sanity-check
  for (const c of candidates.slice(0, 5)) {
    log(`SAMPLE: ${c.osmId} at (${c.lat.toFixed(5)},${c.lon.toFixed(5)}) date=${c.date} name=${c.tags?.name || c.tags?.['addr:housename'] || '(unnamed)'}`);
  }

  if (!COMMIT) {
    log('DRY-RUN MODE — no DB writes. Re-run with --commit to write.');
    return;
  }

  // Spatial-match each candidate to a property via building_footprints centroid.
  const pool = new Pool(DB);
  let matched = 0, multipleMatch = 0, noMatch = 0, inserted = 0, skipped = 0;
  try {
    for (const c of candidates) {
      const r = await pool.query(`
        SELECT bf."propertyId" AS property_id,
               (bf."centroidLat" - $1)*(bf."centroidLat" - $1) + (bf."centroidLon" - $2)*(bf."centroidLon" - $2) AS sqd
          FROM building_footprints bf
         WHERE bf."centroidLat" BETWEEN $1 - $3 AND $1 + $3
           AND bf."centroidLon" BETWEEN $2 - $3 AND $2 + $3
         ORDER BY sqd ASC
         LIMIT 2
      `, [c.lat, c.lon, SPATIAL_TOLERANCE_DEG]);
      if (r.rows.length === 0) { noMatch++; continue; }
      // Take closest if unique within 2x tolerance, else skip ambiguous
      if (r.rows.length === 2 && r.rows[1].sqd < 4 * r.rows[0].sqd) {
        multipleMatch++;
        continue;
      }
      matched++;
      const result = await emitSignal({
        pool,
        propertyId: r.rows[0].property_id,
        signalType: 'osm_start_date',
        signalValue: { osmId: c.osmId, tags: c.tags },
        signalDate: c.date,
        confidence: 0.50,
        source: 'osm',
        sourceRecordId: `osm:${c.osmId}`,
      });
      if (result.inserted) inserted++; else skipped++;
    }
  } finally {
    await pool.end();
  }

  log(`done. candidates=${candidates.length} matched=${matched} ambiguous=${multipleMatch} noMatch=${noMatch} inserted=${inserted} dedupedSkipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
