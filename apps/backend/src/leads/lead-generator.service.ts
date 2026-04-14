import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { LeadScoringService } from './lead-scoring.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class LeadGeneratorService {
  private readonly logger = new Logger(LeadGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: LeadScoringService,
  ) {}

  async generateFromStorm(stormEventId: string, radiusKm: number = 30): Promise<{
    leadsCreated: number;
    propertiesMatched: number;
  }> {
    const storm = await this.prisma.stormEvent.findUnique({
      where: { id: stormEventId },
    });

    if (!storm) {
      this.logger.warn(`Storm ${stormEventId} not found`);
      return { leadsCreated: 0, propertiesMatched: 0 };
    }

    if (!storm.lat || !storm.lon) {
      this.logger.warn(`Storm ${stormEventId} has no coordinates`);
      return { leadsCreated: 0, propertiesMatched: 0 };
    }

    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / 85;

    const properties = await this.prisma.property.findMany({
      where: {
        lat: {
          gte: storm.lat - latDelta,
          lte: storm.lat + latDelta,
        },
        lon: {
          gte: storm.lon - lonDelta,
          lte: storm.lon + lonDelta,
        },
      },
    });

    this.logger.log(`Found ${properties.length} properties within ${radiusKm}km of storm ${stormEventId}`);

    if (properties.length === 0) {
      return { leadsCreated: 0, propertiesMatched: 0 };
    }

    for (const property of properties) {
      if (!property.lat || !property.lon) continue;

      const distance = this.haversineDistance(
        storm.lat, storm.lon,
        property.lat, property.lon,
      );

      if (distance > radiusKm * 1000) continue;

      try {
        await this.prisma.propertyStorm.upsert({
          where: {
            propertyId_stormEventId: {
              propertyId: property.id,
              stormEventId: storm.id,
            },
          },
          update: {
            distanceMeters: distance,
            affected: distance < 15000,
          },
          create: {
            propertyId: property.id,
            stormEventId: storm.id,
            distanceMeters: distance,
            affected: distance < 15000,
          },
        });
      } catch (error) {
        // Ignore duplicate constraint errors
      }
    }

    const orgs = await this.prisma.organization.findMany({
      select: { id: true },
    });

    let leadsCreated = 0;

    for (const org of orgs) {
      for (const property of properties) {
        if (!property.lat || !property.lon) continue;

        const distance = this.haversineDistance(
          storm.lat, storm.lon,
          property.lat, property.lon,
        );

        if (distance > radiusKm * 1000) continue;

        const existingLead = await this.prisma.lead.findFirst({
          where: {
            orgId: org.id,
            propertyId: property.id,
            createdAt: {
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            },
          },
        });

        if (existingLead) continue;

        try {
          const lead = await this.prisma.lead.create({
            data: {
              orgId: org.id,
              propertyId: property.id,
              firstName: property.ownerFirstName,
              lastName: property.ownerLastName,
              phone: property.ownerPhone,
              email: property.ownerEmail,
              status: 'NEW',
              source: 'Storm Alert',
              priority: this.getPriorityFromSeverity(storm.severity) as any,
              notes: `Auto-generated from ${storm.type} storm on ${storm.date.toISOString().split('T')[0]}. ${storm.description || ''}`.trim(),
            },
          });

          await this.scoringService.scoreLead(lead.id);
          leadsCreated++;
        } catch (error) {
          this.logger.warn(`Failed to create lead for property ${property.id}: ${error}`);
        }
      }
    }

    this.logger.log(`Generated ${leadsCreated} leads from storm ${stormEventId}`);
    return { leadsCreated, propertiesMatched: properties.length };
  }

  async generateFromRecentStorms(days: number = 7): Promise<{
    stormsProcessed: number;
    totalLeadsCreated: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentStorms = await this.prisma.stormEvent.findMany({
      where: {
        date: { gte: cutoff },
        lat: { not: null },
        lon: { not: null },
      },
      orderBy: { date: 'desc' },
    });

    this.logger.log(`Processing ${recentStorms.length} recent storms for lead generation`);

    let totalLeadsCreated = 0;
    let stormsProcessed = 0;

    for (const storm of recentStorms) {
      const result = await this.generateFromStorm(storm.id);
      totalLeadsCreated += result.leadsCreated;
      stormsProcessed++;
    }

    this.logger.log(`Lead generation complete: ${totalLeadsCreated} leads from ${stormsProcessed} storms`);
    return { stormsProcessed, totalLeadsCreated };
  }

  @OnEvent('storm.synced')
  async handleStormSynced(payload: { stormId: string }) {
    this.logger.log(`New storm synced: ${payload.stormId}, generating leads...`);
    await this.generateFromStorm(payload.stormId);
  }

  private getPriorityFromSeverity(severity: string | null): string {
    switch (severity) {
      case 'EXTREME': return 'URGENT';
      case 'SEVERE': return 'HIGH';
      case 'MODERATE': return 'MEDIUM';
      default: return 'LOW';
    }
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
