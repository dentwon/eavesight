#!/usr/bin/env node
/**
 * harvest-osm-startdate.js
 *
 * Pull every OSM way tagged building=* WITH a start_date or
 * building:start_date in the 5-county N-AL bbox via the Overpass API
 * (free, public). Match each way's centroid to a property by
 * approximate lat/lon proximity (default 50 m), and update the
 * property's yearBuilt + yearBuiltSource if (a) we don't have a real
 * yearBuilt yet and (b) the OSM start_date parses to a 4-digit year.
 *
 * Yield is small — agent verified ~300 ways exist in the bbox — but
 * every one we land is a free, real-data ground-truth year.
 *
 * Usage:
 *   node scripts/harvest-osm-startdate.js              # dry-run
 *   node scripts/harvest-osm-startdate.js --commit     # actually update
 */

const https = require('https');
const { Pool } = require('pg');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const RADIUS_M = (() => {
  const a = args.find((x) => x.startsWith('--radius='));
  return a ? parseFloat(a.split('=')[1]) : 50;
})();

// 5-county bbox: lat 34.10-35.00, lon -87.20 to -85.50
const BBOX = '34.10,-87.20,35.00,-85.50';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

const QUERY = `
[out:json][timeout:180];
(
  way["building"]["start_date"](${BBOX});
  way["building"]["building:start_date"](${BBOX});
  relation["building"]["start_date"](${BBOX});
);
out center tags;
`.trim();

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  user: process.env.DB_USER || 'eavesight',
  password: process.env.DB_PASS || 'eavesight',
  database: process.env.DB_NAME || 'eavesight',
};

function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const data = 'data=' + encodeURIComponent(query);
    const url = new URL(OVERPASS);
    const req = https.request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'eavesight-osm-harvester/1.0',
        },
        timeout: 200000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function parseYear(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  if (y < 1700 || y > new Date().getFullYear() + 1) return null;
  return y;
}

(async () => {
  const tag = COMMIT ? 'COMMIT' : 'DRY-RUN';
  console.log(`=== harvest-osm-startdate (${tag}) bbox=${BBOX} radius=${RADIUS_M}m ===`);

  console.log('Querying Overpass...');
  const t0 = Date.now();
  const data = await fetchOverpass(QUERY);
  console.log(`got ${data.elements?.length || 0} elements in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const candidates = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const startDate = tags['start_date'] || tags['building:start_date'];
    const year = parseYear(startDate);
    if (!year) continue;

    let lat, lon;
    if (el.type === 'node') {
      lat = el.lat;
      lon = el.lon;
    } else if (el.center) {
      lat = el.center.lat;
      lon = el.center.lon;
    } else {
      continue;
    }
    candidates.push({
      osmId: `${el.type}/${el.id}`,
      lat,
      lon,
      year,
      raw: startDate,
      buildingType: tags.building,
    });
  }
  console.log(`parseable: ${candidates.length} (with valid 4-digit year)`);

  if (candidates.length === 0) {
    console.log('nothing to do');
    return;
  }

  // Year distribution
  const yearDist = candidates.reduce((m, c) => {
    const decade = Math.floor(c.year / 10) * 10;
    m[decade] = (m[decade] || 0) + 1;
    return m;
  }, {});
  const decades = Object.keys(yearDist).sort();
  console.log('decade distribution:');
  for (const d of decades) console.log(`  ${d}s: ${yearDist[d]}`);

  // Match to properties
  const pool = new Pool(DB);
  let matched = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;
  const samples = [];

  for (const c of candidates) {
    // Approx 1 deg lat = 111km, 1 deg lon at 35deg lat = 91km.
    // Use a small bbox + ORDER BY actual distance.
    const dLat = RADIUS_M / 111000;
    const dLon = RADIUS_M / 91000;
    const { rows } = await pool.query(
      `SELECT id, "yearBuilt", "yearBuiltSource", lat, lon, address
       FROM properties
       WHERE lat BETWEEN $1 AND $2
         AND lon BETWEEN $3 AND $4
       ORDER BY ((lat - $5)*(lat - $5) + (lon - $6)*(lon - $6))
       LIMIT 1`,
      [c.lat - dLat, c.lat + dLat, c.lon - dLon, c.lon + dLon, c.lat, c.lon],
    );
    if (rows.length === 0) continue;
    matched++;

    const prop = rows[0];
    const isReal = prop.yearBuiltSource === 'madison-assessor-scrape'
      || prop.yearBuiltSource === 'huntsville-coc-new-construction'
      || prop.yearBuiltSource === 'marshall-assessor-scrape'
      || prop.yearBuiltSource === 'osm-start-date'; // already done

    if (isReal) {
      wouldSkip++;
      continue;
    }

    if (samples.length < 5) {
      samples.push({
        osmId: c.osmId,
        proposed_year: c.year,
        existing_year: prop.yearBuilt,
        existing_source: prop.yearBuiltSource,
        property_id: prop.id,
        address: prop.address,
      });
    }

    if (COMMIT) {
      await pool.query(
        `UPDATE properties
         SET "yearBuilt" = $1,
             "yearBuiltSource" = 'osm-start-date',
             "updatedAt" = NOW()
         WHERE id = $2`,
        [c.year, prop.id],
      );
    }
    wouldUpdate++;
  }

  console.log(`\nmatched=${matched} wouldUpdate=${wouldUpdate} wouldSkip=${wouldSkip}`);
  if (samples.length) {
    console.log('\nsample updates:');
    for (const s of samples) {
      console.log(`  ${s.property_id}  ${s.address}  ${s.existing_year}/${s.existing_source} -> ${s.proposed_year}/osm-start-date  (osm:${s.osmId})`);
    }
  }
  if (!COMMIT) console.log('\nDRY-RUN — pass --commit to apply');
  else console.log(`\nupdated ${wouldUpdate} rows`);

  await pool.end();
})().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
