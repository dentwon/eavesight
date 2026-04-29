# Roof Intelligence — Strategic Frame

**Status:** Pre-brainstorm. Not started. Captured 2026-04-28.

## The unlock

For every property in North Alabama (currently ~243k records across Madison,
Limestone, Morgan, Marshall, Jackson counties), output a calibrated estimate
of:

- Roof material (asphalt / metal / tile / membrane / unknown)
- Last replacement year (real, not assessor-inferred)
- Replacement probability in the next 24 months
- Confidence per signal

If this works, Eavesight stops being a property scoring tool and becomes the
canonical roof-condition database for the metro. That's the moat.

## Why the prior attempt failed

Pixel-level year-over-year diffing on NAIP. Noise dominated signal — sun
angle, off-nadir angle, atmospheric variation, JPEG/sensor drift, gradual
material aging all produced false positives larger than actual replacement
events. Output was unusable. We did not retry with smarter methods.

## Why this is now tractable

1. **Permits as ground truth** — we already harvest building permits across
   the metro. Properties with known roof permits in year X are labeled
   replacement events. We never used them as labels before.
2. **NIR is in NAIP and we ignored it.** RGB throws away the most
   material-discriminative band. Spectral ratios (NIR/Red, etc.) are
   illumination-invariant — they cancel the noise that killed the prior
   attempt.
3. **Foundation models for satellite imagery exist now** — Prithvi (NASA/IBM),
   SatMAE, Clay. Pre-trained on millions of scenes. Fine-tune with our
   permit labels.
4. **LIDAR pipeline now in place** for downtown — gives us roof-shape signals
   complementary to imagery (roof complexity, ridge density, etc.).

## What we already have

- 243k property records across 5 N. Alabama counties (assessor + permits)
- 174k Madison detailed parcel records w/ deed history, assessment values
- Building permits in DB (need to count + bucket by type — TODO)
- Storm history per property (hail/wind events with dates)
- NAIP 2023 60cm (165 scenes for metro, on disk)
- Microsoft + OSM unified building footprints (300k+ in metro)
- LIDAR for downtown (6 tiles processed, real heights extracted)
- Tippecanoe / PDAL / GDAL / rasterio toolchain set up on VM

## What we don't have yet

- Multi-year NAIP (2017, 2019, 2021)
- Parcel polygons (we have centroids only)
- A roof-permit-to-property linkage report (i.e. how many permits are
  spatially matched and over what date range)
- Higher-than-NAIP imagery (Vexcel/NearMap = paid)
- Any ML pipeline / training infrastructure

## Brainstorm questions to anchor session 1

1. Who's the buyer of this signal — roofer / insurance / homeowner /
   wholesaler? Each implies a different output format and acceptable error
   rate.
2. What's the unit value of one correct prediction (dollars saved /
   conversion lift / time saved)?
3. How many permit-labeled examples do we have across the metro? Distribution
   by year and by county?
4. Is the moat the model, the training set, or the integrated pipeline
   (imagery + storms + permits + assessor + scoring)?
5. What's the floor-of-value if the ML doesn't work?
   - If material classification works (~95%) but replacement detection only
     hits ~60%, do we ship anyway? What does that look like as a product?
6. What does "ready to monetize" look like — demo, beta with one roofer,
   full product?
7. What are the 5 hardest sub-problems, and which are fatal-if-unsolved vs
   nice-to-have?

## Approach (deferred until brainstorm)

The session-1 output should be a one-page spec with:

- Concrete output schema (the JSON the model emits per property)
- Definition of done (accuracy / coverage / latency targets)
- Phased plan with falsifiable checkpoints
- Decision: ship roof-material-only first, or wait for full pipeline?

After session 1, focused research (~1 session) on:

- Best architecture for material classification at 30cm aerial
- Published Siamese / Triplet networks for permit-anchored change detection
- Foundation models we should fine-tune on (Prithvi vs SatMAE vs Clay)
- Industry benchmarks (what accuracy do existing roof-condition tools claim?)

Then build, in checkpoint slices.

## Pointers

- Permit table: `building_permits` (need to inspect)
- Storm events: `storms` and `propertyStorms`
- Assessor stories / yearBuilt: `properties.stories`, `properties.yearBuilt`
- Footprints + heights: `v7_features` → `buildings-v8.pmtiles`
- LIDAR raster: `/home/dentwon/Eavesight/data/lidar/hag.tif`
- NAIP 2023: `/home/dentwon/Eavesight/data/naip/scenes-metro/`
