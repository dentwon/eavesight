#!/usr/bin/env node
const { Pool } = require("pg");
const https = require("https");

const DB = { host:"localhost", port:5433, user:"eavesight", password:"eavesight", database:"eavesight" };
const BASE = "https://madisonproperty.countygovservices.com/Property/Property/Details";
// ADAPTIVE PACING STATE
// Start at 10s (projected 360/hr). On 429, back off +2s (up to 20s).
// After 50 consecutive successes at current delay, probe down -1s (min 6s).
let currentDelay = 10000;
const MIN_DELAY = 6000;
const MAX_DELAY = 20000;
const BACKOFF_STEP = 2000;
const PROBE_STEP = 1000;
const PROBE_AFTER_SUCCESSES = 50;
let successStreak = 0;
const DB_FLUSH = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
const LANG_POOL = [
  "en-US,en;q=0.9",
  "en-US,en;q=0.5",
  "en-US,en;q=0.9,es;q=0.5",
  "en-US;q=0.8,en;q=0.6",
];
let CUR_UA = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
let CUR_LANG = LANG_POOL[Math.floor(Math.random() * LANG_POOL.length)];
function rotateIdent() {
  CUR_UA = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  CUR_LANG = LANG_POOL[Math.floor(Math.random() * LANG_POOL.length)];
}



function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const go = (u, rLeft) => {
      https.get(u, {
        timeout: 20000,
        headers: {
          "User-Agent": CUR_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": CUR_LANG,
        }
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (rLeft <= 0) return reject(new Error("Too many redirects"));
          let r = res.headers.location;
          if (r.startsWith("/")) { const p = new URL(u); r = p.protocol + "//" + p.host + r; }
          res.resume();
          return go(r, rLeft - 1);
        }
        if (res.statusCode === 429) { res.resume(); return reject(new Error("429")); }
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

  // Building component label-value pairs
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

  // Parcel info (th.pt-table-left-hdr + td)
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

  // Property Values block (th.pt-payment-summary-value-label + td.pt-parcel-summary-prop-val)
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

  // Payment info blocks (div.pt-summary-payment-info)
  const payDate = html.match(/<div[^>]*class="pt-summary-payment-info"[^>]*>\s*LAST PAYMENT DATE\s*([\d\/]+)\s*<\/div>/i);
  if (payDate) r.lastTaxPaidDate = payDate[1].trim();
  const payBy = html.match(/<div[^>]*>\s*PAID BY\s+([^<]+?)\s*<\/div>/i);
  if (payBy) r.taxPaidBy = htmlDecode(payBy[1]).substring(0, 200);

  // Tax History: most recent row (first <tr> under collapseTaxHistory after <thead>)
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
    // Collect owner history from ALL rows
    const hist = [];
    const allRows = thSec[0].matchAll(/<tr>\s*<td>\s*(\d{4})\s*<\/td>\s*<td>([\s\S]*?)<\/td>/g);
    for (const h of allRows) {
      const owner = htmlDecode(h[2].replace(/<[^>]+>/g, " "));
      if (owner) hist.push({ year: parseInt(h[1]), owner });
    }
    if (hist.length) r.ownerHistory = JSON.stringify(hist);
  }

  // Land use code
  const luMatch = html.match(/(\d{4})-([A-Z ]+)/);
  if (luMatch) {
    r.landUseCode = luMatch[1];
    r.landUseDesc = luMatch[2].trim().substring(0, 100);
  }

  return r;
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
         u.ownerSinceYear || null]
      );
    } catch (e) { console.error("  DB error:", e.message); }
  }
}

function parseDate(mdy) {
  if (!mdy) return null;
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
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

async function main() {
  const t0 = Date.now();
  console.log("=== Comprehensive Property Enrichment v3 ===");
  console.log("1 request every 6s | No keepAlive | Full data extraction");
  console.log("Started:", new Date().toISOString(), "\n");

  const pool = new Pool(DB);
  const { rows: props } = await pool.query(
    `SELECT id, "parcelId" FROM properties
     WHERE "parcelId" IS NOT NULL AND county = 'Madison' AND ("yearBuiltSource" IS NULL OR "yearBuiltSource" != 'madison-assessor-scrape')
     ORDER BY id`
  );
  console.log("Found", props.length, "properties to scrape\n");
  if (!props.length) { await pool.end(); return; }

  let proc = 0, ok = 0, noD = 0, err = 0, consecutive429 = 0;
  const upd = [];

  for (const p of props) {
    try {
      const html = await fetchHTML(BASE + "?taxyear=2024&ppin=" + p.parcelId);
      const data = parse(html);
      proc++;
      consecutive429 = 0;
      successStreak++;
      if (successStreak >= PROBE_AFTER_SUCCESSES && currentDelay > MIN_DELAY) {
        const prev = currentDelay;
        currentDelay = Math.max(MIN_DELAY, currentDelay - PROBE_STEP);
        successStreak = 0;
        console.log("  [pace] probe-down " + (prev/1000) + "s -> " + (currentDelay/1000) + "s after " + PROBE_AFTER_SUCCESSES + " ok");
      }
      require("fs").writeFileSync("/tmp/yearbuilt-v3.heartbeat", String(Date.now()));
      if (data.yearBuilt || data.sqft || data.roofType || data.appraisedValue) {
        ok++;
        data.ownerSinceYear = deriveOwnerSince(data.ownerHistory);
        upd.push({ id: p.id, ...data });
      } else {
        noD++;
      }
    } catch (e) {
      proc++;
      if (e.message === "429") {
        consecutive429++;
        successStreak = 0;
        if (currentDelay < MAX_DELAY) {
          const prev = currentDelay;
          currentDelay = Math.min(MAX_DELAY, currentDelay + BACKOFF_STEP);
          console.log("  [pace] back-off " + (prev/1000) + "s -> " + (currentDelay/1000) + "s on 429");
        }
        rotateIdent();
        let wait;
        if (consecutive429 >= 5) {
          // Cloudflare has us flagged. 30-min rest + reset counter so we start fresh.
          wait = 30 * 60 * 1000;
          console.log("  [429] #" + consecutive429 + " - LONG REST " + (wait / 60000) + " min + UA rotation...");
        } else {
          wait = Math.min(consecutive429 * 60000, 300000);
          console.log("  [429] #" + consecutive429 + " - cooling " + (wait / 1000) + "s (UA rotated)...");
        }
        for (let __i = 0; __i < wait; __i += 10000) {
          await sleep(Math.min(10000, wait - __i));
          try { require("fs").writeFileSync("/tmp/yearbuilt-v3.heartbeat", String(Date.now())); } catch {}
        }
        if (consecutive429 >= 5) {
          console.log("  [429] reset counter after long rest");
          consecutive429 = 0;
        }
      }
      err++;
    }

    if (upd.length >= DB_FLUSH) {
      await flush(pool, upd.splice(0));
    }

    if (proc % 50 === 0 || proc === props.length) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (proc / elapsed).toFixed(2);
      const eta = ((props.length - proc) / parseFloat(rate) / 3600).toFixed(1);
      console.log("  " + proc + "/" + props.length + " | ok:" + ok + " noData:" + noD + " err:" + err + " | " + rate + "/s ETA:" + eta + "h");
    }

    await sleep(currentDelay);
  }

  if (upd.length) await flush(pool, upd);

  const { rows: [s] } = await pool.query(
    `SELECT count(*) t, count("yearBuilt") yr, count("roofType") rt,
     count("roofMaterial") rm, count("appraisedValue") av
     FROM properties WHERE county = 'Madison'`
  );
  console.log("\n=== Done in " + ((Date.now() - t0) / 1000 / 3600).toFixed(1) + "h ===");
  console.log("Processed:" + proc + " Enriched:" + ok + " Errors:" + err);
  console.log("YearBuilt: " + s.yr + "/" + s.t + " | RoofType: " + s.rt + "/" + s.t + " | Appraised: " + s.av + "/" + s.t);
  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
