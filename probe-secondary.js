#!/usr/bin/env node
// probe-secondary.js — 20-parcel dry-run against the NEWLY-FIXED v3 parser.
// Focus: non-roof-age secondary fields. Confirm fill-rate, then show samples
// so we can judge inference value.

const fs = require("fs");
const { Pool } = require("pg");

const BASE = "https://madisonproperty.countygovservices.com/Property/Property/Details";
const UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY = 6500;

const v3Src = fs.readFileSync("/home/dentwon/Eavesight/scripts/enrich-yearbuilt-v3.js", "utf8");
eval(v3Src.match(/function htmlDecode[\s\S]*?^}/m)[0]);
eval(v3Src.match(/function parseMoney[\s\S]*?^}/m)[0]);
eval(v3Src.match(/function parse\(html\) \{[\s\S]*?^}\n/m)[0]);

async function fetchHTML(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
  if (res.status === 429) throw new Error("429");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const pool = new Pool({ connectionString: "postgresql://eavesight:eavesight@localhost:5433/eavesight" });
  // Mix of residential parcels across value tiers
  const { rows } = await pool.query(`
    SELECT "parcelId", address, sqft, "yearBuilt"
    FROM properties
    WHERE county = 'Madison'
      AND "parcelId" IS NOT NULL
      AND sqft BETWEEN 800 AND 5000
      AND "yearBuilt" IS NOT NULL
    ORDER BY random()
    LIMIT 20
  `);
  await pool.end();

  console.log(`\n=== Probing ${rows.length} Madison residential parcels (fixed parser) ===\n`);
  const results = [];
  const fill = {};
  const taxPaidByCounts = {};
  const exemptCounts = {};

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    process.stdout.write(`[${i+1}/${rows.length}] ppin=${p.parcelId} (${p.address})... `);
    try {
      const html = await fetchHTML(`${BASE}?taxyear=2024&ppin=${p.parcelId}`);
      const d = parse(html);
      for (const k of Object.keys(d)) if (d[k] !== null && d[k] !== undefined && d[k] !== "") fill[k] = (fill[k] || 0) + 1;
      if (d.taxPaidBy) taxPaidByCounts[d.taxPaidBy] = (taxPaidByCounts[d.taxPaidBy] || 0) + 1;
      if (d.exemptCode) exemptCounts[d.exemptCode] = (exemptCounts[d.exemptCode] || 0) + 1;
      results.push({ ppin: p.parcelId, address: p.address, ...d });
      console.log(`ok yr=${d.yearBuilt||"-"} appr=${d.appraisedValue?"$"+d.appraisedValue:"-"} owner=${d.ownerFullName||"-"}`);
    } catch (e) {
      console.log(`ERR ${e.message}`);
      if (e.message === "429") break;
    }
    if (i < rows.length - 1) await sleep(DELAY);
  }

  const keys = ["ownerFullName","ownerMailAddress","exemptCode","taxDistrict",
                "totalAcres","landValue","improvementValue","appraisedValue","taxableValue","buildingValue",
                "annualTaxAmount","taxPaidStatus","taxPaidBy","lastTaxPaidDate","ownerHistory",
                "landUseCode","landUseDesc"];
  console.log(`\n=== Field fill over ${results.length} parcels ===`);
  for (const k of keys) {
    const n = fill[k] || 0;
    const pct = results.length ? ((n/results.length)*100).toFixed(0) : 0;
    console.log(`  ${k.padEnd(22)} ${String(n).padStart(3)}/${results.length} (${pct}%)`);
  }

  // Inference signals
  console.log(`\n=== Tax Paid By (who actually pays the tax) ===`);
  for (const [k, v] of Object.entries(taxPaidByCounts).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${String(v).padStart(2)}x  ${k}`);
  }

  console.log(`\n=== Exempt Codes (H1 = homestead owner-occupied) ===`);
  for (const [k, v] of Object.entries(exemptCounts).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${String(v).padStart(2)}x  ${k}`);
  }

  // Inference indicators for each parcel
  console.log(`\n=== Per-parcel inference signals ===`);
  console.log("ppin        | yr   | appraised | H1? | mailing-matches-prop | owner-since | tax-payer");
  console.log("------------+------+-----------+-----+----------------------+-------------+------------------");
  for (const r of results) {
    const h1 = r.exemptCode === "H1" ? "YES" : "no ";
    // Is the mailing address the same as the property (rough check)
    const propAddr = (r.address || "").toUpperCase();
    const mail = (r.ownerMailAddress || "").toUpperCase();
    const mailMatch = propAddr && mail && mail.includes(propAddr.split(",")[0].trim()) ? "YES" : "no ";
    let ownerSince = "-";
    if (r.ownerHistory) {
      const hist = JSON.parse(r.ownerHistory);
      const cur = hist[0]?.owner;
      if (cur) {
        const transfer = hist.find(h => h.owner !== cur);
        ownerSince = transfer ? String(transfer.year + 1) : "pre-" + hist[hist.length - 1].year;
      }
    }
    const payer = (r.taxPaidBy || "-").substring(0, 32);
    console.log(`${String(r.ppin).padEnd(11)} | ${String(r.yearBuilt||"-").padEnd(4)} | ${String(r.appraisedValue?"$"+r.appraisedValue:"-").padEnd(9)} | ${h1} | ${mailMatch.padEnd(20)} | ${String(ownerSince).padEnd(11)} | ${payer}`);
  }

  // 2 full sample dumps
  console.log(`\n=== 2 full JSON samples ===`);
  for (const r of results.slice(0, 2)) console.log(JSON.stringify(r, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
