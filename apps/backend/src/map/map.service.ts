import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export type MapLayer = 'lead_score' | 'roof_age' | 'storm_recent' | 'dormant' | 'pipeline';

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

@Injectable()
export class MapService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return { [buildingId]: score 0-100 } for features inside bbox.
   * V1 stub: deterministic pseudo-random by id so the map paints
   * something useful while real scoring is wired up.
   * Later: swap each branch for a real query against properties/storms/leads.
   */
  async scoresForBbox(layer: MapLayer, bbox: Bbox, limit = 50000): Promise<Record<number, number>> {
    // Compute building IDs in bbox (stub using deterministic id range until we have
    // a spatial index of buildings in Postgres). For now we return a dense stub:
    // 0..limit with layer-specific distributions.
    const out: Record<number, number> = {};

    // Density by layer: only show a subset to prove the "only paint meaningful signal" goal.
    const share: Record<MapLayer, number> = {
      lead_score: 0.15,
      roof_age: 0.40,
      storm_recent: 0.08,
      dormant: 0.03,
      pipeline: 0.02,
    };
    const p = share[layer] ?? 0.1;

    for (let id = 1; id <= limit; id++) {
      const h = hash(id, layer);
      if (h > p) continue;
      // Scale to 40..100 so painted features are clearly visible
      const score = Math.floor(40 + (h / p) * 60);
      out[id] = score;
    }
    return out;
  }
}

function hash(id: number, layer: string): number {
  // Cheap deterministic hash in [0,1)
  let h = 2166136261;
  const s = String(id) + '|' + layer;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
