#!/usr/bin/env node
/**
 * Import MRMS MESH hail data into Eavesight database.
 *
 * Reads JSON output from fetch-mrms-mesh.py and:
 * 1. Creates/updates mesh_hail_observations table with raw grid data
 * 2. For each property, finds the nearest MESH grid cell
 * 3. Updates property_storms with radar-derived hail size
 *
 * Usage:
 *   node import-mesh-data.js                              # Use default output file
 *   node import-mesh-data.js --file path/to/mesh.json     # Specify input file
 *   node import-mesh-data.js --dry-run                    # Preview without writing
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_CONFIG = {
  host: "localhost",
  port: 5433,
  user: "stormvault",
  password: "stormvault",
  database: "stormvault",
};

const DEFAULT_INPUT = path.join(
  __dirname,
  "..",
  "data",
  "mesh_output",
  "mesh_hail_data.json"
);

// Maximum distance (in degrees) to match a property to a MESH grid cell
// 0.01 degrees ~= 1km, which is the MRMS grid resolution
// We use 0.015 (~1.5km) to ensure we catch edge cases
const MAX_MATCH_DISTANCE_DEG = 0.015;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { file: DEFAULT_INPUT, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) opts.file = args[++i];
    if (args[i] === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

function generateId() {
  return crypto.randomBytes(12).toString("hex");
}

/**
 * Find the nearest grid cell to a given lat/lon.
 * Returns null if no cell is within MAX_MATCH_DISTANCE_DEG.
 */
function findNearestCell(lat, lon, gridCells) {
  let best = null;
  let bestDist = Infinity;

  for (const cell of gridCells) {
    const dLat = cell.lat - lat;
    const dLon = cell.lon - lon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    if (dist < bestDist) {
      bestDist = dist;
      best = cell;
    }
  }

  if (bestDist <= MAX_MATCH_DISTANCE_DEG) {
    return { ...best, distance_deg: bestDist };
  }
  return null;
}

/**
 * Build a spatial index for fast grid cell lookup.
 * Groups cells into 0.1-degree buckets for O(1) lookup.
 */
function buildSpatialIndex(gridCells) {
  const index = {};
  for (const cell of gridCells) {
    const key = `${Math.floor(cell.lat * 10)}:${Math.floor(cell.lon * 10)}`;
    if (!index[key]) index[key] = [];
    index[key].push(cell);
  }
  return index;
}

function findNearestCellFast(lat, lon, spatialIndex) {
  const bucketLat = Math.floor(lat * 10);
  const bucketLon = Math.floor(lon * 10);

  let best = null;
  let bestDist = Infinity;

  // Check the cell's bucket and all 8 neighbors
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const key = `${bucketLat + di}:${bucketLon + dj}`;
      const cells = spatialIndex[key];
      if (!cells) continue;
      for (const cell of cells) {
        const dLat = cell.lat - lat;
        const dLon = cell.lon - lon;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        if (dist < bestDist) {
          bestDist = dist;
          best = cell;
        }
      }
    }
  }

  if (best && bestDist <= MAX_MATCH_DISTANCE_DEG) {
    return { ...best, distance_deg: bestDist };
  }
  return null;
}

async function ensureSchema(client) {
  // Create mesh_hail_observations table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS mesh_hail_observations (
      id TEXT PRIMARY KEY,
      date DATE NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      mesh_mm DOUBLE PRECISION NOT NULL,
      mesh_inches DOUBLE PRECISION NOT NULL,
      source TEXT NOT NULL DEFAULT 'MRMS_MESH_Max_1440min',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS mesh_hail_obs_date_idx
    ON mesh_hail_observations (date)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS mesh_hail_obs_lat_lon_idx
    ON mesh_hail_observations (lat, lon)
  `);

  // Add meshHailInches column to property_storms if not exists
  const colCheck = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'property_storms' AND column_name = 'meshHailInches'
  `);
  if (colCheck.rows.length === 0) {
    await client.query(`
      ALTER TABLE property_storms
      ADD COLUMN "meshHailInches" DOUBLE PRECISION,
      ADD COLUMN "meshHailMm" DOUBLE PRECISION,
      ADD COLUMN "meshDistanceKm" DOUBLE PRECISION,
      ADD COLUMN "meshSource" TEXT
    `);
    console.log("Added MESH columns to property_storms table");
  }

  // Also add to storm_events if not present
  const seColCheck = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'storm_events' AND column_name = 'meshMaxInches'
  `);
  if (seColCheck.rows.length === 0) {
    await client.query(`
      ALTER TABLE storm_events
      ADD COLUMN "meshMaxInches" DOUBLE PRECISION,
      ADD COLUMN "meshMaxMm" DOUBLE PRECISION
    `);
    console.log("Added MESH columns to storm_events table");
  }
}

async function importGridData(client, events, dryRun) {
  let totalInserted = 0;

  for (const event of events) {
    const date = event.date;
    const timestamp = event.timestamp;
    const cells = event.grid_cells;

    if (dryRun) {
      console.log(
        `  [DRY RUN] Would insert ${cells.length} grid cells for ${date}`
      );
      totalInserted += cells.length;
      continue;
    }

    // Delete existing data for this date to avoid duplicates
    await client.query("DELETE FROM mesh_hail_observations WHERE date = $1", [
      date,
    ]);

    // Batch insert in chunks of 500
    const chunkSize = 500;
    for (let i = 0; i < cells.length; i += chunkSize) {
      const chunk = cells.slice(i, i + chunkSize);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const cell of chunk) {
        const id = generateId();
        values.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
        );
        params.push(
          id,
          date,
          timestamp,
          cell.lat,
          cell.lon,
          cell.mesh_mm,
          cell.mesh_inches
        );
      }

      await client.query(
        `INSERT INTO mesh_hail_observations (id, date, timestamp, lat, lon, mesh_mm, mesh_inches)
         VALUES ${values.join(", ")}`,
        params
      );
    }

    totalInserted += cells.length;
    console.log(`  Inserted ${cells.length} grid cells for ${date}`);
  }

  return totalInserted;
}

async function matchPropertiesToMesh(client, events, dryRun) {
  let totalMatched = 0;
  let totalUpdated = 0;

  for (const event of events) {
    const date = event.date;
    const cells = event.grid_cells;

    if (cells.length === 0) continue;

    // Build spatial index for this event's grid cells
    const spatialIndex = buildSpatialIndex(cells);

    // Find storm events for this date in AL
    const stormResult = await client.query(
      `SELECT id, lat, lon, city, county, "hailSizeInches"
       FROM storm_events
       WHERE state = 'AL' AND type = 'HAIL'
         AND date::date = $1::date`,
      [date]
    );

    if (stormResult.rows.length === 0) {
      console.log(`  No matching storm events in DB for ${date}`);
      continue;
    }

    console.log(
      `  Found ${stormResult.rows.length} storm events for ${date}`
    );

    // Update storm_events with max MESH near the SPC report location
    for (const storm of stormResult.rows) {
      if (!storm.lat || !storm.lon) continue;

      // Find max MESH within ~5km of the SPC report point
      let maxMesh = 0;
      for (const cell of cells) {
        const dLat = cell.lat - storm.lat;
        const dLon = cell.lon - storm.lon;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        if (dist <= 0.05 && cell.mesh_mm > maxMesh) {
          // ~5km radius
          maxMesh = cell.mesh_mm;
        }
      }

      if (maxMesh > 0 && !dryRun) {
        await client.query(
          `UPDATE storm_events SET "meshMaxMm" = $1, "meshMaxInches" = $2 WHERE id = $3`,
          [maxMesh, Math.round((maxMesh / 25.4) * 100) / 100, storm.id]
        );
      }
    }

    // Find property_storms for this date and update with MESH data
    const psResult = await client.query(
      `SELECT ps.id, ps."propertyId", ps."stormEventId",
              p.lat, p.lon, p.address, p.city
       FROM property_storms ps
       JOIN properties p ON p.id = ps."propertyId"
       JOIN storm_events se ON se.id = ps."stormEventId"
       WHERE se.state = 'AL' AND se.type = 'HAIL'
         AND se.date::date = $1::date
         AND p.lat IS NOT NULL AND p.lon IS NOT NULL`,
      [date]
    );

    console.log(
      `  Found ${psResult.rows.length} property-storm links for ${date}`
    );

    for (const ps of psResult.rows) {
      const nearest = findNearestCellFast(ps.lat, ps.lon, spatialIndex);

      if (nearest) {
        totalMatched++;
        const distKm =
          Math.round(nearest.distance_deg * 111.32 * 100) / 100;

        if (!dryRun) {
          await client.query(
            `UPDATE property_storms
             SET "meshHailInches" = $1, "meshHailMm" = $2,
                 "meshDistanceKm" = $3, "meshSource" = $4
             WHERE id = $5`,
            [
              nearest.mesh_inches,
              nearest.mesh_mm,
              distKm,
              "MRMS_MESH_Max_1440min",
              ps.id,
            ]
          );
          totalUpdated++;
        } else {
          console.log(
            `    [DRY RUN] ${ps.address}, ${ps.city}: ${nearest.mesh_inches} in (${distKm} km away)`
          );
        }
      }
    }

    // Also: find ALL properties in the hail swath, even if they don't
    // have a property_storms link yet. This is the key value of MESH data.
    const bbox = event.bbox;
    const propsInArea = await client.query(
      `SELECT id, lat, lon, address, city
       FROM properties
       WHERE state = 'AL'
         AND lat BETWEEN $1 AND $2
         AND lon BETWEEN $3 AND $4
         AND lat IS NOT NULL AND lon IS NOT NULL`,
      [bbox.lat_min, bbox.lat_max, bbox.lon_min, bbox.lon_max]
    );

    let newLinks = 0;
    for (const prop of propsInArea.rows) {
      const nearest = findNearestCellFast(prop.lat, prop.lon, spatialIndex);
      if (!nearest) continue;

      // Only create links for significant hail (> 0.75 inch = penny size)
      if (nearest.mesh_inches < 0.75) continue;

      // Check if we already have a storm event for this date near this property
      for (const storm of stormResult.rows) {
        // Check if link already exists
        const existing = await client.query(
          `SELECT id FROM property_storms
           WHERE "propertyId" = $1 AND "stormEventId" = $2`,
          [prop.id, storm.id]
        );

        if (existing.rows.length > 0) {
          // Update existing with MESH data
          if (!dryRun) {
            const distKm =
              Math.round(nearest.distance_deg * 111.32 * 100) / 100;
            await client.query(
              `UPDATE property_storms
               SET "meshHailInches" = GREATEST(COALESCE("meshHailInches", 0), $1),
                   "meshHailMm" = GREATEST(COALESCE("meshHailMm", 0), $2),
                   "meshDistanceKm" = LEAST(COALESCE("meshDistanceKm", 999), $3),
                   "meshSource" = $4
               WHERE "propertyId" = $5 AND "stormEventId" = $6`,
              [
                nearest.mesh_inches,
                nearest.mesh_mm,
                Math.round(nearest.distance_deg * 111.32 * 100) / 100,
                "MRMS_MESH_Max_1440min",
                prop.id,
                storm.id,
              ]
            );
          }
          continue;
        }

        // Calculate distance from property to storm event center
        if (!storm.lat || !storm.lon) continue;
        const dLat = prop.lat - storm.lat;
        const dLon = prop.lon - storm.lon;
        const distToStorm = Math.sqrt(dLat * dLat + dLon * dLon);

        // Only link if property is within reasonable distance of the SPC report
        if (distToStorm > 0.5) continue; // ~50km

        if (!dryRun) {
          const distKm =
            Math.round(nearest.distance_deg * 111.32 * 100) / 100;
          const distMeters = Math.round(distToStorm * 111320);
          await client.query(
            `INSERT INTO property_storms
             (id, "propertyId", "stormEventId", "distanceMeters", affected,
              "meshHailInches", "meshHailMm", "meshDistanceKm", "meshSource")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT ("propertyId", "stormEventId") DO UPDATE SET
               "meshHailInches" = GREATEST(EXCLUDED."meshHailInches", property_storms."meshHailInches"),
               "meshHailMm" = GREATEST(EXCLUDED."meshHailMm", property_storms."meshHailMm"),
               "meshDistanceKm" = LEAST(EXCLUDED."meshDistanceKm", property_storms."meshDistanceKm"),
               "meshSource" = EXCLUDED."meshSource"`,
            [
              generateId(),
              prop.id,
              storm.id,
              distMeters,
              true,
              nearest.mesh_inches,
              nearest.mesh_mm,
              distKm,
              "MRMS_MESH_Max_1440min",
            ]
          );
          newLinks++;
        }
        break; // Only link to first matching storm event
      }
    }

    if (newLinks > 0) {
      console.log(
        `  Created ${newLinks} new property-storm links from MESH data`
      );
    }
  }

  return { totalMatched, totalUpdated };
}

async function main() {
  const opts = parseArgs();

  console.log(`Reading MESH data from: ${opts.file}`);
  if (!fs.existsSync(opts.file)) {
    console.error(`File not found: ${opts.file}`);
    console.error(
      "Run fetch-mrms-mesh.py first to generate the MESH data file."
    );
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(opts.file, "utf-8"));
  console.log(`Generated: ${data.generated_at}`);
  console.log(`Events: ${data.events.length}`);
  console.log(
    `Total grid cells with hail: ${data.events.reduce((s, e) => s + e.grid_cells.length, 0)}`
  );

  if (opts.dryRun) {
    console.log("\n*** DRY RUN MODE - no changes will be written ***\n");
  }

  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    // Ensure schema is up to date
    await ensureSchema(client);
    console.log("Schema verified.");

    // Import raw grid data
    console.log("\n--- Importing grid data ---");
    const gridCount = await importGridData(client, data.events, opts.dryRun);
    console.log(`Grid data: ${gridCount} cells imported`);

    // Match properties to MESH data
    console.log("\n--- Matching properties to MESH data ---");
    const { totalMatched, totalUpdated } = await matchPropertiesToMesh(
      client,
      data.events,
      opts.dryRun
    );
    console.log(`Properties matched: ${totalMatched}`);
    console.log(`Property-storms updated: ${totalUpdated}`);

    // Summary stats
    console.log("\n=== Import Summary ===");
    const stats = await client.query(`
      SELECT
        COUNT(*) as total_observations,
        COUNT(DISTINCT date) as dates,
        MAX(mesh_inches) as max_hail_inches,
        AVG(mesh_inches) as avg_hail_inches
      FROM mesh_hail_observations
    `);
    if (stats.rows[0].total_observations > 0) {
      const s = stats.rows[0];
      console.log(`Total MESH observations: ${s.total_observations}`);
      console.log(`Dates covered: ${s.dates}`);
      console.log(
        `Max hail: ${Number(s.max_hail_inches).toFixed(2)} inches`
      );
      console.log(
        `Avg hail: ${Number(s.avg_hail_inches).toFixed(2)} inches`
      );
    }

    const psStats = await client.query(`
      SELECT COUNT(*) as count FROM property_storms WHERE "meshHailInches" IS NOT NULL
    `);
    console.log(
      `Property-storms with MESH data: ${psStats.rows[0].count}`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
