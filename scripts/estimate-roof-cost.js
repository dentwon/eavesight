#!/usr/bin/env node
/**
 * Eavesight Roof Cost Estimator
 *
 * Estimates roof replacement/repair costs for a property based on:
 * - Building footprint area (from building_footprints table)
 * - Roof pitch (from roof_data table, or default)
 * - Material type(s) (from roofing_costs table)
 * - Region (default: north_alabama)
 *
 * Usage:
 *   node estimate-roof-cost.js <propertyId>
 *   node estimate-roof-cost.js <propertyId> --material METAL
 *   node estimate-roof-cost.js <propertyId> --sqft 2000
 *   node estimate-roof-cost.js <propertyId> --pitch 6:12
 *   node estimate-roof-cost.js <propertyId> --json
 *
 * Environment:
 *   DB_HOST (default: localhost)
 *   DB_PORT (default: 5433)
 *   DB_NAME (default: eavesight)
 *   DB_USER (default: eavesight)
 *   DB_PASS (default: eavesight)
 */

const { Client } = require('pg');

// --- Config ---
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'eavesight',
  user: process.env.DB_USER || 'eavesight',
  password: process.env.DB_PASS || 'eavesight',
};

const DEFAULT_PITCH_MULTIPLIER = 1.118; // 6:12 pitch, very common in North AL
const DEFAULT_STORIES = 1;
const STORIES_SURCHARGE = 0.15; // 15% labor surcharge per story above 1

// --- Helpers ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    propertyId: null,
    material: null,
    sqft: null,
    pitch: null,
    stories: DEFAULT_STORIES,
    region: 'north_alabama',
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--material' && args[i + 1]) {
      opts.material = args[++i].toUpperCase();
    } else if (args[i] === '--sqft' && args[i + 1]) {
      opts.sqft = parseFloat(args[++i]);
    } else if (args[i] === '--pitch' && args[i + 1]) {
      opts.pitch = args[++i];
    } else if (args[i] === '--stories' && args[i + 1]) {
      opts.stories = parseInt(args[++i], 10);
    } else if (args[i] === '--region' && args[i + 1]) {
      opts.region = args[++i];
    } else if (args[i] === '--json') {
      opts.json = true;
    } else if (!args[i].startsWith('--')) {
      opts.propertyId = args[i];
    }
  }
  return opts;
}

async function getPropertyData(client, propertyId) {
  // Get building footprint area
  const footprintRes = await client.query(
    'SELECT "areaSqft" FROM building_footprints WHERE "propertyId" = $1',
    [propertyId]
  );

  // Get roof data if available
  const roofRes = await client.query(
    `SELECT "totalAreaSqft", "pitchRatio", "pitchDegrees", material
     FROM roof_data WHERE "propertyId" = $1`,
    [propertyId]
  );

  return {
    footprint: footprintRes.rows[0] || null,
    roof: roofRes.rows[0] || null,
  };
}

async function getPitchMultiplier(client, pitchRatio) {
  if (!pitchRatio) return DEFAULT_PITCH_MULTIPLIER;
  const res = await client.query(
    'SELECT area_multiplier FROM roof_pitch_factors WHERE pitch_ratio = $1',
    [pitchRatio]
  );
  return res.rows[0]?.area_multiplier || DEFAULT_PITCH_MULTIPLIER;
}

async function getRoofingCosts(client, region, material) {
  let query = 'SELECT * FROM roofing_costs WHERE region = $1';
  const params = [region];

  if (material) {
    query += ' AND material = $2';
    params.push(material);
  }

  query += ' ORDER BY cost_per_square_mid';
  const res = await client.query(query, params);
  return res.rows;
}

function calculateEstimate(costRow, roofAreaSqft, stories) {
  const squares = roofAreaSqft / 100;
  const wasteFactor = 1 + costRow.waste_factor;
  const storiesSurcharge = 1 + Math.max(0, stories - 1) * STORIES_SURCHARGE;

  // Material cost includes waste factor
  const materialLow = costRow.cost_per_square_low * squares * wasteFactor;
  const materialMid = costRow.cost_per_square_mid * squares * wasteFactor;
  const materialHigh = costRow.cost_per_square_high * squares * wasteFactor;

  // Labor includes waste factor (more area to cover) and stories surcharge
  const laborLow = costRow.labor_per_square_low * squares * wasteFactor * storiesSurcharge;
  const laborMid = costRow.labor_per_square_mid * squares * wasteFactor * storiesSurcharge;
  const laborHigh = costRow.labor_per_square_high * squares * wasteFactor * storiesSurcharge;

  // Tear-off is per square, includes waste area
  const tearoff = costRow.tearoff_per_square * squares * wasteFactor;

  // Permit is flat fee
  const permit = costRow.permit_flat_fee;

  return {
    material: costRow.material,
    material_label: costRow.material_label,
    squares_needed: Math.round(squares * wasteFactor * 10) / 10,
    lifespan_years: costRow.typical_lifespan_years,
    breakdown: {
      material: { low: Math.round(materialLow), mid: Math.round(materialMid), high: Math.round(materialHigh) },
      labor: { low: Math.round(laborLow), mid: Math.round(laborMid), high: Math.round(laborHigh) },
      tearoff: Math.round(tearoff),
      permit: permit,
    },
    low: Math.round(materialLow + laborLow + tearoff + permit),
    mid: Math.round(materialMid + laborMid + tearoff + permit),
    high: Math.round(materialHigh + laborHigh + tearoff + permit),
    notes: costRow.notes,
  };
}

// --- Main ---

async function main() {
  const opts = parseArgs();

  if (!opts.propertyId) {
    console.error('Usage: node estimate-roof-cost.js <propertyId> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --material TYPE    Filter to specific material (e.g., METAL, ASPHALT_SHINGLE)');
    console.error('  --sqft N           Override roof area (sqft) instead of looking up footprint');
    console.error('  --pitch RATIO      Override pitch (e.g., 6:12, 8:12)');
    console.error('  --stories N        Number of stories (default: 1)');
    console.error('  --region NAME      Region for pricing (default: north_alabama)');
    console.error('  --json             Output as JSON');
    process.exit(1);
  }

  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    // 1. Get property data
    const propData = await getPropertyData(client, opts.propertyId);
    let footprintSqft = opts.sqft;
    let pitchRatio = opts.pitch;
    let knownMaterial = opts.material;

    if (!footprintSqft) {
      if (!propData.footprint) {
        console.error(`No building footprint found for property ${opts.propertyId}`);
        process.exit(1);
      }
      footprintSqft = propData.footprint.areaSqft;
    }

    // Use roof_data if available and no overrides
    if (propData.roof) {
      if (!pitchRatio && propData.roof.pitchRatio) {
        pitchRatio = propData.roof.pitchRatio;
      }
      if (!knownMaterial && propData.roof.material) {
        knownMaterial = propData.roof.material;
      }
    }

    // 2. Calculate roof area from footprint + pitch
    const pitchMultiplier = await getPitchMultiplier(client, pitchRatio);
    const roofAreaSqft = footprintSqft * pitchMultiplier;

    // 3. Get pricing data
    const costRows = await getRoofingCosts(client, opts.region, knownMaterial);

    if (costRows.length === 0) {
      console.error(`No roofing cost data found for region=${opts.region}` +
        (knownMaterial ? `, material=${knownMaterial}` : ''));
      process.exit(1);
    }

    // 4. Calculate estimates for each material
    const estimates = costRows.map(row =>
      calculateEstimate(row, roofAreaSqft, opts.stories)
    );

    // 5. Build result
    const result = {
      property_id: opts.propertyId,
      footprint_sqft: Math.round(footprintSqft),
      roof_area_sqft: Math.round(roofAreaSqft),
      pitch: pitchRatio || `default (${DEFAULT_PITCH_MULTIPLIER}x)`,
      pitch_multiplier: pitchMultiplier,
      stories: opts.stories,
      region: opts.region,
      material_options: estimates,
    };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Pretty-print
      console.log('');
      console.log('=== Eavesight Roof Cost Estimate ===');
      console.log(`Property:       ${result.property_id}`);
      console.log(`Footprint:      ${result.footprint_sqft.toLocaleString()} sqft`);
      console.log(`Roof Area:      ${result.roof_area_sqft.toLocaleString()} sqft (pitch: ${result.pitch}, ${result.pitch_multiplier}x)`);
      console.log(`Stories:        ${result.stories}`);
      console.log(`Region:         ${result.region}`);
      console.log('');

      for (const est of estimates) {
        console.log(`--- ${est.material_label} (${est.material}) ---`);
        console.log(`  Squares needed:  ${est.squares_needed}`);
        console.log(`  Lifespan:        ${est.lifespan_years} years`);
        console.log(`  Material cost:   $${est.breakdown.material.low.toLocaleString()} - $${est.breakdown.material.high.toLocaleString()}`);
        console.log(`  Labor cost:      $${est.breakdown.labor.low.toLocaleString()} - $${est.breakdown.labor.high.toLocaleString()}`);
        console.log(`  Tear-off:        $${est.breakdown.tearoff.toLocaleString()}`);
        console.log(`  Permit:          $${est.breakdown.permit.toLocaleString()}`);
        console.log(`  --------------------------`);
        console.log(`  TOTAL:           $${est.low.toLocaleString()} / $${est.mid.toLocaleString()} / $${est.high.toLocaleString()}`);
        console.log(`                   (low)      (mid)      (high)`);
        console.log('');
      }
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
