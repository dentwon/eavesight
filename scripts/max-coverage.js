#!/usr/bin/env node
/**
 * Maximum coverage geocoder for remaining ~12K parcels.
 * Strategy: Use property street + mailing city (for in-state mailings).
 * Census Batch API with correct FormData+file format.
 */
const { Client } = require('pg');
const https = require('https');
const FormData = require('form-data');

const PG = { host: 'localhost', port: 5433, database: 'stormvault', user: 'stormvault', password: process.env.DB_PASSWORD || 'stormvault' };

const BATCH = 10000;
const PAUSE_MS = 600;
const TIMEOUT_MS = 20000;

function extractALCity(mailing) {
  if (!mailing) return null;
  // Match ", AL 35763" or ", AL35763" or ", AL 35763-1234"
  const m = mailing.match(/,\s*AL\s*(\d{5}(?:-\d{4})?)\s*$/i);
  if (m) {
    // Extract city from part before ", AL"
    const cityMatch = mailing.match(/^(.+),\s*AL\s*\d/i);
    if (cityMatch) {
      return {
        city: cityMatch[1].split(',').pop().trim().toUpperCase(),
        zip: m[1],
        state: 'AL'
      };
    }
  }
  // Fallback: look for "AL" anywhere followed by zip
  const fallback = mailing.match(/,\s*([^,]+),\s*AL\s*(\d{5})/i);
  if (fallback) return { city: fallback[1].trim().toUpperCase(), zip: fallback[2], state: 'AL' };
  return null;
}

function cleanStreet(street) {
  if (!street) return '';
  // Remove apt/unit/suite numbers
  let s = street.replace(/\s+(APT|UNIT|#|STE|SUITE|BSMT|FL|LOT|SPC|BLDG|RM|LOT)\s*\.?\s*\w+/i, '')
               .replace(/\s+\d+$/, '')
               .replace(/^C\/O\s+.*$/i, '')
               .trim();
  // Skip rural routes, PO boxes
  if (/^P\.?O\.?\s|^PO\sBOX|^BOX\s|^RR\s|^RURAL|^HC\s|^BXR/i.test(s)) return '';
  return s;
}

async function geocodeBatch(rows) {
  // Build CSV: ID,Street,City,State,ZIP
  const lines = rows.map((row, i) => {
    const al = extractALCity(row.mailingAddressFull);
    const street = cleanStreet(row.propertyAddress);
    if (al && street && street.length >= 5) {
      return `${i},"${street}",${al.city},${al.state},${al.zip}`;
    }
    return `${i},"${street || ''}",,`;
  });
  const csvContent = lines.join('\n');

  let retries = 0;
  while (retries < 3) {
    try {
      const form = new FormData();
      form.append('addressFile', Buffer.from('\n' + csvContent), {
        filename: 'addr.csv',
        contentType: 'text/csv'
      });
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
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject);
        req.setTimeout(TIMEOUT_MS, () => reject(new Error('Request timeout')));
        form.pipe(req);
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Parse response — format: "id","matchStatus","coordinates","matchedAddress",...
      const results = {};
      for (const line of response.body.split('\n')) {
        if (!line.trim() || line.trim() === 'null') continue;
        const fields = [];
        let cur = '', q = false;
        for (const c of line.split('')) {
          if (c === '"') { q = !q; cur += c; }
          else if (c === ',' && !q) { fields.push(cur.trim()); cur = ''; }
          else cur += c;
        }
        fields.push(cur.trim());
        // fields[0]=id, fields[1]=matchStatus, fields[2]=coordinates, fields[3]=matchedAddress
        const [id, match, coords] = fields;
        if (match === 'Match') {
          const cm = coords.match(/\(([\d.-]+),\s*([\d.-]+)\)/);
          if (cm) results[id] = { lat: parseFloat(cm[2]), lon: parseFloat(cm[1]) };
        }
      }
      return results;
    } catch (err) {
      retries++;
      if (retries >= 3) throw err;
      await new Promise(r => setTimeout(r, 2000 * retries));
    }
  }
}

async function flushUpdates(client, updates) {
  if (!updates.length) return;
  const pins = updates.map(u => u.pin);
  const lats = updates.map(u => u.lat);
  const lons = updates.map(u => u.lon);
  const res = await client.query(`
    UPDATE madison_parcel_data m
    SET lat = v.lat, lon = v.lon
    FROM (SELECT unnest($1::text[]) AS pin, unnest($2::float[]) AS lat, unnest($3::float[]) AS lon) v
    WHERE m.pin = v.pin AND m.lat IS NULL
  `, [pins, lats, lons]);
  return res.rowCount;
}

async function main() {
  const client = new Client(PG);
  await client.connect();
  console.error('Connected to DB');

  // Get all missing parcels that have property addresses starting with number+letter (likely street addresses)
  const res = await client.query(`
    SELECT pin, "propertyAddress", "mailingAddressFull"
    FROM madison_parcel_data
    WHERE lat IS NULL
      AND "propertyAddress" IS NOT NULL
      AND "propertyAddress" !~ '^0'
      AND "propertyAddress" ~ '^[0-9]+\\\\s+[A-Z]'
    ORDER BY pin
  `);

  const rows = res.rows;
  console.error(`Found ${rows.length} parcels to geocode`);

  if (rows.length === 0) {
    console.log('NO_MISSING');
    await client.end();
    return;
  }

  let totalMatched = 0;
  const allUpdates = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    console.error(`Batch ${i / BATCH + 1}: processing ${chunk.length} parcels...`);

    try {
      const results = await geocodeBatch(chunk);
      let batchMatched = 0;

      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const r = results[j];
        if (r) {
          batchMatched++;
          allUpdates.push({ pin: row.pin, lat: r.lat, lon: r.lon });
        }
      }

      totalMatched += batchMatched;
      console.error(`  Batch matched: ${batchMatched}/${chunk.length} (total: ${totalMatched})`);

    } catch (err) {
      console.error(`  Batch error: ${err.message}`);
    }

    if (i + BATCH < rows.length) {
      await new Promise(r => setTimeout(r, PAUSE_MS));
    }
  }

  console.error(`\nTotal matched: ${totalMatched}/${rows.length}`);

  // Flush all updates
  const updated = await flushUpdates(client, allUpdates);
  console.error(`Updated ${updated} rows in DB`);

  // Final count
  const final = await client.query('SELECT COUNT(*) FROM madison_parcel_data WHERE lat IS NOT NULL');
  console.error(`Final geocoded count: ${final.rows[0].count}`);

  console.log(`DONE:${totalMatched}:${rows.length}:${updated}`);
  await client.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
