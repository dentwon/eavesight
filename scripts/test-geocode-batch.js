/**
 * Quick test: geocode 100 parcels and update DB
 */
const { Client } = require('pg');
const https = require('https');
const FormData = require('form-data');

const PG_CONFIG = { host:'localhost', port:5433, database:'eavesight', user:'eavesight', password:'eavesight' };

function escapeCsvField(s) {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseMailingAddr(mailing) {
  const parts = mailing.split(',').map(s => s.trim().toUpperCase());
  let city = '', state = 'AL', zip = '';
  if (parts.length >= 2) {
    const last = parts[parts.length - 1] || '';
    const m = last.match(/^([A-Z]{2})\s*([\d-]*)$/);
    if (m) { state = m[1]; zip = m[2] || ''; }
    city = (parts[parts.length - 2] || '').replace(/,+$/, '').trim();
  }
  const street = parts.slice(0, -2).join(', ').replace(/,+/g, ',').trim();
  return { street, city, state, zip };
}

async function run() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  // Get 100 parcels to geocode
  const r = await client.query('SELECT id, pin, "propertyAddress", "mailingAddressFull" FROM madison_parcel_data WHERE lat IS NULL LIMIT 100');
  console.log('Testing', r.rows.length, 'parcels...');

  const csvLines = r.rows.map((p, i) => {
    const addr = parseMailingAddr(p.mailingAddressFull || '');
    const street = addr.street || p.propertyAddress || '';
    return escapeCsvField('p' + i) + ',' + escapeCsvField(street) + ',' + escapeCsvField(addr.city) + ',' + addr.state + ',' + addr.zip;
  });
  const csv = csvLines.join('\n');

  const form = new FormData();
  form.append('addressFile', Buffer.from(csv), { filename: 'a.csv', contentType: 'text/csv' });
  form.append('benchmark', 'Public_AR_Current');
  form.append('vintage', 'Current_Current');
  form.append('format', 'json');

  return new Promise((resolve) => {
    const options = { hostname: 'geocoding.geo.census.gov', path: '/geocoder/locations/addressbatch', method: 'POST', headers: form.getHeaders() };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', async () => {
        let matched = 0, updated = 0;
        const unmatched = [];
        for (const line of data.split('\n')) {
          if (!line.trim()) continue;
          // Parse CSV manually — fields are "field","field","..."
          const fields = [], chars = line.split('');
          let f = '', q = false;
          for (const c of chars) {
            if (c === '"') { q = !q; }
            else if (c === ',' && !q) { fields.push(f.trim()); f = ''; }
            else f += c;
          }
          fields.push(f.trim());

          if (fields[2] === 'Match') {
            const coordsStr = fields[5] || '';
            const m = coordsStr.match(/^"?(-?[\d.]+),([\d.]+)"?$/);
            if (m) {
              matched++;
              const idx = parseInt(fields[0].replace('p', ''));
              const parcel = r.rows[idx];
              if (parcel) {
                await client.query('UPDATE madison_parcel_data SET lat=$1, lon=$2 WHERE id=$3', [parseFloat(m[2]), parseFloat(m[1]), parcel.id]);
                updated++;
              }
            }
          } else {
            const idx = fields[0] ? parseInt(fields[0].replace('p', '')) : -1;
            if (idx >= 0 && idx < r.rows.length) {
              unmatched.push(r.rows[idx].mailingAddressFull);
            }
          }
        }
        console.log('Matched:', matched, '/', r.rows.length, '| Updated in DB:', updated);
        if (unmatched.length > 0) {
          console.log('Unmatched (first 5):', unmatched.slice(0, 5));
        }
        const r2 = await client.query('SELECT COUNT(*) as cnt FROM madison_parcel_data WHERE lat IS NOT NULL');
        console.log('Total with coords in DB now:', r2.rows[0].cnt);
        await client.end();
        resolve();
      });
    });
    req.on('error', e => { console.error(e); process.exit(1); });
    form.pipe(req);
  });
}

run().catch(e => { console.error(e); process.exit(1); });
