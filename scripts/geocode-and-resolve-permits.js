#!/usr/bin/env node
/**
 * geocode-and-resolve-permits.js  (2026-04-29)
 *
 * Address-resolves the building_permits rows that the existing
 * resolveMadisonProperty / resolvePropertyId loops couldn't match.
 * The PDF-text-extracted addresses are sometimes truncated or have work
 * descriptions appended ("1110 9TH ST SE replace shingles"), so the
 * fuzzy ILIKE resolver gives up. This script:
 *
 *   1) Pulls building_permits.is_roofing rows that have NO matching
 *      property_signals reroof_permit row yet.
 *   2) Cleans the address (strips trailing work-description text).
 *   3) Census Batch Geocoder → lat/lon (10k addrs / request, ~5 min for 1k).
 *   4) For each geocoded permit, finds nearest property within ~50m;
 *      if exactly one within tolerance, emits reroof_permit signal at
 *      confidence 0.95.
 *   5) Updates building_permits.lat/lon for future scoring.
 *
 * Idempotent: property_signals unique on
 *   (propertyId, signalType, source, sourceRecordId).
 *
 * Usage:
 *   node scripts/geocode-and-resolve-permits.js              # dry-run
 *   node scripts/geocode-and-resolve-permits.js --commit
 *   node scripts/geocode-and-resolve-permits.js --commit --source=decatur
 */
const { Client } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PG = { host:'localhost', port:5433, database:'eavesight', user:'eavesight', password:'eavesight' };
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const sourceFilter = (argv.find((a) => a.startsWith('--source=')) || '').slice('--source='.length) || null;
const BATCH = 10000;
const SPATIAL_TOLERANCE_DEG = 0.0006;  // ~66m at 34°N — generous for PDF-parsed addresses
const LOG_FILE = path.join(__dirname, '..', 'logs', 'geocode-permits.log');

function makeLogger() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return (...a) => {
    const line = `[${new Date().toISOString()}] ${a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`;
    console.log(line); stream.write(line + '\n');
  };
}

function escapeCsv(s) {
  if (!s) return '';
  if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Clean a PDF-extracted permit address. Heuristic:
 *   "1820 6th Ave Se Unit P, Q Remove top layer..."
 *     → "1820 6th Ave Se"
 *   "PRBD20260632  HMORE PL SE, Decatur, AL Completing ou and safe room"
 *     → drop (no house number)
 *   "Se Ste 410 insta"
 *     → drop (no house number leading)
 *
 * Strategy: find the first run that starts with `\d+\s+[A-Za-z]` and keep
 * up to the first commonly-seen street suffix (St, Ave, Dr, Rd, Ln, etc).
 */
function cleanAddress(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  // Find house number + first street word + suffix
  const m = s.match(/^(\d+)\s+([A-Za-z0-9].*?)\s+(St|Ave|Dr|Rd|Ln|Blvd|Way|Ct|Pl|Ter|Cir|Aly|Hwy|Pkwy|Trl|Loop|Sq|Pt|Pike)\b\s*([NSEW]+\s*[NSEW]*)?/i);
  if (!m) return null;
  const houseNum = m[1];
  const streetBody = m[2];
  const suffix = m[3];
  const direction = m[4] ? ' ' + m[4].trim() : '';
  return `${houseNum} ${streetBody} ${suffix}${direction}`.replace(/\s+/g, ' ').trim();
}

async function censusBatchGeocode(records) {
  // records: [{tag, street, city, state, zip}, ...]
  const csv = records.map((r) =>
    `${escapeCsv(r.tag)},${escapeCsv(r.street)},${escapeCsv(r.city)},${r.state || 'AL'},${r.zip || ''}`
  ).join('\n');

  const FormData = require('form-data');
  const fd = new FormData();
  fd.append('addressFile', csv, { filename: 'addresses.csv', contentType: 'text/csv' });
  fd.append('benchmark', 'Public_AR_Current');
  fd.append('returntype', 'locations');

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'geocoding.geo.census.gov',
      path: '/geocoder/locations/addressbatch',
      headers: fd.getHeaders(),
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
        // Census returns CSV with quoted fields. Coordinates come as a single
        // "-DD.DDDDD,DD.DDDDD" QUOTED token, so naive split-by-comma breaks.
        // Use a regex to pull tag + Match-flag + lon,lat directly.
        const lines = body.split(/\r?\n/);
        const out = [];
        for (const line of lines) {
          if (!line) continue;
          // tag is first quoted field
          const tagMatch = line.match(/^"([^"]+)"/);
          if (!tagMatch) continue;
          const tag = tagMatch[1];
          if (!/,"Match",/.test(line)) continue;
          const coordMatch = line.match(/"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)"/);
          if (!coordMatch) continue;
          const lon = Number(coordMatch[1]);
          const lat = Number(coordMatch[2]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          out.push({ tag, lat, lon });
        }
        resolve(out);
      });
    });
    req.on('error', reject);
    fd.pipe(req);
  });
}

async function main() {
  const log = makeLogger();
  log(`Starting geocode-and-resolve-permits (commit=${COMMIT}, source=${sourceFilter || 'all'})`);

  const client = new Client(PG);
  await client.connect();
  try {
    // 1) Pull unresolved is_roofing permits
    const sourceClause = sourceFilter ? `AND bp.source = '${sourceFilter}'` : '';
    const { rows: permits } = await client.query(`
      SELECT bp.id, bp.source, bp.permit_number, bp.address, bp.city, bp.zip,
             bp.issued_at, bp.permit_type, bp.description
      FROM building_permits bp
      LEFT JOIN property_signals s
        ON s."sourceRecordId" = (
          CASE
            WHEN bp.source='decatur'              THEN 'decatur:'              || bp.permit_number
            WHEN bp.source='permit.madison-city'  THEN 'madison-city:'         || bp.permit_number
            WHEN bp.source='permit.madison-county'THEN 'madison-county:'       || bp.permit_number
          END
        )
        AND s."signalType" = 'reroof_permit'
      WHERE bp.is_roofing
        AND s.id IS NULL
        AND bp.address IS NOT NULL AND bp.address != ''
        ${sourceClause}
      ORDER BY bp.source, bp.permit_number
    `);
    log(`unresolved roofing permits: ${permits.length}`);

    // 2) Clean addresses
    const cleaned = [];
    for (const p of permits) {
      const street = cleanAddress(p.address);
      if (!street) continue;
      let city = (p.city || '').replace(/^[^A-Z]*([A-Z][A-Z\s]+)$/, '$1').trim() || 'Decatur';
      // Madison-City scraper puts "STREETNAME MADISON" in city — pull just the city
      const cm = city.match(/(MADISON|DECATUR|HUNTSVILLE|ATHENS|MADISON|OWENS\s+CROSS\s+ROADS|HARVEST|HARTSELLE|GURLEY|NEW\s+MARKET|TONEY|BROWNSBORO|MERIDIANVILLE)/i);
      if (cm) city = cm[1];
      cleaned.push({
        tag: `${p.source}|${p.permit_number}`,
        permit_id: p.id,
        permit_number: p.permit_number,
        permit_source: p.source,
        issued_at: p.issued_at,
        street, city, state: 'AL', zip: p.zip || '',
      });
    }
    log(`cleaned: ${cleaned.length} (dropped ${permits.length - cleaned.length} with unparseable addresses)`);

    if (cleaned.length === 0) { log('nothing to geocode'); return; }

    // 3) Geocode in batches
    const geocoded = [];
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const batch = cleaned.slice(i, i + BATCH);
      log(`Geocoding batch ${i / BATCH + 1}: ${batch.length} addresses`);
      try {
        const results = await censusBatchGeocode(batch);
        const byTag = new Map(results.map((r) => [r.tag, r]));
        for (const c of batch) {
          const r = byTag.get(c.tag);
          if (r) geocoded.push({ ...c, lat: r.lat, lon: r.lon });
        }
        log(`  matched ${results.length} of ${batch.length}`);
      } catch (e) {
        log(`  geocode batch failed: ${e.message}`);
      }
    }
    log(`geocoded total: ${geocoded.length}`);

    // 4) Match each to nearest property + emit signal
    let signalsInserted = 0, ambiguous = 0, noMatch = 0, dedupedSkipped = 0;
    for (const g of geocoded) {
      const r = await client.query(`
        SELECT id,
          (lat - $1)*(lat - $1) + (lon - $2)*(lon - $2) AS sqd
        FROM properties
        WHERE lat BETWEEN $1 - $3 AND $1 + $3
          AND lon BETWEEN $2 - $3 AND $2 + $3
        ORDER BY sqd ASC LIMIT 2
      `, [g.lat, g.lon, SPATIAL_TOLERANCE_DEG]);
      if (r.rows.length === 0) { noMatch++; continue; }
      // Census geocodes to STREET CENTERLINE — multiple houses on the block
      // are roughly equidistant. Accept the closest unless the second is
      // truly tied (within 30%). Better to misattribute occasionally at
      // 0.95 confidence than to drop legitimate signals.
      if (r.rows.length === 2 && r.rows[1].sqd < 1.30 * r.rows[0].sqd) { ambiguous++; continue; }
      const propertyId = r.rows[0].id;

      if (!COMMIT) continue;

      const sourceRecordId =
        g.permit_source === 'decatur'              ? `decatur:${g.permit_number}` :
        g.permit_source === 'permit.madison-city'  ? `madison-city:${g.permit_number}` :
        g.permit_source === 'permit.madison-county'? `madison-county:${g.permit_number}` :
        `${g.permit_source}:${g.permit_number}`;

      // Insert signal — match the source naming convention used elsewhere
      const signalSource = g.permit_source === 'decatur' ? 'permit.decatur' : g.permit_source;

      const ins = await client.query(`
        INSERT INTO property_signals
          (id, "propertyId", "signalType", "signalValue", "signalDate", confidence, source, "sourceRecordId")
        VALUES
          ('c' || substr(md5($1 || $2 || 'geo-resolved'), 1, 24),
           $1, 'reroof_permit', $3::jsonb, $4::date, 0.95, $5, $6)
        ON CONFLICT ("propertyId", "signalType", "source", "sourceRecordId") DO NOTHING
        RETURNING id
      `, [
        propertyId,
        sourceRecordId,
        JSON.stringify({
          permitNumber: g.permit_number,
          source: signalSource,
          resolvedVia: 'census-geocoder + nearest-property',
          permitAddress: g.street,
        }),
        g.issued_at ? new Date(g.issued_at).toISOString().slice(0, 10) : null,
        signalSource,
        sourceRecordId,
      ]);
      if (ins.rowCount > 0) signalsInserted++; else dedupedSkipped++;

      // Also update building_permits.lat/lon for future use
      await client.query(`UPDATE building_permits SET lat=$1, lon=$2 WHERE id=$3`, [g.lat, g.lon, g.permit_id]);
    }

    log(`done. geocoded=${geocoded.length} signalsInserted=${signalsInserted} dedupedSkipped=${dedupedSkipped} ambiguous=${ambiguous} noMatch=${noMatch}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
