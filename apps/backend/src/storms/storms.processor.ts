import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { NoaaService } from './noaa.service';
import { SpcService } from './spc.service';
import { StormsService } from './storms.service';

/**
 * Storm data sync orchestrator — REAL-TIME PIPELINE
 *
 * Tier 1 (real-time): NWS active alerts every 3 minutes
 * Tier 2 (near-real-time): SPC today reports every 30 minutes
 * Tier 3 (post-storm): MRMS MESH data (separate Python pipeline)
 * Tier 4 (daily): NOAA historical + SPC gap-fill + DAT surveys
 */
@Injectable()
export class StormsProcessor {
  private readonly logger = new Logger(StormsProcessor.name);
  private lastAlertCheck = new Date(0);

  constructor(
    private readonly noaaService: NoaaService,
    private readonly spcService: SpcService,
    private readonly stormsService: StormsService,
    private readonly httpService: HttpService,
  ) {}

  // ================================================================
  // TIER 1: Real-time NWS alerts (every 3 minutes)
  // ================================================================

  @Cron('*/3 * * * *')
  async handleNwsAlertPoll() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          'https://api.weather.gov/alerts/active?area=AL&event=Tornado%20Warning,Severe%20Thunderstorm%20Warning&status=actual',
          {
            headers: { 'User-Agent': 'Eavesight/1.0 (contact@eavesight.com)' },
            timeout: 10000,
          },
        ),
      );

      const features = response.data?.features || [];
      if (features.length === 0) return;

      let newAlerts = 0;
      for (const feature of features) {
        const props = feature.properties;
        const geometry = feature.geometry;
        if (!props) continue;

        // Only process alerts newer than our last check
        const sent = new Date(props.sent || props.effective);
        if (sent <= this.lastAlertCheck) continue;

        // Determine storm type from event name
        const isTornado = props.event?.includes('Tornado');
        const type = isTornado ? 'TORNADO' : 'WIND';
        const severity = isTornado ? 'EXTREME' : 'SEVERE';

        // Extract hail size and wind speed from parameters
        const params = props.parameters || {};
        const hailSize = params.maxHailSize?.[0] ? parseFloat(params.maxHailSize[0]) : null;
        const windSpeed = params.windGust?.[0] ? parseFloat(params.windGust[0]) : null;

        // If we have a polygon, compute centroid for the storm event
        let lat = null, lon = null;
        if (geometry?.type === 'Polygon' && geometry.coordinates?.[0]) {
          const ring = geometry.coordinates[0];
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
        }

        if (!lat || !lon) continue;

        // Store as storm event
        try {
          await this.stormsService.syncFromNOAA({
            type,
            severity,
            date: sent,
            city: props.areaDesc?.substring(0, 100) || '',
            county: '',
            state: 'AL',
            source: 'NWS_ALERT',
            sourceId: props.id || `NWS-${Date.now()}`,
            lat,
            lon,
            hailSizeInches: hailSize || undefined,
            windSpeedMph: windSpeed || undefined,
            description: props.headline || props.event,
          });
          newAlerts++;
        } catch (err) {
          // Duplicate, skip
        }
      }

      if (newAlerts > 0) {
        this.logger.warn(`NWS ALERT: ${newAlerts} new severe weather alerts for AL!`);
        // TODO: Trigger push notifications to roofers in affected area
        // TODO: Auto-score properties within warning polygons
      }

      this.lastAlertCheck = new Date();
    } catch (error) {
      // Silently skip — alert polling should never crash the app
      if (error?.response?.status !== 304) {
        this.logger.debug('NWS alert poll failed: ' + error.message);
      }
    }
  }

  // ================================================================
  // TIER 2: SPC reports every 30 minutes (near-real-time)
  // ================================================================

  @Cron('*/30 * * * *')
  async handleSpcSync() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;

    this.logger.log('Running SPC sync...');
    try {
      const result = await this.spcService.syncToday();
      if (result.synced > 0) {
        this.logger.log(`SPC sync: ${result.synced} new events`);
      }
    } catch (error) {
      this.logger.error('SPC sync failed', error.stack);
    }
  }

  // ================================================================
  // TIER 4: Daily maintenance jobs
  // ================================================================

  @Cron('0 2 * * *')
  async handleSpcGapFill() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;

    this.logger.log('Running daily SPC gap-fill (last 3 days)...');
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 3);
      const result = await this.spcService.syncDateRange(start, end);
      this.logger.log(`SPC gap-fill: ${result.synced} events synced`);
    } catch (error) {
      this.logger.error('SPC gap-fill failed', error.stack);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleNoaaSync() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;

    this.logger.log('Running daily NOAA historical sync...');
    try {
      const currentYear = new Date().getFullYear();
      const result = await this.noaaService.syncStormEvents({
        state: 'ALABAMA',
        years: [currentYear, currentYear - 1],
        limit: 5000,
      });
      this.logger.log(`NOAA sync: ${result.synced} events synced`);
    } catch (error) {
      this.logger.error('NOAA sync failed', error.stack);
    }
  }

  @Cron('0 4 * * 0')
  async handleWeeklyBackfill() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;

    this.logger.log('Running weekly NOAA backfill...');
    try {
      const currentYear = new Date().getFullYear();
      const result = await this.noaaService.syncStormEvents({
        state: 'ALABAMA',
        years: [currentYear, currentYear - 1, currentYear - 2],
        limit: 5000,
      });
      this.logger.log(`Weekly backfill: ${result.synced} events synced`);
    } catch (error) {
      this.logger.error('Weekly backfill failed', error.stack);
    }
  }
}
