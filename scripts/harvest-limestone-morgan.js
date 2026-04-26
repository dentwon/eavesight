#!/usr/bin/env node
/**
 * harvest-limestone-morgan.js
 *
 * Pulls owner/parcel data for Limestone and Morgan counties from their public
 * ArcGIS MapServers and fills property owners via spatial match on polygon
 * centroid -> nearest owner-less property within 50m.
 *
 * Free. No keys. No rate limit (paged at 2000/call).
 */
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'eavesight', password:'eavesight', database:'eavesight' };

const SOURCES = [
  {
    name: 'Limestone',
    county: 'Limestone',
    url: 'https://gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Public_ISV/MapServer/103/query',
    pageSize: 2000,
    rejectUnauthorized: false,
    outFields: 'ParcelNo,OwnerName,OwnerName2,MailAddress1,MailAddress2,MailCity,MailState,MailZip,PropertyAddr1,PropertyCity,PropertyZip,TotalLandValue,TotalImpValue,TotalValue,CALC_ACRE,SubDiv1,Neighborhood,AssessmentClass',
    map: a => ({
      parcelId: (a.ParcelNo || '').trim() || null,
      owner: ((a.OwnerName || '') + (a.OwnerName2 ? ' / ' + a.OwnerName2 : '')).trim() || null,
      mailAddress: (a.MailAddress1 || '').trim() + (a.MailAddress2 ? ' ' + a.MailAddress2 : ''),
      mailCity: (a.MailCity || '').trim(),
      mailState: (a.MailState || '').trim(),
      mailZip: (a.MailZip || '').trim(),
      propAddr: (a.PropertyAddr1 || '').trim(),
      propCity: (a.PropertyCity || '').trim(),
      propZip: (a.PropertyZip || '').trim(),
      assessedValue: a.TotalValue,
      marketValue: a.TotalValue,
      buildingValue: a.TotalImpValue,
      acres: a.CALC_ACRE,
      subdivision: a.SubDiv1,
    }),
  },
  {
    name: 'Morgan',
    county: 'Morgan',
    url: 'https://al52portal.kcsgis.com/al52server/rest/services/Mapping/Morgan_Public_ISV/MapServer/132/query',
    pageSize: 2000,
    rejectUnauthorized: true,
    outFields: 'PIN,PID,Owner,PropAddr1,PropCity,PropZip,HeatedArea,LivingArea,AssdValue,TotalValue,TotalImpValue,LandSqFt,CALC_ACRE',
    map: a => ({
      parcelId: a.PIN || a.PID || null,
      owner: (a.Owner || '').trim() || null,
      mailAddress: '',
      mailCity: '',
      mailState: '',
      mailZip: '',
      propAddr: (a.PropAddr1 || '').trim(),
      propCity: (a.PropCity || '').trim(),
      propZip: (a.PropZip || '').trim(),
      assessedValue: a.AssdValue || a.TotalValue,
      marketValue: a.TotalValue,
      buildingValue: a.TotalImpValue,
      acres: a.CALC_ACRE,
      subdivision: null,
    }),
  },
];

function fetchJson(url, rejectUnauthorized) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 60000, rejectUnauthorized }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
      let d=''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(e); }});
    }).on('error', reject);
  });
}

function polygonCentroid(rings) {
  const ring = rings && rings[0];
  if (!ring || ring.length === 0) return null;
  let slat = 0, slon = 0, n = 0;
  for (const [lon, lat] of ring) { slat += lat; slon += lon; n++; }
  return n ? { lat: slat/n, lon: slon/n } : null;
}

async function harvestOne(pool, src) {
  console.log(`\n=== ${src.name} County ===`);
  let offset = 0, total = 0, inserted = 0;
  const batchParams = [];
  const batchValues = [];
  let pi = 1;

  async function flush() {
    if (batchValues.length === 0) return;
    await pool.query(
      `INSERT INTO _harvest_parcels (source_county, parcel_id, owner, mail_address, mail_city, mail_state, mail_zip,
        prop_address, prop_city, prop_zip, assessed_value, market_value, building_value, acres, subdivision, centroid_lat, centroid_lon)
       VALUES ${batchValues.join(',')}`,
      batchParams
    );
    inserted += batchValues.length;
    batchValues.length = 0;
    batchParams.length = 0;
    pi = 1;
  }

  while (true) {
    const url = `${src.url}?where=1=1&outFields=${src.outFields}&returnGeometry=true&resultOffset=${offset}&resultRecordCount=${src.pageSize}&f=json`;
    let data;
    try { data = await fetchJson(url, src.rejectUnauthorized); }
    catch (e) { console.error('  fetch failed:', e.message); break; }
    const features = data.features || [];
    if (features.length === 0) break;
    for (const f of features) {
      const m = src.map(f.attributes || {});
      const g = f.geometry;
      const c = g && g.rings ? polygonCentroid(g.rings) : null;
      if (!c || !m.owner) continue;
      const ph = [];
      for (let k = 0; k < 17; k++) ph.push('$' + (pi++));
      batchValues.push('(' + ph.join(',') + ')');
      batchParams.push(src.county, m.parcelId, m.owner, m.mailAddress, m.mailCity, m.mailState, m.mailZip,
        m.propAddr, m.propCity, m.propZip, m.assessedValue, m.marketValue, m.buildingValue, m.acres, m.subdivision, c.lat, c.lon);
      if (batchValues.length >= 500) await flush();
    }
    total += features.length;
    offset += src.pageSize;
    if (total % 10000 === 0) console.log(`  fetched ${total}...`);
    if (features.length < src.pageSize) break;
  }
  await flush();
  console.log(`  ${src.name}: ${total} features, ${inserted} loaded into temp`);
}

async function main() {
  const pool = new Pool(DB);

  await pool.query(`
    DROP TABLE IF EXISTS _harvest_parcels;
    CREATE UNLOGGED TABLE _harvest_parcels (
      id serial primary key,
      source_county text, parcel_id text, owner text,
      mail_address text, mail_city text, mail_state text, mail_zip text,
      prop_address text, prop_city text, prop_zip text,
      assessed_value double precision, market_value double precision, building_value double precision,
      acres double precision, subdivision text,
      centroid_lat double precision, centroid_lon double precision,
      geog geography(Point, 4326)
    );
  `);

  for (const src of SOURCES) await harvestOne(pool, src);

  console.log('\nBuilding centroid geog...');
  await pool.query(`UPDATE _harvest_parcels SET geog = ST_SetSRID(ST_MakePoint(centroid_lon, centroid_lat), 4326)::geography WHERE centroid_lat IS NOT NULL`);
  await pool.query('CREATE INDEX ON _harvest_parcels USING gist (geog)');

  console.log('\nSpatial-matching to owner-less properties (KNN 50m)...');
  const r = await pool.query(`
    WITH matches AS (
      SELECT
        p.id AS property_id,
        nearest.owner, nearest.mail_address, nearest.mail_city, nearest.mail_state, nearest.mail_zip,
        nearest.parcel_id, nearest.assessed_value, nearest.market_value, nearest.acres, nearest.subdivision,
        nearest.source_county,
        ST_Distance(ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography, nearest.geog) AS dist_m
      FROM properties p
      CROSS JOIN LATERAL (
        SELECT hp.*
        FROM _harvest_parcels hp
        WHERE hp.source_county = p.county
          AND hp.geog IS NOT NULL
        ORDER BY hp.geog <-> ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography
        LIMIT 1
      ) nearest
      WHERE p.county IN ('Limestone','Morgan')
        AND p."ownerFullName" IS NULL
        AND p.lat IS NOT NULL AND p.lon IS NOT NULL
    )
    UPDATE properties p
    SET
      "ownerFullName" = matches.owner,
      "ownerMailAddress" = NULLIF(matches.mail_address,''),
      "ownerMailCity" = NULLIF(matches.mail_city,''),
      "ownerMailState" = NULLIF(matches.mail_state,''),
      "ownerMailZip" = NULLIF(matches.mail_zip,''),
      "parcelId" = COALESCE(p."parcelId", matches.parcel_id),
      "assessedValue" = COALESCE(p."assessedValue", matches.assessed_value),
      "marketValue" = COALESCE(p."marketValue", matches.market_value),
      source = COALESCE(p.source, matches.source_county || '-arcgis-knn-50m')
    FROM matches
    WHERE p.id = matches.property_id AND matches.dist_m <= 50
  `);
  console.log(`Filled ${r.rowCount} properties in Limestone + Morgan`);

  const { rows } = await pool.query(`SELECT county, COUNT(*) total, COUNT(*) FILTER (WHERE "ownerFullName" IS NULL) without_owner FROM properties GROUP BY county ORDER BY 2 DESC`);
  console.log('\nFinal coverage:');
  for (const r of rows) console.log(`  ${r.county}: ${r.total} total, ${r.without_owner} without owner`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
