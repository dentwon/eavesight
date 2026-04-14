import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * DNC (Do Not Call) Scrubbing Service
 *
 * Ensures compliance with the Telephone Consumer Protection Act (TCPA)
 * and FTC Do-Not-Call Registry rules.
 *
 * Features:
 * - Import National DNC Registry entries
 * - Import state-specific DNC lists
 * - Maintain internal DNC list (opt-outs)
 * - Scrub phone numbers before outreach
 * - Flag properties with DNC-registered numbers
 *
 * Legal requirements:
 * - Must scrub against National DNC before calling
 * - Must honor opt-out requests within 10 business days
 * - Must maintain internal DNC list
 * - Violations: $500-$1,500 per call
 */
@Injectable()
export class DncService {
  private readonly logger = new Logger(DncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if a phone number is on the DNC list
   */
  async isOnDncList(phone: string): Promise<boolean> {
    const normalized = this.normalizePhone(phone);
    if (!normalized) return false;

    const entry = await this.prisma.dncEntry.findUnique({
      where: { phone: normalized },
    });

    return !!entry;
  }

  /**
   * Bulk check multiple phone numbers against DNC list
   * Returns set of numbers that ARE on the DNC list
   */
  async bulkCheck(phones: string[]): Promise<Set<string>> {
    const normalized = phones
      .map(p => this.normalizePhone(p))
      .filter(Boolean) as string[];

    const entries = await this.prisma.dncEntry.findMany({
      where: { phone: { in: normalized } },
      select: { phone: true },
    });

    return new Set(entries.map(e => e.phone));
  }

  /**
   * Add a phone number to the internal DNC list (opt-out)
   */
  async addToDnc(phone: string, source: string = 'opt_out'): Promise<void> {
    const normalized = this.normalizePhone(phone);
    if (!normalized) return;

    await this.prisma.dncEntry.upsert({
      where: { phone: normalized },
      update: { source },
      create: { phone: normalized, source },
    });

    // Also flag any properties with this phone
    await this.prisma.property.updateMany({
      where: {
        OR: [
          { ownerPhone: normalized },
          { ownerPhone2: normalized },
        ],
      },
      data: { onDncList: true },
    });

    this.logger.log(`Added ${normalized} to DNC list (source: ${source})`);
  }

  /**
   * Remove from internal DNC list
   */
  async removeFromDnc(phone: string): Promise<void> {
    const normalized = this.normalizePhone(phone);
    if (!normalized) return;

    await this.prisma.dncEntry.deleteMany({
      where: { phone: normalized },
    });

    // Re-check if property should still be flagged
    await this.refreshPropertyDncFlags([normalized]);

    this.logger.log(`Removed ${normalized} from DNC list`);
  }

  /**
   * Import DNC entries from a list of phone numbers
   * Used to import the National DNC Registry or state lists
   */
  async importBulk(phones: string[], source: string): Promise<{ imported: number; duplicates: number }> {
    let imported = 0;
    let duplicates = 0;

    // Process in batches
    const batchSize = 500;
    for (let i = 0; i < phones.length; i += batchSize) {
      const batch = phones.slice(i, i + batchSize);

      for (const phone of batch) {
        const normalized = this.normalizePhone(phone);
        if (!normalized) continue;

        try {
          await this.prisma.dncEntry.create({
            data: { phone: normalized, source },
          });
          imported++;
        } catch (error) {
          // Duplicate - already exists
          duplicates++;
        }
      }

      this.logger.log(`DNC import progress: ${i + batch.length}/${phones.length}`);
    }

    this.logger.log(`DNC import complete: ${imported} new, ${duplicates} duplicates`);
    return { imported, duplicates };
  }

  /**
   * Scrub all properties and flag those with DNC numbers
   * Run this after importing new DNC data
   */
  async scrubAllProperties(batchSize: number = 500): Promise<{ checked: number; flagged: number }> {
    let checked = 0;
    let flagged = 0;
    let skip = 0;

    while (true) {
      const properties = await this.prisma.property.findMany({
        where: {
          OR: [
            { ownerPhone: { not: null } },
            { ownerPhone2: { not: null } },
          ],
        },
        select: {
          id: true,
          ownerPhone: true,
          ownerPhone2: true,
        },
        skip,
        take: batchSize,
      });

      if (properties.length === 0) break;

      // Collect all phone numbers
      const phones: string[] = [];
      for (const p of properties) {
        if (p.ownerPhone) phones.push(this.normalizePhone(p.ownerPhone) || '');
        if (p.ownerPhone2) phones.push(this.normalizePhone(p.ownerPhone2) || '');
      }

      const dncSet = await this.bulkCheck(phones.filter(Boolean));

      // Update properties
      for (const p of properties) {
        const phone1 = p.ownerPhone ? this.normalizePhone(p.ownerPhone) : null;
        const phone2 = p.ownerPhone2 ? this.normalizePhone(p.ownerPhone2) : null;
        const isOnDnc = (phone1 && dncSet.has(phone1)) || (phone2 && dncSet.has(phone2));

        if (isOnDnc) {
          await this.prisma.property.update({
            where: { id: p.id },
            data: { onDncList: true },
          });
          flagged++;
        }

        checked++;
      }

      skip += batchSize;
      this.logger.log(`DNC scrub progress: ${checked} checked, ${flagged} flagged`);
    }

    this.logger.log(`DNC scrub complete: ${checked} checked, ${flagged} flagged`);
    return { checked, flagged };
  }

  /**
   * Get DNC stats
   */
  async getStats() {
    const [totalEntries, totalFlagged] = await Promise.all([
      this.prisma.dncEntry.count(),
      this.prisma.property.count({ where: { onDncList: true } }),
    ]);

    const bySource = await this.prisma.dncEntry.groupBy({
      by: ['source'],
      _count: { id: true },
    });

    return {
      totalEntries,
      totalFlaggedProperties: totalFlagged,
      bySource: bySource.map(s => ({
        source: s.source,
        count: s._count.id,
      })),
    };
  }

  /**
   * Check if a lead's phone is safe to call/text
   * Returns { canCall, canText, reason }
   */
  async checkLeadCompliance(leadId: string): Promise<{
    canCall: boolean;
    canText: boolean;
    canEmail: boolean;
    reason: string;
  }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        property: {
          select: {
            onDncList: true,
            ownerPhone: true,
            ownerEmail: true,
          },
        },
      },
    });

    if (!lead) {
      return { canCall: false, canText: false, canEmail: false, reason: 'Lead not found' };
    }

    const phone = lead.phone || lead.property?.ownerPhone;
    const email = lead.email || lead.property?.ownerEmail;

    let canCall = false;
    let canText = false;
    let canEmail = !!email;
    let reason = '';

    if (phone) {
      const isOnDnc = lead.property?.onDncList || await this.isOnDncList(phone);

      if (isOnDnc) {
        reason = 'Phone is on DNC list - email only';
        canCall = false;
        canText = false;
      } else {
        canCall = true;
        canText = true; // SMS requires separate opt-in for automated, but manual is OK
        reason = 'Phone is clear - manual calling/texting permitted';
      }
    } else {
      reason = 'No phone number available';
    }

    if (!canCall && !canText && canEmail) {
      reason += '. Email outreach available.';
    }

    return { canCall, canText, canEmail, reason };
  }

  /**
   * Normalize phone to E.164 format (US): +1XXXXXXXXXX
   */
  private normalizePhone(phone: string): string | null {
    if (!phone) return null;

    // Strip everything except digits
    const digits = phone.replace(/\D/g, '');

    // Handle US numbers
    if (digits.length === 10) {
      return `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }

    return null;
  }

  /**
   * Refresh DNC flags for specific phone numbers
   */
  private async refreshPropertyDncFlags(phones: string[]) {
    const dncSet = await this.bulkCheck(phones);

    for (const phone of phones) {
      const normalized = this.normalizePhone(phone);
      if (!normalized) continue;

      const isOnDnc = dncSet.has(normalized);

      await this.prisma.property.updateMany({
        where: {
          OR: [
            { ownerPhone: normalized },
            { ownerPhone2: normalized },
          ],
        },
        data: { onDncList: isOnDnc },
      });
    }
  }
}
