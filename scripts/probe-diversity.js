#!/usr/bin/env node
// Diversity probe: 30 parcels across eras, show roof-type + material distribution.
const fs = require("fs");
const { Pool } = require("pg");
const v3 = fs.readFileSync("/home/dentwon/Eavesight/scripts/enrich-yearbuilt-v3.js", "utf8");
eval(v3.match(/function parseMoney[\s\S]*?^}/m)[0]);
eval(v3.match(/function parse\(html\) \{[\s\S]*?^}\n/m)[0]);

(async () => {
  const pool = new Pool({ connectionString: "postgresql://eavesight:eavesight@localhost:5433/eavesight" });
  const { rows } = await pool.query(`
    (SELECT "parcelId", "yearBuilt" FROM properties WHERE county='Madison' AND "parcelId" IS NOT NULL AND "yearBuilt" < 1950 ORDER BY random() LIMIT 10)
    UNION ALL
    (SELECT "parcelId", "yearBuilt" FROM properties WHERE county='Madison' AND "parcelId" IS NOT NULL AND "yearBuilt" BETWEEN 1950 AND 1980 ORDER BY random() LIMIT 10)
    UNION ALL
    (SELECT "parcelId", "yearBuilt" FROM properties WHERE county='Madison' AND "parcelId" IS NOT NULL AND "yearBuilt" BETWEEN 2000 AND 2025 ORDER BY random() LIMIT 10)
  `);
  await pool.end();

  const rt = {}, rm = {}, fn = {}, ew = {};
  let n = 0;
  for (const [i, p] of rows.entries()) {
    process.stdout.write(`[${i+1}/${rows.length} yr=${p.yearBuilt}] `);
    try {
      const res = await fetch("https://madisonproperty.countygovservices.com/Property/Property/Details?taxyear=2024&ppin=" + p.parcelId, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
      if (res.status === 429) { console.log(" 429, stopping early"); break; }
      const d = parse(await res.text());
      process.stdout.write(`${d.roofType||"-"} / ${d.roofMaterial||"-"}\n`);
      if (d.roofType)     rt[d.roofType]     = (rt[d.roofType]     || 0) + 1;
      if (d.roofMaterial) rm[d.roofMaterial] = (rm[d.roofMaterial] || 0) + 1;
      if (d.foundation)   fn[d.foundation]   = (fn[d.foundation]   || 0) + 1;
      if (d.exteriorWalls) ew[d.exteriorWalls] = (ew[d.exteriorWalls] || 0) + 1;
      n++;
    } catch (e) { console.log(" ERR " + e.message); }
    if (i < rows.length - 1) await new Promise(r => setTimeout(r, 6500));
  }

  const show = (label, map) => {
    console.log(`\n=== ${label} (${n} parcels) ===`);
    for (const [k, v] of Object.entries(map).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)} x  ${k}`);
  };
  show("Roof Type", rt);
  show("Roof Material", rm);
  show("Foundation", fn);
  show("Exterior Walls", ew);
})();
