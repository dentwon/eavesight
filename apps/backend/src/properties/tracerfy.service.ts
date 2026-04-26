import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import axios from 'axios';

export interface TracerResult {
  ownerName: string;
  phones: Array<{ number: string; type: string; lineType: string }>;
  emails: string[];
  mailingAddress: string;
}

@Injectable()
export class TracerfyService {
  private readonly logger = new Logger(TracerfyService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.tracerfy.com/v1';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiKey = this.configService.get<string>('TRACERFY_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('TRACERFY_API_KEY not set');
    }
  }

  /**
   * Skip trace a property to get owner contact info.
   * PAID API CALL ($0.04/record for advanced trace).
   * Must be explicitly requested by user and quota-checked.
   */
  async skipTraceProperty(
    propertyId: string,
    orgId: string,
    requestedBy: string,
  ): Promise<TracerResult | null> {
    if (!this.apiKey) {
      throw new Error('Tracerfy API not configured');
    }

    // Check org quota
    const quota = await this.checkOrgQuota(orgId);
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Skip trace quota exceeded. Used ${quota.used}/${quota.limit} this month. Upgrade your plan for more.`,
      );
    }

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { enrichments: true },
    });

    if (!property) throw new Error('Property not found');

    // Return cached data if we already have it
    if (property.ownerPhone && property.ownerFullName) {
      return {
        ownerName: property.ownerFullName,
        phones: [{ number: property.ownerPhone, type: 'cached', lineType: 'unknown' }],
        emails: property.ownerEmail ? [property.ownerEmail] : [],
        mailingAddress: property.ownerMailAddress || '',
      };
    }

    const address = `${property.address}, ${property.city}, ${property.state} ${property.zip}`;

    // Pick the cheaper Tracerfy tier when we already know the owner name.
    // Normal Trace = $0.02/record (requires owner name + address).
    // Advanced Trace = $0.04/record (address-only fallback).
    // We have ownerFullName for ~97% of properties via county assessor scrapes,
    // so the default path is the $0.02 tier. Halves dominant per-reveal cost.
    const useNormalTrace = !!property.ownerFullName;
    const traceType = useNormalTrace ? 'normal' : 'advanced';
    const costCents = useNormalTrace ? 2 : 4;

    const tracePayload: Record<string, any> = useNormalTrace
      ? { addresses: [address], names: [property.ownerFullName], trace_type: 'normal' }
      : { addresses: [address], trace_type: 'advanced' };

    try {
      const response = await axios.post(
        `${this.baseUrl}/trace/`,
        tracePayload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      // Track usage at the actual price billed by Tracerfy ($0.02 Normal / $0.04 Advanced).
      await this.trackUsage(orgId, propertyId, requestedBy, costCents);

      const result = response.data as any;
      if (result.queue_id) {
        const traceResult = await this.pollForResults(result.queue_id);
        if (traceResult) {
          await this.cacheContactData(propertyId, traceResult);
          return traceResult;
        }
      }

      return null;
    } catch (error: any) {
      this.logger.error(`Tracerfy error: ${error?.response?.status} ${JSON.stringify(error?.response?.data)}`);
      throw error;
    }
  }

  private async pollForResults(queueId: string, maxAttempts = 10): Promise<TracerResult | null> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const response = await axios.get(`${this.baseUrl}/queue/${queueId}/`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          timeout: 10000,
        });
        const data = response.data as any;
        if (data.status === 'completed' && data.results?.length > 0) {
          const r = data.results[0];
          return {
            ownerName: r.owner_name || `${r.first_name || ''} ${r.last_name || ''}`.trim(),
            phones: (r.phones || []).map((p: any) => ({
              number: p.phone_number || p.number,
              type: p.phone_type || 'unknown',
              lineType: p.line_type || 'unknown',
            })),
            emails: r.emails || [],
            mailingAddress: r.mailing_address || '',
          };
        }
        if (data.status === 'failed') return null;
      } catch {
        // Continue polling
      }
    }
    return null;
  }

  private async cacheContactData(propertyId: string, result: TracerResult) {
    const primaryPhone = result.phones?.[0]?.number || null;
    const primaryEmail = result.emails?.[0] || null;

    // Store on the Property itself
    await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        ownerFullName: result.ownerName || undefined,
        ownerPhone: primaryPhone || undefined,
        ownerEmail: primaryEmail || undefined,
        ownerMailAddress: result.mailingAddress || undefined,
        phoneVerified: true,
      },
    });

    // Also store full trace data in enrichment
    await this.prisma.propertyEnrichment.upsert({
      where: { propertyId },
      create: {
        propertyId,
        ownerName: result.ownerName,
        ownerPhone: primaryPhone,
        ownerEmail: primaryEmail,
        ownerMailingAddress: result.mailingAddress,
        skipTraceData: {
          phones: result.phones,
          emails: result.emails,
          tracedAt: new Date().toISOString(),
        },
      },
      update: {
        ownerName: result.ownerName,
        ownerPhone: primaryPhone,
        ownerEmail: primaryEmail,
        ownerMailingAddress: result.mailingAddress,
        skipTraceData: {
          phones: result.phones,
          emails: result.emails,
          tracedAt: new Date().toISOString(),
        },
      },
    });
  }

  private async checkOrgQuota(orgId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
    const quota = await this.prisma.apiQuota.findUnique({
      where: { orgId_service: { orgId, service: 'tracerfy' } },
    });
    if (!quota) {
      // Create default quota (10 free traces for starter plan)
      await this.prisma.apiQuota.create({
        data: {
          orgId,
          service: 'tracerfy',
          monthlyLimit: 10,
          usedThisMonth: 0,
          resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        },
      });
      return { allowed: true, used: 0, limit: 10 };
    }

    // Reset if past reset date
    if (new Date() >= quota.resetAt) {
      await this.prisma.apiQuota.update({
        where: { id: quota.id },
        data: {
          usedThisMonth: 0,
          resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        },
      });
      return { allowed: true, used: 0, limit: quota.monthlyLimit };
    }

    return {
      allowed: quota.usedThisMonth < quota.monthlyLimit,
      used: quota.usedThisMonth,
      limit: quota.monthlyLimit,
    };
  }

  private async trackUsage(orgId: string, propertyId: string, requestedBy: string, costCents: number) {
    await this.prisma.apiUsage.create({
      data: {
        orgId,
        service: 'tracerfy',
        endpoint: 'advanced_trace',
        credits: 2,
        costCents,
        propertyId,
        metadata: { requestedBy, tracedAt: new Date().toISOString() },
      },
    });

    // Increment quota
    await this.prisma.apiQuota.updateMany({
      where: { orgId, service: 'tracerfy' },
      data: { usedThisMonth: { increment: 1 } },
    });
  }

  async checkDnc(phoneNumber: string, orgId: string): Promise<{ isDnc: boolean }> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/dnc/scrub/`,
        { phone_numbers: [phoneNumber] },
        {
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );
      const data = response.data as any;
      await this.prisma.apiUsage.create({
        data: { orgId, service: 'tracerfy', endpoint: 'dnc_scrub', credits: 1, costCents: 2 },
      });
      return { isDnc: data?.results?.[0]?.is_dnc || false };
    } catch {
      return { isDnc: false };
    }
  }
}
