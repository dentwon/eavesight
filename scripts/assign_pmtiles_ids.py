#!/usr/bin/env python3
"""
assign_pmtiles_ids.py

Spatial join: match building_footprints (PostGIS) to NDJSON polygons by centroid-in-polygon.
Writes pmtiles_id (integer) to the building_footprints table.

Run:   python3 scripts/assign_pmtiles_ids.py
Needs: shapely, psycopg2-binary
"""
import json, sys, os
from pathlib import Path

NDJSON = "/home/dentwon/StormVault/output/north_alabama.ndjson"
DB = "postgresql://stormvault:stormvault@localhost:5433/stormvault"
BATCH = 5000

def log(msg):
    print(msg, flush=True)

try:
    from shapely import wkt, wkb
    from shapely.geometry import shape, Point
    import psycopg2
except ImportError as e:
    log(f"Missing: {e}")
    log("Install: pip install shapely psycopg2-binary")
    sys.exit(1)

def pg_conn():
    import psycopg2
    return psycopg2.connect(DB)

def pg_batch(conn, rows):
    """Batch upsert pmtiles_ids: UPDATE building_footprints SET pmtiles_id = %s WHERE id = %s"""
    if not rows:
        return
    with conn.cursor() as cur:
        cur.executemany(
            'UPDATE "building_footprints" SET "pmtiles_id" = %s WHERE id = %s',
            rows
        )
    conn.commit()

def main():
    conn = pg_conn()
    total = 0
    with conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM "building_footprints" WHERE geom IS NOT NULL')
        total = cur.fetchone()[0]
    log(f"Building_footprints with geom: {total:,}")

    # Count how many already have pmtiles_id
    done = 0
    with conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM "building_footprints" WHERE "pmtiles_id" IS NOT NULL')
        done = cur.fetchone()[0]
    log(f"Already assigned: {done:,}")

    log("Loading NDJSON polygons...")
    id_to_poly = {}
    with open(NDJSON, 'r') as f:
        for i, line in enumerate(f):
            d = json.loads(line)
            gid = int(d['id'])
            geom = shape(d['geometry'])
            if geom.is_valid:
                id_to_poly[gid] = geom
            if i > 0 and i % 100000 == 0:
                log(f"  loaded {i:,} polygons...")
    log(f"  loaded {len(id_to_poly):,} valid polygons")

    # Build spatial index over NDJSON polygons (R-tree)
    from rtree import index as rtree_idx
    rtree = rtree_idx.Index()
    for gid, poly in id_to_poly.items():
        rtree.insert(gid, poly.bounds)

    log("Spatial matching...")
    offset = 0
    assigned = done
    not_matched = 0
    batch_buf = []

    while True:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, "pmtiles_id",
                       ST_X(geom) as lon, ST_Y(geom) as lat
                FROM "building_footprints"
                WHERE geom IS NOT NULL
                ORDER BY id
                LIMIT %s OFFSET %s
            """, (BATCH, offset))
            rows = cur.fetchall()
        if not rows:
            break

        for bf_id, existing_pmtiles_id, lon, lat in rows:
            if existing_pmtiles_id is not None:
                assigned += 1
                continue

            pt = Point(lon, lat)
            # Quick bounding-box candidate search
            candidates = list(rtree.intersection(pt.coords[0]))
            found = False
            for gid in candidates:
                if id_to_poly[gid].contains(pt) or id_to_poly[gid].touches(pt):
                    batch_buf.append((gid, bf_id))
                    assigned += 1
                    found = True
                    break
            if not found:
                not_matched += 1

            if len(batch_buf) >= BATCH:
                pg_batch(conn, batch_buf)
                batch_buf = []

        offset += BATCH
        log(f"  {offset:,}/{total:,} | assigned: {assigned:,} | not matched: {not_matched:,}")

    if batch_buf:
        pg_batch(conn, batch_buf)

    log("Verifying...")
    with conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM "building_footprints" WHERE "pmtiles_id" IS NOT NULL')
        log(f"  Total assigned pmtiles_id: {cur.fetchone()[0]:,}")
        cur.execute('SELECT COUNT(DISTINCT "pmtiles_id") FROM "building_footprints" WHERE "pmtiles_id" IS NOT NULL')
        log(f"  Unique pmtiles_ids: {cur.fetchone()[0]:,}")

    conn.close()
    log("Done.")

if __name__ == '__main__':
    main()
