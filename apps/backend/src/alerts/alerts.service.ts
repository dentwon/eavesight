import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../common/prisma.service';

/**
 * AlertsService — the "storm-overhead / property-at-risk" live pipeline.
 *
 * Responsibilities:
 *   1. matchWarningToProperties — given an NWS warning polygon, bulk-insert
 *      PropertyAlert rows for every property geographically inside, then emit
 *      `property.alert` events that the SSE gateway fans out to connected users.
 *   2. earmark CRUD — user flags a property for later inspection, typically
 *      during an active warning. The earmarked list survives the storm.
 *   3. active + recent alert queries — power the dashboard banners + map layer.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  /**
   * Given a warning polygon (GeoJSON geometry), create PropertyAlert rows for
   * every property whose point falls inside. Returns the count of new alerts.
   *
   * Idempotent via UNIQUE(propertyId, stormEventId, alertType).
   * Emits `property.alert.batch` once with the full batch so the SSE gateway
   * can fan out without querying again.
   */
  async matchWarningToProperties(opts: {
    stormEventId: string | null;
    alertType: 'TORNADO_WARNING' | 'SEVERE_TSTORM' | 'HAIL_CORE' | 'HIGH_WIND' | 'FLOOD';
    alertSource: 'NWS_ALERT' | 'MRMS_HAIL' | 'NEXRAD' | 'SPC_REPORT';
    severity: 'EXTREME' | 'SEVERE' | 'MODERATE';
    startedAt: Date;
    expiresAt: Date | null;
    polygonGeoJson: any;
    metadata?: Record<string, any>;
  }): Promise<{ matched: number; inserted: number }> {
    const polygonStr = JSON.stringify(opts.polygonGeoJson);
    const metaStr = JSON.stringify(opts.metadata || {});

    // First count to log, then insert — both with ST_Within on property points.
    const matches = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT p.id, p.lat, p.lon, p.address, p.city, p.zip
      FROM properties p
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
        AND ST_Within(
          ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326),
          ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
        )
      `,
      polygonStr,
    );

    if (matches.length === 0) return { matched: 0, inserted: 0 };

    // Insert in one batch. ON CONFLICT suppresses duplicates so repeat polls are safe.
    const inserted = await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO property_alerts (id, "propertyId", "stormEventId", "alertType", "alertSource", severity, "startedAt", "expiresAt", active, metadata)
      SELECT gen_random_uuid()::text, p.id, $1, $2, $3, $4, $5, $6, true, $7::jsonb
      FROM properties p
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
        AND ST_Within(
          ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326),
          ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)
        )
      ON CONFLICT ("propertyId", "stormEventId", "alertType") DO NOTHING
      `,
      opts.stormEventId,
      opts.alertType,
      opts.alertSource,
      opts.severity,
      opts.startedAt,
      opts.expiresAt,
      metaStr,
      polygonStr,
    );

    this.logger.warn(
      `PropertyAlert batch: ${inserted} inserted / ${matches.length} matched (type=${opts.alertType}, severity=${opts.severity})`,
    );

    // Fan out to SSE subscribers regardless of dedupe — they may have just connected.
    this.emitter.emit('property.alert.batch', {
      alertType: opts.alertType,
      alertSource: opts.alertSource,
      severity: opts.severity,
      startedAt: opts.startedAt,
      expiresAt: opts.expiresAt,
      stormEventId: opts.stormEventId,
      properties: matches.map((m) => ({
        id: m.id,
        lat: m.lat,
        lon: m.lon,
        address: m.address,
        city: m.city,
        zip: m.zip,
      })),
    });

    return { matched: matches.length, inserted: Number(inserted) };
  }

  /** Flag / unflag a property for inspection. */
  async setEarmark(propertyId: string, userId: string, reason: string | null) {
    return this.prisma.property.update({
      where: { id: propertyId },
      data: {
        isEarmarked: true,
        earmarkedAt: new Date(),
        earmarkReason: reason || 'Storm exposure — inspect post-event',
        earmarkedByUserId: userId,
      },
      select: { id: true, isEarmarked: true, earmarkedAt: true, earmarkReason: true },
    });
  }

  async clearEarmark(propertyId: string) {
    return this.prisma.property.update({
      where: { id: propertyId },
      data: {
        isEarmarked: false,
        earmarkedAt: null,
        earmarkReason: null,
        earmarkedByUserId: null,
      },
      select: { id: true, isEarmarked: true },
    });
  }

  /** User's earmark worklist — all properties they've flagged, most recent first. */
  async listEarmarks(userId: string, limit: number = 100) {
    return this.prisma.property.findMany({
      where: { earmarkedByUserId: userId, isEarmarked: true },
      orderBy: { earmarkedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        address: true,
        city: true,
        zip: true,
        lat: true,
        lon: true,
        earmarkedAt: true,
        earmarkReason: true,
        hailExposureIndex: true,
      },
    });
  }

  /** Active alerts for an org — via its leads' properties. Lightweight poll target. */
  async getActiveAlertsForOrg(orgId: string, limit: number = 500) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT DISTINCT ON (pa.id)
        pa.id, pa."propertyId", pa."alertType", pa."alertSource", pa.severity,
        pa."startedAt", pa."expiresAt", pa.metadata,
        p.address, p.city, p.zip, p.lat, p.lon,
        p."isEarmarked", p."hailExposureIndex", p."yearBuilt", p."yearBuiltConfidence", p."roofSizeClass"
      FROM property_alerts pa
      JOIN properties p ON p.id = pa."propertyId"
      WHERE pa.active = true
        AND (pa."expiresAt" IS NULL OR pa."expiresAt" > NOW())
        AND (
          EXISTS (SELECT 1 FROM leads l WHERE l."propertyId" = p.id AND l."orgId" = $1)
          OR EXISTS (
            SELECT 1 FROM territories t
            WHERE t."orgId" = $1 AND t."isActive" = true AND p.zip = ANY(t."zipCodes")
          )
        )
      ORDER BY pa.id, pa."startedAt" DESC
      LIMIT $2
      `,
      orgId,
      limit,
    );
  }

  /**
   * Housekeeping: mark alerts expired when their NWS expiry is past.
   * Called on a schedule from StormsProcessor, but also safe to call ad-hoc.
   */
  async expireStaleAlerts() {
    const expired = await this.prisma.$executeRawUnsafe(
      `UPDATE property_alerts
       SET active = false, "endedAt" = NOW()
       WHERE active = true AND "expiresAt" IS NOT NULL AND "expiresAt" < NOW()`,
    );
    if (expired > 0) this.logger.log(`Expired ${expired} stale property alerts`);
    return { expired };
  }
}
