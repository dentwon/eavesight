import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { StormsService } from './storms.service';
import { firstValueFrom } from 'rxjs';
import * as zlib from 'zlib';

/**
 * NOAA Storm Events Database Service
 *
 * Fetches historical storm data from NOAA's bulk CSV files.
 * These are large yearly files (tens of MB) with comprehensive
 * storm event data going back decades.
 *
 * Used for: historical backfill, building long-term storm database
 * Not used for: daily/real-time updates (use SPC service for that)
 *
 * Data source: https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
 */
@Injectable()
export class NoaaService {
  private readonly logger = new Logger(NoaaService.name);
  private readonly NOAA_BASE = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly stormsService: StormsService,
  ) {}

  /**
   * Fetch storm events from NOAA bulk data for a given year
   */
  async fetchStormEvents(options: {
    year?: number;
    state?: string;
    eventType?: string;
    limit?: number;
  } = {}) {
    const {
      year = new Date().getFullYear() - 1, // Default to last year (current year may not be available)
      state,
      eventType,
      limit = 1000,
    } = options;

    try {
      this.logger.log(`Fetching NOAA storm data for year ${year}...`);

      // Step 1: Find the correct filename (date suffix changes with each update)
      const filename = await this.findStormDataFile(year);
      if (!filename) {
        this.logger.warn(`No NOAA storm data file found for year ${year}`);
        return [];
      }

      // Step 2: Download and decompress
      const csvData = await this.downloadAndDecompress(filename);
      if (!csvData) return [];

      // Step 3: Parse CSV
      const events = this.parseCsv(csvData, state, eventType, limit);
      this.logger.log(`Parsed ${events.length} storm events from NOAA for year ${year}`);
      return events;
    } catch (error) {
      this.logger.error(`Failed to fetch NOAA data for year ${year}: ${error.message}`);
      return [];
    }
  }

  /**
   * Find the correct filename for a given year by listing the NOAA directory.
   * Files are named: StormEvents_details-ftp_v1.0_dYYYY_cDATE.csv.gz
   * The cDATE suffix changes each time NOAA updates the file.
   */
  private async findStormDataFile(year: number): Promise<string | null> {
    try {
      // Fetch the directory listing
      const response = await firstValueFrom(
        this.httpService.get(this.NOAA_BASE + '/', {
          responseType: 'text',
          timeout: 30000,
        })
      );

      const html = response.data as string;

      // Find files matching this year's pattern
      const pattern = new RegExp(
        `StormEvents_details-ftp_v1\\.0_d${year}_c\\d+\\.csv\\.gz`,
        'g'
      );
      const matches = html.match(pattern);

      if (!matches || matches.length === 0) {
        this.logger.warn(`No NOAA file found for year ${year}`);
        return null;
      }

      // Use the last match (most recent update)
      const filename = matches[matches.length - 1];
      this.logger.log(`Found NOAA file: ${filename}`);
      return filename;
    } catch (error) {
      this.logger.error(`Failed to list NOAA directory: ${error.message}`);
      return null;
    }
  }

  /**
   * Download and decompress a gzipped CSV file
   */
  private async downloadAndDecompress(filename: string): Promise<string | null> {
    const url = `${this.NOAA_BASE}/${filename}`;
    this.logger.log(`Downloading: ${url}`);

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'arraybuffer',
          timeout: 120000, // 2 min timeout for large files
        })
      );

      const decompressed = zlib.gunzipSync(Buffer.from(response.data));
      this.logger.log(`Downloaded and decompressed ${(decompressed.length / 1024 / 1024).toFixed(1)}MB`);
      return decompressed.toString('utf8');
    } catch (error) {
      this.logger.error(`Failed to download ${filename}: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse NOAA CSV data into storm events
   *
   * NOAA CSV columns include:
   * BEGIN_YEARMONTH, BEGIN_DAY, BEGIN_TIME, END_YEARMONTH, END_DAY, END_TIME,
   * EPISODE_ID, EVENT_ID, STATE, STATE_FIPS, YEAR, MONTH_NAME,
   * EVENT_TYPE, CZ_TYPE, CZ_FIPS, CZ_NAME, WFO, BEGIN_DATE_TIME,
   * CZ_TIMEZONE, END_DATE_TIME, INJURIES_DIRECT, INJURIES_INDIRECT,
   * DEATHS_DIRECT, DEATHS_INDIRECT, DAMAGE_PROPERTY, DAMAGE_CROPS,
   * SOURCE, MAGNITUDE, MAGNITUDE_TYPE, FLOOD_CAUSE,
   * CATEGORY, TOR_F_SCALE, TOR_LENGTH, TOR_WIDTH,
   * BEGIN_RANGE, BEGIN_AZIMUTH, BEGIN_LOCATION, END_RANGE,
   * END_AZIMUTH, END_LOCATION, BEGIN_LAT, BEGIN_LON, END_LAT, END_LON,
   * EPISODE_NARRATIVE, EVENT_NARRATIVE, DATA_SOURCE
   */
  private parseCsv(csvData: string, stateFilter?: string, eventTypeFilter?: string, limit?: number): any[] {
    const lines = csvData.split('\n');
    if (lines.length < 2) return [];

    // Parse header row to find column indices
    const header = this.parseCsvLine(lines[0]);
    const colIndex: Record<string, number> = {};
    header.forEach((col, i) => { colIndex[col.trim().toUpperCase()] = i; });

    const events: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      if (limit && events.length >= limit) break;
      if (!lines[i].trim()) continue;

      try {
        const cols = this.parseCsvLine(lines[i]);
        const getValue = (name: string) => cols[colIndex[name]]?.trim() || null;

        const state = getValue('STATE');
        const eventType = getValue('EVENT_TYPE');

        // Apply filters
        if (stateFilter && state?.toUpperCase() !== stateFilter.toUpperCase()) continue;
        if (eventTypeFilter && eventType !== eventTypeFilter) continue;

        // Only include roofing-relevant event types
        const relevantTypes = ['Hail', 'Thunderstorm Wind', 'Tornado', 'High Wind', 'Strong Wind', 'Hurricane', 'Hurricane (Typhoon)'];
        if (!relevantTypes.includes(eventType || '')) continue;

        const lat = parseFloat(getValue('BEGIN_LAT') || '0');
        const lon = parseFloat(getValue('BEGIN_LON') || '0');
        if (lat === 0 || lon === 0) continue; // Skip events without coordinates

        const magnitude = parseFloat(getValue('MAGNITUDE') || '0');
        const beginDate = getValue('BEGIN_DATE_TIME');

        events.push({
          type: this.mapEventType(eventType || ''),
          severity: this.mapSeverity(eventType || '', magnitude),
          date: beginDate ? new Date(beginDate) : new Date(),
          city: getValue('CZ_NAME'),
          county: getValue('CZ_NAME'), // CZ_NAME is often the county name
          state: this.normalizeState(state || ''),
          description: getValue('EVENT_NARRATIVE'),
          source: 'NOAA',
          sourceId: getValue('EVENT_ID'),
          lat,
          lon: lon > 0 ? -lon : lon, // NOAA sometimes uses positive lon for western hemisphere
          magnitude,
        });
      } catch (error) {
        // Skip malformed lines
        continue;
      }
    }

    return events;
  }

  /**
   * Parse a CSV line handling quoted fields
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Map NOAA event types to our internal types
   */
  private mapEventType(noaaType: string): string {
    const map: Record<string, string> = {
      'Hail': 'HAIL',
      'Thunderstorm Wind': 'WIND',
      'Tornado': 'TORNADO',
      'High Wind': 'WIND',
      'Strong Wind': 'WIND',
      'Hurricane': 'HURRICANE',
      'Hurricane (Typhoon)': 'HURRICANE',
      'Flood': 'FLOOD',
      'Flash Flood': 'FLOOD',
    };
    return map[noaaType] || 'OTHER';
  }

  /**
   * Map severity based on event type and magnitude
   *
   * Hail magnitude = diameter in inches
   * Wind magnitude = speed in knots
   * Tornado = EF scale (from TOR_F_SCALE column, but we get magnitude)
   */
  private mapSeverity(eventType: string, magnitude: number): string {
    if (eventType === 'Hail') {
      if (magnitude >= 2.5) return 'EXTREME';
      if (magnitude >= 1.75) return 'SEVERE';
      if (magnitude >= 1.0) return 'MODERATE';
      return 'LIGHT';
    }
    if (eventType.includes('Wind') || eventType === 'Thunderstorm Wind') {
      if (magnitude >= 80) return 'EXTREME';
      if (magnitude >= 65) return 'SEVERE';
      if (magnitude >= 50) return 'MODERATE';
      return 'LIGHT';
    }
    if (eventType === 'Tornado') {
      if (magnitude >= 3) return 'EXTREME';
      if (magnitude >= 2) return 'SEVERE';
      if (magnitude >= 1) return 'MODERATE';
      return 'LIGHT';
    }
    if (magnitude >= 2.0) return 'EXTREME';
    if (magnitude >= 1.0) return 'SEVERE';
    if (magnitude >= 0.5) return 'MODERATE';
    return 'LIGHT';
  }

  /**
   * Normalize state abbreviation (NOAA uses full uppercase names)
   */
  private normalizeState(state: string): string {
    const stateMap: Record<string, string> = {
      'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
      'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
      'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
      'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
      'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
      'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
      'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
      'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
      'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
      'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
      'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
      'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
      'WISCONSIN': 'WI', 'WYOMING': 'WY', 'DISTRICT OF COLUMBIA': 'DC',
    };
    // If already a 2-letter code, return as-is
    if (state.length === 2) return state.toUpperCase();
    return stateMap[state.toUpperCase()] || state.substring(0, 2).toUpperCase();
  }

  /**
   * Sync storm events from NOAA to our database
   * Handles both current and previous year
   */
  async syncStormEvents(options?: {
    state?: string;
    years?: number[];
    limit?: number;
  }): Promise<{ synced: number; total: number }> {
    const {
      state,
      years = [new Date().getFullYear() - 1, new Date().getFullYear() - 2],
      limit = 500,
    } = options || {};

    this.logger.log(`Starting NOAA sync for years: ${years.join(', ')}`);

    let synced = 0;
    let total = 0;

    for (const year of years) {
      try {
        const events = await this.fetchStormEvents({ year, state, limit });
        total += events.length;

        for (const event of events) {
          try {
            await this.stormsService.syncFromNOAA(event);
            synced++;
          } catch (error) {
            // Skip duplicates silently
          }
        }

        this.logger.log(`Synced ${events.length} events from NOAA for year ${year}`);
      } catch (error) {
        this.logger.warn(`Failed to sync NOAA data for ${year}: ${error.message}`);
      }
    }

    this.logger.log(`NOAA sync complete: ${synced}/${total} events synced`);
    return { synced, total };
  }
}
