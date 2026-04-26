#!/usr/bin/env node
/**
 * Census Batch Geocoder — FAST with COPY + temp table
 * 10K/request Census API → ~18 min for 174K parcels
 *
 * Run: DB_PASSWORD=eavesight node scripts/batch-geocode.js
 */
const { Client } = require('pg');
const https = require('https');
const FormData = require('form-data');
const fs = require('fs');
const { pipeline } = require('stream/promises');

const PG = { host:'localhost', port:5433, database:'eavesight', user:'eavesight', password: process.env.DB_PASSWORD || 'eavesight' };
const BATCH = 10000;
const PAUSE_MS = 500;
const PROGRESS_FILE = '/tmp/geocode_progress.json';
const TMP_CSV = '/tmp/geocode_bulk.csv';

function escapeCsv(s) {
  if (!s) return '';
  if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseAddr(mailing, prop) {
  const um = (mailing || '').toUpperCase();
  const up = (prop || '').toUpperCase();
  // PO Box / RR anywhere in mailing string → use property street instead
  const isPoBox = /P\.?\s*O\.?\s*BOX|POST\s*OFFICE\s*BOX/.test(um);
  const isRuralRoute = /P\.?O\.?\s*RURAL|^RR\s*\d|^HC\s*\d|^RURAL\s*ROUTE/.test(um);
  const parts = um.split(',').map(s => s.trim());
  let city = '', state = 'AL', zip = '';
  if (parts.length >= 2) {
    const last = parts[parts.length - 1] || '';
    const m = last.match(/^([A-Z]{2})\s*([\d-]*)$/);
    if (m) { state = m[1]; zip = m[2] || ''; }
    city = (parts[parts.length - 2] || '').replace(/,+$/, '').replace(/\s+[A-Z]$/, '').trim();
    // Fix truncated cities: OWENS X RDS → OWENS CROSS ROADS
    if (city.includes(' X ') || city.includes(' XRD')) city = city.replace(/\s+X\s*/, ' CROSS ').replace(/ XRD/, ' CROSS ROADS');
  }
  let street = '';
  if (!isPoBox && !isRuralRoute) {
    street = parts.slice(0, -2).join(', ').replace(/,+/g, ',').trim();
  }
  if (!street) {
    street = up.replace(/,.*$/, '').trim();
    street = street.replace(/\s+P\.?O\.?\s*BOX\s*\d+.*$/i, '')
                  .replace(/\s+RR\s*\d+.*$/i, '')
                  .replace(/\s+HC\s*\d+.*$/i, '').trim();
  }
  return { street, city, state, zip };
}
async function init(client) {
  await client.query('ALTER TABLE madison_parcel_data ADD COLUMN IF NOT EXISTS lat float');
  await client.query('ALTER TABLE madison_parcel_data ADD COLUMN IF NOT EXISTS lon float');
  await client.query('DROP TABLE IF EXISTS _geocode_tmp');
  await client.query('CREATE TABLE _geocode_tmp (orig_id text PRIMARY KEY, lat float, lon float)');
}

async function getTotal(client) {
  const r = await client.query('SELECT COUNT(*) FROM madison_parcel_data WHERE lat IS NULL');
  return parseInt(r.rows[0].count);
}

async function fetchParcelIds(client, offset, limit) {
  const r = await client.query(`
    SELECT id, "propertyAddress", "mailingAddressFull"
    FROM madison_parcel_data WHERE lat IS NULL ORDER BY id OFFSET $1 LIMIT $2
  `, [offset, limit]);
  return r.rows;
}

async function geocode(parcels) {
  const csv = parcels.map((p, i) => {
    const a = parseAddr(p.mailingAddressFull || '', p.propertyAddress || '');
    return `${escapeCsv('p'+i)},${escapeCsv(a.street)},${escapeCsv(a.city)},${a.state},${a.zip}`;
  }).join('\n');

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('addressFile', Buffer.from(csv), { filename: 'a.csv', contentType: 'text/csv' });
    form.append('benchmark', 'Public_AR_Current');
    form.append('vintage', 'Current_Current');
    form.append('format', 'json');

    const req = https.request({
      hostname: 'geocoding.geo.census.gov',
      path: '/geocoder/locations/addressbatch',
      method: 'POST', headers: form.getHeaders()
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        const results = [];
        for (const line of d.split('\n')) {
          if (!line.trim()) continue;
          const f = [], chars = line.split('');
          let cur = '', q = false;
          for (const c of chars) {
            if (c === '"') q = !q;
            else if (c === ',' && !q) { f.push(cur.trim()); cur = ''; }
            else cur += c;
          }
          f.push(cur.trim());
          if (f[2] === 'Match' && f[5]) {
            const m = f[5].match(/^"?(-?[\d.]+),([\d.]+)"?$/);
            if (m) results.push({ idx: parseInt(f[0].replace('p','')), lat: parseFloat(m[2]), lon: parseFloat(m[1]) });
          }
        }
        resolve(results);
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

async function bulkUpdate(client, parcels, coords) {
  if (!coords.length) return;

  const coordMap = new Map(coords.map(c => [c.idx, c]));
  const lines = [];
  for (let i = 0; i < parcels.length; i++) {
    const c = coordMap.get(i);
    if (c) lines.push(`${parcels[i].id},${c.lat},${c.lon}`);
  }
  if (!lines.length) return;

  fs.writeFileSync(TMP_CSV, lines.join('\n'));

  // Try COPY first
  try {
    const copyStream = client.copyFrom('COPY _geocode_tmp (orig_id, lat, lon) FROM STDIN WITH (FORMAT csv)');
    await pipeline(fs.createReadStream(TMP_CSV), copyStream);
  } catch (e) {
    // Fallback: INSERT ... ON CONFLICT DO UPDATE (works because PK is orig_id)
    const chunkSize = 2000;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const values = chunk.map(l => {
        const [id, lat, lon] = l.split(',');
        return `('${id}', ${lat}, ${lon})`;
      }).join(',');
      await client.query(
        `INSERT INTO _geocode_tmp (orig_id, lat, lon) VALUES ${values} ON CONFLICT (orig_id) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon`
      );
    }
  }

  // Bulk UPDATE JOIN
  await client.query(`
    UPDATE madison_parcel_data m
    SET lat = t.lat, lon = t.lon
    FROM _geocode_tmp t
    WHERE m.id::text = t.orig_id
  `);

  // Clear temp table for next batch
  await client.query('TRUNCATE TABLE _geocode_tmp');
}

function saveProgress(processed, total, matched) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ processed, total, matched, at: new Date().toISOString() }));
}

async function main() {
  console.log('Census Batch Geocoder starting...');
  const client = new Client(PG);
  await client.connect();
  await init(client);

  const total = await getTotal(client);
  if (total === 0) { console.log('All done!'); await client.end(); return; }
  console.log(`Total to geocode: ${total.toLocaleString()}`);

  let processed = 0, matchedTotal = 0, batchNum = 0;
  const startTime = Date.now();

  try {
    const saved = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    if (saved.processed > 0) {
      processed = saved.processed;
      matchedTotal = saved.matched;
      console.log(`Resuming from ${processed} (${matchedTotal} matched so far)`);
    }
  } catch {}

  while (true) {
    const parcels = await fetchParcelIds(client, processed, BATCH);
    if (!parcels.length) break;
    batchNum++;

    const t0 = Date.now();
    const coords = await geocode(parcels);
    const geoMs = Date.now() - t0;

    const t1 = Date.now();
    await bulkUpdate(client, parcels, coords);
    const dbMs = Date.now() - t1;

    matchedTotal += coords.length;
    processed += parcels.length;
    const elapsed = Date.now() - startTime;
    const rate = (matchedTotal / (elapsed / 1000)).toFixed(1);
    const pct = ((processed / total) * 100).toFixed(1);
    const left = total - processed;
    const etaSec = left > 0 ? Math.round(left / (matchedTotal / (elapsed / 1000))) : 0;

    console.log(`[${((elapsed)/1000).toFixed(0)}s] Batch ${batchNum} | +${coords.length}/${parcels.length} | ${pct}% | ` +
      `${left.toLocaleString()} left | ${rate}/s | geo:${geoMs}ms db:${dbMs}ms | ETA:${etaSec}s`);

    saveProgress(processed, total, matchedTotal);

    if (processed >= total) break;
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone! ${matchedTotal}/${total} geocoded (${((matchedTotal/total)*100).toFixed(1)}%) in ${totalSec}s`);
  try { fs.unlinkSync(PROGRESS_FILE); } catch {}
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
