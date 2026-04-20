#!/usr/bin/env node
/**
 * harvest-census-acs.js
 *
 * 1. Pulls Census block group polygons for AL FIPS 01: counties 089 (Madison),
 *    083 (Limestone), 103 (Morgan), 095 (Marshall), 071 (Jackson)
 *    from TIGERweb (layer 5 = 2025 Census Block Groups, we'll fall back to 1).
 * 2. Pulls ACS 5-year 2022 data: B19013_001E (median HH income), B25002_001E
 *    (total housing units), B25003_002E (owner-occupied units) per block group.
 * 3. Spatial-joins properties to block groups; populates censusTract,
 *    censusBlockGroup, medianHouseholdIncome, ownerOccupancyRate.
 */
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'stormvault', password:'stormvault', database:'stormvault' };
const COUNTIES = ['089','083','103','095','071']; // Madison, Limestone, Morgan, Marshall, Jackson

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 120000, rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0 StormVault' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
      let d=''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(e); }});
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function loadBlockGroups(pool) {
  console.log('=== TIGERweb block groups ===');
  await pool.query(`
    DROP TABLE IF EXISTS _bg;
    CREATE UNLOGGED TABLE _bg (
      id serial primary key,
      state text, county text, tract text, blkgrp text, geoid text,
      geog geography(Polygon, 4326)
    );
  `);

  // Try layer 5 first (2025 block groups), fallback to 8 (ACS 2024), then 11.
  const layerCandidates = [5, 8, 11];
  let total = 0;

  for (const county of COUNTIES) {
    let loaded = false;
    for (const lyr of layerCandidates) {
      const base = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/${lyr}/query`;
      const url = `${base}?where=STATE%3D%2701%27%20AND%20COUNTY%3D%27${county}%27&outFields=STATE,COUNTY,TRACT,BLKGRP,GEOID&returnGeometry=true&outSR=4326&f=json`;
      let data;
      try { data = await fetchJson(url); }
      catch (e) { console.warn(`  county=${county} layer=${lyr} err:`, e.message); continue; }
      const features = data.features || [];
      if (features.length === 0) continue;
      const rows = [];
      const params = [];
      let pi = 1;
      for (const f of features) {
        const a = f.attributes || {};
        const g = f.geometry;
        if (!g || !g.rings) continue;
        const rings = g.rings.map(r => '(' + r.map(([x,y]) => `${x} ${y}`).join(', ') + ')').join(',');
        const wkt = `POLYGON(${rings})`;
        rows.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},ST_GeomFromText($${pi++},4326)::geography)`);
        params.push(a.STATE, a.COUNTY, a.TRACT, a.BLKGRP, a.GEOID, wkt);
      }
      if (rows.length) {
        await pool.query(`INSERT INTO _bg (state,county,tract,blkgrp,geoid,geog) VALUES ${rows.join(',')}`, params);
      }
      console.log(`  county=${county} layer=${lyr} loaded ${features.length}`);
      total += features.length;
      loaded = true;
      break;
    }
    if (!loaded) console.warn(`  WARN: no block groups for county ${county}`);
  }

  await pool.query('CREATE INDEX ON _bg USING gist (geog)');
  await pool.query('CREATE INDEX ON _bg (geoid)');
  return total;
}

async function loadAcs(pool) {
  console.log('\n=== ACS 2022 5-year ===');
  // For a block group pull, we have to use the "block group" geography. API:
  //   get=B19013_001E,B25002_001E,B25003_002E  (median HH income, occupied units, owner-occupied)
  //   for=block group:*  in=state:01 county:...  tract:*
  // Must iterate per county.
  await pool.query(`
    DROP TABLE IF EXISTS _acs;
    CREATE UNLOGGED TABLE _acs (geoid text primary key, median_hh_income integer, total_occupied integer, owner_occupied integer);
  `);
  let total = 0;
  for (const county of COUNTIES) {
    const url = `https://api.census.gov/data/2022/acs/acs5?get=B19013_001E,B25002_001E,B25003_002E&for=block%20group:*&in=state:01%20county:${county}%20tract:*`;
    let arr;
    try { arr = await fetchJson(url); }
    catch (e) { console.warn(`  county=${county} err:`, e.message); continue; }
    if (!Array.isArray(arr) || arr.length < 2) continue;
    const header = arr[0];
    const ix = {
      inc: header.indexOf('B19013_001E'),
      occ: header.indexOf('B25002_001E'),
      own: header.indexOf('B25003_002E'),
      state: header.indexOf('state'),
      county: header.indexOf('county'),
      tract: header.indexOf('tract'),
      bg: header.indexOf('block group'),
    };
    const rows = [];
    const params = [];
    let pi = 1;
    for (let i = 1; i < arr.length; i++) {
      const row = arr[i];
      const inc = parseInt(row[ix.inc], 10);
      const occ = parseInt(row[ix.occ], 10);
      const own = parseInt(row[ix.own], 10);
      const geoid = `${row[ix.state]}${row[ix.county]}${row[ix.tract]}${row[ix.bg]}`;
      rows.push(`($${pi++},$${pi++},$${pi++},$${pi++})`);
      params.push(geoid, isNaN(inc)||inc<0?null:inc, isNaN(occ)||occ<0?null:occ, isNaN(own)||own<0?null:own);
    }
    if (rows.length) {
      await pool.query(`INSERT INTO _acs (geoid, median_hh_income, total_occupied, owner_occupied) VALUES ${rows.join(',')} ON CONFLICT (geoid) DO NOTHING`, params);
    }
    total += rows.length;
    console.log(`  county=${county} ACS rows=${rows.length}`);
  }
  return total;
}

async function main() {
  const pool = new Pool(DB);

  const bgN = await loadBlockGroups(pool);
  console.log(`Loaded ${bgN} block group polygons.`);

  const acsN = await loadAcs(pool);
  console.log(`Loaded ${acsN} ACS block-group records.`);

  console.log('\nSpatial-joining properties to block groups...');
  const r = await pool.query(`
    WITH pj AS (
      SELECT p.id, b.geoid, b.tract, b.blkgrp, a.median_hh_income, a.total_occupied, a.owner_occupied
      FROM properties p
      JOIN _bg b ON ST_Intersects(b.geog, ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography)
      LEFT JOIN _acs a ON a.geoid = b.geoid
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
    )
    UPDATE properties p
    SET
      "censusTract" = pj.tract,
      "censusBlockGroup" = pj.blkgrp,
      "medianHouseholdIncome" = pj.median_hh_income,
      "ownerOccupancyRate" = CASE WHEN pj.total_occupied > 0 THEN pj.owner_occupied::double precision / pj.total_occupied ELSE NULL END
    FROM pj
    WHERE p.id = pj.id
  `);
  console.log(`  Updated ${r.rowCount} properties`);

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE "medianHouseholdIncome" IS NOT NULL) w_income,
      COUNT(*) FILTER (WHERE "censusTract" IS NOT NULL) w_tract,
      COUNT(*) FILTER (WHERE "ownerOccupancyRate" IS NOT NULL) w_oorate,
      COUNT(*) total
    FROM properties
  `);
  console.log('\nCoverage:', rows[0]);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
