// Serviço para integração com Google APIs usando fetch requests

import { GoogleAPIConfig } from '../types/interfaces.ts';

export class GoogleAPIsService {
  private config: GoogleAPIConfig;
  
  constructor(config?: Partial<GoogleAPIConfig>) {
    this.config = {
      apiKey: Deno.env.get('GOOGLE_MAPS_API_KEY') || '',
      timeout: 10000,
      retries: 3,
      ...config
    };
  }
  
  get apiKey(): string {
    return this.config.apiKey;
  }
  
  /**
   * Buscar lugares próximos usando Google Places API
   */
  async searchPlacesNearby(params: {
    location: { lat: number; lng: number };
    radius: number;
    type?: string;
    name?: string;
  }) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.set('location', `${params.location.lat},${params.location.lng}`);
      url.searchParams.set('radius', params.radius.toString());
      url.searchParams.set('key', this.apiKey);
      
      if (params.type) {
        url.searchParams.set('type', params.type);
      }
      if (params.name) {
        url.searchParams.set('name', params.name);
      }
      
      const response = await fetch(url.toString());
      const data = await response.json();
      
      return {
        success: data.status === 'OK',
        data,
        error: data.status !== 'OK' ? data.error_message : null
      };
    } catch (error) {
      console.error('Google Places API error:', error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Buscar detalhes de um lugar específico
   */
  async getPlaceDetails(placeId: string, fields: string[] = ['geometry', 'name', 'types']) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      url.searchParams.set('place_id', placeId);
      url.searchParams.set('fields', fields.join(','));
      url.searchParams.set('key', this.apiKey);
      
      const response = await fetch(url.toString());
      const data = await response.json();
      
      return {
        success: data.status === 'OK',
        data,
        error: data.status !== 'OK' ? data.error_message : null
      };
    } catch (error) {
      console.error('Google Place Details API error:', error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  
  /**
   * Buscar metadados do Street View
   */
  async getStreetViewMetadata(params: {
    location: { lat: number; lng: number };
    heading?: number;
    pitch?: number;
  }) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
      url.searchParams.set('location', `${params.location.lat},${params.location.lng}`);
      url.searchParams.set('key', this.apiKey);
      
      if (params.heading !== undefined) {
        url.searchParams.set('heading', params.heading.toString());
      }
      if (params.pitch !== undefined) {
        url.searchParams.set('pitch', params.pitch.toString());
      }
      
      const response = await fetch(url.toString());
      const data = await response.json();
      
      return {
        success: data.status === 'OK',
        data,
        error: data.status !== 'OK' ? data.error_message : null
      };
    } catch (error) {
      console.error('Google Street View API error:', error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Buscar elevação de pontos
   */
  async getElevation(locations: Array<{ lat: number; lng: number }>) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/elevation/json');
      const locationsStr = locations.map(l => `${l.lat},${l.lng}`).join('|');
      url.searchParams.set('locations', locationsStr);
      url.searchParams.set('key', this.apiKey);
      
      const response = await fetch(url.toString());
      const data = await response.json();
      
      return {
        success: data.status === 'OK',
        data,
        error: data.status !== 'OK' ? data.error_message : null
      };
    } catch (error) {
      console.error('Google Elevation API error:', error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Verificar se a API key é válida
   */
  async validateAPIKey(): Promise<boolean> {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('address', 'test');
      url.searchParams.set('key', this.apiKey);
      
      const response = await fetch(url.toString());
      const data = await response.json();
      
      return data.status === 'OK' || data.status === 'ZERO_RESULTS';
    } catch (error) {
      console.error('Google API key validation error:', error);
      return false;
    }
  }
  
  /**
   * Retry com exponential backoff
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.config.retries
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        
        const delay = Math.pow(2, i) * 1000; // Exponential backoff
        await this.sleep(delay);
      }
    }
    throw new Error('Max retries exceeded');
  }
  
  /**
   * Obter Street View Static API
   */
  async getStreetView(params: {
    location: { lat: number; lng: number };
    heading: number;
    pitch: number;
    fov: number;
    size: string;
  }) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/streetview');
      url.searchParams.set('location', `${params.location.lat},${params.location.lng}`);
      url.searchParams.set('heading', params.heading.toString());
      url.searchParams.set('pitch', params.pitch.toString());
      url.searchParams.set('fov', params.fov.toString());
      url.searchParams.set('size', params.size);
      url.searchParams.set('key', this.apiKey);

      const response = await fetch(url.toString());
      
      return {
        success: response.ok,
        data: response.ok ? { 
          url: url.toString(),
          imageData: response.ok ? await response.blob() : null
        } : null,
        error: !response.ok ? `HTTP ${response.status}` : null
      };
    } catch (error) {
      console.error('Google Street View API error:', error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
