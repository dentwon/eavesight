#!/usr/bin/env node
/**
 * Nominatim fallback for remaining ungeocoded parcels.
 * Rate: 1 req/sec (OSM policy), runs in background.
 * Expect ~25% match rate on hard cases.
 */
const { Client } = require('pg');
const https = require('https');

const PG = { host: 'localhost', port: 5433, database: 'stormvault', user: 'stormvault', password: process.env.DB_PASSWORD || 'stormvault' };

const PAUSE_MS = 1100; // 1 req/sec with buffer
const BATCH_UPDATE = 500;

function parseAddr(mailing, prop) {
  const um = (mailing || '').toUpperCase();
  const up = (prop || '').toUpperCase();
  const isPoBox = /P\.?\s*O\.?\s*BOX|POST\s*OFFICE\s*BOX/.test(um);
  const isRural = /P\.?O\.?\s*RURAL|^RR\s|^HC\s|^RURAL\s*ROUTE/.test(up);

  let street = '', city = '', state = '', zip = '';

  // Try property first (property addresses are the ones we need to geocode)
  if (prop) {
    const parts = prop.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const m = last.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
      if (m) { state = m[1]; zip = m[2]; city = parts.length >= 3 ? parts[parts.length - 2] : ''; }
      else {
        const m2 = last.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
        if (m2) { state = m2[1]; zip = m2[2]; }
        city = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
      }
      street = parts[0].trim();
    } else {
      const m = prop.match(/^(.+?),\s*([A-Z]{2})\s*(\d{5})?$/);
      if (m) { street = m[1]; state = m[2]; zip = m[3] || ''; }
    }
  }

  if (!street && mailing && !isPoBox && !isRural) {
    const parts = mailing.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const m = last.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
      if (m) { state = m[1]; zip = m[2]; }
      city = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
      street = parts[0].replace(/^C\/O\s+.*$/i, '').trim();
    }
  }

  if (/^RR\s|^RURAL|^HC\s|^BOX\s|^P\.?O\.?\s|^PO\sBOX/.test(street)) return null;
  if (isPoBox || isRural) return null;
  if (!street || street.length < 3) return null;

  return { street, city: city.toUpperCase(), state, zip: zip.substring(0, 5) };
}

function geocodeNominatim(addr) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      street: addr.street,
      city: addr.city || '',
      state: addr.state || '',
      zip: addr.zip || '',
      country: 'USA',
      format: 'json',
      limit: '1',
    });

    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'StormVault-Roofing/1.0 (dentwon@stormvault.com)',
        'Accept': 'application/json',
      }
    }, res => {
      if (res.statusCode !== 200) { resolve(null); return; }
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const results = JSON.parse(d);
          if (results && results[0] && results[0].lat && results[0].lon) {
            resolve({ lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const client = new Client(PG);
  await client.connect();
  console.error('Connected to DB');

  const res = await client.query(`
    SELECT pin, "propertyAddress", "mailingAddressFull"
    FROM madison_parcel_data
    WHERE lat IS NULL
      AND "propertyAddress" IS NOT NULL
    ORDER BY pin
    LIMIT 20000
  `);

  const rows = res.rows;
  console.error(`Found ${rows.length} parcels to attempt`);

  if (rows.length === 0) {
    console.log('NO_MISSING');
    await client.end();
    return;
  }

  const updates = [];
  let processed = 0;
  let matched = 0;

  for (const row of rows) {
    const addr = parseAddr(row.mailingAddressFull, row.propertyAddress);
    if (!addr) { processed++; continue; }

    const result = await geocodeNominatim(addr);
    processed++;

    if (result) {
      matched++;
      updates.push({ pin: row.pin, lat: result.lat, lon: result.lon });
    }

    if (updates.length >= BATCH_UPDATE) {
      await flushUpdates(client, updates);
      updates.length = 0;
    }

    if (processed % 100 === 0) {
      console.error(`Progress: ${processed}/${rows.length} | matched: ${matched}`);
    }

    if (processed < rows.length) await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  if (updates.length) await flushUpdates(client, updates);

  console.error(`\nNominatim complete: ${matched}/${rows.length} matched`);
  console.log(`DONE:${matched}:${rows.length}`);
  await client.end();
}

async function flushUpdates(client, updates) {
  const pins = updates.map(u => u.pin);
  const lats = updates.map(u => u.lat);
  const lons = updates.map(u => u.lon);
  const res = await client.query(`
    UPDATE madison_parcel_data m SET lat = v.lat, lon = v.lon
    FROM (SELECT unnest($1::text[]) AS pin, unnest($2::float[]) AS lat, unnest($3::float[]) AS lon) v
    WHERE m.pin = v.pin
  `, [pins, lats, lons]);
  console.error(`  Flushed ${updates.length} updates (${res.rowCount} modified)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
