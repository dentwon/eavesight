-- CreateEnum
CREATE TYPE "DataConfidence" AS ENUM ('VERIFIED', 'ENRICHED', 'DEED_FLOOR', 'SUBDIV_PLAT', 'NEIGHBOR_KNN', 'ACS_MEDIAN', 'RATIO_GUESS', 'NONE');

-- AlterTable
ALTER TABLE "properties"
  ADD COLUMN "yearBuiltConfidence" "DataConfidence" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "yearBuiltSource" TEXT;

-- AlterTable
ALTER TABLE "property_enrichments"
  ADD COLUMN "medianYearBuilt" INTEGER;

-- Index to help confidence-aware queries (e.g. "where yearBuilt is VERIFIED")
CREATE INDEX IF NOT EXISTS "properties_yearBuiltConfidence_idx" ON "properties" ("yearBuiltConfidence");
