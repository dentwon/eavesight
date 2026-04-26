#!/usr/bin/env node
/**
 * apply-ms-geocode.js
 *
 * Flush staging_ms_geocode_proposals into the production properties table.
 *
 * Source rows have ms-N placeholder addresses (and originally had hardcoded
 * city='Huntsville', county='Madison', zip='35801') from the buggy
 * import-footprints.js. The geocoder writes Census-derived geographies into
 * staging; this script applies them to properties.
 *
 * Updates (only):
 *   - county          (always, when new_county is not NULL)
 *   - fips            (always, when new_fips is not NULL)
 *   - "censusTract"   (always, when new_tract is not NULL)
 *   - "censusBlockGroup" (always, when new_block_group is not NULL)
 *   - city            (ONLY if new_city is not NULL and not empty)
 *
 * Does NOT touch:
 *   - address  (NOT NULL constraint; leave the ms-N placeholder until a
 *               street-address geocoder fills it in)
 *   - zip      (NOT NULL; Census reverse-geocoder doesn't return ZCTA)
 *   - state    (NOT NULL; all rows are AL anyway)
 *
 * Modes:
 *   --dry-run   (default) — print row counts, sample diffs, no DB writes
 *   --commit    — actually run the UPDATE
 *   --batch=N   (default 5000) — batch size for chunked UPDATE
 *
 * Usage:
 *   node scripts/apply-ms-geocode.js              # dry run
 *   node scripts/apply-ms-geocode.js --commit     # for real
 */

const { Pool } = require('pg');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const BATCH = (() => {
  const a = args.find((x) => x.startsWith('--batch='));
  return a ? parseInt(a.split('=')[1], 10) : 5000;
})();

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  user: process.env.DB_USER || 'eavesight',
  password: process.env.DB_PASS || 'eavesight',
  database: process.env.DB_NAME || 'eavesight',
};

(async () => {
  const pool = new Pool(DB);
  const tag = COMMIT ? 'COMMIT' : 'DRY-RUN';
  console.log(`=== apply-ms-geocode (${tag}) batch=${BATCH} ===`);

  // 1. Pre-flight: counts.
  const { rows: pre } = await pool.query(
    `SELECT
       COUNT(*)                                    AS total,
       COUNT(*) FILTER (WHERE census_ok)            AS ok,
       COUNT(*) FILTER (WHERE new_city IS NOT NULL) AS with_city,
       COUNT(*) FILTER (WHERE new_county IS NOT NULL) AS with_county,
       COUNT(*) FILTER (WHERE new_block_group IS NOT NULL) AS with_bg
     FROM staging_ms_geocode_proposals`,
  );
  console.log(`staging rows: total=${pre[0].total} ok=${pre[0].ok} with_city=${pre[0].with_city} with_county=${pre[0].with_county} with_bg=${pre[0].with_bg}`);

  // 2. Show sample diff (3 rows where city would change).
  const { rows: sample } = await pool.query(
    `SELECT s.property_id, p.address, p.city AS old_city, s.new_city, p.county AS old_county, s.new_county, p.fips AS old_fips, s.new_fips
     FROM staging_ms_geocode_proposals s
     JOIN properties p ON p.id = s.property_id
     WHERE s.census_ok
       AND (
         (s.new_city IS NOT NULL AND s.new_city <> COALESCE(p.city, ''))
         OR (s.new_county IS NOT NULL AND s.new_county <> COALESCE(p.county, ''))
       )
     LIMIT 5`,
  );
  if (sample.length) {
    console.log('\nsample diffs (first 5):');
    for (const r of sample) {
      console.log(`  ${r.property_id} ${r.address} | city: ${r.old_city} -> ${r.new_city} | county: ${r.old_county} -> ${r.new_county} | fips: ${r.old_fips} -> ${r.new_fips}`);
    }
  } else {
    console.log('\n(no city/county diffs to apply)');
  }

  if (!COMMIT) {
    console.log('\nDRY-RUN — no rows updated. Pass --commit to apply.');
    await pool.end();
    return;
  }

  // 3. Real update, chunked.
  console.log('\nApplying...');
  let total = 0;
  let cityChanges = 0;
  let countyChanges = 0;
  let bgFills = 0;

  // We chunk by primary key range to keep memory + locks bounded.
  let lastId = '';
  while (true) {
    const { rows } = await pool.query(
      `WITH chunk AS (
         SELECT s.*
         FROM staging_ms_geocode_proposals s
         WHERE s.census_ok AND s.property_id > $1
         ORDER BY s.property_id
         LIMIT $2
       ),
       upd AS (
         UPDATE properties p
         SET county         = COALESCE(c.new_county,      p.county),
             fips           = COALESCE(c.new_fips,        p.fips),
             "censusTract"  = COALESCE(c.new_tract,       p."censusTract"),
             "censusBlockGroup" = COALESCE(c.new_block_group, p."censusBlockGroup"),
             city           = CASE
                                WHEN c.new_city IS NOT NULL AND c.new_city <> ''
                                  THEN c.new_city
                                ELSE p.city
                              END,
             "updatedAt"    = NOW()
         FROM chunk c
         WHERE p.id = c.property_id
           AND (
             p.county IS DISTINCT FROM COALESCE(c.new_county, p.county)
             OR p.fips IS DISTINCT FROM COALESCE(c.new_fips, p.fips)
             OR p."censusTract" IS DISTINCT FROM COALESCE(c.new_tract, p."censusTract")
             OR p."censusBlockGroup" IS DISTINCT FROM COALESCE(c.new_block_group, p."censusBlockGroup")
             OR (c.new_city IS NOT NULL AND c.new_city <> '' AND p.city IS DISTINCT FROM c.new_city)
           )
         RETURNING p.id, c.new_city IS NOT NULL AND c.new_city <> '' AS city_set, c.new_county IS NOT NULL AS county_set, c.new_block_group IS NOT NULL AS bg_set
       )
       SELECT COUNT(*) AS updated,
              COUNT(*) FILTER (WHERE city_set) AS city_changes,
              COUNT(*) FILTER (WHERE county_set) AS county_changes,
              COUNT(*) FILTER (WHERE bg_set) AS bg_fills,
              MAX(id) AS last_id
       FROM upd`,
      [lastId, BATCH],
    );

    // Need to also know how far we advanced even if no updates.
    const advance = await pool.query(
      `SELECT MAX(property_id) AS max_id, COUNT(*) AS n
       FROM (
         SELECT property_id FROM staging_ms_geocode_proposals
         WHERE census_ok AND property_id > $1
         ORDER BY property_id
         LIMIT $2
       ) t`,
      [lastId, BATCH],
    );

    const r = rows[0];
    const updated = parseInt(r.updated, 10);
    const cycleN = parseInt(advance.rows[0].n, 10);
    if (cycleN === 0) break;
    const newLastId = r.last_id || advance.rows[0].max_id;
    if (!newLastId || newLastId === lastId) break;
    lastId = newLastId;

    total += updated;
    cityChanges += parseInt(r.city_changes, 10);
    countyChanges += parseInt(r.county_changes, 10);
    bgFills += parseInt(r.bg_fills, 10);
    console.log(`  chunk: scanned=${cycleN} updated=${updated} (city=${r.city_changes} county=${r.county_changes} bg=${r.bg_fills})  cursor=${lastId}`);
  }

  console.log(`\nDone. updated=${total} cityChanges=${cityChanges} countyChanges=${countyChanges} bgFills=${bgFills}`);

  // 4. Post-flight.
  const { rows: post } = await pool.query(
    `SELECT
       county,
       COUNT(*) AS rows
     FROM properties
     WHERE address LIKE 'ms-%'
     GROUP BY county
     ORDER BY rows DESC`,
  );
  console.log('\npost-flight: ms-* placeholder rows by county:');
  for (const r of post) console.log(`  ${r.county || '(NULL)'}: ${r.rows}`);

  await pool.end();
})().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
