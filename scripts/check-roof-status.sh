#!/bin/bash
# check-roof-status.sh  — quick at-a-glance state of the roof-intelligence pipeline
export PGPASSWORD=eavesight
psql -U eavesight -h localhost -p 5433 -d eavesight -c "
SELECT 'TRUE roof age (permits + contractor + MLS)'::text AS metric, COUNT(*)::text AS value
  FROM (SELECT DISTINCT \"propertyId\" FROM property_signals
        WHERE \"signalType\" IN ('reroof_permit','contractor_job','mls_roof_year')) t
UNION ALL SELECT 'storm-implied (probabilistic)',
  COUNT(*)::text FROM property_signals WHERE \"signalType\"='implied_replacement_post_storm'
UNION ALL SELECT 'all signals',
  COUNT(*)::text FROM property_signals
UNION ALL SELECT 'roof_age_v2 classified',
  COUNT(*)::text FROM roof_age_v2
UNION ALL SELECT 'BURNING leads (P1+P2)',
  COUNT(*)::text FROM lead_priority WHERE priority_rank IN (1, 2)
UNION ALL SELECT 'top_leads_burning actionable',
  COUNT(*)::text FROM top_leads_burning
UNION ALL SELECT 'pin_cards w/ priorityRank',
  COUNT(*)::text FROM property_pin_cards WHERE \"priorityRank\" IS NOT NULL;
"
echo ""
echo "=== Top 5 BURNING leads ==="
psql -U eavesight -h localhost -p 5433 -d eavesight -c "
SELECT \"priorityLabel\", \"severitySubrank\", \"daysUntilClaimClose\", \"roofAgeYearsV2\",
       \"payloadPro\"->>'address' AS address, \"payloadPro\"->>'city' AS city
FROM property_pin_cards
WHERE \"metroCode\"='north-alabama' AND \"priorityRank\" IN (1, 2)
ORDER BY \"priorityRank\", \"severitySubrank\", \"daysUntilClaimClose\", \"roofAgeYearsV2\" DESC
LIMIT 5;
"
