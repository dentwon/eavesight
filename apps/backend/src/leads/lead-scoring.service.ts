import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class LeadScoringService {
  private readonly logger = new Logger(LeadScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scoreLead(leadId: string): Promise<number> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        property: {
          include: {
            propertyStorms: {
              include: { stormEvent: true },
              orderBy: { stormEvent: { date: 'desc' } },
              take: 5,
            },
            enrichments: true,
            roofData: true,
          },
        },
      },
    });

    if (!lead) return 0;

    let score = 0;
    score += this.scoreRoofAge(lead.property);
    score += this.scoreStormSeverity(lead.property?.propertyStorms || []);
    score += this.scorePropertyValue(lead.property);
    score += this.scoreProximity(lead.property?.propertyStorms || []);
    score += this.scoreHomeownership(lead.property?.enrichments);
    score += this.scoreRecency(lead.property?.propertyStorms || []);
    score += await this.scoreStormFrequency(lead.property);

    score = Math.max(0, Math.min(100, Math.round(score)));

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { score },
    });

    return score;
  }

  async scoreAllLeads(orgId: string): Promise<{ scored: number; avgScore: number }> {
    const leads = await this.prisma.lead.findMany({
      where: { orgId, status: { not: 'LOST' } },
      select: { id: true },
    });

    let totalScore = 0;
    let scored = 0;

    for (const lead of leads) {
      try {
        const score = await this.scoreLead(lead.id);
        totalScore += score;
        scored++;
      } catch (error) {
        this.logger.warn(`Failed to score lead ${lead.id}: ${error}`);
      }
    }

    const avgScore = scored > 0 ? Math.round(totalScore / scored) : 0;
    this.logger.log(`Scored ${scored} leads for org ${orgId}, avg score: ${avgScore}`);

    return { scored, avgScore };
  }

  // Max 25 pts (was 30) - roof age is still the strongest signal
  private scoreRoofAge(property: any): number {
    if (!property) return 5;

    let roofAge: number | null = null;

    if (property.roofData?.age) {
      roofAge = property.roofData.age;
    } else if (property.yearBuilt) {
      roofAge = new Date().getFullYear() - property.yearBuilt;
    }

    if (!roofAge) return 8;

    if (roofAge >= 25) return 25;
    if (roofAge >= 20) return 21;
    if (roofAge >= 15) return 17;
    if (roofAge >= 10) return 10;
    if (roofAge >= 5) return 5;
    return 2;
  }

  // Max 20 pts - best severity from recent storms
  private scoreStormSeverity(propertyStorms: any[]): number {
    if (!propertyStorms?.length) return 0;

    const severities = propertyStorms.map(ps => ps.stormEvent?.severity).filter(Boolean);
    if (severities.length === 0) return 0;

    const severityScores: Record<string, number> = {
      EXTREME: 20,
      SEVERE: 16,
      MODERATE: 10,
      LIGHT: 4,
    };

    return Math.max(...severities.map((s: string) => severityScores[s] || 0));
  }

  // Max 20 pts - higher value properties = bigger jobs
  private scorePropertyValue(property: any): number {
    if (!property) return 10;

    const homeValue = property.assessedValue || property.marketValue || property.enrichments?.medianHomeValue;
    if (!homeValue) return 10;

    if (homeValue >= 400000) return 20;
    if (homeValue >= 300000) return 17;
    if (homeValue >= 200000) return 14;
    if (homeValue >= 150000) return 11;
    if (homeValue >= 100000) return 8;
    return 5;
  }

  // Max 10 pts (was 15) - how close to storm epicenter
  private scoreProximity(propertyStorms: any[]): number {
    if (!propertyStorms?.length) return 0;

    const distances = propertyStorms
      .map(ps => ps.distanceMeters)
      .filter((d: any) => d !== null && d !== undefined);

    if (distances.length === 0) return 5;

    const minDistance = Math.min(...distances);
    const distKm = minDistance / 1000;

    if (distKm < 1) return 10;
    if (distKm < 5) return 8;
    if (distKm < 15) return 6;
    if (distKm < 30) return 4;
    return 2;
  }

  // Max 10 pts - owner-occupied properties are better leads
  private scoreHomeownership(enrichments: any): number {
    if (!enrichments?.homeownershipRate) return 5;

    const rate = enrichments.homeownershipRate;
    if (rate >= 0.8) return 10;
    if (rate >= 0.65) return 8;
    if (rate >= 0.5) return 6;
    if (rate >= 0.35) return 4;
    return 2;
  }

  // Max 5 pts - recent storms are hotter leads
  private scoreRecency(propertyStorms: any[]): number {
    if (!propertyStorms?.length) return 0;

    const dates = propertyStorms
      .map(ps => ps.stormEvent?.date)
      .filter(Boolean)
      .map((d: string) => new Date(d));

    if (dates.length === 0) return 0;

    const mostRecent = new Date(Math.max(...dates.map(d => d.getTime())));
    const daysSince = Math.floor((Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSince <= 7) return 5;
    if (daysSince <= 30) return 4;
    if (daysSince <= 90) return 3;
    if (daysSince <= 180) return 2;
    return 1;
  }

  // Max 10 pts (NEW) - historical storm frequency within 10km
  // Uses full 76-year NOAA dataset to identify hail corridors
  // Properties in high-frequency zones have taken more cumulative damage
  private async scoreStormFrequency(property: any): Promise<number> {
    if (!property?.lat || !property?.lon) return 3;

    try {
      const result: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT COUNT(*) as storm_count
        FROM storm_events
        WHERE type IN ('HAIL', 'TORNADO')
          AND lat IS NOT NULL
          AND lon IS NOT NULL
          AND (
            6371 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians($1)) * cos(radians(lat)) * cos(radians(lon) - radians($2))
                + sin(radians($1)) * sin(radians(lat))
              ))
            )
          ) <= 10
      `, property.lat, property.lon);

      const count = Number(result[0]?.storm_count || 0);

      // Scoring based on historical storm density within 10km
      // Calibrated against Alabama data: downtown Huntsville ~320 events, rural ~120
      if (count >= 300) return 10;
      if (count >= 200) return 8;
      if (count >= 150) return 7;
      if (count >= 100) return 5;
      if (count >= 50) return 3;
      return 1;
    } catch (error) {
      this.logger.warn(`Storm frequency query failed for property ${property.id}: ${error}`);
      return 3;
    }
  }
}
