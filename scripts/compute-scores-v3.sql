-- compute-scores-v3.sql (2026-04-24)
-- Scorer v3. Pushes opportunity ceiling from ~67 (v2) -> 100 by adding:
--   - SPC permissive hail/wind/tornado signals (203K+ parcels now have these)
--   - Probate trigger (ESTATE/HEIRS/TRUST in ownerHistory or ownerFullName)
--   - Recent-transfer flag (ownerHistory shows owner change within 24mo)
--   - Investor-flip flag (3+ distinct owners in last 60mo)
--   - Tenure years (since last owner change)
-- scoreReasons jsonb is enriched with human-readable bullets so the pin-card
-- transparency panel can explain WHY a property scored the way it did.
--
-- Populates/updates:
--   solarScore, ownerOccupied, urgencyScore, revenuePotential, opportunityScore,
--   score (mirrors opportunityScore 0-100 rounded), scoreReasons
--
-- Run: psql -U eavesight -h localhost -p 5433 -d eavesight -f compute-scores-v3.sql
-- Runtime ~90s on 242K properties per earlier v2 timing + ~30s for ownerHistory scans.

\timing on

BEGIN;

-- ==== 1. Solar score (unchanged from v2) ====
WITH s AS (
  SELECT id,
    COALESCE("roofAreaSqft", sqft, 2500) * 0.6 * 15 * 0.316 * 1200 / 1000.0 AS kwh_year
  FROM properties
),
bounds AS (
  SELECT PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY kwh_year) AS lo,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY kwh_year) AS hi
  FROM s
)
UPDATE properties p
SET "solarScore" = GREATEST(0, LEAST(1, (s.kwh_year - b.lo) / NULLIF(b.hi - b.lo, 0)))
FROM s, bounds b
WHERE p.id = s.id;

-- ==== 2. ownerOccupied (unchanged from v2) ====
WITH normed AS (
  SELECT id,
    regexp_replace(upper(coalesce(address,'')), '[^A-Z0-9]', '', 'g') AS p_norm,
    regexp_replace(upper(coalesce("ownerMailAddress",'')), '[^A-Z0-9]', '', 'g') AS o_norm,
    coalesce(zip,'') AS p_zip,
    coalesce("ownerMailZip",'') AS o_zip
  FROM properties
)
UPDATE properties p
SET "ownerOccupied" =
  CASE
    WHEN n.o_norm = '' THEN NULL
    WHEN n.p_zip = n.o_zip AND length(n.p_norm) >= 5 AND position(substring(n.p_norm, 1, 5) in n.o_norm) > 0 THEN true
    WHEN n.p_zip = n.o_zip AND length(n.o_norm) >= 5 AND position(substring(n.o_norm, 1, 5) in n.p_norm) > 0 THEN true
    ELSE false
  END
FROM normed n
WHERE p.id = n.id;

-- ==== 3. Urgency score v3 (0-100) ====
--   SPC hail:     0-30  (count * 2 + maxInches * 6, capped)
--   SPC W/T:      0-15  (wind + tornado*3, capped)
--   MRMS strict:  0-15  (hailExposureIndex * 3, capped)
--   Roof age:     0-25  ((2026 - yearBuilt) * 0.8, capped ~31yr)
--   Recency:      0-15  (hail within 18mo OR tornado within 24mo)
UPDATE properties p
SET "urgencyScore" = LEAST(100,
    LEAST(30, COALESCE(p."spcHailCount", 0) * 2 + COALESCE(p."spcHailMaxInches", 0) * 6)
  + LEAST(15, COALESCE(p."spcWindCount", 0) + COALESCE(p."spcTornadoCount", 0) * 3)
  + LEAST(15, COALESCE(p."hailExposureIndex", 0) * 3)
  + LEAST(25, GREATEST(0, (2026 - COALESCE(p."yearBuilt", 2010)) * 0.8))
  + CASE
      WHEN p."spcHailLastDate" >= (CURRENT_DATE - INTERVAL '18 months') THEN 10
      ELSE 0
    END
  + CASE
      WHEN p."spcTornadoLastDate" >= (CURRENT_DATE - INTERVAL '24 months') THEN 5
      ELSE 0
    END
);

-- ==== 4. Revenue potential (unchanged from v2) ====
UPDATE properties p
SET "revenuePotential" = (
  COALESCE(p."roofAreaSqft", p.sqft * 1.15, 2500) * 7.5
  * CASE p."roofSizeClass"
      WHEN 'RESIDENTIAL' THEN 1.0
      WHEN 'LARGE_RESIDENTIAL' THEN 1.15
      WHEN 'SMALL_COMMERCIAL' THEN 1.3
      WHEN 'MEDIUM_COMMERCIAL' THEN 1.5
      WHEN 'LARGE_COMMERCIAL' THEN 1.75
      WHEN 'WAREHOUSE_INDUSTRIAL' THEN 2.0
      ELSE 1.0
    END
);

-- ==== 5. Trigger signals (derived from ownerHistory + ownerFullName) ====
-- Cached in a temp table so we can use them in both urgency boost and scoreReasons.
DROP TABLE IF EXISTS _trig;
CREATE TEMP TABLE _trig AS
WITH oh AS (
  SELECT
    p.id,
    p."ownerFullName",
    p."ownerHistory",
    -- latest year in history
    (SELECT MAX((e->>'year')::int)
       FROM jsonb_array_elements(COALESCE(p."ownerHistory",'[]'::jsonb)) e) AS latest_year,
    -- latest owner (normalized)
    (SELECT upper(e->>'owner')
       FROM jsonb_array_elements(COALESCE(p."ownerHistory",'[]'::jsonb)) e
       ORDER BY (e->>'year')::int DESC
       LIMIT 1) AS latest_owner,
    -- prior distinct owner (for transfer detection)
    (WITH ordered AS (
        SELECT upper(e->>'owner') o, (e->>'year')::int y
        FROM jsonb_array_elements(COALESCE(p."ownerHistory",'[]'::jsonb)) e
     ),
     ranked AS (
        SELECT o, y, LAG(o) OVER (ORDER BY y DESC) prev_o
        FROM ordered
     )
     SELECT MIN(y) FROM ranked WHERE prev_o IS NOT NULL AND prev_o <> o) AS last_transfer_year,
    -- count distinct owners in last 60 months (approx 5 years back from latest)
    (SELECT COUNT(DISTINCT upper(e->>'owner'))
       FROM jsonb_array_elements(COALESCE(p."ownerHistory",'[]'::jsonb)) e
       WHERE (e->>'year')::int >= 2021) AS distinct_owners_5y
  FROM properties p
)
SELECT
  oh.id,
  oh.latest_year,
  oh.last_transfer_year,
  oh.distinct_owners_5y,
  -- probate trigger: ESTATE / HEIRS OF / LIVING TRUST / REVOCABLE TRUST patterns
  (
    COALESCE(oh."ownerFullName",'') ~* '(ESTATE\s+OF|HEIRS\s+OF|LIVING\s+TRUST|REVOCABLE\s+TRUST|FAMILY\s+TRUST|TRUSTEE|DECEASED)'
    OR COALESCE(oh.latest_owner,'') ~ '(ESTATE\s+OF|HEIRS\s+OF|LIVING\s+TRUST|REVOCABLE\s+TRUST|FAMILY\s+TRUST|TRUSTEE|DECEASED)'
  ) AS probate_trigger,
  -- recent transfer: owner change within 24 months
  (oh.last_transfer_year IS NOT NULL
   AND oh.last_transfer_year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 2) AS recent_transfer,
  -- investor flip: 3+ distinct owners in last 5 years
  (oh.distinct_owners_5y >= 3) AS investor_flip
FROM oh;

CREATE INDEX ON _trig (id);
ANALYZE _trig;

-- Trigger bonus (0-60): probate 25 + recent_transfer 15 + investor_flip 20
-- Add to urgency (capped at 100)
UPDATE properties p
SET "urgencyScore" = LEAST(100, COALESCE(p."urgencyScore", 0)
    + CASE WHEN t.probate_trigger THEN 25 ELSE 0 END
    + CASE WHEN t.recent_transfer THEN 15 ELSE 0 END
    + CASE WHEN t.investor_flip THEN 20 ELSE 0 END)
FROM _trig t
WHERE p.id = t.id;

-- ==== 6. Opportunity score v3 (0-100 composite) ====
--   45% urgency, 25% revenue (normalized), 20% trigger bonus,
--   10% ownerOccupied (T=10, F=5, NULL=7) — owner-occupied pays more per job
WITH rev_bounds AS (
  SELECT PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY "revenuePotential") AS lo,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "revenuePotential") AS hi
  FROM properties WHERE "revenuePotential" IS NOT NULL
)
UPDATE properties p
SET "opportunityScore" = GREATEST(0, LEAST(100,
    COALESCE(p."urgencyScore", 0) * 0.45
  + GREATEST(0, LEAST(100,
      (COALESCE(p."revenuePotential",0) - b.lo) / NULLIF(b.hi - b.lo, 0) * 100
    )) * 0.25
  + (
      CASE WHEN t.probate_trigger THEN 25 ELSE 0 END
    + CASE WHEN t.recent_transfer THEN 15 ELSE 0 END
    + CASE WHEN t.investor_flip THEN 20 ELSE 0 END
    ) * 0.20
  + CASE WHEN p."ownerOccupied" IS TRUE THEN 10
         WHEN p."ownerOccupied" IS FALSE THEN 5
         ELSE 7 END
)),
  "score" = ROUND(GREATEST(0, LEAST(100,
    COALESCE(p."urgencyScore", 0) * 0.45
  + GREATEST(0, LEAST(100,
      (COALESCE(p."revenuePotential",0) - b.lo) / NULLIF(b.hi - b.lo, 0) * 100
    )) * 0.25
  + (
      CASE WHEN t.probate_trigger THEN 25 ELSE 0 END
    + CASE WHEN t.recent_transfer THEN 15 ELSE 0 END
    + CASE WHEN t.investor_flip THEN 20 ELSE 0 END
    ) * 0.20
  + CASE WHEN p."ownerOccupied" IS TRUE THEN 10
         WHEN p."ownerOccupied" IS FALSE THEN 5
         ELSE 7 END
  ))::numeric)
FROM rev_bounds b, _trig t
WHERE t.id = p.id;

-- ==== 7. scoreReasons (transparency payload for UI pin-card) ====
UPDATE properties p
SET "scoreReasons" = jsonb_strip_nulls(jsonb_build_object(
  'version', 'v3',
  'computedAt', to_jsonb(NOW()),
  'urgency', jsonb_build_object(
    'score', p."urgencyScore",
    'spcHailCount', p."spcHailCount",
    'spcHailMaxInches', p."spcHailMaxInches",
    'spcHailLastDate', p."spcHailLastDate",
    'spcWindCount', p."spcWindCount",
    'spcTornadoCount', p."spcTornadoCount",
    'spcTornadoLastDate', p."spcTornadoLastDate",
    'hailExposureIndex', p."hailExposureIndex",
    'yearBuilt', p."yearBuilt",
    'yearBuiltSource', p."yearBuiltSource",
    'roofAgeClass', p."roofAgeClass"
  ),
  'triggers', jsonb_build_object(
    'probate', t.probate_trigger,
    'recentTransfer', t.recent_transfer,
    'investorFlip', t.investor_flip,
    'tenureYears', CASE
      WHEN t.last_transfer_year IS NOT NULL
      THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - t.last_transfer_year
      ELSE NULL END
  ),
  'revenue', jsonb_build_object(
    'estimate', p."revenuePotential",
    'roofAreaSqft', p."roofAreaSqft",
    'roofSizeClass', p."roofSizeClass"
  ),
  'occupancy', jsonb_build_object(
    'ownerOccupied', p."ownerOccupied"
  ),
  'bullets', (
    SELECT jsonb_agg(x) FROM (
      SELECT unnest(ARRAY[
        CASE WHEN COALESCE(p."spcHailCount",0) >= 5
             THEN format('%s SPC hail events on record (max %s")',
                         p."spcHailCount", COALESCE(p."spcHailMaxInches",0)::text)
             END,
        CASE WHEN p."spcHailLastDate" >= (CURRENT_DATE - INTERVAL '18 months')
             THEN format('Hail within claim window (%s)', p."spcHailLastDate")
             END,
        CASE WHEN COALESCE(p."spcTornadoCount",0) >= 1
             THEN format('Tornado track(s) overhead: %s event(s), latest %s',
                         p."spcTornadoCount", COALESCE(p."spcTornadoLastDate"::text, 'unknown'))
             END,
        CASE WHEN p."yearBuilt" IS NOT NULL AND (2026 - p."yearBuilt") >= 20
             THEN format('Roof likely >= %s years old (built %s)',
                         2026 - p."yearBuilt", p."yearBuilt")
             END,
        CASE WHEN t.probate_trigger
             THEN 'Probate / estate trigger in owner record'
             END,
        CASE WHEN t.recent_transfer
             THEN 'New owner within last 24 months'
             END,
        CASE WHEN t.investor_flip
             THEN format('Investor rotation: %s distinct owners in 5y', t.distinct_owners_5y)
             END
      ]) AS x
    ) s WHERE x IS NOT NULL
  )
))
FROM _trig t
WHERE t.id = p.id;

-- ==== 8. Coverage snapshot ====
SELECT
  COUNT(*) total,
  COUNT(*) FILTER (WHERE "solarScore" IS NOT NULL) w_solar,
  COUNT(*) FILTER (WHERE "urgencyScore" IS NOT NULL) w_urgency,
  COUNT(*) FILTER (WHERE "revenuePotential" IS NOT NULL) w_revenue,
  COUNT(*) FILTER (WHERE "opportunityScore" IS NOT NULL) w_opp,
  COUNT(*) FILTER (WHERE "ownerOccupied" IS NOT NULL) w_oo,
  COUNT(*) FILTER (WHERE "scoreReasons" ? 'version') w_reasons,
  ROUND(AVG("opportunityScore")::numeric, 2) avg_opp,
  MAX("opportunityScore") max_opp,
  MIN("opportunityScore") min_opp
FROM properties;

-- trigger distribution
SELECT
  COUNT(*) FILTER (WHERE probate_trigger) probate,
  COUNT(*) FILTER (WHERE recent_transfer) recent_transfer,
  COUNT(*) FILTER (WHERE investor_flip)  investor_flip,
  COUNT(*) FILTER (WHERE probate_trigger OR recent_transfer OR investor_flip) any_trigger
FROM _trig;

-- top 10 highest-scoring properties preview
SELECT id, address, "opportunityScore" opp, "urgencyScore" urg,
       "spcHailCount" hail, "spcHailMaxInches" hail_in,
       "spcTornadoCount" tor, "yearBuilt" yb,
       "ownerOccupied" oo
FROM properties
ORDER BY "opportunityScore" DESC NULLS LAST
LIMIT 10;

COMMIT;
