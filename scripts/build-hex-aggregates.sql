-- Rebuild property_hex_aggregates for a given metro.
-- Called nightly by MaintenanceProcessor, or manually:
--   psql -v metro="'north-alabama'" -f build-hex-aggregates.sql
-- Idempotent: wipes this metro's aggregates then re-inserts.

BEGIN;

DELETE FROM property_hex_aggregates WHERE "metroCode" = :metro;

-- Resolution 6 — metro zoom
INSERT INTO property_hex_aggregates (
  id, "metroCode", resolution, "h3Cell", n,
  "scoreP50", "scoreP90", "scoreMax",
  "dormantCount", "hailMaxInches", "avgRoofAge",
  "centerLat", "centerLon"
)
SELECT
  'hex_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22),
  :metro,
  6,
  "h3r6",
  COUNT(*)::int,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY "score") FILTER (WHERE "score" IS NOT NULL),
  percentile_cont(0.9)  WITHIN GROUP (ORDER BY "score") FILTER (WHERE "score" IS NOT NULL),
  MAX("score"),
  COUNT(*) FILTER (WHERE "dormantFlag" = TRUE)::int,
  MAX("hailExposureIndex"),
  AVG(GREATEST(0, 2026 - COALESCE("yearBuilt", 2026))),
  AVG(lat), AVG(lon)
FROM properties
WHERE "metroCode" = :metro AND "h3r6" IS NOT NULL
GROUP BY "h3r6";

-- Resolution 8 — neighborhood zoom
INSERT INTO property_hex_aggregates (
  id, "metroCode", resolution, "h3Cell", n,
  "scoreP50", "scoreP90", "scoreMax",
  "dormantCount", "hailMaxInches", "avgRoofAge",
  "centerLat", "centerLon"
)
SELECT
  'hex_' || substr(md5(random()::text || clock_timestamp()::text), 1, 22),
  :metro,
  8,
  "h3r8",
  COUNT(*)::int,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY "score") FILTER (WHERE "score" IS NOT NULL),
  percentile_cont(0.9)  WITHIN GROUP (ORDER BY "score") FILTER (WHERE "score" IS NOT NULL),
  MAX("score"),
  COUNT(*) FILTER (WHERE "dormantFlag" = TRUE)::int,
  MAX("hailExposureIndex"),
  AVG(GREATEST(0, 2026 - COALESCE("yearBuilt", 2026))),
  AVG(lat), AVG(lon)
FROM properties
WHERE "metroCode" = :metro AND "h3r8" IS NOT NULL
GROUP BY "h3r8";

COMMIT;

SELECT resolution, COUNT(*) AS hexes FROM property_hex_aggregates WHERE "metroCode" = :metro GROUP BY resolution;
