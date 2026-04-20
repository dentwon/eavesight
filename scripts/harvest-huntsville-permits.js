#!/usr/bin/env node
/**
 * harvest-huntsville-permits.js
 *
 * Pulls daily building/roofing permits from Huntsville's Accela Citizen Access
 * open-data endpoint and stores them in the `building_permits` table. Used for:
 *
 *   1. Competitor intel  — who's pulling re-roof / hail-repair permits
 *   2. Lead signal       — homeowners who pulled repair permits but may still
 *                          be eligible for upsell / warranty service
 *   3. Territory saturation — how many permits exist in a ZIP / street grid
 *
 * Idempotent: upserts on (permitNumber, source). Safe to run daily via cron.
 *
 * Usage:
 *   node scripts/harvest-huntsville-permits.js [--since=YYYY-MM-DD] [--dry]
 */
const { Pool } = require('pg');
const https = require('https');

const DB = {
  host: 'localhost',
  port: 5433,
  user: 'stormvault',
  password: 'stormvault',
  database: 'stormvault',
};

const ROOFING_KEYWORDS = /roof|re-roof|reroof|hail|shingle|metal\s*roof/i;
const EXTERIOR_KEYWORDS = /siding|gutter|window|exterior|fence|deck/i;

// Huntsville uses Accela Citizen Access REST — the GIS feed exposes permits as
// a FeatureServer. Endpoint discovered from https://gis.huntsvilleal.gov/
// (queryable 0-layer with GeoJSON output).
const HSV_URL =
  'https://services5.arcgis.com/3vb4wYzbU8B7GZIt/arcgis/rest/services/Building_Permits/FeatureServer/0/query';

const now = new Date();
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const sinceArg = argv.find((a) => a.startsWith('--since='));
const sinceDate = sinceArg
  ? new Date(sinceArg.split('=')[1])
  : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // default: last 7 days

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 30_000, rejectUnauthorized: false }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS building_permits (
      id              TEXT PRIMARY KEY,
      source          TEXT NOT NULL,
      permit_number   TEXT NOT NULL,
      permit_type     TEXT,
      description     TEXT,
      status          TEXT,
      issued_at       TIMESTAMP,
      finaled_at      TIMESTAMP,
      address         TEXT,
      city            TEXT,
      zip             TEXT,
      parcel_id       TEXT,
      contractor      TEXT,
      contractor_type TEXT,
      valuation       NUMERIC,
      lat             DOUBLE PRECISION,
      lon             DOUBLE PRECISION,
      is_roofing      BOOLEAN DEFAULT FALSE,
      is_exterior     BOOLEAN DEFAULT FALSE,
      property_id     TEXT,
      raw             JSONB,
      created_at      TIMESTAMP DEFAULT now(),
      updated_at      TIMESTAMP DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_permits_source_number
      ON building_permits(source, permit_number);
    CREATE INDEX IF NOT EXISTS idx_permits_issued ON building_permits(issued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_permits_contractor ON building_permits(contractor);
    CREATE INDEX IF NOT EXISTS idx_permits_roofing ON building_permits(is_roofing) WHERE is_roofing = TRUE;
    CREATE INDEX IF NOT EXISTS idx_permits_property ON building_permits(property_id);
  `);
}

async function fetchPage(offset, pageSize, sinceTs) {
  const where = `ISSUED_DATE >= ${sinceTs}`;
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
    f: 'geojson',
    orderByFields: 'ISSUED_DATE DESC',
  });
  const url = `${HSV_URL}?${params.toString()}`;
  const data = await fetchJson(url);
  return data.features || [];
}

function classify(desc, type) {
  const text = `${desc || ''} ${type || ''}`;
  return {
    is_roofing: ROOFING_KEYWORDS.test(text),
    is_exterior: EXTERIOR_KEYWORDS.test(text),
  };
}

async function matchPropertyId(pool, lat, lon) {
  if (!lat || !lon) return null;
  const { rows } = await pool.query(
    `SELECT id FROM properties
       WHERE lat IS NOT NULL AND lon IS NOT NULL
       ORDER BY ST_SetSRID(ST_MakePoint($1, $2), 4326) <-> ST_SetSRID(ST_MakePoint(lon, lat), 4326)
       LIMIT 1`,
    [lon, lat],
  );
  return rows[0]?.id ?? null;
}

async function main() {
  const pool = new Pool(DB);
  await ensureTable(pool);

  const sinceTs = sinceDate.getTime(); // Accela accepts epoch-ms
  log('Fetching Huntsville permits since', sinceDate.toISOString(), DRY ? '[DRY-RUN]' : '');

  let offset = 0;
  const pageSize = 1000;
  let total = 0;
  let inserted = 0;
  let roofingCount = 0;

  while (true) {
    let features;
    try {
      features = await fetchPage(offset, pageSize, sinceTs);
    } catch (e) {
      log('Fetch failed at offset', offset, '—', e.message);
      break;
    }
    if (!features.length) break;

    for (const f of features) {
      total++;
      const a = f.properties || {};
      const geom = f.geometry;
      const lon = geom?.coordinates?.[0] ?? null;
      const lat = geom?.coordinates?.[1] ?? null;

      const permitNumber =
        a.PERMIT_NUMBER || a.PERMITNUMBER || a.PERMIT_NO || a.RECORD_ID || a.APPLICATION_NUMBER;
      if (!permitNumber) continue;

      const { is_roofing, is_exterior } = classify(a.DESCRIPTION || a.WORK_DESC, a.PERMIT_TYPE);
      if (is_roofing) roofingCount++;

      const propertyId = await matchPropertyId(pool, lat, lon);

      if (DRY) continue;

      const { rowCount } = await pool.query(
        `
        INSERT INTO building_permits
          (id, source, permit_number, permit_type, description, status, issued_at, finaled_at,
           address, city, zip, parcel_id, contractor, contractor_type, valuation,
           lat, lon, is_roofing, is_exterior, property_id, raw, updated_at)
        VALUES
          (gen_random_uuid()::text, $1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000),
           CASE WHEN $7::bigint IS NOT NULL THEN to_timestamp($7::double precision / 1000) ELSE NULL END,
           $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, now())
        ON CONFLICT (source, permit_number)
        DO UPDATE SET
          status      = EXCLUDED.status,
          finaled_at  = EXCLUDED.finaled_at,
          valuation   = EXCLUDED.valuation,
          property_id = COALESCE(building_permits.property_id, EXCLUDED.property_id),
          raw         = EXCLUDED.raw,
          updated_at  = now();
        `,
        [
          'huntsville',
          String(permitNumber),
          a.PERMIT_TYPE || a.RECORD_TYPE || null,
          a.DESCRIPTION || a.WORK_DESC || null,
          a.STATUS || a.RECORD_STATUS || null,
          a.ISSUED_DATE ?? Date.now(),
          a.FINALED_DATE ?? null,
          a.ADDRESS || a.SITE_ADDRESS || null,
          a.CITY || 'Huntsville',
          a.ZIP || a.POSTAL_CODE || null,
          a.PARCEL_ID || a.PARCEL || null,
          a.CONTRACTOR || a.CONTRACTOR_NAME || null,
          a.CONTRACTOR_TYPE || null,
          Number(a.VALUATION || a.JOB_VALUE || 0) || null,
          lat,
          lon,
          is_roofing,
          is_exterior,
          propertyId,
          JSON.stringify(a),
        ],
      );
      inserted += rowCount;
    }

    if (features.length < pageSize) break;
    offset += features.length;
  }

  log(
    `Done. scanned=${total}, upserted=${inserted}, roofing=${roofingCount}, window=${sinceDate
      .toISOString()
      .slice(0, 10)}..today`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
