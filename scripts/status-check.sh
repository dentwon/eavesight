#!/bin/bash
# status-check.sh — quick one-liner health snapshot of the scraper.
# Usage: ssh dentwon@... "bash /home/dentwon/Eavesight/scripts/status-check.sh"

cd /home/dentwon/Eavesight

echo "=== Process ==="
pgrep -af "yearbuilt-watchdog-v2|enrich-yearbuilt-v3" | grep -v grep || echo "(none running)"

echo ""
echo "=== Heartbeat ==="
if [ -f /tmp/yearbuilt-v3.heartbeat ]; then
  hb_ms=$(cat /tmp/yearbuilt-v3.heartbeat)
  hb=$((hb_ms / 1000))
  now=$(date +%s)
  age=$((now - hb))
  echo "last hb: $(date -d @$hb -Iseconds) (age ${age}s)"
else
  echo "no heartbeat file"
fi

echo ""
echo "=== Watchdog status ==="
cat /tmp/yearbuilt-v3.status 2>/dev/null || echo "(no status file)"

echo ""
echo "=== DB progress (last 10 min) ==="
PGPASSWORD=eavesight psql -h localhost -p 5433 -U eavesight -d eavesight -t -c "
  SELECT
    count(*) FILTER (WHERE \"updatedAt\" > NOW() - INTERVAL '10 min') AS last_10m,
    count(*) FILTER (WHERE \"updatedAt\" > NOW() - INTERVAL '1 hour') AS last_1h,
    count(*) FILTER (WHERE \"yearBuiltSource\" = 'madison-assessor-scrape') AS total_scraped
  FROM properties WHERE county='Madison';"

echo "=== Tail ==="
tail -5 logs/yearbuilt-v3.log 2>/dev/null
echo ""
echo "=== Watchdog log ==="
tail -5 logs/yearbuilt-v3.log.watchdog 2>/dev/null
