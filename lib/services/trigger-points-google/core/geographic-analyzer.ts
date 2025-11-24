// Analisador de contexto geográfico automático

import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, GeographicContext, BoundaryData } from '../types/interfaces';
import { calculateVariance, generateCircleSamplePoints, calculateBearing, calculateDistance } from '../utils/calculations';

export class GeographicContextAnalyzer {
  private googleAPIs: GoogleAPIsService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }
  
  /**
   * Analisa o contexto geográfico de um POI automaticamente
   */
  async analyzeGeographicContext(poiData: POIData, boundary?: BoundaryData): Promise<GeographicContext> {
    console.log(`🌍 Analyzing geographic context for: ${poiData.name}`);
    
    // USAR BOUNDARY COMPLETO quando disponível, senão usar center ou poiData.location
    const analysisPoint = boundary?.center || poiData.location;
    console.log(`📍 Using ${boundary ? 'boundary.center (from full boundary)' : 'poiData.location'} for geographic analysis`);
    
    try {
      // Análise paralela de diferentes aspectos
      // 🆕 Passar boundary para calculateUrbanDensity para fallback OSM
      const [urbanDensity, elevationContext, streetPattern, infrastructure] = await Promise.all([
        this.calculateUrbanDensity(analysisPoint, boundary),
        this.analyzeElevation(analysisPoint),
        this.analyzeStreetPattern(analysisPoint),
        this.analyzeInfrastructure(analysisPoint)
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
   * NOVO: Fallback usando dados OSM quando Google Places retorna 0
   */
  private async calculateUrbanDensity(location: { lat: number; lng: number }, boundary?: BoundaryData) {
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
      
      // 🆕 FALLBACK: Se Google Places retornou 0, usar dados do OSM (boundary detection)
      if (totalEstablishments === 0 && boundary) {
        console.log(`🔄 Google Places returned 0 establishments, using OSM fallback...`);
        const osmDensity = this.calculateUrbanDensityFromOSM(boundary, location);
        if (osmDensity) {
          console.log(`✅ OSM fallback: ${osmDensity.level} (${osmDensity.score})`);
          return osmDensity;
        }
      }
      
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
   * 🆕 Calcula densidade urbana usando dados do OSM (fallback quando Google Places retorna 0)
   * Usa dados já obtidos do boundary detection (buildings, streets)
   */
  private calculateUrbanDensityFromOSM(boundary: BoundaryData, location: { lat: number; lng: number }): { level: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural'; score: number } | null {
    try {
      // Usar dados já obtidos do boundary detection
      const buildingCount = boundary.buildings?.length || 0;
      const streetCount = boundary.streets?.length || 0;
      const surroundingBuildingCount = boundary.surroundingHeight?.buildingCount || 0;
      
      // Calcular score baseado em prédios encontrados
      // Área de análise: raio de 500m = ~0.785 km²
      const analysisAreaKm2 = Math.PI * Math.pow(0.5, 2); // 0.785 km²
      
      // Contar total de prédios (boundary + surrounding)
      const totalBuildings = buildingCount + surroundingBuildingCount;
      const buildingDensity = totalBuildings / analysisAreaKm2;
      
      console.log(`🏗️ OSM fallback analysis:`);
      console.log(`   Buildings in boundary: ${buildingCount}`);
      console.log(`   Surrounding buildings: ${surroundingBuildingCount}`);
      console.log(`   Streets found: ${streetCount}`);
      console.log(`   Total buildings: ${totalBuildings}`);
      console.log(`   Building density: ${buildingDensity.toFixed(1)}/km²`);
      
      // Classificar baseado em densidade de prédios (thresholds ajustados para OSM)
      // OSM geralmente tem menos dados que Google Places, então thresholds são mais baixos
      let level: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural';
      let score: number;
      
      if (buildingDensity > 200 || totalBuildings > 50 || streetCount > 15) {
        // Muitos prédios e ruas = área muito densa
        level = 'very_dense';
        score = 0.85;
      } else if (buildingDensity > 100 || totalBuildings > 25 || streetCount > 10) {
        // Muitos prédios = área densa
        level = 'dense';
        score = 0.7;
      } else if (buildingDensity > 50 || totalBuildings > 10 || streetCount > 5) {
        // Prédios moderados = área média
        level = 'medium';
        score = 0.5;
      } else if (buildingDensity > 10 || totalBuildings > 3 || streetCount > 2) {
        // Poucos prédios = área baixa
        level = 'low';
        score = 0.3;
      } else {
        // Muito poucos prédios = área rural
        level = 'rural';
        score = 0.1;
      }
      
      return { level, score };
    } catch (error) {
      console.warn('Error calculating urban density from OSM:', error);
      return null;
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
   * Analisa o padrão de ruas usando OSM (sem Google Roads API)
   */
  private async analyzeStreetPattern(location: { lat: number; lng: number }) {
    try {
      // 🔴 REMOVED: Google Roads API usage (M0 - economia)
      // Usar análise OSM para determinar padrão de ruas
      
      // Query OSM para buscar ruas na área
      const query = `
[out:json][timeout:15];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"](around:2000,${location.lat},${location.lng});
);
out geom;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' }
      });
      
      if (!response.ok) {
        return { type: 'mixed' as const, confidence: 0.5 };
      }
      
      const data = await response.json();
      const roads = data.elements || [];
      
      if (roads.length < 3) {
        return { type: 'mixed' as const, confidence: 0.3 };
      }
      
      // Analisar ângulos das ruas usando dados OSM
      const angles = this.calculateStreetAnglesFromOSM(roads);
      const angleVariance = calculateVariance(angles);
      
      // Analisar tamanho dos blocos usando dados OSM
      const distances = this.calculateBlockSizesFromOSM(roads);
      const averageBlockSize = distances.length > 0 ? distances.reduce((sum, dist) => sum + dist, 0) / distances.length : 100;
      
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
      const bearing1 = calculateBearing(prev, curr);
      const bearing2 = calculateBearing(curr, next);
      
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
      const distance = calculateDistance(points[i].location, points[i + 1].location);
      distances.push(distance);
    }
    
    return distances;
  }

  /**
   * Calcula ângulos das ruas usando dados OSM
   */
  private calculateStreetAnglesFromOSM(roads: any[]): number[] {
    const angles: number[] = [];
    
    for (const road of roads) {
      if (road.geometry && road.geometry.length >= 2) {
        // Calcular bearing da rua (direção geral)
        const start = road.geometry[0];
        const end = road.geometry[road.geometry.length - 1];
        const bearing = calculateBearing(
          { lat: start.lat, lng: start.lon },
          { lat: end.lat, lng: end.lon }
        );
        angles.push(bearing);
      }
    }
    
    return angles;
  }

  /**
   * Calcula tamanhos de blocos usando dados OSM
   */
  private calculateBlockSizesFromOSM(roads: any[]): number[] {
    const distances: number[] = [];
    
    for (const road of roads) {
      if (road.geometry && road.geometry.length >= 2) {
        // Calcular comprimento da rua
        let totalLength = 0;
        for (let i = 0; i < road.geometry.length - 1; i++) {
          const distance = calculateDistance(
            { lat: road.geometry[i].lat, lng: road.geometry[i].lon },
            { lat: road.geometry[i + 1].lat, lng: road.geometry[i + 1].lon }
          );
          totalLength += distance;
        }
        distances.push(totalLength);
      }
    }
    
    return distances;
  }
  
  // Usar função existente do utils/calculations.ts (DRY)
  
  // Usar função existente do utils/calculations.ts (DRY)
  
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
