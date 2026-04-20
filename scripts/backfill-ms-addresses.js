#!/usr/bin/env node
/**
 * backfill-ms-addresses.js
 *
 * Replaces placeholder ms-* addresses (zip=35000 or 35801 with ms-* address)
 * using US Census Geocoder reverse lookup (coords -> tract/block, gives us
 * state/county/tract). For street address we hit Nominatim (1 req/sec).
 *
 * Writes ONLY: address, city, zip (and source tag).
 * Skips rows where ownerMailAddress is already real (we keep that as fallback).
 *
 * Idempotent: re-running resumes via "WHERE address LIKE 'ms-%'".
 */
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'stormvault', password:'stormvault', database:'stormvault' };
const BATCH = 100;
const NOMINATIM_DELAY_MS = 1100;

function fetchJson(url, headers={}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000, rejectUnauthorized: false, headers: { 'User-Agent': 'StormVault/1.0 (dentwon@gmail.com)', 'Accept': 'application/json', ...headers } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
      let d=''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(new Error('bad json: '+d.slice(0,120))); }});
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reverseNominatim(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  const j = await fetchJson(url);
  if (!j || !j.address) return null;
  const a = j.address;
  const num = a.house_number || '';
  const street = a.road || a.pedestrian || a.residential || '';
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || '';
  const zip = a.postcode || '';
  const addr = [num, street].filter(Boolean).join(' ').trim();
  if (!addr && !city && !zip) return null;
  return { address: addr || null, city: city || null, zip: (zip||'').split('-')[0] || null, source: 'nominatim' };
}

async function censusGeographies(lat, lon) {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  const j = await fetchJson(url);
  const geos = j && j.result && j.result.geographies;
  if (!geos) return null;
  const bg = (geos['2020 Census Blocks'] || [])[0] || (geos['Census Block Groups'] || [])[0] || null;
  const tract = (geos['Census Tracts'] || [])[0] || null;
  return { tract: tract && tract.TRACT, blockGroup: bg && bg.BLKGRP };
}

async function main() {
  const pool = new Pool(DB);
  const total = (await pool.query(`SELECT COUNT(*) FROM properties WHERE address LIKE 'ms-%' AND lat IS NOT NULL AND lon IS NOT NULL AND zip IN ('35000','35801')`)).rows[0].count;
  console.log(`MS-* rows to backfill: ${total}`);

  let cursor = 0;
  let filled = 0;
  let skipped = 0;
  let errors = 0;

  while (true) {
    const { rows } = await pool.query(
      `SELECT id, lat, lon, county, "ownerMailCity", "ownerMailZip"
       FROM properties
       WHERE address LIKE 'ms-%' AND lat IS NOT NULL AND lon IS NOT NULL AND zip IN ('35000','35801')
       ORDER BY id
       LIMIT $1`,
      [BATCH]
    );
    if (rows.length === 0) break;

    for (const p of rows) {
      try {
        const r = await reverseNominatim(p.lat, p.lon);
        if (!r || (!r.address && !r.city && !r.zip)) { skipped++; }
        else {
          await pool.query(
            `UPDATE properties SET
              address = COALESCE(NULLIF($2,''), address),
              city = COALESCE(NULLIF($3,''), city),
              zip = COALESCE(NULLIF($4,''), zip),
              source = COALESCE(source, '') || '+nominatim-reverse'
             WHERE id = $1 AND address LIKE 'ms-%'`,
            [p.id, r.address || '', r.city || '', r.zip || '']
          );
          filled++;
        }
      } catch (e) {
        errors++;
        if (errors % 20 === 0) console.warn(`  ${errors} errors so far, last: ${e.message}`);
      }
      cursor++;
      if (cursor % 100 === 0) console.log(`  ${cursor}/${total}  filled=${filled} skipped=${skipped} errors=${errors}`);
      await sleep(NOMINATIM_DELAY_MS);
    }

    // Failsafe: if batch didn't update at least one row, bail to avoid infinite loop.
    if (filled === 0 && cursor >= BATCH * 3) {
      console.error('No successful fills in first 3 batches; bailing.');
      break;
    }
  }

  console.log(`\nDone. filled=${filled} skipped=${skipped} errors=${errors}`);
  const remain = (await pool.query(`SELECT COUNT(*) FROM properties WHERE address LIKE 'ms-%' AND zip IN ('35000','35801')`)).rows[0].count;
  console.log(`Remaining ms-* with placeholder zip: ${remain}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
