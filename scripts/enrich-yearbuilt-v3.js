#!/usr/bin/env node
const { Pool } = require("pg");
const https = require("https");

const DB = { host:"localhost", port:5433, user:"stormvault", password:"stormvault", database:"stormvault" };
const BASE = "https://madisonproperty.countygovservices.com/Property/Property/Details";
const DELAY = 6000;
const DB_FLUSH = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const go = (u, rLeft) => {
      https.get(u, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.5",
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
    const l = m[1].trim(), v = m[2].trim();
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

  // Parcel info
  const infoRe = /<td[^>]*class="pt-parcel-info-label"[^>]*>(.*?)<\/td>\s*<td[^>]*class="pt-parcel-info-value"[^>]*>([\s\S]*?)<\/td>/gs;
  while ((m = infoRe.exec(html)) !== null) {
    const l = m[1].trim(), v = m[2].replace(/<[^>]+>/g, "").trim();
    if (!v) continue;
    switch (l) {
      case "OWNER": r.ownerFullName = v.substring(0, 255); break;
      case "MAILING ADDRESS": r.ownerMailAddress = v.substring(0, 255); break;
      case "EXEMPT CODE": r.exemptCode = v.substring(0, 20); break;
      case "TAX DISTRICT": r.taxDistrict = v.substring(0, 50); break;
    }
  }

  // Land use code
  const luMatch = html.match(/(\d{4})-([A-Z ]+)/);
  if (luMatch) {
    r.landUseCode = luMatch[1];
    r.landUseDesc = luMatch[2].trim().substring(0, 100);
  }

  // Tax info
  const taxRe = /\$\s*([\d,]+\.\d{2})\s*\$\s*[\d,]+\.\d{2}\s*\$\s*[\d,]+\.\d{2}\s*\$\s*([\d,]+\.\d{2})\s*\$\s*([\d,]+\.\d{2})/;
  const taxMatch = html.match(taxRe);
  if (taxMatch) {
    r.annualTaxAmount = parseFloat(taxMatch[1].replace(/,/g, ""));
    const paid = parseFloat(taxMatch[2].replace(/,/g, ""));
    const balance = parseFloat(taxMatch[3].replace(/,/g, ""));
    r.taxPaidStatus = balance === 0 && paid > 0;
  }

  // Payment info
  const payRe = /LAST PAYMENT DATE\s+([\d\/]+)\s*(?:<[^>]*>)*\s*PAID BY\s+([^<\n]+)/i;
  const payMatch = html.match(payRe);
  if (payMatch) {
    r.lastTaxPaidDate = payMatch[1].trim();
    r.taxPaidBy = payMatch[2].trim().substring(0, 200);
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
          "updatedAt"=NOW()
        WHERE id=$1`,
        [u.id, u.yearBuilt, u.sqft, u.stories ? Math.round(u.stories) : null, u.bathrooms,
         u.roofType, u.roofMaterial, u.foundation, u.exteriorWalls,
         u.totalAcres, u.landValue, u.improvementValue, u.appraisedValue,
         u.taxableValue, u.buildingValue,
         u.exemptCode, u.taxDistrict, u.landUseCode, u.landUseDesc,
         u.ownerFullName, u.ownerMailAddress,
         u.taxPaidStatus, u.annualTaxAmount, u.taxPaidBy,
         u.heatingCooling, u.floorType, u.interiorFinish, u.totalAdjustedArea]
      );
    } catch (e) { console.error("  DB error:", e.message); }
  }
}

async function main() {
  const t0 = Date.now();
  console.log("=== Comprehensive Property Enrichment v3 ===");
  console.log("1 request every 6s | No keepAlive | Full data extraction");
  console.log("Started:", new Date().toISOString(), "\n");

  const pool = new Pool(DB);
  const { rows: props } = await pool.query(
    `SELECT id, "parcelId" FROM properties
     WHERE "parcelId" IS NOT NULL AND "yearBuilt" IS NULL AND county = 'Madison'
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
      if (data.yearBuilt || data.sqft || data.roofType || data.appraisedValue) {
        ok++;
        upd.push({ id: p.id, ...data });
      } else {
        noD++;
      }
    } catch (e) {
      proc++;
      if (e.message === "429") {
        consecutive429++;
        const wait = Math.min(consecutive429 * 60000, 300000);
        console.log("  [429] #" + consecutive429 + " - cooling " + (wait / 1000) + "s...");
        await sleep(wait);
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

    await sleep(DELAY);
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
