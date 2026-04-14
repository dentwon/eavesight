#!/usr/bin/env node
'use strict';

/**
 * Expand building footprints to full North Alabama metro
 * Includes: Decatur, Athens, Madison, Meridianville, New Market,
 * Owens Cross Roads, New Hope, Harvest, Toney, Hazel Green
 *
 * Only imports buildings NOT already in the DB (checks by lat/lon proximity)
 */

const fs = require('fs');
const { Pool } = require('pg');
const { createId } = require('@paralleldrive/cuid2');
const { parser } = require('stream-json/parser.js');
const { pick } = require('stream-json/filters/pick.js');
const { streamArray } = require('stream-json/streamers/stream-array.js');
const { chain } = require('stream-chain');
const { createReadStream } = require('fs');

// Expanded North Alabama metro bounding box
const BBOX = {
  minLat: 34.45,
  maxLat: 34.95,
  minLon: -87.10,
  maxLon: -86.25,
};

// Original bounds (skip these — already imported)
const OLD_BBOX = {
  minLat: 34.55,
  maxLat: 34.90,
  minLon: -86.85,
  maxLon: -86.35,
};

const BATCH_SIZE = 500;
const GEOJSON_FILE = '/home/dentwon/Eavesight/data/footprints/Alabama.geojson';

const pool = new Pool({ host:'localhost', port:5433, user:'stormvault', password:'stormvault', database:'stormvault', max:4 });

function computeCentroid(coords) {
  const ring = coords[0];
  const n = ring.length - 1;
  let sumLon = 0, sumLat = 0;
  for (let i = 0; i < n; i++) { sumLon += ring[i][0]; sumLat += ring[i][1]; }
  return { lat: sumLat / n, lon: sumLon / n };
}

function computeAreaSqft(coords) {
  const ring = coords[0];
  const n = ring.length;
  let midLat = 0;
  for (let i = 0; i < n - 1; i++) midLat += ring[i][1];
  midLat /= (n - 1);
  const latRad = (midLat * Math.PI) / 180;
  const mLat = 111120, mLon = 111120 * Math.cos(latRad);
  let area = 0;
  for (let i = 0; i < n - 1; i++) {
    area += ring[i][0] * mLon * ring[i + 1][1] * mLat - ring[i + 1][0] * mLon * ring[i][1] * mLat;
  }
  return Math.abs(area) / 2 * 10.7639;
}

function inExpandedBounds(lat, lon) {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;
}

function inOldBounds(lat, lon) {
  return lat >= OLD_BBOX.minLat && lat <= OLD_BBOX.maxLat && lon >= OLD_BBOX.minLon && lon <= OLD_BBOX.maxLon;
}

async function insertBatch(client, batch) {
  for (const row of batch) {
    await client.query(
      'INSERT INTO properties (id, address, city, state, zip, county, lat, lon, "propertyType", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) ON CONFLICT DO NOTHING',
      [row.propId, row.sourceId, 'North AL', 'AL', '35000', 'Madison/Limestone/Morgan', row.lat, row.lon, 'RESIDENTIAL']
    );
    await client.query(
      'INSERT INTO building_footprints (id, "propertyId", geometry, "areaSqft", "centroidLat", "centroidLon", source, "sourceId", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT ("propertyId") DO NOTHING',
      [row.fpId, row.propId, JSON.stringify(row.geometry), row.areaSqft, row.lat, row.lon, 'microsoft', row.sourceId]
    );
  }
}

async function main() {
  console.log('=== Expand Footprints to Full North AL Metro ===');
  console.log('New bounds: lat ' + BBOX.minLat + '-' + BBOX.maxLat + ', lon ' + BBOX.minLon + ' to ' + BBOX.maxLon);
  console.log('Skipping buildings in old bounds (already imported)');
  const startTime = Date.now();

  let totalScanned = 0, imported = 0, skippedOld = 0, batch = [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL synchronous_commit = off');

    const featureStream = chain([
      createReadStream(GEOJSON_FILE, { encoding: 'utf8' }),
      parser(),
      pick({ filter: 'features' }),
      streamArray(),
    ]);

    for await (const data of featureStream) {
      const feature = data.value;
      totalScanned++;

      if (!feature || !feature.geometry || !feature.geometry.coordinates) continue;
      const centroid = computeCentroid(feature.geometry.coordinates);

      if (!inExpandedBounds(centroid.lat, centroid.lon)) continue;

      // Skip if in old bounds (already imported)
      if (inOldBounds(centroid.lat, centroid.lon)) {
        skippedOld++;
        continue;
      }

      const areaSqft = computeAreaSqft(feature.geometry.coordinates);
      const propId = createId();
      const fpId = createId();

      batch.push({
        propId, fpId,
        lat: Math.round(centroid.lat * 1e7) / 1e7,
        lon: Math.round(centroid.lon * 1e7) / 1e7,
        areaSqft: Math.round(areaSqft * 100) / 100,
        geometry: feature.geometry,
        sourceId: 'ms-exp-' + imported,
      });

      imported++;

      if (batch.length >= BATCH_SIZE) {
        await insertBatch(client, batch);
        batch = [];
      }

      if (imported % 5000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('  Imported ' + imported.toLocaleString() + ' new buildings (scanned ' + totalScanned.toLocaleString() + ', skipped ' + skippedOld.toLocaleString() + ' existing) [' + elapsed + 's]');
      }

      if (totalScanned % 200000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('  Scanned ' + totalScanned.toLocaleString() + ' [' + elapsed + 's]');
      }
    }

    if (batch.length > 0) {
      await insertBatch(client, batch);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Expansion Complete ===');
  console.log('Total scanned: ' + totalScanned.toLocaleString());
  console.log('New buildings imported: ' + imported.toLocaleString());
  console.log('Skipped (already in DB): ' + skippedOld.toLocaleString());
  console.log('Time: ' + elapsed + 's');

  const propCount = await pool.query('SELECT count(*) FROM properties');
  const fpCount = await pool.query('SELECT count(*) FROM building_footprints');
  console.log('DB total - properties: ' + propCount.rows[0].count + ', footprints: ' + fpCount.rows[0].count);

  await pool.end();
}

main().catch(function(err) { console.error('FATAL:', err); pool.end(); process.exit(1); });
