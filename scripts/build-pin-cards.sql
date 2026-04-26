-- v2: pre-compute recent-storms JSON once, then single-pass INSERT.
--
-- v1 ran a correlated subquery per-row against 6.58M property_storms joined
-- with storm_events — that's 242,987 \* (btree probe + sort + limit) on HDD.
-- Estimated: many hours.
--
-- v2: one sort-merge pass builds a temp table (propertyId -> recentStorms JSON);
-- INSERT joins that temp table once. Plus HDD bulk-load tricks:
--   session_replication_role=replica  (skip FK triggers)
--   synchronous_commit=off
--   maintenance_work_mem=1GB
--   sequential INSERT ORDER BY propertyId
--
-- Usage: psql -v metro="'north-alabama'" -f build-pin-cards.sql

\timing on
\set ON_ERROR_STOP on

SET synchronous_commit = off;
SET maintenance_work_mem = '1GB';
SET work_mem = '256MB';
SET session_replication_role = replica;

BEGIN;

\echo '\n===== clearing existing metro pin cards ====='
DELETE FROM property_pin_cards WHERE "metroCode" = :metro;

-- 1. Pre-compute recent storms per property (one pass)
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

-- 2. INSERT pin cards with a single LEFT JOIN (no correlated subquery)
\echo '\n===== inserting pin cards ====='
INSERT INTO property_pin_cards (
  "propertyId", "metroCode", "payloadFree", "payloadPro",
  "score", "dormantFlag", "updatedAt"
)
SELECT
  p.id,
  p."metroCode",

  jsonb_build_object(
    'id',           p.id,
    'lat',          p.lat,
    'lon',          p.lon,
    'address',      CASE WHEN p.address LIKE 'ms-%' THEN NULL ELSE p.address END,
    'city',         p.city,
    'state',        p.state,
    'zip',          p.zip,
    'score',        ROUND(p."score"::numeric, 0),
    'scoreBucket',  CASE
                      WHEN p."score" >= 80 THEN 'hot'
                      WHEN p."score" >= 60 THEN 'warm'
                      WHEN p."score" >= 40 THEN 'cool'
                      ELSE 'cold' END,
    'dormantFlag',  p."dormantFlag",
    'roofAge',      GREATEST(0, 2026 - COALESCE(p."yearBuilt", 2026)),
    'yearBuilt',    p."yearBuilt",
    'yearBuiltConfidence', p."yearBuiltConfidence",
    'hailExposureIndex',   p."hailExposureIndex",
    'scoreReasons', COALESCE(p."scoreReasons", '[]'::jsonb),
    'tier',         'free'
  ) AS payloadFree,

  jsonb_build_object(
    'id',           p.id,
    'lat',          p.lat, 'lon', p.lon,
    'address',      p.address, 'city', p.city, 'state', p.state, 'zip', p.zip,
    'score',        ROUND(p."score"::numeric, 1),
    'scoreBucket',  CASE
                      WHEN p."score" >= 80 THEN 'hot'
                      WHEN p."score" >= 60 THEN 'warm'
                      WHEN p."score" >= 40 THEN 'cool'
                      ELSE 'cold' END,
    'dormantFlag',  p."dormantFlag",
    'claimWindowEndsAt', p."claimWindowEndsAt",
    'ownerFullName',     p."ownerFullName",
    'ownerPhone',        p."ownerPhone",
    'ownerEmail',        p."ownerEmail",
    'ownerOccupied',     p."ownerOccupied",
    'onDncList',         p."onDncList",
    'phoneVerified',     p."phoneVerified",
    'marketValue',       p."marketValue",
    'assessedValue',     p."assessedValue",
    'lastSaleDate',      p."lastSaleDate",
    'lastSalePrice',     p."lastSalePrice",
    'roofAreaSqft',      p."roofAreaSqft",
    'roofSizeClass',     p."roofSizeClass",
    'yearBuilt',         p."yearBuilt",
    'yearBuiltConfidence', p."yearBuiltConfidence",
    'roofAge',           GREATEST(0, 2026 - COALESCE(p."yearBuilt", 2026)),
    'hailExposureIndex', p."hailExposureIndex",
    'hailEventCount',    p."hailEventCount",
    'scoreReasons',      COALESCE(p."scoreReasons", '[]'::jsonb),
    'recentStorms',      COALESCE(rs.recent_storms, '[]'::jsonb),
    'tier', 'pro'
  ) AS payloadPro,

  p."score",
  p."dormantFlag",
  NOW()
FROM properties p
LEFT JOIN _recent_storms_per_prop rs ON rs."propertyId" = p.id
WHERE p."metroCode" = :metro
ORDER BY p.id;

COMMIT;

SET session_replication_role = origin;

\echo '\n===== final counts ====='
SELECT COUNT(*) AS pin_cards,
       COUNT(*) FILTER (WHERE "dormantFlag" = TRUE) AS dormant,
       COUNT(*) FILTER (WHERE "score" >= 80) AS hot,
       COUNT(*) FILTER (WHERE "score" BETWEEN 60 AND 79) AS warm,
       COUNT(*) FILTER (WHERE "score" BETWEEN 40 AND 59) AS cool
FROM property_pin_cards WHERE "metroCode" = :metro;
