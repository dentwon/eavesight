-- =====================================================================
-- compute-storm-implied-roof-signals.sql  (2026-04-29)
--
-- For every property where a major storm event hit at any point during
-- the building's lifetime (i.e. between yearBuilt and now), emit a
-- probabilistic "implied roof replacement" signal at a severity-tiered
-- confidence. This is a defensible roof-age proxy for the ~96% of N-AL
-- properties where we don't have permit-derived ground truth.
--
-- Logic:
--   For each property P with yearBuilt:
--     Find the most recent storm event S linked via property_storms where
--       S.date BETWEEN P.yearBuilt::date AND NOW()
--       AND S meets the severity threshold (HAIL ≥ 1.0", WIND ≥ 70mph,
--           or TORNADO ≥ EF1)
--     Emit ONE signal per property with:
--       signalType  = 'implied_replacement_post_storm'
--       signalDate  = S.date
--       confidence  = severity tier
--                     0.70   HAIL ≥ 2.0" (catastrophic — almost-certain replacement)
--                     0.55   HAIL 1.5-2.0" (severe — replacement very likely)
--                     0.40   HAIL 1.0-1.5" (significant — repair-or-replace, uncertain)
--                     0.55   WIND ≥ 80mph
--                     0.40   WIND 70-80mph
--                     0.85   TORNADO EF2+
--                     0.70   TORNADO EF1
--       signalValue = jsonb with storm metadata
--       sourceRecordId = 'storm:{stormEventId}' (so re-runs dedupe per-storm)
--
-- ASSUMPTION CALLED OUT:
--   "yearBuilt is original roof installation date" — true for the vast majority
--   of properties (a roof is part of the original construction). The only common
--   counter-example is a property where the building was substantially renovated
--   later, in which case yearBuilt may point to a structural milestone rather
--   than the current roof. The v2 blend treats this as a FIRST_INSTALL prior
--   anyway, so the implied-replacement signal cleanly upgrades when the storm
--   evidence supports it.
--
-- IDEMPOTENCY:
--   property_signals has unique constraint on
--     (propertyId, signalType, source, sourceRecordId).
--   sourceRecordId = 'storm:{stormEventId}' makes per-storm-per-property unique.
--   Re-running this SQL is safe; it ON CONFLICT DO NOTHING.
--
-- Usage:
--   psql ... -f scripts/compute-storm-implied-roof-signals.sql
-- =====================================================================

\timing on

WITH eligible AS (
  -- One row per (property, storm) pair that meets severity threshold and is
  -- inside the property's lifetime.
  SELECT
    p.id                                               AS property_id,
    se.id                                              AS storm_event_id,
    se.date                                            AS storm_date,
    se.type                                            AS storm_type,
    se."hailSizeInches"                                AS hail_in,
    se."windSpeedMph"                                  AS wind_mph,
    se."tornadoFScale"                                 AS tornado_scale,
    ps."distanceMeters"                                AS distance_m,
    p."yearBuilt"                                      AS year_built,
    -- severity → confidence mapping. Order checks from strongest to weakest.
    CASE
      WHEN se.type = 'TORNADO' AND se."tornadoFScale" IN ('EF2','EF3','EF4','EF5')                     THEN 0.85
      WHEN se.type = 'HAIL'    AND se."hailSizeInches" >= 2.0                                          THEN 0.70
      WHEN se.type = 'TORNADO' AND se."tornadoFScale" = 'EF1'                                          THEN 0.70
      WHEN se.type = 'HAIL'    AND se."hailSizeInches" >= 1.5                                          THEN 0.55
      WHEN se.type = 'WIND'    AND se."windSpeedMph"   >= 80                                           THEN 0.55
      WHEN se.type = 'HAIL'    AND se."hailSizeInches" >= 1.0                                          THEN 0.40
      WHEN se.type = 'WIND'    AND se."windSpeedMph"   >= 70                                           THEN 0.40
      ELSE NULL
    END                                                AS confidence
  FROM properties p
  JOIN property_storms ps ON ps."propertyId" = p.id
  JOIN storm_events    se ON se.id = ps."stormEventId"
  WHERE p."yearBuilt" IS NOT NULL
    AND p."yearBuilt" >= 1900
    AND se.date >= make_date(p."yearBuilt", 1, 1)
    AND se.date <= NOW()
    -- Coarse severity prefilter (matches the CASE above)
    AND (
         (se.type = 'HAIL'    AND se."hailSizeInches" >= 1.0)
      OR (se.type = 'WIND'    AND se."windSpeedMph"   >= 70)
      OR (se.type = 'TORNADO' AND se."tornadoFScale" IN ('EF1','EF2','EF3','EF4','EF5'))
    )
),
ranked AS (
  -- ONE most-recent qualifying storm per property. If multiple storms tie on
  -- date, prefer the one with higher confidence.
  SELECT DISTINCT ON (property_id)
    property_id, storm_event_id, storm_date, storm_type,
    hail_in, wind_mph, tornado_scale, distance_m, year_built, confidence
  FROM eligible
  WHERE confidence IS NOT NULL
  ORDER BY property_id, storm_date DESC, confidence DESC
)
INSERT INTO property_signals
  (id, "propertyId", "signalType", "signalValue", "signalDate", confidence, source, "sourceRecordId")
SELECT
  -- 25-char cuid-ish id
  'c' || substr(md5(property_id || storm_event_id || 'storm-implied'), 1, 24),
  property_id,
  'implied_replacement_post_storm',
  jsonb_build_object(
    'stormEventId',  storm_event_id,
    'stormType',     storm_type,
    'hailInches',    hail_in,
    'windMph',       wind_mph,
    'tornadoScale',  tornado_scale,
    'distanceMeters',distance_m,
    'yearBuilt',     year_built,
    'note',          'storm-window inference: roof likely repaired/replaced post-event'
  ),
  storm_date::date,
  confidence::numeric(3,2),
  'storm-window-inference',
  'storm:' || storm_event_id
FROM ranked
ON CONFLICT ("propertyId", "signalType", "source", "sourceRecordId") DO NOTHING;

-- Diagnostics
SELECT 'implied_replacement_post_storm signals total'::text AS metric,
       COUNT(*)::text AS val
FROM property_signals WHERE "signalType" = 'implied_replacement_post_storm'
UNION ALL SELECT 'unique properties covered',
       COUNT(DISTINCT "propertyId")::text
FROM property_signals WHERE "signalType" = 'implied_replacement_post_storm'
UNION ALL SELECT 'avg confidence',
       ROUND(AVG(confidence)::numeric, 2)::text
FROM property_signals WHERE "signalType" = 'implied_replacement_post_storm';

-- Confidence distribution
SELECT confidence, COUNT(*)
FROM property_signals
WHERE "signalType" = 'implied_replacement_post_storm'
GROUP BY 1 ORDER BY 1 DESC;
