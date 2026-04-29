#!/bin/bash
# refresh-roof-signals.sh  (2026-04-29)
#
# Periodic refresh of the roof-signals pipeline. Pulls in new MLS hits,
# re-resolves any new permits, then rebuilds the materialized tables.
# Intended to run on cron every 1-6 hours.
#
# What it does (in order):
#   1. Re-mine _mls_listings_raw → property_signals (new mls_roof_year etc)
#   2. Re-run geocode-resolver against any newly-seen unresolved permits
#   3. Re-materialize roof_age_v2 (per-property best estimate)
#   4. Re-materialize lead_priority (asphalt + age + insurance window)
#   5. Re-materialize top_leads_burning (sales-ready dump)
#
# Cron suggestion:
#   0 */4 * * * /home/dentwon/Eavesight/scripts/refresh-roof-signals.sh \
#       >> /home/dentwon/Eavesight/logs/refresh-roof-signals.log 2>&1
set -euo pipefail
export PGPASSWORD=eavesight
PSQL="psql -U eavesight -h localhost -p 5433 -d eavesight -v ON_ERROR_STOP=1"
SCRIPTS=/home/dentwon/Eavesight/scripts

ts() { date '+[%Y-%m-%dT%H:%M:%SZ]'; }

echo "$(ts) refresh-roof-signals start"

echo "$(ts) [1/5] mining _mls_listings_raw..."
$PSQL -f "$SCRIPTS/load-mls-roof-signals.sql"

echo "$(ts) [2/5] geocode-resolving newly-unresolved permits..."
node "$SCRIPTS/geocode-and-resolve-permits.js" --commit || echo "$(ts) WARN: geocode-resolver had issues"

echo "$(ts) [3/5] re-materializing roof_age_v2..."
$PSQL -f "$SCRIPTS/materialize-roof-age-v2.sql" >/dev/null

echo "$(ts) [4/5] re-materializing lead_priority..."
$PSQL -f "$SCRIPTS/compute-lead-priority.sql" >/dev/null

echo "$(ts) [5/5] re-materializing top_leads_burning..."
$PSQL -f "$SCRIPTS/dump-top-leads.sql" >/dev/null

echo "$(ts) refresh-roof-signals done"
$PSQL -c "
  SELECT 'true_roof_age' AS metric, COUNT(*) AS val FROM (
    SELECT DISTINCT \"propertyId\" FROM property_signals
    WHERE \"signalType\" IN ('reroof_permit','contractor_job','mls_roof_year')
  ) t
  UNION ALL SELECT 'burning_leads',
    COUNT(*) FROM lead_priority WHERE priority_rank IN (1,2)
  UNION ALL SELECT 'top_leads_total',
    COUNT(*) FROM top_leads_burning;
"
