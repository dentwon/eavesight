-- Metros registry + H3 hex aggregates + pin-card cache.
--
-- Design notes:
--   * Every read endpoint is scoped by metro_code. Adding a new market
--     (Nashville, Austin, Atlanta) = one INSERT into metros + run the
--     per-metro pipeline scripts. No code changes.
--   * H3 cells pre-computed (r6 ~36 km^2, r8 ~0.7 km^2) stored on properties
--     so tile/aggregate generation is a cheap GROUP BY, not a geospatial join.
--   * property_pin_cards is denormalized JSONB — 1 row read serves the entire
--     pin-click panel. Rebuilt nightly alongside the score-collapse job.
--   * All new tables / indexes use IF NOT EXISTS so the migration is idempotent.

-- --------------------------------------------------------------------------
-- 1) metros — registry of launched / planned markets
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "metros" (
  "code"         TEXT PRIMARY KEY,               -- url-safe: 'north-alabama'
  "name"         TEXT NOT NULL,                  -- display: 'North Alabama'
  "stateCodes"   TEXT[] NOT NULL,                -- ['AL']
  "counties"     TEXT[] NOT NULL DEFAULT '{}',   -- ['Madison','Limestone',...]
  "centerLat"    DOUBLE PRECISION NOT NULL,
  "centerLon"    DOUBLE PRECISION NOT NULL,
  "bboxMinLat"   DOUBLE PRECISION NOT NULL,
  "bboxMaxLat"   DOUBLE PRECISION NOT NULL,
  "bboxMinLon"   DOUBLE PRECISION NOT NULL,
  "bboxMaxLon"   DOUBLE PRECISION NOT NULL,
  "defaultZoom"  INTEGER NOT NULL DEFAULT 9,
  "tier"         TEXT NOT NULL DEFAULT 'free',   -- free / pro / enterprise
  "status"       TEXT NOT NULL DEFAULT 'active', -- active / coming_soon / archived
  "launchedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "metros_status_idx" ON "metros" ("status");

-- --------------------------------------------------------------------------
-- 2) Property H3 columns — enable cheap aggregation
-- --------------------------------------------------------------------------
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "h3r6" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "h3r8" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "metroCode" TEXT;

CREATE INDEX IF NOT EXISTS "properties_h3r6_idx"      ON "properties" ("h3r6");
CREATE INDEX IF NOT EXISTS "properties_h3r8_idx"      ON "properties" ("h3r8");
CREATE INDEX IF NOT EXISTS "properties_metroCode_idx" ON "properties" ("metroCode");
-- Common query shape: top-N by score within a metro
CREATE INDEX IF NOT EXISTS "properties_metro_score_idx"
  ON "properties" ("metroCode", "score" DESC NULLS LAST)
  WHERE "score" IS NOT NULL;

-- --------------------------------------------------------------------------
-- 3) property_hex_aggregates — pre-computed rollups powering map tiles
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "property_hex_aggregates" (
  "id"                TEXT PRIMARY KEY,
  "metroCode"         TEXT NOT NULL REFERENCES "metros"("code") ON DELETE CASCADE,
  "resolution"        INTEGER NOT NULL,     -- H3 resolution (6 or 8)
  "h3Cell"            TEXT NOT NULL,        -- H3 index as hex string
  "n"                 INTEGER NOT NULL DEFAULT 0,
  "scoreP50"          DOUBLE PRECISION,
  "scoreP90"          DOUBLE PRECISION,
  "scoreMax"          DOUBLE PRECISION,
  "dormantCount"      INTEGER NOT NULL DEFAULT 0,
  "hailMaxInches"     DOUBLE PRECISION,
  "avgRoofAge"        DOUBLE PRECISION,
  "centerLat"         DOUBLE PRECISION NOT NULL,
  "centerLon"         DOUBLE PRECISION NOT NULL,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("metroCode", "resolution", "h3Cell")
);

CREATE INDEX IF NOT EXISTS "hex_agg_metro_res_idx"
  ON "property_hex_aggregates" ("metroCode", "resolution");

-- --------------------------------------------------------------------------
-- 4) property_pin_cards — denormalized pin-click payload
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "property_pin_cards" (
  "propertyId"    TEXT PRIMARY KEY REFERENCES "properties"("id") ON DELETE CASCADE,
  "metroCode"     TEXT REFERENCES "metros"("code") ON DELETE SET NULL,
  "payloadFree"   JSONB NOT NULL,            -- what free-tier users see
  "payloadPro"    JSONB NOT NULL,            -- what pro-tier users see (unmasked)
  "score"         DOUBLE PRECISION,
  "dormantFlag"   BOOLEAN NOT NULL DEFAULT FALSE,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "pin_cards_metro_idx" ON "property_pin_cards" ("metroCode");
CREATE INDEX IF NOT EXISTS "pin_cards_score_idx"
  ON "property_pin_cards" ("metroCode", "score" DESC NULLS LAST)
  WHERE "score" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "pin_cards_dormant_idx"
  ON "property_pin_cards" ("metroCode") WHERE "dormantFlag" = TRUE;

-- --------------------------------------------------------------------------
-- 5) Seed: north-alabama (first launch metro)
--     Huntsville + North AL counties. BBox covers Athens -> Scottsboro.
-- --------------------------------------------------------------------------
INSERT INTO "metros" (
  "code", "name", "stateCodes", "counties",
  "centerLat", "centerLon",
  "bboxMinLat", "bboxMaxLat", "bboxMinLon", "bboxMaxLon",
  "defaultZoom", "tier", "status", "launchedAt"
) VALUES (
  'north-alabama',
  'North Alabama',
  ARRAY['AL'],
  ARRAY['Madison','Limestone','Morgan','Marshall','Jackson','Lauderdale','Colbert','Franklin','Lawrence','Cullman','DeKalb'],
  34.7304, -86.5861,  -- Huntsville-ish
  34.10, 35.10, -88.10, -85.50,
  9, 'free', 'active', NOW()
)
ON CONFLICT ("code") DO NOTHING;

-- Placeholder for next metros (commented — activate when ready)
-- INSERT INTO "metros" VALUES ('nashville', 'Nashville', ARRAY['TN'], ...);
-- INSERT INTO "metros" VALUES ('austin',    'Austin',    ARRAY['TX'], ...);
-- INSERT INTO "metros" VALUES ('atlanta',   'Atlanta',   ARRAY['GA'], ...);

-- --------------------------------------------------------------------------
-- 6) Permissions: wire app role so H3 assigner + pin-card builder can work.
--    Without this, ~/StormVault/scripts/assign-h3-metro.js fails with
--    'permission denied for table metros' on a fresh deploy.
--    The app connects as 'stormvault' (see DATABASE_URL); migrations run as
--    the DB owner (dentwon). This block bridges the gap.
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stormvault') THEN
    CREATE ROLE stormvault LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO stormvault;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON "metros", "property_hex_aggregates", "property_pin_cards"
  TO stormvault;

-- Future-proof: any additional tables / sequences created later in this
-- schema inherit the same grant so the app role never has to be re-GRANTed
-- manually after a migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES TO stormvault;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO stormvault;
