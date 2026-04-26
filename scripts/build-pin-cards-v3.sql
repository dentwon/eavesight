-- build-pin-cards-v3.sql (2026-04-24)
-- Standalone counterpart to pinCardsSql() in apps/backend/src/data-pipeline/maintenance.processor.ts.
-- Both writers must produce IDENTICAL pin cards. If you edit one, edit the other.
--
-- v3 additions:
--   * SPC permissive rollup (hailCount, hailMaxInches, tornadoCount, severeOrExtremeCount, etc.)
--   * roofInstalledAt + roofInstalledSource in pro tier
--   * ownerHistory-derived probate / recent-transfer / investor / tenure flags
--   * Rich scoreReasons object (v3 from compute-scores-v3-fixup.sh)
--   * topReasons (bullets) teaser in free tier
--
-- Usage: psql -v metro="'north-alabama'" -f build-pin-cards-v3.sql

\timing on
\set ON_ERROR_STOP on

SET synchronous_commit = off;
SET maintenance_work_mem = '1GB';
SET work_mem = '256MB';
-- session_replication_role requires superuser; skipped (FK check overhead is small)

BEGIN;

\echo '\n===== clearing existing metro pin cards ====='
DELETE FROM property_pin_cards WHERE "metroCode" = :metro;

\echo '\n===== building _ages_per_prop (canonical roof-age ladder) ====='
CREATE TEMP TABLE _ages_per_prop ON COMMIT DROP AS
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
WHERE p."metroCode" = :metro;
CREATE INDEX ON _ages_per_prop (id);
ANALYZE _ages_per_prop;

\echo '\n===== building _recent_storms_per_prop ====='
CREATE TEMP TABLE _recent_storms_per_prop ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    ps."propertyId",
    se.type, se.date, se."hailSizeInches", se."windSpeedMph",
    ps."damageLevel", ps."distanceMeters",
    ROW_NUMBER() OVER (PARTITION BY ps."propertyId" ORDER BY se.date DESC) AS rn
  FROM property_storms ps
  JOIN storm_events    se ON se.id = ps."stormEventId"
  WHERE se.date > NOW() - INTERVAL '24 months'
    AND ps."propertyId" IN (SELECT id FROM properties WHERE "metroCode" = :metro)
)
SELECT "propertyId",
       jsonb_agg(jsonb_build_object(
         'type', type, 'date', date, 'hailSizeInches', "hailSizeInches",
         'windSpeedMph', "windSpeedMph", 'damageLevel', "damageLevel",
         'distanceMeters', "distanceMeters"
       ) ORDER BY date DESC) AS recent_storms
FROM ranked WHERE rn <= 5
GROUP BY "propertyId";
CREATE INDEX ON _recent_storms_per_prop ("propertyId");
ANALYZE _recent_storms_per_prop;

\echo '\n===== building _trig_per_prop (ownerHistory triggers) ====='
CREATE TEMP TABLE _trig_per_prop ON COMMIT DROP AS
WITH oh AS (
  SELECT
    p.id,
    p."ownerFullName",
    p."ownerHistory",
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
  WHERE p."metroCode" = :metro
)
SELECT
  oh.id,
  oh.last_xfer_year,
  oh.distinct_owners_5y,
  (
    COALESCE(oh."ownerFullName",'')
      ~* '(ESTATE\s+OF|HEIRS\s+OF|LIVING\s+TRUST|REVOCABLE\s+TRUST|FAMILY\s+TRUST|TRUSTEE|DECEASED)'
    OR COALESCE(oh.latest_owner,'')
      ~ '(ESTATE\s+OF|HEIRS\s+OF|LIVING\s+TRUST|REVOCABLE\s+TRUST|FAMILY\s+TRUST|TRUSTEE|DECEASED)'
  ) AS probate,
  (oh.last_xfer_year IS NOT NULL
   AND oh.last_xfer_year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 2) AS recent_xfer,
  (oh.distinct_owners_5y >= 3) AS investor,
  CASE WHEN oh.last_xfer_year IS NOT NULL
       THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - oh.last_xfer_year END AS tenure_yrs
FROM oh;
CREATE INDEX ON _trig_per_prop (id);
ANALYZE _trig_per_prop;

\echo '\n===== inserting pin cards ====='
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
  ) AS payloadFree,

  -- ============ PRO TIER ============
  -- Split into 3 jsonb_build_object calls because PG caps it at 100 args (50 K-V).
  -- Order: identity → owner+value → roof+storm-signals → triggers+joined data.
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
      'recentStorms',    COALESCE(rs.recent_storms, '[]'::jsonb)
    )
  ) AS payloadPro,

  p."score", p."dormantFlag", a.roof_age_source, NOW()
FROM properties p
JOIN _ages_per_prop a ON a.id = p.id
LEFT JOIN _recent_storms_per_prop rs ON rs."propertyId" = p.id
LEFT JOIN _trig_per_prop t ON t.id = p.id
WHERE p."metroCode" = :metro
ORDER BY p.id;

COMMIT;

-- session_replication_role reset skipped (was never SET above)

\echo '\n===== final counts ====='
SELECT COUNT(*) AS pin_cards,
       COUNT(*) FILTER (WHERE "dormantFlag" = TRUE) AS dormant,
       COUNT(*) FILTER (WHERE "score" >= 80) AS hot,
       COUNT(*) FILTER (WHERE "score" BETWEEN 60 AND 79) AS warm,
       COUNT(*) FILTER (WHERE "score" BETWEEN 40 AND 59) AS cool,
       COUNT(*) FILTER (WHERE "score" < 40) AS cold,
       COUNT(*) FILTER (WHERE "roofAgeSource" = 'coc') AS rs_coc,
       COUNT(*) FILTER (WHERE "roofAgeSource" = 'permit') AS rs_permit,
       COUNT(*) FILTER (WHERE "roofAgeSource" = 'unknown') AS rs_unknown
FROM property_pin_cards WHERE "metroCode" = :metro;

-- payloadFree key count sanity
SELECT
  AVG(jsonb_array_length(jsonb_path_query_array("payloadFree", '$.keyvalue().key')))::int AS avg_free_keys,
  AVG(jsonb_array_length(jsonb_path_query_array("payloadPro",  '$.keyvalue().key')))::int AS avg_pro_keys
FROM property_pin_cards
WHERE "metroCode" = :metro
LIMIT 100;
