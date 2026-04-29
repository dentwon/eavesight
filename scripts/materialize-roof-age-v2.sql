-- =====================================================================
-- materialize-roof-age-v2.sql  (2026-04-29)
--
-- Wraps compute-roof-age-v2.sql output as a regular table (not a
-- materialized view, because we want concurrent updates from the loaders
-- without having to REFRESH MATERIALIZED VIEW on every INSERT).
--
-- Schema:
--   roof_age_v2 (
--     property_id text PRIMARY KEY,
--     best_estimate_year int,
--     best_estimate_kind text,                 -- 'replacement' or 'first_install'
--     posterior_confidence numeric(4,2),
--     evidence_class text,
--     evidence_count int,
--     replacement_signals int,
--     firstinstall_signals int,
--     evidence_jsonb jsonb,                    -- audit trail
--     computed_at timestamptz NOT NULL DEFAULT NOW()
--   )
--
-- Run pattern: TRUNCATE + INSERT atomically per refresh. Idempotent.
--
-- Usage:
--   psql ... -f scripts/materialize-roof-age-v2.sql
-- =====================================================================

\timing on

CREATE TABLE IF NOT EXISTS roof_age_v2 (
  property_id          text PRIMARY KEY,
  best_estimate_year   int,
  best_estimate_kind   text,
  posterior_confidence numeric(4,2),
  evidence_class       text,
  evidence_count       int,
  replacement_signals  int,
  firstinstall_signals int,
  evidence            jsonb,
  computed_at         timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS roof_age_v2_class_idx ON roof_age_v2 (evidence_class);
CREATE INDEX IF NOT EXISTS roof_age_v2_confidence_idx ON roof_age_v2 (posterior_confidence DESC);
CREATE INDEX IF NOT EXISTS roof_age_v2_year_idx ON roof_age_v2 (best_estimate_year);

BEGIN;
TRUNCATE roof_age_v2;

WITH permit_events AS (
  SELECT s."propertyId" AS property_id, EXTRACT(YEAR FROM s."signalDate")::int AS event_year,
    'replacement' AS kind, 0.95::float AS weight,
    s.source AS evidence_source, s."sourceRecordId" AS evidence_record
  FROM property_signals s
  JOIN properties p ON p.id = s."propertyId"
  WHERE s."signalType" = 'reroof_permit'
    AND s."signalDate" IS NOT NULL AND p."yearBuilt" IS NOT NULL
    AND NOT (EXTRACT(YEAR FROM s."signalDate")::int BETWEEN p."yearBuilt"-1 AND p."yearBuilt"+2)
),
storm_events_e AS (
  SELECT "propertyId" AS property_id, EXTRACT(YEAR FROM "signalDate")::int AS event_year,
    'replacement' AS kind, confidence::float AS weight,
    source AS evidence_source, "sourceRecordId" AS evidence_record
  FROM property_signals WHERE "signalType" = 'implied_replacement_post_storm'
),
mls_events AS (
  SELECT "propertyId" AS property_id,
    COALESCE(EXTRACT(YEAR FROM "signalDate")::int, EXTRACT(YEAR FROM "observedAt")::int) AS event_year,
    'replacement' AS kind, confidence::float AS weight,
    source AS evidence_source, "sourceRecordId" AS evidence_record
  FROM property_signals
  WHERE "signalType" IN ('mls_roof_year','mls_roof_mention','mls_roof_material')
),
direct_replacement AS (
  SELECT id AS property_id, EXTRACT(YEAR FROM "roofInstalledAt")::int AS event_year,
    'replacement' AS kind, 0.85::float AS weight,
    'installed-direct:permit-post-hail' AS evidence_source, NULL::text AS evidence_record
  FROM properties
  WHERE "roofInstalledAt" IS NOT NULL AND "roofInstalledSource" = 'permit-post-hail'
),
direct_firstroof AS (
  SELECT id AS property_id, EXTRACT(YEAR FROM "roofInstalledAt")::int AS event_year,
    'first_install' AS kind, 0.85::float AS weight,
    'installed-direct:' || "roofInstalledSource" AS evidence_source, NULL::text AS evidence_record
  FROM properties
  WHERE "roofInstalledAt" IS NOT NULL
    AND "roofInstalledSource" IN ('coc-new-construction', 'huntsville-newconstruction')
),
prithvi_events_e AS (
  SELECT "propertyId" AS property_id, EXTRACT(YEAR FROM "signalDate")::int AS event_year,
    'replacement' AS kind, COALESCE(confidence::float, 0.40) AS weight,
    source AS evidence_source, "sourceRecordId" AS evidence_record
  FROM property_signals
  WHERE "signalType" = 'roof_age_imagery' AND source = 'prithvi.travis-v1' AND "signalDate" IS NOT NULL
),
yearbuilt_e AS (
  SELECT id AS property_id, "yearBuilt" AS event_year, 'first_install' AS kind,
    CASE WHEN "yearBuiltConfidence" IN ('VERIFIED','ENRICHED') THEN 0.30::float
         WHEN "yearBuiltConfidence" IN ('DEED_FLOOR','SUBDIV_PLAT') THEN 0.20::float
         ELSE 0.10::float END AS weight,
    'yearBuilt:' || COALESCE("yearBuiltSource", 'unknown') AS evidence_source,
    NULL::text AS evidence_record
  FROM properties WHERE "yearBuilt" > 1900
),
ms_v2_e AS (
  SELECT "propertyId" AS property_id, EXTRACT(YEAR FROM capture_dates_range_end)::int AS event_year,
    'first_install' AS kind, 0.20::float AS weight,
    'building_footprints.ms_v2:release' || COALESCE(release::text,'unk') AS evidence_source,
    NULL::text AS evidence_record
  FROM building_footprints WHERE capture_dates_range_end IS NOT NULL
),
osm_e AS (
  SELECT "propertyId" AS property_id, EXTRACT(YEAR FROM "signalDate")::int AS event_year,
    'first_install' AS kind, COALESCE(confidence::float, 0.50) AS weight,
    source AS evidence_source, "sourceRecordId" AS evidence_record
  FROM property_signals WHERE "signalType" = 'osm_start_date' AND "signalDate" IS NOT NULL
),
all_events AS (
  SELECT * FROM permit_events
  UNION ALL SELECT * FROM storm_events_e
  UNION ALL SELECT * FROM mls_events
  UNION ALL SELECT * FROM direct_replacement
  UNION ALL SELECT * FROM direct_firstroof
  UNION ALL SELECT * FROM prithvi_events_e
  UNION ALL SELECT * FROM yearbuilt_e
  UNION ALL SELECT * FROM ms_v2_e
  UNION ALL SELECT * FROM osm_e
),
chosen AS (
  SELECT DISTINCT ON (property_id)
    property_id, event_year, kind, weight, evidence_source, evidence_record
  FROM all_events
  ORDER BY property_id,
    (CASE WHEN kind='replacement' AND weight >= 0.50 THEN 0 ELSE 1 END),
    event_year DESC, weight DESC
),
evidence_agg AS (
  SELECT property_id,
    jsonb_agg(jsonb_build_object(
      'kind', kind, 'year', event_year,
      'weight', round(weight::numeric, 3),
      'source', evidence_source, 'record', evidence_record
    ) ORDER BY weight DESC, event_year DESC) AS evidence_jsonb,
    COUNT(*) AS evidence_count,
    SUM(CASE WHEN kind='replacement' AND weight >= 0.50 THEN 1 ELSE 0 END) AS replacement_signals,
    SUM(CASE WHEN kind='first_install' THEN 1 ELSE 0 END) AS firstinstall_signals
  FROM all_events GROUP BY property_id
)
INSERT INTO roof_age_v2
  (property_id, best_estimate_year, best_estimate_kind, posterior_confidence,
   evidence_class, evidence_count, replacement_signals, firstinstall_signals, evidence)
SELECT
  c.property_id,
  c.event_year,
  c.kind,
  c.weight::numeric(4,2),
  CASE
    WHEN c.kind='replacement' AND c.weight >= 0.85 THEN 'VERIFIED_REPLACEMENT'
    WHEN c.kind='replacement' AND c.weight >= 0.65 THEN 'STRONG_REPLACEMENT'
    WHEN c.kind='replacement' AND c.weight >= 0.50 THEN 'IMPUTED_REPLACEMENT'
    WHEN c.kind='replacement' AND c.weight >= 0.40 THEN 'WEAK_REPLACEMENT'
    WHEN c.kind='first_install' AND c.weight >= 0.30 THEN 'VERIFIED_FIRSTROOF'
    WHEN c.kind='first_install' THEN 'IMPUTED_FIRSTROOF'
    ELSE 'NONE'
  END,
  ea.evidence_count,
  ea.replacement_signals,
  ea.firstinstall_signals,
  ea.evidence_jsonb
FROM chosen c
LEFT JOIN evidence_agg ea USING (property_id);

COMMIT;

-- Diagnostics
SELECT evidence_class, COUNT(*) AS properties,
       MIN(best_estimate_year) AS yr_min, MAX(best_estimate_year) AS yr_max,
       ROUND(AVG(best_estimate_year)::numeric, 0) AS yr_avg,
       MIN(posterior_confidence) AS conf_min, MAX(posterior_confidence) AS conf_max
FROM roof_age_v2
GROUP BY 1 ORDER BY 1;
