#!/usr/bin/env node
/**
 * apply-marshall-jackson.js - finishes the spatial match after harvest-marshall-jackson.js
 * loaded _harvest_mj. Retries on deadlock (MRMS concurrent writer).
 */
const { Pool } = require('pg');
const DB = { host:'localhost', port:5433, user:'eavesight', password:'eavesight', database:'eavesight' };

async function retry(fn, tries=10) {
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch (e) {
      if (e.code === '40P01' || e.code === '40001') {
        console.warn(`  deadlock #${i+1}, retrying in ${1+i}s...`);
        await new Promise(r => setTimeout(r, (1+i)*1000));
        continue;
      }
      throw e;
    }
  }
  throw new Error('exhausted retries');
}

async function main() {
  const pool = new Pool(DB);

  // Check temp table exists
  const chk = await pool.query(`SELECT COUNT(*) FROM _harvest_mj`);
  console.log(`_harvest_mj has ${chk.rows[0].count} rows`);

  // Do it county-at-a-time, narrow batches to reduce lock footprint.
  for (const county of ['Marshall','Jackson']) {
    console.log(`\nApplying ${county}...`);
    let totalFilled = 0;
    for (let pass = 0; pass < 1; pass++) {
      const r = await retry(() => pool.query(`
        WITH matches AS (
          SELECT
            p.id AS property_id,
            nearest.owner, nearest.mail_address, nearest.mail_city, nearest.mail_state, nearest.mail_zip,
            nearest.parcel_id, nearest.assessed_value, nearest.market_value, nearest.acres,
            nearest.last_sale_date,
            nearest.source_county,
            ST_Distance(ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography, nearest.geog) AS dist_m
          FROM properties p
          CROSS JOIN LATERAL (
            SELECT hp.*
            FROM _harvest_mj hp
            WHERE hp.source_county = p.county
              AND hp.geog IS NOT NULL
            ORDER BY hp.geog <-> ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography
            LIMIT 1
          ) nearest
          WHERE p.county = $1
            AND p."ownerFullName" IS NULL
            AND p.lat IS NOT NULL AND p.lon IS NOT NULL
        )
        UPDATE properties p
        SET
          "ownerFullName" = matches.owner,
          "ownerMailAddress" = NULLIF(matches.mail_address,''),
          "ownerMailCity" = NULLIF(matches.mail_city,''),
          "ownerMailState" = NULLIF(matches.mail_state,''),
          "ownerMailZip" = NULLIF(matches.mail_zip,''),
          "parcelId" = COALESCE(p."parcelId", matches.parcel_id),
          "assessedValue" = COALESCE(p."assessedValue", matches.assessed_value),
          "marketValue" = COALESCE(p."marketValue", matches.market_value),
          "lotSizeSqft" = COALESCE(p."lotSizeSqft", (matches.acres * 43560)::int),
          "lastSaleDate" = COALESCE(p."lastSaleDate", matches.last_sale_date),
          source = COALESCE(p.source, matches.source_county || '-arcgis-knn-50m')
        FROM matches
        WHERE p.id = matches.property_id AND matches.dist_m <= 50
      `, [county]));
      totalFilled += r.rowCount;
      console.log(`  ${county} filled: ${r.rowCount}`);
    }
  }

  const { rows } = await pool.query(`SELECT county, COUNT(*) total, COUNT(*) FILTER (WHERE "ownerFullName" IS NOT NULL) w_owner FROM properties WHERE county IN ('Marshall','Jackson') GROUP BY county`);
  console.log('\nFinal:');
  for (const r of rows) console.log(`  ${r.county}: ${r.total} total, ${r.w_owner} with owner`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
