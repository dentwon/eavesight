-- =====================================================================
-- load-mls-roof-signals.sql  (2026-04-29)
--
-- Bulk-resolve _mls_listings_raw rows that carry roof signals to property
-- IDs via lat/lon proximity (~50m), and INSERT property_signals.
-- Replaces the slow per-row JS loader that was blocked by ILIKE contention.
--
-- Three signal kinds:
--   mls_roof_year        — listing has explicit "new roof YYYY" — conf 0.80
--   mls_roof_material    — metal-roof flag                       — conf 0.60
--   mls_roof_mention     — new-roof / recent-replace / warranty  — conf 0.50
--
-- Idempotent via property_signals (propertyId, signalType, source, sourceRecordId).
-- =====================================================================

WITH resolved AS (
  -- Bulk resolve: nearest property within ~50m of the listing's lat/lon.
  SELECT DISTINCT ON (m.id)
    m.id          AS listing_id,
    m.source_id   AS source_id,
    p.id          AS property_id,
    m.address, m.city, m.zip, m.year_built AS listing_year_built,
    m.roof_year, m.roof_year_quote, m.roof_category, m.roof_all_quotes,
    m.status      AS listing_status,
    (p.lat - m.lat) * (p.lat - m.lat) + (p.lon - m.lon) * (p.lon - m.lon) AS sqd
  FROM _mls_listings_raw m
  JOIN properties p
    ON p.lat BETWEEN m.lat - 0.0005 AND m.lat + 0.0005
   AND p.lon BETWEEN m.lon - 0.0005 AND m.lon + 0.0005
  WHERE m.lat IS NOT NULL AND m.lon IS NOT NULL
    AND (m.roof_year IS NOT NULL OR m.roof_category IS NOT NULL)
  ORDER BY m.id, sqd
),
classified AS (
  SELECT
    listing_id, source_id, property_id, listing_year_built,
    roof_year, roof_year_quote, roof_category, roof_all_quotes, listing_status,
    CASE
      WHEN roof_year IS NOT NULL AND roof_year >= 1950 AND roof_year <= 2030
        THEN 'mls_roof_year'
      WHEN roof_category = 'metal-roof'
        THEN 'mls_roof_material'
      WHEN roof_category IN ('new-roof','recent-replace','warranty-implied')
        THEN 'mls_roof_mention'
      ELSE NULL
    END AS signal_type,
    CASE
      WHEN roof_year IS NOT NULL AND roof_year >= 1950 AND roof_year <= 2030 THEN 0.80
      WHEN roof_category = 'metal-roof' THEN 0.60
      WHEN roof_category IN ('new-roof','recent-replace','warranty-implied') THEN 0.50
      ELSE NULL
    END AS confidence,
    CASE
      WHEN roof_year IS NOT NULL AND roof_year >= 1950 AND roof_year <= 2030
        THEN make_date(roof_year, 6, 1)
      ELSE NULL
    END AS signal_date
  FROM resolved
)
INSERT INTO property_signals
  (id, "propertyId", "signalType", "signalValue", "signalDate", confidence, source, "sourceRecordId")
SELECT
  'c' || substr(md5(property_id || COALESCE(source_id, listing_id::text)), 1, 24),
  property_id,
  signal_type,
  jsonb_build_object(
    'listing_id',         listing_id,
    'source_id',          source_id,
    'roof_year',          roof_year,
    'roof_year_quote',    roof_year_quote,
    'roof_category',      roof_category,
    'roof_all_quotes',    roof_all_quotes,
    'listing_status',     listing_status,
    'listing_year_built', listing_year_built
  ),
  signal_date,
  confidence::numeric(3,2),
  'mls.redfin',
  'redfin:' || COALESCE(source_id, listing_id::text)
FROM classified
WHERE signal_type IS NOT NULL
  -- Sanity: don't accept a roof_year claim that's BEFORE the listing's yearBuilt
  AND (signal_type != 'mls_roof_year' OR listing_year_built IS NULL OR roof_year >= listing_year_built - 1)
ON CONFLICT ("propertyId", "signalType", "source", "sourceRecordId") DO NOTHING;

-- Diagnostics
SELECT "signalType", COUNT(*) AS n, ROUND(AVG(confidence)::numeric, 2) AS avg_conf
FROM property_signals
WHERE source = 'mls.redfin'
GROUP BY 1 ORDER BY 2 DESC;
