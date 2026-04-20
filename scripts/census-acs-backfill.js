#!/usr/bin/env node
/**
 * census-acs-backfill.js
 *
 * Pass B of the data dragnet. For every property:
 *   1. Spatially classify into a census block group (done via PostGIS + TIGER)
 *   2. Fetch ACS 5-year estimates for that block group (1 call per county, not
 *      per property — only 5 counties touch our footprint)
 *   3. Persist medianYearBuilt, medianHomeValue, medianHouseholdIncome,
 *      homeownershipRate into property_enrichments
 *   4. Fill properties.yearBuilt from the block-group median with confidence
 *      = ACS_MEDIAN for any property that has no verified year yet
 *
 * Free. No API key required (ACS API allows anonymous low-volume access).
 */

const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'stormvault', password:'stormvault', database:'stormvault' };
const ACS_YEAR = 2023;
const VARS = [
  'B25035_001E', // median year structure built
  'B25077_001E', // median home value
  'B19013_001E', // median household income
  'B25003_001E', // total housing units
  'B25003_002E', // owner-occupied units
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 20000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const pool = new Pool(DB);

  // 1. Classify every property into a block group (one SQL update)
  console.log('[1/4] Spatially classifying properties into TIGER block groups...');
  await pool.query(`
    CREATE TEMP TABLE _prop_bg AS
    SELECT p.id AS property_id, bg.geoid, bg.statefp, bg.countyfp, bg.tractce, bg.blkgrpce
    FROM properties p
    JOIN tiger_bg_al bg ON ST_Contains(bg.geom, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
    WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL;
  `);
  const { rows: totalRow } = await pool.query('SELECT COUNT(*) AS c FROM _prop_bg');
  console.log(`      classified ${totalRow[0].c} properties`);

  // 2. Fetch ACS for each unique (state, county) — returns all block groups in that county
  const { rows: counties } = await pool.query('SELECT DISTINCT statefp, countyfp FROM _prop_bg ORDER BY statefp, countyfp');
  console.log(`[2/4] Fetching ACS for ${counties.length} counties...`);

  const acsByGeoid = new Map(); // geoid -> {medianYearBuilt, medianHomeValue, medianHouseholdIncome, ownerOccupiedRate}
  for (const { statefp, countyfp } of counties) {
    const url = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=${VARS.join(',')}&for=block%20group:*&in=state:${statefp}&in=county:${countyfp}&in=tract:*`;
    try {
      const data = await fetchJson(url);
      const header = data[0];
      const idx = Object.fromEntries(header.map((h, i) => [h, i]));
      for (const row of data.slice(1)) {
        const geoid = row[idx.state] + row[idx.county] + row[idx.tract] + row[idx['block group']];
        const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
        const totalUnits = num(row[idx.B25003_001E]);
        const ownerOcc   = num(row[idx.B25003_002E]);
        acsByGeoid.set(geoid, {
          medianYearBuilt:    num(row[idx.B25035_001E]),
          medianHomeValue:    num(row[idx.B25077_001E]),
          medianHouseholdIncome: num(row[idx.B19013_001E]),
          homeownershipRate:  (totalUnits && ownerOcc) ? (ownerOcc / totalUnits) : null,
        });
      }
      console.log(`      state ${statefp} county ${countyfp}: ${data.length - 1} block groups`);
    } catch (e) {
      console.error(`      FAILED state ${statefp} county ${countyfp}:`, e.message);
    }
  }
  console.log(`      cached ACS data for ${acsByGeoid.size} block groups`);

  // 3. Write property_enrichments in batches
  console.log('[3/4] Writing property_enrichments rows...');
  const { rows: toWrite } = await pool.query('SELECT property_id, geoid, tractce, blkgrpce FROM _prop_bg');
  let written = 0, skipped = 0;
  const batchSize = 500;
  for (let i = 0; i < toWrite.length; i += batchSize) {
    const batch = toWrite.slice(i, i + batchSize);
    const values = [];
    const params = [];
    let pi = 1;
    for (const r of batch) {
      const a = acsByGeoid.get(r.geoid);
      if (!a) { skipped++; continue; }
      values.push(`(gen_random_uuid()::text, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, 'census-acs-${ACS_YEAR}', NOW(), NOW())`);
      params.push(r.property_id, r.tractce, r.blkgrpce, a.medianYearBuilt, a.medianHomeValue, a.medianHouseholdIncome, a.homeownershipRate);
    }
    if (values.length === 0) continue;
    await pool.query(`
      INSERT INTO property_enrichments (id, \"propertyId\", \"censusTract\", \"censusBlockGroup\", \"medianYearBuilt\", \"medianHomeValue\", \"medianHouseholdIncome\", \"homeownershipRate\", source, \"createdAt\", \"updatedAt\")
      VALUES ${values.join(',')}
      ON CONFLICT (\"propertyId\") DO UPDATE SET
        \"censusTract\" = EXCLUDED.\"censusTract\",
        \"censusBlockGroup\" = EXCLUDED.\"censusBlockGroup\",
        \"medianYearBuilt\" = EXCLUDED.\"medianYearBuilt\",
        \"medianHomeValue\" = EXCLUDED.\"medianHomeValue\",
        \"medianHouseholdIncome\" = EXCLUDED.\"medianHouseholdIncome\",
        \"homeownershipRate\" = EXCLUDED.\"homeownershipRate\",
        source = EXCLUDED.source,
        \"updatedAt\" = NOW()
      WHERE property_enrichments.source IS NULL OR property_enrichments.source LIKE 'census-%'
    `, params);
    written += values.length;
    if (written % 10000 === 0 || i + batchSize >= toWrite.length) {
      process.stdout.write(`      ${written}/${toWrite.length}\n`);
    }
  }
  console.log(`      wrote ${written} enrichment rows (skipped ${skipped} with no ACS data)`);

  // 4. Fill yearBuilt from block-group median where confidence is NONE
  console.log('[4/4] Filling properties.yearBuilt from ACS median (only where confidence=NONE)...');
  const filled = await pool.query(`
    WITH acs_lookup AS (
      SELECT p.id AS property_id, pe.\"medianYearBuilt\" AS yb
      FROM properties p
      JOIN property_enrichments pe ON pe.\"propertyId\" = p.id
      WHERE pe.\"medianYearBuilt\" IS NOT NULL
        AND p.\"yearBuiltConfidence\" = 'NONE'
    )
    UPDATE properties p
    SET
      \"yearBuilt\" = a.yb,
      \"yearBuiltConfidence\" = 'ACS_MEDIAN',
      \"yearBuiltSource\" = 'census-acs-b25035-${ACS_YEAR}'
    FROM acs_lookup a
    WHERE p.id = a.property_id
      AND p.\"yearBuiltConfidence\" = 'NONE'
  `);
  console.log(`      filled ${filled.rowCount} yearBuilt values from block-group medians`);

  const { rows: finalStats } = await pool.query(`
    SELECT \"yearBuiltConfidence\" AS conf, COUNT(*) AS n
    FROM properties
    GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log('\nFinal coverage:');
  for (const r of finalStats) console.log(`  ${r.conf}: ${r.n}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
