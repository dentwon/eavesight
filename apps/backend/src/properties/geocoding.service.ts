import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface GeocodingResult {
  lat: number;
  lon: number;
  formattedAddress: string;
  placeId: string;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_GEOCODING_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_GEOCODING_API_KEY not set');
    }
  }

  async geocode(address: string): Promise<GeocodingResult | null> {
    if (!this.apiKey) return null;
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address, key: this.apiKey },
        timeout: 10000,
      });
      const data = response.data as any;
      if (data.status === 'OK' && data.results?.length > 0) {
        const result = data.results[0];
        return {
          lat: result.geometry.location.lat,
          lon: result.geometry.location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
        };
      }
      return null;
    } catch (error: any) {
      this.logger.error(`Geocoding error: ${error.message}`);
      return null;
    }
  }

  async reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null> {
    if (!this.apiKey) return null;
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { latlng: `${lat},${lon}`, key: this.apiKey },
        timeout: 10000,
      });
      const data = response.data as any;
      if (data.status === 'OK' && data.results?.length > 0) {
        const result = data.results[0];
        return {
          lat,
          lon,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
        };
      }
      return null;
    } catch (error: any) {
      this.logger.error(`Reverse geocoding error: ${error.message}`);
      return null;
    }
  }
}
