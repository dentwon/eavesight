-- Viewport-first serving: indexes to support bbox + score queries
-- without hitting property_pin_cards at all.
--
-- Phase 1 of the re-architecture described in the /m/[metro] scaling plan:
--   zoom ≥ 13 → live query against 'properties' in viewport bbox
--               ordered by score DESC, limited to top-N.
-- At a neighborhood viewport (~500 properties visible) the planner uses
-- the metro+lat+lon index for the range scan, then sorts the small result.
-- Expected: <50 ms on HDD even with a cold cache.

-- 1. Bbox range scan within a metro
CREATE INDEX IF NOT EXISTS properties_metro_bbox_idx
  ON properties ("metroCode", lat, lon)
  WHERE lat IS NOT NULL AND lon IS NOT NULL;

-- 2. Partial index for dormant-only mode (common filter, much smaller set)
CREATE INDEX IF NOT EXISTS properties_metro_dormant_score_idx
  ON properties ("metroCode", score DESC NULLS LAST)
  WHERE "dormantFlag" = TRUE;

-- 3. Partial index for dormant-in-bbox
CREATE INDEX IF NOT EXISTS properties_metro_dormant_bbox_idx
  ON properties ("metroCode", lat, lon)
  WHERE "dormantFlag" = TRUE;

-- 4. Grant the app role (stormvault) — migration runs as owner (dentwon)
GRANT SELECT ON properties TO stormvault;
