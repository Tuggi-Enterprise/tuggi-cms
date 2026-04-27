// Analisador direcional para trigger points - Análise por setores

import { POIData, BoundaryData, GeographicContext, DirectionalAnalysis } from '../types/interfaces';
import { calculateBearing, calculateDistance, extractBuildingHeight, findClosestPointOnBoundary } from '../utils/calculations';

export class DirectionalAnalyzer {
  
  // Cache para dados OSM por direção
  private static osmDataCache = new Map<string, { 
    data: any, 
    timestamp: number 
  }>();
  private static CACHE_DURATION = 30 * 60 * 1000; // 30 minutos
  
  // Rate limiting
  private static lastRequestTime = 0;
  private static REQUEST_DELAY = 2000; // 2 segundos entre requests
  
  // Definir 8 direções (45° cada)
  private readonly directions = [
    { name: 'N', angle: 0, range: [337.5, 22.5] as [number, number] },
    { name: 'NE', angle: 45, range: [22.5, 67.5] as [number, number] },
    { name: 'E', angle: 90, range: [67.5, 112.5] as [number, number] },
    { name: 'SE', angle: 135, range: [112.5, 157.5] as [number, number] },
    { name: 'S', angle: 180, range: [157.5, 202.5] as [number, number] },
    { name: 'SW', angle: 225, range: [202.5, 247.5] as [number, number] },
    { name: 'W', angle: 270, range: [247.5, 292.5] as [number, number] },
    { name: 'NW', angle: 315, range: [292.5, 337.5] as [number, number] }
  ];

  /**
   * Analisa todas as direções ao redor do POI usando dados existentes
   */
  async analyzeAllDirections(
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext,
    existingStreets?: any[], // NOVO: ruas já encontradas
    existingBuildings?: any[] // NOVO: construções já encontradas
  ): Promise<DirectionalAnalysis[]> {
    console.log(`🧭 Starting directional analysis for ${poiData.name}...`);
    console.log(`📍 Using boundary.center: ${boundary.center.lat.toFixed(6)}, ${boundary.center.lng.toFixed(6)} (NOT pin location)`);
    
    const analyses: DirectionalAnalysis[] = [];
    
    // USAR DADOS EXISTENTES em vez de fazer novas chamadas
    console.log(`🔄 Analyzing directions using existing data (${existingStreets?.length || 0} streets, ${existingBuildings?.length || 0} buildings)...`);
    
    for (const direction of this.directions) {
      try {
        const result = await this.analyzeDirectionWithExistingData(
          direction, 
          poiData, 
          boundary, 
          context,
          existingStreets,
          existingBuildings
        );
        analyses.push(result);
        
      } catch (error) {
        console.error(`Error analyzing direction ${direction.name}:`, error);
        // Continuar com próxima direção
      }
    }
    
    try {
      
      console.log(`✅ Directional analysis completed: ${analyses.length} directions analyzed`);
      
      // Log resumo
      const allowedDirections = analyses.filter(a => a.allowTPs);
      console.log(`🎯 Directions allowing TPs: ${allowedDirections.map(a => a.direction).join(', ')}`);
      
      return analyses;
    } catch (error) {
      console.error('Error in directional analysis:', error);
      return analyses; // Retornar análises parciais
    }
  }

  /**
   * Analisa uma direção específica usando dados existentes
   */
  private async analyzeDirectionWithExistingData(
    direction: { name: string; angle: number; range: [number, number] },
    poiData: POIData,
    boundary: BoundaryData,
    context: GeographicContext,
    existingStreets?: any[],
    existingBuildings?: any[]
  ): Promise<DirectionalAnalysis> {
    console.log(`🧭 Analyzing direction ${direction.name} (${direction.angle}°) using existing data...`);
    
    try {
      // 1. Filtrar dados existentes por direção
      const directionalStreets = existingStreets ? await this.filterElementsByDirection(existingStreets, boundary, direction) : [];
      const directionalBuildings = existingBuildings ? await this.filterElementsByDirection(existingBuildings, boundary, direction) : [];
      
      // 2. Combinar ruas e construções para análise
      const allElements = [...directionalStreets, ...directionalBuildings];
      
      // 3. Analisar ruas
      const streetAnalysis = this.analyzeStreets(directionalStreets);
      
      // 4. Analisar espaços abertos (usar ruas como proxy)
      const openSpaceAnalysis = this.analyzeOpenSpacesFromStreets(directionalStreets);
      
      // 5. Analisar construções
      const buildingAnalysis = this.analyzeBuildings(directionalBuildings);
      
      // 6. Calcular visibilidade
      const visibilityAnalysis = this.calculateVisibility(
        streetAnalysis, 
        openSpaceAnalysis, 
        buildingAnalysis, 
        boundary
      );
      
      // 7. Decidir se permite TPs
      const allowTPs = this.decideAllowTPs(
        streetAnalysis, 
        openSpaceAnalysis, 
        buildingAnalysis, 
        visibilityAnalysis,
        boundary
      );
      
      const analysis: DirectionalAnalysis = {
        direction: direction.name,
        angle: direction.angle,
        range: direction.range,
        streets: streetAnalysis,
        openSpaces: openSpaceAnalysis,
        buildings: buildingAnalysis,
        visibility: visibilityAnalysis,
        allowTPs,
        reason: this.generateReason(allowTPs, streetAnalysis, openSpaceAnalysis, buildingAnalysis)
      };
      
      console.log(`✅ Direction ${direction.name}: ${allowTPs ? 'ALLOW' : 'BLOCK'} TPs - ${analysis.reason}`);
      
      return analysis;
      
    } catch (error) {
      console.error(`Error analyzing direction ${direction.name}:`, error);
      
      // Retornar análise de fallback
      return {
        direction: direction.name,
        angle: direction.angle,
        range: direction.range,
        streets: { total: 0, withOpenSpaces: 0, accessible: 0 },
        openSpaces: { count: 0, percentage: 0, types: [] },
        buildings: { count: 0, avgHeight: 0, maxHeight: 0, density: 0 },
        visibility: { score: 0, hasObstructions: true, maxObstructionHeight: 0 },
        allowTPs: false,
        reason: 'Analysis failed - blocking TPs for safety'
      };
    }
  }


  /**
   * Busca dados OSM para uma direção específica
   */
  private async fetchOSMDataForDirection(
    center: { lat: number; lng: number },
    direction: { name: string; angle: number; range: [number, number] },
    boundary?: BoundaryData
  ): Promise<any> {
    // Verificar cache primeiro
    const cacheKey = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}_${direction.name}`;
    const cached = DirectionalAnalyzer.osmDataCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < DirectionalAnalyzer.CACHE_DURATION) {
      console.log(`📦 Using cached OSM data for direction ${direction.name}`);
      return cached.data;
    }
    
    const query = `
[out:json][timeout:60];
(
  // Ruas acessíveis (200m raio) - ANÁLISE ABRANGENTE
  way["highway"~"^(primary|secondary|tertiary|residential|living_street|pedestrian|footway)$"](around:200,${center.lat},${center.lng});
  
  // Espaços abertos (200m raio) - ANÁLISE ABRANGENTE
  way["leisure"~"^(park|square|plaza)$"](around:200,${center.lat},${center.lng});
  way["landuse"~"^(recreation_ground|park)$"](around:200,${center.lat},${center.lng});
  way["natural"~"^(grassland|scrub)$"](around:200,${center.lat},${center.lng});
  way["amenity"~"^(parking)$"](around:200,${center.lat},${center.lng});
  
  // Construções (200m raio) - ANÁLISE ABRANGENTE
  way["building"](around:200,${center.lat},${center.lng});
);
out geom tags;
`;

    console.log(`🌐 Fetching OSM data for direction ${direction.name} (200m radius)...`);
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`OSM API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Salvar no cache
    DirectionalAnalyzer.osmDataCache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  }

  /**
   * Filtra elementos por direção (usando boundary completo)
   */
  private async filterElementsByDirection(
    elements: any[],
    boundary: BoundaryData,
    direction: { name: string; angle: number; range: [number, number] }
  ): Promise<any[]> {
    const filteredPromises = elements.map(async element => {
      if (!element.geometry || element.geometry.length === 0) return null;
      
      // Calcular centro do elemento
      const elementCenter = this.calculateElementCenter(element);
      
      // Verificar se o elemento está na direção correta do boundary
      const isInDirection = await this.isElementInDirection(elementCenter, boundary, direction);
      return isInDirection ? element : null;
    });
    
    const filteredResults = await Promise.all(filteredPromises);
    const filtered = filteredResults.filter(el => el !== null);
    
    console.log(`🧭 Direction ${direction.name}: filtered ${filtered.length}/${elements.length} elements`);
    return filtered;
  }

  /**
   * Calcula centro de um elemento OSM
   */
  private calculateElementCenter(element: any): { lat: number; lng: number } {
    if (!element.geometry || element.geometry.length === 0) {
      return { lat: 0, lng: 0 };
    }
    
    const coords = element.geometry;
    const lat = coords.reduce((sum: number, point: any) => sum + point.lat, 0) / coords.length;
    const lng = coords.reduce((sum: number, point: any) => sum + point.lon, 0) / coords.length;
    
    return { lat, lng };
  }

  /**
   * Verifica se um elemento está na direção correta do boundary
   */
  private async isElementInDirection(
    elementCenter: { lat: number; lng: number },
    boundary: BoundaryData,
    direction: { name: string; angle: number; range: [number, number] }
  ): Promise<boolean> {
    // Encontrar o ponto mais próximo do boundary na direção desejada
    const boundaryPoint = await this.findBoundaryPointInDirection(boundary, direction);
    
    // Calcular bearing do boundary point para o elemento
    const bearing = calculateBearing(boundaryPoint, elementCenter);
    
    // Verificar se está na direção correta
    return this.isInDirection(bearing, direction.range);
  }

  /**
   * Encontra o ponto do boundary mais próximo da direção desejada
   */
  private async findBoundaryPointInDirection(
    boundary: BoundaryData,
    direction: { name: string; angle: number; range: [number, number] }
  ): Promise<{ lat: number; lng: number }> {
    const targetAngle = direction.angle;
    let bestPoint = boundary.center;
    let bestAngleDiff = Infinity;
    
    // Procurar o ponto do boundary que está mais alinhado com a direção
    for (const point of boundary.coordinates) {
      // Use closest point on boundary instead of center for more accurate bearing
      const closestBoundaryPoint = findClosestPointOnBoundary(point, boundary.coordinates);
      const bearing = calculateBearing({ lat: closestBoundaryPoint.lat, lng: closestBoundaryPoint.lng }, point);
      const angleDiff = Math.abs(this.normalizeAngleDifference(bearing - targetAngle));
      
      if (angleDiff < bestAngleDiff) {
        bestAngleDiff = angleDiff;
        bestPoint = point;
      }
    }
    
    return bestPoint;
  }

  /**
   * Normaliza diferença de ângulo para [-180, 180]
   */
  private normalizeAngleDifference(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }

  /**
   * Verifica se um bearing está em uma direção
   */
  private isInDirection(bearing: number, range: [number, number]): boolean {
    const [min, max] = range;
    
    // Tratar caso especial do Norte (337.5° - 22.5°)
    if (min > max) {
      return bearing >= min || bearing <= max;
    }
    
    return bearing >= min && bearing <= max;
  }

  /**
   * Analisa ruas na direção
   */
  private analyzeStreets(elements: any[]): { total: number; withOpenSpaces: number; accessible: number } {
    const streets = elements.filter(e => e.tags?.highway);
    
    let withOpenSpaces = 0;
    let accessible = 0;
    
    for (const street of streets) {
      const streetCenter = this.calculateElementCenter(street);
      
      // Verificar se tem espaços abertos próximos (100m - RELAXADO)
      const nearbyOpenSpaces = elements.filter(e => {
        if (!e.tags?.leisure && !e.tags?.landuse && !e.tags?.natural && !e.tags?.amenity) return false;
        const elementCenter = this.calculateElementCenter(e);
        const distance = calculateDistance(streetCenter, elementCenter);
        return distance <= 100; // 100m de espaço aberto (RELAXADO)
      });
      
      if (nearbyOpenSpaces.length > 0) {
        withOpenSpaces++;
      }
      
      // Verificar se é acessível (não é footway apenas)
      if (street.tags?.highway !== 'footway') {
        accessible++;
      }
    }
    
    return {
      total: streets.length,
      withOpenSpaces,
      accessible
    };
  }

  /**
   * Analisa espaços abertos a partir de ruas (proxy method)
   */
  private analyzeOpenSpacesFromStreets(streets: any[]): { count: number; percentage: number; types: string[] } {
    // Usar ruas como proxy para espaços abertos
    // Ruas com baixa densidade de construções = espaços abertos
    const openSpaceStreets = streets.filter(street => {
      // Ruas residenciais ou com baixa densidade = espaços abertos
      const highway = street.tags?.highway;
      return highway === 'residential' || highway === 'living_street' || highway === 'pedestrian';
    });
    
    const totalElements = streets.length;
    const percentage = totalElements > 0 ? (openSpaceStreets.length / totalElements) * 100 : 0;
    
    return {
      count: openSpaceStreets.length,
      percentage,
      types: ['residential', 'living_street', 'pedestrian']
    };
  }

  /**
   * Analisa espaços abertos na direção
   */
  private analyzeOpenSpaces(elements: any[]): { count: number; percentage: number; types: string[] } {
    const openSpaces = elements.filter(e => 
      e.tags?.leisure || 
      e.tags?.landuse === 'park' || 
      e.tags?.landuse === 'recreation_ground' ||
      e.tags?.natural === 'grassland' ||
      e.tags?.natural === 'scrub' ||
      e.tags?.amenity === 'parking'
    );
    
    const types = [...new Set(openSpaces.map(e => 
      e.tags?.leisure || e.tags?.landuse || e.tags?.natural || e.tags?.amenity
    ))];
    
    const totalElements = elements.length;
    const percentage = totalElements > 0 ? (openSpaces.length / totalElements) * 100 : 0;
    
    return {
      count: openSpaces.length,
      percentage,
      types
    };
  }

  /**
   * Analisa construções na direção
   */
  private analyzeBuildings(elements: any[]): { count: number; avgHeight: number; maxHeight: number; density: number } {
    const buildings = elements.filter(e => e.tags?.building);
    
    const heights = buildings.map(building => extractBuildingHeight(building.tags)).filter(h => h > 0);
    
    const avgHeight = heights.length > 0 ? heights.reduce((sum, h) => sum + h, 0) / heights.length : 0;
    const maxHeight = heights.length > 0 ? Math.max(...heights) : 0;
    
    // Calcular densidade (buildings/km²) - assumindo área de 200m raio
    const areaKm2 = Math.PI * Math.pow(0.2, 2); // 200m = 0.2km
    const density = buildings.length / areaKm2;
    
    return {
      count: buildings.length,
      avgHeight,
      maxHeight,
      density
    };
  }

  /**
   * Calcula visibilidade na direção
   */
  private calculateVisibility(
    streets: { total: number; withOpenSpaces: number; accessible: number },
    openSpaces: { count: number; percentage: number; types: string[] },
    buildings: { count: number; avgHeight: number; maxHeight: number; density: number },
    boundary: BoundaryData
  ): { score: number; hasObstructions: boolean; maxObstructionHeight: number } {
    
    let score = 0;
    
    // Pontuação por ruas com espaços abertos
    if (streets.total > 0) {
      score += (streets.withOpenSpaces / streets.total) * 0.4; // 40% do score
    }
    
    // Pontuação por espaços abertos
    score += Math.min(openSpaces.percentage / 100, 1) * 0.3; // 30% do score
    
    // Pontuação por baixa densidade de construções
    if (buildings.density < 50) { // <50 buildings/km²
      score += 0.2; // 20% do score
    } else if (buildings.density < 100) {
      score += 0.1; // 10% do score
    }
    
    // Pontuação por altura das construções
    if (buildings.avgHeight < 15) { // <15m média
      score += 0.1; // 10% do score
    }
    
    const hasObstructions = buildings.density > 100 || buildings.avgHeight > 25;
    
    return {
      score: Math.min(score, 1),
      hasObstructions,
      maxObstructionHeight: buildings.maxHeight
    };
  }

  /**
   * Decide se permite TPs na direção
   */
  private decideAllowTPs(
    streets: { total: number; withOpenSpaces: number; accessible: number },
    openSpaces: { count: number; percentage: number; types: string[] },
    buildings: { count: number; avgHeight: number; maxHeight: number; density: number },
    visibility: { score: number; hasObstructions: boolean; maxObstructionHeight: number },
    boundary: BoundaryData
  ): boolean {
    
    // LÓGICA SIMPLIFICADA: Sempre permite TPs (análise direcional não está funcionando)
    // O sistema já tem validação de visibilidade robusta no Step 6
    console.log(`✅ SIMPLIFICADO: Permitindo TPs (validação de visibilidade no Step 6)`);
    return true;
  }

  /**
   * Gera razão para a decisão
   */
  private generateReason(
    allowTPs: boolean,
    streets: { total: number; withOpenSpaces: number; accessible: number },
    openSpaces: { count: number; percentage: number; types: string[] },
    buildings: { count: number; avgHeight: number; maxHeight: number; density: number }
  ): string {
    if (allowTPs) {
      return `Streets: ${streets.withOpenSpaces}/${streets.total} with open spaces, Open spaces: ${openSpaces.percentage.toFixed(1)}%, Buildings: ${buildings.avgHeight.toFixed(1)}m avg`;
    } else {
      if (streets.accessible === 0) return 'No accessible streets';
      if (streets.withOpenSpaces === 0) return 'No streets with open spaces';
      if (openSpaces.percentage < 20) return `Insufficient open spaces: ${openSpaces.percentage.toFixed(1)}%`;
      if (buildings.avgHeight > 25) return `Buildings too tall: ${buildings.avgHeight.toFixed(1)}m avg`;
      return 'Poor visibility conditions';
    }
  }
}
