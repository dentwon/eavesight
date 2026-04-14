#!/usr/bin/env node
/**
 * import-nws-warnings.js
 *
 * Imports historical NWS severe weather warning polygons from the
 * Iowa Environmental Mesonet (IEM) archive into the damage_surveys table.
 * Covers Severe Thunderstorm Warnings (SV) and Tornado Warnings (TO)
 * from the Huntsville (HUN) NWS office.
 *
 * IEM returns a shapefile ZIP, so we download it, extract, convert to
 * GeoJSON with ogr2ogr, then parse and insert.
 */

const { Pool } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'stormvault',
  password: 'stormvault',
  database: 'stormvault',
});

const TMP_DIR = '/tmp/nws-warnings';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(resolve); });
      file.on('error', (e) => { fs.unlinkSync(dest); reject(e); });
    });
    req.on('error', (e) => { fs.unlinkSync(dest); reject(e); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out')); });
  });
}

function phenomenaToEventType(phenom) {
  if (!phenom) return 'UNKNOWN';
  const p = phenom.toUpperCase().trim();
  if (p === 'TO') return 'TORNADO';
  if (p === 'SV') return 'SEVERE_THUNDERSTORM';
  return p;
}

async function main() {
  // Clean up and create temp dir
  execSync(`rm -rf ${TMP_DIR} && mkdir -p ${TMP_DIR}`);

  const url = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py'
    + '?year1=2025&month1=1&day1=1&year2=2026&month2=3&day2=28'
    + '&wfo[]=HUN&phenomena[]=SV&phenomena[]=TO&significances[]=W&fmt=shp';

  const zipPath = path.join(TMP_DIR, 'warnings.zip');
  const geojsonPath = path.join(TMP_DIR, 'warnings.geojson');

  console.log('Downloading NWS warnings from IEM...');
  console.log('URL:', url);
  await downloadFile(url, zipPath);

  const zipSize = fs.statSync(zipPath).size;
  console.log(`Downloaded ZIP: ${(zipSize / 1024).toFixed(1)} KB`);

  // Extract ZIP
  console.log('Extracting shapefile...');
  execSync(`cd ${TMP_DIR} && unzip -o warnings.zip`, { stdio: 'pipe' });

  // Find the .shp file
  const files = fs.readdirSync(TMP_DIR);
  const shpFile = files.find(f => f.endsWith('.shp'));
  if (!shpFile) {
    console.error('No .shp file found in ZIP. Files:', files.join(', '));
    process.exit(1);
  }
  console.log('Found shapefile:', shpFile);

  // Convert to GeoJSON with ogr2ogr
  console.log('Converting to GeoJSON...');
  execSync(`ogr2ogr -f GeoJSON ${geojsonPath} ${path.join(TMP_DIR, shpFile)}`, { stdio: 'pipe' });

  // Parse GeoJSON
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  const features = geojson.features || [];
  console.log(`Parsed ${features.length} warning polygons`);

  if (features.length === 0) {
    console.log('No features found. Exiting.');
    await pool.end();
    return;
  }

  // Show sample properties to understand field names
  if (features.length > 0) {
    console.log('Sample feature properties:', JSON.stringify(Object.keys(features[0].properties || {})));
  }

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const feature of features) {
      const props = feature.properties || {};
      const geom = feature.geometry;

      if (!geom) {
        skipped++;
        continue;
      }

      // IEM shapefile fields may be truncated (10-char limit in DBF)
      // Common fields: PHENOM, SIG, EVENTID, ISSUED, EXPIRED, WFO, STATUS
      const phenom = props.PHENOM || props.phenom || props.phenomena || '';
      const sig = props.SIG || props.sig || props.significance || '';
      const eventid = props.EVENTID || props.eventid || props.EVENT || '';
      const wfo = props.WFO || props.wfo || 'HUN';
      const issued = props.ISSUED || props.issued || props.issue || props.INIT_ISS || '';
      const expired = props.EXPIRED || props.expired || props.expire || props.INIT_EXP || '';
      const status = props.STATUS || props.status || '';

      if (!phenom) {
        skipped++;
        continue;
      }

      const eventType = phenomenaToEventType(phenom);
      const sourceId = `NWS-IEM-${wfo}-${phenom}-${eventid}-${issued}`;
      const id = `nws-warn-${phenom}-${eventid}-${issued || Date.now()}`;

      let issueDate = null;
      if (issued) {
        // IEM dates can be in various formats
        const d = new Date(issued);
        if (!isNaN(d.getTime())) issueDate = d;
      }

      const description = `${eventType} Warning - Event ${eventid || 'unknown'} (${wfo})`;

      try {
        await client.query(
          `INSERT INTO damage_surveys (id, type, event_type, severity, date, geometry, state, description, source, source_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET
             geometry = EXCLUDED.geometry,
             metadata = EXCLUDED.metadata`,
          [
            id,
            'NWS_WARNING',
            eventType,
            'WARNING',
            issueDate,
            JSON.stringify(geom),
            'AL',
            description,
            'NWS_IEM',
            sourceId,
            JSON.stringify({ phenom, sig, eventid, wfo, issued, expired, status }),
          ]
        );
        inserted++;
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.error(`Error inserting ${id}: ${err.message}`);
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nResults:`);
  console.log(`  Inserted/updated: ${inserted}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total features: ${features.length}`);

  // Verify
  const result = await pool.query(
    `SELECT event_type, COUNT(*) as cnt FROM damage_surveys WHERE type='NWS_WARNING' AND source='NWS_IEM' GROUP BY event_type ORDER BY event_type`
  );
  console.log('\nIn database (NWS_WARNING by type):');
  for (const row of result.rows) {
    console.log(`  ${row.event_type}: ${row.cnt}`);
  }

  // Cleanup
  execSync(`rm -rf ${TMP_DIR}`);

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
