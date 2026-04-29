-- Adds lead_priority + roof_age_v2 fields to property_pin_cards as top-level
-- columns for fast filtering / coloring without going through payloadPro JSONB.
-- Each field is also embedded in payloadPro for clients that read the JSON.
--
-- All ADD COLUMN are IF NOT EXISTS so this is safe to re-run.

ALTER TABLE "property_pin_cards"
  ADD COLUMN IF NOT EXISTS "priorityRank"          int,
  ADD COLUMN IF NOT EXISTS "priorityLabel"         text,
  ADD COLUMN IF NOT EXISTS "urgencyTier"           text,
  ADD COLUMN IF NOT EXISTS "severitySubrank"       int,
  ADD COLUMN IF NOT EXISTS "daysUntilClaimClose"   int,
  ADD COLUMN IF NOT EXISTS "evidenceClass"         text,
  ADD COLUMN IF NOT EXISTS "roofAgeYearsV2"        int,
  ADD COLUMN IF NOT EXISTS "roofAgeConfidenceV2"   numeric(4,2),
  ADD COLUMN IF NOT EXISTS "bestEstimateYearV2"    int,
  ADD COLUMN IF NOT EXISTS "bestEstimateKindV2"    text;

-- Fast top-N by priority within metro (the most common dashboard query)
CREATE INDEX IF NOT EXISTS "pin_cards_priority_idx"
  ON "property_pin_cards" ("metroCode", "priorityRank")
  WHERE "priorityRank" IS NOT NULL;

-- Fast filter for "BURNING leads in zip" (territory assignment)
CREATE INDEX IF NOT EXISTS "pin_cards_priority_burning_idx"
  ON "property_pin_cards" ("metroCode", "priorityRank", "severitySubrank", "daysUntilClaimClose")
  WHERE "priorityRank" IN (1, 2);

-- Fast filter "show me old roofs that need replacing"
CREATE INDEX IF NOT EXISTS "pin_cards_age_v2_idx"
  ON "property_pin_cards" ("metroCode", "roofAgeYearsV2" DESC)
  WHERE "roofAgeYearsV2" IS NOT NULL;
