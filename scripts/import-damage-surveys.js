#!/usr/bin/env node
/**
 * import-damage-surveys.js
 *
 * Imports NWS DAT damage survey data and SPC SVRGIS tornado tracks
 * for Alabama into the Eavesight damage_surveys table.
 */

const { Pool } = require('pg');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = '/home/dentwon/Eavesight/data';

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'stormvault',
  password: 'stormvault',
  database: 'stormvault',
});

// Alabama bounding box
const AL_BBOX = {
  xmin: -88.6,
  ymin: 30.1,
  xmax: -84.8,
  ymax: 35.1,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}\nFirst 500 chars: ${data.slice(0, 500)}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function msToDate(ms) {
  if (!ms || ms < 0) return null;
  return new Date(ms).toISOString();
}

// ── Create Table ─────────────────────────────────────────────────────────────

async function createTable() {
  console.log('Creating damage_surveys table if not exists...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS damage_surveys (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      event_type TEXT,
      severity TEXT,
      date TIMESTAMP,
      geometry JSONB,
      path_width_yards FLOAT,
      path_length_miles FLOAT,
      state TEXT,
      county TEXT,
      description TEXT,
      source TEXT,
      source_id TEXT,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Create indexes (IF NOT EXISTS for safety)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_damage_surveys_state ON damage_surveys(state);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_damage_surveys_date ON damage_surveys(date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_damage_surveys_type ON damage_surveys(type);`);
  console.log('Table ready.');
}

// ── DAT Import ───────────────────────────────────────────────────────────────

async function fetchDATLayer(layerId, layerName, geomType) {
  const baseUrl = 'https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer';
  const bbox = `${AL_BBOX.xmin},${AL_BBOX.ymin},${AL_BBOX.xmax},${AL_BBOX.ymax}`;
  let allFeatures = [];
  let offset = 0;
  const batchSize = 2000;

  console.log(`\nFetching DAT layer ${layerId} (${layerName})...`);

  while (true) {
    const url = `${baseUrl}/${layerId}/query?` +
      `where=1%3D1` +
      `&geometry=${encodeURIComponent(bbox)}` +
      `&geometryType=esriGeometryEnvelope` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&f=geojson` +
      `&resultRecordCount=${batchSize}` +
      `&resultOffset=${offset}`;

    const data = await fetchJSON(url);
    const features = data.features || [];
    console.log(`  Offset ${offset}: got ${features.length} features`);
    allFeatures = allFeatures.concat(features);

    if (features.length < batchSize) break;
    offset += batchSize;
  }

  console.log(`  Total ${layerName}: ${allFeatures.length} features`);
  return allFeatures;
}

function datPointToRow(feat) {
  const p = feat.properties;
  return {
    id: `dat-point-${p.globalid || p.objectid}`,
    type: 'DAT_SURVEY',
    event_type: p.efscale ? 'TORNADO' : 'WIND',
    severity: p.efscale || null,
    date: msToDate(p.stormdate),
    geometry: feat.geometry,
    path_width_yards: null,
    path_length_miles: null,
    state: 'AL',
    county: null,
    description: p.comments || p.damage_txt || null,
    source: 'NWS_DAT',
    source_id: String(p.objectid),
    metadata: {
      layer: 'points',
      damage: p.damage,
      damage_txt: p.damage_txt,
      dod: p.dod,
      dod_txt: p.dod_txt,
      windspeed: p.windspeed,
      injuries: p.injuries,
      deaths: p.deaths,
      office: p.office,
      surveydate: msToDate(p.surveydate),
    },
  };
}

function datLineToRow(feat) {
  const p = feat.properties;
  return {
    id: `dat-line-${p.globalid || p.objectid}`,
    type: 'DAT_SURVEY',
    event_type: 'TORNADO',
    severity: p.efscale || null,
    date: msToDate(p.stormdate),
    geometry: feat.geometry,
    path_width_yards: p.width || null,
    path_length_miles: p.length || null,
    state: 'AL',
    county: null,
    description: p.comments || null,
    source: 'NWS_DAT',
    source_id: String(p.objectid),
    metadata: {
      layer: 'lines',
      maxwind: p.maxwind,
      injuries: p.injuries,
      fatalities: p.fatalities,
      propdamage: p.propdamage,
      cropdamage: p.cropdamage,
      startlat: p.startlat,
      startlon: p.startlon,
      endlat: p.endlat,
      endlon: p.endlon,
      wfo: p.wfo,
    },
  };
}

function datPolyToRow(feat) {
  const p = feat.properties;
  return {
    id: `dat-poly-${p.globalid || p.objectid}`,
    type: 'DAT_SURVEY',
    event_type: 'TORNADO',
    severity: p.efscale || null,
    date: msToDate(p.stormdate),
    geometry: feat.geometry,
    path_width_yards: p.width || null,
    path_length_miles: p.length || null,
    state: 'AL',
    county: null,
    description: p.comments || null,
    source: 'NWS_DAT',
    source_id: String(p.objectid),
    metadata: {
      layer: 'polygons',
      injuries: p.injuries,
      fatalities: p.fatalities,
      path_guid: p.path_guid,
      area: p.Shape__Area,
    },
  };
}

async function importDAT() {
  console.log('\n=== Importing NWS DAT Data for Alabama ===');

  const points = await fetchDATLayer(0, 'Damage Points', 'Point');
  const lines = await fetchDATLayer(1, 'Damage Lines', 'LineString');
  const polys = await fetchDATLayer(2, 'Damage Polygons', 'Polygon');

  // Save raw GeoJSON
  const allFeatures = [...points, ...lines, ...polys];
  const geojson = { type: 'FeatureCollection', features: allFeatures };
  const datPath = path.join(DATA_DIR, 'dat-alabama.geojson');
  fs.writeFileSync(datPath, JSON.stringify(geojson));
  console.log(`Saved ${allFeatures.length} features to ${datPath}`);

  // Convert to rows
  const rows = [
    ...points.map(datPointToRow),
    ...lines.map(datLineToRow),
    ...polys.map(datPolyToRow),
  ];

  return rows;
}

// ── SPC Tornado Tracks ───────────────────────────────────────────────────────

async function downloadAndConvertSPC() {
  console.log('\n=== Downloading SPC SVRGIS Tornado Tracks ===');

  const zipPath = path.join(DATA_DIR, 'svrgis-torn.zip');
  const geojsonPath = path.join(DATA_DIR, 'tornado-tracks-al.geojson');

  // Download if not already present
  if (!fs.existsSync(zipPath)) {
    console.log('Downloading tornado tracks shapefile...');
    execSync(
      `wget -q -O "${zipPath}" "https://www.spc.noaa.gov/gis/svrgis/zipped/1950-2022-torn-aspath.zip"`,
      { stdio: 'inherit', timeout: 120000 }
    );
    console.log('Downloaded.');
  } else {
    console.log('Shapefile zip already exists, skipping download.');
  }

  // Unzip
  console.log('Unzipping...');
  execSync(`cd "${DATA_DIR}" && unzip -o "${zipPath}"`, { stdio: 'inherit', timeout: 60000 });

  // Find the shapefile (may be in a subdirectory)
  let shpPath = null;
  function findShp(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('__')) {
        const found = findShp(path.join(dir, entry.name));
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.shp') && entry.name.includes('torn')) {
        return path.join(dir, entry.name);
      }
    }
    return null;
  }
  shpPath = findShp(DATA_DIR);
  if (!shpPath) {
    throw new Error('No tornado shapefile found after unzip');
  }
  console.log(`Found shapefile: ${shpPath}`);

  // Convert to GeoJSON for Alabama only
  console.log('Converting to GeoJSON (Alabama only)...');
  try {
    execSync(
      `ogr2ogr -f GeoJSON "${geojsonPath}" "${shpPath}" -where "st='AL'" `,
      { stdio: 'inherit', timeout: 120000 }
    );
  } catch (e) {
    // Try alternate field name
    console.log('Trying alternate state field name...');
    execSync(
      `ogr2ogr -f GeoJSON "${geojsonPath}" "${shpPath}" -where "st='AL'" `,
      { stdio: 'inherit', timeout: 120000 }
    );
  }

  console.log(`Converted to ${geojsonPath}`);
  return geojsonPath;
}

let spcIdx = 0;
function spcTrackToRow(feat) {
  spcIdx++;
  const p = feat.properties;
  // SPC uses state FIPS or abbreviation; field varies
  const severity = p.mag !== undefined && p.mag !== null && p.mag >= 0 ? `EF${p.mag}` : null;
  // Date: yr, mo, dy fields or date field
  let date = null;
  if (p.date) {
    date = new Date(p.date).toISOString();
  } else if (p.yr && p.mo && p.dy) {
    date = new Date(`${p.yr}-${String(p.mo).padStart(2, '0')}-${String(p.dy).padStart(2, '0')}`).toISOString();
  }

  return {
    id: `spc-torn-${spcIdx}-${p.om || 0}-${p.yr || 0}`,
    type: 'TORNADO_TRACK',
    event_type: 'TORNADO',
    severity,
    date,
    geometry: feat.geometry,
    path_width_yards: p.wid || null,
    path_length_miles: p.len || null,
    state: 'AL',
    county: null,
    description: null,
    source: 'SPC_SVRGIS',
    source_id: p.om ? String(p.om) : null,
    metadata: {
      om: p.om,
      yr: p.yr,
      mo: p.mo,
      dy: p.dy,
      st: p.st,
      stf: p.stf,
      mag: p.mag,
      inj: p.inj,
      fat: p.fat,
      loss: p.loss,
      closs: p.closs,
      slat: p.slat,
      slon: p.slon,
      elat: p.elat,
      elon: p.elon,
      fc: p.fc,
    },
  };
}

async function importSPC() {
  const geojsonPath = await downloadAndConvertSPC();
  const raw = fs.readFileSync(geojsonPath, 'utf8');
  const geojson = JSON.parse(raw);
  const features = geojson.features || [];
  console.log(`Loaded ${features.length} Alabama tornado tracks from SPC data`);

  return features.map(spcTrackToRow);
}

// ── Bulk Insert ──────────────────────────────────────────────────────────────

async function bulkInsert(rows) {
  console.log(`\n=== Inserting ${rows.length} rows into damage_surveys ===`);

  // Clear existing data for clean import
  await pool.query(`DELETE FROM damage_surveys WHERE state = 'AL'`);
  console.log('Cleared existing AL data.');

  let inserted = 0;
  let errors = 0;
  const batchSize = 100;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const row of batch) {
      values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      params.push(
        row.id,
        row.type,
        row.event_type,
        row.severity,
        row.date,
        JSON.stringify(row.geometry),
        row.path_width_yards,
        row.path_length_miles,
        row.state,
        row.county,
        row.description,
        row.source,
        row.source_id,
        JSON.stringify(row.metadata)
      );
    }

    try {
      await pool.query(
        `INSERT INTO damage_surveys (id, type, event_type, severity, date, geometry, path_width_yards, path_length_miles, state, county, description, source, source_id, metadata)
         VALUES ${values.join(', ')}
         ON CONFLICT (id) DO UPDATE SET
           type = EXCLUDED.type,
           event_type = EXCLUDED.event_type,
           severity = EXCLUDED.severity,
           date = EXCLUDED.date,
           geometry = EXCLUDED.geometry,
           path_width_yards = EXCLUDED.path_width_yards,
           path_length_miles = EXCLUDED.path_length_miles,
           description = EXCLUDED.description,
           metadata = EXCLUDED.metadata`,
        params
      );
      inserted += batch.length;
    } catch (e) {
      console.error(`Batch error at offset ${i}: ${e.message}`);
      // Try individual inserts for the failed batch
      for (const row of batch) {
        try {
          await pool.query(
            `INSERT INTO damage_surveys (id, type, event_type, severity, date, geometry, path_width_yards, path_length_miles, state, county, description, source, source_id, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (id) DO UPDATE SET
               type = EXCLUDED.type, geometry = EXCLUDED.geometry, metadata = EXCLUDED.metadata`,
            [row.id, row.type, row.event_type, row.severity, row.date, JSON.stringify(row.geometry),
             row.path_width_yards, row.path_length_miles, row.state, row.county, row.description,
             row.source, row.source_id, JSON.stringify(row.metadata)]
          );
          inserted++;
        } catch (e2) {
          errors++;
          if (errors <= 5) console.error(`  Row error (${row.id}): ${e2.message}`);
        }
      }
    }

    if ((i + batchSize) % 1000 === 0 || i + batchSize >= rows.length) {
      console.log(`  Progress: ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
    }
  }

  console.log(`\nInserted: ${inserted}, Errors: ${errors}`);
  return { inserted, errors };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    await createTable();

    // Import both sources
    const datRows = await importDAT();
    const spcRows = await importSPC();

    const allRows = [...datRows, ...spcRows];
    const result = await bulkInsert(allRows);

    // Summary
    console.log('\n=== Import Summary ===');
    const counts = await pool.query(`
      SELECT source, type, count(*) as cnt
      FROM damage_surveys
      WHERE state = 'AL'
      GROUP BY source, type
      ORDER BY source, type
    `);
    console.table(counts.rows);

    const dateRange = await pool.query(`
      SELECT source, MIN(date) as earliest, MAX(date) as latest
      FROM damage_surveys
      WHERE state = 'AL' AND date IS NOT NULL
      GROUP BY source
    `);
    console.log('\nDate ranges:');
    console.table(dateRange.rows);

    const sevCounts = await pool.query(`
      SELECT severity, count(*) as cnt
      FROM damage_surveys
      WHERE state = 'AL' AND severity IS NOT NULL
      GROUP BY severity
      ORDER BY severity
    `);
    console.log('\nBy severity:');
    console.table(sevCounts.rows);

  } catch (e) {
    console.error('Fatal error:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
