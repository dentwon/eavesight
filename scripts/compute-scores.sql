-- compute-scores.sql
-- Populates: solarScore, urgencyScore, revenuePotential, opportunityScore, ownerOccupied

-- ==== 1. Solar score ====
-- Simple heuristic: roofAreaSqft * 0.6 usable * 15 W/sqft STC * assumed 4/12 pitch sin(18.4deg)=~0.316
-- kWh/yr ~= area * 0.6 * 15 * 0.316 * 1200 peak-sun-hrs/yr (AL) / 1000
-- Then normalized to 0-1 over observed range.
-- Use COALESCE(roofAreaSqft, sqft, 2500)

UPDATE properties
SET "solarScore" = NULL
WHERE "solarScore" IS NOT NULL;

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

-- ==== 2. ownerOccupied ====
-- Compute by comparing property address to owner mail address — naive normalized compare.
-- Only confident set: zip match + address digit prefix match.
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

-- ==== 3. Urgency score ====
-- hail exposure + roof age + storm hits
-- storm hits: join through PropertyStorm
UPDATE properties p
SET "urgencyScore" = LEAST(100,
  COALESCE(p."hailExposureIndex", 0) * 10
  + (2026 - COALESCE(p."yearBuilt", 2000)) * 2
  + COALESCE((
      SELECT COUNT(*) * 15
      FROM property_storms ps
      WHERE ps."propertyId" = p.id
    ), 0)
);

-- ==== 4. Revenue potential ====
-- baseline: roof area (sqft) * $7.50/sqft national avg re-roof cost * size multiplier.
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

-- ==== 5. Opportunity score (composite) ====
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

-- ==== Final coverage snapshot ====
SELECT
  COUNT(*) total,
  COUNT(*) FILTER (WHERE "solarScore" IS NOT NULL) w_solar,
  COUNT(*) FILTER (WHERE "urgencyScore" IS NOT NULL) w_urgency,
  COUNT(*) FILTER (WHERE "revenuePotential" IS NOT NULL) w_revenue,
  COUNT(*) FILTER (WHERE "opportunityScore" IS NOT NULL) w_opp,
  COUNT(*) FILTER (WHERE "ownerOccupied" IS NOT NULL) w_oo
FROM properties;
