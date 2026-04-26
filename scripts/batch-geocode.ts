/**
 * Census Batch Geocoder for madison_parcel_data
 * Uses US Census Bureau batch geocoder — free, 10K records per request
 * 
 * Census returns: "id","input_address","match_status","match_type","matched_address","coordinates","tiger_line_id","side"
 * coordinates = "-86.54,34.83" (lon,lat)
 * 
 * Run: DB_PASSWORD=eavesight npx ts-node scripts/batch-geocode.ts
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const PG_CONFIG = {
  host: 'localhost',
  port: 5433,
  database: 'eavesight',
  user: 'eavesight',
  password: process.env.DB_PASSWORD || 'eavesight',
};

const BATCH_SIZE = 10000;
const PAUSE_BETWEEN_BATCHES_MS = 500;
const CENSUS_GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const LOG_FILE = '/tmp/geocode_progress.json';

interface Parcel {
  id: string;
  pin: string;
  propertyAddress: string;
  mailingAddressFull: string;
  idx: string;
}

interface GeocodeResult {
  idx: string;
  lat: number;
  lon: number;
  matchedAddress: string;
}

// Parse CSV line handling quoted fields
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function escapeCsvField(s: string): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function addLatLonColumns(client: Client) {
  try {
    await client.query(`ALTER TABLE madison_parcel_data ADD COLUMN lat double precision`);
    console.log('✅ Added lat column');
  } catch { /* already exists */ }
  try {
    await client.query(`ALTER TABLE madison_parcel_data ADD COLUMN lon double precision`);
    console.log('✅ Added lon column');
  } catch { /* already exists */ }
  try {
    await client.query(`CREATE INDEX IF NOT EXISTS madison_parcel_data_lat_lon_idx ON madison_parcel_data(lat, lon)`);
    console.log('✅ lat/lon index ready');
  } catch { /* already exists */ }
}

async function getParcelsWithoutCoords(client: Client, offset: number, limit: number): Promise<Parcel[]> {
  const result = await client.query(`
    SELECT id, pin, "propertyAddress", "mailingAddressFull"
    FROM madison_parcel_data
    WHERE lat IS NULL
    ORDER BY id
    OFFSET $1 LIMIT $2
  `, [offset, limit]);
  return result.rows.map((r: any) => ({ ...r, idx: '' }));
}

async function getTotalWithoutCoords(client: Client): Promise<number> {
  const result = await client.query(`SELECT COUNT(*) FROM madison_parcel_data WHERE lat IS NULL`);
  return parseInt(result.rows[0].count);
}

function buildCsvContent(parcels: Parcel[]): string {
  const lines = parcels.map((p, i) => {
    const idx = `p${i}`;
    const street = (p.propertyAddress || '').toUpperCase().trim();
    const mailing = (p.mailingAddressFull || '').toUpperCase().trim();

    // Parse mailing address: "123 MAIN ST, HUNTSVILLE, AL 35810" or "123 MAIN ST, HUNTSVILLE, AL"
    const parts = mailing.split(',').map(s => s.trim());
    let streetPart = street;
    let city = '';
    let state = 'AL';
    let zip = '';

    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1] || '';
      const match = lastPart.match(/^([A-Z]{2})\s*([\d-]*)$/);
      if (match) {
        state = match[1];
        zip = match[2] || '';
        city = (parts[parts.length - 2] || '').replace(/,$/, '').trim();
      }
      // Join all but last two as street
      streetPart = parts.slice(0, -2).join(', ').replace(/,+/g, ',').trim() || street;
    }

    return `${escapeCsvField(idx)},${escapeCsvField(streetPart)},${escapeCsvField(city)},${escapeCsvField(state)},${escapeCsvField(zip)}`;
  });
  return lines.join('\n');
}

async function geocodeBatch(parcels: Parcel[]): Promise<GeocodeResult[]> {
  const csvContent = buildCsvContent(parcels);

  return new Promise((resolve, reject) => {
    const form = new (require('form-data'))();
    form.append('addressFile', Buffer.from(csvContent), {
      filename: 'addresses.csv',
      contentType: 'text/csv'
    });
    form.append('benchmark', 'Public_AR_Current');
    form.append('vintage', 'Current_Current');
    form.append('format', 'json');

    const url = new URL(CENSUS_GEOCODER_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: form.getHeaders()
    };

    const req = https.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => data += chunk);
      res.on('end', () => {
        const results: GeocodeResult[] = [];
        for (const line of data.split('\n')) {
          if (!line.trim()) continue;
          const fields = parseCsvLine(line);
          // Format: "id","input_address","match_status","match_type","matched_address","coordinates","tiger_line_id","side"
          if (fields.length >= 6 && fields[2] === 'Match') {
            const coordsStr = fields[5];
            const coordsMatch = coordsStr.match(/^"?(-?[\d.]+),([\d.]+)"?$/);
            if (coordsMatch) {
              results.push({
                idx: fields[0],
                lat: parseFloat(coordsMatch[2]),
                lon: parseFloat(coordsMatch[1]),
                matchedAddress: fields[4] || ''
              });
            }
          }
        }
        resolve(results);
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

function saveProgress(batchNum: number, processed: number, total: number, matched: number) {
  fs.writeFileSync(LOG_FILE, JSON.stringify({ batchNum, processed, total, matched, savedAt: new Date().toISOString() }));
}

async function run() {
  console.log('🚀 Census Batch Geocoder starting...');
  console.log(`   Batch size: ${BATCH_SIZE} | Pause between batches: ${PAUSE_BETWEEN_BATCHES_MS}ms`);

  const client = new Client(PG_CONFIG);
  await client.connect();
  console.log('✅ Connected to PostgreSQL');

  await addLatLonColumns(client);

  const total = await getTotalWithoutCoords(client);
  console.log(`📍 Total parcels needing geocoding: ${total.toLocaleString()}`);

  if (total === 0) {
    console.log('🎉 All parcels already geocoded!');
    await client.end();
    return;
  }

  // Load saved progress
  let startOffset = 0;
  let totalMatched = 0;
  if (fs.existsSync(LOG_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      startOffset = saved.processed;
      totalMatched = saved.matched;
      console.log(`📂 Resuming from offset ${startOffset} (${saved.processed} processed, ${saved.matched} matched so far)`);
    } catch {}
  }

  let processed = startOffset;
  let batchNum = Math.floor(startOffset / BATCH_SIZE) + 1;

  while (true) {
    const parcels = await getParcelsWithoutCoords(client, processed, BATCH_SIZE);
    if (parcels.length === 0) break;

    console.log(`\n📦 Batch ${batchNum}: ${parcels.length} parcels...`);

    const coords = await geocodeBatch(parcels);
    const matchedCount = coords.size;

    // Build idx → parcel map
    const parcelMap = new Map<string, Parcel>();
    parcels.forEach((p, i) => {
      parcelMap.set(`p${i}`, p);
    });

    // Update DB
    let updated = 0;
    for (const coord of coords) {
      const parcel = parcelMap.get(coord.idx);
      if (!parcel) continue;
      try {
        await client.query(
          `UPDATE madison_parcel_data SET lat = $1, lon = $2 WHERE id = $3`,
          [coord.lat, coord.lon, parcel.id]
        );
        updated++;
      } catch (e) {
        console.error(`   Failed to update ${parcel.id}:`, e);
      }
    }

    totalMatched += coords.size;
    processed += parcels.length;
    const pct = ((processed / total) * 100).toFixed(1);
    const matchRate = ((totalMatched / processed) * 100).toFixed(1);

    console.log(`   ✅ Matched: ${matchedCount}/${parcels.length} | Match rate: ${matchRate}%`);
    console.log(`   📊 Progress: ${processed.toLocaleString()}/${total.toLocaleString()} (${pct}%) | Total matched: ${totalMatched.toLocaleString()}`);

    saveProgress(batchNum, processed, total, totalMatched);

    if (coords.size < parcels.length * 0.5) {
      console.warn(`   ⚠️  Low match rate warning — check address quality`);
    }

    if (coords.size < parcels.length) {
      // Save unmatched for retry with different address
      const matchedIdxs = new Set(coords.map(c => c.idx));
      const unmatched = parcels.filter((_, i) => !matchedIdxs.has(`p${i}`));
      console.log(`   📝 ${unmatched.length} unmatched — first few:`, unmatched.slice(0, 2).map(p => p.mailingAddressFull));
    }

    if (processed >= total) break;

    await new Promise(r => setTimeout(r, PAUSE_BETWEEN_BATCHES_MS));
    batchNum++;
  }

  console.log(`\n🎉 DONE! Geocoded ${totalMatched.toLocaleString()} of ${total.toLocaleString()} parcels (${((totalMatched / total) * 100).toFixed(1)}% match rate)`);
  fs.unlinkSync(LOG_FILE);
  await client.end();
}

run().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
