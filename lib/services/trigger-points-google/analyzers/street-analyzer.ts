// Analisador de ruas acessíveis usando Google Roads API

import { GoogleAPIsService } from '../services/google-apis.service';
import { POIData, BoundaryData, GeographicContext, StreetData } from '../types/interfaces';
import { calculateDistance, isPointInPolygon } from '../utils/calculations';

export class StreetAnalyzer {
  private googleAPIs: GoogleAPIsService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
  }
  
  /**
   * Encontra ruas acessíveis ao redor do POI e retorna junto com metadados do raio
   */
  async findAccessibleStreets(
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<StreetData[]> {
    console.log(`🛣️ Finding accessible streets for: ${poiData.name}`);
    
    try {
      const searchRadius = this.calculateIntelligentRadius(boundary, context);
      const roads = await this.getRoadsAroundBoundary(boundary, searchRadius);
      
      // Filtrar ruas acessíveis
      const accessibleStreets = roads.filter(road => 
        this.isStreetAccessible(road, context)
      );
      
      // Calcular pontos mais próximos ao boundary
      const streetPoints = accessibleStreets.map(street => 
        this.findClosestPointToBoundary(street, boundary)
      );
      
      console.log(`✅ Found ${streetPoints.length} accessible street points`);
      return streetPoints;
      
    } catch (error) {
      console.error('Error finding accessible streets:', error);
      return [];
    }
  }

  /**
   * Encontra ruas acessíveis ao redor do POI e retorna junto com metadados do raio
   * Versão que retorna metadados para visualização no frontend
   */
  async findAccessibleStreetsWithMetadata(
    poiData: POIData, 
    boundary: BoundaryData, 
    context: GeographicContext
  ): Promise<{ streets: StreetData[]; searchRadius: number; elevationAnalysis?: any }> {
    console.log(`🛣️ Finding accessible streets for: ${poiData.name} (with metadata)`);
    
    try {
      const searchRadius = this.calculateIntelligentRadius(boundary, context);
      const roads = await this.getRoadsAroundBoundary(boundary, searchRadius);
      
      // Filtrar ruas acessíveis
      const accessibleStreets = roads.filter(road => 
        this.isStreetAccessible(road, context)
      );
      
      // Calcular pontos mais próximos ao boundary
      const streetPoints = accessibleStreets.map(street => 
        this.findClosestPointToBoundary(street, boundary)
      );

      // Coletar dados de elevação para o frontend
      let elevationAnalysis;
      if (boundary.elevation) {
        const baseElevation = this.estimateRegionalBaseElevation(boundary.center, context);
        elevationAnalysis = {
          poiElevation: boundary.elevation.center,
          baseElevation,
          elevationDiff: boundary.elevation.center - baseElevation,
          isHighVisibility: (boundary.elevation.center - baseElevation) > 200
        };
      }
      
      console.log(`✅ Found ${streetPoints.length} accessible street points (radius: ${searchRadius}m)`);
      return { 
        streets: streetPoints, 
        searchRadius,
        elevationAnalysis
      };
      
    } catch (error) {
      console.error('Error finding accessible streets:', error);
      return { streets: [], searchRadius: 300 };
    }
  }
  
  /**
   * Calcula raio de busca inteligente baseado em elevação, altura e contexto
   * Implementa a lógica DINÂMICA do sistema legado usando dados reais de elevação
   */
  private calculateIntelligentRadius(boundary: BoundaryData, context: GeographicContext): number {
    console.log(`🧮 Calculating intelligent search radius (LEGACY FORMULA)...`);
    
    // 🏔️ STEP 1: Check if this is a high-visibility POI using REAL elevation data (DYNAMIC LOGIC)
    if (boundary.elevation && boundary.elevation.center > 0) {
      const poiElevation = boundary.elevation.center;
      const baseElevation = this.estimateRegionalBaseElevation(boundary.center, context);
      const elevationDiff = poiElevation - baseElevation;
      
      console.log(`📏 DYNAMIC elevation analysis:`);
      console.log(`  📍 POI elevation: ${poiElevation.toFixed(1)}m (from real data)`);
      console.log(`  🏞️ Estimated base elevation: ${baseElevation.toFixed(1)}m`);
      console.log(`  📈 Relative difference: ${elevationDiff.toFixed(1)}m`);
      
      // Apply LEGACY FORMULA for high-visibility landmarks (>200m difference)
      if (elevationDiff > 200) {
        const theoreticalRange = Math.sqrt(elevationDiff) * 200; // EXACT LEGACY FORMULA
        const maxRange = Math.min(Math.max(theoreticalRange, 2000), 8000); // Between 2km-8km
        
        console.log(`🏔️ HIGH-VISIBILITY LANDMARK DETECTED (dynamic)`);
        console.log(`  📏 Theoretical range: ${theoreticalRange.toFixed(0)}m`);
        console.log(`  🎯 DYNAMIC LEGACY range: ${maxRange.toFixed(0)}m`);
        
        return Math.round(maxRange);
      }
      // Moderate elevation bonus for smaller differences
      else if (elevationDiff > 50) {
        const elevationBonus = elevationDiff * 8; // 8m radius per meter of elevation
        console.log(`⛰️ Moderate elevation bonus: +${elevationBonus.toFixed(0)}m (${elevationDiff.toFixed(1)}m above base)`);
        // Continue with normal calculation but add elevation bonus later
      }
    }
    
    let baseRadius = 300; // Base reduzida (era 500m)
    
    // 1. Ajuste por densidade urbana (básico)
    switch (context.urbanDensity.level) {
      case 'very_dense':
        baseRadius *= 0.7; // Ruas mais próximas
        break;
      case 'dense':
        baseRadius *= 0.8;
        break;
      case 'medium':
        baseRadius *= 1.0;
        break;
      case 'low':
        baseRadius *= 1.3;
        break;
      case 'rural':
        baseRadius *= 1.8; // Ruas mais distantes
        break;
    }
    
    // 2. NOVO: Ajuste por elevação absoluta e relativa do POI
    if (boundary.elevation) {
      const poiElevation = boundary.elevation.center;
      const elevationDiff = boundary.elevation.center - boundary.elevation.average;
      
      // Para POIs EXTREMAMENTE altos (>1000m), usar fórmula agressiva para picos/montanhas
      if (poiElevation > 1000) {
        const extremeAltitudeBonus = Math.min((poiElevation - 1000) * 10 + 2000, 4000); // 10m raio por metro acima de 1000m + 2000m base, max 4000m
        baseRadius += extremeAltitudeBonus;
        console.log(`🗻 EXTREME altitude bonus: ${poiElevation.toFixed(0)}m elevation → +${extremeAltitudeBonus.toFixed(0)}m radius`);
      }
      // Para POIs muito altos (>800m), usar elevação absoluta (picos, montanhas)
      else if (poiElevation > 800) {
        const highAltitudeBonus = Math.min((poiElevation - 800) * 6 + 1200, 2500); // 6m raio por metro acima de 800m + 1200m base, max 2500m
        baseRadius += highAltitudeBonus;
        console.log(`🏔️ High altitude bonus: ${poiElevation.toFixed(0)}m elevation → +${highAltitudeBonus.toFixed(0)}m radius`);
      }
      // Para POIs moderadamente altos (>400m), usar elevação absoluta moderada
      else if (poiElevation > 400) {
        const moderateAltitudeBonus = Math.min((poiElevation - 400) * 2, 800);
        baseRadius += moderateAltitudeBonus;
        console.log(`⛰️ Moderate altitude bonus: ${poiElevation.toFixed(0)}m elevation → +${moderateAltitudeBonus.toFixed(0)}m radius`);
      }
      
      // Ajuste adicional por elevação relativa (diferença interna do POI)
      if (elevationDiff > 50) {
        // POI muito acima da média interna - visível de longe
        const elevationBonus = Math.min(elevationDiff * 8, 400); // Max 400m bonus
        baseRadius += elevationBonus;
        console.log(`🏗️ Internal elevation bonus: POI is ${elevationDiff.toFixed(1)}m above internal average → +${elevationBonus.toFixed(0)}m radius`);
      } else if (elevationDiff > 20) {
        // POI moderadamente acima da média interna
        const elevationBonus = elevationDiff * 5;
        baseRadius += elevationBonus;
        console.log(`🏢 Moderate internal elevation bonus: +${elevationBonus.toFixed(0)}m radius`);
      } else if (elevationDiff < -20) {
        // POI abaixo da média interna - menos visível
        const elevationPenalty = Math.abs(elevationDiff) * 3;
        baseRadius = Math.max(baseRadius - elevationPenalty, 150); // Mínimo 150m
        console.log(`🕳️ Low elevation penalty: POI is ${Math.abs(elevationDiff).toFixed(1)}m below internal average → -${elevationPenalty.toFixed(0)}m radius`);
      }
      
      // Terreno muito variado = maior raio (melhor visibilidade de pontos altos)
      const elevationRange = boundary.elevation.max - boundary.elevation.min;
      if (elevationRange > 100) {
        const terrainBonus = Math.min(elevationRange * 2, 200);
        baseRadius += terrainBonus;
        console.log(`🗻 Varied terrain bonus: ${elevationRange.toFixed(1)}m range → +${terrainBonus.toFixed(0)}m radius`);
      }
    }
    
    // 3. NOVO: Ajuste por altura da construção/POI
    if (boundary.height && boundary.height > 10) {
      const heightBonus = Math.min(boundary.height * 6, 300); // 6m raio por metro de altura, max 300m
      baseRadius += heightBonus;
      console.log(`🏢 Height bonus: ${boundary.height}m tall → +${heightBonus.toFixed(0)}m radius`);
    }
    
    // 4. Ajuste por tipo de terreno (elevação)
    if (context.elevationContext.type === 'mountainous') {
      baseRadius *= 1.4; // Montanhas = visibilidade maior
      console.log(`⛰️ Mountainous terrain multiplier: x1.4`);
    } else if (context.elevationContext.type === 'hilly') {
      baseRadius *= 1.2;
      console.log(`🏔️ Hilly terrain multiplier: x1.2`);
    }
    
    // 5. Limites de segurança
    const minRadius = 150; // Mínimo absoluto
    const maxRadius = 5000; // Máximo absoluto aumentado para picos/montanhas
    const finalRadius = Math.max(minRadius, Math.min(baseRadius, maxRadius));
    
    console.log(`✅ Intelligent radius calculated: ${finalRadius.toFixed(0)}m (base: ${baseRadius.toFixed(0)}m)`);
    
    return Math.round(finalRadius);
  }

  /**
   * Estima a elevação base da região usando dados de contexto e heurísticas
   * Substitui a lista hardcoded de landmarks por lógica dinâmica
   */
  private estimateRegionalBaseElevation(location: { lat: number; lng: number }, context: GeographicContext): number {
    console.log(`🏞️ Estimating regional base elevation for (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`);
    
    let baseElevation = 500; // Default global average
    
    // 1. Usar dados de elevação do boundary se disponível (média das elevações ao redor)
    if (context.elevationContext && context.elevationContext.variance) {
      // Se a variância é baixa, usar a elevação mínima como base
      // Se a variância é alta, usar uma estimativa mais conservadora
      if (context.elevationContext.variance < 50) {
        baseElevation = 400; // Área relativamente plana
        console.log(`📊 Low elevation variance (${context.elevationContext.variance.toFixed(1)}m) → flat area base: ${baseElevation}m`);
      } else if (context.elevationContext.variance > 200) {
        baseElevation = 600; // Área montanhosa
        console.log(`📊 High elevation variance (${context.elevationContext.variance.toFixed(1)}m) → mountainous area base: ${baseElevation}m`);
      }
    }
    
    // 2. Ajustar por densidade urbana (cidades tendem a estar em elevações específicas)
    switch (context.urbanDensity.level) {
      case 'very_dense':
      case 'dense':
        // Grandes cidades costeiras tendem a ser baixas, interiores mais altas
        if (location.lat > -25 && location.lat < -20) { // Região RJ/SP
          baseElevation = location.lng > -45 ? 600 : 50; // Interior vs Costa
        }
        console.log(`🏙️ Dense urban area adjustment → base: ${baseElevation}m`);
        break;
      case 'rural':
        // Áreas rurais: usar elevação base mais conservadora
        baseElevation += 100;
        console.log(`🌾 Rural area adjustment → base: ${baseElevation}m`);
        break;
    }
    
    // 3. Coordenadas geográficas heurísticas (Brasil)
    if (location.lat > -30 && location.lat < -10 && location.lng > -75 && location.lng < -30) {
      // Brasil - usar conhecimento geográfico geral
      if (location.lng > -50) { // Costa leste (mais baixa)
        baseElevation = Math.min(baseElevation, 200);
        console.log(`🏖️ Brazilian coast region → base: ${baseElevation}m`);
      } else if (location.lat > -25 && location.lat < -20) { // Região SP
        baseElevation = Math.max(baseElevation, 700);
        console.log(`🏔️ São Paulo region → base: ${baseElevation}m`);
      }
    }
    
    console.log(`✅ Estimated regional base elevation: ${baseElevation}m`);
    return baseElevation;
  }

  /**
   * Calcula distância entre dois pontos (Haversine)
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  
  /**
   * Busca ruas ao redor do boundary do POI (otimizado para evitar timeout)
   */
  private async getRoadsAroundBoundary(boundary: BoundaryData, searchRadius: number): Promise<StreetData[]> {
    console.log(`🗺️ Searching roads around boundary (${boundary.coordinates.length} points, radius: ${searchRadius}m)`);
    
    try {
      const streets: StreetData[] = [];
      const processedRoads = new Set<string>();
      
      // ⚡ OTIMIZAÇÃO: Single Query OSM para evitar timeout
      const osmStreets = await this.getStreetsFromOSMOptimized(boundary, searchRadius);
      
      // Processar resultados OSM
      osmStreets.forEach(street => {
        if (!processedRoads.has(street.id)) {
          processedRoads.add(street.id);
          streets.push(street);
        }
      });
      
      // Fallback: Google Roads apenas se OSM retornou poucos resultados
      if (streets.length < 3) {
        console.log('🔄 OSM returned few roads, trying Google Roads fallback...');
        const googleStreets = await this.getRoadsFromGoogleFallback(boundary, searchRadius, processedRoads);
        streets.push(...googleStreets);
      }
      
      console.log(`✅ Found ${streets.length} roads around boundary (${osmStreets.length} from OSM)`);
      return streets;
      
    } catch (error) {
      console.error('Error finding roads around boundary:', error);
      return [];
    }
  }
  
  /**
   * NOVA: Query OSM otimizada para buscar ruas ao redor do boundary
   */
  private async getStreetsFromOSMOptimized(boundary: BoundaryData, searchRadius: number): Promise<StreetData[]> {
    try {
      console.log(`🚀 Optimized OSM query for streets around boundary...`);
      
      // Selecionar pontos estratégicos do boundary com cobertura 360° (AUMENTADO para melhor cobertura)
      const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates, 16);
      
      // Criar query OSM combinada e otimizada (MELHORADA para incluir avenidas)
      const pointQueries = strategicPoints.map(point => 
        `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(private|no)$"](around:${searchRadius},${point.lat},${point.lng})`
      ).join(';\n  ');
      
      // Query simplificada para evitar erro 400 (validação será feita no código)
      const query = `
[out:json][timeout:60];
(
  ${pointQueries};
);
out geom meta;
`;
      
      console.log(`📝 OSM Query: ${strategicPoints.length} strategic points, ${searchRadius}m radius`);
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
      if (!response.ok) {
        throw new Error(`OSM API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        console.log('⚠️ No streets found via OSM');
        return [];
      }
      
      console.log(`📍 Found ${data.elements.length} street elements from OSM`);
      
      // Processar elementos OSM em StreetData com validação de boundary
      const streets: StreetData[] = [];
      
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry && element.geometry.length > 1) {
          const streetCoordinates = element.geometry.map((point: any) => ({
            lat: point.lat,
            lng: point.lon
          }));
          
          // VALIDAÇÃO: Filtrar ruas que estão majoritariamente dentro do boundary
          const validCoordinates = streetCoordinates.filter((coord: {lat: number, lng: number}) => 
            !isPointInPolygon(coord, boundary.coordinates)
          );
          
          // RELAXADO: Se mais de 30% dos pontos da rua estão fora do boundary, incluir (para avenidas importantes)
          if (validCoordinates.length > streetCoordinates.length * 0.3) {
            const street: StreetData = {
              id: `osm_way_${element.id}`,
              type: this.classifyOSMHighway(element.tags?.highway || 'unknown'),
              coordinates: validCoordinates, // Usar apenas pontos válidos
              accessibility: this.determineAccessibility(element.tags),
              confidence: 0.9 // Alta confidence para OSM
            };
            
            streets.push(street);
          } else {
            // console.log(`🚫 Street mostly inside boundary filtered out: ${element.id}`);
          }
        }
      }
      
      console.log(`✅ Processed ${streets.length} streets from OSM`);
      return streets;
      
    } catch (error) {
      console.error('Error in optimized OSM street search:', error);
      return [];
    }
  }
  
  /**
   * Converte boundary coordinates para string de polígono OSM
   */
  private boundaryToPolygonString(coordinates: Array<{lat: number, lng: number}>): string {
    return coordinates.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
  }
  
  /**
   * Classifica tipo de highway OSM
   */
  private classifyOSMHighway(highway: string): string {
    const highwayMap: Record<string, string> = {
      'motorway': 'primary',     // Rodovias → Primary (alta prioridade)
      'trunk': 'primary',        // Vias expressas → Primary  
      'primary': 'primary',      // Avenidas principais → Primary
      'secondary': 'secondary',  // Avenidas secundárias → Secondary
      'tertiary': 'tertiary',    // Ruas coletoras → Tertiary
      'residential': 'residential',
      'service': 'service',
      'unclassified': 'residential' // Ruas sem classificação → Residential
    };
    
    return highwayMap[highway] || 'residential';
  }
  
  /**
   * Determina acessibilidade baseado nas tags OSM
   */
  private determineAccessibility(tags: any): 'public' | 'restricted' | 'private' {
    if (!tags) return 'public';
    
    if (tags.access === 'private' || tags.access === 'no') return 'private';
    if (tags.access === 'permissive' || tags.access === 'destination') return 'restricted';
    
    return 'public';
  }
  
  /**
   * Google Roads fallback quando OSM não encontra ruas suficientes
   */
  private async getRoadsFromGoogleFallback(
    boundary: BoundaryData, 
    searchRadius: number, 
    processedRoads: Set<string>
  ): Promise<StreetData[]> {
    try {
      console.log(`🔄 Google Roads fallback...`);
      
      // Usar pontos estratégicos do boundary para snap to roads
      const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates, 6);
      const streets: StreetData[] = [];
      
      for (const point of strategicPoints) {
        try {
          const response = await this.googleAPIs.getNearestRoads([point]);
          
          if (response.success && response.data?.snappedPoints) {
            for (const snappedPoint of response.data.snappedPoints) {
              if (snappedPoint.placeId && !processedRoads.has(snappedPoint.placeId)) {
                processedRoads.add(snappedPoint.placeId);
                
                streets.push({
                  id: snappedPoint.placeId,
                  type: 'road',
                  coordinates: [{ lat: snappedPoint.location.lat, lng: snappedPoint.location.lng }],
                  accessibility: 'public',
                  confidence: 0.7 // Média confidence para Google fallback
                });
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to get Google roads for point:`, error);
        }
      }
      
      console.log(`🔄 Google fallback found ${streets.length} additional roads`);
      return streets;
      
    } catch (error) {
      console.error('Error in Google Roads fallback:', error);
      return [];
    }
  }
  
  /**
   * Busca ruas nos pontos do boundary
   */
  private async getRoadsFromBoundaryPoints(boundary: BoundaryData, processedRoads: Set<string>): Promise<StreetData[]> {
    const streets: StreetData[] = [];
    
    // Usar pontos estratégicos do boundary (não todos para evitar muitas requests)
    const strategicPoints = this.selectStrategicBoundaryPoints(boundary.coordinates);
    
    for (const point of strategicPoints) {
      try {
        const response = await this.googleAPIs.getNearestRoads([point]); // Google API will find nearest roads
        
        if (response.success && response.data?.snappedPoints) {
          for (const snappedPoint of response.data.snappedPoints) {
            if (snappedPoint.placeId && !processedRoads.has(snappedPoint.placeId)) {
              processedRoads.add(snappedPoint.placeId);
              
              streets.push({
                id: snappedPoint.placeId,
                type: 'road',
                coordinates: [{ lat: snappedPoint.location.lat, lng: snappedPoint.location.lng }],
                accessibility: 'public',
                confidence: 0.9 // Alta confidence para pontos no boundary
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to get roads for boundary point:`, error);
      }
    }
    
    console.log(`📍 Found ${streets.length} roads from boundary points`);
    return streets;
  }
  
  /**
   * Busca ruas na área expandida ao redor do boundary
   */
  private async getRoadsFromExpandedArea(boundary: BoundaryData, searchRadius: number, processedRoads: Set<string>): Promise<StreetData[]> {
    const streets: StreetData[] = [];
    
    // Criar círculo expandido ao redor do centro do boundary
    const expandedPoints = this.generateSearchPath(boundary.center, searchRadius);
    
    try {
      const response = await this.googleAPIs.snapToRoads(expandedPoints);
      
      if (response.success && response.data?.snappedPoints) {
        for (const point of response.data.snappedPoints) {
          if (point.placeId && !processedRoads.has(point.placeId)) {
            processedRoads.add(point.placeId);
            
            streets.push({
              id: point.placeId,
              type: 'road',
              coordinates: [{ lat: point.location.lat, lng: point.location.lng }],
              accessibility: 'public',
              confidence: 0.7 // Média confidence para área expandida
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to get roads from expanded area:`, error);
    }
    
    console.log(`🔄 Found ${streets.length} roads from expanded area`);
    return streets;
  }
  
  /**
   * Seleciona pontos estratégicos do boundary (MELHORADO: cobertura 360°)
   */
  private selectStrategicBoundaryPoints(
    coordinates: Array<{lat: number, lng: number}>, 
    maxPoints: number = 8
  ): Array<{lat: number, lng: number}> {
    if (coordinates.length <= maxPoints) {
      return coordinates; // Se poucos pontos, usar todos
    }
    
    console.log(`🧭 Selecting strategic points for 360° coverage from ${coordinates.length} boundary points`);
    
    // NOVA ESTRATÉGIA: Distribuição uniforme por ângulo (não por índice)
    const center = this.calculateBoundaryCenter(coordinates);
    const strategicPoints: Array<{lat: number, lng: number}> = [];
    
    // Calcular ângulos de todos os pontos em relação ao centro
    const pointsWithAngles = coordinates.map((coord, index) => ({
      coord,
      index,
      angle: this.calculateAngle(center, coord)
    }));
    
    // Ordenar por ângulo para garantir sequência circular
    pointsWithAngles.sort((a, b) => a.angle - b.angle);
    
    // Selecionar pontos distribuídos uniformemente por ângulo (360°)
    const angleStep = 360 / maxPoints;
    
    for (let i = 0; i < maxPoints; i++) {
      const targetAngle = i * angleStep;
      
      // Encontrar ponto mais próximo ao ângulo alvo
      let bestPoint = pointsWithAngles[0];
      let bestAngleDiff = Infinity;
      
      for (const pointWithAngle of pointsWithAngles) {
        const angleDiff = Math.abs(this.normalizeAngle(pointWithAngle.angle - targetAngle));
        if (angleDiff < bestAngleDiff) {
          bestAngleDiff = angleDiff;
          bestPoint = pointWithAngle;
        }
      }
      
      strategicPoints.push(bestPoint.coord);
    }
    
    console.log(`📍 Selected ${strategicPoints.length} strategic points with 360° coverage (${angleStep.toFixed(1)}° intervals)`);
    return strategicPoints;
  }
  
  /**
   * Calcula centro do boundary
   */
  private calculateBoundaryCenter(coordinates: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
    const sumLat = coordinates.reduce((sum, coord) => sum + coord.lat, 0);
    const sumLng = coordinates.reduce((sum, coord) => sum + coord.lng, 0);
    
    return {
      lat: sumLat / coordinates.length,
      lng: sumLng / coordinates.length
    };
  }
  
  /**
   * Calcula ângulo de um ponto em relação ao centro
   */
  private calculateAngle(center: {lat: number, lng: number}, point: {lat: number, lng: number}): number {
    const deltaLng = point.lng - center.lng;
    const deltaLat = point.lat - center.lat;
    
    let angle = Math.atan2(deltaLng, deltaLat) * 180 / Math.PI;
    return angle < 0 ? angle + 360 : angle; // Normalizar para 0-360°
  }
  
  /**
   * Normaliza diferença de ângulo para -180 a 180
   */
  private normalizeAngle(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return Math.abs(angle);
  }
  
  /**
   * Busca ruas em um raio específico (método original mantido para fallback)
   */
  private async getRoadsInRadius(location: { lat: number; lng: number }, radius: number): Promise<StreetData[]> {
    try {
      // Gerar pontos em círculo para buscar ruas
      const searchPath = this.generateSearchPath(location, radius);
      
      const response = await this.googleAPIs.snapToRoads(searchPath);
      
      if (!response.success || !response.data?.snappedPoints) {
        return [];
      }
      
      // Processar pontos snapados
      const streets: StreetData[] = [];
      const processedRoads = new Set<string>();
      
      for (const point of response.data.snappedPoints) {
        if (point.placeId && !processedRoads.has(point.placeId)) {
          processedRoads.add(point.placeId);
          
          streets.push({
            id: point.placeId,
            type: 'road',
            coordinates: [{ lat: point.location.lat, lng: point.location.lng }],
            accessibility: 'public',
            confidence: 0.8
          });
        }
      }
      
      return streets;
    } catch (error) {
      console.warn('Error getting roads in radius:', error);
      return [];
    }
  }
  
  /**
   * Gera caminho de busca em círculo
   */
  private generateSearchPath(center: { lat: number; lng: number }, radius: number): Array<{lat: number, lng: number}> {
    const points: Array<{lat: number, lng: number}> = [];
    const steps = 16;
    
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const lat = center.lat + (radius / 111000) * Math.cos(angle);
      const lng = center.lng + (radius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
      points.push({ lat, lng });
    }
    
    return points;
  }
  
  /**
   * Verifica se uma rua é acessível
   */
  private isStreetAccessible(road: StreetData, context: GeographicContext): boolean {
    // Verificar se a rua é acessível - INCLUINDO RODOVIAS PARA POIs DE ALTA ELEVAÇÃO
    const accessibleRoadTypes = [
      'motorway',        // 🛣️ Rodovias (ex: Rodoanel)
      'trunk',           // 🛣️ Vias Expressas (ex: Anhanguera) 
      'primary',         // 🛤️ Vias Principais
      'secondary',       // 🛤️ Vias Secundárias
      'tertiary',        // 🛤️ Vias Terciárias
      'residential',     // 🏘️ Ruas Residenciais
      'living_street',   // 🏘️ Ruas de Convivência
      'motorway_link',   // 🔗 Acessos às Rodovias
      'trunk_link'       // 🔗 Acessos às Vias Expressas
    ];
    
    if (!accessibleRoadTypes.includes(road.type)) {
      console.log(`🚫 Road type '${road.type}' not in accessible types: [${accessibleRoadTypes.join(', ')}]`);
      return false;
    }
    
    // Verificar restrições de acesso
    if (road.accessibility === 'private' || road.accessibility === 'no') {
      return false;
    }
    
    // Ajustar critérios baseado no contexto
    if (context.urbanDensity.level === 'very_dense') {
      // Em áreas muito densas, aceitar mais tipos de ruas
      return true;
    }
    
    return true;
  }
  
  /**
   * Encontra ponto na rua mais próximo ao boundary
   */
  private findClosestPointToBoundary(street: StreetData, boundary: BoundaryData): StreetData {
    if (street.coordinates.length === 0) {
      return street;
    }
    
    // Encontrar ponto na rua mais próximo ao centro do boundary
    let closestPoint = street.coordinates[0];
    let minDistance = calculateDistance(street.coordinates[0], boundary.center);
    
    for (const point of street.coordinates) {
      const distance = calculateDistance(point, boundary.center);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }
    
    return {
      ...street,
      coordinates: [closestPoint],
      distance: minDistance
    };
  }
  
  /**
   * Busca ruas usando Google Roads API com fallback
   */
  async getRoadsWithFallback(location: { lat: number; lng: number }, radius: number): Promise<StreetData[]> {
    try {
      // Tentar Google Roads API primeiro
      const roads = await this.getRoadsInRadius(location, radius);
      
      if (roads.length > 0) {
        return roads;
      }
      
      // Fallback para OSM se Google não retornar resultados
      console.log('Google Roads API returned no results, trying OSM fallback...');
      return await this.getOSMRoads(location, radius);
      
    } catch (error) {
      console.error('Error getting roads with fallback:', error);
      return [];
    }
  }
  
  /**
   * Busca ruas usando OSM como fallback
   */
  private async getOSMRoads(location: { lat: number; lng: number }, radius: number): Promise<StreetData[]> {
    try {
      const query = `
[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian|service|footway|path|track)$"](around:${radius},${location.lat},${location.lng});
);
out geom;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
      if (!response.ok) {
        throw new Error(`OSM API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.elements || data.elements.length === 0) {
        return [];
      }
      
      const streets: StreetData[] = [];
      
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry) {
          // Pegar ponto médio da rua
          const midIndex = Math.floor(element.geometry.length / 2);
          const midPoint = element.geometry[midIndex];
          
          streets.push({
            id: element.id.toString(),
            type: element.tags?.highway || 'road',
            coordinates: [{ lat: midPoint.lat, lng: midPoint.lon }],
            accessibility: element.tags?.access || 'public',
            confidence: 0.6
          });
        }
      }
      
      return streets;
    } catch (error) {
      console.error('Error getting OSM roads:', error);
      return [];
    }
  }
  
  /**
   * Calcula confiança da rua baseada em múltiplos fatores
   */
  calculateStreetConfidence(street: StreetData, context: GeographicContext): number {
    let confidence = street.confidence || 0.5;
    
    // Ajustar baseado no tipo de rua
    const roadTypeConfidence: Record<string, number> = {
      'primary': 0.9,
      'secondary': 0.8,
      'tertiary': 0.7,
      'residential': 0.6,
      'living_street': 0.5,
      'pedestrian': 0.4,
      'service': 0.3,
      'footway': 0.2,
      'path': 0.1,
      'track': 0.1
    };
    
    const typeConfidence = roadTypeConfidence[street.type] || 0.5;
    confidence = (confidence + typeConfidence) / 2;
    
    // Ajustar baseado na acessibilidade
    if (street.accessibility === 'public') {
      confidence += 0.1;
    } else if (street.accessibility === 'private' || street.accessibility === 'no') {
      confidence -= 0.3;
    }
    
    // Ajustar baseado no contexto urbano
    if (context.urbanDensity.level === 'very_dense' && street.type === 'residential') {
      confidence += 0.1; // Ruas residenciais são mais importantes em áreas densas
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
}
