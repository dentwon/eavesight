-- Additive-only: roof area + size class denormalized on Property for fast UI filtering.
-- Data already populated from building_footprints during Pass F.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "roofAreaSqft" double precision;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "roofSizeClass" text;
CREATE INDEX IF NOT EXISTS "properties_roofSizeClass_idx" ON "properties"("roofSizeClass");
