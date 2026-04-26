#!/bin/bash
# yearbuilt-watchdog-v2.sh
# Heartbeat-based watchdog. Scraper writes /tmp/yearbuilt-v3.heartbeat on each
# successful fetch. If the file ages past STALL_SEC, kill + relaunch the
# scraper. Also restarts on clean exit (e.g., DB conn blip).
#
# Drop-in replacement for the old "count 429 errors" watchdog.

set -u
cd /home/dentwon/Eavesight

LOG=logs/yearbuilt-v3.log
HB=/tmp/yearbuilt-v3.heartbeat
PIDFILE=/tmp/yearbuilt-v3.pid
STATUS=/tmp/yearbuilt-v3.status
STALL_SEC=1800     # no heartbeat for 30 min = stalled (scraper now ticks HB during cooldowns, so 30 min is purely backstop)
LOOP_SLEEP=30

log_wd() { echo "[watchdog $(date -Iseconds)] $*" >> logs/yearbuilt-v3.log.watchdog; }

start_scraper() {
  log_wd "starting scraper"
  # Seed heartbeat to NOW so the STALL_SEC clock starts from launch,
  # not from "file doesn't exist yet" => 99999.
  echo $(($(date +%s) * 1000)) > "$HB"
  nohup node scripts/enrich-yearbuilt-v3.js >> "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  log_wd "scraper pid=$(cat $PIDFILE) (hb seeded)"
  sleep 15   # grace period for first fetch
}

is_alive() {
  local pid=$(cat "$PIDFILE" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

hb_age() {
  if [ ! -f "$HB" ]; then echo 99999; return; fi
  local now=$(date +%s)
  local hb_ms=$(cat "$HB")
  local hb=$((hb_ms / 1000))
  echo $((now - hb))
}

start_scraper

while true; do
  sleep "$LOOP_SLEEP"
  age=$(hb_age)
  if ! is_alive; then
    log_wd "process dead, restarting"
    echo "DEAD $(date -Iseconds)" > "$STATUS"
    start_scraper
    continue
  fi
  if [ "$age" -gt "$STALL_SEC" ]; then
    log_wd "stalled (hb_age=${age}s > ${STALL_SEC}s), killing pid=$(cat $PIDFILE)"
    kill -9 "$(cat $PIDFILE)" 2>/dev/null
    echo "STALL $(date -Iseconds) age=${age}" > "$STATUS"
    sleep 5
    start_scraper
    continue
  fi
  echo "UP $(date -Iseconds) hb_age=${age}s pid=$(cat $PIDFILE)" > "$STATUS"
done
