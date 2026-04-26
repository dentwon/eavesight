/**
 * Shared helpers for North Alabama permit scrapers (2026-04-25).
 * All scrapers ingest into building_permits with idempotent upsert on
 * (source, permit_number) and flag roof permits via ROOF_RE.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB = {
  host: 'localhost',
  port: 5433,
  user: 'eavesight',
  password: 'eavesight',
  database: 'eavesight',
};

// Permit-type / description regex used across all five city scrapers.
// Match: "REROOF", "RE-ROOF", "ROOF", "ROOFING", "ROOF REPLACEMENT", "SHINGLE",
// "REROOFING", "ROOF REPAIR", "TEAR OFF". Case-insensitive.
const ROOF_RE = /\b(re-?roof(ing)?|roof(\s*(replacement|repair|install))?|roofing|shingle(s)?|tear[\s-]*off)\b/i;
const EXTERIOR_RE = /\b(siding|gutter|window|fence|deck|stucco|exterior)\b/i;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) Eavesight-Permits/1.0 (admin@eavesight.io)';
const REQUEST_TIMEOUT = 30_000;

function fetchText(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        timeout: REQUEST_TIMEOUT,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(opts.headers || {}),
        },
      },
      (res) => {
        if (opts.haltOnRateLimit && (res.statusCode === 403 || res.statusCode === 429)) {
          return reject(new Error(`HTTP ${res.statusCode} (rate-limited / blocked) ${url}`));
        }
        // follow one redirect manually
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && !opts.noFollow) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return fetchText(next, { ...opts, noFollow: true }).then(resolve, reject);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`timeout ${url}`));
    });
  });
}

function fetchJson(url, opts = {}) {
  return fetchText(url, opts).then((r) => {
    try {
      return { ...r, json: JSON.parse(r.body) };
    } catch (e) {
      throw new Error(`JSON parse failed for ${url}: ${e.message}; head=${r.body.slice(0, 200)}`);
    }
  });
}

function parseArgs(argv) {
  const args = { dryRun: true, since: null, until: null, limit: 50, log: null };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-dry-run' || a === '--commit') args.dryRun = false;
    else if (a.startsWith('--since=')) args.since = new Date(a.slice(8));
    else if (a.startsWith('--until=')) args.until = new Date(a.slice(8));
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice(8));
    else if (a.startsWith('--log=')) args.log = a.slice(6);
  }
  if (!args.since) args.since = new Date(Date.now() - 25 * 365 * 24 * 60 * 60 * 1000);
  if (!args.until) args.until = new Date();
  return args;
}

function makeLogger(file) {
  let stream = null;
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    stream = fs.createWriteStream(file, { flags: 'a' });
  }
  return (...a) => {
    const line = `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
    console.log(line);
    if (stream) stream.write(line + '\n');
  };
}

function classify(text) {
  const t = String(text || '');
  return {
    is_roofing: ROOF_RE.test(t),
    is_exterior: EXTERIOR_RE.test(t),
  };
}

async function upsertPermit(pool, p, dryRun) {
  const { is_roofing, is_exterior } = classify(`${p.permit_type || ''} ${p.description || ''}`);
  if (dryRun) {
    return { inserted: 0, dryRun: true, is_roofing, sample: p };
  }
  const q = `
    INSERT INTO building_permits
      (id, source, permit_number, permit_type, description, status, issued_at, finaled_at,
       address, city, zip, parcel_id, contractor, contractor_type, valuation,
       lat, lon, is_roofing, is_exterior, property_id, raw, updated_at)
    VALUES
      (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, NULL, $13, $14, $15, $16, $17, NULL, $18::jsonb, now())
    ON CONFLICT (source, permit_number)
    DO UPDATE SET
      description = EXCLUDED.description,
      status      = EXCLUDED.status,
      finaled_at  = EXCLUDED.finaled_at,
      valuation   = EXCLUDED.valuation,
      raw         = EXCLUDED.raw,
      updated_at  = now()
    RETURNING (xmax = 0) AS inserted;
  `;
  const { rows } = await pool.query(q, [
    p.source,
    p.permit_number,
    p.permit_type || null,
    p.description || null,
    p.status || null,
    p.issued_at || null,
    p.finaled_at || null,
    p.address || null,
    p.city || null,
    p.zip || null,
    p.parcel_id || null,
    p.contractor || null,
    p.valuation || null,
    p.lat || null,
    p.lon || null,
    is_roofing,
    is_exterior,
    JSON.stringify(p.raw || {}),
  ]);
  return { inserted: rows[0]?.inserted ? 1 : 0, is_roofing };
}

function makePool() {
  return new Pool(DB);
}

module.exports = {
  DB,
  ROOF_RE,
  EXTERIOR_RE,
  UA,
  fetchText,
  fetchJson,
  parseArgs,
  makeLogger,
  classify,
  upsertPermit,
  makePool,
};
