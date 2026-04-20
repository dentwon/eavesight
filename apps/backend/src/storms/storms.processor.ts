import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { NoaaService } from './noaa.service';
import { SpcService } from './spc.service';
import { StormsService } from './storms.service';
import { AlertsService } from '../alerts/alerts.service';

/**
 * Storm data sync orchestrator — REAL-TIME PIPELINE
 *
 * Tier 1 (real-time):   NWS active alerts every 3 min  → polygon match → SSE
 * Tier 2 (near-RT):     SPC today reports every 30 min → centroid storm_event row
 * Tier 3 (post-storm):  MRMS MESH daily (separate Python/Node pipeline)
 * Tier 4 (daily):       NOAA historical + SPC gap-fill
 * Tier 5 (weekly):      NOAA backfill over the last 2-3 seasons
 * Tier 6 (housekeeping): every 15 min expire stale alerts
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
    private readonly alertsService: AlertsService,
  ) {}

  // ================================================================
  // TIER 1 — NWS alerts every 3 minutes. Polygon-matched to properties.
  // ================================================================
  @Cron('*/3 * * * *')
  async handleNwsAlertPoll() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          'https://api.weather.gov/alerts/active?area=AL&event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Flash%20Flood%20Warning&status=actual',
          {
            headers: { 'User-Agent': 'Eavesight/1.0 (contact@eavesight.com)' },
            timeout: 10_000,
          },
        ),
      );

      const features = response.data?.features || [];
      if (features.length === 0) return;

      let newAlerts = 0;
      let propertiesAlerted = 0;

      for (const feature of features) {
        const props = feature.properties;
        const geometry = feature.geometry;
        if (!props) continue;

        const sent = new Date(props.sent || props.effective || Date.now());
        if (sent <= this.lastAlertCheck) continue;

        const event = props.event || '';
        const isTornado = event.includes('Tornado');
        const isFlood = event.includes('Flood');
        const alertType: 'TORNADO_WARNING' | 'SEVERE_TSTORM' | 'FLOOD' | 'HIGH_WIND' = isTornado
          ? 'TORNADO_WARNING'
          : isFlood
          ? 'FLOOD'
          : 'SEVERE_TSTORM';

        const severity: 'EXTREME' | 'SEVERE' | 'MODERATE' = isTornado ? 'EXTREME' : 'SEVERE';

        const params = props.parameters || {};
        const hailSize = params.maxHailSize?.[0] ? parseFloat(params.maxHailSize[0]) : null;
        const windSpeed = params.windGust?.[0] ? parseFloat(params.windGust[0]) : null;
        const expiresAt = props.expires ? new Date(props.expires) : null;

        // Centroid for StormEvent row
        let lat: number | null = null;
        let lon: number | null = null;
        if (geometry?.type === 'Polygon' && geometry.coordinates?.[0]) {
          const ring = geometry.coordinates[0];
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
        }
        if (lat == null || lon == null) continue;

        // Upsert canonical StormEvent so we can link PropertyAlert -> StormEvent
        let stormEventId: string | null = null;
        try {
          const se = await this.stormsService.syncFromNOAA({
            type: isTornado ? 'TORNADO' : isFlood ? 'FLOOD' : 'WIND',
            severity: severity === 'EXTREME' ? 'EXTREME' : 'SEVERE',
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
            description: props.headline || event,
          });
          stormEventId = (se as any)?.id ?? null;
          newAlerts++;
        } catch {
          // Likely duplicate — still run the polygon match.
        }

        // Polygon match → PropertyAlert batch → SSE emit
        if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
          try {
            const res = await this.alertsService.matchWarningToProperties({
              stormEventId,
              alertType,
              alertSource: 'NWS_ALERT',
              severity,
              startedAt: sent,
              expiresAt,
              polygonGeoJson: geometry,
              metadata: {
                headline: props.headline,
                event,
                areaDesc: props.areaDesc,
                nwsId: props.id,
                hailSize,
                windSpeed,
              },
            });
            propertiesAlerted += res.inserted;
          } catch (e) {
            this.logger.error('matchWarningToProperties failed: ' + (e as Error).message);
          }
        }
      }

      if (newAlerts > 0 || propertiesAlerted > 0) {
        this.logger.warn(
          `NWS ALERT SWEEP: ${newAlerts} new events, ${propertiesAlerted} properties newly alerted`,
        );
      }

      this.lastAlertCheck = new Date();
    } catch (error: any) {
      if (error?.response?.status !== 304) {
        this.logger.debug('NWS alert poll failed: ' + error.message);
      }
    }
  }

  // ================================================================
  // TIER 2 — SPC today reports every 30 min
  // ================================================================
  @Cron('*/30 * * * *')
  async handleSpcSync() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;
    try {
      const result = await this.spcService.syncToday();
      if (result.synced > 0) this.logger.log(`SPC sync: ${result.synced} new events`);
    } catch (error: any) {
      this.logger.error('SPC sync failed', error.stack);
    }
  }

  // ================================================================
  // TIER 4 — Daily SPC gap-fill + NOAA historical
  // ================================================================
  @Cron('0 2 * * *')
  async handleSpcGapFill() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 3);
      const result = await this.spcService.syncDateRange(start, end);
      this.logger.log(`SPC gap-fill: ${result.synced} events synced`);
    } catch (error: any) {
      this.logger.error('SPC gap-fill failed', error.stack);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleNoaaSync() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;
    try {
      const currentYear = new Date().getFullYear();
      const result = await this.noaaService.syncStormEvents({
        state: 'ALABAMA',
        years: [currentYear, currentYear - 1],
        limit: 5000,
      });
      this.logger.log(`NOAA sync: ${result.synced} events synced`);
    } catch (error: any) {
      this.logger.error('NOAA sync failed', error.stack);
    }
  }

  // ================================================================
  // TIER 5 — Weekly NOAA backfill (Sun 4am)
  // ================================================================
  @Cron('0 4 * * 0')
  async handleWeeklyBackfill() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') return;
    try {
      const currentYear = new Date().getFullYear();
      const result = await this.noaaService.syncStormEvents({
        state: 'ALABAMA',
        years: [currentYear, currentYear - 1, currentYear - 2],
        limit: 5000,
      });
      this.logger.log(`Weekly backfill: ${result.synced} events synced`);
    } catch (error: any) {
      this.logger.error('Weekly backfill failed', error.stack);
    }
  }

  // ================================================================
  // TIER 6 — Expire stale alerts every 15 min
  // ================================================================
  @Cron('*/15 * * * *')
  async handleAlertExpiry() {
    try {
      await this.alertsService.expireStaleAlerts();
    } catch (error: any) {
      this.logger.error('expireStaleAlerts failed', error.stack);
    }
  }
}
