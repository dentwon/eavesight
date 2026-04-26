#!/usr/bin/env node
/**
 * harvest-huntsville-licenses.js  (2026-04-21)
 *
 * Scrapes City of Huntsville business-license tax records for contractors
 * we care about (roofers, exterior trades, related construction). The portal
 * is publicly accessible, no login, but search-driven: each query returns
 * ~25 rows matched against the business name or DBA. We issue many queries
 * (common stems -- roof, roofing, restoration, exterior, siding, gutter,
 * construction, contracting, home improvement, etc.) and dedupe by license
 * number.
 *
 * Source:
 *   https://apps.huntsvilleal.gov/licTaxSearch/   (ASP.NET WebForms)
 *
 * Fields captured per license record:
 *   license_number, business_name, owner_name, entity_type,
 *   license_years (int[]), address, city_state_zip, source='huntsville-lic'
 *
 * Idempotent upsert on (source, license_number). Keeps a rolling array of
 * license_years so we can track continuity (who's been licensed every year
 * vs. who's intermittent).
 *
 * Usage:
 *   node scripts/harvest-huntsville-licenses.js            # default queries
 *   node scripts/harvest-huntsville-licenses.js --dry      # don't write
 *   node scripts/harvest-huntsville-licenses.js --queries=roof,siding,exterior
 */
const { Pool } = require('pg');
const https = require('https');
const { URLSearchParams } = require('url');

const DB = {
  host: 'localhost',
  port: 5433,
  user: 'eavesight',
  password: 'eavesight',
  database: 'eavesight',
};

const URL = 'https://apps.huntsvilleal.gov/licTaxSearch/';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const queriesArg = argv.find((a) => a.startsWith('--queries='));

// Default search terms. Ordered roughly most-specific-first. The portal
// returns a page of up to ~25 rows per search, so we issue many overlapping
// terms and dedupe.
const DEFAULT_QUERIES = [
  // Roofing-primary
  'roof', 'roofing', 'roofer', 'roofs', 'shingle', 're-roof', 'reroof',
  // Storm / restoration / insurance-adjacent
  'storm', 'restoration', 'restore', 'claim',
  // Exterior trades frequently packaged with roofing
  'exterior', 'siding', 'gutter', 'window', 'soffit', 'fascia',
  // General construction -- often carries roofing as a sub-trade
  'construction', 'contracting', 'contractor', 'builder', 'building',
  'home improvement', 'remodeling', 'renovation',
  // Common DBA words in roofing
  'peak', 'ridge', 'summit', 'eagle', 'pro', 'premier', 'quality',
  'alabama', 'southern', 'american', 'huntsville', 'valley', 'tennessee',
];

const QUERIES = queriesArg
  ? queriesArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_QUERIES;

function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}

function fetchText(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { timeout: 30000, rejectUnauthorized: false, ...opts },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => reject(new Error(`timeout ${url}`)));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Pull the three ASP.NET hidden fields from the initial GET.
function extractViewState(html) {
  const get = (name) => {
    const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`);
    const m = html.match(re);
    return m ? m[1] : '';
  };
  return {
    __VIEWSTATE: get('__VIEWSTATE'),
    __VIEWSTATEGENERATOR: get('__VIEWSTATEGENERATOR'),
    __VIEWSTATEENCRYPTED: get('__VIEWSTATEENCRYPTED'),
    __EVENTVALIDATION: get('__EVENTVALIDATION'),
  };
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(s) {
  return decodeHtml(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

// Parse one ASP.NET search result table. Each data row has 7 cells:
//   license#, business_name, owner_name, entity_type, year, address, city_state_zip
function parseRows(html) {
  const rows = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = cellRe.exec(m[1]))) cells.push(stripTags(c[1]));
    if (cells.length >= 7 && /^\d+$/.test(cells[0])) {
      rows.push({
        license_number: parseInt(cells[0], 10),
        business_name: cells[1],
        owner_name: cells[2],
        entity_type: cells[3],
        year: parseInt(cells[4], 10),
        address: cells[5],
        city_state_zip: cells[6],
      });
    }
  }
  return rows;
}

async function searchTerm(term) {
  // Fresh ViewState per query (the server invalidates after one POST).
  const getRes = await fetchText(URL, { method: 'GET' });
  const vs = extractViewState(getRes.body);

  const cookies = (getRes.headers['set-cookie'] || [])
    .map((c) => c.split(';')[0])
    .join('; ');

  const body = new URLSearchParams({
    __VIEWSTATE: vs.__VIEWSTATE,
    __VIEWSTATEGENERATOR: vs.__VIEWSTATEGENERATOR,
    __VIEWSTATEENCRYPTED: vs.__VIEWSTATEENCRYPTED,
    __EVENTVALIDATION: vs.__EVENTVALIDATION,
    TextBox1: term,
    BtnSearch: 'Search',
  }).toString();

  const postRes = await fetchText(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      Cookie: cookies,
      'User-Agent': 'Eavesight/1.0 (licensed scraper)',
    },
    body,
  });

  return parseRows(postRes.body);
}

async function main() {
  const pool = new Pool(DB);
  try {
    if (!DRY) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contractor_licenses (
          id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          source          TEXT NOT NULL,
          license_number  INTEGER NOT NULL,
          business_name   TEXT,
          owner_name      TEXT,
          entity_type     TEXT,
          address         TEXT,
          city_state_zip  TEXT,
          license_years   INTEGER[] DEFAULT ARRAY[]::INTEGER[],
          is_roofing_kw   BOOLEAN DEFAULT FALSE,
          raw             JSONB,
          created_at      TIMESTAMPTZ DEFAULT now(),
          updated_at      TIMESTAMPTZ DEFAULT now(),
          UNIQUE (source, license_number)
        );
        CREATE INDEX IF NOT EXISTS idx_contractor_licenses_roofing
          ON contractor_licenses(is_roofing_kw) WHERE is_roofing_kw = TRUE;
        CREATE INDEX IF NOT EXISTS idx_contractor_licenses_name
          ON contractor_licenses USING gin(to_tsvector('english', coalesce(business_name,'')));
      `);
    }

    // Dedupe across queries by license_number -> merged record
    const byLicense = new Map();
    let totalRows = 0;

    for (const term of QUERIES) {
      try {
        const rows = await searchTerm(term);
        totalRows += rows.length;
        log(`  q="${term}" rows=${rows.length}`);
        // Be polite to Huntsville's old WebForms server.
        await new Promise((r) => setTimeout(r, 400));
        for (const r of rows) {
          const existing = byLicense.get(r.license_number);
          if (!existing) {
            byLicense.set(r.license_number, {
              license_number: r.license_number,
              business_name: r.business_name,
              owner_name: r.owner_name,
              entity_type: r.entity_type,
              address: r.address,
              city_state_zip: r.city_state_zip,
              license_years: new Set([r.year]),
            });
          } else {
            existing.license_years.add(r.year);
          }
        }
      } catch (e) {
        log(`  q="${term}" ERROR: ${e.message}`);
      }
    }

    const roofingRe = /roof|shingle|gutter|siding|exterior|storm|restoration/i;

    log(`Distinct licenses: ${byLicense.size} (from ${totalRows} raw rows across ${QUERIES.length} queries)`);

    if (DRY) {
      const sample = Array.from(byLicense.values())
        .filter((r) => roofingRe.test(r.business_name))
        .slice(0, 10);
      for (const r of sample) {
        log(`  [${r.license_number}] ${r.business_name} | years=${[...r.license_years].sort().join(',')} | ${r.address}, ${r.city_state_zip}`);
      }
      return;
    }

    let upserts = 0;
    for (const rec of byLicense.values()) {
      const isRoof = roofingRe.test(rec.business_name);
      const years = [...rec.license_years].sort((a, b) => a - b);
      const q = `
        INSERT INTO contractor_licenses
          (source, license_number, business_name, owner_name, entity_type,
           address, city_state_zip, license_years, is_roofing_kw, raw, updated_at)
        VALUES ('huntsville-lic', $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
        ON CONFLICT (source, license_number) DO UPDATE SET
          business_name  = EXCLUDED.business_name,
          owner_name     = EXCLUDED.owner_name,
          entity_type    = EXCLUDED.entity_type,
          address        = EXCLUDED.address,
          city_state_zip = EXCLUDED.city_state_zip,
          license_years  = (
            SELECT array_agg(DISTINCT y ORDER BY y)
              FROM unnest(contractor_licenses.license_years || EXCLUDED.license_years) AS y
          ),
          is_roofing_kw  = contractor_licenses.is_roofing_kw OR EXCLUDED.is_roofing_kw,
          raw            = EXCLUDED.raw,
          updated_at     = now();
      `;
      const { rowCount } = await pool.query(q, [
        rec.license_number,
        rec.business_name,
        rec.owner_name,
        rec.entity_type,
        rec.address,
        rec.city_state_zip,
        years,
        isRoof,
        JSON.stringify(rec),
      ]);
      upserts += rowCount;
    }

    const { rows: stats } = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE is_roofing_kw) AS roofing,
             COUNT(*) AS total
      FROM contractor_licenses WHERE source='huntsville-lic';
    `);
    log(`DONE: upserts=${upserts} total_licenses=${stats[0].total} roofing_kw=${stats[0].roofing}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
