#!/usr/bin/env node
/**
 * harvest-hmda-home-improvement.js  (2026-04-29)
 *
 * Pulls Home Mortgage Disclosure Act (HMDA) loan-application records where
 * loan_purpose=2 (home improvement) for the N-AL counties we cover, across
 * multiple years. Rich tract-level data with loan_amount + property_value +
 * action_taken (originated vs denied) + lien_status + tract_median_age.
 *
 * Source: https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?counties=...&years=...&loan_purposes=2
 * Free + public, no API key.
 *
 * Coverage (2023): 1,995 Madison + 426 Limestone + 450 Morgan + 226 Lauderdale
 *                  + 159 Colbert + 122 DeKalb = ~3,378 home-improvement loans/yr
 *
 * Strategy:
 *   1) Fetch CSV per (county, year). Cache to disk.
 *   2) Insert/upsert into staging table _hmda_home_improvement
 *      keyed by (year, county_code, lei, census_tract, loan_amount, action_taken)
 *      — close to unique per record though HMDA rows aren't perfectly identifiable.
 *   3) The v2 blend reads from this staging table to compute a tract-level
 *      "home_improvement_loan_density" prior on roof age (low weight 0.20).
 *
 * Roof-relevance assumption:
 *   loan_amount in [$10k, $60k] is the typical roof-replacement window.
 *   Loans of $60k+ are usually larger renovations (kitchen, addition).
 *   Loans <$10k are minor repairs.
 *   We tag "likely_roof" when loan_amount in [$10k, $60k] AND lien_status=2
 *   (subordinate lien — typical for roof-only HELOC) OR action_taken=1
 *   (originated) AND single-family.
 *
 * Usage:
 *   node scripts/harvest-hmda-home-improvement.js                # default years 2018-2023, all 12 N-AL counties
 *   node scripts/harvest-hmda-home-improvement.js --year=2023
 *   node scripts/harvest-hmda-home-improvement.js --commit
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { Pool } = require('pg');

const DB = { host: 'localhost', port: 5433, user: 'eavesight', password: 'eavesight', database: 'eavesight' };
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const yearArg = argv.find((a) => a.startsWith('--year='));
const YEARS = yearArg ? [Number(yearArg.slice(7))] : [2018, 2019, 2020, 2021, 2022, 2023];
// N-AL FIPS codes
const COUNTIES = {
  '01089': 'Madison', '01083': 'Limestone', '01103': 'Morgan',
  '01077': 'Lauderdale', '01033': 'Colbert', '01049': 'DeKalb',
  '01071': 'Jackson', '01059': 'Franklin', '01093': 'Marion',
  '01095': 'Marshall', '01055': 'Etowah', '01043': 'Cullman',
};
const CACHE = '/tmp/hmda';
const LOG_FILE = path.join(__dirname, '..', 'logs', 'harvest-hmda.log');

function makeLogger() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return (...a) => {
    const line = `[${new Date().toISOString()}] ${a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`;
    console.log(line); stream.write(line + '\n');
  };
}

function downloadCsv(url, destPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'Eavesight-HMDA/1.0 (admin@eavesight.io)' } }, (res) => {
      if (res.statusCode !== 200) {
        out.close(); fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

function parseCsvLine(line) {
  // Simple CSV parser — HMDA data has no embedded quotes/commas in our fields of interest.
  return line.split(',');
}

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _hmda_home_improvement (
      activity_year                int NOT NULL,
      county_code                  text NOT NULL,
      county_name                  text NOT NULL,
      census_tract                 text,
      lei                          text,
      action_taken                 int,        -- 1=Originated, 2=Approved-Not-Accepted, 3=Denied, etc.
      loan_amount                  numeric,
      property_value               numeric,
      loan_to_value_ratio          text,
      interest_rate                text,
      lien_status                  int,        -- 1=First, 2=Subordinate
      total_units                  text,
      tract_owner_occupied_units   int,
      tract_one_to_four_family     int,
      tract_median_age_of_housing  int,
      tract_population             int,
      derived_dwelling_category    text,
      occupancy_type               int,
      raw_row_hash                 text PRIMARY KEY
    );
    CREATE INDEX IF NOT EXISTS hmda_county_tract_year_idx ON _hmda_home_improvement (county_code, census_tract, activity_year);
    CREATE INDEX IF NOT EXISTS hmda_year_idx ON _hmda_home_improvement (activity_year);
  `);
}

async function main() {
  const log = makeLogger();
  fs.mkdirSync(CACHE, { recursive: true });
  log(`Starting HMDA home-improvement loan harvest. years=${YEARS.join(',')} counties=${Object.keys(COUNTIES).length} commit=${COMMIT}`);

  const pool = COMMIT ? new Pool(DB) : null;
  if (COMMIT) await ensureTable(pool);

  let total = 0, inserted = 0, skipped = 0, failed = 0;

  try {
    for (const year of YEARS) {
      for (const [fips, name] of Object.entries(COUNTIES)) {
        const url = `https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?counties=${fips}&years=${year}&loan_purposes=2`;
        const dest = path.join(CACHE, `${year}-${fips}.csv`);

        if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
          try {
            await downloadCsv(url, dest);
          } catch (e) {
            log(`download fail ${year}/${name}: ${e.message}`);
            failed++;
            continue;
          }
        }

        const text = fs.readFileSync(dest, 'utf8');
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) { log(`empty ${year}/${name}`); continue; }
        const header = parseCsvLine(lines[0]);
        const idx = (k) => header.indexOf(k);

        const fields = {
          activity_year: idx('activity_year'),
          census_tract: idx('census_tract'),
          lei: idx('lei'),
          action_taken: idx('action_taken'),
          loan_amount: idx('loan_amount'),
          property_value: idx('property_value'),
          loan_to_value_ratio: idx('loan_to_value_ratio'),
          interest_rate: idx('interest_rate'),
          lien_status: idx('lien_status'),
          total_units: idx('total_units'),
          tract_owner_occupied_units: idx('tract_owner_occupied_units'),
          tract_one_to_four_family_homes: idx('tract_one_to_four_family_homes'),
          tract_median_age_of_housing_units: idx('tract_median_age_of_housing_units'),
          tract_population: idx('tract_population'),
          derived_dwelling_category: idx('derived_dwelling_category'),
          occupancy_type: idx('occupancy_type'),
        };

        let yc = 0, yins = 0;
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i]) continue;
          const cells = parseCsvLine(lines[i]);
          if (cells.length < header.length / 2) continue;
          yc++; total++;

          if (!COMMIT) continue;

          const get = (k) => fields[k] >= 0 ? (cells[fields[k]] || null) : null;
          const num = (v) => (v == null || v === '' || v === 'NA' || v === 'Exempt' || v === '-8' || v === '-9') ? null : Number(v);
          const intOrNull = (v) => { const n = num(v); return Number.isFinite(n) ? Math.round(n) : null; };

          const crypto = require('crypto');
          const rowHash = crypto.createHash('sha1').update(`${year}|${fips}|${get('lei')}|${get('census_tract')}|${get('loan_amount')}|${get('action_taken')}|${i}`).digest('hex');

          try {
            const r = await pool.query(`
              INSERT INTO _hmda_home_improvement
                (activity_year, county_code, county_name, census_tract, lei, action_taken,
                 loan_amount, property_value, loan_to_value_ratio, interest_rate, lien_status,
                 total_units, tract_owner_occupied_units, tract_one_to_four_family,
                 tract_median_age_of_housing, tract_population, derived_dwelling_category,
                 occupancy_type, raw_row_hash)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
              ON CONFLICT (raw_row_hash) DO NOTHING
            `, [
              year, fips, name, get('census_tract'), get('lei'), intOrNull(get('action_taken')),
              num(get('loan_amount')), num(get('property_value')), get('loan_to_value_ratio'),
              get('interest_rate'), intOrNull(get('lien_status')),
              get('total_units'), intOrNull(get('tract_owner_occupied_units')),
              intOrNull(get('tract_one_to_four_family_homes')),
              intOrNull(get('tract_median_age_of_housing_units')),
              intOrNull(get('tract_population')), get('derived_dwelling_category'),
              intOrNull(get('occupancy_type')), rowHash,
            ]);
            if (r.rowCount > 0) { yins++; inserted++; } else { skipped++; }
          } catch (e) {
            failed++;
            if (failed < 5) log(`insert fail ${year}/${name}: ${e.message}`);
          }
        }
        log(`${year}/${name} (${fips}): rows=${yc} inserted=${yins}`);
      }
    }
  } finally {
    if (pool) await pool.end();
  }

  log(`done. total=${total} inserted=${inserted} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
