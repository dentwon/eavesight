import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../common/prisma.service';

/**
 * AlertsService — the "storm-overhead / property-at-risk" live pipeline.
 *
 * Responsibilities:
 *   1. matchWarningToProperties — given an NWS warning polygon, bulk-insert
 *      PropertyAlert rows for every property geographically inside, then emit
 *      `property.alert.batch` events that the SSE gateway fans out.
 *   2. earmark CRUD — user flags a property for later inspection. Earmarks
 *      are partitioned per-org: a different org's user cannot overwrite or
 *      clear another org's earmark on the same property.
 *   3. active + recent alert queries — power the dashboard banners + map layer.
 *   4. SSE batch filtering — only emit to a connection the properties whose
 *      alerts actually concern that org (lead-matched OR territory-zip match).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

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

  /**
   * For SSE fan-out: take a batch of properties and return only those that
   * concern `orgId` (a lead exists for that property in this org, OR the
   * property's zip is in one of the org's active territories). Properties
   * outside the org's interest are silently dropped — they would otherwise
   * leak addresses, lat/lon, etc. cross-tenant.
   */
  async filterBatchForOrg(
    orgId: string,
    properties: Array<{ id: string; lat: number | null; lon: number | null; address: string | null; city: string | null; zip: string | null }>,
  ): Promise<typeof properties> {
    if (!properties.length) return [];
    const ids = properties.map((p) => p.id).filter(Boolean);
    if (!ids.length) return [];

    const zips = Array.from(new Set(properties.map((p) => p.zip).filter((z): z is string => !!z)));

    // Property IDs that this org has an active lead for.
    const leadMatches = await this.prisma.lead.findMany({
      where: { orgId, propertyId: { in: ids } },
      select: { propertyId: true },
    });
    const leadIds = new Set(leadMatches.map((l) => l.propertyId).filter((id): id is string => !!id));

    // Zip codes covered by an active territory for this org.
    let territoryZips = new Set<string>();
    if (zips.length) {
      const territories = await this.prisma.$queryRawUnsafe<{ zipCodes: string[] }[]>(
        `SELECT "zipCodes" FROM territories WHERE "orgId" = $1 AND "isActive" = true`,
        orgId,
      );
      for (const t of territories) {
        for (const z of t.zipCodes || []) territoryZips.add(z);
      }
    }

    return properties.filter((p) => {
      if (leadIds.has(p.id)) return true;
      if (p.zip && territoryZips.has(p.zip)) return true;
      return false;
    });
  }

  /**
   * Earmark a property for inspection. Per-org isolation: if the property is
   * already earmarked by a user from a *different* org, refuse the mutation.
   * Same-org users may overwrite each other's earmarks (collaborative).
   */
  async setEarmark(
    propertyId: string,
    userId: string,
    orgId: string | null,
    reason: string | null,
  ) {
    if (!orgId) {
      throw new ForbiddenException('Earmark requires an organization context');
    }
    await this.assertEarmarkBelongsToCallerOrg(propertyId, orgId);
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

  async clearEarmark(propertyId: string, userId: string, orgId: string | null) {
    if (!orgId) {
      throw new ForbiddenException('Clear-earmark requires an organization context');
    }
    await this.assertEarmarkBelongsToCallerOrg(propertyId, orgId);
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

  /**
   * If an existing earmark is held by a user from a different org, refuse.
   * If unearmarked or held by a same-org user, allow.
   *
   * NOTE: this is a soft per-org partition layered onto a single global
   * earmark column. Long-term fix is a per-org PropertyEarmark join table
   * (planned in PENDING_MIGRATION_unify_plans_oauth_reveals.diff follow-up).
   */
  private async assertEarmarkBelongsToCallerOrg(propertyId: string, orgId: string): Promise<void> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, isEarmarked: true, earmarkedByUserId: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    if (!property.isEarmarked || !property.earmarkedByUserId) return;

    // Allow the mutation only if the existing earmark holder is also a
    // member of the caller's org. Multi-org users (membership in N orgs)
    // pass when ANY of their memberships matches the caller — this is a
    // deliberate widening: a user in both Org A and Org B can transfer
    // an earmark between them. If no overlap, deny.
    const sharedMembership = await this.prisma.organizationMember.findFirst({
      where: { userId: property.earmarkedByUserId, organizationId: orgId },
      select: { id: true },
    });
    if (!sharedMembership) {
      throw new ForbiddenException('Property is earmarked by another organization');
    }
  }

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
