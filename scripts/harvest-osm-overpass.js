#!/usr/bin/env node
/**
 * harvest-osm-overpass.js
 *
 * Pulls every commercial/industrial POI in the 5-county AOI from the
 * OpenStreetMap Overpass API, loads into _osm_poi, then spatial-matches
 * to properties (COMMERCIAL / INDUSTRIAL / MULTI_FAMILY / big roof) to
 * populate businessName / businessCategory / businessWebsite / businessPhone.
 *
 * Free. No key. Be nice: 2s spacing between Overpass queries.
 */
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'eavesight', password:'eavesight', database:'eavesight' };

// Huntsville-area county bounding boxes (S,W,N,E)
const COUNTIES = [
  { name: 'Madison',   bbox: [34.45, -86.95, 35.01, -86.33] },
  { name: 'Limestone', bbox: [34.56, -87.14, 35.00, -86.74] },
  { name: 'Morgan',    bbox: [34.25, -87.11, 34.67, -86.62] },
  { name: 'Marshall',  bbox: [34.06, -86.58, 34.54, -86.07] },
  { name: 'Jackson',   bbox: [34.42, -86.30, 35.00, -85.60] },
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function postOverpass(endpoint, query) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const body = 'data=' + encodeURIComponent(query);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Eavesight-DataDragnet/1.0 (dentwon@gmail.com)',
      },
      timeout: 180000,
    }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode+' from '+u.hostname)); }
      let d=''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(e); }});
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function queryWithFallback(query) {
  let lastErr;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      return await postOverpass(ep, query);
    } catch (e) {
      lastErr = e;
      console.log(`    ${ep} failed: ${e.message}, trying next...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

function buildQuery(s, w, n, e) {
  // Pull nodes + ways + relations tagged with any business-like key
  return `
[out:json][timeout:120];
(
  node["shop"](${s},${w},${n},${e});
  way["shop"](${s},${w},${n},${e});
  node["office"](${s},${w},${n},${e});
  way["office"](${s},${w},${n},${e});
  node["amenity"~"^(restaurant|fast_food|cafe|bar|pub|bank|pharmacy|hospital|clinic|school|university|library|fuel|car_wash|car_rental|parking|police|fire_station|post_office|place_of_worship|community_centre|theatre|cinema|nightclub|marketplace|veterinary)$"](${s},${w},${n},${e});
  way["amenity"~"^(restaurant|fast_food|cafe|bar|pub|bank|pharmacy|hospital|clinic|school|university|library|fuel|car_wash|car_rental|parking|police|fire_station|post_office|place_of_worship|community_centre|theatre|cinema|nightclub|marketplace|veterinary)$"](${s},${w},${n},${e});
  node["tourism"~"^(hotel|motel)$"](${s},${w},${n},${e});
  way["tourism"~"^(hotel|motel)$"](${s},${w},${n},${e});
  way["building"~"^(commercial|industrial|retail|warehouse|office|supermarket|hotel|school|hospital|church|train_station)$"](${s},${w},${n},${e});
  way["industrial"](${s},${w},${n},${e});
  way["man_made"="storage_tank"](${s},${w},${n},${e});
);
out center tags;
`.trim();
}

function featureCenter(el) {
  if (el.type === 'node') return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

function pickCategory(tags) {
  if (tags.shop)            return { category: 'retail',     sub: tags.shop };
  if (tags.office)          return { category: 'office',     sub: tags.office };
  if (tags.amenity)         return { category: 'amenity',    sub: tags.amenity };
  if (tags.tourism)         return { category: 'lodging',    sub: tags.tourism };
  if (tags.industrial)      return { category: 'industrial', sub: tags.industrial };
  if (tags.building === 'warehouse')   return { category: 'warehouse',   sub: 'warehouse' };
  if (tags.building === 'industrial')  return { category: 'industrial',  sub: 'industrial' };
  if (tags.building === 'retail')      return { category: 'retail',      sub: 'retail' };
  if (tags.building === 'commercial')  return { category: 'commercial',  sub: 'commercial' };
  if (tags.building === 'office')      return { category: 'office',      sub: 'office' };
  if (tags.building === 'supermarket') return { category: 'retail',      sub: 'supermarket' };
  if (tags.building === 'hotel')       return { category: 'lodging',     sub: 'hotel' };
  if (tags.building === 'school')      return { category: 'education',   sub: 'school' };
  if (tags.building === 'hospital')    return { category: 'healthcare',  sub: 'hospital' };
  if (tags.building === 'church')      return { category: 'religion',    sub: 'church' };
  if (tags.building === 'train_station') return { category: 'transport', sub: 'station' };
  return { category: 'other', sub: tags.building || 'unknown' };
}

async function harvest(pool) {
  let total = 0;
  for (const county of COUNTIES) {
    console.log(`\n=== ${county.name} (${county.bbox.join(',')}) ===`);
    const [s,w,n,e] = county.bbox;
    let data;
    try {
      data = await queryWithFallback(buildQuery(s,w,n,e));
    } catch (err) {
      console.error(`  ${county.name} failed: ${err.message}`);
      continue;
    }
    const elements = data.elements || [];
    console.log(`  fetched ${elements.length} elements`);

    const rows = [];
    for (const el of elements) {
      const c = featureCenter(el);
      if (!c) continue;
      const tags = el.tags || {};
      // Must have a name or a meaningful category to be useful
      const name = tags.name || tags['brand'] || tags.operator;
      if (!name && !tags.shop && !tags.office && !tags.amenity && !tags.tourism && !tags.industrial && !tags.building) continue;
      const { category, sub } = pickCategory(tags);
      const addr = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
      rows.push([
        el.id, el.type,
        name || null,
        category, sub,
        tags.website || tags['contact:website'] || null,
        tags.phone || tags['contact:phone'] || null,
        addr || null,
        c.lat, c.lon,
      ]);
    }

    // bulk insert
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i+BATCH);
      const params = [];
      const values = [];
      let pi = 1;
      for (const r of chunk) {
        const ph = [];
        for (let k = 0; k < 10; k++) ph.push('$' + (pi++));
        values.push('(' + ph.join(',') + ')');
        params.push(...r);
      }
      await pool.query(
        `INSERT INTO _osm_poi (osm_id, osm_type, name, category, subcategory, website, phone, addr, lat, lon)
         VALUES ${values.join(',')}`,
        params
      );
    }
    total += rows.length;
    console.log(`  ${county.name}: ${rows.length} POIs loaded`);

    // Be kind to Overpass
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`\nTotal POIs harvested: ${total}`);
}

async function main() {
  const pool = new Pool(DB);

  await harvest(pool);

  console.log('\nBuilding POI geog index...');
  await pool.query(`UPDATE _osm_poi SET geog = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography WHERE lat IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS _osm_poi_geog_idx ON _osm_poi USING gist (geog)`);

  console.log('\nMatching POIs -> commercial/industrial properties (KNN 80m)...');
  // 80m covers typical parcel depth; Overpass POIs often sit in the road or on
  // the building footprint itself — both should pull the right parcel.
  const r = await pool.query(`
    WITH matches AS (
      SELECT DISTINCT ON (p.id)
        p.id AS property_id,
        nearest.name, nearest.category, nearest.subcategory,
        nearest.website, nearest.phone, nearest.osm_id, nearest.osm_type,
        ST_Distance(ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography, nearest.geog) AS dist_m
      FROM properties p
      CROSS JOIN LATERAL (
        SELECT op.*
        FROM _osm_poi op
        WHERE op.name IS NOT NULL
          AND op.geog IS NOT NULL
        ORDER BY op.geog <-> ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography
        LIMIT 1
      ) nearest
      WHERE (p."propertyType" IN ('COMMERCIAL','INDUSTRIAL','MULTI_FAMILY')
             OR p."roofSizeClass" IN ('SMALL_COMMERCIAL','MEDIUM_COMMERCIAL','LARGE_COMMERCIAL','WAREHOUSE_INDUSTRIAL'))
        AND p.lat IS NOT NULL AND p.lon IS NOT NULL
        AND p."businessName" IS NULL
    )
    UPDATE properties p
    SET
      "businessName"     = matches.name,
      "businessCategory" = matches.category || ':' || matches.subcategory,
      "businessWebsite"  = matches.website,
      "businessPhone"    = matches.phone,
      "businessSource"   = 'osm-overpass-' || matches.osm_type || '-' || matches.osm_id
    FROM matches
    WHERE p.id = matches.property_id AND matches.dist_m <= 80
  `);
  console.log(`Filled ${r.rowCount} properties with OSM business data`);

  const { rows } = await pool.query(`
    SELECT county, COUNT(*) FILTER (WHERE "businessName" IS NOT NULL) with_biz,
           COUNT(*) FILTER (WHERE ("propertyType" IN ('COMMERCIAL','INDUSTRIAL','MULTI_FAMILY')
                               OR "roofSizeClass" IN ('SMALL_COMMERCIAL','MEDIUM_COMMERCIAL','LARGE_COMMERCIAL','WAREHOUSE_INDUSTRIAL'))) candidates
    FROM properties GROUP BY county ORDER BY 3 DESC
  `);
  console.log('\nCommercial business coverage by county:');
  for (const r of rows) console.log(`  ${r.county}: ${r.with_biz}/${r.candidates} business-named`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
