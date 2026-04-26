#!/usr/bin/env node
/**
 * enrich-all-counties.js
 *
 * Phase 1: Enrich ALL Eavesight properties with county assessor parcel data
 * from ArcGIS MapServer endpoints for Madison, Limestone, and Morgan counties.
 *
 * Madison County: https://web3.kcsgis.com/kcsgis/rest/services/Madison/AL47_GAMAWeb/MapServer/141
 *   Fields: PIN, ASSESS_NUM, PropertyOwner, PropertyAddress, TotalAssessedValue, TotalAppraisedValue, TotalBuildingValue
 *
 * Limestone County: https://gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Parcels/MapServer/0
 *   Fields: ParcelNo, OwnerName, PropertyAddr1, PropertyCity, PropertyZip, TotalValue, TotalImpValue
 *
 * Morgan County: https://al52portal.kcsgis.com/al52server/rest/services/Mapping/Morgan_Public_ISV/MapServer/132
 *   Fields: PIN, PID, Owner, PropAddr1, PropCity, PropZip, HeatedArea, LivingArea, AssdValue, TotalValue, TotalImpValue
 *
 * Strategy:
 *   1. Load all properties from DB with coordinates
 *   2. Build spatial grid index
 *   3. Download parcels from each county ArcGIS service
 *   4. Match by lat/lon proximity (30m)
 *   5. Update DB with owner, address, assessed value, sqft, PIN
 */

const { Pool } = require('pg');
const https = require('https');
const http = require('http');

// ---------- Config ----------
const DB_CONFIG = {
  host: 'localhost',
  port: 5433,
  user: 'eavesight',
  password: 'eavesight',
  database: 'eavesight',
};

const MATCH_RADIUS_M = 30;
const BATCH_UPDATE_SIZE = 500;
const CELL_SIZE = 0.001; // ~111m grid cells

// County configurations
const COUNTIES = [
  {
    name: 'Madison',
    url: 'https://web3.kcsgis.com/kcsgis/rest/services/Madison/AL47_GAMAWeb/MapServer/141/query',
    pageSize: 5000,
    rejectUnauthorized: true,
    outFields: 'PIN,ASSESS_NUM,PropertyOwner,PropertyAddress,TotalAssessedValue,TotalAppraisedValue,TotalBuildingValue,Acres',
    mapFeature: (attrs) => ({
      pin: attrs.PIN,
      assessNum: attrs.ASSESS_NUM,
      owner: attrs.PropertyOwner,
      address: attrs.PropertyAddress,
      assessedValue: attrs.TotalAssessedValue,
      marketValue: attrs.TotalAppraisedValue,
      buildingValue: attrs.TotalBuildingValue,
      acres: attrs.Acres,
      sqft: null,  // Not available in Madison ArcGIS
    }),
  },
  {
    name: 'Limestone',
    url: 'https://gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Parcels/MapServer/0/query',
    pageSize: 2000,
    rejectUnauthorized: false, // SSL cert issues
    outFields: 'ParcelNo,OwnerName,PropertyAddr1,PropertyCity,PropertyState,PropertyZip,TotalValue,TotalImpValue,CALC_ACRE',
    mapFeature: (attrs) => ({
      pin: null,
      assessNum: (attrs.ParcelNo || '').trim(),
      owner: (attrs.OwnerName || '').trim(),
      address: (attrs.PropertyAddr1 || '').trim(),
      city: (attrs.PropertyCity || '').trim(),
      state: (attrs.PropertyState || '').trim(),
      zip: (attrs.PropertyZip || '').trim(),
      assessedValue: attrs.TotalValue,
      marketValue: attrs.TotalValue,
      buildingValue: attrs.TotalImpValue,
      acres: attrs.CALC_ACRE,
      sqft: null,
    }),
  },
  {
    name: 'Morgan',
    url: 'https://al52portal.kcsgis.com/al52server/rest/services/Mapping/Morgan_Public_ISV/MapServer/132/query',
    pageSize: 2000,
    rejectUnauthorized: true,
    outFields: 'PIN,PID,Owner,PropAddr1,PropCity,PropState,PropZip,HeatedArea,LivingArea,AssdValue,TotalValue,TotalImpValue,LandSqFt,CALC_ACRE',
    mapFeature: (attrs) => ({
      pin: attrs.PIN,
      assessNum: attrs.PID,
      owner: (attrs.Owner || '').trim(),
      address: (attrs.PropAddr1 || '').trim(),
      city: (attrs.PropCity || '').trim(),
      state: (attrs.PropState || '').trim(),
      zip: (attrs.PropZip || '').trim(),
      assessedValue: attrs.AssdValue || attrs.TotalValue,
      marketValue: attrs.TotalValue,
      buildingValue: attrs.TotalImpValue,
      acres: attrs.CALC_ACRE,
      sqft: attrs.LivingArea || attrs.HeatedArea || null,
    }),
  },
];

// ---------- Helpers ----------

function fetchJSON(url, rejectUnauthorized = true, retries = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const options = {
      timeout: 60000,
      rejectUnauthorized,
    };
    const doFetch = (attempt) => {
      const urlObj = new URL(url);
      const reqOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        timeout: 60000,
        rejectUnauthorized,
      };
      mod.get(url, { timeout: 60000, rejectUnauthorized }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            if (attempt < retries) {
              console.log(`  Retry ${attempt}/${retries} (parse error: ${data.substring(0,100)})...`);
              setTimeout(() => doFetch(attempt + 1), 3000 * attempt);
            } else {
              reject(new Error(`JSON parse failed after ${retries} retries: ${e.message}\nData: ${data.substring(0,200)}`));
            }
          }
        });
        res.on('error', (e) => {
          if (attempt < retries) {
            console.log(`  Retry ${attempt}/${retries} (${e.message})...`);
            setTimeout(() => doFetch(attempt + 1), 3000 * attempt);
          } else reject(e);
        });
      }).on('error', (e) => {
        if (attempt < retries) {
          console.log(`  Retry ${attempt}/${retries} (${e.message})...`);
          setTimeout(() => doFetch(attempt + 1), 3000 * attempt);
        } else reject(e);
      });
    };
    doFetch(1);
  });
}

function polygonCentroid(rings) {
  let sumLat = 0, sumLon = 0, count = 0;
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

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function titleCase(str) {
  if (!str) return null;
  return str.trim().replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function parseAddress(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '0' || trimmed.startsWith('0 ')) return null;
  return trimmed;
}

// ---------- Main ----------

async function main() {
  const startTime = Date.now();
  console.log('=== Eavesight Multi-County Property Enrichment (Phase 1: ArcGIS) ===\n');

  const pool = new Pool(DB_CONFIG);

  // Step 1: Load all properties
  console.log('Step 1: Loading properties from database...');
  const { rows: properties } = await pool.query(
    `SELECT id, lat, lon, address, "ownerFullName", "assessedValue", "parcelId", sqft, county
     FROM properties
     WHERE lat IS NOT NULL AND lon IS NOT NULL`
  );
  console.log(`  Loaded ${properties.length} properties with coordinates`);

  // Build spatial grid
  const grid = new Map();
  for (const p of properties) {
    const key = `${Math.floor(p.lat / CELL_SIZE)},${Math.floor(p.lon / CELL_SIZE)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  }
  console.log(`  Built spatial grid with ${grid.size} cells\n`);

  // Track total stats
  let totalMatched = 0;
  let totalUpdated = 0;

  // Step 2: Process each county
  for (const county of COUNTIES) {
    console.log(`\n========== ${county.name} County ==========`);

    // Fetch parcel count
    const countUrl = `${county.url}?where=1%3D1&returnCountOnly=true&f=json`;
    const countResult = await fetchJSON(countUrl, county.rejectUnauthorized);
    const totalParcels = countResult.count;
    console.log(`Total parcels in ${county.name}: ${totalParcels}`);

    // Download all parcels with pagination
    const allParcels = [];
    let offset = 0;
    let page = 0;

    while (true) {
      page++;
      const url = `${county.url}?where=1%3D1&outFields=${county.outFields}&returnGeometry=true&outSR=4326&f=json&resultRecordCount=${county.pageSize}&resultOffset=${offset}`;

      if (page % 10 === 1) {
        console.log(`  Fetching page ${page} (offset ${offset})...`);
      }

      let result;
      try {
        result = await fetchJSON(url, county.rejectUnauthorized);
      } catch (e) {
        console.error(`  Error fetching page ${page}: ${e.message}`);
        break;
      }

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

        const mapped = county.mapFeature(attrs);
        mapped.lat = centroid.lat;
        mapped.lon = centroid.lon;
        allParcels.push(mapped);
      }

      if (!result.exceededTransferLimit && result.features.length < county.pageSize) {
        break;
      }
      offset += county.pageSize;
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`  Downloaded ${allParcels.length} parcels with geometry`);

    // Match parcels to properties
    console.log(`  Matching parcels to properties...`);
    const updates = [];
    let matched = 0, noMatch = 0;

    for (const parcel of allParcels) {
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
          address: parseAddress(parcel.address),
          owner: titleCase(parcel.owner),
          assessedValue: parcel.assessedValue,
          marketValue: parcel.marketValue,
          parcelId: parcel.pin || parcel.assessNum || null,
          sqft: parcel.sqft ? Math.round(parcel.sqft) : null,
          dist: bestDist,
        });
      } else {
        noMatch++;
      }
    }

    console.log(`  Matched: ${matched}, No match: ${noMatch}`);

    // Deduplicate
    const bestByProperty = new Map();
    for (const u of updates) {
      const existing = bestByProperty.get(u.id);
      if (!existing || u.dist < existing.dist) {
        bestByProperty.set(u.id, u);
      }
    }
    const dedupedUpdates = Array.from(bestByProperty.values());
    console.log(`  Unique property matches: ${dedupedUpdates.length}`);
    totalMatched += dedupedUpdates.length;

    // Apply updates
    console.log(`  Applying updates...`);
    let updated = 0;

    for (let i = 0; i < dedupedUpdates.length; i += BATCH_UPDATE_SIZE) {
      const batch = dedupedUpdates.slice(i, i + BATCH_UPDATE_SIZE);
      const ids = batch.map((u) => u.id);
      const owners = batch.map((u) => u.owner);
      const assessedValues = batch.map((u) => u.assessedValue);
      const marketValues = batch.map((u) => u.marketValue);
      const parcelIds = batch.map((u) => u.parcelId);
      const sqfts = batch.map((u) => u.sqft);

      try {
        const result = await pool.query(
          `UPDATE properties AS p SET
             "ownerFullName" = COALESCE(u.new_owner, p."ownerFullName"),
             "assessedValue" = COALESCE(u.new_assessed, p."assessedValue"),
             "marketValue" = COALESCE(u.new_market, p."marketValue"),
             "parcelId" = COALESCE(u.new_parcel, p."parcelId"),
             sqft = COALESCE(u.new_sqft, p.sqft),
             "updatedAt" = NOW()
           FROM (
             SELECT
               unnest($1::text[]) AS id,
               unnest($2::text[]) AS new_owner,
               unnest($3::float8[]) AS new_assessed,
               unnest($4::float8[]) AS new_market,
               unnest($5::text[]) AS new_parcel,
               unnest($6::int[]) AS new_sqft
           ) AS u
           WHERE p.id = u.id`,
          [ids, owners, assessedValues, marketValues, parcelIds, sqfts]
        );
        updated += result.rowCount;
      } catch (e) {
        console.error(`  Batch error at offset ${i}: ${e.message}`);
      }

      if ((i + BATCH_UPDATE_SIZE) % 5000 === 0 || i + BATCH_UPDATE_SIZE >= dedupedUpdates.length) {
        console.log(`    ${Math.min(i + BATCH_UPDATE_SIZE, dedupedUpdates.length)}/${dedupedUpdates.length} rows...`);
      }
    }

    // Also update addresses individually
    const addressUpdates = dedupedUpdates.filter((u) => u.address);
    let addressUpdated = 0;
    for (const u of addressUpdates) {
      try {
        await pool.query(
          `UPDATE properties SET address = $2, "updatedAt" = NOW() WHERE id = $1 AND (address IS NULL OR address LIKE 'ms-%' OR address = '')`,
          [u.id, u.address]
        );
        addressUpdated++;
      } catch (e) {
        // Ignore duplicate address errors
      }
    }

    console.log(`  Updated ${updated} rows (${addressUpdated} addresses)`);
    totalUpdated += updated;
  }

  // Final stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const { rows: [stats] } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT("ownerFullName") AS has_owner,
      COUNT("assessedValue") AS has_assessed,
      COUNT("parcelId") AS has_parcel,
      COUNT(sqft) AS has_sqft,
      COUNT("yearBuilt") AS has_yearbuilt
    FROM properties
  `);

  console.log('\n=== Phase 1 Complete ===');
  console.log(`Total matched: ${totalMatched}`);
  console.log(`Total updated: ${totalUpdated}`);
  console.log(`Time: ${elapsed}s`);
  console.log('\n=== Current Coverage ===');
  console.log(`Total: ${stats.total}`);
  console.log(`Owner: ${stats.has_owner} (${((stats.has_owner / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Assessed: ${stats.has_assessed} (${((stats.has_assessed / stats.total) * 100).toFixed(1)}%)`);
  console.log(`ParcelId: ${stats.has_parcel} (${((stats.has_parcel / stats.total) * 100).toFixed(1)}%)`);
  console.log(`SqFt: ${stats.has_sqft} (${((stats.has_sqft / stats.total) * 100).toFixed(1)}%)`);
  console.log(`YearBuilt: ${stats.has_yearbuilt} (${((stats.has_yearbuilt / stats.total) * 100).toFixed(1)}%)`);

  await pool.end();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
