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
  async getPropertyByPmtilesId(pmtilesId: string): Promise<any | null> {
    const numericId = parseInt(pmtilesId);

    const rows = await this.prisma.$queryRawUnsafe<{propertyId: string}[]>(
      `SELECT "propertyId" FROM "building_footprints" WHERE "pmtiles_id" = $1 LIMIT 1`,
      numericId
    );

    if (!rows.length || !rows[0].propertyId) return null;

    return this.prisma.property.findUnique({
      where: { id: rows[0].propertyId },
      include: {
        propertyStorms: { include: { stormEvent: true } },
        leads: true,
        roofData: true,
        buildingFootprint: true,
      },
    });
  }

  /**
   * Get scores for buildings inside a bounding box, keyed by PMTiles numeric id.
   */
  async scoresForBbox(layer: MapLayer, bbox: Bbox, limit = 50000): Promise<Record<number, number>> {
    const hasPmtilesIds = await this.prisma.$queryRaw<{exists: boolean}[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'building_footprints' AND column_name = 'pmtiles_id'
      ) as exists
    `;

    if (hasPmtilesIds[0]?.exists) {
      return this.scoreFromPmtilesIds(layer, bbox, limit);
    }
    return this.scoreFromSpatialCentroid(layer, bbox, limit);
  }

  // ── lead_score ──────────────────────────────────────────────────────────────
  private async leadScoreFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    // Primary: use actual lead scores where available
    const withScores = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      SELECT bf."pmtiles_id", l."score" as score
      FROM "building_footprints" bf
      JOIN "properties" p ON p.id = bf."propertyId"
      JOIN "leads" l ON l."propertyId" = p.id
      WHERE bf."pmtiles_id" IS NOT NULL
        AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
        AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
        AND l."score" IS NOT NULL
      ORDER BY bf."pmtiles_id"
      LIMIT ${limit}
    `);

    if (withScores.length >= 10) {
      return withScores.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
    }

    // Fallback: compute composite score from property/storm data for all buildings
    const eighteenMonthsAgo = new Date();
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
    const since = eighteenMonthsAgo.toISOString();
    const currentYear = new Date().getFullYear();

    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH buildings AS (
        SELECT bf."pmtiles_id", bf."propertyId",
               p."yearBuilt", p."assessedValue",
               EXISTS(SELECT 1 FROM "leads" l WHERE l."propertyId" = p.id) as has_lead,
               (SELECT COUNT(*) FROM "property_storms" ps
                JOIN "storm_events" se ON se.id = ps."stormEventId"
                WHERE ps."propertyId" = p.id AND se.date >= '${since}'::timestamptz) as storm_count
        FROM "building_footprints" bf
        JOIN "properties" p ON p.id = bf."propertyId"
        WHERE bf."pmtiles_id" IS NOT NULL
          AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
      ),
      scored AS (
        SELECT "pmtiles_id",
               LEAST(GREATEST((
                 CASE WHEN "yearBuilt" IS NOT NULL THEN LEAST((${currentYear} - "yearBuilt") * 2.5, 100) ELSE 0 END +
                 LEAST("storm_count" * 15, 60) +
                 CASE WHEN has_lead THEN 10 ELSE 30 END
               ), 0), 100)::int AS score
        FROM buildings
      )
      SELECT "pmtiles_id", score
      FROM scored
      WHERE score > 0
      ORDER BY "pmtiles_id"
      LIMIT ${limit}
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── storm_recent ────────────────────────────────────────────────────────────
  private async stormRecentFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const eighteenMonthsAgo = new Date();
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);

    const since = eighteenMonthsAgo.toISOString();
    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH buildings_in_bbox AS (
        SELECT "pmtiles_id", "propertyId"
        FROM "building_footprints"
        WHERE "pmtiles_id" IS NOT NULL
          AND "centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND "centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
          AND "propertyId" IS NOT NULL
      ),
      storms_recent AS (
        SELECT "propertyId", COUNT(*) * 20 AS raw_score
        FROM "property_storms" ps
        JOIN "storm_events" se ON se.id = ps."stormEventId"
        WHERE se.date >= '${since}'::timestamptz
        GROUP BY "propertyId"
      ),
      scored_buildings AS (
        SELECT "propertyId", LEAST(raw_score, 100) AS score
        FROM storms_recent
      )
      SELECT b."pmtiles_id", s.score::int
      FROM buildings_in_bbox b
      JOIN scored_buildings s ON s."propertyId" = b."propertyId"
      ORDER BY b."pmtiles_id"
      LIMIT ${limit}
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── roof_age ───────────────────────────────────────────────────────────────
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
  private async pipelineFromDb(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const rows = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; score: number}[]>(`
      WITH scored AS (
        SELECT
          bf."pmtiles_id",
          CASE l.status
            WHEN 'NEW'        THEN 70
            WHEN 'CONTACTED'  THEN 75
            WHEN 'QUALIFIED'  THEN 85
            WHEN 'QUOTED'     THEN 90
            WHEN 'NEGOTIATING' THEN 95
            WHEN 'WON'        THEN 100
            WHEN 'LOST'       THEN 20
            ELSE 50
          END as score,
          ROW_NUMBER() OVER (ORDER BY bf."pmtiles_id") as rn
        FROM "building_footprints" bf
        JOIN "properties" p ON p.id = bf."propertyId"
        JOIN "leads" l ON l."propertyId" = p.id
        WHERE bf."pmtiles_id" IS NOT NULL
          AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
          AND l.status NOT IN ('LOST')
      )
      SELECT "pmtiles_id", "score"
      FROM scored
      WHERE rn <= ${limit}
    `);

    return rows.reduce((acc, r) => { acc[r.pmtiles_id] = r.score; return acc; }, {} as Record<number, number>);
  }

  // ── pmtiles_id dispatch ─────────────────────────────────────────────────────
  private async scoreFromPmtilesIds(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    switch (layer) {
      case 'lead_score':   return this.leadScoreFromDb(layer, bbox, limit);
      case 'storm_recent': return this.stormRecentFromDb(layer, bbox, limit);
      case 'roof_age':     return this.roofAgeFromDb(layer, bbox, limit);
      case 'dormant':      return this.dormantFromDb(layer, bbox, limit);
      case 'pipeline':     return this.pipelineFromDb(layer, bbox, limit);
      default:              return {};
    }
  }

  // ── spatial centroid fallback ───────────────────────────────────────────────
  private async scoreFromSpatialCentroid(layer: MapLayer, bbox: Bbox, limit: number): Promise<Record<number, number>> {
    const buildings = await this.prisma.$queryRawUnsafe<{pmtiles_id: number; prop_id: string}[]>(`
      SELECT bf."pmtiles_id", bf."propertyId" as prop_id
      FROM "building_footprints" bf
      WHERE bf."pmtiles_id" IS NOT NULL
        AND bf."centroidLat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
        AND bf."centroidLon" BETWEEN ${bbox.minLon} AND ${bbox.maxLon}
      LIMIT ${limit}
    `);

    if (buildings.length === 0) return {};

    const propIds = buildings.map(b => b.prop_id).filter(Boolean);
    const propertyMap = new Map(buildings.map(b => [b.prop_id, b.pmtiles_id]));

    const leads = await this.prisma.lead.findMany({
      where: { propertyId: { in: propIds } },
      select: { propertyId: true, status: true, score: true },
    });
    const leadByProp = new Map(leads.map(l => [l.propertyId, l]));

    const scores: Record<number, number> = {};
    const currentYear = new Date().getFullYear();

    for (const [propId, pmtilesId] of propertyMap) {
      let score = 0;
      const lead = leadByProp.get(propId);

      switch (layer) {
        case 'lead_score':
          score = lead ? lead.score : 0;
          break;
        case 'roof_age':
          score = 0;
          break;
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
              case 'QUOTED': score = 90; break;
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