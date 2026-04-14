#!/usr/bin/env node
/**
 * enrich-properties.js
 *
 * Enriches the Eavesight properties table with data from the
 * Madison County AL KCSGIS Parcel MapServer layer 141.
 *
 * Data source: https://web3.kcsgis.com/kcsgis/rest/services/Madison/AL47_GAMAWeb/MapServer/141
 * Fields: PropertyOwner, PropertyAddress, TotalAssessedValue, TotalAppraisedValue,
 *         TotalBuildingValue, TotalLandValue, Acres, PIN
 *
 * Strategy:
 *   1. Download all ~200K parcels from the ArcGIS MapServer in pages of 5000
 *   2. Compute centroid of each parcel polygon
 *   3. For each parcel centroid, find the nearest DB property within 30 meters
 *   4. Update matched properties with address, owner, assessed value
 */

const { Pool } = require('pg');
const https = require('https');
const http = require('http');

// ---------- Config ----------
const DB_CONFIG = {
  host: 'localhost',
  port: 5433,
  user: 'stormvault',
  password: 'stormvault',
  database: 'stormvault',
};

const ARCGIS_BASE =
  'https://web3.kcsgis.com/kcsgis/rest/services/Madison/AL47_GAMAWeb/MapServer/141/query';

const OUT_FIELDS = [
  'PIN',
  'PropertyOwner',
  'PropertyAddress',
  'TotalAssessedValue',
  'TotalAppraisedValue',
  'TotalBuildingValue',
  'TotalLandValue',
  'Acres',
  'ParcelNum',
].join(',');

const PAGE_SIZE = 5000; // records per request (well under 50K max)
const MATCH_RADIUS_M = 30; // max distance to match a parcel centroid to a property
const BATCH_UPDATE_SIZE = 500; // DB update batch size

// ---------- Helpers ----------

/** Fetch JSON from URL with retry */
function fetchJSON(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const doFetch = (attempt) => {
      mod.get(url, { timeout: 30000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            if (attempt < retries) {
              console.log(`  Retry ${attempt}/${retries} (parse error)...`);
              setTimeout(() => doFetch(attempt + 1), 2000 * attempt);
            } else {
              reject(new Error(`JSON parse failed after ${retries} retries: ${e.message}`));
            }
          }
        });
        res.on('error', (e) => {
          if (attempt < retries) {
            console.log(`  Retry ${attempt}/${retries} (${e.message})...`);
            setTimeout(() => doFetch(attempt + 1), 2000 * attempt);
          } else {
            reject(e);
          }
        });
      }).on('error', (e) => {
        if (attempt < retries) {
          console.log(`  Retry ${attempt}/${retries} (${e.message})...`);
          setTimeout(() => doFetch(attempt + 1), 2000 * attempt);
        } else {
          reject(e);
        }
      });
    };
    doFetch(1);
  });
}

/** Compute centroid of a polygon (array of rings, each ring is array of [lon, lat]) */
function polygonCentroid(rings) {
  let sumLat = 0, sumLon = 0, count = 0;
  // Use first ring (exterior) only
  const ring = rings[0];
  if (!ring || ring.length === 0) return null;
  for (const [lon, lat] of ring) {
    sumLon += lon;
    sumLat += lat;
    count++;
  }
  if (count === 0) return null;
  return { lat: sumLat / count, lon: sumLon / count };
}

/** Haversine distance in meters */
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/** Parse a property address like "123 MAIN ST" into structured parts */
function parseAddress(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '0' || trimmed.startsWith('0 ')) return null;
  return trimmed;
}

/** Title-case a name: "SMITH, JOHN A" -> "Smith, John A" */
function titleCase(str) {
  if (!str) return null;
  return str.replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// ---------- Main ----------

async function main() {
  const startTime = Date.now();
  console.log('=== Eavesight Property Enrichment ===');
  console.log(`Source: Madison County KCSGIS Parcel MapServer`);
  console.log(`Match radius: ${MATCH_RADIUS_M}m\n`);

  // Step 1: Load all properties from DB into a spatial index (simple grid)
  console.log('Step 1: Loading properties from database...');
  const pool = new Pool(DB_CONFIG);

  const { rows: properties } = await pool.query(
    `SELECT id, lat, lon, address, "ownerFullName", "assessedValue"
     FROM properties
     WHERE lat IS NOT NULL AND lon IS NOT NULL`
  );
  console.log(`  Loaded ${properties.length} properties with coordinates`);

  // Build a grid index for fast spatial lookup (0.001 degree cells ~ 111m)
  const CELL_SIZE = 0.001;
  const grid = new Map();
  for (const p of properties) {
    const key = `${Math.floor(p.lat / CELL_SIZE)},${Math.floor(p.lon / CELL_SIZE)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  }
  console.log(`  Built spatial grid with ${grid.size} cells\n`);

  // Step 2: Fetch all parcels from ArcGIS
  console.log('Step 2: Downloading parcels from KCSGIS MapServer...');

  // First get total count
  const countUrl = `${ARCGIS_BASE}?where=1%3D1&returnCountOnly=true&f=json`;
  const countResult = await fetchJSON(countUrl);
  const totalParcels = countResult.count;
  console.log(`  Total parcels available: ${totalParcels}`);

  const allParcels = [];
  let offset = 0;
  let page = 0;

  while (true) {
    page++;
    const url = `${ARCGIS_BASE}?where=1%3D1&outFields=${OUT_FIELDS}&returnGeometry=true&outSR=4326&f=json&resultRecordCount=${PAGE_SIZE}&resultOffset=${offset}`;
    console.log(`  Fetching page ${page} (offset ${offset})...`);

    const result = await fetchJSON(url);

    if (!result.features || result.features.length === 0) {
      console.log(`  No more features at offset ${offset}`);
      break;
    }

    for (const f of result.features) {
      const attrs = f.attributes;
      const geom = f.geometry;
      if (!geom || !geom.rings) continue;

      const centroid = polygonCentroid(geom.rings);
      if (!centroid) continue;

      allParcels.push({
        pin: attrs.PIN,
        parcelNum: attrs.ParcelNum,
        owner: attrs.PropertyOwner,
        address: attrs.PropertyAddress,
        assessedValue: attrs.TotalAssessedValue,
        appraisedValue: attrs.TotalAppraisedValue,
        buildingValue: attrs.TotalBuildingValue,
        landValue: attrs.TotalLandValue,
        acres: attrs.Acres,
        lat: centroid.lat,
        lon: centroid.lon,
      });
    }

    console.log(`    Got ${result.features.length} features (total: ${allParcels.length})`);

    if (!result.exceededTransferLimit && result.features.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;

    // Small delay to be polite to the server
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`  Downloaded ${allParcels.length} parcels with geometry\n`);

  // Step 3: Match parcels to properties
  console.log('Step 3: Matching parcels to properties by proximity...');

  const updates = []; // { propertyId, address, owner, assessedValue, ... }
  let matched = 0;
  let noMatch = 0;
  let skippedNoAddress = 0;

  for (const parcel of allParcels) {
    const addr = parseAddress(parcel.address);
    if (!addr && !parcel.owner && !parcel.assessedValue) {
      skippedNoAddress++;
      continue;
    }

    // Search neighboring grid cells
    const cellLat = Math.floor(parcel.lat / CELL_SIZE);
    const cellLon = Math.floor(parcel.lon / CELL_SIZE);

    let bestProp = null;
    let bestDist = MATCH_RADIUS_M;

    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const key = `${cellLat + dLat},${cellLon + dLon}`;
        const cell = grid.get(key);
        if (!cell) continue;
        for (const p of cell) {
          const dist = haversineM(parcel.lat, parcel.lon, p.lat, p.lon);
          if (dist < bestDist) {
            bestDist = dist;
            bestProp = p;
          }
        }
      }
    }

    if (bestProp) {
      matched++;
      updates.push({
        id: bestProp.id,
        address: addr,
        owner: titleCase(parcel.owner),
        assessedValue: parcel.assessedValue,
        marketValue: parcel.appraisedValue,
        parcelId: parcel.pin || parcel.parcelNum,
        acres: parcel.acres,
        dist: bestDist,
      });
    } else {
      noMatch++;
    }
  }

  console.log(`  Matched: ${matched}`);
  console.log(`  No match (>30m): ${noMatch}`);
  console.log(`  Skipped (no useful data): ${skippedNoAddress}\n`);

  // Deduplicate: if multiple parcels match the same property, keep closest
  console.log('Step 4: Deduplicating matches (keeping closest per property)...');
  const bestByProperty = new Map();
  for (const u of updates) {
    const existing = bestByProperty.get(u.id);
    if (!existing || u.dist < existing.dist) {
      bestByProperty.set(u.id, u);
    }
  }
  const dedupedUpdates = Array.from(bestByProperty.values());
  console.log(`  Unique property matches: ${dedupedUpdates.length}\n`);

  // Step 5: Apply updates to database
  // We update non-address fields in bulk, then address individually (unique constraint)
  console.log('Step 5: Updating database...');

  let updated = 0;
  let addressUpdated = 0;
  let addressSkipped = 0;
  let errors = 0;

  // Phase A: Bulk update owner, assessed value, market value, parcel ID (no unique constraint issues)
  console.log('  Phase A: Updating owner/value/parcel fields in bulk...');
  for (let i = 0; i < dedupedUpdates.length; i += BATCH_UPDATE_SIZE) {
    const batch = dedupedUpdates.slice(i, i + BATCH_UPDATE_SIZE);

    const ids = batch.map((u) => u.id);
    const owners = batch.map((u) => u.owner);
    const assessedValues = batch.map((u) => u.assessedValue);
    const marketValues = batch.map((u) => u.marketValue);
    const parcelIds = batch.map((u) => u.parcelId);

    try {
      const result = await pool.query(
        `UPDATE properties AS p SET
           "ownerFullName" = COALESCE(u.new_owner, p."ownerFullName"),
           "assessedValue" = COALESCE(u.new_assessed, p."assessedValue"),
           "marketValue" = COALESCE(u.new_market, p."marketValue"),
           "parcelId" = COALESCE(u.new_parcel, p."parcelId"),
           "updatedAt" = NOW()
         FROM (
           SELECT
             unnest($1::text[]) AS id,
             unnest($2::text[]) AS new_owner,
             unnest($3::float8[]) AS new_assessed,
             unnest($4::float8[]) AS new_market,
             unnest($5::text[]) AS new_parcel
         ) AS u
         WHERE p.id = u.id`,
        [ids, owners, assessedValues, marketValues, parcelIds]
      );
      updated += result.rowCount;
    } catch (e) {
      console.error(`  Batch error at offset ${i}: ${e.message}`);
      errors++;
    }

    if ((i + BATCH_UPDATE_SIZE) % 10000 === 0 || i + BATCH_UPDATE_SIZE >= dedupedUpdates.length) {
      console.log(`    ${Math.min(i + BATCH_UPDATE_SIZE, dedupedUpdates.length)}/${dedupedUpdates.length} rows...`);
    }
  }
  console.log(`  Phase A complete: ${updated} rows updated\n`);

  // Phase B: Update addresses individually (unique constraint on address+city+state+zip)
  console.log('  Phase B: Updating addresses individually...');
  const addressUpdates = dedupedUpdates.filter((u) => u.address);
  console.log(`    ${addressUpdates.length} properties have new addresses to set`);

  for (let i = 0; i < addressUpdates.length; i++) {
    const u = addressUpdates[i];
    try {
      await pool.query(
        `UPDATE properties SET address = $2, "updatedAt" = NOW() WHERE id = $1`,
        [u.id, u.address]
      );
      addressUpdated++;
    } catch (e) {
      if (e.code === '23505') {
        addressSkipped++; // duplicate address+city+state+zip
      } else {
        console.error(`  Address error for ${u.id}: ${e.message}`);
        errors++;
      }
    }

    if ((i + 1) % 10000 === 0 || i + 1 === addressUpdates.length) {
      console.log(`    ${i + 1}/${addressUpdates.length} (updated: ${addressUpdated}, skipped dupes: ${addressSkipped})...`);
    }
  }
  console.log(`  Phase B complete: ${addressUpdated} addresses updated, ${addressSkipped} skipped (duplicate)\n`);

  // Step 6: Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('=== Enrichment Complete ===');
  console.log(`Total parcels downloaded: ${allParcels.length}`);
  console.log(`Properties matched: ${dedupedUpdates.length} / ${properties.length}`);
  console.log(`Owner/value rows updated: ${updated}`);
  console.log(`Addresses updated: ${addressUpdated} (${addressSkipped} skipped as duplicates)`);
  console.log(`Errors: ${errors}`);
  console.log(`Time elapsed: ${elapsed}s`);

  // Verify
  const { rows: [stats] } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT("ownerFullName") AS has_owner,
      COUNT("assessedValue") AS has_assessed,
      COUNT("marketValue") AS has_market,
      COUNT("parcelId") AS has_parcel,
      COUNT(CASE WHEN address NOT LIKE 'ms-%' THEN 1 END) AS has_real_address
    FROM properties
  `);
  console.log('\n=== Current Data Coverage ===');
  console.log(`Total properties: ${stats.total}`);
  console.log(`Has real address: ${stats.has_real_address} (${((stats.has_real_address / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Has owner name: ${stats.has_owner} (${((stats.has_owner / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Has assessed value: ${stats.has_assessed} (${((stats.has_assessed / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Has market value: ${stats.has_market} (${((stats.has_market / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Has parcel ID: ${stats.has_parcel} (${((stats.has_parcel / stats.total) * 100).toFixed(1)}%)`);

  await pool.end();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
