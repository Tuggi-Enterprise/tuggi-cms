// Analisador de contexto geográfico automático

import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, GeographicContext } from '../types/interfaces';
import { calculateVariance, generateCircleSamplePoints } from '../utils/calculations';

export class GeographicContextAnalyzer {
  private googleAPIs: GoogleAPIsService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }
  
  /**
   * Analisa o contexto geográfico de um POI automaticamente
   */
  async analyzeGeographicContext(poiData: POIData): Promise<GeographicContext> {
    console.log(`🌍 Analyzing geographic context for: ${poiData.name}`);
    
    try {
      // Análise paralela de diferentes aspectos
      const [urbanDensity, elevationContext, streetPattern, infrastructure] = await Promise.all([
        this.calculateUrbanDensity(poiData.location),
        this.analyzeElevation(poiData.location),
        this.analyzeStreetPattern(poiData.location),
        this.analyzeInfrastructure(poiData.location)
      ]);
      
      const context: GeographicContext = {
        urbanDensity,
        elevationContext,
        streetPattern,
        infrastructure,
        region: 'auto_detected'
      };
      
      console.log(`✅ Geographic context analyzed:`, {
        urbanDensity: context.urbanDensity.level,
        elevation: context.elevationContext.type,
        streetPattern: context.streetPattern.type
      });
      
      return context;
    } catch (error) {
      console.error('Error analyzing geographic context:', error);
      
      // Retornar contexto padrão em caso de erro
      return this.getDefaultContext();
    }
  }
  
  /**
   * Calcula a densidade urbana automaticamente
   */
  private async calculateUrbanDensity(location: { lat: number; lng: number }) {
    try {
      console.log(`🏙️ Calculating urban density for: ${location.lat}, ${location.lng}`);
      
      // Buscar múltiplos tipos de estabelecimentos em raio de 500m
      const [businessResponse, transitResponse, residentialResponse] = await Promise.all([
        this.googleAPIs.searchPlacesNearby({
          location,
          radius: 500,
          type: 'store'
        }),
        this.googleAPIs.searchPlacesNearby({
          location,
          radius: 500,
          type: 'transit_station'
        }),
        this.googleAPIs.searchPlacesNearby({
          location,
          radius: 1000,
          type: 'establishment'
        })
      ]);
      
      // Contar diferentes tipos de estabelecimentos
      const businessCount = businessResponse.data?.results?.length || 0;
      const transitCount = transitResponse.data?.results?.length || 0;
      const totalEstablishments = residentialResponse.data?.results?.length || 0;
      
      // Calcular densidade por km² (área = π * r²)
      const areaKm2 = Math.PI * Math.pow(1.0, 2); // 1km radius = 3.14 km²
      const density = totalEstablishments / areaKm2;
      
      console.log(`📊 Urban density analysis: ${totalEstablishments} establishments in ${areaKm2.toFixed(2)}km² = ${density.toFixed(1)}/km²`);
      console.log(`🏪 Business: ${businessCount}, 🚇 Transit: ${transitCount}, 🏢 Total: ${totalEstablishments}`);
      
      // Classificar densidade com thresholds ajustados para realidade brasileira
      let level: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural';
      let score: number;
      
      if (density > 400 || businessCount > 15) { // Centro de SP, RJ
        level = 'very_dense';
        score = 0.9;
      } else if (density > 200 || businessCount > 10) { // Bairros centrais
        level = 'dense';
        score = 0.7;
      } else if (density > 80 || businessCount > 5) { // Bairros residenciais
        level = 'medium';
        score = 0.5;
      } else if (density > 20 || businessCount > 2) { // Periferia
        level = 'low';
        score = 0.3;
      } else { // Área rural
        level = 'rural';
        score = 0.1;
      }
      
      console.log(`✅ Urban density classified as: ${level} (score: ${score})`);
      return { level, score };
      
    } catch (error) {
      console.warn('Error calculating urban density:', error);
      return { level: 'medium' as const, score: 0.5 };
    }
  }
  
  /**
   * Analisa o contexto de elevação
   */
  private async analyzeElevation(location: { lat: number; lng: number }) {
    try {
      // Buscar elevação em múltiplos pontos em raio de 5km
      const elevationPoints = generateCircleSamplePoints(location, 5000, 20);
      
      const elevationResponse = await this.googleAPIs.getElevation(elevationPoints);
      
      if (!elevationResponse.success || !elevationResponse.data) {
        return { type: 'flat' as const, variance: 0 };
      }
      
      const elevations = elevationResponse.data.results?.map((r: any) => r.elevation) || [];
      const variance = calculateVariance(elevations);
      
      // Classificar baseado na variância
      if (variance > 200) {
        return { type: 'mountainous' as const, variance };
      } else if (variance > 50) {
        return { type: 'hilly' as const, variance };
      } else {
        return { type: 'flat' as const, variance };
      }
    } catch (error) {
      console.warn('Error analyzing elevation:', error);
      return { type: 'flat' as const, variance: 0 };
    }
  }
  
  /**
   * Analisa o padrão de ruas
   */
  private async analyzeStreetPattern(location: { lat: number; lng: number }) {
    try {
      // Gerar pontos em círculo para analisar padrão de ruas
      const searchPoints = generateCircleSamplePoints(location, 2000, 16);
      
      const roadsResponse = await this.googleAPIs.snapToRoads(searchPoints);
      
      if (!roadsResponse.success || !roadsResponse.data) {
        return { type: 'mixed' as const, confidence: 0.5 };
      }
      
      const snappedPoints = roadsResponse.data.snappedPoints || [];
      
      if (snappedPoints.length < 3) {
        return { type: 'mixed' as const, confidence: 0.3 };
      }
      
      // Analisar ângulos das ruas
      const angles = this.calculateStreetAngles(snappedPoints);
      const angleVariance = calculateVariance(angles);
      
      // Analisar tamanho dos blocos (distância entre pontos)
      const distances = this.calculateBlockSizes(snappedPoints);
      const averageBlockSize = distances.reduce((sum, dist) => sum + dist, 0) / distances.length;
      
      // Classificar padrão baseado na análise
      if (angleVariance < 10 && averageBlockSize > 150) {
        return { type: 'grid' as const, confidence: 0.9 };
      } else if (angleVariance > 30 && averageBlockSize < 100) {
        return { type: 'organic' as const, confidence: 0.9 };
      } else if (angleVariance < 20 && averageBlockSize > 100) {
        return { type: 'boulevard' as const, confidence: 0.7 };
      } else {
        return { type: 'mixed' as const, confidence: 0.5 };
      }
    } catch (error) {
      console.warn('Error analyzing street pattern:', error);
      return { type: 'mixed' as const, confidence: 0.5 };
    }
  }
  
  /**
   * Analisa a infraestrutura local
   */
  private async analyzeInfrastructure(location: { lat: number; lng: number }) {
    try {
      // Buscar diferentes tipos de infraestrutura
      const [transitResponse, parkingResponse] = await Promise.all([
        this.googleAPIs.searchPlacesNearby({
          location,
          radius: 1000,
          type: 'transit_station'
        }),
        this.googleAPIs.searchPlacesNearby({
          location,
          radius: 1000,
          type: 'parking'
        })
      ]);
      
      const transitTypes: string[] = [];
      let parkingAvailability = 0;
      let infrastructureDensity = 0;
      
      // Analisar tipos de transporte público
      if (transitResponse.success && transitResponse.data?.results) {
        transitResponse.data.results.forEach((place: any) => {
          if (place.types) {
            place.types.forEach((type: any) => {
              if (['subway_station', 'bus_station', 'train_station', 'airport'].includes(type)) {
                if (!transitTypes.includes(type)) {
                  transitTypes.push(type);
                }
              }
            });
          }
        });
      }
      
      // Calcular disponibilidade de estacionamento
      if (parkingResponse.success && parkingResponse.data?.results) {
        parkingAvailability = Math.min(parkingResponse.data.results.length / 10, 1); // Normalizar para 0-1
      }
      
      // Calcular densidade de infraestrutura
      infrastructureDensity = (transitTypes.length * 2) + (parkingAvailability * 5);
      
      return {
        transitTypes,
        parkingAvailability,
        infrastructureDensity
      };
    } catch (error) {
      console.warn('Error analyzing infrastructure:', error);
      return {
        transitTypes: [],
        parkingAvailability: 0,
        infrastructureDensity: 0
      };
    }
  }
  
  /**
   * Calcula ângulos das ruas
   */
  private calculateStreetAngles(points: Array<{ location: { lat: number; lng: number } }>): number[] {
    const angles: number[] = [];
    
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1].location;
      const curr = points[i].location;
      const next = points[i + 1].location;
      
      // Calcular bearing entre pontos
      const bearing1 = this.calculateBearing(prev, curr);
      const bearing2 = this.calculateBearing(curr, next);
      
      // Calcular diferença de ângulo
      let angleDiff = Math.abs(bearing2 - bearing1);
      if (angleDiff > 180) {
        angleDiff = 360 - angleDiff;
      }
      
      angles.push(angleDiff);
    }
    
    return angles;
  }
  
  /**
   * Calcula tamanhos dos blocos
   */
  private calculateBlockSizes(points: Array<{ location: { lat: number; lng: number } }>): number[] {
    const distances: number[] = [];
    
    for (let i = 0; i < points.length - 1; i++) {
      const distance = this.calculateDistance(points[i].location, points[i + 1].location);
      distances.push(distance);
    }
    
    return distances;
  }
  
  /**
   * Calcula bearing entre dois pontos
   */
  private calculateBearing(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): number {
    const dLng = (to.lng - from.lng) * Math.PI / 180;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  }
  
  /**
   * Calcula distância entre dois pontos
   */
  private calculateDistance(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): number {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }
  
  /**
   * Retorna contexto padrão em caso de erro
   */
  private getDefaultContext(): GeographicContext {
    return {
      urbanDensity: { level: 'medium', score: 0.5 },
      elevationContext: { type: 'flat', variance: 0 },
      streetPattern: { type: 'mixed', confidence: 0.5 },
      infrastructure: {
        transitTypes: [],
        parkingAvailability: 0.5,
        infrastructureDensity: 5
      },
      region: 'auto_detected'
    };
  }
}
