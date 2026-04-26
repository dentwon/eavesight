#!/usr/bin/env node
// enrich-yearbuilt-supervisor.js — N parallel workers, each in its own
// PIA namespace, each pinned to a different US region. On 429, the worker
// exits 42; we cool that region, rotate the worker onto a fresh one, respawn.
//
// Usage: sudo node enrich-yearbuilt-supervisor.js
//
// Runtime layout:
//   /run/eavesight-vpn/N.state      — per-worker namespace state file (from pia-up.sh)
//   /tmp/yearbuilt-worker-N.heartbeat — worker liveness marker
//   /tmp/yearbuilt-supervisor.log   — rolling log from spawned workers
//
// Why this layer exists (vs just running N copies of v3):
//   - One pool of regions + a cooldown table so we don't re-burn a region
//     that was just rate-limited. User feedback: bans self-heal in minutes,
//     not days, so the cooldown is short (COOLDOWN_MS below) with a probe
//     recheck rather than 24h blacklist.
//   - Pool size bounded by PIA's 10-device cap (user hinted 2 in-use, so
//     we take 8). Each worker holds one WireGuard session per namespace.
//   - Heartbeat watchdog: if a worker goes silent >WATCHDOG_MS, we SIGKILL
//     it and rotate its namespace — covers cases where the tunnel drops
//     mid-batch without a clean 429.

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ------------------------------- tuning ------------------------------------
const N_WORKERS       = parseInt(process.env.N_WORKERS      || "8",   10);
const BATCH_SIZE      = parseInt(process.env.BATCH_SIZE     || "100", 10);
const DELAY_MS        = parseInt(process.env.DELAY_MS       || "6000", 10);
const COOLDOWN_MS     = parseInt(process.env.COOLDOWN_MS    || String(20 * 60 * 1000), 10); // 20 min
// 3 min silence = dead. Workers emit a progress line every 5 parcels
// (~35-45s at DELAY_MS=6000), so 3 min gives ample headroom for a single
// slow HTTPS turn without triggering a spurious SIGKILL.
const WATCHDOG_MS     = parseInt(process.env.WATCHDOG_MS    || String(3  * 60 * 1000), 10);
const STAGGER_MS      = parseInt(process.env.STAGGER_MS     || "4000", 10); // delay between spawns at startup
const MAX_TOTAL_MS    = parseInt(process.env.MAX_TOTAL_MS   || String(36 * 60 * 60 * 1000), 10); // safety cap 36h
const VPN_DIR         = "/home/dentwon/Eavesight/scripts/vpn";
const WORKER_SCRIPT   = "/home/dentwon/Eavesight/scripts/enrich-yearbuilt-worker.js";
const STATE_DIR       = "/run/eavesight-vpn";

// Pool of PIA regions to rotate through. Each worker picks a fresh one on
// respawn, skipping any still in cooldown.
const REGION_POOL = [
  "us_atlanta",
  "us_chicago",
  "us_new_york_city",
  "us_denver",
  "us_silicon_valley",
  "us_seattle",
  "us_houston",
  "us_florida",
  "us_las_vegas",
  "us_washington_dc",
  "us_pennsylvania-pf",
  "us_california",
  "us_virginia-pf",
  "us_north_carolina-pf",
];

// --------------------------- state --------------------------------------
const workers = new Map(); // workerId -> { proc, region, startedAt, lastHeartbeat }
const regionCoolingUntil = new Map(); // region -> epoch ms when usable again
let shuttingDown = false;
let stats = { batchesCompleted: 0, rotated: 0, watchdog: 0, noWork: 0, fatal: 0 };
const startedAt = Date.now();

function log(...a) { console.log(`[sup ${new Date().toISOString()}]`, ...a); }

// --------------------------- region selection ---------------------------
function availableRegions(excluded = new Set()) {
  const now = Date.now();
  return REGION_POOL.filter(r => {
    if (excluded.has(r)) return false;
    const u = regionCoolingUntil.get(r);
    return !u || u <= now;
  });
}

/**
 * Pick a region not in `excluded` and not cooling. If everything is cooling,
 * returns the earliest-available one (accepting slight overlap over idle).
 */
function pickRegion(excluded = new Set()) {
  const avail = availableRegions(excluded);
  if (avail.length) return avail[Math.floor(Math.random() * avail.length)];

  // Fallback: least-cooled region
  const now = Date.now();
  let best = null, bestUntil = Infinity;
  for (const r of REGION_POOL) {
    if (excluded.has(r)) continue;
    const u = regionCoolingUntil.get(r) || now;
    if (u < bestUntil) { bestUntil = u; best = r; }
  }
  return best || REGION_POOL[0];
}

function regionsInUse() {
  return new Set(Array.from(workers.values()).map(w => w.region));
}

// --------------------------- namespace plumbing --------------------------
function piaUp(region, workerId) {
  log(`pia-up  w${workerId} -> ${region}`);
  execFileSync(path.join(VPN_DIR, "pia-up.sh"), [region, String(workerId)], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  });
}

function piaDown(workerId) {
  try {
    execFileSync(path.join(VPN_DIR, "pia-down.sh"), [String(workerId)], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
  } catch (e) {
    log(`pia-down w${workerId} error:`, e.message);
  }
}

// --------------------------- worker lifecycle ----------------------------
function spawnWorker(workerId) {
  if (shuttingDown) return;

  const existing = workers.get(workerId);
  const excluded = regionsInUse();
  if (existing) excluded.delete(existing.region); // we're about to free this
  const region = pickRegion(excluded);

  try {
    // Tear down anything stale for this worker, then bring up fresh tunnel
    piaDown(workerId);
    piaUp(region, workerId);
  } catch (e) {
    // VPN-setup failures are usually PIA auth hiccups. Back off with jitter
    // so 8 workers don't pile-drive the rate-limit window in sync.
    const backoffMs = 180000 + Math.floor(Math.random() * 120000); // 3–5 min
    log(`w${workerId} vpn setup failed: ${e.message} — retry in ${Math.round(backoffMs/1000)}s`);
    setTimeout(() => spawnWorker(workerId), backoffMs);
    return;
  }

  const ns = `ns-${workerId}`;
  const args = [
    "netns", "exec", ns,
    "node", WORKER_SCRIPT,
    `--worker-id=${workerId}`,
    `--batch-size=${BATCH_SIZE}`,
    `--delay-ms=${DELAY_MS}`,
  ];
  const proc = spawn("ip", args, { stdio: ["ignore", "pipe", "pipe"] });

  const entry = {
    proc,
    region,
    pid: proc.pid,
    startedAt: Date.now(),
    lastHeartbeat: Date.now(),
  };
  workers.set(workerId, entry);
  log(`spawn   w${workerId} (pid=${proc.pid} region=${region} ns=${ns})`);

  proc.stdout.on("data", chunk => {
    process.stdout.write(chunk);
    entry.lastHeartbeat = Date.now();
  });
  proc.stderr.on("data", chunk => process.stderr.write(chunk));
  proc.on("exit", (code, signal) => onWorkerExit(workerId, code, signal, region));
}

// Release any claim rows owned by this worker id. Called on every exit path
// (including SIGKILL from the watchdog), because the worker's own cleanup
// only fires for SIGTERM / in-flight rate-limited exit — orphaned claims
// otherwise accumulate and shrink effective queue depth. Swallows errors
// so a failing release never blocks a respawn.
function releaseWorkerClaims(workerId) {
  try {
    const out = execFileSync("psql", [
      "-h", "localhost", "-p", "5433", "-U", "eavesight", "-d", "eavesight",
      "-At", "-c",
      `UPDATE properties
       SET "scrapeClaimedBy" = NULL, "scrapeClaimedAt" = NULL
       WHERE "scrapeClaimedBy" = 'w${workerId}'
       RETURNING id`,
    ], { env: { ...process.env, PGPASSWORD: "eavesight" }, encoding: "utf8", timeout: 15000 });
    const n = out.trim().split("\n").filter(Boolean).length;
    if (n) log(`release w${workerId} freed ${n} orphaned claim(s)`);
  } catch (e) {
    log(`release w${workerId} failed: ${e.message}`);
  }
}

function onWorkerExit(workerId, code, signal, region) {
  if (shuttingDown) return;
  workers.delete(workerId);
  log(`exit    w${workerId} code=${code} signal=${signal} region=${region}`);

  // Free any claim rows the worker didn't get to — the worker's own cleanup
  // only runs on SIGTERM, so SIGKILL (watchdog) and crash exits would
  // otherwise leave rows stranded. Safe to always run: rows successfully
  // scraped already had their claim cleared at flush time.
  releaseWorkerClaims(workerId);

  switch (code) {
    case 0:
      stats.batchesCompleted++;
      setImmediate(() => spawnWorker(workerId));
      break;
    case 2:
      stats.noWork++;
      log(`w${workerId} no work left — not respawning`);
      // If all 8 are parked with code 2, we're done.
      if (workers.size === 0) {
        log("all workers report no work — exiting");
        shutdown(0);
      }
      break;
    case 42:
      stats.rotated++;
      regionCoolingUntil.set(region, Date.now() + COOLDOWN_MS);
      log(`cool    ${region} until ${new Date(Date.now() + COOLDOWN_MS).toISOString()}`);
      setImmediate(() => spawnWorker(workerId));
      break;
    default:
      stats.fatal++;
      log(`w${workerId} unexpected exit code ${code} — respawn in 30s`);
      setTimeout(() => spawnWorker(workerId), 30000);
  }
}

// --------------------------- watchdog ------------------------------------
// If a worker's stdout is silent > WATCHDOG_MS, assume the tunnel dropped
// or it hung and kill it.
function watchdogTick() {
  if (shuttingDown) return;
  const now = Date.now();

  // Overall runtime cap
  if (now - startedAt > MAX_TOTAL_MS) {
    log(`runtime cap ${MAX_TOTAL_MS}ms hit — shutting down`);
    shutdown(0);
    return;
  }

  for (const [id, w] of workers) {
    if (now - w.lastHeartbeat > WATCHDOG_MS) {
      stats.watchdog++;
      log(`watchdog w${id} silent ${((now - w.lastHeartbeat) / 1000).toFixed(0)}s — killing`);
      try { w.proc.kill("SIGKILL"); } catch {}
      // onWorkerExit will fire, respawn
    }
  }
}

// --------------------------- status line ---------------------------------
function statusTick() {
  if (shuttingDown) return;
  const up = Array.from(workers.entries()).map(([id, w]) => `w${id}:${w.region.replace(/^us_/, "")}`).join(" ");
  const cooling = Array.from(regionCoolingUntil.entries())
    .filter(([, u]) => u > Date.now())
    .map(([r]) => r.replace(/^us_/, ""))
    .join(",") || "none";
  log(`status  workers=${workers.size}/${N_WORKERS}  [${up}]  cooling=${cooling}  batches=${stats.batchesCompleted} rotated=${stats.rotated} watchdog=${stats.watchdog}`);
}

// --------------------------- shutdown ------------------------------------
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutdown — killing workers");
  for (const [id, w] of workers) {
    try { w.proc.kill("SIGTERM"); } catch {}
  }
  // Give workers a moment to release their claim rows, then tear down tunnels
  setTimeout(() => {
    for (let id = 1; id <= N_WORKERS; id++) piaDown(id);
    log(`final stats: ${JSON.stringify(stats)}`);
    process.exit(code);
  }, 5000);
}

process.on("SIGINT",  () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// --------------------------- boot ----------------------------------------
async function boot() {
  log(`booting N=${N_WORKERS} batch=${BATCH_SIZE} delay=${DELAY_MS}ms cooldown=${COOLDOWN_MS/60000}min watchdog=${WATCHDOG_MS/1000}s`);

  // Clean slate: release any stale claims from prior crashed runs.
  // Done via a tiny ad-hoc psql so we don't need pg in the supervisor.
  try {
    const out = execFileSync("psql", [
      "-h", "localhost", "-p", "5433", "-U", "eavesight", "-d", "eavesight",
      "-At", "-c",
      `UPDATE properties
       SET "scrapeClaimedBy" = NULL, "scrapeClaimedAt" = NULL
       WHERE "scrapeClaimedBy" IS NOT NULL
         AND "scrapeClaimedBy" NOT LIKE 'PERMA_SKIP_%'
       RETURNING id`,
    ], { env: { ...process.env, PGPASSWORD: "eavesight" }, encoding: "utf8" });
    const n = out.trim().split("\n").filter(Boolean).length;
    if (n) log(`released ${n} stale claims back to queue`);
  } catch (e) {
    log(`warn: stale-claim cleanup failed: ${e.message}`);
  }

  for (let id = 1; id <= N_WORKERS; id++) {
    setTimeout(() => spawnWorker(id), (id - 1) * STAGGER_MS);
  }

  setInterval(watchdogTick, 10_000);
  setInterval(statusTick,   60_000);
}

boot().catch(e => { console.error("supervisor fatal:", e); process.exit(1); });
