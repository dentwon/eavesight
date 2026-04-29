-- build-pin-cards-v4.sql (2026-04-27)
-- Tier-aware payloads aligned with the locked tier matrix.
--
-- payloadFree  → Scout (anonymous browse): score bucket, year-built era band,
--                value range, address (or Location ID for ms-*), roof material,
--                storm "events yes/no", trigger flags only.
--                NO roof age, NO owner identity, NO exact score, NO exact value.
--
-- payloadPro   → Business + Pro + Enterprise (paid browse):
--                exact score (backend gates Business to bucket-only),
--                owner name + mailing address (phone/email come from
--                a separate /contact-reveal endpoint at unlock time),
--                roof age v1 estimate + P5/P95 + source + confidence,
--                exact values (all 6 fields), exact sqft, full SPC + MRMS,
--                recentStorms[] last 5, full trigger details + ownerHistory,
--                last sale date (no price — 0% pop), roofInstalledAt.
--
-- DELIBERATELY EXCLUDED from both payloads:
--   * ownerPhone / ownerEmail — gated by /contact-reveal + DNC at unlock.
--
-- Usage: psql -v metro="'north-alabama'" -f build-pin-cards-v4.sql

\timing on
\set ON_ERROR_STOP on

SET synchronous_commit = off;
SET maintenance_work_mem = '1GB';
SET work_mem = '256MB';

BEGIN;

\echo '\n===== clearing existing metro pin cards ====='
DELETE FROM property_pin_cards WHERE "metroCode" = :metro;

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
  "score", "dormantFlag", "roofAgeSource", "updatedAt",
  -- v2 lead-priority + roof-age fields (added 2026-04-29)
  "priorityRank", "priorityLabel", "urgencyTier", "severitySubrank",
  "daysUntilClaimClose", "evidenceClass",
  "roofAgeYearsV2", "roofAgeConfidenceV2",
  "bestEstimateYearV2", "bestEstimateKindV2"
)
SELECT
  p.id, p."metroCode",

  -- ============ FREE / SCOUT TIER ============
  -- Anonymous browse. No exact score, no roof age, no owner, no exact values.
  jsonb_build_object(
    'id', p.id,
    'lat', p.lat, 'lon', p.lon,
    'address',
      CASE WHEN p.address LIKE 'ms-%'
           THEN 'Location ID ' || p.address
           ELSE p.address END,
    'addressIsPlaceholder', (p.address LIKE 'ms-%'),
    'city', p.city, 'state', p.state, 'zip', p.zip,
    'scoreBucket', CASE WHEN p."score" >= 80 THEN 'hot'
                        WHEN p."score" >= 60 THEN 'warm'
                        WHEN p."score" >= 40 THEN 'cool'
                        ELSE 'cold' END,
    'yearBuiltEra',
      CASE
        WHEN p."yearBuilt" IS NULL THEN NULL
        WHEN p."yearBuilt" >= 2010 THEN 'Post-2010'
        WHEN p."yearBuilt" >= 2000 THEN '2000s'
        WHEN p."yearBuilt" >= 1980 THEN '1980s-90s'
        ELSE 'Pre-1980'
      END,
    'valueRange',
      CASE
        WHEN p."marketValue" IS NULL THEN NULL
        WHEN p."marketValue" <  100000 THEN '<$100K'
        WHEN p."marketValue" <  200000 THEN '$100-200K'
        WHEN p."marketValue" <  300000 THEN '$200-300K'
        WHEN p."marketValue" <  500000 THEN '$300-500K'
        WHEN p."marketValue" < 1000000 THEN '$500K-1M'
        ELSE '$1M+'
      END,
    'sqftBin',
      CASE
        WHEN p.sqft IS NULL THEN NULL
        WHEN p.sqft < 1000 THEN '<1,000 sqft'
        WHEN p.sqft < 2000 THEN '1,000-2,000 sqft'
        WHEN p.sqft < 3000 THEN '2,000-3,000 sqft'
        ELSE '3,000+ sqft'
      END,
    'roofAreaSqft', p."roofAreaSqft",
    'roofMaterial', p."roofMaterial",
    'roofType', p."roofType",
    'propertyType', p."propertyType",
    'stormsAny', (COALESCE(p."spcHailCount", 0) > 0
               OR COALESCE(p."spcWindCount", 0) > 0
               OR COALESCE(p."spcTornadoCount", 0) > 0),
    -- Trigger flags only (no details, no full reasons)
    'hasProbateTrigger',   COALESCE(t.probate, false),
    'hasRecentTransfer',   COALESCE(t.recent_xfer, false),
    'hasInvestorFlip',     COALESCE(t.investor, false),
    'dormantFlag', p."dormantFlag",
    'topReasons',
      COALESCE(
        (SELECT jsonb_agg(b)
         FROM jsonb_array_elements_text(COALESCE(p."scoreReasons" -> 'bullets', '[]'::jsonb)) b
         LIMIT 1),
        '[]'::jsonb
      ),
    -- v2 lead-priority bucket (BURNING/URGENT/PIPELINE/AGED/COLD) — Scout sees
    -- the bucket name only, no exact priority rank or claim-window-days
    'priorityBucket',
      CASE
        WHEN lp.priority_rank IN (1, 2) THEN 'BURNING'
        WHEN lp.priority_rank = 3       THEN 'URGENT'
        WHEN lp.priority_rank = 4       THEN 'PIPELINE'
        WHEN lp.priority_rank IN (5, 6) THEN 'AGED'
        WHEN lp.priority_rank = 8       THEN 'TOO_YOUNG'
        WHEN lp.priority_rank IN (90, 99) THEN 'NOT_LEAD'
        ELSE NULL
      END,
    -- Coarse roof-age band — Scout sees the band, not exact years
    'roofAgeV2Band',
      CASE
        WHEN ra.best_estimate_year IS NULL THEN NULL
        WHEN EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year < 5  THEN '<5 yr'
        WHEN EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year < 10 THEN '5-10 yr'
        WHEN EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year < 15 THEN '10-15 yr'
        WHEN EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year < 20 THEN '15-20 yr'
        WHEN EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year < 25 THEN '20-25 yr'
        WHEN EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year < 35 THEN '25-35 yr'
        ELSE '35+ yr'
      END,
    -- "evidence quality" surface flag — VERIFIED means Scout sees a confidence
    -- badge ("permit-on-file"), nothing else
    'roofEvidenceQuality',
      CASE
        WHEN ra.evidence_class LIKE 'VERIFIED%' THEN 'verified'
        WHEN ra.evidence_class LIKE 'STRONG%'   THEN 'strong'
        WHEN ra.evidence_class LIKE 'IMPUTED%'  THEN 'imputed'
        WHEN ra.evidence_class LIKE 'WEAK%'     THEN 'weak'
        ELSE NULL
      END,
    'tier', 'scout'
  ) AS payloadFree,

  -- ============ PAID TIER (Business + Pro + Enterprise) ============
  -- Backend further gates: Business sees scoreBucket only (not exact score).
  -- Pro / Enterprise see everything in this payload.
  -- Phone + email NEVER in pin card — gated via /api/leads/contact-reveal.
  (
    jsonb_build_object(
      'id', p.id,
      'lat', p.lat, 'lon', p.lon,
      'address',
        CASE WHEN p.address LIKE 'ms-%'
             THEN 'Location ID ' || p.address
             ELSE p.address END,
      'addressIsPlaceholder', (p.address LIKE 'ms-%'),
      'city', p.city, 'state', p.state, 'zip', p.zip,
      'score', ROUND(p."score"::numeric, 1),
      'scoreBucket', CASE WHEN p."score" >= 80 THEN 'hot'
                          WHEN p."score" >= 60 THEN 'warm'
                          WHEN p."score" >= 40 THEN 'cool'
                          ELSE 'cold' END,
      'dormantFlag', p."dormantFlag",
      'claimWindowEndsAt', p."claimWindowEndsAt",
      'ownerFullName', p."ownerFullName",
      'ownerMailAddress',
        CASE
          WHEN p."ownerMailAddress" IS NULL THEN NULL
          WHEN UPPER(TRIM(p."ownerMailAddress")) = UPPER(TRIM(p.address)) THEN NULL
          ELSE p."ownerMailAddress"
        END,
      'ownerMailCity', p."ownerMailCity",
      'ownerMailState', p."ownerMailState",
      'ownerMailZip', p."ownerMailZip",
      'ownerOccupied', p."ownerOccupied",
      'ownerSinceYear', p."ownerSinceYear",
      'tier', 'paid'
    )
    ||
    jsonb_build_object(
      'yearBuilt', p."yearBuilt",
      'yearBuiltConfidence', p."yearBuiltConfidence",
      'yearBuiltSource', p."yearBuiltSource",
      'yearBuiltIsReal',
        (p."yearBuiltSource" LIKE 'madison-assessor-scrape%'
         OR p."yearBuiltSource" LIKE 'limestone-assessor-scrape%'
         OR p."yearBuiltSource" LIKE 'morgan-assessor-scrape%'
         OR p."yearBuiltSource" = 'huntsville-coc-new-construction'),
      -- Roof age v1 (computed 2026-04-26 — the cascade with confidence interval)
      'roofAgeEstimate',     p."roofAgeEstimate",
      'roofAgeP5',           p."roofAgeP5",
      'roofAgeP95',          p."roofAgeP95",
      'roofAgeSource',       p."roofAgeSource",
      'roofAgeConfidenceV1', p."roofAgeConfidenceV1",
      -- Direct install (1.5% of properties)
      'roofInstalledAt',     p."roofInstalledAt",
      'roofInstalledSource', p."roofInstalledSource",
      -- Roof characteristics
      'roofMaterial',  p."roofMaterial",
      'roofType',      p."roofType",
      'roofAreaSqft',  p."roofAreaSqft",
      'roofSizeClass', p."roofSizeClass",
      -- Property values (all 6 fields)
      'marketValue',      p."marketValue",
      'assessedValue',    p."assessedValue",
      'buildingValue',    p."buildingValue",
      'improvementValue', p."improvementValue",
      'landValue',        p."landValue",
      'appraisedValue',   p."appraisedValue",
      -- Living area
      'sqft',              p.sqft,
      'totalAdjustedArea', p."totalAdjustedArea",
      'bathrooms',         p.bathrooms,
      'stories',           p.stories,
      'lastSaleDate',      p."lastSaleDate"
    )
    ||
    jsonb_build_object(
      'spcHailCount',           COALESCE(p."spcHailCount", 0),
      'spcHailCount5y',         COALESCE(p."spcHailCount5y", 0),
      'spcHailMaxInches',       p."spcHailMaxInches",
      'spcHailLastDate',        p."spcHailLastDate",
      'spcWindCount',           COALESCE(p."spcWindCount", 0),
      'spcWindCount5y',         COALESCE(p."spcWindCount5y", 0),
      'spcWindLastDate',        p."spcWindLastDate",
      'spcTornadoCount',        COALESCE(p."spcTornadoCount", 0),
      'spcTornadoLastDate',     p."spcTornadoLastDate",
      'spcSevereOrExtremeCount', COALESCE(p."spcSevereOrExtremeCount", 0),
      'hailExposureIndex',      p."hailExposureIndex",
      'hailEventCount',         p."hailEventCount",
      -- Triggers + supporting detail
      'hasProbateTrigger', COALESCE(t.probate, false),
      'hasRecentTransfer', COALESCE(t.recent_xfer, false),
      'hasInvestorFlip',   COALESCE(t.investor, false),
      'tenureYears',       t.tenure_yrs,
      'lastTransferYear',  t.last_xfer_year,
      'distinctOwners5y',  t.distinct_owners_5y,
      'ownerHistory',      COALESCE(p."ownerHistory", '[]'::jsonb),
      'scoreReasons',      COALESCE(p."scoreReasons", '{}'::jsonb),
      'recentStorms',      COALESCE(rs.recent_storms, '[]'::jsonb),
      'propertyType',      p."propertyType"
    )
    ||
    -- v2 lead-priority + roof-age (full detail for paid tiers)
    jsonb_build_object(
      'priorityRank',          lp.priority_rank,
      'priorityLabel',         lp.priority_label,
      'urgencyTier',           lp.urgency_tier,
      'ageTier',               lp.age_tier,
      'severitySubrank',       tl.severity_subrank,
      'daysUntilClaimClose',   lp.insurance_days_remaining,
      'recentStormDate',       lp.recent_storm_date,
      'recentStormDaysSince',  lp.storm_days_since,
      'recentStormType',       tl.storm_type,
      'recentStormHailInches', tl.hail_inches,
      'recentStormWindMph',    tl.wind_mph,
      'recentStormTornadoScale', tl.tornado_scale,
      'isMetalOrClay',         lp.is_metal_or_clay,
      'hasReplacementEvidence', lp.has_replacement_evidence,
      -- v2 roof-age (replaces v1 estimate where available)
      'roofAgeYearsV2',        EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year,
      'roofAgeConfidenceV2',   ra.posterior_confidence,
      'bestEstimateYearV2',    ra.best_estimate_year,
      'bestEstimateKindV2',    ra.best_estimate_kind,
      'evidenceClass',         ra.evidence_class,
      'evidenceCount',         ra.evidence_count,
      'replacementSignals',    ra.replacement_signals,
      'firstInstallSignals',   ra.firstinstall_signals,
      -- Full evidence trail (audit-grade view of contributing signals)
      'roofAgeEvidence',       COALESCE(ra.evidence, '[]'::jsonb)
    )
  ) AS payloadPro,

  p."score",
  p."dormantFlag",
  COALESCE(p."roofAgeSource", 'unknown'),
  NOW(),

  -- v2 top-level columns (mirror payloadPro for fast index-only filters)
  lp.priority_rank,
  lp.priority_label,
  lp.urgency_tier,
  tl.severity_subrank,
  lp.insurance_days_remaining,
  ra.evidence_class,
  CASE WHEN ra.best_estimate_year IS NOT NULL
       THEN EXTRACT(YEAR FROM NOW())::int - ra.best_estimate_year END,
  ra.posterior_confidence,
  ra.best_estimate_year,
  ra.best_estimate_kind

FROM properties p
LEFT JOIN _recent_storms_per_prop rs ON rs."propertyId" = p.id
LEFT JOIN _trig_per_prop t ON t.id = p.id
LEFT JOIN roof_age_v2     ra ON ra.property_id = p.id
LEFT JOIN lead_priority   lp ON lp.property_id = p.id
LEFT JOIN top_leads_burning tl ON tl.property_id = p.id
WHERE p."metroCode" = :metro
ORDER BY p.id;

COMMIT;

\echo '\n===== final counts ====='
SELECT COUNT(*) AS pin_cards,
       COUNT(*) FILTER (WHERE "dormantFlag" = TRUE) AS dormant,
       COUNT(*) FILTER (WHERE "score" >= 80) AS hot,
       COUNT(*) FILTER (WHERE "score" BETWEEN 60 AND 79) AS warm,
       COUNT(*) FILTER (WHERE "score" BETWEEN 40 AND 59) AS cool,
       COUNT(*) FILTER (WHERE "score" < 40) AS cold
FROM property_pin_cards WHERE "metroCode" = :metro;

\echo '\n===== priority distribution ====='
SELECT "priorityLabel", COUNT(*)
FROM property_pin_cards WHERE "metroCode" = :metro
GROUP BY 1 ORDER BY 1;

\echo '\n===== BURNING leads top-20 (rendered to map) ====='
SELECT "priorityLabel", "severitySubrank", "daysUntilClaimClose", "roofAgeYearsV2",
       "payloadPro"->>'address' AS address,
       "payloadPro"->>'city'    AS city,
       "payloadPro"->>'zip'     AS zip
FROM property_pin_cards WHERE "metroCode" = :metro
  AND "priorityRank" IN (1, 2)
ORDER BY "priorityRank", "severitySubrank", "daysUntilClaimClose", "roofAgeYearsV2" DESC
LIMIT 20;

SELECT
  AVG(jsonb_array_length(jsonb_path_query_array("payloadFree", '$.keyvalue().key')))::int AS avg_free_keys,
  AVG(jsonb_array_length(jsonb_path_query_array("payloadPro",  '$.keyvalue().key')))::int AS avg_paid_keys
FROM property_pin_cards
WHERE "metroCode" = :metro
LIMIT 100;
