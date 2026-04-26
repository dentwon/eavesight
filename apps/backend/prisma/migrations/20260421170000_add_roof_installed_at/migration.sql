-- Add roof-install anchor fields to properties.
-- Populated from CoC new-construction records, future trade-permit reroofs, and
-- (eventually) manual user input. When present, takes precedence over the
-- yearBuilt-based roof-age heuristic.

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "roofInstalledAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "roofInstalledSource" TEXT;

CREATE INDEX IF NOT EXISTS "properties_roofInstalledAt_idx"
  ON "properties" ("roofInstalledAt")
  WHERE "roofInstalledAt" IS NOT NULL;
