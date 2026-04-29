-- Add Microsoft Building Footprints v2 capture-date provenance to
-- existing footprint rows. The columns were ALTER-added live during the
-- 2026-04-29 overnight backfill (see scripts/backfill-ms-v2-capture-dates.js
-- and docs/OVERNIGHT_2026-04-29.md); this migration brings the Prisma
-- schema timeline in sync without touching live data.
--
--   release                       1 = early MS BFP set, 2 = later refresh
--   capture_dates_range_start     start of the date range Microsoft
--                                 acquired the imagery used to extract
--                                 this polygon (NULL for release=1 rows
--                                 because the v1 source had no date)
--   capture_dates_range_end       end of that date range — useful as a
--                                 "building existed by year X" anchor
--                                 in the roof-age v2 blend
--
-- The IF NOT EXISTS guards make this safe to re-run on environments where
-- the columns were added by the live backfill earlier.

ALTER TABLE "building_footprints"
  ADD COLUMN IF NOT EXISTS "capture_dates_range_start" date,
  ADD COLUMN IF NOT EXISTS "capture_dates_range_end"   date,
  ADD COLUMN IF NOT EXISTS "release"                   int;
