#!/bin/bash
cd /home/dentwon/StormVault
export DB_PASSWORD=stormvault
node scripts/batch-geocode.js >> /tmp/geocode.log 2>&1
