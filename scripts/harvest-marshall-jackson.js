#!/usr/bin/env node
/**
 * harvest-marshall-jackson.js
 *
 * Pulls owner/parcel data for Marshall + Jackson counties AL from kcsgis public
 * MapServers. Spatial-matches to existing properties via KNN within 50m of
 * parcel centroid. UPDATE only, no inserts. Idempotent.
 */
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'stormvault', password:'stormvault', database:'stormvault' };

const SOURCES = [
  {
    name: 'Marshall',
    county: 'Marshall',
    url: 'https://web5.kcsgis.com/kcsgis/rest/services/Marshall/Public/MapServer/37/query',
    pageSize: 1000,
    rejectUnauthorized: false,
    outFields: 'PIN,PARCELID,Owner,MailAdd1,MailAdd2,MailCity,MailState,MailZip1,SitusAddName,SitusAddNumber,SitusAddCity,TTV,TAV,CImpValue,CLandValue,CalcAcres,DeededAcres,Subdivision,DeedRecorded',
    map: a => ({
      parcelId: a.PIN || a.PARCELID || null,
      owner: (a.Owner || '').trim() || null,
      mailAddress: ((a.MailAdd1||'') + (a.MailAdd2?' '+a.MailAdd2:'')).trim(),
      mailCity: (a.MailCity||'').trim(),
      mailState: (a.MailState||'').trim(),
      mailZip: (a.MailZip1||'').trim(),
      propAddr: [(a.SitusAddNumber||''),(a.SitusAddName||'')].filter(Boolean).join(' ').trim(),
      propCity: (a.SitusAddCity||'').trim(),
      propZip: '',
      assessedValue: a.TAV,
      marketValue: a.TTV,
      buildingValue: a.CImpValue,
      acres: a.CalcAcres || a.DeededAcres,
      subdivision: a.Subdivision || null,
      lastSaleDate: a.DeedRecorded ? new Date(a.DeedRecorded) : null,
    }),
  },
  {
    name: 'Jackson',
    county: 'Jackson',
    url: 'https://web3.kcsgis.com/kcsgis/rest/services/Jackson/Public_ISV_Jackson/MapServer/1/query',
    pageSize: 1000,
    rejectUnauthorized: false,
    outFields: 'PIN,PARCELID,PPIN,Owner,MailAdd1,MailAdd2,MailCity,MailState,MailZip1,SitusAddName,SitusAddNumber,SitusAddCity,TTV,TAV,CImpValue,CLandValue,CalcAcres,DeededAcres,Subdivision,DeedRecorded',
    map: a => ({
      parcelId: a.PIN || a.PARCELID || a.PPIN || null,
      owner: (a.Owner || '').trim() || null,
      mailAddress: ((a.MailAdd1||'') + (a.MailAdd2?' '+a.MailAdd2:'')).trim(),
      mailCity: (a.MailCity||'').trim(),
      mailState: (a.MailState||'').trim(),
      mailZip: (a.MailZip1||'').trim(),
      propAddr: [(a.SitusAddNumber||''),(a.SitusAddName||'')].filter(Boolean).join(' ').trim(),
      propCity: (a.SitusAddCity||'').trim(),
      propZip: '',
      assessedValue: a.TAV,
      marketValue: a.TTV,
      buildingValue: a.CImpValue,
      acres: a.CalcAcres || a.DeededAcres,
      subdivision: a.Subdivision || null,
      lastSaleDate: a.DeedRecorded ? new Date(a.DeedRecorded) : null,
    }),
  },
];

function fetchJson(url, rejectUnauthorized) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000, rejectUnauthorized }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP '+res.statusCode)); }
      let d=''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(e); }});
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

function polygonCentroid(rings) {
  const ring = rings && rings[0];
  if (!ring || ring.length === 0) return null;
  let slat = 0, slon = 0, n = 0;
  for (const [lon, lat] of ring) { slat += lat; slon += lon; n++; }
  return n ? { lat: slat/n, lon: slon/n } : null;
}

// Most kcsgis layers come back in Web Mercator (3857). Convert to 4326.
function mercToLatLon(x, y) {
  const lon = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat = 180/Math.PI * (2*Math.atan(Math.exp(lat*Math.PI/180)) - Math.PI/2);
  return { lat, lon };
}

async function harvestOne(pool, src) {
  console.log(`\n=== ${src.name} County ===`);
  let offset = 0, total = 0, inserted = 0;
  const batchParams = [];
  const batchValues = [];
  let pi = 1;
  let srMode = null; // '4326' or 'merc', determined on first response

  async function flush() {
    if (batchValues.length === 0) return;
    await pool.query(
      `INSERT INTO _harvest_mj (source_county, parcel_id, owner, mail_address, mail_city, mail_state, mail_zip,
        prop_address, prop_city, prop_zip, assessed_value, market_value, building_value, acres, subdivision, last_sale_date, centroid_lat, centroid_lon)
       VALUES ${batchValues.join(',')}`,
      batchParams
    );
    inserted += batchValues.length;
    batchValues.length = 0;
    batchParams.length = 0;
    pi = 1;
  }

  while (true) {
    const url = `${src.url}?where=1=1&outFields=${src.outFields}&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=${src.pageSize}&f=json`;
    let data;
    try { data = await fetchJson(url, src.rejectUnauthorized); }
    catch (e) { console.error(`  fetch failed at offset=${offset}:`, e.message); break; }
    const features = data.features || [];
    if (features.length === 0) break;

    if (srMode === null) {
      const wkid = data.spatialReference && (data.spatialReference.wkid || data.spatialReference.latestWkid);
      srMode = (wkid === 4326) ? '4326' : 'merc';
      console.log(`  spatialRef wkid=${wkid} => ${srMode}`);
    }

    for (const f of features) {
      const m = src.map(f.attributes || {});
      const g = f.geometry;
      if (!g || !g.rings || !m.owner) continue;
      let c = polygonCentroid(g.rings);
      if (!c) continue;
      if (srMode === 'merc') c = mercToLatLon(c.lon, c.lat);
      if (c.lat < 30 || c.lat > 40 || c.lon < -90 || c.lon > -80) continue;
      const ph = [];
      for (let k = 0; k < 18; k++) ph.push('$' + (pi++));
      batchValues.push('(' + ph.join(',') + ')');
      batchParams.push(src.county, m.parcelId, m.owner, m.mailAddress, m.mailCity, m.mailState, m.mailZip,
        m.propAddr, m.propCity, m.propZip, m.assessedValue, m.marketValue, m.buildingValue,
        m.acres, m.subdivision, m.lastSaleDate, c.lat, c.lon);
      if (batchValues.length >= 500) await flush();
    }
    total += features.length;
    offset += features.length;
    if (total % 5000 < src.pageSize) console.log(`  fetched ${total}...`);
    if (features.length < src.pageSize) break;
  }
  await flush();
  console.log(`  ${src.name}: ${total} features fetched, ${inserted} loaded into temp`);
}

async function main() {
  const pool = new Pool(DB);

  await pool.query(`
    DROP TABLE IF EXISTS _harvest_mj;
    CREATE UNLOGGED TABLE _harvest_mj (
      id serial primary key,
      source_county text, parcel_id text, owner text,
      mail_address text, mail_city text, mail_state text, mail_zip text,
      prop_address text, prop_city text, prop_zip text,
      assessed_value double precision, market_value double precision, building_value double precision,
      acres double precision, subdivision text,
      last_sale_date timestamp,
      centroid_lat double precision, centroid_lon double precision,
      geog geography(Point, 4326)
    );
  `);

  for (const src of SOURCES) await harvestOne(pool, src);

  console.log('\nBuilding centroid geog + index...');
  await pool.query(`UPDATE _harvest_mj SET geog = ST_SetSRID(ST_MakePoint(centroid_lon, centroid_lat), 4326)::geography WHERE centroid_lat IS NOT NULL`);
  await pool.query('CREATE INDEX ON _harvest_mj USING gist (geog)');
  await pool.query('CREATE INDEX ON _harvest_mj (source_county)');

  console.log('\nSpatial-matching KNN 50m to owner-less Marshall/Jackson properties...');
  const r = await pool.query(`
    WITH matches AS (
      SELECT
        p.id AS property_id,
        nearest.owner, nearest.mail_address, nearest.mail_city, nearest.mail_state, nearest.mail_zip,
        nearest.parcel_id, nearest.assessed_value, nearest.market_value, nearest.acres, nearest.subdivision,
        nearest.last_sale_date,
        nearest.source_county,
        ST_Distance(ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography, nearest.geog) AS dist_m
      FROM properties p
      CROSS JOIN LATERAL (
        SELECT hp.*
        FROM _harvest_mj hp
        WHERE hp.source_county = p.county
          AND hp.geog IS NOT NULL
        ORDER BY hp.geog <-> ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography
        LIMIT 1
      ) nearest
      WHERE p.county IN ('Marshall','Jackson')
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
      "lotSizeSqft" = COALESCE(p."lotSizeSqft", (matches.acres * 43560)::int),
      "lastSaleDate" = COALESCE(p."lastSaleDate", matches.last_sale_date),
      source = COALESCE(p.source, matches.source_county || '-arcgis-knn-50m')
    FROM matches
    WHERE p.id = matches.property_id AND matches.dist_m <= 50
  `);
  console.log(`Filled ${r.rowCount} properties in Marshall + Jackson`);

  const { rows } = await pool.query(`SELECT county, COUNT(*) total, COUNT(*) FILTER (WHERE "ownerFullName" IS NOT NULL) w_owner, COUNT(*) FILTER (WHERE "lotSizeSqft" IS NOT NULL) w_lot FROM properties WHERE county IN ('Marshall','Jackson') GROUP BY county ORDER BY 2 DESC`);
  console.log('\nMarshall/Jackson coverage:');
  for (const r of rows) console.log(`  ${r.county}: ${r.total} total, ${r.w_owner} with owner, ${r.w_lot} with lot`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
