#!/usr/bin/env node
/**
 * harvest-census-acs-extended.js
 *
 * Pulls extended ACS 5-year tables for our 5 North Alabama counties at
 * block-group resolution and ingests into _acs_ext_bg (LOGGED):
 *   B25034 - Year structure built (decade buckets) 11 vars
 *   B25024 - Units in structure                    11 vars
 *   B25040 - House heating fuel                    10 vars
 *   B25041 - Bedrooms                               7 vars
 *
 * Schema:
 *   state_fips, county_fips, tract_fips, block_group_fips,
 *   table_id, variable_id, value (numeric), moe (numeric, nullable),
 *   pulled_at (timestamptz)
 *
 * Idempotent: DROP TABLE IF EXISTS, CREATE, INSERT.
 */
const https = require('https');
const { Pool } = require('pg');

const DB = { host: 'localhost', port: 5433, user: 'eavesight', password: 'eavesight', database: 'eavesight' };
const VINTAGE = '2022';
const STATE = '01';
const COUNTIES = {
  Madison:   '089',
  Limestone: '083',
  Morgan:    '103',
  Marshall:  '095',
  Jackson:   '071',
};

const TABLES = {
  B25034: ['B25034_001E','B25034_002E','B25034_003E','B25034_004E','B25034_005E','B25034_006E','B25034_007E','B25034_008E','B25034_009E','B25034_010E','B25034_011E'],
  B25024: ['B25024_001E','B25024_002E','B25024_003E','B25024_004E','B25024_005E','B25024_006E','B25024_007E','B25024_008E','B25024_009E','B25024_010E','B25024_011E'],
  B25040: ['B25040_001E','B25040_002E','B25040_003E','B25040_004E','B25040_005E','B25040_006E','B25040_007E','B25040_008E','B25040_009E','B25040_010E'],
  B25041: ['B25041_001E','B25041_002E','B25041_003E','B25041_004E','B25041_005E','B25041_006E','B25041_007E'],
};

function fetchJson(url, attempt = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000, headers: { 'User-Agent': 'Eavesight/1.0' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  }).catch(async err => {
    if (attempt < 3) {
      const wait = 1500 * (attempt + 1);
      console.log(`    [retry ${attempt + 1}/3 after ${wait}ms] ${err.message}`);
      await new Promise(r => setTimeout(r, wait));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  });
}

async function pullTable(table, vars, countyFips) {
  // Pull both estimate (E) and margin-of-error (M). The Census API allows
  // mixing as long as total <= 50.
  const moeVars = vars.map(v => v.replace(/E$/, 'M'));
  const allVars = [...vars, ...moeVars];
  const get = ['NAME', ...allVars].join(',');
  const url = `https://api.census.gov/data/${VINTAGE}/acs/acs5?get=${get}&for=block%20group:*&in=state:${STATE}%20county:${countyFips}&in=tract:*`;
  const data = await fetchJson(url);
  if (!Array.isArray(data) || data.length < 2) {
    return { rows: [], header: [] };
  }
  const header = data[0];
  const rows = data.slice(1);
  return { rows, header };
}

function parseNumeric(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  // Census uses negative sentinels (-666666666 etc) for "no data".
  if (n < -100000) return null;
  return n;
}

async function main() {
  const pool = new Pool(DB);

  console.log(`[${new Date().toISOString()}] ACS extended harvest start (vintage ${VINTAGE})`);

  await pool.query(`DROP TABLE IF EXISTS _acs_ext_bg`);
  await pool.query(`
    CREATE TABLE _acs_ext_bg (
      id serial primary key,
      state_fips text,
      county_fips text,
      tract_fips text,
      block_group_fips text,
      table_id text,
      variable_id text,
      value numeric,
      moe numeric,
      pulled_at timestamptz default now()
    )
  `);
  console.log('  Created LOGGED _acs_ext_bg');

  const summary = {}; // { tableId: { countyName: rowCount } }
  for (const tbl of Object.keys(TABLES)) summary[tbl] = {};

  let grandTotal = 0;
  for (const [countyName, countyFips] of Object.entries(COUNTIES)) {
    console.log(`\n=== ${countyName} County (FIPS ${countyFips}) ===`);
    for (const [table, vars] of Object.entries(TABLES)) {
      try {
        const { rows, header } = await pullTable(table, vars, countyFips);
        const ix = {
          state: header.indexOf('state'),
          county: header.indexOf('county'),
          tract: header.indexOf('tract'),
          bg: header.indexOf('block group'),
        };
        const moeVars = vars.map(v => v.replace(/E$/, 'M'));
        const insertRows = [];
        const insertParams = [];
        let pi = 1;
        let bgCount = 0;
        for (const row of rows) {
          bgCount++;
          for (let vi = 0; vi < vars.length; vi++) {
            const variableId = vars[vi];
            const moeId = moeVars[vi];
            const eIdx = header.indexOf(variableId);
            const mIdx = header.indexOf(moeId);
            const value = eIdx >= 0 ? parseNumeric(row[eIdx]) : null;
            const moe = mIdx >= 0 ? parseNumeric(row[mIdx]) : null;
            insertRows.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++})`);
            insertParams.push(
              row[ix.state],
              row[ix.county],
              row[ix.tract],
              row[ix.bg],
              table,
              variableId,
              value,
              moe
            );
          }
        }
        // Chunked insert (postgres has a 65535 param limit -> ~8000 rows / 8 params).
        const CHUNK = 5000;
        for (let i = 0; i < insertRows.length; i += CHUNK) {
          const slice = insertRows.slice(i, i + CHUNK);
          const sliceParams = insertParams.slice(i * 8, (i + slice.length) * 8);
          // Re-number the placeholders for this chunk.
          let p = 1;
          const renumbered = slice.map(() => `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
          await pool.query(
            `INSERT INTO _acs_ext_bg (state_fips,county_fips,tract_fips,block_group_fips,table_id,variable_id,value,moe) VALUES ${renumbered.join(',')}`,
            sliceParams
          );
        }
        summary[table][countyName] = insertRows.length;
        grandTotal += insertRows.length;
        console.log(`  ${table}: ${bgCount} BGs x ${vars.length} vars = ${insertRows.length} rows`);
      } catch (e) {
        console.error(`  ${table}: FAILED - ${e.message}`);
        summary[table][countyName] = 0;
      }
    }
  }

  console.log('\nIndexing _acs_ext_bg...');
  await pool.query('CREATE INDEX IF NOT EXISTS _acs_ext_bg_geoid_idx ON _acs_ext_bg (state_fips, county_fips, tract_fips, block_group_fips)');
  await pool.query('CREATE INDEX IF NOT EXISTS _acs_ext_bg_table_idx ON _acs_ext_bg (table_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS _acs_ext_bg_variable_idx ON _acs_ext_bg (variable_id)');

  const totalQ = await pool.query('SELECT COUNT(*) FROM _acs_ext_bg');
  console.log(`\n_acs_ext_bg row count: ${totalQ.rows[0].count}`);

  console.log('\nRows per table_id:');
  const byTable = await pool.query(`SELECT table_id, COUNT(*) FROM _acs_ext_bg GROUP BY 1 ORDER BY 1`);
  for (const r of byTable.rows) console.log(`  ${r.table_id}: ${r.count}`);

  console.log('\nRows per county_fips:');
  const byCounty = await pool.query(`SELECT county_fips, COUNT(*) FROM _acs_ext_bg GROUP BY 1 ORDER BY 1`);
  const fipsToName = Object.fromEntries(Object.entries(COUNTIES).map(([k, v]) => [v, k]));
  for (const r of byCounty.rows) console.log(`  ${r.county_fips} (${fipsToName[r.county_fips] || '?'}): ${r.count}`);

  console.log('\nRows per (table_id, county):');
  const matrix = await pool.query(`SELECT table_id, county_fips, COUNT(*) FROM _acs_ext_bg GROUP BY 1,2 ORDER BY 1,2`);
  for (const r of matrix.rows) console.log(`  ${r.table_id} / ${r.county_fips} (${fipsToName[r.county_fips] || '?'}): ${r.count}`);

  console.log('\nSample rows:');
  const sample = await pool.query(`SELECT state_fips,county_fips,tract_fips,block_group_fips,table_id,variable_id,value,moe FROM _acs_ext_bg ORDER BY id LIMIT 5`);
  for (const r of sample.rows) console.log(`  ${JSON.stringify(r)}`);

  console.log(`\n[${new Date().toISOString()}] ACS extended harvest done. Total: ${grandTotal} rows`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
