// Analisador de contexto geográfico automático
// REMOVIDO: Dependência do Google Places API - usando apenas OSM e valores padrão

import { POIData, GeographicContext, BoundaryData } from '../types/interfaces';
import { calculateVariance, calculateBearing, calculateDistance } from '../utils/calculations';

export class GeographicContextAnalyzer {
  constructor() {
    // GoogleAPIsService removido - não é mais necessário
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
   * Calcula a densidade urbana usando apenas dados OSM
   * REMOVIDO: Google Places API - usando apenas OSM (boundary detection)
   */
  private async calculateUrbanDensity(location: { lat: number; lng: number }, boundary?: BoundaryData) {
    try {
      console.log(`🏙️ Calculating urban density for: ${location.lat}, ${location.lng} (OSM only)`);
      
      // Usar dados OSM diretamente (boundary detection já fornece buildings e streets)
      if (boundary) {
        const osmDensity = this.calculateUrbanDensityFromOSM(boundary, location);
        if (osmDensity) {
          console.log(`✅ OSM density: ${osmDensity.level} (${osmDensity.score})`);
          return osmDensity;
        }
      }
      
      // Se não houver boundary, retornar classificação padrão
      console.log(`⚠️ No boundary data available, using default medium density`);
      return { level: 'medium' as const, score: 0.5 };
      
    } catch (error) {
      console.warn('Error calculating urban density:', error);
      return { level: 'medium' as const, score: 0.5 };
    }
  }
  
  /**
   * Calcula densidade urbana usando dados do OSM
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
   * REMOVIDO: Google Elevation API - retorna valores padrão
   */
  private async analyzeElevation(location: { lat: number; lng: number }) {
    // REMOVIDO: Google Elevation API
    // Retornar valores padrão (flat) - análise de elevação não é crítica para trigger points
    console.log(`⛰️ Elevation analysis: using default (flat) - Google Elevation API removed`);
    return { type: 'flat' as const, variance: 0 };
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
   * REMOVIDO: Google Places API - retorna valores padrão
   */
  private async analyzeInfrastructure(location: { lat: number; lng: number }) {
    // REMOVIDO: Google Places API
    // Retornar valores padrão - análise de infraestrutura não é crítica para trigger points
    console.log(`🏗️ Infrastructure analysis: using default values - Google Places API removed`);
    return {
      transitTypes: [],
      parkingAvailability: 0,
      infrastructureDensity: 0
    };
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
