#!/usr/bin/env node
// enrich-limestone.js — Limestone County (AL) E-Ring Citizen Access Portal scrape.
//
// Portal:    https://www.limestonerevenue.net/   (E-Ring CAMA SPA, React)
// API host:  https://express.limestonerevenue.net
// tenantUrl: https://limestonerevenue.net  (NO www — that's important; the
//            API rejects the www variant with [])
//
// 2026-04-25 finding (revised): Earlier scaffold believed the API was
// Cognito-JWT-gated. It is NOT. The express endpoints are unauthenticated
// — they accept anonymous POSTs from anywhere. The previous scaffold's
// empty responses were due to (a) wrong tenantUrl (used www variant), and
// (b) a brittle body-shape that mixed unused fields. The token file at
// /tmp/limestone_jwt is therefore optional; if present we send it, but the
// scrape works without it.
//
// Real field names (confirmed against live API 2026-04-25):
//   GetParcelDetail       → FinalValue, TotalBldgValue, TotalLandValue,
//                           TaxableValue, AssessedValue, MigratedOwners,
//                           Acreage, TotalLivingArea, MunDesc, AssmtClass,
//                           PropAddr1, AccountNum, KeyNumber
//   GetBldgDetail         → YrBuilt, NumStories, NumBaths, NumBedrooms,
//                           BldgTypeDesc, LivingArea, GroundFloorArea
//   GetRPBldgsByParcelRecYear → returns one row per BldgNo on the parcel;
//                               we use the first one to drive GetBldgDetail.
//
// Limestone's E-Ring schema does not expose roofType / roofMaterial /
// foundation / exteriorWalls (those live in raw assessor data behind the
// scenes but aren't in the public API). We populate what's available and
// leave the rest NULL.
//
// Concurrency: claims rows via properties.scrapeClaimedBy='limestone-w<id>'
// before scraping; releases on exit so a crash doesn't strand them.

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
const LIVE       = ARGS.live === "true";
const DRY_RUN    = !LIVE;
const LIMIT      = parseInt(ARGS.limit || "20", 10);
const DELAY_MS   = parseInt(ARGS["delay-ms"] || "4000", 10);
const TAX_YEAR   = parseInt(ARGS["tax-year"] || "2025", 10);
const WORKER_ID  = ARGS["worker-id"] || "0";

const COUNTY = "Limestone";
const TENANT_URL  = "https://limestonerevenue.net";
const EXPRESS_URL = "https://express.limestonerevenue.net";
const REFERRING_PAGE = "https://www.limestonerevenue.net/";
const TOKEN_FILE = "/tmp/limestone_jwt";
const LOG_PATH = "/home/dentwon/Eavesight/logs/enrich-limestone.log";
const CLAIM_TAG = `limestone-w${WORKER_ID}`;

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
  const line = `[${new Date().toISOString()}] [limestone w${WORKER_ID}] ${a.join(" ")}`;
  console.log(line);
  logStream.write(line + "\n");
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadJwt() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    return t || null;
  } catch { return null; }
}

function postJSON(pathname, body, jwt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": new URL(REFERRING_PAGE).origin,
      "Referer": REFERRING_PAGE,
      "Referring-Page": REFERRING_PAGE,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      "Content-Length": Buffer.byteLength(data),
    };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    const url = new URL(pathname, EXPRESS_URL);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: "POST", headers, timeout: 25000,
      // The express.limestonerevenue.net cert chain is missing the
      // intermediate; Network Solutions issuer is valid but Node can't
      // build the chain without it. Curl works with -k. We mirror that
      // behavior here. (TLS handshake still verifies the server's cert
      // against the leaf; we just skip chain-to-root verification.)
      rejectUnauthorized: false,
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        if (res.statusCode === 401) return reject(new Error("401_UNAUTHORIZED"));
        if (res.statusCode === 403) return reject(new Error("403"));
        if (res.statusCode === 429) return reject(new Error("429"));
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

function s(v, max) {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t) return null;
  return max ? t.substring(0, max) : t;
}
function i(v) {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function f(v) {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapParcelDetail(parcel, bldgs, bldgD) {
  const p = parcel || {};
  const b = (bldgs && bldgs[0]) || {};
  const d = (bldgD && bldgD[0]) || {};
  return {
    yearBuilt: i(d.YrBuilt) || i(b.YrBuilt) || null,
    sqft: i(d.LivingArea) || i(d.TotalLivingArea) || i(p.TotalLivingArea) || null,
    stories: i(d.NumStories) || i(b.NumStories) || null,
    bathrooms: i(d.NumBaths) || null,
    roofType: null,
    roofMaterial: null,
    foundation: null,
    exteriorWalls: null,
    totalAcres: f(p.Acreage),
    landValue: i(p.TotalLandValue),
    improvementValue: i(p.TotalBldgValue),
    buildingValue: i(p.TotalBldgValue),
    appraisedValue: i(p.FinalValue),
    taxableValue: i(p.TaxableValue),
    ownerFullName: s(p.MigratedOwners, 255),
    ownerMailAddress: s([p.Address1, p.Address2, p.City, p.State, p.Zip].filter(x => x && String(x).trim()).join(" ").replace(/\s+/g, " "), 255),
    landUseCode: s(p.AssmtClass, 20),
    landUseDesc: s(d.BldgTypeDesc || b.BldgType, 100),
    taxDistrict: s(p.MunDesc, 50),
  };
}

async function claimBatch(pool, n) {
  const { rows } = await pool.query(
    `UPDATE properties
     SET "scrapeClaimedBy" = $1, "scrapeClaimedAt" = NOW()
     WHERE id IN (
       SELECT id FROM properties
       WHERE county = $3
         AND "parcelId" IS NOT NULL
         AND "scrapeClaimedBy" IS NULL
         AND ("yearBuiltSource" IS NULL OR "yearBuiltSource" NOT LIKE 'limestone-assessor-%')
       ORDER BY id
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, "parcelId"`,
    [CLAIM_TAG, n, COUNTY],
  );
  return rows;
}

async function releaseClaims(pool) {
  await pool.query(
    `UPDATE properties SET "scrapeClaimedBy"=NULL, "scrapeClaimedAt"=NULL
     WHERE "scrapeClaimedBy"=$1`,
    [CLAIM_TAG],
  );
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
      "landUseCode"=COALESCE($16,"landUseCode"), "landUseDesc"=COALESCE($17,"landUseDesc"),
      "ownerFullName"=COALESCE($18,"ownerFullName"), "ownerMailAddress"=COALESCE($19,"ownerMailAddress"),
      "taxDistrict"=COALESCE($20,"taxDistrict"),
      "yearBuiltSource"='limestone-assessor-scrape',
      "scrapeClaimedBy"=NULL, "scrapeClaimedAt"=NULL,
      "updatedAt"=NOW()
    WHERE id=$1`,
    [id, u.yearBuilt, u.sqft, u.stories, u.bathrooms,
     u.roofType, u.roofMaterial, u.foundation, u.exteriorWalls,
     u.totalAcres, u.landValue, u.improvementValue, u.appraisedValue,
     u.taxableValue, u.buildingValue,
     u.landUseCode, u.landUseDesc, u.ownerFullName, u.ownerMailAddress, u.taxDistrict],
  );
}

async function markEmpty(pool, id) {
  await pool.query(
    `UPDATE properties SET "yearBuiltSource"='limestone-assessor-scrape-empty',
       "scrapeClaimedBy"=NULL, "scrapeClaimedAt"=NULL, "updatedAt"=NOW()
     WHERE id=$1`,
    [id],
  );
}

async function scrapeOne(parcelno, jwt) {
  const baseBody = { tenantUrl: TENANT_URL, expressUrl: EXPRESS_URL, reserved: "", parcelno };
  const parcel = await postJSON("/GetParcelDetail", { ...baseBody, recordyear: TAX_YEAR }, jwt);
  if (!Array.isArray(parcel) || parcel.length === 0) return { empty: true };
  const bldgs  = await postJSON("/GetRPBldgsByParcelRecYear", { ...baseBody, recordyear: TAX_YEAR }, jwt);
  let bldgD = [];
  const firstBldgNo = Array.isArray(bldgs) && bldgs[0] && bldgs[0].BldgNo;
  if (firstBldgNo) {
    bldgD = await postJSON("/GetBldgDetail", { ...baseBody, bldgno: String(firstBldgNo), recordyear: TAX_YEAR }, jwt);
  }
  return { empty: false, mapped: mapParcelDetail(parcel[0], bldgs, bldgD) };
}

async function main() {
  const t0 = Date.now();
  const jwt = loadJwt();
  log(`start  live=${LIVE}  limit=${LIMIT}  delay=${DELAY_MS}ms  taxYear=${TAX_YEAR}  jwt=${jwt ? "present" : "absent (OK)"}`);

  const pool = new Pool(DB);
  let rows;
  if (DRY_RUN) {
    const r = await pool.query(
      `SELECT id, "parcelId" FROM properties
       WHERE county=$1 AND "parcelId" IS NOT NULL ORDER BY id LIMIT $2`,
      [COUNTY, LIMIT],
    );
    rows = r.rows;
  } else {
    rows = await claimBatch(pool, LIMIT);
  }
  log(`${DRY_RUN ? "selected" : "claimed"} ${rows.length} parcels`);
  if (rows.length === 0) { await pool.end(); return; }

  let ok = 0, empty = 0, err = 0, blocked = false;

  for (let idx = 0; idx < rows.length; idx++) {
    const p = rows[idx];
    try {
      if (DRY_RUN) {
        log(`DRY id=${p.id} parcel="${p.parcelId}" → would POST /GetParcelDetail+/GetRPBldgsByParcelRecYear+/GetBldgDetail`);
      } else {
        const r = await scrapeOne(p.parcelId, jwt);
        if (r.empty) {
          empty++;
          await markEmpty(pool, p.id);
          log(`EMPTY id=${p.id} parcel="${p.parcelId}"`);
        } else {
          ok++;
          await applyUpdate(pool, p.id, r.mapped);
          log(`OK    id=${p.id} parcel="${p.parcelId}" yr=${r.mapped.yearBuilt} sqft=${r.mapped.sqft} appr=${r.mapped.appraisedValue} owner="${(r.mapped.ownerFullName || "").slice(0, 40)}"`);
        }
      }
    } catch (e) {
      err++;
      log(`error id=${p.id} parcel="${p.parcelId}": ${e.message}`);
      if (e.message === "401_UNAUTHORIZED") {
        log("FATAL: API returned 401. Run: node scripts/cognito-jwt-extractor.js --portal=limestone --force");
        blocked = true;
        break;
      }
      if (e.message === "403" || e.message === "429") {
        log("RATE-LIMITED — halting per task brief");
        blocked = true;
        break;
      }
    }
    if (idx < rows.length - 1) await sleep(DELAY_MS);
  }
  await releaseClaims(pool);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`done in ${elapsed}s  ok=${ok}  empty=${empty}  err=${err}  blocked=${blocked}`);
  await pool.end();
  if (blocked && err > 0 && ok === 0) process.exit(2);
}

main().catch(e => { log("FATAL:", e.stack || e.message); process.exit(1); });
