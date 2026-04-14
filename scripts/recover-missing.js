#!/usr/bin/env node
/**
 * Census Batch Geocoder — recover ~12K missing parcels
 * Uses same working CSV format as batch-geocode.js (FormData + file attachment)
 */
const { Client } = require('pg');
const https = require('https');
const FormData = require('form-data');

const PG = { host: 'localhost', port: 5433, database: 'stormvault', user: 'stormvault', password: process.env.DB_PASSWORD || 'stormvault' };

const BATCH = 10000;
const PAUSE_MS = 600;

function esc(s) {
  if (!s) return '';
  if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseAddr(mailing, prop) {
  const um = (mailing || '').toUpperCase();
  const up = (prop || '').toUpperCase();
  const isPoBox = /P\.?\s*O\.?\s*BOX|POST\s*OFFICE\s*BOX/.test(um);
  const isRural = /P\.?O\.?\s*RURAL|^RR\s|^HC\s|^RURAL\s*ROUTE/.test(up);

  let street = '', city = '', state = '', zip = '';

  // Try mailing first
  if (!isPoBox && !isRural) {
    const parts = mailing.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const m = last.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
      if (m) { state = m[1]; zip = m[2]; }
      const prev = parts[parts.length - 2].trim();
      if (/^[A-Z]{2}$/.test(prev)) { city = parts.length >= 3 ? parts[parts.length - 3] : prev; }
      else { city = prev; }
      street = parts[0].replace(/^C\/O\s+.*$/i, '').trim();
    }
  }

  if (!street || !city) {
    // Try property
    const parts = prop.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const m = last.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
      if (m) { state = m[1]; zip = m[2]; }
      const prev = parts[parts.length - 2].trim();
      if (/^[A-Z]{2}$/.test(prev)) { city = parts.length >= 3 ? parts[parts.length - 3] : prev; }
      else { city = prev; }
      street = parts[0].replace(/^C\/O\s+.*$/i, '').trim();
    } else {
      const m = prop.match(/^(.+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
      if (m) { street = m[1]; state = m[2]; zip = m[3]; }
    }
  }

  // Fallback: extract city/AL from propertyAddress if it has AL
  if (!city || !/^AL$/.test(state)) {
    const alMatch = prop.match(/,\s*([^,]+),\s*AL\s*,?\s*(\d{5}(?:-\d{4})?)?$/i);
    if (alMatch) { city = alMatch[1].trim().toUpperCase(); state = 'AL'; zip = alMatch[2] || ''; }
  }

  // Skip rural routes and PO boxes
  if (/^RR\s|^RURAL|^HC\s|^BOX\s|^P\.?O\.?\s|^PO\sBOX/.test(street)) return { street: '', city: '', state: '', zip: '' };
  if (isPoBox) return { street: '', city: '', state: '', zip: '' };

  return { street, city, state, zip };
}

async function geocodeBatch(rows) {
  // Build CSV same as batch-geocode.js
  const lines = rows.map((row, i) => {
    const a = parseAddr(row.mailingAddressFull || '', row.propertyAddress || '');
    return `${esc('p'+i)},${esc(a.street)},${esc(a.city)},${a.state},${a.zip}`;
  });
  const csvContent = lines.join('\n');

  let retries = 0;
  while (retries < 3) {
    try {
      const form = new FormData();
      form.append('addressFile', Buffer.from('\n' + csvContent), { filename: 'a.csv', contentType: 'text/csv' });
      form.append('benchmark', 'Public_AR_Current');
      form.append('vintage', 'Current_Current');
      form.append('format', 'json');

      const response = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'geocoding.geo.census.gov',
          path: '/geocoder/locations/addressbatch',
          method: 'POST',
          headers: form.getHeaders(),
        }, res => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject);
        form.pipe(req);
      });

      const { status, body } = response;
      if (status !== 200) throw new Error(`HTTP ${status} body: ${body.substring(0, 200)}`);

      const results = {};
      for (const line of body.split('\n')) {
        if (!line.trim()) continue;
        const fields = [];
        let cur = '', q = false;
        for (const c of line.split('')) {
          if (c === '"') { q = !q; cur += c; }
          else if (c === ',' && !q) { fields.push(cur.trim()); cur = ''; }
          else cur += c;
        }
        fields.push(cur.trim());
        // Format: id,matchStatus,coordinates,matchedAddress,tigerLineId,side,state,city,zip
        const [id, match, coords] = fields;
        if (match === 'Match') {
          const cm = coords.match(/\(([\d.-]+),\s*([\d.-]+)\)/);
          if (cm) results[id] = { lat: parseFloat(cm[2]), lon: parseFloat(cm[1]) };
        }
      }
      return { results, rows };
    } catch (err) {
      retries++;
      if (retries >= 3) throw err;
      await new Promise(r => setTimeout(r, 2000 * retries));
    }
  }
}

async function main() {
  const client = new Client(PG);
  await client.connect();
  console.error('Connected to DB');

  // Get all missing parcels that have valid AL property addresses
  const res = await client.query(`
    SELECT pin, "propertyAddress", "mailingAddressFull"
    FROM madison_parcel_data
    WHERE lat IS NULL
      AND "propertyAddress" IS NOT NULL
      AND "propertyAddress" !~ '^0'
      AND (
        "mailingAddressFull" ~* ', AL[,\\s]|$' 
        OR "propertyAddress" ~* ', AL[, ]|AL$'
        OR "propertyAddress" ~ '^[0-9]+\\s+[A-Z]'
      )
    ORDER BY pin
  `);

  const rows = res.rows;
  console.error(`Found ${rows.length} parcels to geocode`);

  if (rows.length === 0) {
    console.log('NO_MISSING');
    await client.end();
    return;
  }

  let matched = 0;
  const updates = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const start = i;
    console.error(`Processing ${start + 1}–${start + chunk.length} of ${rows.length}…`);

    try {
      const { results } = await geocodeBatch(chunk);
      for (const row of chunk) {
        const key = 'p' + chunk.indexOf(row);
        const r = results[key];
        if (r) {
          matched++;
          updates.push({ pin: row.pin, lat: r.lat, lon: r.lon });
        }
      }
    } catch (err) {
      console.error(`Batch error at ${start}: ${err.message}`);
    }

    if (i + BATCH < rows.length) await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  console.error(`\nGeocoding: ${matched}/${rows.length} matched`);

  // Batch update in groups of 1000
  let updated = 0;
  for (let i = 0; i < updates.length; i += 1000) {
    const batch = updates.slice(i, i + 1000);
    const pins = batch.map(u => u.pin);
    const lats = batch.map(u => u.lat);
    const lons = batch.map(u => u.lon);
    const res = await client.query(`
      UPDATE madison_parcel_data m SET lat = v.lat, lon = v.lon
      FROM (SELECT unnest($1::text[]) AS pin, unnest($2::float[]) AS lat, unnest($3::float[]) AS lon) v
      WHERE m.pin = v.pin
    `, [pins, lats, lons]);
    updated += res.rowCount;
    console.error(`  Updated batch ${i/1000+1}: ${res.rowCount} rows`);
  }

  console.error(`Total updated: ${updated}/${matched}`);
  console.log(`DONE:${matched}:${rows.length}`);
  await client.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
