#!/usr/bin/env node
// probe-assuranceweb.js — dry-run of v3 parser against 20 random Madison
// parcels. NO database writes. Just prints what we'd extract, so we can
// eyeball quality before committing to the full 10-day run.

const fs = require("fs");
const { Pool } = require("pg");

const BASE = "https://madisonproperty.countygovservices.com/Property/Property/Details";
const UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY = 6000;

// Reuse v3's parser verbatim
const v3Src = fs.readFileSync("/home/dentwon/Eavesight/scripts/enrich-yearbuilt-v3.js", "utf8");
const parseMoneyFn = v3Src.match(/function parseMoney[\s\S]*?^}/m)[0];
const parseFn     = v3Src.match(/function parse\(html\) \{[\s\S]*?^}\n/m)[0];
eval(parseMoneyFn);
eval(parseFn);

async function fetchHTML(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const pool = new Pool({ connectionString: "postgresql://eavesight:eavesight@localhost:5433/eavesight" });

  // Pull 20 rows: prefer likely-residential parcels (has sqft between 1000-4000)
  const { rows } = await pool.query(`
    SELECT "parcelId", address, sqft
    FROM properties
    WHERE county = 'Madison'
      AND "parcelId" IS NOT NULL
      AND ("yearBuiltSource" IS NULL OR "yearBuiltSource" != 'madison-assessor-scrape')
      AND (sqft IS NULL OR sqft BETWEEN 800 AND 6000)
    ORDER BY random()
    LIMIT 20
  `);
  await pool.end();

  console.log(`\n=== Probing ${rows.length} Madison parcels ===\n`);
  const results = [];
  let fill = {};

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    process.stdout.write(`[${i+1}/${rows.length}] ppin=${p.parcelId} (${p.address})... `);
    try {
      const html = await fetchHTML(`${BASE}?taxyear=2024&ppin=${p.parcelId}`);
      const data = parse(html);
      // Count field fills
      for (const k of Object.keys(data)) if (data[k] !== null && data[k] !== undefined && data[k] !== "") fill[k] = (fill[k] || 0) + 1;
      results.push({ ppin: p.parcelId, address: p.address, ...data });
      console.log(`ok (yr=${data.yearBuilt||"-"}, roof=${data.roofType||"-"}/${data.roofMaterial||"-"})`);
    } catch (e) {
      console.log(`ERR ${e.message}`);
    }
    if (i < rows.length - 1) await sleep(DELAY);
  }

  console.log(`\n=== Field-fill summary across ${results.length} parcels ===`);
  const keys = ["yearBuilt","sqft","stories","bathrooms","roofType","roofMaterial","foundation","exteriorWalls","heatingCooling","floorType","interiorFinish","buildingValue","totalAdjustedArea","landUseCode","landUseDesc","totalAcres","landValue","improvementValue","appraisedValue","taxableValue","exemptCode","taxDistrict","ownerFullName","ownerMailAddress","annualTaxAmount","taxPaidStatus","taxPaidBy"];
  for (const k of keys) {
    const n = fill[k] || 0;
    const pct = results.length ? ((n/results.length)*100).toFixed(0) : 0;
    console.log(`  ${k.padEnd(22)} ${String(n).padStart(3)}/${results.length} (${pct}%)`);
  }

  console.log(`\n=== 3 sample records (JSON) ===`);
  for (const r of results.slice(0, 3)) console.log(JSON.stringify(r, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
