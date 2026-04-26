#!/usr/bin/env node
/**
 * harvest-huntsville-permits.js  (2026-04-21 rewrite)
 *
 * Pulls building permits + certificates of occupancy from the live City of
 * Huntsville ArcGIS Server. Ingests into `building_permits` (idempotent upsert
 * on (source, permit_number)) and backfills `properties.yearBuilt` from
 * new-construction CoCs.
 *
 * Live endpoints:
 *   permits : /Licenses/BuildingPermits/MapServer/0
 *   cocs    : /Licenses/BuildingPermits/MapServer/1
 *
 * Replaces the old script that hit a dead services5.arcgis.com org.
 *
 * Usage:
 *   node scripts/harvest-huntsville-permits.js            # full incremental (last 30 days)
 *   node scripts/harvest-huntsville-permits.js --full     # backfill everything
 *   node scripts/harvest-huntsville-permits.js --since=2024-01-01
 *   node scripts/harvest-huntsville-permits.js --dry      # don't write to DB
 *   node scripts/harvest-huntsville-permits.js --skip-cocs
 */
const { Pool } = require('pg');
const https = require('https');

const DB = {
  host: 'localhost',
  port: 5433,
  user: 'eavesight',
  password: 'eavesight',
  database: 'eavesight',
};

// Tuning
const BASE = 'https://maps.huntsvilleal.gov/server/rest/services/Licenses/BuildingPermits/MapServer';
const PAGE_SIZE = 1000;        // Huntsville allows up to 2000; 1000 is safer
const REQUEST_TIMEOUT = 30_000;
const ROOFING_RE = /roof|re-roof|reroof|hail|shingle/i;
const EXTERIOR_RE = /siding|gutter|window|exterior|fence|deck|stucco/i;

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const FULL = argv.includes('--full');
const SKIP_COCS = argv.includes('--skip-cocs');
const sinceArg = argv.find((a) => a.startsWith('--since='));
const sinceDate = FULL
  ? new Date('1990-01-01')
  : sinceArg
    ? new Date(sinceArg.split('=')[1])
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: REQUEST_TIMEOUT, rejectUnauthorized: false }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(new Error(`JSON parse failed for ${url}: ${e.message}`));
          }
        });
      })
      .on('error', reject)
      .on('timeout', () => reject(new Error(`timeout ${url}`)));
  });
}

async function queryLayer(layerId, offset, sinceIso) {
  // Huntsville's ArcGIS Server only accepts date-literal SQL, not epoch-ms.
  // Probed: `date 'YYYY-MM-DD'` works; bare string and bare bigint fail with
  // extendedCode -2147220985.
  const where = `Permit_Issue_DateTime >= date '${sinceIso}'`;
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: 'Permit_Issue_DateTime DESC',
    f: 'json',
  });
  const url = `${BASE}/${layerId}/query?${params.toString()}`;
  const data = await fetchJson(url);
  if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error)}`);
  return data.features || [];
}

function classify(typeOfWork, occupancyType, occupancySubtype) {
  const t = `${typeOfWork || ''} ${occupancySubtype || ''}`;
  return {
    is_roofing: ROOFING_RE.test(t),
    is_exterior: EXTERIOR_RE.test(t),
  };
}

async function matchPropertyByPoint(pool, lat, lon) {
  if (!lat || !lon) return null;
  const { rows } = await pool.query(
    `SELECT id FROM properties
       WHERE lat IS NOT NULL AND lon IS NOT NULL
         AND abs(lat - $1) < 0.0008
         AND abs(lon - $2) < 0.001
       ORDER BY (lat - $1) * (lat - $1) + (lon - $2) * (lon - $2)
       LIMIT 1`,
    [lat, lon],
  );
  return rows[0]?.id ?? null;
}

async function ingestBatch(pool, features, source, isCoc) {
  let upserts = 0;
  let roofing = 0;
  let ybUpdates = 0;

  for (const f of features) {
    const a = f.attributes || {};
    const g = f.geometry;
    const lon = g?.x ?? null;
    const lat = g?.y ?? null;

    const permitNumber = a.PermitID ? String(a.PermitID) : null;
    if (!permitNumber) continue;

    // CoC records use OccupancyNumber -- append to keep them unique from permits
    const permitKey = isCoc ? `COC-${a.OccupancyNumber || a.PermitID}` : String(a.PermitID);

    const issuedAt = a.Permit_Issue_DateTime; // epoch ms or null
    const finaledAt = isCoc ? a.Occupancy_Issue_DateTime : null;
    const desc =
      [a.TypeOfWork, a.OccupancyType, a.OccupancySubtype, a.Subdivision]
        .filter(Boolean)
        .join(' | ') || null;
    const { is_roofing, is_exterior } = classify(a.TypeOfWork, a.OccupancyType, a.OccupancySubtype);
    if (is_roofing) roofing++;

    const propertyId = await matchPropertyByPoint(pool, lat, lon);

    if (DRY) {
      upserts++;
      continue;
    }

    const valuation = Number(a.ContractAmount ?? a.ActualCost ?? 0) || null;

    const q = `
      INSERT INTO building_permits
        (id, source, permit_number, permit_type, description, status, issued_at, finaled_at,
         address, city, zip, parcel_id, contractor, contractor_type, valuation,
         lat, lon, is_roofing, is_exterior, property_id, raw, updated_at)
      VALUES
        (gen_random_uuid()::text, $1, $2, $3, $4, $5,
         CASE WHEN $6::bigint IS NOT NULL THEN to_timestamp($6::double precision / 1000) ELSE NULL END,
         CASE WHEN $7::bigint IS NOT NULL THEN to_timestamp($7::double precision / 1000) ELSE NULL END,
         $8, $9, NULL, NULL, NULL, NULL, $10, $11, $12, $13, $14, $15, $16::jsonb, now())
      ON CONFLICT (source, permit_number)
      DO UPDATE SET
        description = EXCLUDED.description,
        status      = EXCLUDED.status,
        finaled_at  = EXCLUDED.finaled_at,
        valuation   = EXCLUDED.valuation,
        property_id = COALESCE(building_permits.property_id, EXCLUDED.property_id),
        raw         = EXCLUDED.raw,
        updated_at  = now();
    `;

    const { rowCount } = await pool.query(q, [
      source,                               // $1
      permitKey,                            // $2
      a.TypeOfWork || null,                 // $3 permit_type
      desc,                                 // $4
      isCoc ? 'Finaled' : 'Issued',         // $5 status
      issuedAt ?? null,                     // $6
      finaledAt ?? null,                    // $7
      a.Address || null,                    // $8
      'Huntsville',                         // $9
      valuation,                            // $10
      lat,                                  // $11
      lon,                                  // $12
      is_roofing,                           // $13
      is_exterior,                          // $14
      propertyId,                           // $15
      JSON.stringify(a),                    // $16
    ]);
    upserts += rowCount;

    // Backfill yearBuilt from CoC new-construction
    if (
      isCoc &&
      propertyId &&
      a.TypeOfWork === 'New Construction' &&
      a.Occupancy_Issue_DateTime
    ) {
      const yb = new Date(a.Occupancy_Issue_DateTime).getUTCFullYear();
      if (yb >= 1900 && yb <= new Date().getUTCFullYear()) {
        const res = await pool.query(
          `UPDATE properties SET "yearBuilt" = $1, "updatedAt" = now()
             WHERE id = $2 AND ("yearBuilt" IS NULL OR "yearBuilt" > $1)`,
          [yb, propertyId],
        );
        if (res.rowCount) ybUpdates++;
      }
    }
  }
  return { upserts, roofing, ybUpdates };
}

async function harvestLayer(pool, layerId, source, isCoc) {
  log(`Harvesting layer ${layerId} (${source}) since ${sinceDate.toISOString()}`);
  const sinceIso = sinceDate.toISOString().slice(0, 10); // YYYY-MM-DD
  let offset = 0;
  let total = 0;
  let totalUpserts = 0;
  let totalRoofing = 0;
  let totalYb = 0;

  while (true) {
    let features;
    try {
      features = await queryLayer(layerId, offset, sinceIso);
    } catch (e) {
      log(`Fetch failed offset=${offset}: ${e.message}. Stopping.`);
      break;
    }
    if (!features.length) break;
    total += features.length;

    const { upserts, roofing, ybUpdates } = await ingestBatch(pool, features, source, isCoc);
    totalUpserts += upserts;
    totalRoofing += roofing;
    totalYb += ybUpdates;
    log(`  batch offset=${offset} n=${features.length} upsert=${upserts} roof=${roofing} yb+=${ybUpdates}`);

    if (features.length < PAGE_SIZE) break;
    offset += features.length;
  }

  return { total, totalUpserts, totalRoofing, totalYb };
}

async function main() {
  const pool = new Pool(DB);
  try {
    const permits = await harvestLayer(pool, 0, 'huntsville', false);
    log(`PERMITS: scanned=${permits.total} upserted=${permits.totalUpserts} roofing=${permits.totalRoofing}`);

    if (!SKIP_COCS) {
      const cocs = await harvestLayer(pool, 1, 'huntsville-coc', true);
      log(`COCS:    scanned=${cocs.total} upserted=${cocs.totalUpserts} yearBuilt_backfilled=${cocs.totalYb}`);
    }
  } finally {
    await pool.end();
  }
  log('Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
