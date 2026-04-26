#!/usr/bin/env node
'use strict';

/**
 * PMTiles v3: Enriched scoring with MRMS hail sizes + assessor data + damage surveys
 *
 * Each property dot now has:
 * - hail: max hail size in inches from MRMS MESH radar (0 = no hail, 2.5+ = severe)
 * - val: assessed value from county assessor
 * - age: roof age estimate (current year - yearBuilt)
 * - own: 1 if has owner name, 0 if not
 * - dmg: composite damage score 0-100
 * - stype: dominant storm type (HAIL, TORNADO, WIND)
 */

const fs = require('fs');
const { execSync } = require('child_process');
const { Pool } = require('pg');

const pool = new Pool({ host:'localhost', port:5433, user:'eavesight', password:'eavesight', database:'eavesight', max:2 });

const OUTPUT_DIR = '/home/dentwon/Eavesight/data';
const GEOJSON_FILE = OUTPUT_DIR + '/buildings-huntsville.geojson';
const PMTILES_FILE = OUTPUT_DIR + '/buildings-huntsville.pmtiles';
const PUBLIC_DIR = '/home/dentwon/Eavesight/apps/frontend/public';
const MESH_FILE = OUTPUT_DIR + '/mesh_output/mesh_hail_data.json';

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function main() {
  console.log('=== PMTiles v3: Enriched Scoring ===');
  const startTime = Date.now();

  // 1. Load MRMS MESH data — build a grid of max hail sizes
  console.log('Loading MRMS MESH hail data...');
  const meshData = JSON.parse(fs.readFileSync(MESH_FILE, 'utf8'));

  // Build a lookup grid: key = "lat_lon" rounded to 0.01 degrees, value = max hail inches
  const hailGrid = {};
  let totalHailCells = 0;

  for (const event of meshData.events || []) {
    const cells = event.grid_cells || [];
    for (const cell of cells) {
      const key = cell.lat.toFixed(2) + '_' + cell.lon.toFixed(2);
      const inches = cell.mesh_inches || (cell.mesh_mm / 25.4);
      if (!hailGrid[key] || inches > hailGrid[key]) {
        hailGrid[key] = inches;
      }
      totalHailCells++;
    }
  }
  console.log('  Loaded ' + Object.keys(hailGrid).length + ' unique grid cells, ' + totalHailCells + ' total readings');

  // 2. Load damage surveys for proximity scoring
  console.log('Loading damage surveys...');
  const surveysRes = await pool.query(`
    SELECT geometry, severity, event_type, date
    FROM damage_surveys
    WHERE geometry IS NOT NULL
      AND severity IN ('EF2','EF3','EF3+','EF4','EF5')
    LIMIT 5000
  `);
  const surveys = surveysRes.rows;
  console.log('  Loaded ' + surveys.length + ' high-severity damage surveys');

  // Extract survey centroids for proximity check
  const surveyCentroids = [];
  for (const s of surveys) {
    const geom = typeof s.geometry === 'string' ? JSON.parse(s.geometry) : s.geometry;
    if (!geom || !geom.coordinates) continue;

    let lat, lon;
    if (geom.type === 'Point') {
      lon = geom.coordinates[0];
      lat = geom.coordinates[1];
    } else if (geom.type === 'LineString' || geom.type === 'Polygon') {
      const coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates;
      lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    }
    if (lat && lon) {
      surveyCentroids.push({ lat, lon, severity: s.severity, type: s.event_type });
    }
  }
  console.log('  ' + surveyCentroids.length + ' survey centroids for proximity');

  // 3. Load properties with enrichment data
  console.log('Loading properties...');
  const propsRes = await pool.query(`
    SELECT p.id, p.lat, p.lon, p."yearBuilt", p."assessedValue",
           p."ownerFullName",
           bf."areaSqft"
    FROM properties p
    JOIN building_footprints bf ON bf."propertyId" = p.id
    WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
  `);
  const properties = propsRes.rows;
  console.log('  ' + properties.length + ' properties');

  // 4. Score each property
  console.log('Scoring with MESH + assessor + damage surveys...');
  const features = [];
  let computed = 0;
  const currentYear = new Date().getFullYear();

  for (const prop of properties) {
    // A. Hail size lookup from MESH grid
    const hailKey = prop.lat.toFixed(2) + '_' + prop.lon.toFixed(2);
    const hailInches = hailGrid[hailKey] || 0;

    // B. Nearest high-severity damage survey
    let nearestSurveyDist = 999;
    let nearestSurveyType = '';
    for (const sc of surveyCentroids) {
      const dist = haversineKm(prop.lat, prop.lon, sc.lat, sc.lon);
      if (dist < nearestSurveyDist) {
        nearestSurveyDist = dist;
        nearestSurveyType = sc.type || 'TORNADO';
      }
    }

    // C. Property enrichment factors
    const roofAge = prop.yearBuilt ? (currentYear - prop.yearBuilt) : 0;
    const value = prop.assessedValue || 0;
    const hasOwner = prop.ownerFullName ? 1 : 0;

    // D. Composite damage score (0-100)
    // Hail component (0-50): 1" = 25, 2" = 40, 3" = 50
    const hailScore = Math.min(50, hailInches * 20);

    // Survey proximity component (0-30): within 5km of EF2+ = 30, 10km = 15, 20km = 5
    const surveyScore = nearestSurveyDist < 5 ? 30 : nearestSurveyDist < 10 ? 15 : nearestSurveyDist < 20 ? 5 : 0;

    // Roof age component (0-20): 20+ years = 20, 15 = 15, 10 = 10, <5 = 0
    const ageScore = roofAge >= 20 ? 20 : roofAge >= 15 ? 15 : roofAge >= 10 ? 10 : roofAge >= 5 ? 5 : 0;

    const dmg = Math.min(100, Math.round(hailScore + surveyScore + ageScore));

    // E. Dominant storm type
    let stype = '';
    if (hailInches >= 1) stype = 'HAIL';
    else if (nearestSurveyDist < 10 && nearestSurveyType === 'TORNADO') stype = 'TORNADO';
    else if (hailInches > 0) stype = 'HAIL';
    else stype = '';

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [prop.lon, prop.lat] },
      properties: {
        id: prop.id,
        area: Math.round(prop.areaSqft || 0),
        hail: Math.round(hailInches * 100) / 100,
        dmg: dmg,
        stype: stype,
        age: roofAge,
        val: Math.round(value / 1000), // in $K for compactness
        own: hasOwner,
      },
    });

    computed++;
    if (computed % 25000 === 0) {
      console.log('  ' + computed + '/' + properties.length);
    }
  }

  // Stats
  const withHail = features.filter(f => f.properties.hail > 0).length;
  const withBigHail = features.filter(f => f.properties.hail >= 1).length;
  const withAge = features.filter(f => f.properties.age > 0).length;
  const withValue = features.filter(f => f.properties.val > 0).length;
  const highDmg = features.filter(f => f.properties.dmg >= 60).length;

  console.log('\n  Score distribution:');
  console.log('    Properties with MESH hail data: ' + withHail);
  console.log('    Properties with 1"+ hail: ' + withBigHail + ' (insurance threshold)');
  console.log('    Properties with roof age: ' + withAge);
  console.log('    Properties with assessed value: ' + withValue);
  console.log('    High priority (60+): ' + highDmg);

  // 5. Write GeoJSON
  console.log('\nWriting GeoJSON...');
  fs.writeFileSync(GEOJSON_FILE, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log('  ' + (fs.statSync(GEOJSON_FILE).size / 1048576).toFixed(1) + ' MB');

  // 6. Generate PMTiles
  console.log('Generating PMTiles...');
  if (fs.existsSync(PMTILES_FILE)) fs.unlinkSync(PMTILES_FILE);
  execSync([
    'tippecanoe', '-o', PMTILES_FILE,
    '-z', '16', '-Z', '10',
    '-r1', '--no-feature-limit', '--no-tile-size-limit',
    '-l', 'buildings',
    GEOJSON_FILE,
  ].join(' '), { stdio: 'inherit' });
  const pmSize = (fs.statSync(PMTILES_FILE).size / 1048576).toFixed(1);
  console.log('  ' + pmSize + ' MB');

  // 7. Deploy
  fs.copyFileSync(PMTILES_FILE, PUBLIC_DIR + '/buildings-huntsville.pmtiles');
  console.log('Deployed to ' + PUBLIC_DIR);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Done in ' + elapsed + 's ===');

  await pool.end();
}

main().catch(function(err) { console.error('FATAL:', err); pool.end(); process.exit(1); });
