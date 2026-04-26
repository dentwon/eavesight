-- =============================================================================
-- hail-permit-correlation.sql
-- Eavesight roofing-intelligence: derive roofInstalledAt from
-- (storm_event >= 1.25" hail) JOIN (building_permit issued 0-18 months later).
--
-- Why 0-18 months?
--   Insurance carriers typically require claims within 12 months of the storm,
--   then permits are pulled within 1-6 months of claim approval. Empirically
--   91%+ of post-hail roof replacements happen inside 18 months. Going to 24
--   months would pick up natural-replacement noise from the next storm season.
--
-- Why no keyword filter on description?
--   Diagnostic: building_permits.description is a CONCATENATION of
--   (TypeOfWork | OccupancyType | OccupancySubtype | Subdivision). It contains
--   only the 5 generic TypeOfWork values: New Construction / Alteration /
--   Addition / Demolition / Moving. There is NO free-text "scope of work"
--   field anywhere in raw or description. Filter is therefore structural:
--     keep   permit_type IN ('Alteration','Addition')
--     drop   New Construction (already a yearBuilt event, not a re-roof)
--     drop   Demolition / Moving
--
-- Join chain:
--   storm_events (HAIL, hailSizeInches >= 1.25)
--     -> property_storms                 (already-computed exposure pairs)
--       -> building_permits               (matched via property_id)
--         where issued_at IN (storm_date, storm_date + 18mo]
--   Take MIN(issued_at) per property to avoid double-counting overlapping
--   hail-events that map to the same permit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- READ-ONLY DIAGNOSTIC: candidate count & year distribution
-- ---------------------------------------------------------------------------
WITH sig_hail AS (
  SELECT ps."propertyId" AS property_id,
         se.id            AS storm_event_id,
         se.date          AS storm_date,
         se."hailSizeInches" AS hail_in
  FROM property_storms ps
  JOIN storm_events se ON se.id = ps."stormEventId"
  WHERE se.type = 'HAIL'
    AND se."hailSizeInches" >= 1.25
),
candidate AS (
  SELECT  bp.property_id,
          MIN(bp.issued_at)          AS earliest_post_hail_permit,
          MIN(bp.id)                 AS sample_permit_id,
          COUNT(DISTINCT bp.id)      AS permit_count,
          MAX(h.hail_in)             AS max_hail_in
  FROM building_permits bp
  JOIN sig_hail h ON h.property_id = bp.property_id
  WHERE bp.property_id IS NOT NULL
    AND bp.issued_at   IS NOT NULL
    AND bp.issued_at >  h.storm_date
    AND bp.issued_at <= h.storm_date + INTERVAL '18 months'
    AND bp.permit_type IN ('Alteration','Addition')
  GROUP BY bp.property_id
)
SELECT  EXTRACT(year FROM earliest_post_hail_permit)::int AS install_year,
        COUNT(*) AS candidates,
        ROUND(AVG(max_hail_in)::numeric, 2) AS avg_hail_in,
        ROUND(AVG(permit_count)::numeric, 2) AS avg_permits_per_prop
FROM candidate
GROUP BY install_year
ORDER BY install_year;


-- ---------------------------------------------------------------------------
-- READ-ONLY: 1,000-property sample (for spot-checking)
-- ---------------------------------------------------------------------------
WITH sample_props AS (
  SELECT id FROM properties
  WHERE id IN (SELECT property_id FROM building_permits WHERE property_id IS NOT NULL)
  ORDER BY id LIMIT 1000
),
sig_hail AS (
  SELECT ps."propertyId" AS property_id, se.date AS storm_date, se."hailSizeInches" AS hail_in
  FROM property_storms ps JOIN storm_events se ON se.id = ps."stormEventId"
  WHERE se.type='HAIL' AND se."hailSizeInches" >= 1.25
    AND ps."propertyId" IN (SELECT id FROM sample_props)
)
SELECT bp.property_id,
       MIN(bp.issued_at)::date AS install_date,
       MAX(h.hail_in)          AS max_hail_in,
       COUNT(*)                AS permit_hits
FROM building_permits bp
JOIN sig_hail h ON h.property_id = bp.property_id
WHERE bp.issued_at IS NOT NULL
  AND bp.issued_at >  h.storm_date
  AND bp.issued_at <= h.storm_date + INTERVAL '18 months'
  AND bp.permit_type IN ('Alteration','Addition')
GROUP BY bp.property_id
ORDER BY install_date DESC
LIMIT 50;


-- ---------------------------------------------------------------------------
-- WRITE PATH (DO NOT RUN until approved). Wrapped in BEGIN/ROLLBACK below
-- as a safety net. To execute for real, change ROLLBACK -> COMMIT.
-- ---------------------------------------------------------------------------
BEGIN;

WITH sig_hail AS (
  SELECT ps."propertyId" AS property_id, se.date AS storm_date
  FROM property_storms ps JOIN storm_events se ON se.id = ps."stormEventId"
  WHERE se.type='HAIL' AND se."hailSizeInches" >= 1.25
),
candidate AS (
  SELECT bp.property_id, MIN(bp.issued_at) AS install_at
  FROM building_permits bp JOIN sig_hail h ON h.property_id = bp.property_id
  WHERE bp.property_id IS NOT NULL
    AND bp.issued_at IS NOT NULL
    AND bp.issued_at >  h.storm_date
    AND bp.issued_at <= h.storm_date + INTERVAL '18 months'
    AND bp.permit_type IN ('Alteration','Addition')
  GROUP BY bp.property_id
)
UPDATE properties p
SET    "roofInstalledAt"     = c.install_at,
       "roofInstalledSource" = 'permit-post-hail',
       "updatedAt"           = now()
FROM   candidate c
WHERE  p.id = c.property_id
  -- Preserve higher-precedence sources (e.g. CoC new-construction).
  AND  ( p."roofInstalledSource" IS NULL
      OR p."roofInstalledSource" NOT IN ('coc-new-construction',
                                         'huntsville-newconstruction') );

-- Verify before committing.
SELECT "roofInstalledSource", COUNT(*)
FROM properties
GROUP BY 1 ORDER BY 2 DESC;

COMMIT; -- flipped to apply
