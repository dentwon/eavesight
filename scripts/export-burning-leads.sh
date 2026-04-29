#!/bin/bash
# export-burning-leads.sh  (2026-04-29)
#
# Exports the top-N BURNING/URGENT leads from top_leads_burning to a CSV
# that sales reps can open in Excel / call-center software / mailmerge.
#
# Usage:
#   ./scripts/export-burning-leads.sh                   # top 1000, all zips
#   ./scripts/export-burning-leads.sh 500               # top 500
#   ./scripts/export-burning-leads.sh 1000 35801,35811  # top 1000 in those zips
#
set -euo pipefail
export PGPASSWORD=eavesight

LIMIT="${1:-1000}"
ZIP_FILTER="${2:-}"
OUT_DIR=/home/dentwon/Eavesight/exports
mkdir -p "$OUT_DIR"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
OUT_FILE="$OUT_DIR/burning_leads_top${LIMIT}_${TIMESTAMP}.csv"

# Build optional zip-filter clause
ZIP_CLAUSE=""
if [ -n "$ZIP_FILTER" ]; then
  ZIP_CLAUSE="AND zip = ANY(string_to_array('$ZIP_FILTER', ',')::text[])"
fi

psql -U eavesight -h localhost -p 5433 -d eavesight -tAF, -c "
\\copy (
  SELECT
    priority_label,
    severity_subrank,
    days_until_claim_close,
    roof_age_years,
    address,
    city,
    zip,
    lat, lon,
    storm_event_date::text,
    storm_type,
    COALESCE(hail_inches::text, '') AS hail_inches,
    COALESCE(wind_mph::text, '') AS wind_mph,
    COALESCE(tornado_scale, '') AS tornado_scale,
    COALESCE(owner_name, '') AS owner_name,
    COALESCE(mailing_address, '') AS owner_mailing_address,
    metro_score::numeric(4,2)::text AS metro_score,
    metro_score_bucket
  FROM top_leads_burning
  WHERE priority_rank IN (1, 2)
    $ZIP_CLAUSE
  ORDER BY priority_rank, severity_subrank, days_until_claim_close, roof_age_years DESC
  LIMIT $LIMIT
) TO '$OUT_FILE' WITH (FORMAT csv, HEADER true)
" >/dev/null

ROWS=$(wc -l < "$OUT_FILE")
echo "Exported $((ROWS - 1)) rows to $OUT_FILE"
echo ""
echo "Quick stats:"
psql -U eavesight -h localhost -p 5433 -d eavesight -c "
  SELECT priority_label, severity_subrank, COUNT(*)
  FROM top_leads_burning
  WHERE priority_rank IN (1, 2)
    $ZIP_CLAUSE
  GROUP BY 1, 2 ORDER BY 1, 2
  LIMIT 20
"
echo ""
echo "Preview (top 10 rows):"
head -11 "$OUT_FILE" | column -t -s, | head -11
