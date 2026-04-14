#!/bin/bash
LOGFILE="/home/dentwon/StormVault/logs/yearbuilt-v2.log"
CHECK_INTERVAL=300

echo "$(date): Watchdog started" >> ${LOGFILE}.watchdog

while true; do
    if ! pgrep -f "enrich-yearbuilt-v2" > /dev/null; then
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L \
            "https://madisonproperty.countygovservices.com/Property/Property/Details?taxyear=2024&ppin=535816" \
            -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        
        if [ "$HTTP_CODE" = "200" ]; then
            echo "$(date): Rate limit clear, starting scraper..." >> ${LOGFILE}.watchdog
            cd /home/dentwon/StormVault
            node scripts/enrich-yearbuilt-v2.js >> $LOGFILE 2>&1 &
            echo "$(date): Scraper started PID $!" >> ${LOGFILE}.watchdog
        else
            echo "$(date): Still limited (HTTP $HTTP_CODE), waiting..." >> ${LOGFILE}.watchdog
        fi
    else
        RECENT_429=$(tail -20 $LOGFILE 2>/dev/null | grep -c "429")
        if [ "$RECENT_429" -ge 3 ]; then
            echo "$(date): Too many 429s, killing and cooling 10min..." >> ${LOGFILE}.watchdog
            pkill -f "enrich-yearbuilt-v2"
            sleep 600
            continue
        fi
        LAST_LINE=$(tail -1 $LOGFILE 2>/dev/null)
        echo "$(date): Running. $LAST_LINE" >> ${LOGFILE}.watchdog
    fi
    sleep $CHECK_INTERVAL
done
