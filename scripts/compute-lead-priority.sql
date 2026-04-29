-- =====================================================================
-- compute-lead-priority.sql  (2026-04-29)
--
-- Materializes a `lead_priority` table per property combining the user's
-- three sharpening filters:
--
--   1. Asphalt only (filter out known metal/clay — most leads anyway because
--      ~85% of N-AL residential is asphalt; we just exclude what we KNOW is
--      metal/clay from MLS / OSM)
--   2. Roof age 15+ years (15-25 = prime; 26-35 = aged; 36+ = very-old)
--   3. Insurance claim window — properties hit by a qualifying storm in the
--      last 24 months whose insurance-window deadline is approaching are
--      ULTRA-HIGH-priority leads (the homeowner is about to lose their
--      insurance-paid replacement option)
--
-- Output schema (table `lead_priority`):
--   property_id              text PK
--   roof_age_years           int     (current_year - best_estimate_year)
--   roof_kind                text    ('first_install' | 'replacement')
--   has_replacement_evidence bool
--   is_metal_or_clay         bool    (skip if true)
--   recent_storm_date        date    (most recent qualifying storm in last 24mo)
--   storm_days_since         int
--   insurance_days_remaining int     (730 - storm_days_since)
--   urgency_tier             text    ('1_ON_FIRE','2_URGENT','3_PRIME','4_EARLY','5_FRESH','6_NONE')
--   age_tier                 text    ('A_TOO_YOUNG','B_PRIME_15_25','C_AGED_26_35','D_VERY_OLD_36PLUS','U_UNKNOWN')
--   priority_rank            int     1=highest priority (PRIORITY_1_BURNING) … 6=NOT_LEAD
--   priority_label           text    ('PRIORITY_1_BURNING'..'NOT_LEAD')
--
-- Run pattern: TRUNCATE + INSERT atomic. Re-run after every roof-signal load.
--
-- Indexes:
--   priority_rank ASC                — fast top-N for dashboard
--   urgency_tier, priority_rank      — filter by tier
--   property_id PK
-- =====================================================================

\timing on

CREATE TABLE IF NOT EXISTS lead_priority (
  property_id              text PRIMARY KEY,
  roof_age_years           int,
  roof_kind                text,
  has_replacement_evidence boolean,
  is_metal_or_clay         boolean,
  recent_storm_date        date,
  storm_days_since         int,
  insurance_days_remaining int,
  urgency_tier             text,
  age_tier                 text,
  priority_rank            int,
  priority_label           text,
  computed_at              timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_priority_rank_idx ON lead_priority (priority_rank);
CREATE INDEX IF NOT EXISTS lead_priority_urgency_idx ON lead_priority (urgency_tier, priority_rank);
CREATE INDEX IF NOT EXISTS lead_priority_age_idx ON lead_priority (age_tier, priority_rank);

BEGIN;
TRUNCATE lead_priority;

WITH
  has_replacement AS (
    SELECT DISTINCT "propertyId" AS property_id FROM property_signals
    WHERE "signalType" IN ('reroof_permit','contractor_job','mls_roof_year')
  ),
  metal_clay AS (
    SELECT DISTINCT "propertyId" AS property_id FROM property_signals
    WHERE "signalType" = 'mls_roof_material'
  ),
  most_recent_qualifying_storm AS (
    SELECT
      ps."propertyId" AS property_id,
      MAX(se.date) AS storm_date
    FROM property_storms ps
    JOIN storm_events se ON se.id = ps."stormEventId"
    WHERE se.date > NOW() - INTERVAL '24 months'
      AND ((se.type='HAIL'    AND se."hailSizeInches" >= 1.0)
        OR (se.type='WIND'    AND se."windSpeedMph"   >= 70)
        OR (se.type='TORNADO' AND se."tornadoFScale" IN ('EF1','EF2','EF3','EF4','EF5')))
    GROUP BY ps."propertyId"
  ),
  base AS (
    -- IMPORTANT: roof_age_years = (current_year - yearBuilt) — assume the
    -- ORIGINAL roof is still on the building unless we have HARD evidence
    -- of a replacement (permit / contractor-gallery / MLS-explicit-year).
    -- Storm-implied "post-storm replacement" signals are NOT counted as
    -- evidence here because most homeowners DON'T file claims after hail
    -- (claim-filing rate is ~30-50%). Storm hits make a property ELIGIBLE
    -- for replacement, not proof one happened.
    SELECT
      p.id AS property_id,
      p."yearBuilt",
      EXTRACT(YEAR FROM NOW())::int - p."yearBuilt" AS roof_age_years,
      'first_install_yearbuilt' AS best_estimate_kind,
      h.property_id IS NOT NULL AS has_replacement_evidence,
      m.property_id IS NOT NULL AS is_metal_or_clay,
      s.storm_date AS recent_storm_date,
      EXTRACT(DAY FROM NOW() - s.storm_date)::int AS storm_days_since
    FROM properties p
    LEFT JOIN has_replacement h     ON h.property_id  = p.id
    LEFT JOIN metal_clay m          ON m.property_id  = p.id
    LEFT JOIN most_recent_qualifying_storm s ON s.property_id = p.id
    WHERE p."yearBuilt" IS NOT NULL AND p."yearBuilt" >= 1900
  ),
  scored AS (
    SELECT *,
      CASE
        WHEN storm_days_since IS NULL                            THEN '6_NONE'
        WHEN 730 - storm_days_since < 30                         THEN '1_ON_FIRE'
        WHEN 730 - storm_days_since < 90                         THEN '2_URGENT'
        WHEN 730 - storm_days_since < 365                        THEN '3_PRIME'
        WHEN 730 - storm_days_since < 730                        THEN '4_EARLY'
        ELSE '5_FRESH'
      END AS urgency_tier,
      CASE
        WHEN roof_age_years IS NULL                              THEN 'U_UNKNOWN'
        WHEN roof_age_years < 15                                 THEN 'A_TOO_YOUNG'
        WHEN roof_age_years BETWEEN 15 AND 25                    THEN 'B_PRIME_15_25'
        WHEN roof_age_years BETWEEN 26 AND 35                    THEN 'C_AGED_26_35'
        ELSE                                                          'D_VERY_OLD_36PLUS'
      END AS age_tier,
      730 - storm_days_since AS insurance_days_remaining
    FROM base
  )
INSERT INTO lead_priority
  (property_id, roof_age_years, roof_kind, has_replacement_evidence,
   is_metal_or_clay, recent_storm_date, storm_days_since, insurance_days_remaining,
   urgency_tier, age_tier, priority_rank, priority_label)
SELECT
  property_id,
  roof_age_years,
  best_estimate_kind,
  has_replacement_evidence,
  is_metal_or_clay,
  recent_storm_date,
  storm_days_since,
  insurance_days_remaining,
  urgency_tier,
  age_tier,
  -- Priority logic — lower rank = higher priority
  CASE
    WHEN is_metal_or_clay                                                  THEN 99  -- skip
    WHEN has_replacement_evidence                                          THEN 90  -- already replaced; not a lead
    WHEN urgency_tier='1_ON_FIRE' AND age_tier='B_PRIME_15_25'             THEN 1   -- BURNING: prime asphalt + 9 days left
    WHEN urgency_tier='1_ON_FIRE' AND age_tier IN ('C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 2   -- BURNING: aged + insurance about to total
    WHEN urgency_tier='2_URGENT'  AND age_tier IN ('B_PRIME_15_25','C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 3   -- HOT: 30-90 days
    WHEN urgency_tier='3_PRIME'   AND age_tier IN ('B_PRIME_15_25','C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 4   -- LIVE: 90-365 days
    WHEN urgency_tier='6_NONE'    AND age_tier IN ('C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 5   -- AGED, no recent storm: cash-sale candidate
    WHEN urgency_tier='6_NONE'    AND age_tier='B_PRIME_15_25'             THEN 6   -- PRIME-AGED, no storm: medium pipeline
    WHEN urgency_tier IN ('4_EARLY','5_FRESH')                             THEN 7   -- recent storm but not urgent yet
    WHEN age_tier='A_TOO_YOUNG'                                            THEN 8   -- too young
    ELSE 9
  END AS priority_rank,
  CASE
    WHEN is_metal_or_clay                                                  THEN 'SKIP_METAL_CLAY'
    WHEN has_replacement_evidence                                          THEN 'NOT_LEAD_ALREADY_REPLACED'
    WHEN urgency_tier='1_ON_FIRE' AND age_tier='B_PRIME_15_25'             THEN 'PRIORITY_1_BURNING_PRIME'
    WHEN urgency_tier='1_ON_FIRE' AND age_tier IN ('C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 'PRIORITY_2_BURNING_AGED'
    WHEN urgency_tier='2_URGENT'  AND age_tier IN ('B_PRIME_15_25','C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 'PRIORITY_3_URGENT_OLD'
    WHEN urgency_tier='3_PRIME'   AND age_tier IN ('B_PRIME_15_25','C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 'PRIORITY_4_LIVE_OLD'
    WHEN urgency_tier='6_NONE'    AND age_tier IN ('C_AGED_26_35','D_VERY_OLD_36PLUS') THEN 'PRIORITY_5_AGED_NO_STORM'
    WHEN urgency_tier='6_NONE'    AND age_tier='B_PRIME_15_25'             THEN 'PRIORITY_6_PRIME_AGED_NO_STORM'
    WHEN urgency_tier IN ('4_EARLY','5_FRESH')                             THEN 'PIPELINE_FRESH_STORM'
    WHEN age_tier='A_TOO_YOUNG'                                            THEN 'TOO_YOUNG'
    ELSE 'UNKNOWN'
  END AS priority_label
FROM scored;

COMMIT;

-- Diagnostics
SELECT priority_label, COUNT(*) AS n,
       MIN(roof_age_years) AS roof_age_min, MAX(roof_age_years) AS roof_age_max,
       MIN(insurance_days_remaining) AS days_min, MAX(insurance_days_remaining) AS days_max
FROM lead_priority GROUP BY 1 ORDER BY 1;
