#!/usr/bin/env node
/**
 * reharvest-extended-fields.js
 *
 * Pulls sqft / lotSize / sale history / deed date from the SAME ArcGIS layers
 * we've already used (Madison, Limestone, Morgan) and UPDATEs existing rows
 * by parcelId or spatial match. No inserts.
 *
 * Columns touched: sqft, lotSizeSqft, lastSaleDate, lastSalePrice, yearBuilt
 * (defer to existing non-null values; only fill gaps).
 */
const { Pool } = require('pg');
const https = require('https');

const DB = { host:'localhost', port:5433, user:'eavesight', password:'eavesight', database:'eavesight' };

const SOURCES = [
  {
    name: 'Madison',
    county: 'Madison',
    url: 'https://web3.kcsgis.com/kcsgis/rest/services/Madison/Madison_Public_ISV/MapServer/185/query',
    pageSize: 1000,
    rejectUnauthorized: false,
    outFields: 'PIN,ParcelNum,Acres,DeedDate,TotalAppraisedValue,TotalAssessedValue,TotalBuildingValue,TotalLandValue',
    map: a => ({
      parcelId: a.PIN || a.ParcelNum || null,
      sqft: null,
      lotSqft: a.Acres ? Math.round(a.Acres * 43560) : null,
      lastSaleDate: a.DeedDate ? new Date(a.DeedDate) : null,
      lastSalePrice: null,
      assessedValue: a.TotalAssessedValue || a.TotalAppraisedValue,
      marketValue: a.TotalAppraisedValue,
      buildingValue: a.TotalBuildingValue,
    }),
  },
  {
    name: 'Limestone',
    county: 'Limestone',
    url: 'https://gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Public_ISV/MapServer/103/query',
    pageSize: 1000,
    rejectUnauthorized: false,
    outFields: 'ParcelNo,CALC_ACRE,TotalLandValue,TotalImpValue,TotalValue',
    map: a => ({
      parcelId: (a.ParcelNo || '').trim() || null,
      sqft: null,
      lotSqft: a.CALC_ACRE ? Math.round(a.CALC_ACRE * 43560) : null,
      lastSaleDate: null,
      lastSalePrice: null,
      assessedValue: a.TotalValue,
      marketValue: a.TotalValue,
      buildingValue: a.TotalImpValue,
    }),
  },
  {
    name: 'Morgan',
    county: 'Morgan',
    url: 'https://al52portal.kcsgis.com/al52server/rest/services/Mapping/Morgan_Public_ISV/MapServer/132/query',
    pageSize: 1000,
    rejectUnauthorized: true,
    outFields: 'PIN,PID,HeatedArea,LivingArea,LandSqFt,CALC_ACRE,TotalAcres,SoldTotalPrice,LastSalesDate,AssdValue,TotalValue,TotalImpValue',
    map: a => ({
      parcelId: a.PIN || a.PID || null,
      sqft: a.HeatedArea || a.LivingArea || null,
      lotSqft: a.LandSqFt || (a.CALC_ACRE ? Math.round(a.CALC_ACRE * 43560) : (a.TotalAcres ? Math.round(a.TotalAcres * 43560) : null)),
      lastSaleDate: a.LastSalesDate ? new Date(a.LastSalesDate) : null,
      lastSalePrice: a.SoldTotalPrice || null,
      assessedValue: a.AssdValue || a.TotalValue,
      marketValue: a.TotalValue,
      buildingValue: a.TotalImpValue,
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

async function harvestOne(pool, src) {
  console.log(`\n=== ${src.name} County (extended fields) ===`);
  let offset = 0, total = 0, batchN = 0;
  const rowsBatch = [];

  async function flush() {
    if (rowsBatch.length === 0) return;
    const vals = [];
    const params = [];
    let pi = 1;
    for (const r of rowsBatch) {
      vals.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++})`);
      params.push(r.county, r.parcelId, r.sqft, r.lotSqft, r.lastSaleDate, r.lastSalePrice, r.assessedValue, r.marketValue, r.buildingValue);
    }
    await pool.query(
      `INSERT INTO _harvest_ext (source_county, parcel_id, sqft, lot_sqft, last_sale_date, last_sale_price, assessed_value, market_value, building_value) VALUES ${vals.join(',')}`,
      params
    );
    batchN += rowsBatch.length;
    rowsBatch.length = 0;
  }

  while (true) {
    const url = `${src.url}?where=1=1&outFields=${src.outFields}&returnGeometry=false&resultOffset=${offset}&resultRecordCount=${src.pageSize}&f=json`;
    let data;
    try { data = await fetchJson(url, src.rejectUnauthorized); }
    catch (e) { console.error(`  fetch err offset=${offset}:`, e.message); break; }
    const features = data.features || [];
    if (features.length === 0) break;
    for (const f of features) {
      const m = src.map(f.attributes || {});
      if (!m.parcelId) continue;
      if (!m.sqft && !m.lotSqft && !m.lastSaleDate && !m.lastSalePrice) continue;
      rowsBatch.push({ county: src.county, ...m });
      if (rowsBatch.length >= 500) await flush();
    }
    total += features.length;
    offset += features.length;
    if (total % 10000 < src.pageSize) console.log(`  fetched ${total}...`);
    if (features.length < src.pageSize) break;
  }
  await flush();
  console.log(`  ${src.name}: ${total} fetched, ${batchN} with extended fields loaded`);
}

async function main() {
  const pool = new Pool(DB);

  await pool.query(`
    DROP TABLE IF EXISTS _harvest_ext;
    CREATE UNLOGGED TABLE _harvest_ext (
      id serial primary key,
      source_county text, parcel_id text,
      sqft integer, lot_sqft integer,
      last_sale_date timestamp, last_sale_price double precision,
      assessed_value double precision, market_value double precision, building_value double precision
    );
  `);

  for (const src of SOURCES) await harvestOne(pool, src);

  console.log('\nIndexing temp table...');
  await pool.query(`CREATE INDEX ON _harvest_ext (source_county, parcel_id)`);

  console.log('\nUpdating properties by parcelId match (exact)...');
  const r1 = await pool.query(`
    UPDATE properties p
    SET
      sqft = COALESCE(p.sqft, h.sqft),
      "lotSizeSqft" = COALESCE(p."lotSizeSqft", h.lot_sqft),
      "lastSaleDate" = COALESCE(p."lastSaleDate", h.last_sale_date),
      "lastSalePrice" = COALESCE(p."lastSalePrice", h.last_sale_price),
      "assessedValue" = COALESCE(p."assessedValue", h.assessed_value),
      "marketValue" = COALESCE(p."marketValue", h.market_value)
    FROM _harvest_ext h
    WHERE h.source_county = p.county
      AND h.parcel_id = p."parcelId"
  `);
  console.log(`  Updated ${r1.rowCount} rows by parcelId exact match`);

  const { rows } = await pool.query(`
    SELECT county,
      COUNT(*) total,
      COUNT(*) FILTER (WHERE sqft IS NOT NULL) w_sqft,
      COUNT(*) FILTER (WHERE "lotSizeSqft" IS NOT NULL) w_lot,
      COUNT(*) FILTER (WHERE "lastSaleDate" IS NOT NULL) w_saledate,
      COUNT(*) FILTER (WHERE "lastSalePrice" IS NOT NULL) w_saleprice
    FROM properties GROUP BY county ORDER BY 2 DESC
  `);
  console.log('\nCoverage after extended reharvest:');
  for (const r of rows) console.log(`  ${r.county}: total=${r.total} sqft=${r.w_sqft} lot=${r.w_lot} saleDate=${r.w_saledate} salePrice=${r.w_saleprice}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
