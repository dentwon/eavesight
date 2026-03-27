import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NoaaService } from './noaa.service';
import { SpcService } from './spc.service';

/**
 * Storm data sync orchestrator
 *
 * Coordinates data collection from multiple free sources:
 * - SPC: Daily storm reports (hail, wind, tornado) — fresh data, small files
 * - NOAA: Bulk historical storm database — comprehensive backfill
 *
 * Strategy: SPC for daily ingestion, NOAA for historical depth
 */
@Injectable()
export class StormsProcessor {
  private readonly logger = new Logger(StormsProcessor.name);

  constructor(
    private readonly noaaService: NoaaService,
    private readonly spcService: SpcService,
  ) {}

  /**
   * Every 6 hours: sync today's SPC reports
   * This catches storms throughout the day
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async handleSpcSync() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') {
      return;
    }

    this.logger.log('Running scheduled SPC sync...');
    try {
      const result = await this.spcService.syncToday();
      this.logger.log(`SPC sync: ${result.synced} events synced`);
    } catch (error) {
      this.logger.error('SPC sync failed', error.stack);
    }
  }

  /**
   * Daily at 3am: comprehensive NOAA sync for historical data
   * Focuses on Alabama (our launch market) to keep data manageable
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleNoaaSync() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') {
      return;
    }

    this.logger.log('Running daily NOAA historical sync...');
    try {
      const result = await this.noaaService.syncStormEvents({
        state: 'ALABAMA',
        years: [new Date().getFullYear() - 1],
        limit: 200,
      });
      this.logger.log(`NOAA sync: ${result.synced} events synced`);
    } catch (error) {
      this.logger.error('NOAA sync failed', error.stack);
    }
  }

  /**
   * Weekly on Sunday at 4am: broader NOAA backfill
   * Syncs 2 years of data for Alabama
   */
  @Cron('0 4 * * 0')
  async handleWeeklyBackfill() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') {
      return;
    }

    this.logger.log('Running weekly NOAA backfill...');
    try {
      const currentYear = new Date().getFullYear();
      const result = await this.noaaService.syncStormEvents({
        state: 'ALABAMA',
        years: [currentYear - 1, currentYear - 2],
        limit: 500,
      });
      this.logger.log(`Weekly backfill: ${result.synced} events synced`);
    } catch (error) {
      this.logger.error('Weekly backfill failed', error.stack);
    }
  }
}
