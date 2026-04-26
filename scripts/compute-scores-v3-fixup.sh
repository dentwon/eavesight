#!/bin/bash
# compute-scores-v3-fixup.sh (2026-04-24)
# Re-runs ONLY the chunked steps 6/7/8 with the hashtext bug fix
# (hashtext % 8 → (hashtext & 7)). Steps 1-5 already correct.
# _trig table from previous run is reused.

set -e
export PGPASSWORD=eavesight
PSQL="psql -U eavesight -h localhost -p 5433 -d eavesight -v ON_ERROR_STOP=1 -c"

echo "==== verify _trig still exists ===="
$PSQL "SELECT COUNT(*) FROM _trig;" || (echo "_trig missing — re-run full script" && exit 1)

echo "==== 6. Add trigger bonuses to urgency (FIXED chunking) ===="
# Reset urgency to base before re-applying bonuses (idempotency)
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

echo "==== 7. Opportunity + score (FIXED chunking) ===="
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

echo "==== 8. scoreReasons (FIXED chunking) ===="
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

echo "==== Coverage snapshot ===="
$PSQL "
SELECT
  COUNT(*) total,
  COUNT(*) FILTER (WHERE \"opportunityScore\" IS NOT NULL) w_opp,
  COUNT(*) FILTER (WHERE \"scoreReasons\" ? 'version') w_reasons,
  COUNT(*) FILTER (WHERE \"scoreReasons\" ->> 'version' = 'v3') w_v3,
  ROUND(AVG(\"opportunityScore\")::numeric, 2) avg_opp,
  MAX(\"opportunityScore\") max_opp
FROM properties;"

$PSQL "
SELECT
  COUNT(*) FILTER (WHERE \"score\" >= 80) hot,
  COUNT(*) FILTER (WHERE \"score\" BETWEEN 60 AND 79) warm,
  COUNT(*) FILTER (WHERE \"score\" BETWEEN 40 AND 59) cool,
  COUNT(*) FILTER (WHERE \"score\" < 40) cold
FROM properties;"

echo "==== DONE ===="
