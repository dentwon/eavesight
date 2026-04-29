-- =====================================================================
-- compute-roof-age-v2.sql  (2026-04-29)
--
-- Per-property roof-age blend across all available signals.
--
-- Why v2: v1 (`compute-scores-v3`) treats `properties.roofInstalledAt` as
-- ground truth and falls back to a `yearBuilt + 22yr cycle` heuristic
-- otherwise. As of 2026-04-28 we have multiple richer signals:
--
--   * `properties.roofInstalledAt` + `roofInstalledSource`
--     - 'permit-post-hail'        (519)  → real reroof (replacement)
--     - 'coc-new-construction'    (1660) → first-roof install (NOT reroof)
--     - 'huntsville-newconstruction' (332) → first-roof install (NOT reroof)
--     The new-construction sources should NOT be weighted as replacement
--     events — they're equivalent to yearBuilt for new builds.
--   * `property_signals.reroof_permit`
--     - source='permit.decatur'      (461)
--     - source='permit.madison-city' (~80–100)
--     - source='permit.madison-county' (~30–80)
--     A permit issued within yearBuilt ± 2yr is most likely a first-roof
--     install on a new build, NOT a replacement, and should be filtered
--     OUT of the reroof-event signal stream.
--   * `property_signals.roof_age_imagery` (Prithvi-EO-2.0-300M)
--     Confidence is the calibrated value (Platt + AUC tier cap) emitted
--     by `scripts/load-prithvi-signals.js`. Treat at face value.
--   * `building_footprints.capture_dates_range_end` (MS v2 backfill)
--     A "building existed by date X" anchor — useful as a yearBuilt sanity
--     bound and as a Prithvi prior (a roof can't be "new in 2022" if MS
--     captured the building in 2018 with whatever roof signature it had,
--     UNLESS Prithvi's predicted year is also after 2018; same direction).
--   * `property_signals.osm_start_date` (~300 landmarks, future)
--     Year-of-construction for tagged buildings. First-roof prior at 0.50.
--
-- Approach:
--   For each property, gather every "roof event" candidate from each source,
--   tagged with (event_year, weight, kind ∈ {first_install, replacement}).
--   Per-source weights are chosen to reflect ground-truth quality:
--     permit.decatur, permit.madison-* (reroof, not new-construction): 0.95
--     installed-direct permit-post-hail:                                0.85
--     installed-direct coc-new-construction (first-install only):       0.85
--     installed-direct huntsville-newconstruction (first-install):      0.85
--     prithvi roof_age_imagery:                                         signal.confidence
--     properties.yearBuilt VERIFIED:                                    0.30
--     properties.yearBuilt IMPUTED:                                     0.10
--     osm_start_date:                                                   0.50
--   The "best estimate" is the most recent replacement event with weight
--   ≥ 0.50. If none, fall back to the highest-weight first-install year.
--   Posterior confidence is the max weight of signals at the chosen year.
--
-- This script is a SELECT ONLY — it produces a result set, not a
-- materialized view. Once tuned, wrap with `CREATE MATERIALIZED VIEW
-- roof_age_v2 AS …` so it's refreshable nightly. Until then run interactively
-- to spot-check / tune weights.
--
-- Usage:
--   psql ... -f scripts/compute-roof-age-v2.sql
-- or
--   \i scripts/compute-roof-age-v2.sql
-- =====================================================================

\timing on

-- 1) Roof events from `property_signals.reroof_permit`, after filtering out
--    new-construction permits (where permit year ≈ yearBuilt).
WITH permit_events AS (
  SELECT
    s."propertyId" AS property_id,
    EXTRACT(YEAR FROM s."signalDate")::int AS event_year,
    'replacement' AS kind,
    CASE
      WHEN s.source LIKE 'permit.%' THEN 0.95
      ELSE COALESCE(s.confidence::float, 0.80)
    END AS weight,
    s.source AS evidence_source,
    s."sourceRecordId" AS evidence_record
  FROM property_signals s
  JOIN properties p ON p.id = s."propertyId"
  WHERE s."signalType" = 'reroof_permit'
    AND s."signalDate" IS NOT NULL
    AND p."yearBuilt" IS NOT NULL
    -- Exclude first-roof permits: permit issued near construction year
    AND NOT (EXTRACT(YEAR FROM s."signalDate")::int BETWEEN p."yearBuilt" - 1 AND p."yearBuilt" + 2)
),

-- 2) Roof events from `properties.roofInstalledAt` — split by source.
direct_replacement_events AS (
  SELECT
    p.id AS property_id,
    EXTRACT(YEAR FROM p."roofInstalledAt")::int AS event_year,
    'replacement' AS kind,
    0.85 AS weight,
    'installed-direct:' || p."roofInstalledSource" AS evidence_source,
    NULL::text AS evidence_record
  FROM properties p
  WHERE p."roofInstalledAt" IS NOT NULL
    AND p."roofInstalledSource" IN ('permit-post-hail')
),
direct_firstroof_events AS (
  SELECT
    p.id AS property_id,
    EXTRACT(YEAR FROM p."roofInstalledAt")::int AS event_year,
    'first_install' AS kind,
    0.85 AS weight,
    'installed-direct:' || p."roofInstalledSource" AS evidence_source,
    NULL::text AS evidence_record
  FROM properties p
  WHERE p."roofInstalledAt" IS NOT NULL
    AND p."roofInstalledSource" IN ('coc-new-construction', 'huntsville-newconstruction')
),

-- 3) Prithvi (when present). Its calibrated confidence already encodes
--    the AUC tier cap (GREEN ≤0.75, YELLOW ≤0.55, RED-INT ≤0.45) per the
--    locked thresholds in PRITHVI_TRACK_RESPONSE_2026-04-29.md Q2 + the
--    naive-baseline floor noted in CODE_HANDOFF_FOLLOWUP_2026-04-29.md.
prithvi_events AS (
  SELECT
    s."propertyId" AS property_id,
    EXTRACT(YEAR FROM s."signalDate")::int AS event_year,
    'replacement' AS kind,
    COALESCE(s.confidence::float, 0.40) AS weight,
    s.source AS evidence_source,
    s."sourceRecordId" AS evidence_record
  FROM property_signals s
  WHERE s."signalType" = 'roof_age_imagery'
    AND s.source = 'prithvi.travis-v1'
    AND s."signalDate" IS NOT NULL
),

-- 4) `properties.yearBuilt` as a low-weight first-install prior. Weight depends
--    on the data confidence label.
yearbuilt_events AS (
  SELECT
    p.id AS property_id,
    p."yearBuilt" AS event_year,
    'first_install' AS kind,
    -- DataConfidence enum: VERIFIED, ENRICHED, DEED_FLOOR, SUBDIV_PLAT,
    -- NEIGHBOR_KNN, ACS_MEDIAN, RATIO_GUESS, NONE. VERIFIED + ENRICHED carry
    -- real ground-truth-like confidence; the rest are imputations of varying
    -- quality. Weight reflects that the yearBuilt is just a first-roof prior
    -- (not informative about replacements).
    CASE
      WHEN p."yearBuiltConfidence" IN ('VERIFIED','ENRICHED') THEN 0.30
      WHEN p."yearBuiltConfidence" IN ('DEED_FLOOR','SUBDIV_PLAT') THEN 0.20
      ELSE 0.10
    END AS weight,
    'yearBuilt:' || COALESCE(p."yearBuiltSource", 'unknown') AS evidence_source,
    NULL::text AS evidence_record
  FROM properties p
  WHERE p."yearBuilt" IS NOT NULL AND p."yearBuilt" > 1900
),

-- 5) MS v2 capture-end as a "building existed by year" anchor. This is a
--    one-sided constraint, only useful for sanity-checking Prithvi's
--    first-roof prior — included here as a low-weight first-install event.
ms_v2_existed_events AS (
  SELECT
    bf."propertyId" AS property_id,
    EXTRACT(YEAR FROM bf.capture_dates_range_end)::int AS event_year,
    'first_install' AS kind,
    0.20 AS weight,
    'building_footprints.ms_v2:release' || COALESCE(bf.release::text, 'unk') AS evidence_source,
    NULL::text AS evidence_record
  FROM building_footprints bf
  WHERE bf.capture_dates_range_end IS NOT NULL
),

-- 6) OSM start_date. Same shape as ms_v2 but at slightly higher confidence
--    on the small landmark set.
osm_events AS (
  SELECT
    s."propertyId" AS property_id,
    EXTRACT(YEAR FROM s."signalDate")::int AS event_year,
    'first_install' AS kind,
    COALESCE(s.confidence::float, 0.50) AS weight,
    s.source AS evidence_source,
    s."sourceRecordId" AS evidence_record
  FROM property_signals s
  WHERE s."signalType" = 'osm_start_date'
    AND s."signalDate" IS NOT NULL
),

-- 7) Storm-window inference: for properties with a major storm event in their
--    lifetime, the roof was very likely repaired or replaced within the post-
--    event insurance window. Confidence is severity-tiered (see
--    compute-storm-implied-roof-signals.sql).
storm_inference_events AS (
  SELECT
    s."propertyId" AS property_id,
    EXTRACT(YEAR FROM s."signalDate")::int AS event_year,
    'replacement' AS kind,
    COALESCE(s.confidence::float, 0.40) AS weight,
    s.source AS evidence_source,
    s."sourceRecordId" AS evidence_record
  FROM property_signals s
  WHERE s."signalType" = 'implied_replacement_post_storm'
    AND s."signalDate" IS NOT NULL
),

-- 8) MLS listing roof-year mentions (homeowner-asserted via realtor). High
--    confidence when realtor types an explicit year; lower when category-only.
mls_year_events AS (
  SELECT
    s."propertyId" AS property_id,
    EXTRACT(YEAR FROM s."signalDate")::int AS event_year,
    'replacement' AS kind,
    COALESCE(s.confidence::float, 0.80) AS weight,
    s.source AS evidence_source,
    s."sourceRecordId" AS evidence_record
  FROM property_signals s
  WHERE s."signalType" = 'mls_roof_year'
    AND s."signalDate" IS NOT NULL
),
mls_mention_events AS (
  -- Roof category-only mentions (no year): treat as a "replacement happened
  -- recently — assume listing year ± 2 yr window" and confidence floor.
  SELECT
    s."propertyId" AS property_id,
    COALESCE(EXTRACT(YEAR FROM s."signalDate")::int,
             EXTRACT(YEAR FROM s."observedAt")::int) AS event_year,
    'replacement' AS kind,
    COALESCE(s.confidence::float, 0.50) AS weight,
    s.source AS evidence_source,
    s."sourceRecordId" AS evidence_record
  FROM property_signals s
  WHERE s."signalType" IN ('mls_roof_mention', 'mls_roof_material')
),

-- All events stacked
all_events AS (
  SELECT * FROM permit_events
  UNION ALL SELECT * FROM direct_replacement_events
  UNION ALL SELECT * FROM direct_firstroof_events
  UNION ALL SELECT * FROM prithvi_events
  UNION ALL SELECT * FROM yearbuilt_events
  UNION ALL SELECT * FROM ms_v2_existed_events
  UNION ALL SELECT * FROM osm_events
  UNION ALL SELECT * FROM storm_inference_events
  UNION ALL SELECT * FROM mls_year_events
  UNION ALL SELECT * FROM mls_mention_events
),

-- Pick the most recent replacement (weight ≥ 0.50). If none, fall back to
-- the highest-weight first-install. Use DISTINCT ON for the per-property
-- winner.
chosen_replacement AS (
  SELECT DISTINCT ON (property_id)
    property_id,
    event_year,
    weight,
    evidence_source,
    evidence_record,
    'replacement' AS chosen_kind
  FROM all_events
  WHERE kind = 'replacement' AND weight >= 0.50
  ORDER BY property_id, event_year DESC, weight DESC
),
chosen_firstinstall AS (
  SELECT DISTINCT ON (property_id)
    property_id,
    event_year,
    weight,
    evidence_source,
    evidence_record,
    'first_install' AS chosen_kind
  FROM all_events
  WHERE kind = 'first_install'
  ORDER BY property_id, weight DESC, event_year DESC
),
-- Per-property aggregate of contributing signals (for evidence_summary jsonb)
evidence_aggregate AS (
  SELECT
    property_id,
    jsonb_agg(jsonb_build_object(
      'kind', kind,
      'year', event_year,
      'weight', round(weight::numeric, 3),
      'source', evidence_source,
      'record', evidence_record
    ) ORDER BY weight DESC, event_year DESC) AS evidence_jsonb,
    COUNT(*) AS evidence_count,
    MAX(weight) AS max_weight,
    SUM(CASE WHEN kind='replacement' AND weight >= 0.50 THEN 1 ELSE 0 END) AS replacement_signals,
    SUM(CASE WHEN kind='first_install' THEN 1 ELSE 0 END) AS firstinstall_signals
  FROM all_events
  GROUP BY property_id
)
SELECT
  COALESCE(cr.property_id, cf.property_id, ea.property_id) AS property_id,
  COALESCE(cr.event_year, cf.event_year)                   AS best_estimate_year,
  COALESCE(cr.chosen_kind, cf.chosen_kind)                 AS best_estimate_kind,
  GREATEST(
    COALESCE(cr.weight, 0),
    COALESCE(cf.weight, 0)
  )::numeric(4,2)                                          AS posterior_confidence,
  CASE
    WHEN cr.property_id IS NOT NULL AND cr.weight >= 0.85 THEN 'VERIFIED_REPLACEMENT'
    WHEN cr.property_id IS NOT NULL AND cr.weight >= 0.50 THEN 'IMPUTED_REPLACEMENT'
    WHEN cf.property_id IS NOT NULL AND cf.weight >= 0.30 THEN 'VERIFIED_FIRSTROOF'
    WHEN cf.property_id IS NOT NULL THEN 'IMPUTED_FIRSTROOF'
    ELSE 'NONE'
  END                                                       AS evidence_class,
  ea.evidence_count,
  ea.replacement_signals,
  ea.firstinstall_signals,
  ea.evidence_jsonb                                         AS evidence
FROM chosen_replacement cr
FULL OUTER JOIN chosen_firstinstall cf USING (property_id)
LEFT JOIN evidence_aggregate ea USING (property_id)
ORDER BY posterior_confidence DESC NULLS LAST, best_estimate_year DESC NULLS LAST
LIMIT 50;

-- Diagnostics: distribution counts by evidence_class
WITH events AS (
  -- (re-derive from above — simplified to counts only)
  SELECT
    s."propertyId" AS property_id,
    'replacement' AS kind,
    0.95 AS weight
  FROM property_signals s
  JOIN properties p ON p.id = s."propertyId"
  WHERE s."signalType" = 'reroof_permit'
    AND p."yearBuilt" IS NOT NULL
    AND s."signalDate" IS NOT NULL
    AND NOT (EXTRACT(YEAR FROM s."signalDate")::int BETWEEN p."yearBuilt" - 1 AND p."yearBuilt" + 2)
  UNION ALL
  SELECT id AS property_id, 'replacement' AS kind, 0.85 AS weight
    FROM properties
    WHERE "roofInstalledAt" IS NOT NULL AND "roofInstalledSource" = 'permit-post-hail'
)
SELECT
  COUNT(DISTINCT property_id) AS properties_with_replacement_signal
FROM events;
