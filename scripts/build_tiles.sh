#!/bin/bash
# Build north_alabama_buildings.pmtiles from NDJSON polygons
set -e
cd "$(dirname "$0")/.."

NDJSON=output/north_alabama.ndjson
MBTILES=output/north_alabama_buildings.mbtiles
PMTILES=output/north_alabama_buildings.pmtiles
PUBLIC=apps/frontend/public/north_alabama_buildings.pmtiles

if [ ! -f "$NDJSON" ]; then echo 'Missing '$NDJSON; exit 1; fi

echo '==> tippecanoe'
rm -f "$MBTILES"
tippecanoe   --force   --name="North Alabama Buildings"   --layer=buildings   --minimum-zoom=10   --maximum-zoom=16   --base-zoom=14   --drop-densest-as-needed   --extend-zooms-if-still-dropping   --no-tile-stats   --detect-shared-borders   --simplification=2   --generate-ids   --read-parallel   --output="$MBTILES"   "$NDJSON"

echo '==> pmtiles convert'
rm -f "$PMTILES"
pmtiles convert "$MBTILES" "$PMTILES"

echo '==> verify'
head -c 7 "$PMTILES" | od -c | head -1

echo '==> copy to public/'
cp "$PMTILES" "$PUBLIC"
ls -lh "$PUBLIC"
