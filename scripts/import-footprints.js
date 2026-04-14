#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createReadStream } = require('fs');
const { Pool } = require('pg');
const { createId } = require('@paralleldrive/cuid2');
const { parser } = require('stream-json/parser.js');
const { pick } = require('stream-json/filters/pick.js');
const { streamArray } = require('stream-json/streamers/stream-array.js');
const { chain } = require('stream-chain');

// Config
const DATA_DIR = '/home/dentwon/Eavesight/data/footprints';
const ZIP_URL = 'https://usbuildingdata.blob.core.windows.net/usbuildings-v2/Alabama.geojson.zip';
const ZIP_FILE = path.join(DATA_DIR, 'Alabama.geojson.zip');

// Huntsville metro bounding box
const BBOX = {
  minLat: 34.55,
  maxLat: 34.90,
  minLon: -86.85,
  maxLon: -86.35,
};

const BATCH_SIZE = 500;
const LOG_INTERVAL = 5000;

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'stormvault',
  password: 'stormvault',
  database: 'stormvault',
  max: 4,
});

// Geo helpers
function computeCentroid(coords) {
  const ring = coords[0];
  let sumLon = 0, sumLat = 0;
  const n = ring.length - 1; // exclude closing duplicate
  for (let i = 0; i < n; i++) {
    sumLon += ring[i][0];
    sumLat += ring[i][1];
  }
  return { lat: sumLat / n, lon: sumLon / n };
}

function computeAreaSqft(coords) {
  const ring = coords[0];
  const n = ring.length;

  // First compute centroid latitude for projection
  let midLat = 0;
  for (let i = 0; i < n - 1; i++) midLat += ring[i][1];
  midLat /= (n - 1);

  const latRad = (midLat * Math.PI) / 180;
  const metersPerDegLat = 111120;
  const metersPerDegLon = 111120 * Math.cos(latRad);

  // Project to meters, then shoelace
  let area = 0;
  for (let i = 0; i < n - 1; i++) {
    const x1 = ring[i][0] * metersPerDegLon;
    const y1 = ring[i][1] * metersPerDegLat;
    const x2 = ring[i + 1][0] * metersPerDegLon;
    const y2 = ring[i + 1][1] * metersPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  const areaSqMeters = Math.abs(area) / 2;
  return areaSqMeters * 10.7639;
}

function inBounds(lat, lon) {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;
}

// Download & extract
async function downloadAndExtract() {
  // Check if geojson already exists (could be a symlink)
  const existingFiles = fs.readdirSync(DATA_DIR).filter(function(f) {
    return f.endsWith('.geojson') && !f.includes('.zip');
  });

  if (existingFiles.length > 0) {
    const chosen = path.join(DATA_DIR, existingFiles[0]);
    const stat = fs.statSync(chosen);
    if (stat.size > 1e6) {
      console.log('GeoJSON already exists: ' + existingFiles[0] + ' (' + (stat.size / 1048576).toFixed(0) + ' MB)');
      return chosen;
    }
  }

  // Need to download
  if (!fs.existsSync(ZIP_FILE) || fs.statSync(ZIP_FILE).size < 1e6) {
    console.log('Downloading Alabama.geojson.zip ...');
    execSync('wget -q -O "' + ZIP_FILE + '" "' + ZIP_URL + '"', {
      stdio: 'inherit',
      timeout: 600000,
    });
    console.log('Download complete.');
  } else {
    console.log('ZIP file already exists (' + (fs.statSync(ZIP_FILE).size / 1048576).toFixed(0) + ' MB), skipping download.');
  }

  console.log('Unzipping...');
  execSync('cd "' + DATA_DIR + '" && unzip -o "' + ZIP_FILE + '"', { stdio: 'inherit', timeout: 600000 });
  console.log('Unzip complete.');

  const files = fs.readdirSync(DATA_DIR).filter(function(f) {
    return f.endsWith('.geojson') && !f.includes('.zip');
  });
  if (files.length === 0) throw new Error('No .geojson file found after unzipping');
  const chosen = path.join(DATA_DIR, files[0]);
  console.log('Using: ' + chosen);
  return chosen;
}

// Batch insert using multi-row VALUES
async function insertBatch(client, batch) {
  if (batch.length === 0) return;

  const propPH = [];
  const propVals = [];
  const fpPH = [];
  const fpVals = [];
  let pi = 1, fi = 1;

  for (const row of batch) {
    propPH.push('($' + pi + ',$' + (pi+1) + ',$' + (pi+2) + ',$' + (pi+3) + ',$' + (pi+4) + ',$' + (pi+5) + ',$' + (pi+6) + ',$' + (pi+7) + ',$' + (pi+8) + ',$' + (pi+9) + ',$' + (pi+10) + ')');
    propVals.push(row.propId, row.sourceId, 'Huntsville', 'AL', '35801', 'Madison', row.lat, row.lon, 'RESIDENTIAL', row.now, row.now);
    pi += 11;

    fpPH.push('($' + fi + ',$' + (fi+1) + ',$' + (fi+2) + ',$' + (fi+3) + ',$' + (fi+4) + ',$' + (fi+5) + ',$' + (fi+6) + ',$' + (fi+7) + ',$' + (fi+8) + ')');
    fpVals.push(row.fpId, row.propId, JSON.stringify(row.geometry), row.areaSqft, row.lat, row.lon, 'microsoft', row.sourceId, row.now);
    fi += 9;
  }

  await client.query(
    'INSERT INTO properties (id, address, city, state, zip, county, lat, lon, "propertyType", "createdAt", "updatedAt") VALUES ' + propPH.join(', '),
    propVals
  );
  await client.query(
    'INSERT INTO building_footprints (id, "propertyId", geometry, "areaSqft", "centroidLat", "centroidLon", source, "sourceId", "createdAt") VALUES ' + fpPH.join(', '),
    fpVals
  );
}

// Main
async function main() {
  console.log('=== MS Building Footprints Import: Huntsville Metro ===');
  console.log('Bounding box: lat ' + BBOX.minLat + '-' + BBOX.maxLat + ', lon ' + BBOX.minLon + ' to ' + BBOX.maxLon);
  console.log('');

  const geojsonPath = await downloadAndExtract();
  const fileSizeMB = (fs.statSync(geojsonPath).size / 1048576).toFixed(1);
  console.log('GeoJSON file size: ' + fileSizeMB + ' MB');
  console.log('');

  console.log('Starting streaming import...');
  const startTime = Date.now();
  let totalScanned = 0;
  let totalImported = 0;
  let batch = [];

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL synchronous_commit = off');

    const featureStream = chain([
      createReadStream(geojsonPath, { encoding: 'utf8' }),
      parser(),
      pick({ filter: 'features' }),
      streamArray(),
    ]);

    for await (const data of featureStream) {
      const feature = data.value;
      totalScanned++;

      if (!feature || !feature.geometry || !feature.geometry.coordinates) continue;

      const coords = feature.geometry.coordinates;
      const centroid = computeCentroid(coords);

      if (!inBounds(centroid.lat, centroid.lon)) {
        if (totalScanned % 100000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log('  Scanned ' + totalScanned.toLocaleString() + ' features (' + totalImported.toLocaleString() + ' in bounds) [' + elapsed + 's]');
        }
        continue;
      }

      const areaSqft = computeAreaSqft(coords);
      const propId = createId();
      const fpId = createId();
      const now = new Date();

      batch.push({
        propId: propId,
        fpId: fpId,
        lat: Math.round(centroid.lat * 1e7) / 1e7,
        lon: Math.round(centroid.lon * 1e7) / 1e7,
        areaSqft: Math.round(areaSqft * 100) / 100,
        geometry: feature.geometry,
        sourceId: 'ms-' + totalImported,
        now: now,
      });

      totalImported++;

      if (batch.length >= BATCH_SIZE) {
        await insertBatch(client, batch);
        batch = [];
      }

      if (totalImported % LOG_INTERVAL === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(totalImported / ((Date.now() - startTime) / 1000));
        console.log('  Imported ' + totalImported.toLocaleString() + ' buildings (scanned ' + totalScanned.toLocaleString() + ') [' + elapsed + 's, ' + rate + '/s]');
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      await insertBatch(client, batch);
    }

    await client.query('COMMIT');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('=== Import Complete ===');
    console.log('Total features scanned: ' + totalScanned.toLocaleString());
    console.log('Buildings imported (Huntsville metro): ' + totalImported.toLocaleString());
    console.log('Time: ' + elapsed + 's');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Verify
  const propCount = await pool.query('SELECT count(*) FROM properties');
  const fpCount = await pool.query('SELECT count(*) FROM building_footprints');
  console.log('');
  console.log('DB verification - properties: ' + propCount.rows[0].count + ', building_footprints: ' + fpCount.rows[0].count);

  await pool.end();
  console.log('Done.');
}

main().catch(function(err) {
  console.error('FATAL:', err);
  pool.end();
  process.exit(1);
});
