// Analisador de contexto geográfico automático
// REMOVIDO: Dependência do Google Places API - usando apenas OSM e valores padrão

import { POIData, GeographicContext, BoundaryData } from '../types/interfaces';
import { calculateVariance, calculateBearing, calculateDistance } from '../utils/calculations';
import { ElevationAnalysisService } from '../services/elevation-service';

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
        this.analyzeElevation(analysisPoint, undefined, poiData),
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
   * IMPORTANTE: Filtra por distância fixa (500m) para evitar distorções de buscas expandidas
   */
  private calculateUrbanDensityFromOSM(boundary: BoundaryData, location: { lat: number; lng: number }): { level: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural'; score: number } | null {
    try {
      // ✅ FIX: Filtrar ruas e buildings por distância fixa (500m) antes de calcular densidade
      // Isso evita distorções quando há buscas expandidas (ex: Pico do Jaraguá com 3800m de raio)
      const DENSITY_ANALYSIS_RADIUS = 500; // metros - raio fixo para análise de densidade
      
      // Filtrar buildings dentro de 500m
      const nearbyBuildings = (boundary.buildings || []).filter((building, index) => {
        if (!building.geometry) return false;
        
        // 🔍 DEBUG DIAGNOSTICO: Inspecionar o primeiro building para entender a estrutura
        /*if (index === 0) {
          console.log(`🔍 [DEBUG] First building structure inspection:`);
          console.log(`   ID: ${building.id}`);
          console.log(`   Geometry Type: ${Array.isArray(building.geometry) ? 'Array' : typeof building.geometry}`);
          console.log(`   Sample Geometry: ${JSON.stringify(building.geometry).substring(0, 200)}...`);
          const center = this.getBuildingCenter(building);
          console.log(`   Calculated Center: ${center.lat}, ${center.lng}`);
          console.log(`   Distance to POI: ${calculateDistance(location, center).toFixed(2)}m`);
        }*/

        // Calcular distância do centro do building ao POI
        const buildingCenter = this.getBuildingCenter(building);
        const distance = calculateDistance(location, buildingCenter);
        return distance <= DENSITY_ANALYSIS_RADIUS;
      });
      
      // Filtrar streets dentro de 500m (verificar se pelo menos um ponto da rua está dentro do raio)
      const nearbyStreets = (boundary.streets || []).filter(street => {
        if (!street.coordinates || street.coordinates.length === 0) return false;
        // Verificar se pelo menos um ponto da rua está dentro de 500m
        return street.coordinates.some(point => {
          const distance = calculateDistance(location, point);
          return distance <= DENSITY_ANALYSIS_RADIUS;
        });
      });
      
      const buildingCount = nearbyBuildings.length;
      const streetCount = nearbyStreets.length;
      const surroundingBuildingCount = boundary.surroundingHeight?.buildingCount || 0;
      
      // Calcular score baseado em prédios encontrados
      // Área de análise: raio de 500m = ~0.785 km²
      const analysisAreaKm2 = Math.PI * Math.pow(0.5, 2); // 0.785 km²
      
      // Contar total de prédios (boundary + surrounding)
      // Nota: surroundingBuildingCount já pode estar filtrado, mas mantemos para compatibilidade
      const totalBuildings = buildingCount + surroundingBuildingCount;
      const buildingDensity = totalBuildings / analysisAreaKm2;
      
      console.log(`🏗️ OSM fallback analysis (filtered by ${DENSITY_ANALYSIS_RADIUS}m radius):`);
      console.log(`   Total buildings in boundary: ${boundary.buildings?.length || 0} → Nearby (${DENSITY_ANALYSIS_RADIUS}m): ${buildingCount}`);
      console.log(`   Total streets in boundary: ${boundary.streets?.length || 0} → Nearby (${DENSITY_ANALYSIS_RADIUS}m): ${streetCount}`);
      console.log(`   Surrounding buildings: ${surroundingBuildingCount}`);
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
        console.log(`   ✅ Classified as VERY_DENSE (density: ${buildingDensity.toFixed(1)}/km², buildings: ${totalBuildings}, streets: ${streetCount})`);
      } else if (buildingDensity > 100 || totalBuildings > 25 || streetCount > 10) {
        // Muitos prédios = área densa
        level = 'dense';
        score = 0.7;
        console.log(`   ✅ Classified as DENSE (density: ${buildingDensity.toFixed(1)}/km², buildings: ${totalBuildings}, streets: ${streetCount})`);
      } else if (buildingDensity > 50 || totalBuildings > 10 || streetCount > 5) {
        // Prédios moderados = área média
        level = 'medium';
        score = 0.5;
        console.log(`   ⚠️ Classified as MEDIUM (density: ${buildingDensity.toFixed(1)}/km², buildings: ${totalBuildings}, streets: ${streetCount})`);
        console.log(`      ⚠️ For CANYON classification, need DENSE or VERY_DENSE`);
      } else if (buildingDensity > 10 || totalBuildings > 3 || streetCount > 2) {
        // Poucos prédios = área baixa
        level = 'low';
        score = 0.3;
        console.log(`   ⚠️ Classified as LOW (density: ${buildingDensity.toFixed(1)}/km², buildings: ${totalBuildings}, streets: ${streetCount})`);
      } else {
        // Muito poucos prédios = área rural
        level = 'rural';
        score = 0.1;
        console.log(`   ⚠️ Classified as RURAL (density: ${buildingDensity.toFixed(1)}/km², buildings: ${totalBuildings}, streets: ${streetCount})`);
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
  private async analyzeElevation(location: { lat: number; lng: number }, context?: GeographicContext, poiData?: POIData) {
    try {
      console.log(`⛰️ Analyzing elevation for: ${location.lat}, ${location.lng}`);
      
      // Usar o serviço centralizado para estimar a elevação base regional
      // Nota: o context passado aqui ainda está sendo construído, então passamos o que temos
      const baseElevation = await ElevationAnalysisService.estimateRegionalBaseElevation(
        location, 
        context || this.getDefaultContext(), 
        poiData
      );
      
      // Buscar elevação real do ponto (via Open Elevation, que é free)
      const url = `https://api.open-elevation.com/api/v1/lookup?locations=${location.lat},${location.lng}`;
      const response = await fetch(url);
      const data = await response.json();
      const poiElevation = data.results?.[0]?.elevation || baseElevation;
      
      const elevationDiff = poiElevation - baseElevation;
      
      // Classificar baseado na diferença
      let type: 'flat' | 'mountainous' | 'hilly' = 'flat';
      if (elevationDiff > 200) type = 'mountainous';
      else if (elevationDiff > 50) type = 'hilly';
      
      console.log(`✅ Elevation analysis: ${type} (base: ${baseElevation}m, poi: ${poiElevation}m, diff: ${elevationDiff}m)`);
      
      return { 
        type, 
        variance: Math.abs(elevationDiff),
        baseElevation,
        poiElevation
      };
    } catch (error) {
      console.warn('⚠️ Elevation analysis failed, using default (flat):', error);
      return { type: 'flat' as const, variance: 0, baseElevation: 500, poiElevation: 500 };
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
        headers: { 
          'Content-Type': 'text/plain',
          'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)'
        }
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
  
  /**
   * Calcula o centro (centroid) de um building para análise de distância
   * Similar a calculateBuildingCentroid em street-analyzer.ts
   */
  private getBuildingCenter(building: any): { lat: number; lng: number } {
    // Caso 1: Array direto de pontos (formato OSMDataFetcher)
    if (Array.isArray(building.geometry)) {
       const coords = building.geometry;
       if (coords.length > 0) {
         // Check if it's array of objects {lat, lon/lng}
         if (typeof coords[0] === 'object' && ('lat' in coords[0])) {
           let sumLat = 0;
           let sumLng = 0;
           for (const p of coords) {
             sumLat += p.lat;
             sumLng += (p.lng || p.lon);
           }
           return {
             lat: sumLat / coords.length,
             lng: sumLng / coords.length
           };
         }
       }
    }

    // Caso 2: GeoJSON style (geometry.coordinates)
    if (building.geometry && building.geometry.coordinates) {
      const coords = building.geometry.coordinates;
      
      // Se é array de arrays (polygon)
      if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
        // Pegar primeiro ring do polygon
        const ring = coords[0];
        let sumLat = 0;
        let sumLng = 0;
        let count = 0;
        
        for (const coord of ring) {
          // OSM usa [lng, lat]
          const lng = coord[0];
          const lat = coord[1];
          sumLat += lat;
          sumLng += lng;
          count++;
        }
        
        if (count > 0) {
          return {
            lat: sumLat / count,
            lng: sumLng / count
          };
        }
      }
      
      // Se é array simples de coordenadas (LineString/Point)
      if (Array.isArray(coords[0]) && typeof coords[0] === 'number') {
         // Point [lng, lat]
         return { lat: coords[1], lng: coords[0] };
      }
      
      // Array de coordinates
      if (Array.isArray(coords[0]) && !Array.isArray(coords[0][0])) {
        let sumLat = 0;
        let sumLng = 0;
        
        for (const coord of coords) {
          const lng = coord[0];
          const lat = coord[1];
          sumLat += lat;
          sumLng += lng;
        }
        
        return {
          lat: sumLat / coords.length,
          lng: sumLng / coords.length
        };
      }
    }
    
    // Fallback: usar lat/lng direto se disponível na raiz
    return { lat: building.lat || 0, lng: building.lon || building.lng || 0 };
  }
}
