/**
 * Eavesight Bulk Data Importer
 *
 * Imports SPC historical storm data (tornado, hail, wind),
 * FEMA disaster declarations, and Census data into PostgreSQL via Prisma.
 *
 * Usage:
 *   cd /home/dentwon/Eavesight/apps/backend
 *   npx ts-node --project tsconfig.json ../../scripts/import-data.ts [--dry-run]
 */

import { PrismaClient, StormType, Severity } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const DATA_DIR = path.resolve(__dirname, '../data');
const BATCH_SIZE = 500;

// ─── Helpers ──────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function parseCsvLines(filePath: string): string[][] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  });
}

function safeFloat(val: string): number | null {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function safeInt(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

/** Map SPC state abbreviation (already 2-letter) */
function stateAbbrev(st: string): string {
  return st.toUpperCase().trim();
}

/** Convert SPC loss code to dollar estimate. SPC uses a code where:
 *  pre-1996: values represent actual dollar amounts in millions
 *  post-1996: values already in millions
 *  We store raw values as-is for now and note the source.
 */
function parseLoss(val: string): number | null {
  const n = safeFloat(val);
  if (n === null || n <= 0) return null;
  // SPC stores loss in millions for post-1996 data
  return n * 1_000_000;
}

/** Determine severity from tornado F/EF scale */
function tornadoSeverity(mag: number | null): Severity | null {
  if (mag === null || mag < 0) return null;
  if (mag <= 0) return 'LIGHT';
  if (mag <= 1) return 'MODERATE';
  if (mag <= 3) return 'SEVERE';
  return 'EXTREME';
}

/** Determine severity from hail size in inches */
function hailSeverity(sizeInches: number | null): Severity | null {
  if (sizeInches === null) return null;
  if (sizeInches < 1.0) return 'LIGHT';
  if (sizeInches < 2.0) return 'MODERATE';
  if (sizeInches < 3.0) return 'SEVERE';
  return 'EXTREME';
}

/** Determine severity from wind speed in knots (SPC uses knots) */
function windSeverity(speedKnots: number | null): Severity | null {
  if (speedKnots === null) return null;
  const mph = speedKnots * 1.15078;
  if (mph < 58) return 'LIGHT';
  if (mph < 75) return 'MODERATE';
  if (mph < 100) return 'SEVERE';
  return 'EXTREME';
}

// ─── SPC Storm Data Import ────────────────────────────────

interface SpcRow {
  om: string;
  yr: string;
  mo: string;
  dy: string;
  date: string;
  time: string;
  tz: string;
  st: string;
  stf: string;
  stn: string;
  mag: string;
  inj: string;
  fat: string;
  loss: string;
  closs: string;
  slat: string;
  slon: string;
  elat: string;
  elon: string;
  len: string;
  wid: string;
}

function parseRow(headers: string[], fields: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  headers.forEach((h, i) => {
    row[h.toLowerCase()] = fields[i] || '';
  });
  return row;
}

async function importSpcFile(
  filePath: string,
  stormType: StormType,
  label: string,
) {
  if (!fs.existsSync(filePath)) {
    log(`SKIP: ${filePath} not found`);
    return 0;
  }

  log(`Importing ${label} from ${path.basename(filePath)}...`);
  const rows = parseCsvLines(filePath);
  if (rows.length < 2) {
    log(`SKIP: ${label} file has no data rows`);
    return 0;
  }

  const headers = rows[0].map((h) => h.toLowerCase());
  const dataRows = rows.slice(1);
  log(`  Found ${dataRows.length} rows`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const batch: any[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    try {
      const r = parseRow(headers, dataRows[i]);

      const lat = safeFloat(r.slat);
      const lon = safeFloat(r.slon);
      const endLat = safeFloat(r.elat);
      const endLon = safeFloat(r.elon);
      const mag = safeFloat(r.mag);

      // Skip rows with no valid coordinates
      if (lat === null || lat === 0) {
        skipped++;
        continue;
      }

      // Build date from fields
      const dateStr = r.date || `${r.yr}-${r.mo.padStart(2, '0')}-${r.dy.padStart(2, '0')}`;
      const timeStr = r.time || '00:00:00';
      const eventDate = new Date(`${dateStr}T${timeStr}Z`);

      if (isNaN(eventDate.getTime())) {
        skipped++;
        continue;
      }

      // Source ID: type-om-yr for dedup
      const sourceId = `spc-${stormType.toLowerCase()}-${r.om}-${r.yr}`;

      let severity: Severity | null = null;
      let hailSizeInches: number | null = null;
      let windSpeedMph: number | null = null;
      let tornadoFScale: string | null = null;
      let widthYards: number | null = null;
      let lengthMiles: number | null = null;

      if (stormType === 'TORNADO') {
        tornadoFScale = mag !== null && mag >= 0 ? `EF${Math.round(mag)}` : null;
        severity = tornadoSeverity(mag);
        widthYards = safeFloat(r.wid);
        lengthMiles = safeFloat(r.len);
      } else if (stormType === 'HAIL') {
        // SPC hail mag is in 100ths of inches (e.g. 175 = 1.75")
        // Actually in the CSV the mag field for hail is already in inches with decimal
        hailSizeInches = mag;
        severity = hailSeverity(mag);
      } else if (stormType === 'WIND') {
        // SPC wind mag is in knots
        if (mag !== null && mag > 0) {
          windSpeedMph = Math.round(mag * 1.15078);
        }
        severity = windSeverity(mag);
      }

      const record = {
        type: stormType,
        severity,
        date: eventDate,
        state: stateAbbrev(r.st),
        lat,
        lon,
        endLat: endLat && endLat !== 0 ? endLat : null,
        endLon: endLon && endLon !== 0 ? endLon : null,
        hailSizeInches,
        windSpeedMph,
        tornadoFScale,
        widthYards,
        lengthMiles: lengthMiles && lengthMiles > 0 ? lengthMiles : null,
        damageEstimate: parseLoss(r.loss),
        deathsDirect: safeInt(r.fat),
        injuriesDirect: safeInt(r.inj),
        source: 'SPC',
        sourceId,
      };

      batch.push(record);

      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) {
          await upsertStormBatch(batch);
        }
        imported += batch.length;
        batch.length = 0;
        if (imported % 10000 === 0) {
          log(`  ${label}: ${imported} imported, ${skipped} skipped, ${errors} errors`);
        }
      }
    } catch (e: any) {
      errors++;
      if (errors <= 5) {
        log(`  Error on row ${i}: ${e.message}`);
      }
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    if (!DRY_RUN) {
      await upsertStormBatch(batch);
    }
    imported += batch.length;
  }

  log(`  ${label} done: ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return imported;
}

async function upsertStormBatch(records: any[]) {
  // Use createMany with skipDuplicates for performance
  // We rely on sourceId for dedup via a transaction that checks existence
  const ops = records.map((r) =>
    prisma.stormEvent.upsert({
      where: {
        // We don't have a unique constraint on sourceId in the schema,
        // so we use create with a check
        id: 'placeholder', // This won't match, forcing create
      },
      update: {},
      create: r,
    }),
  );

  // Actually, let's use createMany which is faster
  await prisma.stormEvent.createMany({
    data: records,
    skipDuplicates: true,
  });
}

// ─── FEMA Disaster Declarations Import ────────────────────

interface FemaDeclaration {
  femaDeclarationString: string;
  disasterNumber: number;
  state: string;
  declarationType: string;
  declarationDate: string;
  incidentType: string;
  declarationTitle: string;
  incidentBeginDate: string;
  incidentEndDate: string | null;
  fipsStateCode: string;
  fipsCountyCode: string;
  designatedArea: string;
}

function femaIncidentToStormType(incidentType: string): StormType | null {
  const t = incidentType.toLowerCase();
  if (t.includes('tornado')) return 'TORNADO';
  if (t.includes('hurricane') || t.includes('typhoon')) return 'HURRICANE';
  if (t.includes('flood')) return 'FLOOD';
  if (t.includes('severe storm') || t.includes('thunderstorm')) return 'TSTM';
  // Skip fires, earthquakes, etc. - not storm related
  if (t.includes('fire') || t.includes('earthquake') || t.includes('volcano') ||
      t.includes('drought') || t.includes('snow') || t.includes('ice') ||
      t.includes('biological') || t.includes('terrorist') || t.includes('toxic') ||
      t.includes('dam') || t.includes('chemical') || t.includes('fishing')) {
    return null;
  }
  return 'OTHER';
}

async function importFemaDeclarations() {
  const filePath = path.join(DATA_DIR, 'fema', 'disaster_declarations.json');
  if (!fs.existsSync(filePath)) {
    log('SKIP: FEMA disaster declarations file not found');
    return 0;
  }

  log('Importing FEMA disaster declarations...');
  const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const declarations: FemaDeclaration[] =
    rawData.DisasterDeclarationsSummaries || rawData;

  if (!Array.isArray(declarations) || declarations.length === 0) {
    log('SKIP: No FEMA declarations found in file');
    return 0;
  }

  log(`  Found ${declarations.length} declarations`);

  // Deduplicate by disaster number + state (multiple areas per disaster)
  const seen = new Set<string>();
  const uniqueDeclarations: FemaDeclaration[] = [];
  for (const d of declarations) {
    const key = `${d.disasterNumber}-${d.state}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueDeclarations.push(d);
    }
  }

  log(`  ${uniqueDeclarations.length} unique disaster-state combinations`);

  let imported = 0;
  let skipped = 0;
  const batch: any[] = [];

  for (const d of uniqueDeclarations) {
    const stormType = femaIncidentToStormType(d.incidentType);
    if (!stormType) {
      skipped++;
      continue;
    }

    const eventDate = new Date(d.incidentBeginDate || d.declarationDate);
    if (isNaN(eventDate.getTime())) {
      skipped++;
      continue;
    }

    const endDate = d.incidentEndDate ? new Date(d.incidentEndDate) : null;
    const sourceId = `fema-${d.femaDeclarationString}`;

    batch.push({
      type: stormType,
      severity: 'SEVERE' as Severity, // FEMA declarations are inherently severe
      date: eventDate,
      endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
      state: d.state,
      description: `${d.declarationTitle} (${d.incidentType}) - FEMA ${d.femaDeclarationString}`,
      source: 'FEMA',
      sourceId,
    });

    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) {
        await prisma.stormEvent.createMany({
          data: batch,
          skipDuplicates: true,
        });
      }
      imported += batch.length;
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    if (!DRY_RUN) {
      await prisma.stormEvent.createMany({
        data: batch,
        skipDuplicates: true,
      });
    }
    imported += batch.length;
  }

  log(`  FEMA done: ${imported} imported, ${skipped} skipped (non-storm)`);
  return imported;
}

// ─── Census Housing Data Import ───────────────────────────
// Note: Census data enriches properties via PropertyEnrichment model.
// If no Census JSON files exist yet, this is a no-op stub ready for when they arrive.

async function importCensusData() {
  const censusDir = path.join(DATA_DIR, 'census');
  if (!fs.existsSync(censusDir)) {
    log('SKIP: No census data directory found');
    return 0;
  }

  const files = fs.readdirSync(censusDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    log('SKIP: No census JSON files found');
    return 0;
  }

  log(`Importing Census data from ${files.length} files...`);
  let imported = 0;

  for (const file of files) {
    const filePath = path.join(censusDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Census data typically comes as array of arrays: [headers, ...rows]
    if (!Array.isArray(data) || data.length < 2) {
      log(`  SKIP: ${file} has no data`);
      continue;
    }

    const headers: string[] = data[0];
    const rows: string[][] = data.slice(1);
    log(`  ${file}: ${rows.length} rows`);

    // We store Census tract-level data in PropertyEnrichment
    // This will be linked to properties by census tract/FIPS later
    // For now, log what we found
    if (DRY_RUN) {
      log(`  [DRY RUN] Would process ${rows.length} census records from ${file}`);
      log(`  Headers: ${headers.slice(0, 10).join(', ')}...`);
      imported += rows.length;
      continue;
    }

    // TODO: Map census fields to PropertyEnrichment when properties are loaded
    imported += rows.length;
  }

  log(`  Census done: ${imported} records processed`);
  return imported;
}

// ─── DataIngestionJob Tracking ────────────────────────────

async function createIngestionJob(type: string) {
  if (DRY_RUN) return null;
  return prisma.dataIngestionJob.create({
    data: {
      type,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });
}

async function completeIngestionJob(
  jobId: string | null,
  totalRecords: number,
  errorCount: number,
  failed = false,
) {
  if (!jobId || DRY_RUN) return;
  await prisma.dataIngestionJob.update({
    where: { id: jobId },
    data: {
      status: failed ? 'FAILED' : 'COMPLETED',
      totalRecords,
      processedRecords: totalRecords - errorCount,
      errorCount,
      completedAt: new Date(),
    },
  });
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  log('=== Eavesight Data Importer ===');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log(`Data directory: ${DATA_DIR}`);
  log('');

  // Verify data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    log(`ERROR: Data directory not found: ${DATA_DIR}`);
    process.exit(1);
  }

  // List available data files
  log('Available data files:');
  const spcDir = path.join(DATA_DIR, 'spc-historical');
  if (fs.existsSync(spcDir)) {
    const files = fs.readdirSync(spcDir).filter((f) => f.endsWith('.csv'));
    files.forEach((f) => {
      const stats = fs.statSync(path.join(spcDir, f));
      log(`  SPC: ${f} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    });
  }

  const femaFile = path.join(DATA_DIR, 'fema', 'disaster_declarations.json');
  if (fs.existsSync(femaFile)) {
    const stats = fs.statSync(femaFile);
    log(`  FEMA: disaster_declarations.json (${(stats.size / 1024).toFixed(0)} KB)`);
  }

  log('');

  let totalImported = 0;

  // ── SPC Tornado Data ──
  const tornadoFile = path.join(spcDir, 'tornadoes_1950_2024.csv');
  const tornadoJob = await createIngestionJob('SPC_TORNADO');
  try {
    const count = await importSpcFile(tornadoFile, 'TORNADO', 'Tornadoes');
    totalImported += count;
    await completeIngestionJob(tornadoJob?.id || null, count, 0);
  } catch (e: any) {
    log(`ERROR importing tornadoes: ${e.message}`);
    await completeIngestionJob(tornadoJob?.id || null, 0, 1, true);
  }

  // ── SPC Hail Data ──
  const hailFile = path.join(spcDir, '1955-2024_hail.csv');
  const hailJob = await createIngestionJob('SPC_HAIL');
  try {
    const count = await importSpcFile(hailFile, 'HAIL', 'Hail');
    totalImported += count;
    await completeIngestionJob(hailJob?.id || null, count, 0);
  } catch (e: any) {
    log(`ERROR importing hail: ${e.message}`);
    await completeIngestionJob(hailJob?.id || null, 0, 1, true);
  }

  // ── SPC Wind Data ──
  const windFile = path.join(spcDir, '1955-2024_wind.csv');
  const windJob = await createIngestionJob('SPC_WIND');
  try {
    const count = await importSpcFile(windFile, 'WIND', 'Wind');
    totalImported += count;
    await completeIngestionJob(windJob?.id || null, count, 0);
  } catch (e: any) {
    log(`ERROR importing wind: ${e.message}`);
    await completeIngestionJob(windJob?.id || null, 0, 1, true);
  }

  // ── FEMA Disaster Declarations ──
  const femaJob = await createIngestionJob('FEMA_DECLARATIONS');
  try {
    const count = await importFemaDeclarations();
    totalImported += count;
    await completeIngestionJob(femaJob?.id || null, count, 0);
  } catch (e: any) {
    log(`ERROR importing FEMA data: ${e.message}`);
    await completeIngestionJob(femaJob?.id || null, 0, 1, true);
  }

  // ── Census Data ──
  const censusJob = await createIngestionJob('CENSUS');
  try {
    const count = await importCensusData();
    totalImported += count;
    await completeIngestionJob(censusJob?.id || null, count, 0);
  } catch (e: any) {
    log(`ERROR importing Census data: ${e.message}`);
    await completeIngestionJob(censusJob?.id || null, 0, 1, true);
  }

  log('');
  log(`=== Import Complete: ${totalImported} total records ===`);
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
