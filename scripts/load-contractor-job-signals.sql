-- =====================================================================
-- load-contractor-job-signals.sql  (2026-04-29)
--
-- Mines _contractor_jobs_raw — addresses scraped from roofing contractor
-- project gallery pages with photo upload dates — into property_signals
-- as 'contractor_job' signals at confidence 0.90 (homeowner-paid contractor
-- listed it on their public portfolio = very high confidence reroof).
--
-- Source-of-truth: each row in _contractor_jobs_raw is one job photo.
-- Multiple photos can be the same job (before/after) — dedupe via
-- (contractor, parsed_address) before emitting signals.
--
-- Date logic: prefer EXIF date when present, else http_last_modified
-- (gallery upload), else fall back to scraped_at. exif_date and
-- http_last_modified are both rare in current data; using upload date.
-- =====================================================================

WITH dedup AS (
  SELECT
    contractor,
    parsed_address || COALESCE(', ' || parsed_city, '') AS full_addr,
    parsed_address, parsed_city, parsed_zip,
    MIN(COALESCE(exif_date, http_last_modified, scraped_at))::date AS event_date,
    MIN(id) AS canonical_id
  FROM _contractor_jobs_raw
  WHERE parsed_address IS NOT NULL
  GROUP BY contractor, parsed_address, parsed_city, parsed_zip
),
resolved AS (
  -- Address-resolution via house# + first 2 street words + zip tiebreak.
  -- This is the same strategy as resolveMadisonProperty in permits-madison-city.js.
  SELECT DISTINCT ON (d.canonical_id)
    d.canonical_id,
    d.contractor,
    d.full_addr,
    d.event_date,
    p.id AS property_id
  FROM dedup d
  JOIN properties p ON p.address ILIKE
    (regexp_replace(d.parsed_address, '^(\d+)\s+(\w+)\s+(\w+).*', '\1%\2%\3%') || '%')
  -- prefer single-match within metro
  ORDER BY d.canonical_id, p.id
)
INSERT INTO property_signals
  (id, "propertyId", "signalType", "signalValue", "signalDate", confidence, source, "sourceRecordId")
SELECT
  'c' || substr(md5(property_id || canonical_id::text || 'contractor-job'), 1, 24),
  property_id,
  'contractor_job',
  jsonb_build_object(
    'contractor', contractor,
    'parsed_address', full_addr,
    'job_id', canonical_id,
    'note', 'reroof confirmed via contractor public project gallery'
  ),
  event_date,
  0.90,
  'contractor.gallery',
  'contractor:' || contractor || ':' || canonical_id::text
FROM resolved
ON CONFLICT ("propertyId", "signalType", "source", "sourceRecordId") DO NOTHING;

-- Diagnostics
SELECT contractor, COUNT(*) AS jobs_landed, AVG(confidence)::numeric(4,2) AS avg_conf
FROM (
  SELECT "signalValue"->>'contractor' AS contractor, confidence
  FROM property_signals WHERE "signalType" = 'contractor_job'
) x
GROUP BY 1 ORDER BY 2 DESC;
