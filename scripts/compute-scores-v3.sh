#!/bin/bash
# compute-scores-v3.sh (2026-04-24)
# Runs scorer v3 as a sequence of independent auto-committed transactions so
# the Madison scraper (which is writing to properties concurrently) can
# interleave its per-row updates. Each UPDATE still takes a row-level lock
# but holds it for seconds, not 15+ minutes.
#
# Strategy:
#   - build _trig as an UNLOGGED physical table (not TEMP)
#   - run each UPDATE statement as its own psql invocation (auto-commit)
#   - chunk the big UPDATEs by id hash so each statement touches ~8K rows
#
# Usage: bash compute-scores-v3.sh

set -e
export PGPASSWORD=eavesight
PSQL="psql -U eavesight -h localhost -p 5433 -d eavesight -v ON_ERROR_STOP=1 -c"

echo "==== 1. Solar score ===="
$PSQL "
WITH s AS (
  SELECT id,
    COALESCE(\"roofAreaSqft\", sqft, 2500) * 0.6 * 15 * 0.316 * 1200 / 1000.0 AS kwh_year
  FROM properties
),
bounds AS (
  SELECT PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY kwh_year) AS lo,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY kwh_year) AS hi
  FROM s
)
UPDATE properties p
SET \"solarScore\" = GREATEST(0, LEAST(1, (s.kwh_year - b.lo) / NULLIF(b.hi - b.lo, 0)))
FROM s, bounds b
WHERE p.id = s.id;"

echo "==== 2. ownerOccupied ===="
$PSQL "
WITH normed AS (
  SELECT id,
    regexp_replace(upper(coalesce(address,'')), '[^A-Z0-9]', '', 'g') AS p_norm,
    regexp_replace(upper(coalesce(\"ownerMailAddress\",'')), '[^A-Z0-9]', '', 'g') AS o_norm,
    coalesce(zip,'') AS p_zip,
    coalesce(\"ownerMailZip\",'') AS o_zip
  FROM properties
)
UPDATE properties p
SET \"ownerOccupied\" =
  CASE
    WHEN n.o_norm = '' THEN NULL
    WHEN n.p_zip = n.o_zip AND length(n.p_norm) >= 5 AND position(substring(n.p_norm, 1, 5) in n.o_norm) > 0 THEN true
    WHEN n.p_zip = n.o_zip AND length(n.o_norm) >= 5 AND position(substring(n.o_norm, 1, 5) in n.p_norm) > 0 THEN true
    ELSE false
  END
FROM normed n
WHERE p.id = n.id;"

echo "==== 3. Revenue potential ===="
$PSQL "
UPDATE properties p
SET \"revenuePotential\" = (
  COALESCE(p.\"roofAreaSqft\", p.sqft * 1.15, 2500) * 7.5
  * CASE p.\"roofSizeClass\"
      WHEN 'RESIDENTIAL' THEN 1.0
      WHEN 'LARGE_RESIDENTIAL' THEN 1.15
      WHEN 'SMALL_COMMERCIAL' THEN 1.3
      WHEN 'MEDIUM_COMMERCIAL' THEN 1.5
      WHEN 'LARGE_COMMERCIAL' THEN 1.75
      WHEN 'WAREHOUSE_INDUSTRIAL' THEN 2.0
      ELSE 1.0
    END
);"

echo "==== 4. Urgency score v3 (base) ===="
$PSQL "
UPDATE properties p
SET \"urgencyScore\" = LEAST(100,
    LEAST(30, COALESCE(p.\"spcHailCount\", 0) * 2 + COALESCE(p.\"spcHailMaxInches\", 0) * 6)
  + LEAST(15, COALESCE(p.\"spcWindCount\", 0) + COALESCE(p.\"spcTornadoCount\", 0) * 3)
  + LEAST(15, COALESCE(p.\"hailExposureIndex\", 0) * 3)
  + LEAST(25, GREATEST(0, (2026 - COALESCE(p.\"yearBuilt\", 2010)) * 0.8))
  + CASE WHEN p.\"spcHailLastDate\" >= (CURRENT_DATE - INTERVAL '18 months') THEN 10 ELSE 0 END
  + CASE WHEN p.\"spcTornadoLastDate\" >= (CURRENT_DATE - INTERVAL '24 months') THEN 5 ELSE 0 END
);"

echo "==== 5. Build _trig table (ownerHistory-derived triggers) ===="
$PSQL "DROP TABLE IF EXISTS _trig;"
$PSQL "
CREATE UNLOGGED TABLE _trig AS
WITH oh AS (
  SELECT
    p.id,
    p.\"ownerFullName\",
    p.\"ownerHistory\",
    (SELECT upper(e->>'owner')
       FROM jsonb_array_elements(COALESCE(p.\"ownerHistory\",'[]'::jsonb)) e
       ORDER BY (e->>'year')::int DESC
       LIMIT 1) AS latest_owner,
    (WITH ordered AS (
        SELECT upper(e->>'owner') o, (e->>'year')::int y
        FROM jsonb_array_elements(COALESCE(p.\"ownerHistory\",'[]'::jsonb)) e
     ), ranked AS (
        SELECT o, y, LAG(o) OVER (ORDER BY y DESC) prev_o FROM ordered
     )
     SELECT MIN(y) FROM ranked WHERE prev_o IS NOT NULL AND prev_o <> o) AS last_transfer_year,
    (SELECT COUNT(DISTINCT upper(e->>'owner'))
       FROM jsonb_array_elements(COALESCE(p.\"ownerHistory\",'[]'::jsonb)) e
       WHERE (e->>'year')::int >= 2021) AS distinct_owners_5y
  FROM properties p
)
SELECT
  oh.id,
  oh.last_transfer_year,
  oh.distinct_owners_5y,
  (
    COALESCE(oh.\"ownerFullName\",'') ~* '(ESTATE\s+OF|HEIRS\s+OF|LIVING\s+TRUST|REVOCABLE\s+TRUST|FAMILY\s+TRUST|TRUSTEE|DECEASED)'
    OR COALESCE(oh.latest_owner,'') ~ '(ESTATE\s+OF|HEIRS\s+OF|LIVING\s+TRUST|REVOCABLE\s+TRUST|FAMILY\s+TRUST|TRUSTEE|DECEASED)'
  ) AS probate_trigger,
  (oh.last_transfer_year IS NOT NULL
   AND oh.last_transfer_year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 2) AS recent_transfer,
  (oh.distinct_owners_5y >= 3) AS investor_flip
FROM oh;"
$PSQL "CREATE INDEX ON _trig (id);"
$PSQL "ANALYZE _trig;"

echo "==== 6. Add trigger bonuses to urgency (in hash chunks of 1/8) ===="
for k in 0 1 2 3 4 5 6 7; do
  $PSQL "
  UPDATE properties p
  SET \"urgencyScore\" = LEAST(100, COALESCE(p.\"urgencyScore\", 0)
      + CASE WHEN t.probate_trigger THEN 25 ELSE 0 END
      + CASE WHEN t.recent_transfer THEN 15 ELSE 0 END
      + CASE WHEN t.investor_flip THEN 20 ELSE 0 END)
  FROM _trig t
  WHERE p.id = t.id
    AND (hashtext(p.id) & 7) = $k
    AND (t.probate_trigger OR t.recent_transfer OR t.investor_flip);"
done

echo "==== 7. Opportunity + score (in hash chunks of 1/8) ===="
for k in 0 1 2 3 4 5 6 7; do
  $PSQL "
  WITH rev_bounds AS (
    SELECT PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY \"revenuePotential\") AS lo,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY \"revenuePotential\") AS hi
    FROM properties WHERE \"revenuePotential\" IS NOT NULL
  )
  UPDATE properties p
  SET \"opportunityScore\" = GREATEST(0, LEAST(100,
      COALESCE(p.\"urgencyScore\", 0) * 0.45
    + GREATEST(0, LEAST(100,
        (COALESCE(p.\"revenuePotential\",0) - b.lo) / NULLIF(b.hi - b.lo, 0) * 100
      )) * 0.25
    + (
        CASE WHEN t.probate_trigger THEN 25 ELSE 0 END
      + CASE WHEN t.recent_transfer THEN 15 ELSE 0 END
      + CASE WHEN t.investor_flip THEN 20 ELSE 0 END
      ) * 0.20
    + CASE WHEN p.\"ownerOccupied\" IS TRUE THEN 10
           WHEN p.\"ownerOccupied\" IS FALSE THEN 5
           ELSE 7 END
  )),
    \"score\" = ROUND(GREATEST(0, LEAST(100,
      COALESCE(p.\"urgencyScore\", 0) * 0.45
    + GREATEST(0, LEAST(100,
        (COALESCE(p.\"revenuePotential\",0) - b.lo) / NULLIF(b.hi - b.lo, 0) * 100
      )) * 0.25
    + (
        CASE WHEN t.probate_trigger THEN 25 ELSE 0 END
      + CASE WHEN t.recent_transfer THEN 15 ELSE 0 END
      + CASE WHEN t.investor_flip THEN 20 ELSE 0 END
      ) * 0.20
    + CASE WHEN p.\"ownerOccupied\" IS TRUE THEN 10
           WHEN p.\"ownerOccupied\" IS FALSE THEN 5
           ELSE 7 END
    ))::numeric)
  FROM rev_bounds b, _trig t
  WHERE t.id = p.id AND (hashtext(p.id) & 7) = $k;"
done

echo "==== 8. scoreReasons (in hash chunks of 1/8) ===="
for k in 0 1 2 3 4 5 6 7; do
  $PSQL "
  UPDATE properties p
  SET \"scoreReasons\" = jsonb_strip_nulls(jsonb_build_object(
    'version', 'v3',
    'computedAt', to_jsonb(NOW()),
    'urgency', jsonb_build_object(
      'score', p.\"urgencyScore\",
      'spcHailCount', p.\"spcHailCount\",
      'spcHailMaxInches', p.\"spcHailMaxInches\",
      'spcHailLastDate', p.\"spcHailLastDate\",
      'spcWindCount', p.\"spcWindCount\",
      'spcTornadoCount', p.\"spcTornadoCount\",
      'spcTornadoLastDate', p.\"spcTornadoLastDate\",
      'hailExposureIndex', p.\"hailExposureIndex\",
      'yearBuilt', p.\"yearBuilt\",
      'yearBuiltSource', p.\"yearBuiltSource\",
      'roofAgeClass', p.\"roofAgeClass\"
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
      'estimate', p.\"revenuePotential\",
      'roofAreaSqft', p.\"roofAreaSqft\",
      'roofSizeClass', p.\"roofSizeClass\"
    ),
    'occupancy', jsonb_build_object(
      'ownerOccupied', p.\"ownerOccupied\"
    ),
    'bullets', (
      SELECT jsonb_agg(x) FROM (
        SELECT unnest(ARRAY[
          CASE WHEN COALESCE(p.\"spcHailCount\",0) >= 5
               THEN format('%s SPC hail events on record (max %s\\\")',
                           p.\"spcHailCount\", COALESCE(p.\"spcHailMaxInches\",0)::text)
               END,
          CASE WHEN p.\"spcHailLastDate\" >= (CURRENT_DATE - INTERVAL '18 months')
               THEN format('Hail within claim window (%s)', p.\"spcHailLastDate\")
               END,
          CASE WHEN COALESCE(p.\"spcTornadoCount\",0) >= 1
               THEN format('Tornado track(s) overhead: %s event(s), latest %s',
                           p.\"spcTornadoCount\", COALESCE(p.\"spcTornadoLastDate\"::text, 'unknown'))
               END,
          CASE WHEN p.\"yearBuilt\" IS NOT NULL AND (2026 - p.\"yearBuilt\") >= 20
               THEN format('Roof likely >= %s years old (built %s)',
                           2026 - p.\"yearBuilt\", p.\"yearBuilt\")
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
  WHERE t.id = p.id AND (hashtext(p.id) & 7) = $k;"
done

echo "==== 9. Coverage snapshot ===="
$PSQL "
SELECT
  COUNT(*) total,
  COUNT(*) FILTER (WHERE \"solarScore\" IS NOT NULL) w_solar,
  COUNT(*) FILTER (WHERE \"urgencyScore\" IS NOT NULL) w_urgency,
  COUNT(*) FILTER (WHERE \"revenuePotential\" IS NOT NULL) w_revenue,
  COUNT(*) FILTER (WHERE \"opportunityScore\" IS NOT NULL) w_opp,
  COUNT(*) FILTER (WHERE \"ownerOccupied\" IS NOT NULL) w_oo,
  COUNT(*) FILTER (WHERE \"scoreReasons\" ? 'version') w_reasons,
  ROUND(AVG(\"opportunityScore\")::numeric, 2) avg_opp,
  MAX(\"opportunityScore\") max_opp,
  MIN(\"opportunityScore\") min_opp
FROM properties;"

echo "==== 10. Trigger distribution ===="
$PSQL "
SELECT
  COUNT(*) FILTER (WHERE probate_trigger) probate,
  COUNT(*) FILTER (WHERE recent_transfer) recent_transfer,
  COUNT(*) FILTER (WHERE investor_flip)  investor_flip,
  COUNT(*) FILTER (WHERE probate_trigger OR recent_transfer OR investor_flip) any_trigger
FROM _trig;"

echo "==== 11. Score bucket distribution ===="
$PSQL "
SELECT
  COUNT(*) FILTER (WHERE \"score\" >= 80) hot,
  COUNT(*) FILTER (WHERE \"score\" BETWEEN 60 AND 79) warm,
  COUNT(*) FILTER (WHERE \"score\" BETWEEN 40 AND 59) cool,
  COUNT(*) FILTER (WHERE \"score\" < 40) cold
FROM properties;"

echo "==== 12. Top 10 preview ===="
$PSQL "
SELECT id, address, \"opportunityScore\"::int opp, \"urgencyScore\"::int urg,
       \"spcHailCount\" hail, \"spcHailMaxInches\" hail_in,
       \"spcTornadoCount\" tor, \"yearBuilt\" yb,
       \"ownerOccupied\" oo
FROM properties
ORDER BY \"opportunityScore\" DESC NULLS LAST
LIMIT 10;"

echo "==== DONE ===="
