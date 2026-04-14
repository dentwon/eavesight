import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId: string;
  components: {
    street: string;
    city: string;
    state: string;
    zip: string;
    county: string;
  };
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly apiKey: string;

  // Track to stay in free tier (10K/month)
  private monthlyCallCount = 0;
  private currentMonth = new Date().getMonth();
  private readonly FREE_TIER_LIMIT = 10000;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_GEOCODING_API_KEY') || '';
  }

  private checkRateLimit(): boolean {
    const now = new Date();
    if (now.getMonth() !== this.currentMonth) {
      this.currentMonth = now.getMonth();
      this.monthlyCallCount = 0;
    }
    if (this.monthlyCallCount >= this.FREE_TIER_LIMIT) {
      this.logger.warn('Google Geocoding free tier limit reached');
      return false;
    }
    return true;
  }

  async geocode(address: string): Promise<GeocodingResult | null> {
    if (!this.apiKey || !this.checkRateLimit()) return null;

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: { address, key: this.apiKey },
          timeout: 5000,
        },
      );

      this.monthlyCallCount++;

      const rd = response.data as any; if (rd.status !== 'OK' || !rd.results?.length) {
        return null;
      }

      const result = rd.results[0];
      const loc = result.geometry.location;
      const components = result.address_components || [];

      const getComponent = (type: string) =>
        components.find((c: any) => c.types.includes(type))?.long_name || '';

      return {
        latitude: loc.lat,
        longitude: loc.lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
        components: {
          street: getComponent('route'),
          city: getComponent('locality') || getComponent('sublocality'),
          state: components.find((c: any) => c.types.includes('administrative_area_level_1'))?.short_name || '',
          zip: getComponent('postal_code'),
          county: getComponent('administrative_area_level_2'),
        },
      };
    } catch (error) {
      this.logger.error(`Geocoding error: ${error}`);
      return null;
    }
  }

  async reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null> {
    if (!this.apiKey || !this.checkRateLimit()) return null;

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: { latlng: `${lat},${lon}`, key: this.apiKey },
          timeout: 5000,
        },
      );

      this.monthlyCallCount++;

      const rd = response.data as any; if (rd.status !== 'OK' || !rd.results?.length) {
        return null;
      }

      const result = rd.results[0];
      const loc = result.geometry.location;
      const components = result.address_components || [];

      const getComponent = (type: string) =>
        components.find((c: any) => c.types.includes(type))?.long_name || '';

      return {
        latitude: loc.lat,
        longitude: loc.lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
        components: {
          street: getComponent('route'),
          city: getComponent('locality') || getComponent('sublocality'),
          state: components.find((c: any) => c.types.includes('administrative_area_level_1'))?.short_name || '',
          zip: getComponent('postal_code'),
          county: getComponent('administrative_area_level_2'),
        },
      };
    } catch (error) {
      this.logger.error(`Reverse geocoding error: ${error}`);
      return null;
    }
  }
}
