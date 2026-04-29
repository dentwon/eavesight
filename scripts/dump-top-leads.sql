-- =====================================================================
-- dump-top-leads.sql  (2026-04-29)
--
-- Materializes the top sales-actionable leads with full address +
-- storm-context + age into a flat table the dashboard / sales reps
-- can read directly. Refreshes from `lead_priority` + joins property
-- and storm metadata.
--
-- Output table `top_leads_burning` (recreated each run):
--   property_id, address, city, zip, lat, lon,
--   year_built, roof_age_years, age_tier,
--   priority_label, priority_rank, urgency_tier,
--   storm_event_date, storm_type, hail_inches, days_until_claim_window_close,
--   owner_name, mailing_address,
--   metro_score, metro_bucket
--
-- Run: psql -f scripts/dump-top-leads.sql
-- =====================================================================

\timing on

CREATE TABLE IF NOT EXISTS top_leads_burning (
  property_id              text PRIMARY KEY,
  address                  text,
  city                     text,
  zip                      text,
  lat                      double precision,
  lon                      double precision,
  year_built               int,
  roof_age_years           int,
  age_tier                 text,
  priority_label           text,
  priority_rank            int,
  urgency_tier             text,
  storm_event_date         date,
  storm_type               text,
  hail_inches              double precision,
  wind_mph                 double precision,
  tornado_scale            text,
  severity_subrank         int,        -- 1 (tornado EF2+) → 7 (no qualifying)
  days_until_claim_close   int,
  owner_name               text,
  mailing_address          text,
  metro_score              double precision,
  metro_score_bucket       text,
  computed_at              timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS top_leads_subrank_idx ON top_leads_burning (priority_rank, severity_subrank, days_until_claim_close);
CREATE INDEX IF NOT EXISTS top_leads_priority_idx ON top_leads_burning (priority_rank, days_until_claim_close);
CREATE INDEX IF NOT EXISTS top_leads_zip_idx ON top_leads_burning (zip, priority_rank);

BEGIN;
TRUNCATE top_leads_burning;

WITH most_recent_storm AS (
  SELECT DISTINCT ON (ps."propertyId")
    ps."propertyId" AS property_id,
    se.id AS storm_id, se.date AS storm_date, se.type AS storm_type,
    se."hailSizeInches", se."windSpeedMph", se."tornadoFScale",
    ps."distanceMeters"
  FROM property_storms ps
  JOIN storm_events se ON se.id = ps."stormEventId"
  WHERE se.date > NOW() - INTERVAL '24 months'
    AND ((se.type='HAIL'    AND se."hailSizeInches" >= 1.0)
      OR (se.type='WIND'    AND se."windSpeedMph"   >= 70)
      OR (se.type='TORNADO' AND se."tornadoFScale" IN ('EF1','EF2','EF3','EF4','EF5')))
  ORDER BY ps."propertyId", se.date DESC, se."hailSizeInches" DESC NULLS LAST
)
INSERT INTO top_leads_burning
  (property_id, address, city, zip, lat, lon,
   year_built, roof_age_years, age_tier,
   priority_label, priority_rank, urgency_tier,
   storm_event_date, storm_type, hail_inches, wind_mph, tornado_scale,
   severity_subrank,
   days_until_claim_close, owner_name, mailing_address,
   metro_score, metro_score_bucket)
SELECT
  p.id,
  p.address,
  p.city,
  p.zip,
  p.lat, p.lon,
  p."yearBuilt",
  lp.roof_age_years,
  lp.age_tier,
  lp.priority_label,
  lp.priority_rank,
  lp.urgency_tier,
  s.storm_date::date,
  s.storm_type::text,
  s."hailSizeInches",
  s."windSpeedMph",
  s."tornadoFScale",
  -- severity_subrank: 1=highest (tornado EF2+) → 7=lowest (no qualifying storm)
  CASE
    WHEN s.storm_type='TORNADO' AND s."tornadoFScale" IN ('EF2','EF3','EF4','EF5') THEN 1
    WHEN s.storm_type='TORNADO' AND s."tornadoFScale" = 'EF1'                       THEN 2
    WHEN s.storm_type='HAIL'    AND s."hailSizeInches" >= 2.0                       THEN 3
    WHEN s.storm_type='HAIL'    AND s."hailSizeInches" >= 1.5                       THEN 4
    WHEN s.storm_type='WIND'    AND s."windSpeedMph"   >= 80                        THEN 5
    WHEN s.storm_type='HAIL'    AND s."hailSizeInches" >= 1.0                       THEN 6
    WHEN s.storm_type='WIND'    AND s."windSpeedMph"   >= 70                        THEN 7
    ELSE 9
  END,
  lp.insurance_days_remaining,
  p."ownerFullName",
  COALESCE(p."ownerMailAddress", '') ||
    CASE WHEN p."ownerMailCity" IS NOT NULL THEN ', ' || p."ownerMailCity" ELSE '' END ||
    CASE WHEN p."ownerMailState" IS NOT NULL THEN ', ' || p."ownerMailState" ELSE '' END ||
    CASE WHEN p."ownerMailZip" IS NOT NULL THEN ' ' || p."ownerMailZip" ELSE '' END,
  p.score,
  CASE
    WHEN p.score >= 0.75 THEN 'hot'
    WHEN p.score >= 0.50 THEN 'warm'
    WHEN p.score >= 0.25 THEN 'cool'
    ELSE 'cold'
  END
FROM lead_priority lp
JOIN properties p ON p.id = lp.property_id
LEFT JOIN most_recent_storm s ON s.property_id = lp.property_id
WHERE lp.priority_rank IN (1, 2, 3, 4)  -- BURNING + URGENT + LIVE
;

COMMIT;

-- Diagnostics
SELECT priority_label,
       COUNT(*) AS n,
       MIN(days_until_claim_close) AS days_min,
       MAX(days_until_claim_close) AS days_max,
       MIN(roof_age_years) AS age_min,
       MAX(roof_age_years) AS age_max,
       AVG(metro_score)::numeric(4,2) AS avg_metro_score
FROM top_leads_burning GROUP BY 1 ORDER BY priority_label;

-- Top 20 sample (sorted by severity sub-rank)
SELECT priority_label, severity_subrank, days_until_claim_close, roof_age_years,
       address, city, zip, storm_type, hail_inches, tornado_scale, storm_event_date
FROM top_leads_burning
WHERE priority_rank IN (1, 2)
ORDER BY priority_rank, severity_subrank, days_until_claim_close, roof_age_years DESC
LIMIT 20;

-- Severity-rank sub-distribution
SELECT priority_label, severity_subrank, COUNT(*)
FROM top_leads_burning WHERE priority_rank IN (1, 2)
GROUP BY 1, 2 ORDER BY 1, 2;
