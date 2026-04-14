#!/usr/bin/env python3
"""
Fetch and process NOAA MRMS MESH (Maximum Estimated Size of Hail) data.

Downloads MESH GRIB2 files from the NOAA MRMS S3 bucket (noaa-mrms-pds)
and extracts hail size values for Alabama properties.

Usage:
    python3 fetch-mrms-mesh.py                          # Process known storm dates from DB
    python3 fetch-mrms-mesh.py --date 2026-03-15        # Process specific date
    python3 fetch-mrms-mesh.py --start 2026-02-01 --end 2026-03-28  # Date range
    python3 fetch-mrms-mesh.py --bbox 34.4,-87.0,35.0,-86.3  # Custom bounding box

Output: JSON files in data/mesh_output/ with hail size per grid cell
"""

import argparse
import gzip
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

import eccodes
import numpy as np

# --- Configuration ---
S3_BUCKET = "noaa-mrms-pds"
S3_BASE_URL = f"https://{S3_BUCKET}.s3.amazonaws.com"

# MESH_Max_1440min = 24-hour rolling maximum MESH. One file at end of day
# captures the worst hail of the entire day. Much more efficient than
# downloading every 2-minute MESH scan.
MESH_PRODUCT = "MESH_Max_1440min_00.50"

# Alabama bounding box (generous, covers full state)
AL_BBOX = {
    "lat_min": 30.0,
    "lat_max": 35.2,
    "lon_min": -88.6,
    "lon_max": -84.8,
}

# Huntsville metro area (tighter box for focused analysis)
HSV_BBOX = {
    "lat_min": 34.4,
    "lat_max": 35.0,
    "lon_min": -87.2,
    "lon_max": -86.2,
}

# MRMS grid parameters (fixed for CONUS)
MRMS_LAT_START = 54.995    # Top of grid (north)
MRMS_LON_START = 230.005   # Left of grid (east longitude = 360 + west)
MRMS_STEP = 0.01           # ~1km grid spacing
MRMS_NI = 7000             # Columns
MRMS_NJ = 3500             # Rows

# Directories
SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = SCRIPT_DIR.parent / "data"
CACHE_DIR = DATA_DIR / "mesh_cache"
OUTPUT_DIR = DATA_DIR / "mesh_output"

# DB connection for reading storm events
DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "user": "stormvault",
    "password": "stormvault",
    "dbname": "stormvault",
}


def ensure_dirs():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def mrms_lon(west_lon):
    """Convert west longitude (-86.6) to MRMS east longitude (273.4)."""
    return 360.0 + west_lon


def lat_to_row(lat):
    """Convert latitude to MRMS grid row index."""
    return int(round((MRMS_LAT_START - lat) / MRMS_STEP))


def lon_to_col(lon_west):
    """Convert west longitude to MRMS grid column index."""
    lon_east = mrms_lon(lon_west)
    return int(round((lon_east - MRMS_LON_START) / MRMS_STEP))


def list_mesh_files(date_str):
    """List available MESH files for a given date (YYYYMMDD) from S3."""
    prefix = f"CONUS/{MESH_PRODUCT}/{date_str}/"
    url = f"{S3_BASE_URL}?list-type=2&prefix={prefix}&max-keys=100"

    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            xml_data = resp.read().decode()

        root = ET.fromstring(xml_data)
        ns = "{http://s3.amazonaws.com/doc/2006-03-01/}"
        keys = []
        for content in root.findall(f"{ns}Contents"):
            key = content.find(f"{ns}Key").text
            keys.append(key)
        return keys
    except Exception as e:
        print(f"  Error listing files for {date_str}: {e}")
        return []


def download_mesh_file(s3_key):
    """Download a MESH GRIB2 file from S3, return local path."""
    filename = os.path.basename(s3_key)
    local_gz = CACHE_DIR / filename
    local_grib = CACHE_DIR / filename.replace(".gz", "")

    if local_grib.exists():
        print(f"  Cached: {local_grib.name}")
        return local_grib

    url = f"{S3_BASE_URL}/{s3_key}"
    print(f"  Downloading: {filename} ...", end=" ", flush=True)

    try:
        urllib.request.urlretrieve(url, local_gz)
        # Decompress
        with gzip.open(local_gz, 'rb') as f_in:
            with open(local_grib, 'wb') as f_out:
                f_out.write(f_in.read())
        local_gz.unlink()  # Remove .gz
        print(f"OK ({local_grib.stat().st_size / 1024:.0f} KB)")
        return local_grib
    except Exception as e:
        print(f"FAILED: {e}")
        return None


def parse_mesh_grib2(filepath, bbox):
    """
    Parse a MESH GRIB2 file and extract values within a bounding box.

    Returns dict with:
        - grid_cells: list of {lat, lon, mesh_mm, mesh_inches}
        - max_mesh_mm: maximum MESH value in the area
        - max_mesh_inches: maximum MESH value in inches
        - nonzero_count: number of cells with hail > 0
        - timestamp: file timestamp
    """
    with open(filepath, 'rb') as f:
        msgid = eccodes.codes_grib_new_from_file(f)
        if msgid is None:
            print(f"  Warning: Could not read GRIB message from {filepath}")
            return None

    try:
        values = eccodes.codes_get_values(msgid)
        data = values.reshape(MRMS_NJ, MRMS_NI)

        # Calculate row/col bounds for our bbox
        row_start = lat_to_row(bbox["lat_max"])  # North = lower row index
        row_end = lat_to_row(bbox["lat_min"])     # South = higher row index
        col_start = lon_to_col(bbox["lon_min"])   # West
        col_end = lon_to_col(bbox["lon_max"])     # East

        # Clamp
        row_start = max(0, row_start)
        row_end = min(MRMS_NJ - 1, row_end)
        col_start = max(0, col_start)
        col_end = min(MRMS_NI - 1, col_end)

        subset = data[row_start:row_end + 1, col_start:col_end + 1]

        # Build grid cells with hail > 0
        # MRMS uses -3 or -1 for no-data/below-threshold
        grid_cells = []
        for i in range(subset.shape[0]):
            for j in range(subset.shape[1]):
                val = float(subset[i, j])
                if val > 0:
                    lat = MRMS_LAT_START - (row_start + i) * MRMS_STEP
                    lon_east = MRMS_LON_START + (col_start + j) * MRMS_STEP
                    lon_west = lon_east - 360.0
                    grid_cells.append({
                        "lat": round(lat, 4),
                        "lon": round(lon_west, 4),
                        "mesh_mm": round(val, 1),
                        "mesh_inches": round(val / 25.4, 2),
                    })

        # Extract timestamp from filename
        fname = filepath.name
        # MRMS_MESH_Max_1440min_00.50_20260315-233000.grib2
        ts_part = fname.split("_")[-1].replace(".grib2", "")
        timestamp = datetime.strptime(ts_part, "%Y%m%d-%H%M%S").isoformat()

        max_val = float(subset.max())

        result = {
            "timestamp": timestamp,
            "bbox": bbox,
            "max_mesh_mm": round(max_val, 1) if max_val > 0 else 0,
            "max_mesh_inches": round(max_val / 25.4, 2) if max_val > 0 else 0,
            "nonzero_count": len(grid_cells),
            "total_cells": subset.shape[0] * subset.shape[1],
            "grid_cells": grid_cells,
        }

        return result
    finally:
        eccodes.codes_release(msgid)


def get_storm_dates_from_db():
    """Query storm_events table for AL hail dates."""
    try:
        import psycopg2
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT date::date as storm_date
            FROM storm_events
            WHERE state = 'AL'
              AND type = 'HAIL'
              AND date >= '2020-11-01'
            ORDER BY storm_date DESC
            LIMIT 30
        """)
        dates = [row[0].strftime("%Y%m%d") for row in cur.fetchall()]
        cur.close()
        conn.close()
        print(f"Found {len(dates)} hail dates in DB")
        return dates
    except Exception as e:
        print(f"DB query failed: {e}")
        return []


def process_date(date_str, bbox):
    """Process a single date: download best MESH file and extract data."""
    print(f"\nProcessing {date_str}...")

    files = list_mesh_files(date_str)
    if not files:
        print(f"  No MESH files available for {date_str}")
        return None

    # Use the last file of the day (most complete 24h rolling max)
    # For MESH_Max_1440min, the last file has the full day's data
    best_file = files[-1]
    print(f"  Using: {os.path.basename(best_file)} ({len(files)} files available)")

    local_path = download_mesh_file(best_file)
    if not local_path:
        return None

    result = parse_mesh_grib2(local_path, bbox)
    if result is None:
        return None

    print(f"  Max MESH: {result['max_mesh_mm']} mm ({result['max_mesh_inches']} in)")
    print(f"  Cells with hail > 0: {result['nonzero_count']} / {result['total_cells']}")

    return result


def main():
    parser = argparse.ArgumentParser(description="Fetch NOAA MRMS MESH hail data")
    parser.add_argument("--date", help="Specific date (YYYY-MM-DD)")
    parser.add_argument("--start", help="Start date for range (YYYY-MM-DD)")
    parser.add_argument("--end", help="End date for range (YYYY-MM-DD)")
    parser.add_argument("--bbox", help="Bounding box: lat_min,lon_min,lat_max,lon_max")
    parser.add_argument("--state-wide", action="store_true", help="Use full Alabama bbox")
    parser.add_argument("--from-db", action="store_true", help="Get storm dates from DB")
    args = parser.parse_args()

    ensure_dirs()

    # Determine bounding box
    if args.bbox:
        parts = [float(x) for x in args.bbox.split(",")]
        bbox = {"lat_min": parts[0], "lon_min": parts[1], "lat_max": parts[2], "lon_max": parts[3]}
    elif args.state_wide:
        bbox = AL_BBOX
    else:
        bbox = AL_BBOX  # Default to full Alabama

    print(f"Bounding box: lat [{bbox['lat_min']}, {bbox['lat_max']}], lon [{bbox['lon_min']}, {bbox['lon_max']}]")

    # Determine dates to process
    dates = []
    if args.date:
        d = datetime.strptime(args.date, "%Y-%m-%d")
        dates = [d.strftime("%Y%m%d")]
    elif args.start and args.end:
        start = datetime.strptime(args.start, "%Y-%m-%d")
        end = datetime.strptime(args.end, "%Y-%m-%d")
        d = start
        while d <= end:
            dates.append(d.strftime("%Y%m%d"))
            d += timedelta(days=1)
    elif args.from_db:
        dates = get_storm_dates_from_db()
    else:
        # Default: get storm dates from DB
        dates = get_storm_dates_from_db()
        if not dates:
            print("No dates found. Use --date, --start/--end, or --from-db")
            sys.exit(1)

    print(f"Processing {len(dates)} date(s)...")

    all_results = []
    for date_str in dates:
        result = process_date(date_str, bbox)
        if result and result["nonzero_count"] > 0:
            result["date"] = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
            all_results.append(result)

    if not all_results:
        print("\nNo hail detected in any processed files.")
        sys.exit(0)

    # Write combined output
    output = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "bbox": bbox,
        "dates_processed": len(dates),
        "dates_with_hail": len(all_results),
        "events": all_results,
    }

    output_file = OUTPUT_DIR / "mesh_hail_data.json"
    with open(output_file, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Results written to: {output_file}")
    print(f"Dates processed: {len(dates)}")
    print(f"Dates with hail: {len(all_results)}")
    for r in all_results:
        print(f"  {r['date']}: max {r['max_mesh_inches']} in, {r['nonzero_count']} cells")
    print(f"{'='*60}")

    return output_file


if __name__ == "__main__":
    main()
