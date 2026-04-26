#!/bin/bash
cd /home/dentwon/Eavesight
export DB_PASSWORD=eavesight
node scripts/batch-geocode.js >> /tmp/geocode.log 2>&1
