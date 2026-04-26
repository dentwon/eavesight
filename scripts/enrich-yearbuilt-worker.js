#!/usr/bin/env node
// enrich-yearbuilt-worker.js — single-batch worker for the Madison Tyler scrape.
//
// Usage:
//   node enrich-yearbuilt-worker.js --worker-id=3 --batch-size=100
//
// Semantics:
//   - Claims up to --batch-size rows atomically from the work queue via
//     UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
//     rows get "yearBuiltSource = 'claimed-<id>'" while held so other workers
//     skip them. Done rows are flipped to 'madison-assessor-scrape' as before.
//   - One worker = one IP = one namespace. Supervisor pins the worker to its
//     namespace by invoking us inside `ip netns exec ns-N`. We don't care;
//     we just issue HTTPS and let the kernel route.
//   - Exit codes:
//       0  — batch complete, flush me and spawn another
//       2  — no work left in the queue (supervisor should park)
//       42 — rate-limited by the origin (>=2 consecutive 429s). Supervisor
//            should cool-and-rotate our region before respawning us.
//       1  — hard error (DB down, unhandled exception)
//   - Heartbeat: touches /tmp/yearbuilt-worker-<id>.heartbeat every request.
//   - Per-worker stdout tag "[w<id>]" so the supervisor's interleaved log
//     stays readable.
//
// Differences vs v3 (single-process ancestor):
//   - No internal 30-min cooldowns. On sustained 429 we EXIT, the supervisor
//     handles the cooldown + IP swap.
//   - No 6-20s adaptive pacing sweep; we stay at a fixed, modest cadence
//     because rate-limit pressure now goes horizontal (more IPs) instead of
//     vertical (slower single IP).
//   - Selector is strict: yearBuiltSource IS NULL. Claimed-but-abandoned
//     rows (worker crashed mid-batch) are NOT re-claimed until the supervisor
//     resets them on startup.

const { Pool } = require("pg");
const https = require("https");
const fs = require("fs");

// -------- args --------
const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"];
  }),
);
const WORKER_ID  = ARGS["worker-id"]  || process.env.WORKER_ID  || "0";
const BATCH_SIZE = parseInt(ARGS["batch-size"] || process.env.BATCH_SIZE || "100", 10);
const DELAY_MS   = parseInt(ARGS["delay-ms"]   || process.env.DELAY_MS   || "6000", 10);
const TAG = `[w${WORKER_ID}]`;

function log(...a) { console.log(TAG, ...a); }

// -------- config --------
// When running inside a `ns-N` namespace, 127.0.0.1 is the namespace's own
// loopback, NOT the host's — Postgres is on the host. The supervisor wires
// up a per-worker veth with host-side IP 10.200.<N>.1, DNAT'd to the host's
// real 127.0.0.1:5433. Outside the namespace the same host still resolves
// fine (just via the regular host loopback route).
const DB = {
  host: process.env.DB_HOST || `10.200.${WORKER_ID}.1`,
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: process.env.DB_USER || "eavesight",
  password: process.env.DB_PASS || "eavesight",
  database: process.env.DB_NAME || "eavesight",
};
const BASE = "https://madisonproperty.countygovservices.com/Property/Property/Details";
const HEARTBEAT = `/tmp/yearbuilt-worker-${WORKER_ID}.heartbeat`;
const DB_FLUSH_EVERY = 25;
const MAX_CONSECUTIVE_429 = 2;  // exit & rotate after this many in a row

// -------- identity rotation (per-request, cheap) --------
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];
const LANG_POOL = ["en-US,en;q=0.9", "en-US,en;q=0.5", "en-US,en;q=0.9,es;q=0.5", "en-US;q=0.8,en;q=0.6"];
let CUR_UA   = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
let CUR_LANG = LANG_POOL[Math.floor(Math.random() * LANG_POOL.length)];
function rotateIdent() {
  CUR_UA   = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  CUR_LANG = LANG_POOL[Math.floor(Math.random() * LANG_POOL.length)];
}

// -------- HTTP --------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const go = (u, rLeft) => {
      https.get(u, {
        timeout: 20000,
        headers: {
          "User-Agent":      CUR_UA,
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": CUR_LANG,
        },
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (rLeft <= 0) return reject(new Error("Too many redirects"));
          let r = res.headers.location;
          if (r.startsWith("/")) { const p = new URL(u); r = p.protocol + "//" + p.host + r; }
          res.resume();
          return go(r, rLeft - 1);
        }
        // 429 = explicit rate limit. 403 = silently IP-blocked by the origin's
        // edge (Azure WAF / Tyler WAF) — we get it even on headers we haven't
        // used before, so it's a burned-IP signal, not a crawl-behavior signal.
        // Both surface as distinct errors so the main loop can treat them as
        // "cool this region" (exit 42) and let the supervisor rotate us.
        if (res.statusCode === 429) { res.resume(); return reject(new Error("429")); }
        if (res.statusCode === 403) { res.resume(); return reject(new Error("403")); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => resolve(d));
        res.on("error", reject);
      }).on("error", reject);
    };
    go(url, 5);
  });
}

// -------- HTML parsing (copied verbatim from v3 — unchanged logic) --------
function htmlDecode(s) {
  if (!s) return s;
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#xD;/g, "")
    .replace(/&#xA;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(s) {
  if (!s) return null;
  const n = parseInt(s.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

function parseDate(mdy) {
  if (!mdy) return null;
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function deriveOwnerSince(historyJson) {
  if (!historyJson) return null;
  try {
    const hist = JSON.parse(historyJson);
    if (!hist.length) return null;
    const cur = hist[0].owner;
    const transfer = hist.find(h => h.owner !== cur);
    return transfer ? transfer.year + 1 : hist[hist.length - 1].year;
  } catch { return null; }
}

function parse(html) {
  const r = {
    yearBuilt: null, sqft: null, stories: null, bathrooms: null,
    roofType: null, roofMaterial: null, foundation: null, exteriorWalls: null,
    heatingCooling: null, floorType: null, interiorFinish: null,
    buildingValue: null, totalAdjustedArea: null,
    totalAcres: null, landValue: null, improvementValue: null,
    appraisedValue: null, taxableValue: null,
    exemptCode: null, taxDistrict: null,
    landUseCode: null, landUseDesc: null,
    subdivisionName: null, subdivisionCode: null, lotNumber: null, deedBookPage: null,
    ownerFullName: null, ownerMailAddress: null,
    annualTaxAmount: null, taxPaidStatus: null, lastTaxPaidDate: null, taxPaidBy: null,
    ownerHistory: null,
  };

  const lvRe = /<td[^>]*class="pt-parcel-summary-label"[^>]*>(.*?)<\/td>\s*<td[^>]*class="pt-parcel-summary-value"[^>]*>(.*?)<\/td>/gs;
  let m;
  while ((m = lvRe.exec(html)) !== null) {
    const l = htmlDecode(m[1]), v = htmlDecode(m[2]);
    if (!v) continue;
    switch (l) {
      case "Year Built":          { const y = parseInt(v); if (y >= 1700 && y <= 2030) r.yearBuilt = y; break; }
      case "Total Living Area":   { const s = parseInt(v); if (s > 0 && s < 100000) r.sqft = s; break; }
      case "Stories":             { const s = parseFloat(v); if (s > 0 && s <= 10) r.stories = s; break; }
      case "Roof Type":           r.roofType       = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Roof Material":       r.roofMaterial   = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Foundation":          r.foundation     = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Exterior Walls":      r.exteriorWalls  = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Heat/AC":             r.heatingCooling = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Floors":              r.floorType      = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Interior Finish":     r.interiorFinish = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Building Value":      r.buildingValue  = parseMoney(v); break;
      case "Total Adjusted Area": { const a = parseInt(v); if (a > 0) r.totalAdjustedArea = a; break; }
      case "Total Acres":         { const a = parseFloat(v); if (a > 0) r.totalAcres = a; break; }
      case "Land Value":          r.landValue        = parseMoney(v); break;
      case "Improvement Value":   r.improvementValue = parseMoney(v); break;
      case "Total Appraised Value": r.appraisedValue = parseMoney(v); break;
      case "Total Taxable Value":   r.taxableValue   = parseMoney(v); break;
    }
    if (v.startsWith("BATH")) {
      const bm = v.match(/BATH\s+\w+\s*-\s*(\d+)/);
      if (bm) r.bathrooms = (r.bathrooms || 0) + parseInt(bm[1]);
    }
  }

  const infoRe = /<th[^>]*class="pt-table-left-hdr"[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  while ((m = infoRe.exec(html)) !== null) {
    const l = htmlDecode(m[1]).toUpperCase();
    const v = htmlDecode(m[2].replace(/<[^>]+>/g, " "));
    if (!v) continue;
    switch (l) {
      case "OWNER":           r.ownerFullName    = v.substring(0, 255); break;
      case "MAILING ADDRESS": r.ownerMailAddress = v.substring(0, 255); break;
      case "EXEMPT CODE":     r.exemptCode       = v.substring(0, 20);  break;
      case "TAX DISTRICT":    r.taxDistrict      = v.substring(0, 50);  break;
    }
  }

  const pvRe = /<th[^>]*class="pt-payment-summary-value-label"[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*class="pt-parcel-summary-prop-val"[^>]*>([\s\S]*?)<\/td>/g;
  while ((m = pvRe.exec(html)) !== null) {
    const l = htmlDecode(m[1]);
    const v = htmlDecode(m[2].replace(/<[^>]+>/g, " "));
    if (!v) continue;
    switch (l) {
      case "Total Acres":           { const a = parseFloat(v); if (a > 0) r.totalAcres = a; break; }
      case "Land Value":            r.landValue        = parseMoney(v); break;
      case "Improvement Value":     r.improvementValue = parseMoney(v); break;
      case "Total Appraised Value": r.appraisedValue   = parseMoney(v); break;
      case "Total Taxable Value":   r.taxableValue     = parseMoney(v); break;
    }
  }

  const payDate = html.match(/<div[^>]*class="pt-summary-payment-info"[^>]*>\s*LAST PAYMENT DATE\s*([\d\/]+)\s*<\/div>/i);
  if (payDate) r.lastTaxPaidDate = payDate[1].trim();
  const payBy = html.match(/<div[^>]*>\s*PAID BY\s+([^<]+?)\s*<\/div>/i);
  if (payBy) r.taxPaidBy = htmlDecode(payBy[1]).substring(0, 200);

  const thSec = html.match(/id="collapseTaxHistory"[\s\S]*?<\/tbody>?|id="collapseTaxHistory"[\s\S]*?<\/table>/);
  if (thSec) {
    const rowRe = /<tr>\s*<td>\s*(\d{4})\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>\s*\$\s*([\d,\.]+)\s*<\/td>\s*<td>\s*([YN])[^<]*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/;
    const rowMatch = thSec[0].match(rowRe);
    if (rowMatch) {
      r.annualTaxAmount = parseFloat(rowMatch[3].replace(/,/g, "")) || null;
      r.taxPaidStatus = rowMatch[4] === "Y";
      const paidByRow = htmlDecode(rowMatch[5].replace(/<[^>]+>/g, " "));
      if (paidByRow) r.taxPaidBy = paidByRow.substring(0, 200);
    }
    const hist = [];
    const allRows = thSec[0].matchAll(/<tr>\s*<td>\s*(\d{4})\s*<\/td>\s*<td>([\s\S]*?)<\/td>/g);
    for (const h of allRows) {
      const owner = htmlDecode(h[2].replace(/<[^>]+>/g, " "));
      if (owner) hist.push({ year: parseInt(h[1]), owner });
    }
    if (hist.length) r.ownerHistory = JSON.stringify(hist);
  }

  const luMatch = html.match(/(\d{4})-([A-Z ]+)/);
  if (luMatch) {
    r.landUseCode = luMatch[1];
    r.landUseDesc = luMatch[2].trim().substring(0, 100);
  }

  return r;
}

// -------- DB --------
// Claim coordination lives on a dedicated column (scrapeClaimedBy), NOT on
// yearBuiltSource, so we don't overwrite existing imputed values (like
// 'knn-r1000m-k5' or 'census-acs-b25035-2023'). yearBuiltSource is only
// flipped to 'madison-assessor-scrape' on successful scrape.
const CLAIM_TAG = `w${WORKER_ID}`;

/**
 * Atomically claim up to N rows from the Madison queue. Marks their
 * scrapeClaimedBy column with 'w<id>' so other workers skip them.
 * Only claims rows whose yearBuiltSource is NOT yet ANY terminal assessor
 * tag. Using a LIKE 'madison-assessor-%' match so future skip-tags
 * (-500-skip for server-side SQL bugs, -404-skip for deleted parcels, etc.)
 * are respected without further code changes.
 */
async function claimBatch(pool, n) {
  const { rows } = await pool.query(
    `UPDATE properties
     SET "scrapeClaimedBy" = $1,
         "scrapeClaimedAt" = NOW()
     WHERE id IN (
       SELECT id FROM properties
       WHERE "parcelId" IS NOT NULL
         AND county = 'Madison'
         AND "scrapeClaimedBy" IS NULL
         AND (
           "yearBuiltSource" IS NULL
           OR "yearBuiltSource" NOT LIKE 'madison-assessor-%'
         )
       ORDER BY id
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, "parcelId"`,
    [CLAIM_TAG, n],
  );
  return rows;
}

/**
 * Release rows we still hold. Simply clears scrapeClaimedBy — the underlying
 * yearBuiltSource (imputed value, if any) was never disturbed, so another
 * worker will re-claim naturally on the next cycle.
 */
async function releaseClaims(pool) {
  const { rowCount } = await pool.query(
    `UPDATE properties
     SET "scrapeClaimedBy" = NULL, "scrapeClaimedAt" = NULL
     WHERE "scrapeClaimedBy" = $1`,
    [CLAIM_TAG],
  );
  return rowCount;
}

async function flush(pool, updates) {
  for (const u of updates) {
    try {
      await pool.query(
        `UPDATE properties SET
          "yearBuilt"=COALESCE($2,"yearBuilt"), sqft=COALESCE($3,sqft),
          stories=COALESCE($4,stories), bathrooms=COALESCE($5,bathrooms),
          "roofType"=COALESCE($6,"roofType"), "roofMaterial"=COALESCE($7,"roofMaterial"),
          foundation=COALESCE($8,foundation), "exteriorWalls"=COALESCE($9,"exteriorWalls"),
          "totalAcres"=COALESCE($10,"totalAcres"), "landValue"=COALESCE($11,"landValue"),
          "improvementValue"=COALESCE($12,"improvementValue"), "appraisedValue"=COALESCE($13,"appraisedValue"),
          "taxableValue"=COALESCE($14,"taxableValue"), "buildingValue"=COALESCE($15,"buildingValue"),
          "exemptCode"=COALESCE($16,"exemptCode"), "taxDistrict"=COALESCE($17,"taxDistrict"),
          "landUseCode"=COALESCE($18,"landUseCode"), "landUseDesc"=COALESCE($19,"landUseDesc"),
          "ownerFullName"=COALESCE($20,"ownerFullName"), "ownerMailAddress"=COALESCE($21,"ownerMailAddress"),
          "taxPaidStatus"=$22, "annualTaxAmount"=COALESCE($23,"annualTaxAmount"),
          "taxPaidBy"=COALESCE($24,"taxPaidBy"), "heatingCooling"=COALESCE($25,"heatingCooling"),
          "floorType"=COALESCE($26,"floorType"), "interiorFinish"=COALESCE($27,"interiorFinish"),
          "totalAdjustedArea"=COALESCE($28,"totalAdjustedArea"),
          "lastTaxPaidDate"=COALESCE($29::date,"lastTaxPaidDate"),
          "ownerHistory"=COALESCE($30::jsonb,"ownerHistory"),
          "ownerSinceYear"=COALESCE($31,"ownerSinceYear"),
          "yearBuiltSource"='madison-assessor-scrape',
          "scrapeClaimedBy"=NULL,
          "scrapeClaimedAt"=NULL,
          "updatedAt"=NOW()
        WHERE id=$1`,
        [u.id, u.yearBuilt, u.sqft, u.stories ? Math.round(u.stories) : null, u.bathrooms,
         u.roofType, u.roofMaterial, u.foundation, u.exteriorWalls,
         u.totalAcres, u.landValue, u.improvementValue, u.appraisedValue,
         u.taxableValue, u.buildingValue,
         u.exemptCode, u.taxDistrict, u.landUseCode, u.landUseDesc,
         u.ownerFullName, u.ownerMailAddress,
         u.taxPaidStatus, u.annualTaxAmount, u.taxPaidBy,
         u.heatingCooling, u.floorType, u.interiorFinish, u.totalAdjustedArea,
         u.lastTaxPaidDate ? parseDate(u.lastTaxPaidDate) : null,
         u.ownerHistory || null,
         u.ownerSinceYear || null],
      );
    } catch (e) { log("DB error:", e.message); }
  }
}

/**
 * Mark a row as "touched — no extractable data". Same terminal flag as a
 * successful enrich so we don't revisit it.
 */
async function markNoData(pool, id) {
  try {
    await pool.query(
      `UPDATE properties SET
        "yearBuiltSource" = 'madison-assessor-scrape',
        "scrapeClaimedBy" = NULL,
        "scrapeClaimedAt" = NULL,
        "updatedAt" = NOW()
      WHERE id = $1`,
      [id],
    );
  } catch (e) { log("DB error (noData mark):", e.message); }
}

// -------- main --------
async function main() {
  const t0 = Date.now();
  log(`start  batch=${BATCH_SIZE} delay=${DELAY_MS}ms pid=${process.pid}`);

  const pool = new Pool(DB);

  // graceful cleanup on SIGTERM (supervisor might kill us)
  let shuttingDown = false;
  const cleanup = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`caught ${signal}, releasing claims...`);
    try { await releaseClaims(pool); } catch {}
    try { await pool.end(); } catch {}
    process.exit(130);
  };
  process.on("SIGTERM", () => cleanup("SIGTERM"));
  process.on("SIGINT",  () => cleanup("SIGINT"));

  const rows = await claimBatch(pool, BATCH_SIZE);
  if (rows.length === 0) {
    log("no work");
    await pool.end();
    process.exit(2);
  }
  log(`claimed ${rows.length} rows`);

  let ok = 0, noD = 0, err = 0, consecutive429 = 0;
  const upd = [];
  let rateLimitedExit = false;
  let processed = 0;

  for (const p of rows) {
    if (shuttingDown) break;
    try {
      const html = await fetchHTML(`${BASE}?taxyear=2024&ppin=${p.parcelId}`);
      const data = parse(html);
      processed++;
      consecutive429 = 0;
      try { fs.writeFileSync(HEARTBEAT, String(Date.now())); } catch {}

      if (data.yearBuilt || data.sqft || data.roofType || data.appraisedValue) {
        ok++;
        data.ownerSinceYear = deriveOwnerSince(data.ownerHistory);
        upd.push({ id: p.id, ...data });
      } else {
        noD++;
        await markNoData(pool, p.id);
      }
    } catch (e) {
      processed++;
      if (e.message === "429" || e.message === "403") {
        // 403 = WAF-level IP block, 429 = rate limit — both mean "this region
        // is burned, rotate me." Counter is shared so a mix of the two still
        // hits the exit threshold.
        consecutive429++;
        rotateIdent();
        log(`${e.message} #${consecutive429} on parcel ${p.parcelId}`);
        if (consecutive429 >= MAX_CONSECUTIVE_429) {
          log(`blocked (${consecutive429} consecutive ${e.message}s) — exit 42 for IP rotation`);
          rateLimitedExit = true;
          break;
        }
        // Short cool before next attempt; supervisor will handle the long
        // cooldown if we still exit 42
        await sleep(10000);
      } else {
        err++;
        log(`error on parcel ${p.parcelId}: ${e.message}`);
        // Release this single row so another worker can retry it
        await pool.query(
          `UPDATE properties
           SET "scrapeClaimedBy"=NULL, "scrapeClaimedAt"=NULL
           WHERE id=$1 AND "scrapeClaimedBy"=$2`,
          [p.id, CLAIM_TAG],
        );
      }
    }

    if (upd.length >= DB_FLUSH_EVERY) {
      await flush(pool, upd.splice(0));
    }

    // Emit progress every 5 parcels instead of every 25. At DELAY_MS=6s that
    // means a log line every ~35-45s, comfortably inside the supervisor's
    // watchdog threshold. Also doubles as a liveness ping so the watchdog
    // doesn't SIGKILL healthy long-running batches.
    if (processed % 5 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (processed / elapsed).toFixed(2);
      log(`${processed}/${rows.length}  ok:${ok} noData:${noD} err:${err}  ${rate}/s`);
    }

    if (!rateLimitedExit) await sleep(DELAY_MS);
  }

  if (upd.length) await flush(pool, upd);

  // Release any rows we didn't get to (rate-limited or error exit)
  if (rateLimitedExit || shuttingDown) {
    const released = await releaseClaims(pool);
    if (released) log(`released ${released} un-scraped rows back to queue`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`done in ${elapsed}s  processed=${processed} ok=${ok} noData=${noD} err=${err}`);
  await pool.end();

  if (rateLimitedExit) process.exit(42);
  process.exit(0);
}

main().catch(async (e) => {
  console.error(`${TAG} FATAL:`, e);
  process.exit(1);
});
