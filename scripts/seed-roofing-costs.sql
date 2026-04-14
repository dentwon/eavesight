-- StormVault Roofing Cost Database Seed
-- Regional pricing data for North Alabama (Huntsville/Madison County) market
-- Sources: Multiple 2025-2026 roofing industry pricing guides
-- Last updated: 2026-03-28

-- All costs are per roofing square (100 sqft) unless noted
-- cost_per_square = material cost only (per square)
-- labor_per_square = labor cost only (per square)
-- tearoff_per_square = tear-off + disposal cost (per square)
-- waste_factor = multiplier for waste/cuts (e.g., 0.12 = 12% extra material)
-- Estimated total per square = (cost_per_square + labor_per_square + tearoff_per_square) * (1 + waste_factor)

CREATE TABLE IF NOT EXISTS roofing_costs (
  id TEXT PRIMARY KEY,
  material TEXT NOT NULL,
  material_label TEXT NOT NULL,
  region TEXT DEFAULT 'north_alabama',
  cost_per_square_low FLOAT,
  cost_per_square_mid FLOAT,
  cost_per_square_high FLOAT,
  labor_per_square_low FLOAT,
  labor_per_square_mid FLOAT,
  labor_per_square_high FLOAT,
  tearoff_per_square FLOAT DEFAULT 125.0,
  waste_factor FLOAT DEFAULT 0.12,
  permit_flat_fee FLOAT DEFAULT 250.0,
  typical_lifespan_years INT,
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Clear existing data for idempotent re-runs
DELETE FROM roofing_costs WHERE region = 'north_alabama';

-- 3-Tab Asphalt Shingles
-- Most affordable option. $3.50-4.50/sqft installed. Material ~$80-110/square.
-- North Alabama labor: $150-200/square for basic shingles.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_3tab_asphalt_north_al',
  'ASPHALT_SHINGLE', '3-Tab Asphalt Shingles', 'north_alabama',
  80, 95, 115,
  150, 175, 210,
  100, 0.10, 250, 18,
  'Most common budget option. Flat appearance. 60-70 mph wind rating. Common brands: GAF Royal Sovereign, Owens Corning Supreme.'
);

-- Architectural (Dimensional) Asphalt Shingles
-- $4.50-6.50/sqft installed. Material ~$100-170/square.
-- North Alabama labor: $175-250/square.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_arch_asphalt_north_al',
  'ASPHALT_SHINGLE', 'Architectural Asphalt Shingles', 'north_alabama',
  100, 135, 175,
  175, 215, 260,
  110, 0.12, 250, 30,
  'Most popular residential choice. Dimensional look. 110-130 mph wind rating. Common brands: GAF Timberline HDZ, Owens Corning Duration.'
);

-- Standing Seam Metal Roof
-- Alabama-specific: $8-14/sqft installed. Material ~$350-650/square.
-- Labor: $250-450/square (specialized installation).
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_metal_standing_seam_north_al',
  'METAL', 'Standing Seam Metal', 'north_alabama',
  350, 500, 680,
  280, 380, 480,
  130, 0.15, 300, 50,
  'Premium metal option. Concealed fasteners. Excellent wind/hail resistance. 140+ mph wind rating. Popular in North AL for longevity.'
);

-- Corrugated/Ribbed Metal Roof
-- Alabama-specific: $3-6/sqft for material. Total $5-10/sqft installed.
-- More affordable metal option.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_metal_corrugated_north_al',
  'METAL', 'Corrugated/Ribbed Metal', 'north_alabama',
  200, 300, 420,
  200, 275, 350,
  120, 0.12, 275, 40,
  'Budget-friendly metal. Exposed fasteners. Good for outbuildings and budget-conscious homeowners. 110+ mph wind rating.'
);

-- Clay Tile Roof
-- $5.90-14.68/sqft installed. Material ~$300-600/square.
-- Less common in North AL but found on upscale homes.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_tile_clay_north_al',
  'TILE_CLAY', 'Clay Tile', 'north_alabama',
  300, 450, 650,
  350, 475, 600,
  175, 0.15, 350, 75,
  'Premium material. Heavy - may require structural reinforcement. Rare in North AL. Excellent longevity. Specialist labor required.'
);

-- Concrete Tile Roof
-- More affordable than clay. $3-6/sqft material.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_tile_concrete_north_al',
  'TILE_CONCRETE', 'Concrete Tile', 'north_alabama',
  200, 325, 450,
  300, 400, 525,
  175, 0.15, 325, 50,
  'More affordable than clay tile. Still heavy. Less common in North AL market. Good fire resistance.'
);

-- Natural Slate Roof
-- $15-30/sqft installed. Material ~$800-1800/square.
-- Very rare in North AL. Premium/historic homes only.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_slate_north_al',
  'SLATE', 'Natural Slate', 'north_alabama',
  800, 1200, 1800,
  600, 900, 1500,
  200, 0.15, 400, 100,
  'Ultra-premium. 100+ year lifespan. Extremely heavy. Very few qualified installers in North AL. Historic/luxury homes only.'
);

-- Wood Shake Roof
-- $6-10/sqft installed. Material ~$250-450/square.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_wood_shake_north_al',
  'WOOD_SHAKE', 'Wood Shake/Shingle', 'north_alabama',
  250, 350, 480,
  275, 375, 500,
  140, 0.15, 300, 25,
  'Natural aesthetic. Requires more maintenance. Fire risk concern in some areas. Cedar shake most common. Check local fire codes.'
);

-- TPO (Thermoplastic Polyolefin) - Commercial/Flat Roof
-- $5.50-10.30/sqft installed. Material ~$180-350/square.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_tpo_north_al',
  'TPO', 'TPO Membrane', 'north_alabama',
  180, 265, 360,
  250, 350, 475,
  100, 0.10, 300, 25,
  'Most popular commercial single-ply membrane. Energy-efficient white surface. Good for flat/low-slope roofs. Heat-welded seams.'
);

-- EPDM (Ethylene Propylene Diene Monomer) - Commercial/Flat Roof
-- $4.20-9.00/sqft installed. Material ~$150-300/square.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_epdm_north_al',
  'EPDM', 'EPDM Rubber Membrane', 'north_alabama',
  150, 225, 320,
  220, 310, 425,
  95, 0.10, 275, 25,
  'Durable rubber membrane for flat/low-slope roofs. Black surface (less energy-efficient than TPO). Proven 40+ year track record. Glued or ballasted.'
);

-- Built-Up Roof (BUR) - Commercial
-- $4-8/sqft installed. Multiple layers of bitumen and reinforcing fabrics.
INSERT INTO roofing_costs (id, material, material_label, region,
  cost_per_square_low, cost_per_square_mid, cost_per_square_high,
  labor_per_square_low, labor_per_square_mid, labor_per_square_high,
  tearoff_per_square, waste_factor, permit_flat_fee, typical_lifespan_years, notes)
VALUES (
  'rc_buildup_north_al',
  'BUILT_UP', 'Built-Up Roof (BUR)', 'north_alabama',
  200, 300, 420,
  250, 350, 475,
  130, 0.10, 300, 25,
  'Traditional multi-layer flat roof system. Hot-applied or cold-applied. Good for large commercial buildings. Labor-intensive installation.'
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_roofing_costs_material ON roofing_costs(material);
CREATE INDEX IF NOT EXISTS idx_roofing_costs_region ON roofing_costs(region);

-- Pitch factor reference table (used by the estimator)
CREATE TABLE IF NOT EXISTS roof_pitch_factors (
  pitch_ratio TEXT PRIMARY KEY,
  pitch_degrees FLOAT,
  area_multiplier FLOAT NOT NULL,
  description TEXT
);

DELETE FROM roof_pitch_factors;

INSERT INTO roof_pitch_factors (pitch_ratio, pitch_degrees, area_multiplier, description) VALUES
  ('flat',     0,    1.00, 'Flat roof (0-1:12)'),
  ('1:12',     4.76, 1.003, 'Nearly flat'),
  ('2:12',     9.46, 1.014, 'Low slope'),
  ('3:12',    14.04, 1.031, 'Low slope - minimum for shingles'),
  ('4:12',    18.43, 1.054, 'Standard residential'),
  ('5:12',    22.62, 1.083, 'Standard residential'),
  ('6:12',    26.57, 1.118, 'Common residential'),
  ('7:12',    30.26, 1.158, 'Moderate steep'),
  ('8:12',    33.69, 1.202, 'Steep - may require extra safety'),
  ('9:12',    36.87, 1.250, 'Steep'),
  ('10:12',   39.81, 1.302, 'Very steep - added labor cost'),
  ('11:12',   42.51, 1.357, 'Very steep'),
  ('12:12',   45.00, 1.414, 'Maximum common pitch');

-- Verify the seed
SELECT material_label,
       cost_per_square_low || ' / ' || cost_per_square_mid || ' / ' || cost_per_square_high AS "material_low/mid/high",
       labor_per_square_low || ' / ' || labor_per_square_mid || ' / ' || labor_per_square_high AS "labor_low/mid/high",
       tearoff_per_square AS tearoff,
       typical_lifespan_years AS lifespan
FROM roofing_costs
WHERE region = 'north_alabama'
ORDER BY cost_per_square_mid;
