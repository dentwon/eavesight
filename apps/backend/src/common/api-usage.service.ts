import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class ApiUsageService {
  private readonly logger = new Logger(ApiUsageService.name);

  constructor(private prisma: PrismaService) {}

  async trackUsage(params: {
    orgId: string;
    service: string;
    endpoint: string;
    credits?: number;
    costCents?: number;
    metadata?: any;
    propertyId?: string;
    leadId?: string;
  }) {
    return this.prisma.apiUsage.create({
      data: {
        orgId: params.orgId,
        service: params.service,
        endpoint: params.endpoint,
        credits: params.credits || 1,
        costCents: params.costCents || 0,
        metadata: params.metadata || undefined,
        propertyId: params.propertyId,
        leadId: params.leadId,
      },
    });
  }

  async checkQuota(
    orgId: string,
    service: string,
  ): Promise<{ allowed: boolean; remaining: number; limit: number }> {
    const now = new Date();
    const quota = await this.prisma.apiQuota.findUnique({
      where: { orgId_service: { orgId, service } },
    });

    if (!quota) {
      // No quota set = unlimited (for admin/testing)
      return { allowed: true, remaining: -1, limit: -1 };
    }

    // Reset if past reset date
    if (now >= quota.resetAt) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await this.prisma.apiQuota.update({
        where: { id: quota.id },
        data: { usedThisMonth: 0, resetAt: nextMonth },
      });
      return {
        allowed: true,
        remaining: quota.monthlyLimit,
        limit: quota.monthlyLimit,
      };
    }

    const remaining = quota.monthlyLimit - quota.usedThisMonth;
    return { allowed: remaining > 0, remaining, limit: quota.monthlyLimit };
  }

  async incrementQuota(
    orgId: string,
    service: string,
    amount: number = 1,
  ) {
    try {
      await this.prisma.apiQuota.update({
        where: { orgId_service: { orgId, service } },
        data: { usedThisMonth: { increment: amount } },
      });
    } catch {
      // No quota record = no tracking needed
    }
  }

  async getUsageSummary(
    orgId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const where: any = { orgId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const usage = await this.prisma.apiUsage.groupBy({
      by: ["service"],
      where,
      _count: true,
      _sum: { costCents: true, credits: true },
    });

    return usage.map((u) => ({
      service: u.service,
      totalCalls: u._count,
      totalCredits: u._sum.credits || 0,
      totalCostCents: u._sum.costCents || 0,
      totalCostDollars: ((u._sum.costCents || 0) / 100).toFixed(2),
    }));
  }

  async getGlobalUsageSummary(startDate?: Date, endDate?: Date) {
    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const usage = await this.prisma.apiUsage.groupBy({
      by: ["service"],
      where,
      _count: true,
      _sum: { costCents: true, credits: true },
    });

    return usage.map((u) => ({
      service: u.service,
      totalCalls: u._count,
      totalCredits: u._sum.credits || 0,
      totalCostCents: u._sum.costCents || 0,
      totalCostDollars: ((u._sum.costCents || 0) / 100).toFixed(2),
    }));
  }
}
