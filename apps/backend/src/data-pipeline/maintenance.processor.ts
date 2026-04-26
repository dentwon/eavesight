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
  private readonly scriptDir = process.env.MAINT_SCRIPT_DIR || '/home/dentwon/Eavesight/scripts';

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
          -- Phase 3.7a: roof age contribution comes ONLY from an anchor.
          -- No anchor (or anchor >35yr stale) -> 0 contribution. The old
          -- mod-22 guess is gone. Anchor coverage is rebuilt by 3.7b-e.
          (CASE
             WHEN p."roofInstalledAt" IS NOT NULL
                  AND (2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int) > 35
               THEN 0
             WHEN p."roofInstalledAt" IS NOT NULL
               THEN GREATEST(0, 2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int)
             ELSE 0
           END) * 1.5 +
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
      this.logger.log('Legacy composite scores updated.');

      // Unified score + dormant/claim-window + reasons
      await this.computeUnifiedScore();
      this.logger.log('Unified score / dormant flag / claim window updated.');

      // Per-metro tile + pin-card rebuild (scale-ready pipeline)
      await this.rebuildPerMetroAggregates();
      this.logger.log('Per-metro hex aggregates + pin cards rebuilt.');
    } catch (e: any) {
      this.logger.error(`Score recompute failed: ${e.message}`);
    }
  }

  /**
   * Rebuilds property_hex_aggregates + property_pin_cards per active metro.
   * Uses raw SQL so the same logic runs whether triggered by the cron,
   * a manual psql run, or an admin action. Adding a metro row to the
   * "metros" table is the only thing required to include a new market.
   */
  private async rebuildPerMetroAggregates() {
    const metros = await this.prisma.$queryRawUnsafe<Array<{ code: string }>>(
      `SELECT code FROM metros WHERE status = 'active'`,
    );
    for (const { code } of metros) {
      try {
        await this.prisma.$executeRawUnsafe(
          `DELETE FROM property_hex_aggregates WHERE "metroCode" = '${code}'`,
        );
        await this.prisma.$executeRawUnsafe(this.hexAggregatesSql(code));

        await this.prisma.$executeRawUnsafe(
          `DELETE FROM property_pin_cards WHERE "metroCode" = '${code}'`,
        );
        await this.prisma.$executeRawUnsafe(this.pinCardsSql(code));

        this.logger.log(`[metro:${code}] hex + pin-card rebuild complete`);
      } catch (e: any) {
        this.logger.error(`[metro:${code}] rebuild failed: ${e.message}`);
      }
    }
  }

  private hexAggregatesSql(metro: string): string {
    return `
      INSERT INTO property_hex_aggregates (
        id, "metroCode", resolution, "h3Cell", n,
        "scoreP50", "scoreP90", "scoreMax",
        "dormantCount", "hailMaxInches", "avgRoofAge",
        "centerLat", "centerLon"
      )
      SELECT
        'hex_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22),
        '${metro}', res, cell, COUNT(*)::int,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "score") FILTER (WHERE "score" IS NOT NULL),
        percentile_cont(0.9) WITHIN GROUP (ORDER BY "score") FILTER (WHERE "score" IS NOT NULL),
        MAX("score"),
        COUNT(*) FILTER (WHERE "dormantFlag" = TRUE)::int,
        MAX("hailExposureIndex"),
        -- Canonical roof age per row (Phase 3.7a: anchor-only, else NULL).
        -- AVG ignores NULLs so hex cells with many unknowns still produce a
        -- reasonable average over the knowable subset. Coverage per cell is
        -- exposed separately via the n count.
        AVG(canonical_roof_age),
        AVG(lat), AVG(lon)
      FROM (
        SELECT 6 AS res, "h3r6" AS cell, lat, lon, "score",
               "dormantFlag", "hailExposureIndex", "yearBuilt",
               CASE
                 WHEN "roofInstalledAt" IS NOT NULL
                      AND (2026 - EXTRACT(YEAR FROM "roofInstalledAt")::int) > 35 THEN NULL
                 WHEN "roofInstalledAt" IS NOT NULL
                   THEN GREATEST(0, 2026 - EXTRACT(YEAR FROM "roofInstalledAt")::int)
                 ELSE NULL
               END AS canonical_roof_age
        FROM properties
        WHERE "metroCode" = '${metro}' AND "h3r6" IS NOT NULL
        UNION ALL
        SELECT 8, "h3r8", lat, lon, "score",
               "dormantFlag", "hailExposureIndex", "yearBuilt",
               CASE
                 WHEN "roofInstalledAt" IS NOT NULL
                      AND (2026 - EXTRACT(YEAR FROM "roofInstalledAt")::int) > 35 THEN NULL
                 WHEN "roofInstalledAt" IS NOT NULL
                   THEN GREATEST(0, 2026 - EXTRACT(YEAR FROM "roofInstalledAt")::int)
                 ELSE NULL
               END AS canonical_roof_age
        FROM properties
        WHERE "metroCode" = '${metro}' AND "h3r8" IS NOT NULL
      ) u
      GROUP BY res, cell;
    `;
  }

  private pinCardsSql(metro: string): string {
    // v3 (2026-04-24): adds SPC permissive rollup, ownerHistory-derived
    // probate/transfer/investor flags, and the rich scoreReasons object
    // produced by compute-scores-v3.sh. Keeps the canonical roof-age ladder
    // (anchor-only — no mod-22 inference).
    //
    // Roof-age ladder:
    //   anchor (CoC/permit) > 35yr  -> null age, source = 'unknown' (stale)
    //   anchor, source LIKE 'coc-%' -> age = 2026 - year, source = 'coc'
    //   anchor (any other source)   -> age = 2026 - year, source = 'permit'
    //   no anchor                   -> null age, source = 'unknown'
    //
    // Owner-history triggers:
    //   probate    — ESTATE OF / HEIRS OF / TRUST / TRUSTEE / DECEASED in
    //                ownerFullName or latest ownerHistory row.
    //   recent_xfer— last distinct owner change within 24 months.
    //   investor   — 3+ distinct owners in last 5 years.
    //   tenure_yrs — years since last distinct owner change (or null).
    return `
      WITH ages AS (
        SELECT
          p.id,
          CASE
            WHEN p."roofInstalledAt" IS NOT NULL
                 AND (2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int) > 35
              THEN NULL
            WHEN p."roofInstalledAt" IS NOT NULL
              THEN GREATEST(0, 2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int)
            ELSE NULL
          END AS roof_age,
          CASE
            WHEN p."roofInstalledAt" IS NOT NULL
                 AND (2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int) > 35 THEN 'unknown'
            WHEN p."roofInstalledAt" IS NOT NULL
                 AND p."roofInstalledSource" LIKE 'coc-%' THEN 'coc'
            WHEN p."roofInstalledAt" IS NOT NULL THEN 'permit'
            ELSE 'unknown'
          END AS roof_age_source
        FROM properties p
        WHERE p."metroCode" = '${metro}'
      ),
      oh AS (
        SELECT
          p.id,
          (SELECT upper(e->>'owner')
             FROM jsonb_array_elements(COALESCE(p."ownerHistory",'[]'::jsonb)) e
             ORDER BY (e->>'year')::int DESC
             LIMIT 1) AS latest_owner,
          (WITH ordered AS (
              SELECT upper(e->>'owner') o, (e->>'year')::int y
              FROM jsonb_array_elements(COALESCE(p."ownerHistory",'[]'::jsonb)) e
           ), ranked AS (
              SELECT o, y, LAG(o) OVER (ORDER BY y DESC) prev_o FROM ordered
           )
           SELECT MIN(y) FROM ranked WHERE prev_o IS NOT NULL AND prev_o <> o) AS last_xfer_year,
          (SELECT COUNT(DISTINCT upper(e->>'owner'))
             FROM jsonb_array_elements(COALESCE(p."ownerHistory",'[]'::jsonb)) e
             WHERE (e->>'year')::int >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 5) AS distinct_owners_5y
        FROM properties p
        WHERE p."metroCode" = '${metro}'
      ),
      trig AS (
        SELECT
          oh.id,
          oh.last_xfer_year,
          oh.distinct_owners_5y,
          (
            COALESCE((SELECT "ownerFullName" FROM properties WHERE id = oh.id), '')
              ~* '(ESTATE\\s+OF|HEIRS\\s+OF|LIVING\\s+TRUST|REVOCABLE\\s+TRUST|FAMILY\\s+TRUST|TRUSTEE|DECEASED)'
            OR COALESCE(oh.latest_owner,'')
              ~ '(ESTATE\\s+OF|HEIRS\\s+OF|LIVING\\s+TRUST|REVOCABLE\\s+TRUST|FAMILY\\s+TRUST|TRUSTEE|DECEASED)'
          ) AS probate,
          (oh.last_xfer_year IS NOT NULL
           AND oh.last_xfer_year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 2) AS recent_xfer,
          (oh.distinct_owners_5y >= 3) AS investor,
          CASE WHEN oh.last_xfer_year IS NOT NULL
               THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - oh.last_xfer_year END AS tenure_yrs
        FROM oh
      ),
      recent_storms AS (
        SELECT
          ps."propertyId",
          jsonb_agg(jsonb_build_object(
            'type', se.type, 'date', se.date,
            'hailSizeInches', se."hailSizeInches",
            'windSpeedMph',   se."windSpeedMph",
            'damageLevel',    ps."damageLevel",
            'distanceMeters', ps."distanceMeters"
          ) ORDER BY se.date DESC) FILTER (WHERE rn <= 5) AS storms
        FROM (
          SELECT ps."propertyId", ps."damageLevel", ps."distanceMeters",
                 se.id se_id,
                 ROW_NUMBER() OVER (PARTITION BY ps."propertyId" ORDER BY se.date DESC) AS rn
          FROM property_storms ps
          JOIN storm_events    se ON se.id = ps."stormEventId"
          WHERE se.date > NOW() - INTERVAL '24 months'
            AND ps."propertyId" IN (SELECT id FROM properties WHERE "metroCode" = '${metro}')
        ) ps
        JOIN storm_events se ON se.id = ps.se_id
        GROUP BY ps."propertyId"
      )
      INSERT INTO property_pin_cards (
        "propertyId", "metroCode", "payloadFree", "payloadPro",
        "score", "dormantFlag", "roofAgeSource", "updatedAt"
      )
      SELECT
        p.id, p."metroCode",

        -- ============ FREE TIER ============
        jsonb_build_object(
          'id', p.id, 'lat', p.lat, 'lon', p.lon,
          'address', CASE WHEN p.address LIKE 'ms-%' THEN NULL ELSE p.address END,
          'city', p.city, 'state', p.state, 'zip', p.zip,
          'score', ROUND(p."score"::numeric, 0),
          'scoreBucket', CASE WHEN p."score" >= 80 THEN 'hot'
                              WHEN p."score" >= 60 THEN 'warm'
                              WHEN p."score" >= 40 THEN 'cool'
                              ELSE 'cold' END,
          'dormantFlag', p."dormantFlag",
          'roofAge', a.roof_age,
          'roofAgeSource', a.roof_age_source,
          'yearBuilt', p."yearBuilt",
          'yearBuiltConfidence', p."yearBuiltConfidence",
          'yearBuiltIsReal', (p."yearBuiltSource" LIKE 'madison-assessor-scrape%'
                              OR p."yearBuiltSource" = 'huntsville-coc-new-construction'),
          'hailExposureIndex',   p."hailExposureIndex",
          'hailEventCount',      p."hailEventCount",
          'spcHailCount',        COALESCE(p."spcHailCount", 0),
          'spcHailCount5y',      COALESCE(p."spcHailCount5y", 0),
          'spcHailMaxInches',    p."spcHailMaxInches",
          'spcHailLastDate',     p."spcHailLastDate",
          'spcTornadoCount',     COALESCE(p."spcTornadoCount", 0),
          'spcTornadoLastDate',  p."spcTornadoLastDate",
          'spcSevereOrExtremeCount', COALESCE(p."spcSevereOrExtremeCount", 0),
          'hasProbateTrigger',   COALESCE(t.probate, false),
          'hasRecentTransfer',   COALESCE(t.recent_xfer, false),
          'hasInvestorFlip',     COALESCE(t.investor, false),
          'topReasons',          COALESCE(p."scoreReasons" -> 'bullets', '[]'::jsonb),
          'tier',                'free'
        ),

        -- ============ PRO TIER ============
        -- Split into 3 jsonb_build_object calls because PG caps it at 100 args (50 K-V).
        (
          jsonb_build_object(
            'id', p.id, 'lat', p.lat, 'lon', p.lon,
            'address', p.address, 'city', p.city, 'state', p.state, 'zip', p.zip,
            'score', ROUND(p."score"::numeric, 1),
            'scoreBucket', CASE WHEN p."score" >= 80 THEN 'hot'
                                WHEN p."score" >= 60 THEN 'warm'
                                WHEN p."score" >= 40 THEN 'cool'
                                ELSE 'cold' END,
            'dormantFlag', p."dormantFlag",
            'claimWindowEndsAt', p."claimWindowEndsAt",
            'ownerFullName', p."ownerFullName", 'ownerPhone', p."ownerPhone",
            'ownerEmail', p."ownerEmail", 'ownerOccupied', p."ownerOccupied",
            'ownerSinceYear', p."ownerSinceYear",
            'onDncList', p."onDncList", 'phoneVerified', p."phoneVerified",
            'tier', 'pro'
          )
          ||
          jsonb_build_object(
            'marketValue', p."marketValue", 'assessedValue', p."assessedValue",
            'lastSaleDate', p."lastSaleDate", 'lastSalePrice', p."lastSalePrice",
            'roofAreaSqft', p."roofAreaSqft", 'roofSizeClass', p."roofSizeClass",
            'roofMaterial', p."roofMaterial", 'roofType', p."roofType",
            'roofAgeYears', p."roofAgeYears",
            'roofAgeClass', p."roofAgeClass",
            'roofAgeConfidence', p."roofAgeConfidence",
            'roofInstalledAt', p."roofInstalledAt",
            'roofInstalledSource', p."roofInstalledSource",
            'yearBuilt', p."yearBuilt",
            'yearBuiltConfidence', p."yearBuiltConfidence",
            'yearBuiltSource', p."yearBuiltSource",
            'roofAge', a.roof_age,
            'roofAgeSource', a.roof_age_source,
            'hailExposureIndex', p."hailExposureIndex",
            'hailEventCount', p."hailEventCount"
          )
          ||
          jsonb_build_object(
            'spcHailCount',     COALESCE(p."spcHailCount", 0),
            'spcHailCount5y',   COALESCE(p."spcHailCount5y", 0),
            'spcHailMaxInches', p."spcHailMaxInches",
            'spcHailLastDate',  p."spcHailLastDate",
            'spcWindCount',     COALESCE(p."spcWindCount", 0),
            'spcWindCount5y',   COALESCE(p."spcWindCount5y", 0),
            'spcWindLastDate',  p."spcWindLastDate",
            'spcTornadoCount',  COALESCE(p."spcTornadoCount", 0),
            'spcTornadoLastDate', p."spcTornadoLastDate",
            'spcSevereOrExtremeCount', COALESCE(p."spcSevereOrExtremeCount", 0),
            'probateTrigger',  COALESCE(t.probate, false),
            'recentTransfer',  COALESCE(t.recent_xfer, false),
            'investorFlip',    COALESCE(t.investor, false),
            'tenureYears',     t.tenure_yrs,
            'ownerHistory',    COALESCE(p."ownerHistory", '[]'::jsonb),
            'scoreReasons',    COALESCE(p."scoreReasons", '{}'::jsonb),
            'recentStorms',    COALESCE(rs.storms, '[]'::jsonb)
          )
        ),
        p."score", p."dormantFlag", a.roof_age_source, NOW()
      FROM properties p
      JOIN ages a ON a.id = p.id
      LEFT JOIN trig t ON t.id = p.id
      LEFT JOIN recent_storms rs ON rs."propertyId" = p.id
      WHERE p."metroCode" = '${metro}';
    `;
  }

  /**
   * Unified score collapse. Populates:
   *   score             — 0-100 composite of 4 sub-scores (storm/age/econ/action)
   *   scoreReasons      — up to 3 human tokens rendered in the UI lead card
   *   dormantFlag       — hail>=0.75" in past 24mo, roof>=15yr, no re-roof permit
   *   claimWindowEndsAt — AL only: storm + 24mo (state insurance window)
   *
   * Kept as raw SQL (not Prisma ORM) for speed: 243k rows, single pass over
   * pre-aggregated CTE. Runs inside nightly cron so the UI can sort by `score`
   * with a single index seek.
   */
  private async computeUnifiedScore() {
    await this.prisma.$executeRawUnsafe(`
      WITH recent_hail AS (
        SELECT ps."propertyId",
               MAX(se.date)                                AS latest_hail_date,
               MAX(COALESCE(se."hailSizeInches", 0))       AS max_hail_in,
               COUNT(*)                                    AS hail_hits_24mo,
               BOOL_OR(COALESCE(ps."permitPulled", FALSE)) AS any_permit
        FROM property_storms ps
        JOIN storm_events    se ON se.id = ps."stormEventId"
        WHERE se.type = 'HAIL' AND se.date > NOW() - INTERVAL '24 months'
        GROUP BY ps."propertyId"
      ),
      recent_any AS (
        SELECT ps."propertyId",
               COUNT(*) FILTER (WHERE se.date > NOW() - INTERVAL '12 months') AS storms_12mo,
               MAX(ps."damageLevel")                                         AS worst_damage
        FROM property_storms ps
        JOIN storm_events    se ON se.id = ps."stormEventId"
        GROUP BY ps."propertyId"
      ),
      inputs AS (
        SELECT p.id, p.state,
               COALESCE(p."hailExposureIndex", 0) AS hei,
               -- Phase 3.7a: anchor-only. No anchor -> 0 age, 'unknown' source.
               -- The downstream confidence multiplier zeros out 'unknown' so
               -- missing-roof-age properties contribute nothing to the score.
               CASE
                 WHEN p."roofInstalledAt" IS NOT NULL
                      AND (2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int) > 35
                   THEN 0
                 WHEN p."roofInstalledAt" IS NOT NULL
                   THEN GREATEST(0, 2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int)
                 ELSE 0
               END AS roof_age,
               CASE
                 WHEN p."roofInstalledAt" IS NOT NULL
                      AND (2026 - EXTRACT(YEAR FROM p."roofInstalledAt")::int) > 35
                                                                  THEN 'unknown'
                 WHEN p."roofInstalledAt" IS NOT NULL
                      AND p."roofInstalledSource" LIKE 'coc-%'    THEN 'coc'
                 WHEN p."roofInstalledAt" IS NOT NULL             THEN 'permit'
                 ELSE 'unknown'
               END AS roof_age_source,
               p."marketValue", p."ownerOccupied", p."ownerPhone",
               p."onDncList", p."ownerEmail",
               rh.latest_hail_date, rh.max_hail_in, rh.any_permit,
               ra.storms_12mo, ra.worst_damage
        FROM properties p
        LEFT JOIN recent_hail rh ON rh."propertyId" = p.id
        LEFT JOIN recent_any  ra ON ra."propertyId" = p.id
      ),
      scored AS (
        SELECT id, state, latest_hail_date, max_hail_in, any_permit, roof_age, roof_age_source,
               "ownerOccupied", "marketValue",
               LEAST(40,
                 hei * 3
                 + COALESCE(storms_12mo, 0) * 2
                 + CASE worst_damage
                     WHEN 'DESTROYED' THEN 10 WHEN 'MAJOR' THEN 8
                     WHEN 'MODERATE'  THEN 5  WHEN 'MINOR' THEN 2
                     ELSE 0 END
               ) AS storm_score,
               -- Graduated confidence multiplier matches roofAgeConfidenceMultiplier()
               -- in roof-age.util.ts: measured=1.00 coc=0.95 permit=0.85 inferred=0.70.
               ROUND(
                 (CASE
                    WHEN roof_age >= 30 THEN 30 WHEN roof_age >= 20 THEN 24
                    WHEN roof_age >= 15 THEN 18 WHEN roof_age >= 10 THEN 10
                    WHEN roof_age >= 5  THEN 4  ELSE 0
                  END)
                 * CASE roof_age_source
                     WHEN 'coc'      THEN 0.95
                     WHEN 'permit'   THEN 0.85
                     WHEN 'inferred' THEN 0.70
                     WHEN 'unknown'  THEN 0.0
                     ELSE 1.0
                   END
               )::int AS age_score,
               (CASE WHEN "ownerOccupied" = TRUE THEN 6 ELSE 0 END
                + CASE WHEN "marketValue" IS NULL THEN 2
                       WHEN "marketValue" >= 500000 THEN 14
                       WHEN "marketValue" >= 300000 THEN 11
                       WHEN "marketValue" >= 200000 THEN 8
                       WHEN "marketValue" >= 100000 THEN 5
                       ELSE 2 END) AS econ_score,
               (CASE WHEN "ownerPhone" IS NOT NULL AND "ownerPhone" <> '' THEN 5 ELSE 0 END
                + CASE WHEN "onDncList" = TRUE THEN 0 ELSE 2 END
                + CASE WHEN "ownerEmail" IS NOT NULL AND "ownerEmail" <> '' THEN 3 ELSE 0 END) AS act_score
        FROM inputs
      )
      UPDATE properties p
      SET "score" = LEAST(100, (s.storm_score + s.age_score + s.econ_score + s.act_score)),
          "dormantFlag" = (
            COALESCE(s.max_hail_in, 0) >= 0.75
            AND s.latest_hail_date IS NOT NULL
            AND s.latest_hail_date < NOW() - INTERVAL '30 days'
            AND s.latest_hail_date > NOW() - INTERVAL '24 months'
            AND s.roof_age >= 15
            AND COALESCE(s.any_permit, FALSE) = FALSE
          ),
          "claimWindowEndsAt" = CASE
            WHEN s.state = 'AL' AND s.latest_hail_date IS NOT NULL
              THEN (s.latest_hail_date + INTERVAL '24 months')
            ELSE NULL
          END,
          "scoreReasons" = COALESCE((
            SELECT jsonb_agg(r) FROM (
              SELECT r FROM (VALUES
                (CASE WHEN s.max_hail_in >= 0.75 THEN
                   to_char(s.max_hail_in, 'FM0.0') || '" hail ' ||
                   to_char(s.latest_hail_date, 'Mon ''YY')
                 ELSE NULL END),
                (CASE WHEN s.roof_age >= 20 THEN
                        'Roof age: ' || s.roof_age || ' yrs' ||
                        CASE WHEN s.roof_age_source = 'inferred' THEN ' (est.)' ELSE '' END
                      WHEN s.roof_age >= 15 THEN
                        'Aging roof (' || s.roof_age || ' yrs' ||
                        CASE WHEN s.roof_age_source = 'inferred' THEN ' est.' ELSE '' END ||
                        ')'
                      ELSE NULL END),
                (CASE WHEN COALESCE(s.any_permit, FALSE) = FALSE AND s.max_hail_in >= 0.75
                      THEN 'No re-roof permit on file' ELSE NULL END),
                (CASE WHEN s."ownerOccupied" = TRUE THEN 'Owner-occupied'
                      WHEN s."ownerOccupied" = FALSE THEN 'Investor-owned'
                      ELSE NULL END),
                (CASE WHEN s."marketValue" >= 400000 THEN 'High-value home' ELSE NULL END)
              ) v(r) WHERE r IS NOT NULL LIMIT 3
            ) top
          ), '[]'::jsonb)
      FROM scored s
      WHERE p.id = s.id;
    `);
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
