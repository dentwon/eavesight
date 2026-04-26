#!/usr/bin/env node
// enrich-marshall.js — Marshall County (AL) Tyler/AssuranceWeb scrape.
//
// Marshall uses the same Tyler Technologies AssuranceWeb Property platform as
// Madison (countygovservices.com). The detail-page URL pattern and HTML
// structure are byte-for-byte identical, so the parser is a direct port of
// scripts/enrich-yearbuilt-worker.js.
//
// Portal:  https://marshall.countygovservices.com/Property/Property/Details
//          ?taxyear=2025&ppin=<parcelId>
//
// Usage:
//   node enrich-marshall.js                    # dry-run (default), 20 sample parcels
//   node enrich-marshall.js --live --limit=50  # actually UPDATE the DB
//
// Constraints (per-task brief):
//   - 1 request per 3-6s (DELAY_MS=4000 default)
//   - halt on first 403/429
//   - DB: postgresql://eavesight:eavesight@localhost:5433/eavesight
//   - log: /home/dentwon/Eavesight/logs/enrich-marshall.log

const { Pool } = require("pg");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"];
  }),
);
const LIVE      = ARGS.live === "true";
const DRY_RUN   = !LIVE;
const LIMIT     = parseInt(ARGS.limit || "20", 10);
const DELAY_MS  = parseInt(ARGS["delay-ms"] || "4000", 10);
const TAX_YEAR  = parseInt(ARGS["tax-year"] || "2025", 10);
const COUNTY    = "Marshall";
const HOST      = "marshall.countygovservices.com";
const LOG_PATH  = "/home/dentwon/Eavesight/logs/enrich-marshall.log";

const DB = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  user: process.env.DB_USER || "eavesight",
  password: process.env.DB_PASS || "eavesight",
  database: process.env.DB_NAME || "eavesight",
};

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
function log(...a) {
  const line = `[${new Date().toISOString()}] [marshall] ${a.join(" ")}`;
  console.log(line);
  logStream.write(line + "\n");
}

// ---------- HTTP ----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const go = (u, rLeft) => {
      https.get(u, {
        timeout: 20000,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (rLeft <= 0) return reject(new Error("Too many redirects"));
          let r = res.headers.location;
          if (r.startsWith("/")) { const p = new URL(u); r = p.protocol + "//" + p.host + r; }
          res.resume();
          return go(r, rLeft - 1);
        }
        if (res.statusCode === 429) { res.resume(); return reject(new Error("429")); }
        if (res.statusCode === 403) { res.resume(); return reject(new Error("403")); }
        if (res.statusCode === 404) { res.resume(); return reject(new Error("404")); }
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

// ---------- HTML parsing (verbatim port from enrich-yearbuilt-worker.js) ----------
function htmlDecode(s) {
  if (!s) return s;
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#xD;/g, "").replace(/&#xA;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}
function parseMoney(s) { if (!s) return null; const n = parseInt(s.replace(/[$,\s]/g, "")); return isNaN(n) ? null : n; }
function parseDate(mdy) { if (!mdy) return null; const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return null; return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
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
      case "Year Built": { const y = parseInt(v); if (y >= 1700 && y <= 2030) r.yearBuilt = y; break; }
      case "Total Living Area": { const s = parseInt(v); if (s > 0 && s < 100000) r.sqft = s; break; }
      case "Stories": { const s = parseFloat(v); if (s > 0 && s <= 10) r.stories = s; break; }
      case "Roof Type": r.roofType = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Roof Material": r.roofMaterial = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Foundation": r.foundation = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Exterior Walls": r.exteriorWalls = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Heat/AC": r.heatingCooling = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Floors": r.floorType = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Interior Finish": r.interiorFinish = v.split(" - ")[0].trim().substring(0, 100); break;
      case "Building Value": r.buildingValue = parseMoney(v); break;
      case "Total Adjusted Area": { const a = parseInt(v); if (a > 0) r.totalAdjustedArea = a; break; }
      case "Total Acres": { const a = parseFloat(v); if (a > 0) r.totalAcres = a; break; }
      case "Land Value": r.landValue = parseMoney(v); break;
      case "Improvement Value": r.improvementValue = parseMoney(v); break;
      case "Total Appraised Value": r.appraisedValue = parseMoney(v); break;
      case "Total Taxable Value": r.taxableValue = parseMoney(v); break;
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
      case "OWNER": r.ownerFullName = v.substring(0, 255); break;
      case "MAILING ADDRESS": r.ownerMailAddress = v.substring(0, 255); break;
      case "EXEMPT CODE": r.exemptCode = v.substring(0, 20); break;
      case "TAX DISTRICT": r.taxDistrict = v.substring(0, 50); break;
    }
  }

  const pvRe = /<th[^>]*class="pt-payment-summary-value-label"[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*class="pt-parcel-summary-prop-val"[^>]*>([\s\S]*?)<\/td>/g;
  while ((m = pvRe.exec(html)) !== null) {
    const l = htmlDecode(m[1]);
    const v = htmlDecode(m[2].replace(/<[^>]+>/g, " "));
    if (!v) continue;
    switch (l) {
      case "Total Acres": { const a = parseFloat(v); if (a > 0) r.totalAcres = a; break; }
      case "Land Value": r.landValue = parseMoney(v); break;
      case "Improvement Value": r.improvementValue = parseMoney(v); break;
      case "Total Appraised Value": r.appraisedValue = parseMoney(v); break;
      case "Total Taxable Value": r.taxableValue = parseMoney(v); break;
    }
  }

  const thSec = html.match(/id="collapseTaxHistory"[\s\S]*?<\/tbody>?|id="collapseTaxHistory"[\s\S]*?<\/table>/);
  if (thSec) {
    const rowRe = /<tr>\s*<td>\s*(\d{4})\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>\s*\$\s*([\d,\.]+)\s*<\/td>\s*<td>\s*([YN])[^<]*<\/td>\s*<td>([\s\S]*?)<\/td>/;
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

// ---------- DB ----------
async function selectSampleParcels(pool, limit) {
  const { rows } = await pool.query(
    `SELECT id, "parcelId" FROM properties
     WHERE county = $1
       AND "parcelId" IS NOT NULL
       AND ("yearBuiltSource" IS NULL OR "yearBuiltSource" NOT LIKE 'marshall-assessor-%')
     ORDER BY random()
     LIMIT $2`,
    [COUNTY, limit],
  );
  return rows;
}

async function applyUpdate(pool, id, u) {
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
      "yearBuiltSource"='marshall-assessor-scrape',
      "updatedAt"=NOW()
    WHERE id=$1`,
    [id, u.yearBuilt, u.sqft, u.stories ? Math.round(u.stories) : null, u.bathrooms,
     u.roofType, u.roofMaterial, u.foundation, u.exteriorWalls,
     u.totalAcres, u.landValue, u.improvementValue, u.appraisedValue,
     u.taxableValue, u.buildingValue, u.exemptCode, u.taxDistrict,
     u.landUseCode, u.landUseDesc, u.ownerFullName, u.ownerMailAddress,
     u.taxPaidStatus, u.annualTaxAmount, u.taxPaidBy,
     u.heatingCooling, u.floorType, u.interiorFinish, u.totalAdjustedArea,
     u.lastTaxPaidDate ? parseDate(u.lastTaxPaidDate) : null,
     u.ownerHistory || null,
     deriveOwnerSince(u.ownerHistory) || null],
  );
}

function dryPrint(id, parcelId, u) {
  const parts = [];
  for (const k of ["yearBuilt", "sqft", "roofType", "roofMaterial", "appraisedValue", "ownerFullName"]) {
    if (u[k] != null) parts.push(`${k}=${JSON.stringify(u[k])}`);
  }
  log(`DRY UPDATE id=${id} parcel=${parcelId} ${parts.join(" ") || "(no fields parsed)"}`);
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  log(`start  live=${LIVE}  dryRun=${DRY_RUN}  limit=${LIMIT}  delay=${DELAY_MS}ms  taxYear=${TAX_YEAR}`);
  const pool = new Pool(DB);

  const rows = await selectSampleParcels(pool, LIMIT);
  log(`claimed ${rows.length} sample parcels`);
  if (rows.length === 0) { await pool.end(); return; }

  let ok = 0, noData = 0, err = 0, blocked = false;
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const url = `https://${HOST}/Property/Property/Details?taxyear=${TAX_YEAR}&ppin=${encodeURIComponent(p.parcelId)}`;
    try {
      const html = await fetchHTML(url);
      const data = parse(html);
      if (data.yearBuilt || data.sqft || data.appraisedValue || data.ownerFullName) {
        ok++;
        if (DRY_RUN) dryPrint(p.id, p.parcelId, data);
        else await applyUpdate(pool, p.id, data);
      } else {
        noData++;
        log(`no-data id=${p.id} parcel=${p.parcelId}`);
      }
    } catch (e) {
      err++;
      log(`error id=${p.id} parcel=${p.parcelId}: ${e.message}`);
      if (e.message === "403" || e.message === "429") {
        log("RATE-LIMITED — halting per task brief");
        blocked = true;
        break;
      }
    }
    if (i < rows.length - 1) await sleep(DELAY_MS);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`done in ${elapsed}s  ok=${ok} noData=${noData} err=${err} blocked=${blocked}`);
  await pool.end();
}

main().catch(e => { log("FATAL:", e.stack || e.message); process.exit(1); });
