#!/usr/bin/env bash
# Post-Step-B runbook: applies the metros migration, assigns H3 cells,
# populates unified score, rebuilds hex aggregates + pin cards, audits.
#
# Usage: run-metro-pipeline.sh [metro_code]     (default: north-alabama)
# Idempotent — safe to re-run.
#
# Note on /tmp staging: /home/dentwon is 750 so the 'postgres' user can't
# traverse into it. We copy the .sql files to /tmp where postgres can read.
set -euo pipefail

METRO="${1:-north-alabama}"
BACKEND=/home/dentwon/Eavesight/apps/backend
SCRIPTS=/home/dentwon/Eavesight/scripts

# Stage all SQL into /tmp (readable by postgres user)
cp "$SCRIPTS/build-hex-aggregates.sql" /tmp/build-hex-aggregates.sql
cp "$SCRIPTS/build-pin-cards.sql"      /tmp/build-pin-cards.sql
chmod 644 /tmp/build-hex-aggregates.sql /tmp/build-pin-cards.sql

echo "===== 1/6  Apply metros migration ====="
sudo -u postgres psql -d eavesight -f /tmp/metros_migration.sql

echo "===== 2/6  Mark Prisma migration as applied ====="
cd $BACKEND
npx prisma migrate resolve --applied 20260420000000_metros_hex_pincard || true

echo "===== 3/6  Compute unified score (all properties) ====="
sudo -u postgres psql -d eavesight -f /tmp/compute-unified-score.sql

echo "===== 4/6  Assign H3 cells for $METRO ====="
node $SCRIPTS/assign-h3-metro.js $METRO

echo "===== 5/6  Build hex aggregates for $METRO ====="
sudo -u postgres psql -d eavesight -v metro="'$METRO'" -f /tmp/build-hex-aggregates.sql

echo "===== 6/6  Build pin cards for $METRO ====="
sudo -u postgres psql -d eavesight -v metro="'$METRO'" -f /tmp/build-pin-cards.sql

echo
echo "===== Coverage snapshot ====="
sudo -u postgres psql -d eavesight <<EOSQL
SELECT '$METRO' AS metro,
  (SELECT COUNT(*) FROM properties                WHERE \"metroCode\" = '$METRO') AS properties,
  (SELECT COUNT(*) FROM properties                WHERE \"metroCode\" = '$METRO' AND \"h3r6\" IS NOT NULL) AS h3_assigned,
  (SELECT COUNT(*) FROM properties                WHERE \"metroCode\" = '$METRO' AND \"score\" IS NOT NULL) AS scored,
  (SELECT COUNT(*) FROM properties                WHERE \"metroCode\" = '$METRO' AND \"dormantFlag\" = TRUE) AS dormant,
  (SELECT COUNT(*) FROM property_pin_cards        WHERE \"metroCode\" = '$METRO') AS pin_cards,
  (SELECT COUNT(*) FROM property_hex_aggregates   WHERE \"metroCode\" = '$METRO' AND resolution = 6) AS hex_r6,
  (SELECT COUNT(*) FROM property_hex_aggregates   WHERE \"metroCode\" = '$METRO' AND resolution = 8) AS hex_r8;
EOSQL

echo
echo "===== Done. Re-audit: sudo -u postgres psql -d eavesight -f /tmp/data-audit.sql ====="
