import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // =================================================================
  // Existing dashboard overview
  // =================================================================
  async getOverview(orgId: string) {
    const [totalLeads, newLeads, wonLeads, totalProperties, recentStorms] = await Promise.all([
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

    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

    return {
      leads: { total: totalLeads, new: newLeads, won: wonLeads, conversionRate },
      properties: { total: totalProperties },
      storms: { last30Days: recentStorms },
    };
  }

  async getLeadsByMonth(orgId: string, months: number = 6) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const leads = await this.prisma.lead.findMany({
      where: { orgId, createdAt: { gte: startDate } },
      select: { createdAt: true, status: true },
    });

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
      .map(([month, data]) => ({ month, ...data }));
  }

  async getStormImpact(orgId: string) {
    const leadsWithStorms = await this.prisma.lead.findMany({
      where: { orgId, property: { isNot: null } },
      include: {
        property: {
          include: { propertyStorms: { include: { stormEvent: true } } },
        },
      },
    });

    const stormCounts: Record<string, number> = {};
    type LeadWithStorm = {
      property: {
        propertyStorms: { stormEvent: { type: string; date: Date } }[];
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

  // =================================================================
  // NEW: Team Operations — Day 1 market-leader dashboard
  // =================================================================

  /**
   * Rep leaderboard — the "who's producing" table.
   * One row per user in the org with funnel metrics over the last N days.
   * Close rate / avg ticket / revenue are the KPIs managers actually care about.
   */
  async getRepLeaderboard(orgId: string, days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        u.id                                                             AS "userId",
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u."firstName",''), ' ', COALESCE(u."lastName",''))), ''), u.email) AS name,
        u.email,
        u.avatar,
        u.role::text                                                     AS role,
        COUNT(l.*) FILTER (WHERE l."createdAt" >= $2)                    AS "leadsAssigned",
        COUNT(l.*) FILTER (WHERE l."contactedAt" >= $2)                  AS "leadsContacted",
        COUNT(l.*) FILTER (WHERE l."quotedAt" >= $2)                     AS "leadsQuoted",
        COUNT(l.*) FILTER (WHERE l."convertedAt" >= $2)                  AS "leadsWon",
        COUNT(l.*) FILTER (WHERE l."lostAt" >= $2)                       AS "leadsLost",
        COALESCE(SUM(l."contractAmount") FILTER (WHERE l."convertedAt" >= $2), 0) AS revenue,
        COALESCE(AVG(l."contractAmount") FILTER (WHERE l."convertedAt" >= $2), 0) AS "avgTicket",
        COALESCE(AVG(EXTRACT(EPOCH FROM (l."contactedAt" - l."createdAt"))/3600)
          FILTER (WHERE l."contactedAt" IS NOT NULL AND l."createdAt" >= $2), 0) AS "avgHoursToContact",
        (SELECT COALESCE(SUM("doorsKnocked"),0) FROM canvass_sessions cs
          WHERE cs."userId" = u.id AND cs."startedAt" >= $2)             AS "doorsKnocked"
      FROM users u
      JOIN organization_members om ON om."userId" = u.id AND om."orgId" = $1
      LEFT JOIN leads l ON l."assigneeId" = u.id AND l."orgId" = $1
      GROUP BY u.id
      ORDER BY revenue DESC, "leadsWon" DESC
      `,
      orgId,
      since,
    );

    return rows.map((r) => {
      const leadsContacted = Number(r.leadsContacted) || 0;
      const leadsWon = Number(r.leadsWon) || 0;
      const leadsAssigned = Number(r.leadsAssigned) || 0;
      return {
        userId: r.userId,
        name: r.name,
        email: r.email,
        avatar: r.avatar,
        role: r.role,
        leadsAssigned,
        leadsContacted,
        leadsQuoted: Number(r.leadsQuoted) || 0,
        leadsWon,
        leadsLost: Number(r.leadsLost) || 0,
        revenue: Number(r.revenue) || 0,
        avgTicket: Number(r.avgTicket) || 0,
        avgHoursToContact: Number(r.avgHoursToContact) || 0,
        doorsKnocked: Number(r.doorsKnocked) || 0,
        closeRate: leadsContacted > 0 ? leadsWon / leadsContacted : 0,
        contactRate: leadsAssigned > 0 ? leadsContacted / leadsAssigned : 0,
      };
    });
  }

  /**
   * Pipeline velocity — per-stage timing and conversion rates.
   * Answers "where do deals die" in one view. Stages are derived from the
   * LeadStatus enum; timestamps give us dwell time.
   */
  async getPipelineVelocity(orgId: string, days: number = 90) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT', 'INSPECTED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST'] as const;

    // Per-stage count + avg dwell time
    const stageStats: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        status::text AS stage,
        COUNT(*)::int AS count,
        AVG(EXTRACT(EPOCH FROM (NOW() - "updatedAt"))/86400)::float AS "avgDaysInStage"
      FROM leads
      WHERE "orgId" = $1 AND "createdAt" >= $2
      GROUP BY status
      `,
      orgId,
      since,
    );

    // Stage-to-stage conversion
    const totals = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        COUNT(*) FILTER (WHERE "contactedAt" IS NOT NULL)::int AS contacted,
        COUNT(*) FILTER (WHERE "quotedAt" IS NOT NULL)::int AS quoted,
        COUNT(*) FILTER (WHERE "convertedAt" IS NOT NULL)::int AS won,
        COUNT(*)::int AS total
      FROM leads
      WHERE "orgId" = $1 AND "createdAt" >= $2
      `,
      orgId,
      since,
    );

    const t = totals[0] || { total: 0, contacted: 0, quoted: 0, won: 0 };
    const statsByStage = new Map(stageStats.map((s) => [s.stage, s]));

    return {
      stages: STAGES.map((stage) => {
        const s = statsByStage.get(stage) || { count: 0, avgDaysInStage: 0 };
        return {
          stage,
          count: Number(s.count) || 0,
          avgDaysInStage: Number(s.avgDaysInStage) || 0,
        };
      }),
      funnel: {
        total: Number(t.total) || 0,
        contacted: Number(t.contacted) || 0,
        quoted: Number(t.quoted) || 0,
        won: Number(t.won) || 0,
        contactRate: t.total > 0 ? Number(t.contacted) / Number(t.total) : 0,
        quoteRate: t.contacted > 0 ? Number(t.quoted) / Number(t.contacted) : 0,
        closeRate: t.quoted > 0 ? Number(t.won) / Number(t.quoted) : 0,
        overallCloseRate: t.total > 0 ? Number(t.won) / Number(t.total) : 0,
      },
    };
  }

  /**
   * Lead decay — uncontacted/stuck leads.
   * Speed-to-contact drops conversion ~70% after 24h, so this is a daily
   * action list. Plus per-stage "stuck" alerts for deals sitting >14 days.
   */
  async getLeadDecay(orgId: string) {
    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 3600 * 1000);
    const h48 = new Date(now.getTime() - 48 * 3600 * 1000);
    const d14 = new Date(now.getTime() - 14 * 86400 * 1000);

    const [uncontacted24, uncontacted48, stuck, activeByStage] = await Promise.all([
      this.prisma.lead.count({
        where: { orgId, status: 'NEW', contactedAt: null, createdAt: { lte: h24 } },
      }),
      this.prisma.lead.count({
        where: { orgId, status: 'NEW', contactedAt: null, createdAt: { lte: h48 } },
      }),
      this.prisma.lead.count({
        where: {
          orgId,
          status: { in: ['CONTACTED', 'QUALIFIED', 'APPOINTMENT', 'QUOTED', 'NEGOTIATING'] },
          updatedAt: { lte: d14 },
        },
      }),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT status::text AS stage, COUNT(*)::int AS count
         FROM leads
         WHERE "orgId" = $1 AND status NOT IN ('WON','LOST')
         GROUP BY status`,
        orgId,
      ),
    ]);

    // Top overdue leads (for the action list)
    const overdueList = await this.prisma.lead.findMany({
      where: { orgId, status: 'NEW', contactedAt: null, createdAt: { lte: h24 } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        score: true,
        priority: true,
        createdAt: true,
        assignee: { select: { firstName: true, lastName: true, email: true } },
        property: { select: { address: true, city: true } },
      },
    });

    return {
      summary: {
        uncontacted24h: uncontacted24,
        uncontacted48h: uncontacted48,
        stuckDeals: stuck,
      },
      activeByStage: activeByStage.map((r) => ({ stage: r.stage, count: Number(r.count) })),
      overdueList: overdueList.map((l) => ({
        id: l.id,
        name: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unknown',
        phone: l.phone,
        score: l.score,
        priority: l.priority,
        createdAt: l.createdAt,
        hoursOverdue: Math.floor((now.getTime() - l.createdAt.getTime()) / 3600_000),
        assignee: l.assignee
          ? [l.assignee.firstName, l.assignee.lastName].filter(Boolean).join(' ') || l.assignee.email
          : 'Unassigned',
        address: l.property ? `${l.property.address}, ${l.property.city}` : null,
      })),
    };
  }

  /**
   * Territory equity — are reps getting fair opportunity distribution?
   * Per territory: # properties, urgency-weighted opportunity index,
   * assigned rep count, leads generated. Flags imbalance.
   */
  async getTerritoryEquity(orgId: string) {
    // Territory → zip-coded opportunities
    const territories = await this.prisma.territory.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, zipCodes: true },
    });

    if (territories.length === 0) return { territories: [], imbalanceFlag: false };

    const results = await Promise.all(
      territories.map(async (t) => {
        const zips = t.zipCodes || [];
        if (zips.length === 0) {
          return {
            id: t.id,
            name: t.name,
            zipCodes: [],
            properties: 0,
            opportunities: 0,
            leadsGenerated: 0,
            assignedReps: 0,
            opportunityPerRep: 0,
          };
        }

        const [propCount, oppRows, leadCount] = await Promise.all([
          this.prisma.property.count({ where: { zip: { in: zips } } }),
          this.prisma.$queryRawUnsafe<any[]>(
            `SELECT COUNT(*)::int AS high_urgency
             FROM properties
             WHERE zip = ANY($1::text[])
               AND "yearBuilt" IS NOT NULL
               AND (2026 - "yearBuilt") >= 15`,
            zips,
          ),
          this.prisma.lead.count({
            where: {
              orgId,
              property: { zip: { in: zips } },
              createdAt: { gte: new Date(Date.now() - 90 * 86400 * 1000) },
            },
          }),
        ]);

        // Rep count = users in org with at least one lead in this territory
        const repRows = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(DISTINCT l."assigneeId")::int AS reps
           FROM leads l
           JOIN properties p ON p.id = l."propertyId"
           WHERE l."orgId" = $1 AND p.zip = ANY($2::text[]) AND l."assigneeId" IS NOT NULL`,
          orgId,
          zips,
        );

        const reps = Number(repRows[0]?.reps) || 0;
        const opps = Number(oppRows[0]?.high_urgency) || 0;
        return {
          id: t.id,
          name: t.name,
          zipCodes: zips,
          properties: propCount,
          opportunities: opps,
          leadsGenerated: leadCount,
          assignedReps: reps,
          opportunityPerRep: reps > 0 ? Math.round(opps / reps) : opps,
        };
      }),
    );

    // Imbalance if max / min opportunityPerRep > 2x
    const opps = results.map((r) => r.opportunityPerRep).filter((n) => n > 0);
    const imbalanceFlag = opps.length > 1 && Math.max(...opps) / Math.min(...opps) > 2;

    return { territories: results, imbalanceFlag };
  }

  /**
   * Revenue forecast — pipeline-weighted projection across 30/60/90-day horizons.
   * Weight each stage by historical close probability × contract amount.
   * Falls back to avg ticket if contractAmount is null.
   */
  async getRevenueForecast(orgId: string) {
    // Historical stage-to-close probabilities (last 180 days of resolved leads)
    const historicalWindow = new Date(Date.now() - 180 * 86400 * 1000);
    const historical = await this.prisma.$queryRawUnsafe<any[]>(
      `
      WITH resolved AS (
        SELECT status::text AS final_status
        FROM leads
        WHERE "orgId" = $1
          AND status IN ('WON','LOST')
          AND COALESCE("convertedAt","lostAt") >= $2
      )
      SELECT
        COUNT(*) FILTER (WHERE final_status = 'WON')::float / NULLIF(COUNT(*),0) AS win_rate
      FROM resolved
      `,
      orgId,
      historicalWindow,
    );
    const overallWinRate = Number(historical[0]?.win_rate) || 0.25; // 25% default

    // Per-stage probability heuristics — tuned by overall win rate so a
    // high-performing org shifts all stages up, a new org gets conservative
    // baselines. Later we'll replace with per-org per-stage rates.
    const STAGE_WEIGHTS: Record<string, number> = {
      NEW: 0.15 * (overallWinRate / 0.25),
      CONTACTED: 0.25 * (overallWinRate / 0.25),
      QUALIFIED: 0.4 * (overallWinRate / 0.25),
      APPOINTMENT: 0.55 * (overallWinRate / 0.25),
      INSPECTED: 0.65 * (overallWinRate / 0.25),
      QUOTED: 0.7 * (overallWinRate / 0.25),
      NEGOTIATING: 0.85 * (overallWinRate / 0.25),
    };

    // Avg ticket as fallback
    const avgTicketRow = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT AVG("contractAmount")::float AS avg FROM leads WHERE "orgId"=$1 AND "convertedAt" IS NOT NULL`,
      orgId,
    );
    const avgTicket = Number(avgTicketRow[0]?.avg) || 12000;

    const activeLeads = await this.prisma.lead.findMany({
      where: { orgId, status: { notIn: ['WON', 'LOST'] } },
      select: {
        status: true,
        contractAmount: true,
        quotedAmount: true,
        appointmentAt: true,
        inspectedAt: true,
        quotedAt: true,
        contactedAt: true,
        createdAt: true,
      },
    });

    const buckets = { d30: 0, d60: 0, d90: 0, weighted: 0 };
    const now = Date.now();

    for (const l of activeLeads) {
      const prob = STAGE_WEIGHTS[l.status] ?? 0.1;
      const amount = l.contractAmount ?? l.quotedAmount ?? avgTicket;
      const expected = prob * Math.min(amount, 250_000); // cap outliers

      // Expected close date: use stage-appropriate lead indicator
      let expectedCloseAt: number;
      if (l.appointmentAt) {
        expectedCloseAt = l.appointmentAt.getTime() + 14 * 86400 * 1000;
      } else if (l.inspectedAt) {
        expectedCloseAt = l.inspectedAt.getTime() + 10 * 86400 * 1000;
      } else if (l.quotedAt) {
        expectedCloseAt = l.quotedAt.getTime() + 14 * 86400 * 1000;
      } else if (l.contactedAt) {
        expectedCloseAt = l.contactedAt.getTime() + 30 * 86400 * 1000;
      } else {
        expectedCloseAt = l.createdAt.getTime() + 45 * 86400 * 1000;
      }

      const daysOut = Math.max(0, (expectedCloseAt - now) / 86_400_000);
      buckets.weighted += expected;
      if (daysOut <= 30) buckets.d30 += expected;
      if (daysOut <= 60) buckets.d60 += expected;
      if (daysOut <= 90) buckets.d90 += expected;
    }

    return {
      forecast30: Math.round(buckets.d30),
      forecast60: Math.round(buckets.d60),
      forecast90: Math.round(buckets.d90),
      totalWeightedPipeline: Math.round(buckets.weighted),
      activeDeals: activeLeads.length,
      historicalWinRate: overallWinRate,
      avgTicket: Math.round(avgTicket),
    };
  }
}
