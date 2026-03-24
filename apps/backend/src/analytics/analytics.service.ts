import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Lead, PropertyStorm, Prisma } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(orgId: string) {
    const [
      totalLeads,
      newLeads,
      wonLeads,
      totalProperties,
      recentStorms,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { orgId } }),
      this.prisma.lead.count({ where: { orgId, status: 'NEW' } }),
      this.prisma.lead.count({ where: { orgId, status: 'WON' } }),
      this.prisma.property.count(),
      this.prisma.stormEvent.count({
        where: {
          date: {
            gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
          },
        },
      }),
    ]);

    const conversionRate = totalLeads > 0 
      ? Math.round((wonLeads / totalLeads) * 100) 
      : 0;

    return {
      leads: {
        total: totalLeads,
        new: newLeads,
        won: wonLeads,
        conversionRate,
      },
      properties: {
        total: totalProperties,
      },
      storms: {
        last30Days: recentStorms,
      },
    };
  }

  async getLeadsByMonth(orgId: string, months: number = 6) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const leads = await this.prisma.lead.findMany({
      where: {
        orgId,
        createdAt: { gte: startDate },
      },
      select: {
        createdAt: true,
        status: true,
      },
    });

    // Group by month
    const byMonth: Record<string, { total: number; won: number }> = {};
    
    for (let i = 0; i < months; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = { total: 0, won: 0 };
    }

    leads.forEach((lead: { createdAt: Date; status: string }) => {
      const key = `${lead.createdAt.getFullYear()}-${String(lead.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (byMonth[key]) {
        byMonth[key].total++;
        if (lead.status === 'WON') byMonth[key].won++;
      }
    });

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        ...data,
      }));
  }

  async getStormImpact(orgId: string) {
    // Get storms that affected leads in this org
    const leadsWithStorms = await this.prisma.lead.findMany({
      where: {
        orgId,
        property: {
          isNot: null,
        },
      },
      include: {
        property: {
          include: {
            propertyStorms: {
              include: {
                stormEvent: true,
              },
            },
          },
        },
      },
    });

    const stormCounts: Record<string, number> = {};

    type LeadWithStorm = {
      property: {
        propertyStorms: {
          stormEvent: { type: string; date: Date };
        }[];
      } | null;
    };

    (leadsWithStorms as LeadWithStorm[]).forEach((lead) => {
      lead.property?.propertyStorms?.forEach((ps) => {
        const key = `${ps.stormEvent.type}-${ps.stormEvent.date.getFullYear()}`;
        stormCounts[key] = (stormCounts[key] || 0) + 1;
      });
    });

    return stormCounts;
  }
}
