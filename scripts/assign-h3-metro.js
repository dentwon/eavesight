#!/usr/bin/env node
/**
 * assign-h3-metro.js
 *
 * Computes H3 r6 and r8 cells for every property and tags it with the matching
 * metroCode. Idempotent — re-run safe. Keyset-paginated to avoid re-processing.
 *
 * Bug history: original version used OFFSET-by-count with an OR filter that
 * re-matched already-updated rows. The loop ran 121 times over the same
 * 2,000-row window and reported 'done' at 242,987 while only 2k rows landed.
 * Fixed by (a) tightening the filter so processed rows fall out AND
 * (b) keyset pagination (id > last_id) so we can't accidentally loop.
 *
 * Usage:
 *   node assign-h3-metro.js               # all metros
 *   node assign-h3-metro.js north-alabama # one metro
 */
const { Pool } = require('pg');
const { latLngToCell } = require('h3-js');

const DB = { host:'localhost', port:5433, user:'eavesight', password:'eavesight', database:'eavesight' };
const BATCH = 2000;

async function main() {
  const onlyMetro = process.argv[2] || null;
  const pool = new Pool(DB);

  const metros = (await pool.query(
    `SELECT code, "stateCodes", "bboxMinLat", "bboxMaxLat", "bboxMinLon", "bboxMaxLon"
     FROM metros WHERE status='active' ${onlyMetro ? "AND code = $1" : ''}`,
    onlyMetro ? [onlyMetro] : [],
  )).rows;

  if (!metros.length) { console.error('No metros to process.'); process.exit(1); }

  for (const m of metros) {
    console.log(`[${m.code}] tagging properties in states ${m.stateCodes.join(',')}`);

    // Needs-work filter: row is missing any of h3r6, h3r8, or has wrong metroCode.
    // Once all three are set correctly, the row falls out of the filter.
    const needsWork = `
      state = ANY($1)
      AND lat BETWEEN $2 AND $3
      AND lon BETWEEN $4 AND $5
      AND lat IS NOT NULL AND lon IS NOT NULL
      AND (
        "h3r6" IS NULL
        OR "h3r8" IS NULL
        OR "metroCode" IS DISTINCT FROM $6
      )`;
    const baseArgs = [m.stateCodes, m.bboxMinLat, m.bboxMaxLat, m.bboxMinLon, m.bboxMaxLon, m.code];

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM properties WHERE ${needsWork}`, baseArgs,
    );
    const total = countRows[0].n;
    console.log(`[${m.code}] ${total} rows to update`);
    if (total === 0) { console.log(`[${m.code}] already up to date.`); continue; }

    let done = 0;
    let lastId = '';
    while (true) {
      // Keyset pagination: id > lastId. Combined with needsWork filter as
      // belt-and-suspenders so we never re-visit the same rows.
      const { rows } = await pool.query(
        `SELECT id, lat, lon FROM properties
         WHERE ${needsWork} AND id > $7
         ORDER BY id ASC LIMIT ${BATCH}`,
        [...baseArgs, lastId],
      );
      if (!rows.length) break;

      const updates = rows.map(r => ({
        id: r.id,
        h3r6: latLngToCell(Number(r.lat), Number(r.lon), 6),
        h3r8: latLngToCell(Number(r.lat), Number(r.lon), 8),
      }));

      const values = updates.map((u, i) =>
        `(\$${i*3+1}, \$${i*3+2}, \$${i*3+3})`
      ).join(',');
      const params = updates.flatMap(u => [u.id, u.h3r6, u.h3r8]);
      await pool.query(
        `UPDATE properties p SET
           "h3r6" = v.h3r6, "h3r8" = v.h3r8, "metroCode" = '${m.code}'
         FROM (VALUES ${values}) AS v(id, h3r6, h3r8)
         WHERE p.id = v.id`,
        params,
      );

      done += rows.length;
      lastId = rows[rows.length - 1].id;
      if (done % (BATCH * 5) === 0 || done >= total)
        console.log(`[${m.code}] ${done}/${total} (${((done/total)*100).toFixed(1)}%)`);
      if (rows.length < BATCH) break;
    }

    console.log(`[${m.code}] done. ${done} rows updated.`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
