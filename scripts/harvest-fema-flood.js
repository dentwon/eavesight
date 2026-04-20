#!/usr/bin/env node
/**
 * harvest-fema-flood.js
 *
 * Pulls FEMA National Flood Hazard Layer (NFHL) polygons for the 5-county bbox
 * and assigns femaFloodZone + femaFloodRisk to every property via ST_Within.
 * Idempotent. Writes only to femaFloodZone / femaFloodRisk columns.
 */
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'stormvault', password:'stormvault', database:'stormvault' };
const URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

// North Alabama 5-county bbox (Madison/Limestone/Morgan/Marshall/Jackson)
const BBOX = { xmin: -87.4, ymin: 34.0, xmax: -85.4, ymax: 35.3 };

function riskLabel(zone, sfha) {
  if (!zone) return 'UNKNOWN';
  const z = zone.toUpperCase();
  if (sfha === 'T') return 'HIGH';
  if (z.startsWith('V')) return 'VERY_HIGH';
  if (z.startsWith('A')) return 'HIGH';
  if (z === 'AE' || z === 'AH' || z === 'AO') return 'HIGH';
  if (z === 'X' || z === 'B' || z === 'C') return 'MINIMAL';
  if (z === 'D') return 'UNDETERMINED';
  return 'OTHER';
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120000, rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StormVault/1.0; +https://stormvault.local)', 'Accept': 'application/json' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
      let d=''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(e); }});
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function main() {
  const pool = new Pool(DB);

  await pool.query(`
    DROP TABLE IF EXISTS _fema_flood;
    CREATE UNLOGGED TABLE _fema_flood (
      id serial primary key,
      fld_zone text, zone_subty text, sfha text, risk text,
      geog geography(Polygon, 4326)
    );
  `);

  const geomParam = `${BBOX.xmin},${BBOX.ymin},${BBOX.xmax},${BBOX.ymax}`;
  const base = `${URL}?where=1%3D1&geometry=${encodeURIComponent(geomParam)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=true&outSR=4326&f=json`;

  // Pagination via resultOffset. Max ~100/page because flood polygons are massive.
  // Sub-bbox the query grid to bound each page's payload.
  const GRID = 8; // 8x8 = 64 cells
  let total = 0;
  const dx = (BBOX.xmax - BBOX.xmin) / GRID;
  const dy = (BBOX.ymax - BBOX.ymin) / GRID;

  for (let gx = 0; gx < GRID; gx++) {
    for (let gy = 0; gy < GRID; gy++) {
      const cell = {
        xmin: BBOX.xmin + dx * gx,
        ymin: BBOX.ymin + dy * gy,
        xmax: BBOX.xmin + dx * (gx + 1),
        ymax: BBOX.ymin + dy * (gy + 1),
      };
      const cellParam = `${cell.xmin},${cell.ymin},${cell.xmax},${cell.ymax}`;
      const cellBase = `${URL}?where=1%3D1&geometry=${encodeURIComponent(cellParam)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=true&outSR=4326&f=json`;
      let offset = 0;
      let cellTotal = 0;
      while (true) {
        const url = `${cellBase}&resultOffset=${offset}&resultRecordCount=50`;
        let data;
        let attempt = 0;
        while (attempt < 4) {
          try { data = await fetchJson(url); break; }
          catch (e) { attempt++; await new Promise(r => setTimeout(r, 1500*attempt)); }
        }
        if (!data) break;
        if (data.error) {
          console.warn(`  cell ${gx},${gy} offset=${offset} api err: ${data.error.message} - skipping page`);
          break;
        }
        const features = data.features || [];
        if (features.length === 0) break;

    const rows = [];
    const params = [];
    let pi = 1;
    for (const f of features) {
      const a = f.attributes || {};
      const g = f.geometry;
      if (!g || !g.rings || g.rings.length === 0) continue;
      // Build WKT for a polygon/multipolygon. First ring is outer.
      const rings = g.rings.map(r => '(' + r.map(([x,y]) => `${x} ${y}`).join(', ') + ')').join(',');
      const wkt = `POLYGON(${rings})`;
      const risk = riskLabel(a.FLD_ZONE, a.SFHA_TF);
      rows.push(`($${pi++},$${pi++},$${pi++},$${pi++},ST_GeomFromText($${pi++},4326)::geography)`);
      params.push(a.FLD_ZONE || null, a.ZONE_SUBTY || null, a.SFHA_TF || null, risk, wkt);
    }
    if (rows.length) {
      try {
        await pool.query(`INSERT INTO _fema_flood (fld_zone, zone_subty, sfha, risk, geog) VALUES ${rows.join(',')}`, params);
      } catch (e) {
        console.error('  insert err:', e.message, '- falling back to per-row');
        for (let i = 0; i < rows.length; i++) {
          const idx = i * 5;
          try {
            await pool.query(`INSERT INTO _fema_flood (fld_zone, zone_subty, sfha, risk, geog) VALUES ($1,$2,$3,$4,ST_GeomFromText($5,4326)::geography)`,
              [params[idx], params[idx+1], params[idx+2], params[idx+3], params[idx+4]]);
          } catch(er) { /* skip invalid geom */ }
        }
      }
    }
        total += features.length;
        cellTotal += features.length;
        offset += features.length;
        if (!data.exceededTransferLimit && features.length < 50) break;
      }
      if (cellTotal > 0) console.log(`  cell ${gx},${gy}: ${cellTotal} polygons (total ${total})`);
    }
  }
  console.log(`  Loaded ${total} flood polygons`);

  console.log('\nIndexing flood geog...');
  await pool.query(`CREATE INDEX ON _fema_flood USING gist (geog)`);

  console.log('\nAssigning flood zone to every property via ST_Within...');
  // For each property, find the highest-priority flood zone it sits within.
  // Priority: V > A > X > others.
  const r = await pool.query(`
    WITH ranked AS (
      SELECT
        p.id,
        f.fld_zone,
        f.risk,
        CASE
          WHEN upper(f.fld_zone) LIKE 'V%' THEN 1
          WHEN upper(f.fld_zone) LIKE 'A%' THEN 2
          WHEN upper(f.fld_zone) = 'D' THEN 3
          WHEN upper(f.fld_zone) IN ('X','B','C') THEN 4
          ELSE 5
        END AS prio,
        ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY
          CASE
            WHEN upper(f.fld_zone) LIKE 'V%' THEN 1
            WHEN upper(f.fld_zone) LIKE 'A%' THEN 2
            WHEN upper(f.fld_zone) = 'D' THEN 3
            WHEN upper(f.fld_zone) IN ('X','B','C') THEN 4
            ELSE 5
          END
        ) AS rn
      FROM properties p
      JOIN _fema_flood f
        ON ST_Intersects(f.geog, ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography)
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
    )
    UPDATE properties p
    SET "femaFloodZone" = ranked.fld_zone,
        "femaFloodRisk" = ranked.risk
    FROM ranked
    WHERE ranked.rn = 1 AND p.id = ranked.id
  `);
  console.log(`  Assigned flood zone to ${r.rowCount} properties`);

  // Only default the remainder if we actually loaded polygons (otherwise keep NULL so we know it's missing).
  if (total > 0) {
    const r2 = await pool.query(`
      UPDATE properties
      SET "femaFloodZone" = 'X', "femaFloodRisk" = 'MINIMAL'
      WHERE "femaFloodZone" IS NULL AND county IN ('Madison','Limestone','Morgan','Marshall','Jackson')
    `);
    console.log(`  Defaulted ${r2.rowCount} properties to X/MINIMAL`);
  } else {
    console.log('  Skipping default fill because 0 polygons loaded.');
  }

  const { rows } = await pool.query(`
    SELECT "femaFloodRisk", COUNT(*) FROM properties GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log('\nFlood risk distribution:');
  for (const r of rows) console.log(`  ${r.femaFloodRisk || 'NULL'}: ${r.count}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
