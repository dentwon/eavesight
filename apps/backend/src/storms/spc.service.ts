import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { StormsService } from './storms.service';
import { firstValueFrom } from 'rxjs';
import { Cron } from '@nestjs/schedule';

/**
 * SPC (Storm Prediction Center) Service
 *
 * Fetches daily storm reports from SPC - small, reliable CSV files
 * updated daily with exact lat/lon, hail sizes, and wind speeds.
 * Focus: post-storm data collection for lead generation.
 */
@Injectable()
export class SpcService {
  private readonly logger = new Logger(SpcService.name);
  private readonly SPC_BASE = 'https://www.spc.noaa.gov/climo/reports';

  constructor(
    private readonly httpService: HttpService,
    private readonly stormsService: StormsService,
  ) {}

  async fetchTodayHail(): Promise<any[]> {
    return this.fetchSpcReport('today_hail.csv', 'HAIL');
  }

  async fetchTodayWind(): Promise<any[]> {
    return this.fetchSpcReport('today_wind.csv', 'WIND');
  }

  async fetchTodayTornado(): Promise<any[]> {
    return this.fetchSpcReport('today_torn.csv', 'TORNADO');
  }

  async fetchDateHail(date: Date): Promise<any[]> {
    const dateStr = this.formatSpcDate(date);
    return this.fetchSpcReport(`${dateStr}_rpts_hail.csv`, 'HAIL');
  }

  async fetchDateWind(date: Date): Promise<any[]> {
    const dateStr = this.formatSpcDate(date);
    return this.fetchSpcReport(`${dateStr}_rpts_wind.csv`, 'WIND');
  }

  async fetchDateTornado(date: Date): Promise<any[]> {
    const dateStr = this.formatSpcDate(date);
    return this.fetchSpcReport(`${dateStr}_rpts_torn.csv`, 'TORNADO');
  }

  /**
   * Fetch and parse a SPC storm report CSV
   *
   * SPC CSV format (no header, comma-separated):
   * Hail: Time,Size,Location,County,State,Lat,Lon,Comments
   * Wind: Time,Speed,Location,County,State,Lat,Lon,Comments
   * Tornado: Time,F-Scale,Location,County,State,Lat,Lon,Comments
   */
  private async fetchSpcReport(filename: string, stormType: string): Promise<any[]> {
    const url = `${this.SPC_BASE}/${filename}`;

    try {
      this.logger.log(`Fetching SPC report: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'text',
          timeout: 30000,
        })
      );

      const csv = response.data as string;
      if (!csv || csv.trim().length === 0) {
        this.logger.log(`No data in SPC report: ${filename}`);
        return [];
      }

      const lines = csv.trim().split('\n');
      const events: any[] = [];

      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());

        // Skip header lines or empty lines
        if (parts.length < 7 || parts[0] === 'Time') continue;

        const [time, magnitude, location, county, state, latStr, lonStr, ...commentParts] = parts;

        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);

        // Skip invalid coordinates
        if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue;

        const mag = parseFloat(magnitude) || 0;

        events.push({
          type: stormType,
          severity: this.calculateSeverity(stormType, mag),
          date: new Date(),
          city: location || null,
          county: county || null,
          state: state || null,
          description: commentParts.join(', ').trim() || null,
          source: 'SPC',
          sourceId: `SPC-${stormType}-${time}-${lat}-${lon}`,
          lat,
          lon: lon > 0 ? -lon : lon, // SPC uses positive lon for western hemisphere
          magnitude: mag,
          hailSizeInches: stormType === 'HAIL' ? mag : undefined,
          windSpeedMph: stormType === 'WIND' ? mag * 1.15078 : undefined,
          tornadoFScale: stormType === 'TORNADO' && !isNaN(mag) ? 'EF' + mag : undefined,
        });
      }

      this.logger.log(`Parsed ${events.length} ${stormType} events from SPC`);
      return events;
    } catch (error) {
      if (error?.response?.status === 404) {
        this.logger.debug(`No SPC report found: ${filename} (404)`);
        return [];
      }
      this.logger.error(`Failed to fetch SPC report ${filename}: ${error.message}`);
      return [];
    }
  }

  /**
   * Hail severity by size (inches):
   *   < 1.0" = LIGHT, 1.0-1.75" = MODERATE, 1.75-2.5" = SEVERE, > 2.5" = EXTREME
   * Wind severity by speed (knots):
   *   < 50kt = LIGHT, 50-65kt = MODERATE, 65-80kt = SEVERE, > 80kt = EXTREME
   * Tornado severity by EF scale:
   *   EF0 = LIGHT, EF1 = MODERATE, EF2 = SEVERE, EF3+ = EXTREME
   */
  private calculateSeverity(type: string, magnitude: number): string {
    if (type === 'HAIL') {
      if (magnitude >= 2.5) return 'EXTREME';
      if (magnitude >= 1.75) return 'SEVERE';
      if (magnitude >= 1.0) return 'MODERATE';
      return 'LIGHT';
    }
    if (type === 'WIND') {
      if (magnitude >= 80) return 'EXTREME';
      if (magnitude >= 65) return 'SEVERE';
      if (magnitude >= 50) return 'MODERATE';
      return 'LIGHT';
    }
    if (type === 'TORNADO') {
      if (magnitude >= 3) return 'EXTREME';
      if (magnitude >= 2) return 'SEVERE';
      if (magnitude >= 1) return 'MODERATE';
      return 'LIGHT';
    }
    return 'LIGHT';
  }

  private formatSpcDate(date: Date): string {
    const yy = date.getFullYear().toString().slice(-2);
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const dd = date.getDate().toString().padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  /**
   * Sync all storm types from SPC for today
   */
  async syncToday(): Promise<{ synced: number; total: number }> {
    this.logger.log('Syncing today\'s SPC storm reports...');

    let synced = 0;
    let total = 0;

    const [hail, wind, tornado] = await Promise.all([
      this.fetchTodayHail(),
      this.fetchTodayWind(),
      this.fetchTodayTornado(),
    ]);

    const allEvents = [...hail, ...wind, ...tornado];
    total = allEvents.length;

    for (const event of allEvents) {
      try {
        await this.stormsService.syncFromNOAA(event);
        synced++;
      } catch (error) {
        this.logger.warn(`Failed to sync SPC event: ${error.message}`);
      }
    }

    this.logger.log(`SPC sync complete: ${synced}/${total} events synced`);
    return { synced, total };
  }

  /**
   * Sync historical SPC reports for a date range
   */
  async syncDateRange(startDate: Date, endDate: Date): Promise<{ synced: number; total: number }> {
    let synced = 0;
    let total = 0;

    const current = new Date(startDate);
    while (current <= endDate) {
      try {
        const [hail, wind, tornado] = await Promise.all([
          this.fetchDateHail(current),
          this.fetchDateWind(current),
          this.fetchDateTornado(current),
        ]);

        const dayEvents = [...hail, ...wind, ...tornado];
        for (const event of dayEvents) {
          event.date = new Date(current);
        }

        total += dayEvents.length;

        for (const event of dayEvents) {
          try {
            await this.stormsService.syncFromNOAA(event);
            synced++;
          } catch (error) {
            this.logger.warn(`Failed to sync historical SPC event: ${error.message}`);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to sync SPC for ${current.toISOString().split('T')[0]}: ${error.message}`);
      }

      current.setDate(current.getDate() + 1);
      // Be respectful to SPC servers
      await new Promise(r => setTimeout(r, 500));
    }

    this.logger.log(`Historical SPC sync: ${synced}/${total} events synced`);
    return { synced, total };
  }

  /**
   * Cron: Sync SPC reports twice daily (7am and 7pm)
   */
  @Cron('0 7,19 * * *')
  async handleScheduledSync() {
    if (process.env.ENABLE_STORM_SYNC !== 'true') {
      return;
    }

    this.logger.log('Running scheduled SPC storm sync...');
    try {
      const result = await this.syncToday();
      this.logger.log(`Scheduled SPC sync: ${result.synced} events synced`);
    } catch (error) {
      this.logger.error('Scheduled SPC sync failed', error.stack);
    }
  }
}
