#!/usr/bin/env node
/**
 * load-prithvi-signals.js  (2026-04-29)
 *
 * Receiving lane for Prithvi-EO-2.0-300M N-AL roof-replacement inference output.
 *
 * Desktop's training pipeline writes a JSONL file at
 *   F:\eavesight-roof-intel\runs\v1\inference-n-al.jsonl
 * (then scp'd to the VM). One row per N-AL property prediction. Each row:
 *
 *   {
 *     "propertyId": "...",
 *     "predictions_by_window": [
 *       {"before_year": 2014, "after_year": 2016, "p_replacement": 0.12, "model_confidence": 0.78},
 *       {"before_year": 2018, "after_year": 2021, "p_replacement": 0.87, "model_confidence": 0.81},
 *       ...
 *     ],
 *     "best_replacement_window": {
 *       "before_year": 2018, "after_year": 2021,
 *       "estimated_year": 2019.5, "year_uncertainty_yrs": 1.5,
 *       "p_replacement": 0.87
 *     },
 *     "model_version": "prithvi-eo-v2-300:travis-v1",
 *     "image_capture_dates": ["2018-06", "2021-11"]
 *   }
 *
 * Pipeline:
 *   1) Validate JSONL line-by-line (cheap, fail-fast on the first bad row).
 *   2) For each row, compute a *calibrated* confidence from the AUC tier
 *      Desktop reports (locked thresholds; see CALIBRATION below). Optional
 *      per-AUC Platt/temperature scaling parameters override the tier mapping.
 *   3) emitSignal({signalType: 'roof_age_imagery', source: 'prithvi.travis-v1',
 *      sourceRecordId: 'prithvi:vX.Y:propertyId', confidence: <calibrated>,
 *      signalDate: <best_replacement_window.estimated_year>-mid-of-year,
 *      signalValue: <full row>})
 *   4) Optional --validate-against=decatur runs the cross-validation SQL
 *      against the 461 Decatur reroof permits and emits a one-shot report.
 *
 * Idempotent re-runs: property_signals unique on (propertyId, signalType,
 * source, sourceRecordId). Each model_version produces a new sourceRecordId
 * so older versions remain as historical rows (audit trail).
 *
 * Usage:
 *   # Dry-run on synthetic data
 *   node scripts/load-prithvi-signals.js --jsonl=test/fixtures/prithvi-synthetic.jsonl
 *
 *   # Real run
 *   node scripts/load-prithvi-signals.js --commit \
 *     --jsonl=/var/data/prithvi/inference-n-al.jsonl --auc=0.78
 *
 *   # With cross-validation report against Decatur permits
 *   node scripts/load-prithvi-signals.js --commit \
 *     --jsonl=... --auc=0.82 --validate-against=decatur
 *
 *   # If a Platt-scaling fit is already known, skip the AUC tier
 *   node scripts/load-prithvi-signals.js --commit --jsonl=... --platt-a=-3.1 --platt-b=1.7
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');
const { emitSignal } = require('./lib/property-signal-emit');

const DB = {
  host: 'localhost',
  port: 5433,
  user: 'eavesight',
  password: 'eavesight',
  database: 'eavesight',
};

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit') || argv.includes('--no-dry-run');
const JSONL_PATH = (argv.find((a) => a.startsWith('--jsonl=')) || '--jsonl=').slice('--jsonl='.length);
const AUC = (() => {
  const m = argv.find((a) => a.startsWith('--auc='));
  return m ? Number(m.slice(6)) : null;
})();
const PLATT_A = (() => { const m = argv.find((a) => a.startsWith('--platt-a=')); return m ? Number(m.slice(10)) : null; })();
const PLATT_B = (() => { const m = argv.find((a) => a.startsWith('--platt-b=')); return m ? Number(m.slice(10)) : null; })();
const TEMP    = (() => { const m = argv.find((a) => a.startsWith('--temp='));    return m ? Number(m.slice(7))  : null; })();
const VALIDATE_AGAINST = (() => {
  const m = argv.find((a) => a.startsWith('--validate-against='));
  return m ? m.slice(19) : null;
})();
const SOURCE = 'prithvi.travis-v1';
const SIGNAL_TYPE = 'roof_age_imagery';
const LOG_FILE = path.join(__dirname, '..', 'logs', 'load-prithvi-signals.log');

function makeLogger() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return (...args) => {
    const line = `[${new Date().toISOString()}] ${args.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`;
    console.log(line);
    stream.write(line + '\n');
  };
}

/**
 * Calibration mapping — locked in `docs/PRITHVI_TRACK_RESPONSE_2026-04-29.md` Q2
 * with the floor adjustment from `docs/CODE_HANDOFF_FOLLOWUP_2026-04-29.md`:
 *
 *   AUC ≥ 0.85         → GREEN   → ship at confidence 0.75 (customer-facing)
 *   0.75 ≤ AUC < 0.85  → YELLOW  → composite-only at confidence 0.55
 *   0.66 ≤ AUC < 0.75  → RED-but-useful → internal-only at confidence 0.45
 *                                    (0.66 = naive pixel-diff baseline)
 *   AUC < 0.66         → RED      → DO NOT SHIP — re-evaluate labels
 *
 * The function returns both a tier label and the per-tier confidence cap. The
 * actual per-row confidence is `Math.min(rawProbability, tierCap)` so a
 * model that's 0.91 confident on a parcel is downweighted to the tier cap if
 * the YELLOW/RED tier dictates.
 */
function aucTier(auc) {
  if (auc == null || !Number.isFinite(auc)) {
    return { tier: 'UNKNOWN', cap: 0.40, ship: false, reason: 'no AUC provided' };
  }
  if (auc >= 0.85) return { tier: 'GREEN',  cap: 0.75, ship: true,  reason: '≥0.85 customer-facing' };
  if (auc >= 0.75) return { tier: 'YELLOW', cap: 0.55, ship: true,  reason: '0.75–0.85 composite-only' };
  if (auc >= 0.66) return { tier: 'RED-INT', cap: 0.45, ship: true, reason: '0.66–0.75 internal-only' };
  return { tier: 'RED', cap: 0.30, ship: false, reason: '<0.66 below naive pixel-diff baseline (do NOT ship)' };
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * If Platt parameters are provided (--platt-a, --platt-b), we apply
 *   p_calibrated = sigmoid(a + b * logit(p_raw))
 * If a temperature parameter is provided (--temp=T), we apply
 *   p_calibrated = sigmoid(logit(p_raw) / T)
 * Otherwise the raw model confidence is returned.
 *
 * Then in either case the result is clamped to the AUC tier cap.
 */
function calibrate(rawP, modelConf, tier) {
  let p = (typeof modelConf === 'number' && Number.isFinite(modelConf)) ? modelConf : rawP;
  if (PLATT_A != null && PLATT_B != null) {
    const eps = 1e-6;
    const clamped = Math.min(1 - eps, Math.max(eps, p));
    const logit = Math.log(clamped / (1 - clamped));
    p = sigmoid(PLATT_A + PLATT_B * logit);
  } else if (TEMP != null && Number.isFinite(TEMP) && TEMP > 0) {
    const eps = 1e-6;
    const clamped = Math.min(1 - eps, Math.max(eps, p));
    const logit = Math.log(clamped / (1 - clamped));
    p = sigmoid(logit / TEMP);
  }
  return Math.max(0, Math.min(p, tier.cap));
}

function bestSignalDate(row) {
  // best_replacement_window.estimated_year is a fractional year (e.g. 2019.5).
  // Map to mid-of-year by default and keep the fractional component.
  const ey = row?.best_replacement_window?.estimated_year;
  if (typeof ey !== 'number' || !Number.isFinite(ey)) return null;
  const yr = Math.floor(ey);
  const frac = ey - yr;
  const monthIdx = Math.min(11, Math.max(0, Math.round(frac * 12)));
  const day = 15;
  return `${yr}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validateRow(row) {
  if (!row || typeof row !== 'object') return 'not an object';
  if (typeof row.propertyId !== 'string' || !row.propertyId) return 'missing/invalid propertyId';
  if (!Array.isArray(row.predictions_by_window) || row.predictions_by_window.length === 0) return 'no predictions_by_window';
  for (const pw of row.predictions_by_window) {
    if (!pw || typeof pw !== 'object') return 'bad predictions_by_window entry';
    if (typeof pw.p_replacement !== 'number') return 'p_replacement not a number';
  }
  if (!row.best_replacement_window || typeof row.best_replacement_window !== 'object') return 'missing best_replacement_window';
  if (typeof row.model_version !== 'string' || !row.model_version) return 'missing model_version';
  return null;
}

async function loadJsonl(jsonlPath, log) {
  if (!jsonlPath || !fs.existsSync(jsonlPath)) {
    throw new Error(`JSONL not found: ${jsonlPath}`);
  }
  const tier = aucTier(AUC);
  log(`AUC tier: ${tier.tier} cap=${tier.cap} ship=${tier.ship} (${tier.reason})`);
  if (PLATT_A != null && PLATT_B != null) log(`Platt scaling enabled: a=${PLATT_A}, b=${PLATT_B}`);
  if (TEMP != null) log(`Temperature scaling enabled: T=${TEMP}`);
  if (!tier.ship) {
    log(`!! tier=${tier.tier} marked DO NOT SHIP — running in dry-run only.`);
  }
  const effectiveCommit = COMMIT && tier.ship;

  const pool = effectiveCommit ? new Pool(DB) : null;
  const rl = readline.createInterface({
    input: fs.createReadStream(jsonlPath),
    crlfDelay: Infinity,
  });

  let total = 0, valid = 0, bad = 0, inserted = 0, skippedDup = 0, missingProperty = 0;
  let modelVersionSeen = null;
  const distConf = { lt30: 0, lt50: 0, lt70: 0, lt85: 0, ge85: 0 };

  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (!line) continue;
      total++;
      let row;
      try { row = JSON.parse(line); } catch (e) {
        bad++;
        if (bad <= 5) log(`bad JSON at line ${total}: ${e.message}`);
        continue;
      }
      const err = validateRow(row);
      if (err) {
        bad++;
        if (bad <= 5) log(`bad row at line ${total}: ${err}`);
        continue;
      }
      valid++;
      modelVersionSeen = modelVersionSeen || row.model_version;
      const best = row.best_replacement_window || {};
      const calibrated = calibrate(best.p_replacement || 0, best.p_replacement, tier);
      // Distribution bookkeeping
      if (calibrated < 0.30) distConf.lt30++;
      else if (calibrated < 0.50) distConf.lt50++;
      else if (calibrated < 0.70) distConf.lt70++;
      else if (calibrated < 0.85) distConf.lt85++;
      else distConf.ge85++;

      if (!effectiveCommit) continue;

      // Property must exist — otherwise FK violation. Verify cheaply.
      const { rows } = await pool.query(`SELECT 1 FROM properties WHERE id = $1`, [row.propertyId]);
      if (rows.length === 0) {
        missingProperty++;
        if (missingProperty <= 5) log(`unknown propertyId=${row.propertyId}, skipping`);
        continue;
      }
      const versionTag = (row.model_version || 'prithvi:v0').replace(/[^A-Za-z0-9._:-]/g, '_');
      const result = await emitSignal({
        pool,
        propertyId: row.propertyId,
        signalType: SIGNAL_TYPE,
        signalValue: row,
        signalDate: bestSignalDate(row),
        confidence: Number(calibrated.toFixed(2)),
        source: SOURCE,
        sourceRecordId: `${versionTag}:${row.propertyId}`,
      });
      if (result.inserted) inserted++; else skippedDup++;
    }
  } finally {
    if (pool) await pool.end();
  }

  log(`done. total=${total} valid=${valid} bad=${bad} inserted=${inserted} dedupedSkipped=${skippedDup} unknownProperty=${missingProperty}`);
  log(`confidence distribution (calibrated): <0.30=${distConf.lt30} <0.50=${distConf.lt50} <0.70=${distConf.lt70} <0.85=${distConf.lt85} ≥0.85=${distConf.ge85}`);
  log(`commit=${effectiveCommit} model_version=${modelVersionSeen}`);
  return { total, valid, bad, inserted, skippedDup, missingProperty, modelVersionSeen };
}

async function runValidation(against, log) {
  if (against !== 'decatur') {
    log(`unsupported --validate-against=${against}`);
    return;
  }
  const pool = new Pool(DB);
  try {
    log('Running cross-validation: Prithvi roof_age_imagery vs Decatur reroof_permit signals…');
    const { rows } = await pool.query(`
      WITH paired AS (
        SELECT
          decatur."propertyId"                          AS property_id,
          EXTRACT(YEAR FROM decatur."signalDate")::int  AS permit_year,
          EXTRACT(YEAR FROM prithvi."signalDate")::int  AS prithvi_year,
          (prithvi."signalValue"->'best_replacement_window'->>'p_replacement')::float AS prithvi_p,
          (prithvi."signalValue"->'best_replacement_window'->>'estimated_year')::float AS prithvi_year_frac
        FROM property_signals decatur
        JOIN property_signals prithvi USING ("propertyId")
        WHERE decatur."signalType" = 'reroof_permit'
          AND decatur.source LIKE 'permit.decatur%'
          AND prithvi."signalType" = 'roof_age_imagery'
          AND prithvi.source = $1
      )
      SELECT
        COUNT(*) AS paired_n,
        AVG(ABS(permit_year - prithvi_year))::numeric(6,2) AS mae_years,
        AVG(CASE WHEN ABS(permit_year - prithvi_year) <= 2 THEN 1.0 ELSE 0.0 END)::numeric(4,3) AS recall_2yr,
        AVG(CASE WHEN ABS(permit_year - prithvi_year) <= 3 THEN 1.0 ELSE 0.0 END)::numeric(4,3) AS recall_3yr,
        MIN(permit_year) AS earliest_permit_yr,
        MAX(permit_year) AS latest_permit_yr,
        AVG(prithvi_p)::numeric(4,3) AS avg_prithvi_p
      FROM paired;
    `, [SOURCE]);
    log(`Decatur cross-val: ${JSON.stringify(rows[0])}`);
    if (rows[0]?.paired_n === '0' || rows[0]?.paired_n === 0) {
      log(`(no paired rows — either Decatur signals or Prithvi signals are missing)`);
    } else if (rows[0]) {
      const r = rows[0];
      const passes = Number(r.recall_2yr) >= 0.70 && Number(r.mae_years) <= 2.5;
      log(`Verdict: ${passes ? 'PASS — recall_2yr ≥ 0.70 AND mae_years ≤ 2.5 (Friday gate met)' : 'FAIL — does not meet recall_2yr ≥ 0.70 AND mae_years ≤ 2.5 gate'}`);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const log = makeLogger();
  log(`Starting Prithvi signal loader (commit=${COMMIT}, jsonl=${JSONL_PATH || '(none)'}, auc=${AUC ?? 'unset'}, validate=${VALIDATE_AGAINST || '(none)'})`);

  if (JSONL_PATH) {
    await loadJsonl(JSONL_PATH, log);
  } else {
    log('No --jsonl=... provided. Skipping load step.');
  }
  if (VALIDATE_AGAINST) {
    await runValidation(VALIDATE_AGAINST, log);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
