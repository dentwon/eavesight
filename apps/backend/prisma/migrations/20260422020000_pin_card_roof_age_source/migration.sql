ALTER TABLE "property_pin_cards" ADD COLUMN IF NOT EXISTS "roofAgeSource" TEXT;

CREATE INDEX IF NOT EXISTS "property_pin_cards_metroCode_roofAgeSource_idx"
  ON "property_pin_cards" ("metroCode", "roofAgeSource");
