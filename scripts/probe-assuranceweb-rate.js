#!/usr/bin/env node
/**
 * Probe AssuranceWeb rate-limit ceiling.
 *
 * Strategy: run fixed-count bursts at decreasing intervals, measuring
 *   - % 429s
 *   - request # where first 429 occurs (bucket depth proxy)
 *   - avg latency on successful requests
 *   - effective throughput (req/hour) accounting for cooldown cost
 *
 * After each burst: 3-minute rest so token bucket refills fully.
 * Read-only: no DB writes.
 */
const https = require("https");
const { Pool } = require("pg");

const BASE = "https://madisonproperty.countygovservices.com/Property/Property/Details";
const BURST_SIZE = 40;                          // requests per interval test
const INTERVALS = [16000, 14000, 12000, 10000, 8000, 6000]; // ms between requests
const REFILL_PAUSE_MS = 180000;                 // 3-min pause between bursts (let bucket refill)
const BUDGET_PARCELS = 400;                     // max unique parcels needed

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
];
const LANG_POOL = ["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-US,en;q=0.8,de;q=0.6"];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowMs = () => Date.now();

// Build one HTTPS agent with keepAlive — test whether session reuse loosens bucket
const agent = new https.Agent({ keepAlive: true, maxSockets: 1, keepAliveMsecs: 30000 });

function fetchOne(parcelId) {
  return new Promise(resolve => {
    const url = BASE + "?taxyear=2024&ppin=" + encodeURIComponent(parcelId);
    const u = new URL(url);
    const t0 = Date.now();
    const req = https.request({
      host: u.host, path: u.pathname + u.search, method: "GET", agent, timeout: 15000,
      headers: {
        "User-Agent": UA_POOL[Math.floor(Math.random() * UA_POOL.length)],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": LANG_POOL[Math.floor(Math.random() * LANG_POOL.length)],
        "Connection": "keep-alive",
      },
    }, res => {
      const lat = Date.now() - t0;
      // Drain body so the socket can be reused
      res.on("data", () => {});
      res.on("end", () => resolve({ status: res.statusCode, latency: lat, redirect: res.headers.location }));
      res.on("error", () => resolve({ status: 0, latency: lat, err: "stream" }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, latency: Date.now() - t0, err: "timeout" }); });
    req.on("error", e => resolve({ status: 0, latency: Date.now() - t0, err: e.code || e.message }));
    req.end();
  });
}

async function runBurst(parcels, intervalMs, label) {
  console.log(`\n=== BURST: ${label}  (interval ${intervalMs}ms, ${BURST_SIZE} reqs) ===`);
  const results = [];
  const burstStart = nowMs();
  for (let i = 0; i < BURST_SIZE && i < parcels.length; i++) {
    const r = await fetchOne(parcels[i]);
    results.push(r);
    const tag = r.status === 200 ? "OK" :
                r.status === 429 ? "429" :
                r.status >= 300 && r.status < 400 ? "3xx" :
                r.status === 0 ? ("ERR:" + (r.err || "?")) :
                ("HTTP:" + r.status);
    process.stdout.write(`  #${(i + 1).toString().padStart(2)}: ${tag.padEnd(10)} ${r.latency}ms`);
    if ((i + 1) % 4 === 0) process.stdout.write("\n"); else process.stdout.write("   ");
    if (i < BURST_SIZE - 1) await sleep(intervalMs);
  }
  process.stdout.write("\n");
  const elapsedSec = (nowMs() - burstStart) / 1000;

  const ok = results.filter(r => r.status === 200).length;
  const ban = results.filter(r => r.status === 429).length;
  const err = results.filter(r => r.status === 0 || (r.status !== 200 && r.status !== 429)).length;
  const first429 = results.findIndex(r => r.status === 429);
  const latOk = results.filter(r => r.status === 200).map(r => r.latency);
  const avgLat = latOk.length ? Math.round(latOk.reduce((a, b) => a + b) / latOk.length) : 0;

  // Sustained-rate hourly projection: how many *successful* requests per hour assuming this pattern repeats
  // = ok * 3600 / elapsedSec, BUT adjust: if we 429'd, the pattern can't sustain — penalty = 0 ok until bucket refills
  // So projected = ok / elapsedSec * 3600 only if ban === 0.
  // If ban > 0, sustained rate = 50 ok / (burst_time + 30min cooldown) ≈ real-world value.
  let sustainedPerHour;
  if (ban === 0) {
    sustainedPerHour = Math.round(ok / elapsedSec * 3600);
  } else {
    // Pattern: ok requests burst + enforced cooldown until refill
    // Assume 30-min cooldown penalty (what we see in v3 logs)
    const cycleSec = elapsedSec + 30 * 60;
    sustainedPerHour = Math.round(ok / cycleSec * 3600);
  }

  console.log(`  SUMMARY: ok=${ok}  429=${ban}  err=${err}  first429=${first429 >= 0 ? "#" + (first429 + 1) : "none"}  avgLat=${avgLat}ms  sustained≈${sustainedPerHour}/hr`);
  return { label, intervalMs, ok, ban, err, first429, avgLat, sustainedPerHour, burstSec: elapsedSec };
}

(async () => {
  console.log(`Probing AssuranceWeb rate-limit @ ${new Date().toISOString()}`);
  console.log(`Intervals: ${INTERVALS.map(i => i / 1000 + "s").join(", ")}`);
  console.log(`Burst size: ${BURST_SIZE}, refill pause: ${REFILL_PAUSE_MS / 1000}s`);
  console.log(`NOTE: keepAlive ON for all bursts`);

  // Pull unscraped parcel IDs
  const pool = new Pool({ connectionString: "postgresql://eavesight:eavesight@localhost:5433/eavesight" });
  const { rows } = await pool.query(
    `SELECT "parcelId" FROM properties
      WHERE "parcelId" IS NOT NULL AND county = 'Madison'
        AND ("yearBuiltSource" IS NULL OR "yearBuiltSource" != 'madison-assessor-scrape')
      LIMIT $1`, [BUDGET_PARCELS]);
  await pool.end();
  const parcels = rows.map(r => r.parcelId);
  console.log(`Loaded ${parcels.length} unscraped parcels\n`);

  if (parcels.length < BURST_SIZE * INTERVALS.length) {
    console.log(`WARN: only ${parcels.length} parcels, need ${BURST_SIZE * INTERVALS.length} — will reuse`);
  }

  // Warm-up pause: let any residual Cloudflare token bucket fully refill
  console.log("Warm-up pause 2 min to ensure clean bucket...");
  await sleep(120000);

  const results = [];
  let parcelIdx = 0;
  for (const intervalMs of INTERVALS) {
    const slice = parcels.slice(parcelIdx, parcelIdx + BURST_SIZE);
    if (slice.length < BURST_SIZE) {
      // Reuse from start
      slice.push(...parcels.slice(0, BURST_SIZE - slice.length));
    }
    parcelIdx += BURST_SIZE;
    const r = await runBurst(slice, intervalMs, `${intervalMs / 1000}s interval`);
    results.push(r);

    // Only pause-refill between bursts; skip after last
    if (intervalMs !== INTERVALS[INTERVALS.length - 1]) {
      // If the burst triggered 429s, pause longer (full 30-min bucket reset)
      const pause = r.ban > 0 ? 30 * 60 * 1000 : REFILL_PAUSE_MS;
      console.log(`  Cool-down: ${pause / 1000}s before next interval (${r.ban > 0 ? "extended, hit 429s" : "standard"})...`);
      await sleep(pause);
    }
  }

  console.log("\n\n=== FINAL REPORT ===");
  console.log("interval | ok/40 | 429s | first429 | avgLat | sustained/hr");
  console.log("---------|-------|------|----------|--------|-------------");
  for (const r of results) {
    console.log(
      `${(r.intervalMs / 1000 + "s").padEnd(8)} | ${String(r.ok).padStart(5)} | ${String(r.ban).padStart(4)} | ${(r.first429 >= 0 ? "#" + (r.first429 + 1) : "none").padEnd(8)} | ${String(r.avgLat).padStart(6)} | ${String(r.sustainedPerHour).padStart(12)}`
    );
  }
  // Recommend
  const safe = results.filter(r => r.ban === 0).sort((a, b) => a.intervalMs - b.intervalMs);
  if (safe.length) {
    const fastest = safe[0];
    console.log(`\nRECOMMENDED STEADY INTERVAL: ${fastest.intervalMs / 1000}s (0 × 429 in ${BURST_SIZE} reqs)`);
    console.log(`  → projected rate: ${fastest.sustainedPerHour}/hr`);
    console.log(`  → 145,000 parcels ETA: ${(145000 / fastest.sustainedPerHour / 24).toFixed(1)} days`);
  } else {
    console.log(`\nNo safe interval found — all tested rates triggered 429s`);
    console.log(`Slowest tested (${INTERVALS[0] / 1000}s) still saw ${results[0].ban} × 429`);
    console.log(`Either probe with slower intervals (20s+, 30s) OR accept that this single IP is fully saturated and consider off-peak scheduling`);
  }
})().catch(e => { console.error(e); process.exit(1); });
