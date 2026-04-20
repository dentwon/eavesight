import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from '../common/prisma.service';

const execAsync = promisify(exec);

/**
 * MaintenanceProcessor — non-storm scheduled jobs.
 *
 *   Daily 04:00  — recompute composite scores (urgency / revenue / opportunity)
 *   Daily 05:00  — GDAL + MRMS cache housekeeping
 *   Daily 06:00  — scrape Huntsville permits for competitor intel
 *   Weekly Sun 02:00 — re-harvest parcel ownership (all counties)
 *   Monthly 1st 04:00 — refresh OSM POI data
 *   Quarterly — refresh FEMA flood zones
 *
 * All jobs are no-ops if the corresponding script is missing — the scheduler
 * never throws; failures log-and-continue. Env flag `ENABLE_MAINTENANCE_JOBS`
 * must be 'true' for any of these to run in non-prod.
 */
@Injectable()
export class MaintenanceProcessor {
  private readonly logger = new Logger(MaintenanceProcessor.name);
  private readonly scriptDir = process.env.MAINT_SCRIPT_DIR || '/home/dentwon/StormVault/scripts';

  constructor(private readonly prisma: PrismaService) {}

  private shouldRun(): boolean {
    return process.env.ENABLE_MAINTENANCE_JOBS === 'true';
  }

  private async runScript(file: string, label: string, timeoutMs = 60 * 60 * 1000) {
    const cmd = `node ${this.scriptDir}/${file}`;
    this.logger.log(`[${label}] starting: ${cmd}`);
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 });
      this.logger.log(`[${label}] done (stdout ${stdout.length} bytes, stderr ${stderr.length} bytes)`);
    } catch (err: any) {
      this.logger.error(`[${label}] failed: ${err.message?.slice(0, 500) ?? err}`);
    }
  }

  // ================================================================
  // 04:00 — recompute composite property scores
  // ================================================================
  @Cron('0 4 * * *')
  async nightlyRecomputeScores() {
    if (!this.shouldRun()) return;
    this.logger.log('Nightly composite-score recompute starting…');
    try {
      // Urgency: recent hail + roof age + recent storm hits within 5km last 12mo
      await this.prisma.$executeRawUnsafe(`
        UPDATE properties p
        SET "urgencyScore" = LEAST(100, (
          COALESCE("hailExposureIndex", 0) * 8 +
          GREATEST(0, (2026 - COALESCE("yearBuilt", 2026))) * 1.5 +
          (SELECT COUNT(*) * 4 FROM storm_events se
            WHERE se.date >= NOW() - INTERVAL '12 months'
              AND ST_DWithin(
                ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint(se.lon, se.lat), 4326)::geography,
                5000
              ))
        ))
        WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL;
      `);
      // Revenue potential: roof area × $/sqft × complexity factor
      await this.prisma.$executeRawUnsafe(`
        UPDATE properties
        SET "revenuePotential" = ROUND(
          COALESCE("roofAreaSqft", 2500) * 7.5 *
          CASE "roofSizeClass"
            WHEN 'SMALL' THEN 1.0
            WHEN 'MEDIUM' THEN 1.1
            WHEN 'LARGE' THEN 1.2
            WHEN 'XL' THEN 1.35
            ELSE 1.05
          END
        );
      `);
      // Opportunity: 0-100 weighted composite
      await this.prisma.$executeRawUnsafe(`
        UPDATE properties
        SET "opportunityScore" = LEAST(100,
          COALESCE("urgencyScore", 0) * 0.55 +
          LEAST(60, COALESCE("revenuePotential", 0) / 2000) +
          CASE WHEN "ownerOccupied" = true THEN 10 ELSE 0 END
        );
      `);
      this.logger.log('Composite scores updated.');
    } catch (e: any) {
      this.logger.error(`Score recompute failed: ${e.message}`);
    }
  }

  // ================================================================
  // 05:00 — purge GDAL/MRMS cache older than 7 days
  // ================================================================
  @Cron('0 5 * * *')
  async housekeeping() {
    if (!this.shouldRun()) return;
    try {
      await execAsync(`find /home/dentwon/.mrms-cache -type f -mtime +7 -delete 2>/dev/null || true`);
      this.logger.log('Housekeeping: pruned MRMS cache >7d');
    } catch (e: any) {
      this.logger.debug('Housekeeping noop: ' + e.message);
    }
  }

  // ================================================================
  // 06:00 — Huntsville permits scrape (competitor intel)
  // ================================================================
  @Cron('0 6 * * *')
  async dailyPermitsScrape() {
    if (!this.shouldRun()) return;
    await this.runScript('harvest-huntsville-permits.js', 'permits:huntsville');
  }

  // ================================================================
  // Sun 02:00 — Ownership weekly refresh (all counties)
  // ================================================================
  @Cron('0 2 * * 0')
  async weeklyOwnershipRefresh() {
    if (!this.shouldRun()) return;
    await this.runScript('harvest-limestone-morgan.js', 'ownership:limestone-morgan');
    // Others run if present (idempotent harvesters only UPDATE existing rows)
    await this.runScript('harvest-marshall-jackson.js', 'ownership:marshall-jackson');
  }

  // ================================================================
  // 1st of month 04:00 — OSM POI refresh
  // ================================================================
  @Cron('0 4 1 * *')
  async monthlyOsmRefresh() {
    if (!this.shouldRun()) return;
    await this.runScript('harvest-osm-overpass.js', 'osm:monthly', 2 * 60 * 60 * 1000);
  }

  // ================================================================
  // 1st of Jan/Apr/Jul/Oct 04:00 — FEMA quarterly refresh
  // ================================================================
  @Cron('0 4 1 1,4,7,10 *')
  async quarterlyFemaRefresh() {
    if (!this.shouldRun()) return;
    await this.runScript('harvest-fema-flood.js', 'fema:quarterly', 2 * 60 * 60 * 1000);
  }

  // ================================================================
  // 1st of Jul 04:00 — annual ACS refresh (Census updates yearly in July)
  // ================================================================
  @Cron('0 4 1 7 *')
  async annualCensusRefresh() {
    if (!this.shouldRun()) return;
    await this.runScript('harvest-census-acs.js', 'acs:annual', 2 * 60 * 60 * 1000);
  }
}
