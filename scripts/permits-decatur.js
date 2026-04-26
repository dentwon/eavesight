#!/usr/bin/env node
/**
 * permits-decatur.js  (2026-04-25)
 *
 * Decatur uses Harris CityView Portal but its public permit search is gated
 * behind login. However, the City of Decatur publishes monthly permit reports
 * as machine-parseable PDFs at:
 *   https://www.cityofdecatural.com/permit-reports/
 *
 * The PDFs include a dedicated PRRF (roofing) permit type with description
 * like "Remove and replace 24 sqs of shingles" and "Metal roof 25 Sqs".
 * Roughly 5-10% of monthly permits are roofing.
 *
 * This scraper:
 *  - Discovers all PDF report URLs from the index
 *  - Downloads each PDF, runs pdftotext -layout, parses rows
 *  - Flags roof permits via permit-number prefix PRRF or ROOF_RE on description
 *
 * Usage:
 *   node scripts/permits-decatur.js                     # dry-run, last 25 yrs
 *   node scripts/permits-decatur.js --commit
 *   node scripts/permits-decatur.js --max-pdfs=2 --limit=50
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { fetchText, parseArgs, makeLogger, makePool, upsertPermit, ROOF_RE } = require('./permit-common');

const SOURCE = 'decatur';
const REPORT_INDEX = 'https://www.cityofdecatural.com/permit-reports/';
const SITE_BASE = 'https://www.cityofdecatural.com';

async function listPdfs(log) {
  const r = await fetchText(REPORT_INDEX);
  if (r.status !== 200) throw new Error(`Index HTTP ${r.status}`);
  const urls = [...r.body.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) =>
    m[1].startsWith('http') ? m[1] : new URL(m[1], SITE_BASE).toString(),
  );
  const dedup = [...new Set(urls)];
  log(`Found ${dedup.length} PDF report URLs`);
  return dedup;
}

async function downloadPdf(url, log) {
  const tmp = path.join(os.tmpdir(), `decatur_${Buffer.from(url).toString('hex').slice(-12)}.pdf`);
  if (fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) return tmp;
  const lib = url.startsWith('https') ? require('https') : require('http');
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmp);
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
  log(`Downloaded ${url} -> ${tmp} (${fs.statSync(tmp).size} bytes)`);
  return tmp;
}

function pdfToText(pdfPath) {
  return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 50 * 1024 * 1024 }).toString('utf8');
}

const ROW_RE = /^\s*(\d{1,2}-[A-Za-z]{3}-\d{2})\s+(PR[A-Z0-9]+)\s+\$([\d,]+\.\d{2})\s+(.+)$/;

function parsePdfText(text) {
  // Decatur PDFs render as multi-line records: a primary line containing
  // date, permit#, valuation, then continuation lines with owner/contractor/
  // address/work-description. Use a sliding window: when a new date appears,
  // start a new record; accumulate description text from following lines.
  const lines = text.split('\n');
  const out = [];
  let cur = null;
  let currentSection = null;
  for (const raw of lines) {
    const line = raw;
    // Detect section header (e.g., "Building", "Roofing", "Mechanical")
    const trimmed = line.trim();
    if (/^(Building|Roofing|Mechanical|Electrical|Plumbing|Sign|Demolition|Fence)$/i.test(trimmed)) {
      currentSection = trimmed;
      continue;
    }
    const m = line.match(ROW_RE);
    if (m) {
      if (cur) out.push(cur);
      const [, dateStr, permitNum, valStr, rest] = m;
      const issued_at = new Date(dateStr.replace(/(\d{2})$/, '20$1'));
      // Heuristic split rest into chunks by 2+ spaces; last chunk = description, second-to-last = address
      const parts = rest.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
      const description = parts[parts.length - 1] || '';
      const address = parts[parts.length - 2] || '';
      const contractor = parts[parts.length - 3] || '';
      cur = {
        source: SOURCE,
        permit_number: permitNum,
        permit_type: currentSection || 'Building',
        description,
        address,
        contractor,
        valuation: Number(valStr.replace(/,/g, '')) || null,
        city: 'Decatur',
        issued_at: !isNaN(issued_at) ? issued_at : null,
        raw: { dateStr, permitNum, valStr, rest, section: currentSection },
      };
    } else if (cur && trimmed.length > 0 && !/^Permit Type/i.test(trimmed)) {
      // continuation line — append to description
      cur.description = (cur.description + ' ' + trimmed).trim().slice(0, 800);
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxArg = process.argv.find((a) => a.startsWith('--max-pdfs='));
  const maxPdfs = maxArg ? Number(maxArg.slice(11)) : 3;
  const log = makeLogger(args.log || path.join(__dirname, '..', 'logs', 'permits-decatur.log'));
  log(`Starting Decatur permit harvest (dryRun=${args.dryRun}) limit=${args.limit} maxPdfs=${maxPdfs}`);

  let pdfs;
  try {
    pdfs = await listPdfs(log);
  } catch (e) {
    log(`Index fetch failed: ${e.message}`);
    return;
  }

  const pool = args.dryRun ? null : makePool();
  let totalRows = 0, totalRoof = 0, totalInserts = 0, totalPlanned = 0;
  try {
    for (const url of pdfs.slice(0, maxPdfs)) {
      try {
        const file = await downloadPdf(url, log);
        const text = pdfToText(file);
        const rows = parsePdfText(text);
        log(`  ${path.basename(url)}: parsed ${rows.length} rows`);
        const sample = rows.slice(0, args.limit);
        totalRows += rows.length;
        for (const p of sample) {
          const isRoof = ROOF_RE.test(`${p.permit_type} ${p.description}`) || p.permit_number?.startsWith('PRRF');
          if (isRoof) totalRoof++;
          if (args.dryRun) {
            totalPlanned++;
            log(`  PLAN INSERT: ${p.permit_number} | ${p.permit_type} | ${p.address} | ${p.description.slice(0, 80)}`);
          } else {
            const r = await upsertPermit(pool, p, false);
            totalInserts += r.inserted;
            if (r.is_roofing) log(`  ROOF: ${p.permit_number} ${p.address}`);
          }
        }
      } catch (e) {
        log(`  ${url} FAILED: ${e.message}`);
      }
    }
  } finally {
    if (pool) await pool.end();
  }
  log(`Done. fetched=${totalRows} roofing=${totalRoof} ${args.dryRun ? `plannedInserts=${totalPlanned}` : `inserted=${totalInserts}`}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
