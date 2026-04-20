-- apply-scores-and-flood.sql
-- Resilient UPDATEs. Uses short transactions (one per step) so deadlocks only lose one step.
-- Run with psql -v ON_ERROR_STOP=0 so a step failure doesn't abort the rest.

SET lock_timeout = '30s';
SET statement_timeout = '25min';

-- === Solar ===
\echo 'Computing solarScore...'
WITH s AS (
  SELECT id,
    COALESCE("roofAreaSqft", sqft, 2500) * 0.6 * 15 * 0.316 * 1200 / 1000.0 AS kwh_year
  FROM properties
),
bounds AS (
  SELECT PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY kwh_year) AS lo,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY kwh_year) AS hi
  FROM s
)
UPDATE properties p
SET "solarScore" = GREATEST(0, LEAST(1, (s.kwh_year - b.lo) / NULLIF(b.hi - b.lo, 0)))
FROM s, bounds b
WHERE p.id = s.id;

-- === ownerOccupied ===
\echo 'Computing ownerOccupied...'
WITH normed AS (
  SELECT id,
    regexp_replace(upper(coalesce(address,'')), '[^A-Z0-9]', '', 'g') AS p_norm,
    regexp_replace(upper(coalesce("ownerMailAddress",'')), '[^A-Z0-9]', '', 'g') AS o_norm,
    coalesce(zip,'') AS p_zip,
    coalesce("ownerMailZip",'') AS o_zip
  FROM properties
)
UPDATE properties p
SET "ownerOccupied" =
  CASE
    WHEN n.o_norm = '' THEN NULL
    WHEN n.p_zip = n.o_zip AND length(n.p_norm) >= 5 AND position(substring(n.p_norm, 1, 5) in n.o_norm) > 0 THEN true
    WHEN n.p_zip = n.o_zip AND length(n.o_norm) >= 5 AND position(substring(n.o_norm, 1, 5) in n.p_norm) > 0 THEN true
    ELSE false
  END
FROM normed n
WHERE p.id = n.id;

-- === Urgency ===
\echo 'Computing urgencyScore (pre-agg storm hits)...'
CREATE TEMP TABLE _storm_hits AS
  SELECT "propertyId" AS id, COUNT(*) AS hits
  FROM property_storms
  GROUP BY "propertyId";
CREATE INDEX ON _storm_hits (id);

UPDATE properties p
SET "urgencyScore" = LEAST(100,
  COALESCE(p."hailExposureIndex", 0) * 10
  + (2026 - COALESCE(p."yearBuilt", 2000)) * 2
  + COALESCE(sh.hits, 0) * 15
)
FROM _storm_hits sh
WHERE sh.id = p.id;

-- For rows without a storm hit row, just use hail+age
UPDATE properties p
SET "urgencyScore" = LEAST(100,
  COALESCE(p."hailExposureIndex", 0) * 10
  + (2026 - COALESCE(p."yearBuilt", 2000)) * 2
)
WHERE p."urgencyScore" IS NULL;

-- === Revenue ===
\echo 'Computing revenuePotential...'
UPDATE properties p
SET "revenuePotential" = (
  COALESCE(p."roofAreaSqft", p.sqft * 1.15, 2500) * 7.5
  * CASE p."roofSizeClass"
      WHEN 'RESIDENTIAL' THEN 1.0
      WHEN 'LARGE_RESIDENTIAL' THEN 1.15
      WHEN 'SMALL_COMMERCIAL' THEN 1.3
      WHEN 'MEDIUM_COMMERCIAL' THEN 1.5
      WHEN 'LARGE_COMMERCIAL' THEN 1.75
      WHEN 'WAREHOUSE_INDUSTRIAL' THEN 2.0
      ELSE 1.0
    END
);

-- === Opportunity ===
\echo 'Computing opportunityScore...'
WITH rev_bounds AS (
  SELECT PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY "revenuePotential") AS lo,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "revenuePotential") AS hi
  FROM properties WHERE "revenuePotential" IS NOT NULL
)
UPDATE properties p
SET "opportunityScore" = GREATEST(0, LEAST(100,
    COALESCE(p."urgencyScore", 0) * 0.5
  + GREATEST(0, LEAST(100,
      (COALESCE(p."revenuePotential",0) - b.lo) / NULLIF(b.hi - b.lo, 0) * 100
    )) * 0.3
  + CASE WHEN p."ownerOccupied" IS TRUE THEN 20
         WHEN p."ownerOccupied" IS FALSE THEN 10
         ELSE 12 END
))
FROM rev_bounds b;

-- === FEMA flood (from _fema_flood already loaded) ===
\echo 'Computing femaFloodZone/Risk from _fema_flood...'
CREATE TEMP TABLE _flood_assign AS
  SELECT DISTINCT ON (p.id)
    p.id,
    f.fld_zone,
    f.risk
  FROM properties p
  JOIN _fema_flood f
    ON ST_Intersects(f.geog, ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography)
  WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
  ORDER BY p.id,
    CASE
      WHEN upper(f.fld_zone) LIKE 'V%' THEN 1
      WHEN upper(f.fld_zone) LIKE 'A%' THEN 2
      WHEN upper(f.fld_zone) = 'D' THEN 3
      WHEN upper(f.fld_zone) IN ('X','B','C') THEN 4
      ELSE 5
    END;
CREATE INDEX ON _flood_assign (id);

UPDATE properties p
SET "femaFloodZone" = fa.fld_zone,
    "femaFloodRisk" = fa.risk
FROM _flood_assign fa
WHERE fa.id = p.id;

UPDATE properties
SET "femaFloodZone" = 'X', "femaFloodRisk" = 'MINIMAL'
WHERE "femaFloodZone" IS NULL AND county IN ('Madison','Limestone','Morgan','Marshall','Jackson');

-- === Snapshot ===
\echo ''
SELECT
  COUNT(*) total,
  COUNT(*) FILTER (WHERE "solarScore" IS NOT NULL) solar,
  COUNT(*) FILTER (WHERE "urgencyScore" IS NOT NULL) urgency,
  COUNT(*) FILTER (WHERE "revenuePotential" IS NOT NULL) revenue,
  COUNT(*) FILTER (WHERE "opportunityScore" IS NOT NULL) opp,
  COUNT(*) FILTER (WHERE "ownerOccupied" IS NOT NULL) oo,
  COUNT(*) FILTER (WHERE "femaFloodRisk" IS NOT NULL) flood
FROM properties;

SELECT "femaFloodRisk", COUNT(*) FROM properties GROUP BY 1 ORDER BY 2 DESC;
