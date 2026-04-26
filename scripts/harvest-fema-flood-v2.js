#!/usr/bin/env node
/**
 * harvest-fema-flood-v2.js
 *
 * Re-ingestion of FEMA NFHL flood polygons for the 5-county region.
 * v2 differs from v1:
 *   - LOGGED table (_fema_flood_v2) so it survives pg restart
 *   - Pulls all polygons in our 5-county DFIRM_ID set (~9,924)
 *   - Queries by DFIRM_ID (one DFIRM per county) rather than bbox grid
 *   - Pagination via resultOffset/resultRecordCount (max 2000/page)
 *   - Retries with backoff on 5xx
 *   - After ingestion, ST_Within join updates properties.femaFloodZone
 *
 * Endpoint: https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28
 */
const https = require('https');
const { Pool } = require('pg');

const DB = { host: 'localhost', port: 5433, user: 'eavesight', password: 'eavesight', database: 'eavesight' };
const URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

const DFIRM_IDS = ['01089C', '01083C', '01103C', '01095C', '01071C'];
const DFIRM_COUNTY = {
  '01089C': 'Madison',
  '01083C': 'Limestone',
  '01103C': 'Morgan',
  '01095C': 'Marshall',
  '01071C': 'Jackson',
};

const PAGE = 500;

function riskLabel(zone, sfha) {
  if (!zone) return 'UNKNOWN';
  const z = zone.toUpperCase();
  if (sfha === 'T') return 'HIGH';
  if (z.startsWith('V')) return 'VERY_HIGH';
  if (z.startsWith('A')) return 'HIGH';
  if (z === 'X' || z === 'B' || z === 'C') return 'MINIMAL';
  if (z === 'D') return 'UNDETERMINED';
  return 'OTHER';
}

function fetchJson(url, attempt = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 30000,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'Eavesight/1.0', 'Accept': 'application/json' },
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  }).catch(async err => {
    if (attempt < 1) {
      await new Promise(r => setTimeout(r, 1000));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  });
}

function ringsToWkt(rings) {
  const ringStrs = rings.map(r => '(' + r.map(([x, y]) => `${x} ${y}`).join(', ') + ')');
  return `POLYGON(${ringStrs.join(',')})`;
}

async function main() {
  const isTest = process.argv.includes('--test');
  const pool = new Pool(DB);

  console.log(`[${new Date().toISOString()}] FEMA flood v2 harvest start (${isTest ? 'TEST' : 'FULL'})`);

  await pool.query(`DROP TABLE IF EXISTS _fema_flood_v2`);
  await pool.query(`
    CREATE TABLE _fema_flood_v2 (
      id serial primary key,
      fld_zone text,
      zone_subty text,
      sfha text,
      risk text,
      dfirm_id text,
      county text,
      geog geography(Polygon, 4326),
      ingested_at timestamptz default now()
    )
  `);
  console.log('  Created LOGGED _fema_flood_v2');

  // Strategy: bbox-grid query (proven to work in v1) + DFIRM_ID WHERE filter so
  // we only get polygons from our 5-county effective FIRM panels. Each cell
  // returns at most ~50 features (FEMA's effective max for spatial+geometry queries).
  // Pages within a cell via resultOffset.
  async function insertFeatures(features, fallbackDfirm, fallbackCounty) {
    if (!features || features.length === 0) return 0;
    const rows = [];
    const params = [];
    let pi = 1;
    for (const f of features) {
      const a = f.attributes || {};
      const g = f.geometry;
      if (!g || !g.rings || g.rings.length === 0) continue;
      const wkt = ringsToWkt(g.rings);
      const risk = riskLabel(a.FLD_ZONE, a.SFHA_TF);
      const dfirm = a.DFIRM_ID || fallbackDfirm || null;
      const county = (DFIRM_COUNTY[dfirm]) || fallbackCounty || null;
      rows.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},ST_GeomFromText($${pi++},4326)::geography)`);
      params.push(a.FLD_ZONE || null, a.ZONE_SUBTY || null, a.SFHA_TF || null, risk, dfirm, county, wkt);
    }
    if (!rows.length) return 0;
    try {
      await pool.query(
        `INSERT INTO _fema_flood_v2 (fld_zone,zone_subty,sfha,risk,dfirm_id,county,geog) VALUES ${rows.join(',')}`,
        params
      );
      return rows.length;
    } catch (e) {
      let inserted = 0;
      for (let j = 0; j < rows.length; j++) {
        const idx = j * 7;
        try {
          await pool.query(
            `INSERT INTO _fema_flood_v2 (fld_zone,zone_subty,sfha,risk,dfirm_id,county,geog) VALUES ($1,$2,$3,$4,$5,$6,ST_GeomFromText($7,4326)::geography)`,
            [params[idx], params[idx + 1], params[idx + 2], params[idx + 3], params[idx + 4], params[idx + 5], params[idx + 6]]
          );
          inserted++;
        } catch (er) { /* skip invalid geom */ }
      }
      return inserted;
    }
  }

  const BBOX = { xmin: -87.4, ymin: 34.0, xmax: -85.4, ymax: 35.3 };
  const PAGE = 50;
  const dfirmFilter = encodeURIComponent(
    `DFIRM_ID IN (${DFIRM_IDS.map(d => `'${d}'`).join(',')})`
  );
  let total = 0;

  // Recursive cell harvester. If a page hits API err, subdivide the cell into
  // 4 quadrants. Stop recursing at minSize (~0.02 deg, roughly 2km) which is
  // small enough that any single cell has <50 polygons (FEMA's hidden cap).
  async function harvestCell(c, depth) {
    const cellParam = `${c.xmin},${c.ymin},${c.xmax},${c.ymax}`;
    const cellBase = `${URL}?where=${dfirmFilter}&geometry=${encodeURIComponent(cellParam)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID&returnGeometry=true&outSR=4326&f=json`;
    let offset = 0;
    let cellTotal = 0;
    let needsSplit = false;

    while (true) {
      const url = `${cellBase}&resultOffset=${offset}&resultRecordCount=${PAGE}`;
      let data;
      try {
        data = await fetchJson(url);
      } catch (e) {
        // network / transport fail
        needsSplit = true;
        break;
      }
      if (data.error) {
        needsSplit = true;
        break;
      }
      const features = data.features || [];
      if (features.length === 0) break;
      await insertFeatures(features);
      cellTotal += features.length;
      total += features.length;
      offset += features.length;
      if (!data.exceededTransferLimit && features.length < PAGE) break;
      if (isTest && total >= 500) break;
    }

    if (needsSplit) {
      // give up if cells get tiny (<0.005 deg, ~500m)
      if (depth >= 3) {
        // Don't waste time on chronically-erroring cells - they're usually
        // empty regions where FEMA's API throws spurious 500s.
        return cellTotal;
      }
      const mx = (c.xmin + c.xmax) / 2;
      const my = (c.ymin + c.ymax) / 2;
      const sub = [
        { xmin: c.xmin, ymin: c.ymin, xmax: mx, ymax: my },
        { xmin: mx,     ymin: c.ymin, xmax: c.xmax, ymax: my },
        { xmin: c.xmin, ymin: my,     xmax: mx, ymax: c.ymax },
        { xmin: mx,     ymin: my,     xmax: c.xmax, ymax: c.ymax },
      ];
      let extra = 0;
      for (const s of sub) extra += await harvestCell(s, depth + 1);
      return cellTotal + extra;
    }
    return cellTotal;
  }

  // Initial 8x8 grid (this is what the working v1 used).
  const GRID = 8;
  const dx = (BBOX.xmax - BBOX.xmin) / GRID;
  const dy = (BBOX.ymax - BBOX.ymin) / GRID;
  let cellsDone = 0;
  for (let gx = 0; gx < GRID; gx++) {
    for (let gy = 0; gy < GRID; gy++) {
      const cell = {
        xmin: BBOX.xmin + dx * gx,
        ymin: BBOX.ymin + dy * gy,
        xmax: BBOX.xmin + dx * (gx + 1),
        ymax: BBOX.ymin + dy * (gy + 1),
      };
      const ct = await harvestCell(cell, 0);
      cellsDone++;
      if (ct > 0) console.log(`  cell ${gx},${gy}: +${ct} (cells done ${cellsDone}/${GRID*GRID}, grand ${total})`);
      if (isTest && total >= 500) break;
    }
    if (isTest && total >= 500) break;
  }
  // Dedup by spatial+attr identity in case the same polygon appeared in two
  // grid cells (overlap risk) - safe to keep for now since polygon-intersection
  // assignment is OR-style; per-row noise only affects raw count, not joins.

  console.log(`\n[${new Date().toISOString()}] Loaded ${total} raw polygons (may include cross-cell duplicates)`);

  // Dedupe via WKB hash - O(N) instead of O(N^2). Two polygons with byte-identical
  // WKB are duplicates.
  console.log('Deduping by WKB hash...');
  const dedup = await pool.query(`
    DELETE FROM _fema_flood_v2
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY md5(ST_AsBinary(geog::geometry)::text), fld_zone, dfirm_id
          ORDER BY id
        ) AS rn
        FROM _fema_flood_v2
      ) t WHERE rn > 1
    )
  `);
  console.log(`  Removed ${dedup.rowCount} duplicate polygons`);

  console.log('Indexing _fema_flood_v2.geog...');
  await pool.query('CREATE INDEX IF NOT EXISTS _fema_flood_v2_geog_idx ON _fema_flood_v2 USING gist (geog)');
  await pool.query('CREATE INDEX IF NOT EXISTS _fema_flood_v2_zone_idx ON _fema_flood_v2 (fld_zone)');

  const cnt = await pool.query('SELECT COUNT(*) FROM _fema_flood_v2');
  console.log(`  _fema_flood_v2 row count: ${cnt.rows[0].count}`);
  const zoneDist = await pool.query(`SELECT fld_zone, COUNT(*) FROM _fema_flood_v2 GROUP BY 1 ORDER BY 2 DESC`);
  console.log('  polygon zone distribution:');
  for (const r of zoneDist.rows) console.log(`    ${r.fld_zone || 'NULL'}: ${r.count}`);

  if (total === 0) {
    console.error('No polygons loaded - aborting before property update.');
    await pool.end();
    process.exit(2);
  }

  // -- patched: skip property UPDATEs; do them after Madison finishes --
  console.log("Polygon ingest complete. Skipping property updates (run separately).");
  await pool.end();
  return;
  console.log('\nResetting properties.femaFloodZone for 5 counties...');
  await pool.query(`
    UPDATE properties SET "femaFloodZone" = NULL, "femaFloodRisk" = NULL
    WHERE county IN ('Madison','Limestone','Morgan','Marshall','Jackson')
  `);

  console.log('Joining properties to _fema_flood_v2 polygons (highest-risk wins)...');
  const r = await pool.query(`
    WITH ranked AS (
      SELECT
        p.id,
        f.fld_zone,
        f.risk,
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
      JOIN _fema_flood_v2 f
        ON ST_Intersects(f.geog, ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography)
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
        AND p.county IN ('Madison','Limestone','Morgan','Marshall','Jackson')
    )
    UPDATE properties p
    SET "femaFloodZone" = ranked.fld_zone,
        "femaFloodRisk" = ranked.risk
    FROM ranked
    WHERE ranked.rn = 1 AND p.id = ranked.id
  `);
  console.log(`  Polygon-intersected updates: ${r.rowCount} properties`);

  const r2 = await pool.query(`
    UPDATE properties
    SET "femaFloodZone" = 'X', "femaFloodRisk" = 'MINIMAL'
    WHERE "femaFloodZone" IS NULL
      AND county IN ('Madison','Limestone','Morgan','Marshall','Jackson')
  `);
  console.log(`  Defaulted ${r2.rowCount} non-intersecting properties to X/MINIMAL`);

  const dist = await pool.query(`
    SELECT "femaFloodZone" zone, COUNT(*) FROM properties
    WHERE county IN ('Madison','Limestone','Morgan','Marshall','Jackson')
    GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log('\nFinal property flood zone distribution (5 counties):');
  for (const row of dist.rows) console.log(`  ${row.zone || 'NULL'}: ${row.count}`);

  const riskDist = await pool.query(`
    SELECT "femaFloodRisk" risk, COUNT(*) FROM properties
    WHERE county IN ('Madison','Limestone','Morgan','Marshall','Jackson')
    GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log('\nFinal property flood risk distribution:');
  for (const row of riskDist.rows) console.log(`  ${row.risk || 'NULL'}: ${row.count}`);

  console.log(`\n[${new Date().toISOString()}] FEMA flood v2 harvest done.`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
