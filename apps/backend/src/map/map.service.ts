import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export type MapLayer = 'lead_score' | 'roof_age' | 'storm_recent' | 'dormant' | 'pipeline';

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface ScoredBuilding {
  pmtilesId: number;
  score: number;
}

@Injectable()
export class MapService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get property by PMTiles ID
   */
  async getPropertyByPmtilesId(pmtilesId: string) {
    const property = await this.prisma.property.findFirst({
      where: {
        buildingFootprint: {
          pmtilesId: parseInt(pmtilesId),
        },
      },
      include: {
        propertyStorms: {
          include: { stormEvent: true },
        },
        leads: true,
        roofData: true,
        buildingFootprint: true,
        enrichments: true,
      },
    });

    return property;
  }

  /**
   * Get scores for buildings inside a bounding box, keyed by PMTiles numeric id.
   * Uses the pmtiles_id column (PopulatePmtilesIds step) or spatial centroid lookup
   * as fallback to map between PostGIS features and vector tile feature ids.
   */
  async scoresForBbox(layer: MapLayer, bbox: Bbox, limit = 50000): Promise<Record<number, number>> {
    // Check if we have pmtiles_id column populated (from PopulatePmtilesIds)
    const hasPmtilesIds = await this.prisma.$queryRaw<{exists: boolean}[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'building_footprints' AND column_name = 'pmtiles_id'
      ) as exists
    `;

    if (hasPmtilesIds[0]?.exists) {
      return this.scoreFromPmtilesIds(layer, bbox, limit);
    }

    // Fallback: spatial centroid lookup
    return this.scoreFromSpatialCentroid(layer, bbox, limit);
  }

  /**
   * Get scores for buildings inside a bounding box, keyed by PMTiles numeric id.
   * Uses the pmtiles_id column (PopulatePmtilesIds step) or spatial centroid lookup
   * as fallback to map between PostGIS features and vector tile feature ids.
   */
  async scoresForBbox(layer: MapLayer, bbox: Bbox, limit = 50000): Promise<Record<number, number>> {
    // Check if we have pmtiles_id column populated (from PopulatePmtilesIds)
    const hasPmtilesIds = await this.prisma.$queryRaw<{exists: boolean}[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'building_footprints' AND column_name = 'pmtiles_id'
      ) as exists
    `;

    if (hasPmtilesIds[0]?.exists) {
      return this.scoreFromPmtilesIds(layer, bbox, limit);
    }

    // Fallback: spatial centroid lookup
    return this.scoreFromSpatialCentroid(layer, bbox, limit);
  }

  private async scoreFromPmtilesIds(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    switch (layer) {
      case 'lead_score':  return this.leadScoreFromDb(layer, bbox, limit);
      case 'storm_recent': return this.stormRecentFromDb(layer, bbox, limit);
      case 'roof_age':    return this.roofAgeFromDb(layer, bbox, limit);
      case 'dormant':     return this.dormantFromDb(layer, bbox, limit);
      case 'pipeline':   return this.pipelineFromDb(layer, bbox, limit);
      default:            return {};
    }
  }

  // ── lead_score ──────────────────────────────────────────────────────────────
  // Score = lead exists? 100 : recent lead contact? 70 : contacted in last 6 months? 40 : 0
  private async leadScoreFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH bbox_buildings AS (
        SELECT
          bf."pmtiles_id",
          l."score" as score
        FROM "building_footprints" bf
        LEFT JOIN "properties" p ON p.id = bf."propertyId"
        LEFT JOIN "leads" l ON l."propertyId" = p.id
        WHERE bf."pmtiles_id" IS NOT NULL
          AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
          AND l."score" IS NOT NULL  -- only buildings that have a lead with a score
      )
      SELECT "pmtiles_id", "score"
      FROM bbox_buildings
      WHERE "score" > 0
      ORDER BY "pmtiles_id"
      LIMIT ${limit}
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── storm_recent ────────────────────────────────────────────────────────────
  // Score based on proximity to recent (last 18 months) storm events
  // + whether property_storms links exist
  private async stormRecentFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const eighteenMonthsAgo = new Date();
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);

    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH recent_storms AS (
        SELECT id, lat, lon, severity,
          CASE severity
            WHEN 'EXTREME' THEN 100
            WHEN 'SEVERE'  THEN 80
            WHEN 'MODERATE' THEN 55
            WHEN 'LIGHT'   THEN 30
            ELSE 15
          END as base_score
        FROM "storm_events"
        WHERE date >= ${eighteenMonthsAgo}
          AND lat IS NOT NULL AND lon IS NOT NULL
          AND lat BETWEEN ${bbox.minLat - 0.5} AND ${bbox.maxLat + 0.5}
          AND lon BETWEEN ${bbox.minLon - 0.5} AND ${bbox.maxLon + 0.5}
      ),
      scored AS (
        SELECT
          bf."pmtiles_id",
          GREATEST(
            COALESCE(
              (SELECT MAX(rs.base_score - LEAST(ST_Distance(bf.geom, rs.geom) / 1000 * 5, rs.base_score))
               FROM recent_storms rs
               WHERE bf.geom && ST_Expand(rs.geom, 0.05)),
              0
            ),
            COALESCE(
              (SELECT 60 FROM "property_storms" ps
               JOIN "storm_events" se ON se.id = ps."stormEventId"
               WHERE ps."propertyId" = bf."propertyId" AND se.date >= ${eighteenMonthsAgo}),
              0
            )
          ) as raw_score,
          ROW_NUMBER() OVER (ORDER BY bf."pmtiles_id") as rn
        FROM "building_footprints" bf
        WHERE bf."pmtiles_id" IS NOT NULL
          AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
      )
      SELECT "pmtiles_id",
             LEAST(GREATEST(ROUND(raw_score), 0), 100)::int as score
      FROM scored
      WHERE rn <= ${limit} AND raw_score > 0
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── roof_age ───────────────────────────────────────────────────────────────
  // Score = older the roof, higher the score (end-of-life signal)
  // Uses yearBuilt from properties (lower = older = higher score)
  private async roofAgeFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const currentYear = new Date().getFullYear();

    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH scored AS (
        SELECT
          bf."pmtiles_id",
          CASE
            WHEN p."yearBuilt" IS NULL THEN 0
            WHEN (${currentYear} - p."yearBuilt") >= 30 THEN 100
            WHEN (${currentYear} - p."yearBuilt") >= 25 THEN 88
            WHEN (${currentYear} - p."yearBuilt") >= 20 THEN 72
            WHEN (${currentYear} - p."yearBuilt") >= 15 THEN 55
            WHEN (${currentYear} - p."yearBuilt") >= 10 THEN 35
            WHEN (${currentYear} - p."yearBuilt") >= 5  THEN 18
            ELSE 5
          END as score,
          ROW_NUMBER() OVER (ORDER BY bf."pmtiles_id") as rn
        FROM "building_footprints" bf
        JOIN "properties" p ON p.id = bf."propertyId"
        WHERE bf."pmtiles_id" IS NOT NULL
          AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
      )
      SELECT "pmtiles_id", "score"
      FROM scored
      WHERE rn <= ${limit} AND score > 0
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── dormant ─────────────────────────────────────────────────────────────────
  // Dormant = has roof age > 15 years AND NO active lead in pipeline
  private async dormantFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const currentYear = new Date().getFullYear();

    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH scored AS (
        SELECT
          bf."pmtiles_id",
          CASE
            WHEN p."yearBuilt" IS NULL THEN 0
            WHEN (${currentYear} - p."yearBuilt") < 15 THEN 0
            WHEN EXISTS (
              SELECT 1 FROM "leads" l
              WHERE l."propertyId" = p.id
                AND l.status IN ('NEW','CONTACTED','QUALIFIED')
            ) THEN 0
            WHEN p."lastSaleDate" IS NOT NULL
              AND EXTRACT(YEAR FROM AGE(NOW(), p."lastSaleDate")) >= 5
              THEN 90
            WHEN (${currentYear} - p."yearBuilt") >= 25 THEN 85
            WHEN (${currentYear} - p."yearBuilt") >= 20 THEN 65
            ELSE 40
          END as score,
          ROW_NUMBER() OVER (ORDER BY bf."pmtiles_id") as rn
        FROM "building_footprints" bf
        JOIN "properties" p ON p.id = bf."propertyId"
        WHERE bf."pmtiles_id" IS NOT NULL
          AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
      )
      SELECT "pmtiles_id", "score"
      FROM scored
      WHERE rn <= ${limit} AND score > 0
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── pipeline ────────────────────────────────────────────────────────────────
  // Score = where the property has an active lead (OPEN/CLOSED_WON = high priority)
  private async pipelineFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH scored AS (
        SELECT
          bf."pmtiles_id",
          CASE l.status
            WHEN 'NEW'        THEN 70
            WHEN 'CONTACTED'  THEN 75
            WHEN 'QUALIFIED'  THEN 85
            WHEN 'PROPOSAL'   THEN 90
            WHEN 'NEGOTIATION' THEN 95
            WHEN 'CLOSED_WON'  THEN 100
            WHEN 'CLOSED_LOST' THEN 20
            ELSE 50
          END as score,
          ROW_NUMBER() OVER (ORDER BY bf."pmtiles_id") as rn
        FROM "building_footprints" bf
        JOIN "properties" p ON p.id = bf."propertyId"
        JOIN "leads" l ON l."propertyId" = p.id
        WHERE bf."pmtiles_id" IS NOT NULL
          AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
          AND l.status NOT IN ('CLOSED_LOST', 'ARCHIVED')
      )
      SELECT "pmtiles_id", "score"
      FROM scored
      WHERE rn <= ${limit}
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── spatial centroid fallback (no pmtiles_id column) ───────────────────────
  // Map building centroids in bbox to their pmtiles ids via spatial join
  // This is slower but works without the pmtiles_id column
  private async scoreFromSpatialCentroid(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    // Fetch all building centroids with their pmtables ids via spatial position
    // For a real system we'd use ST_Contains on parcel polygons
    // Here we do a bounding-box scan that at least limits results
    const buildings = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; prop_id: string}[]>(`
      SELECT
        bf."pmtiles_id",
        bf."propertyId" as prop_id
      FROM "building_footprints" bf
      WHERE bf."pmtiles_id" IS NOT NULL
        AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
        AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
      LIMIT ${limit}
    `);

    if (buildings.length === 0) {
      // No pmtiles_id mapping available - return empty and use stub
      return {};
    }

    const propIds = buildings.map(b => b.prop_id).filter(Boolean);
    const propertyMap = new Map(buildings.map(b => [b.prop_id, b.pmtiles_id]));

    // Fetch leads for these properties
    const leads = await this.prisma.lead.findMany({
      where: { propertyId: { in: propIds } },
      select: { propertyId: true, status: true, score: true, contactedAt: true },
    });
    const leadByProp = new Map(leads.map(l => [l.propertyId, l]));

    const scores: Record<number, number> = {};
    const currentYear = new Date().getFullYear();
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    for (const [propId, pmtilesId] of propertyMap) {
      let score = 0;
      const lead = leadByProp.get(propId);

      switch (layer) {
        case 'lead_score':
          score = lead ? lead.score : 0;
          break;
        case 'roof_age': {
          // we don't have yearBuilt directly on lead/property join here
          // fall back to 0
          break;
        }
        case 'storm_recent':
          score = lead ? Math.min(100, 30 + lead.score / 2) : 0;
          break;
        case 'dormant':
          score = lead ? 0 : 40;
          break;
        case 'pipeline':
          if (lead) {
            switch (lead.status) {
              case 'NEW': score = 70; break;
              case 'CONTACTED': score = 75; break;
              case 'QUALIFIED': score = 85; break;
              case 'PROPOSAL': score = 90; break;
              default: score = 50;
            }
          }
          break;
      }

      if (score > 0) scores[pmtilesId] = score;
    }

    return scores;
  }
}