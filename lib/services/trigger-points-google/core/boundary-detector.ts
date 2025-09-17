// Detector de boundaries usando Google APIs com fallback para OSM

import { GoogleAPIsService } from '../services/google-apis.service';
import { ElevationService } from '../services/elevation.service';
import { POIData, GeographicContext, BoundaryData, ProcessingResult } from '../types/interfaces';
import { convertViewportToPolygon, calculatePolygonArea, calculatePolygonCenter } from '../utils/calculations';

export class BoundaryDetector {
  private googleAPIs: GoogleAPIsService;
  private elevationService: ElevationService;
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
    this.elevationService = new ElevationService();
  }
  
  /**
   * Detecta boundary de um POI usando múltiplas estratégias
   * OSM primeiro (mais preciso), Google como fallback
   */
  async detectBoundary(poiData: POIData, context: GeographicContext): Promise<ProcessingResult<BoundaryData>> {
    const startTime = Date.now();
    
    try {
      console.log(`🔍 Detecting boundary for: ${poiData.name}`);
      
      // Estratégia 1: OSM (Primary - mais preciso)
      console.log('🗺️ Trying OSM first (more precise)...');
      const osmResult = await this.detectOSMBoundary(poiData);
      if (osmResult.success && osmResult.data && osmResult.data.confidence > 0.5) {
        console.log('✅ Found boundary via OSM (primary)');
        return {
          success: true,
          data: { ...osmResult.data, source: 'osm' },
          processingTime: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString(),
            strategy: 'osm_primary'
          }
        };
      }
      
      // Estratégia 2: Google Places API (Fallback apenas se OSM falhou)
      console.log('🔄 OSM failed, trying Google Places as fallback...');
      const googleResult = await this.detectGoogleBoundary(poiData);
      if (googleResult.success && googleResult.data && googleResult.data.confidence > 0.4) {
        console.log('✅ Found boundary via Google Places (fallback)');
        return {
          success: true,
          data: { ...googleResult.data, source: 'google_places' },
          processingTime: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString(),
            strategy: 'google_fallback'
          }
        };
      }
      
      // Estratégia 3: Estimated Boundary (Fallback final)
      console.log('⚠️ Both OSM and Google failed, using estimated boundary');
      const estimatedResult = await this.createEstimatedBoundary(poiData, context);
      return {
        success: true,
        data: { ...estimatedResult, source: 'estimated' },
        processingTime: Date.now() - startTime,
        metadata: {
          step: 'boundary_detection',
          status: 'completed',
          timestamp: new Date().toISOString(),
          strategy: 'estimated_fallback'
        }
      };
      
    } catch (error) {
      console.error('Error in boundary detection:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime,
        metadata: {
          step: 'boundary_detection',
          status: 'failed',
          timestamp: new Date().toISOString()
        }
      };
    }
  }
  
  /**
   * Detecta boundary usando Google Places API com múltiplas estratégias
   */
  private async detectGoogleBoundary(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    try {
      console.log(`🔍 Google boundary detection for: ${poiData.name}`);
      
      // Estratégia 1: Busca por nome exato
      let searchResponse = await this.googleAPIs.searchPlacesNearby({
        location: poiData.location,
        radius: 100,
        name: poiData.name
      });
      
      // Estratégia 2: Busca por proximidade se nome não funcionou
      if (!searchResponse.success || !searchResponse.data?.results?.length) {
        console.log('🔄 Trying proximity search...');
        searchResponse = await this.googleAPIs.searchPlacesNearby({
          location: poiData.location,
          radius: 200,
          type: poiData.type
        });
      }
      
      // Estratégia 3: Busca expandida
      if (!searchResponse.success || !searchResponse.data?.results?.length) {
        console.log('🔄 Trying expanded search...');
        searchResponse = await this.googleAPIs.searchPlacesNearby({
          location: poiData.location,
          radius: 500
        });
      }
      
      if (!searchResponse.success || !searchResponse.data?.results?.length) {
        return { success: false, error: 'No Google Places results found', processingTime: 0 };
      }
      
      // Encontrar o melhor match
      const bestPlace = this.findBestPlaceMatch(searchResponse.data.results, poiData);
      console.log(`📍 Best match: ${bestPlace.name} (${bestPlace.place_id})`);
      
      // Buscar detalhes com geometry expandida
      const detailsResponse = await this.googleAPIs.getPlaceDetails(
        bestPlace.place_id,
        ['geometry', 'name', 'types', 'formatted_address']
      );
      
      if (!detailsResponse.success || !detailsResponse.data?.result) {
        return { success: false, error: 'Failed to get place details', processingTime: 0 };
      }
      
      const result = detailsResponse.data.result;
      const geometry = result.geometry;
      
      if (!geometry) {
        return { success: false, error: 'No geometry found', processingTime: 0 };
      }
      
      // Tentar obter boundary preciso
      const boundaryData = await this.extractPreciseBoundary(result, poiData);
      
      return {
        success: true,
        data: boundaryData,
        processingTime: 0
      };
      
    } catch (error) {
      console.error('Error in Google boundary detection:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', processingTime: 0 };
    }
  }
  
  /**
   * Encontra o melhor match entre os resultados do Google Places
   */
  private findBestPlaceMatch(places: any[], poiData: POIData): any {
    if (places.length === 1) return places[0];
    
    let bestPlace = places[0];
    let bestScore = 0;
    
    for (const place of places) {
      let score = 0;
      
      // Score por similaridade do nome
      if (place.name && this.calculateNameSimilarity(place.name, poiData.name) > 0.7) {
        score += 50;
      }
      
      // Score por proximidade
      const distance = this.calculateDistanceToPlace(place, poiData.location);
      if (distance < 100) score += 30;
      else if (distance < 200) score += 20;
      else if (distance < 500) score += 10;
      
      // Score por tipo
      if (place.types && place.types.includes(poiData.type)) {
        score += 20;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestPlace = place;
      }
    }
    
    console.log(`🎯 Best match score: ${bestScore} for ${bestPlace.name}`);
    return bestPlace;
  }
  
  /**
   * Extrai boundary preciso do resultado do Google
   */
  private async extractPreciseBoundary(placeResult: any, poiData: POIData): Promise<BoundaryData> {
    const geometry = placeResult.geometry;
    let coordinates: Array<{lat: number, lng: number}> = [];
    let confidence = 0.3; // Padrão baixo
    let center = poiData.location;
    
    // Estratégia 1: Usar viewport se disponível
    if (geometry.viewport) {
      coordinates = convertViewportToPolygon(geometry.viewport);
      confidence = 0.6; // Viewport é melhor que estimativa
      center = geometry.location || poiData.location;
      console.log('📐 Using Google viewport boundary');
    }
    
    // Estratégia 2: Criar boundary baseado no tipo e localização
    if (coordinates.length === 0 || confidence < 0.5) {
      const estimatedRadius = this.getGoogleEstimatedRadius(placeResult, poiData);
      coordinates = this.createCircularBoundary(center, estimatedRadius);
      confidence = 0.4;
      console.log(`📐 Using estimated boundary with radius: ${estimatedRadius}m`);
    }
    
    const area = calculatePolygonArea(coordinates);
    
    // Ajustar confidence baseado na qualidade dos dados
    if (placeResult.name && this.calculateNameSimilarity(placeResult.name, poiData.name) > 0.8) {
      confidence += 0.1;
    }
    
    if (placeResult.types && placeResult.types.length > 0) {
      confidence += 0.1;
    }
    
    // Tentar obter elevação via Google (não-bloqueante)
    let elevationData;
    try {
      const elevation = await this.elevationService.getElevation(center, { coordinates, center, area, confidence, source: 'google_places' });
      if (elevation.confidence > 0.3) {
        elevationData = {
          min: elevation.ground,
          max: elevation.total,
          average: elevation.ground,
          center: elevation.total
        };
        console.log(`📏 Google elevation added: ${elevation.total}m (${elevation.source}, confidence: ${elevation.confidence.toFixed(2)})`);
      }
    } catch (error) {
      console.warn('⚠️ Google elevation extraction failed (non-blocking):', error);
    }
    
    return {
      coordinates,
      center,
      area,
      confidence: Math.min(confidence, 0.9),
      source: 'google_places' as const,
      elevation: elevationData,
      height: elevationData ? (elevationData.max - elevationData.min) : undefined
    };
  }
  
  /**
   * Calcula raio estimado baseado nos dados do Google
   */
  private getGoogleEstimatedRadius(placeResult: any, poiData: POIData): number {
    let radius = 50; // Padrão
    
    // Ajustar baseado no tipo do Google
    if (placeResult.types) {
      if (placeResult.types.includes('park')) radius = 200;
      else if (placeResult.types.includes('shopping_mall')) radius = 150;
      else if (placeResult.types.includes('museum')) radius = 80;
      else if (placeResult.types.includes('restaurant')) radius = 25;
      else if (placeResult.types.includes('tourist_attraction')) radius = 100;
    }
    
    // Ajustar baseado no rating/popularidade
    if (placeResult.rating) {
      if (placeResult.rating > 4.5) radius *= 1.2;
      else if (placeResult.rating > 4.0) radius *= 1.1;
    }
    
    return Math.max(radius, 20);
  }
  
  /**
   * Calcula similaridade entre nomes
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const n1 = normalize(name1);
    const n2 = normalize(name2);
    
    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.8;
    
    // Levenshtein distance simplificado
    const maxLen = Math.max(n1.length, n2.length);
    if (maxLen === 0) return 1.0;
    
    let matches = 0;
    const minLen = Math.min(n1.length, n2.length);
    
    for (let i = 0; i < minLen; i++) {
      if (n1[i] === n2[i]) matches++;
    }
    
    return matches / maxLen;
  }
  
  /**
   * Calcula distância até um place do Google
   */
  private calculateDistanceToPlace(place: any, location: { lat: number; lng: number }): number {
    if (!place.geometry?.location) return Infinity;
    
    const placeLocation = place.geometry.location;
    return this.calculateDistance(location, placeLocation);
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
   * Detecta boundary usando OSM com múltiplas estratégias (estratégia principal)
   */
  private async detectOSMBoundary(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    try {
      console.log(`🗺️ OSM boundary detection (primary) for: ${poiData.name}`);
      
      // Estratégia 1: Busca por nome exato (mais provável de funcionar)
      let result = await this.queryOSMByName(poiData);
      if (result.success) {
        console.log('✅ OSM found via exact name match');
        return result;
      }
      
      // Estratégia 2: Busca por proximidade e tipo
      console.log('🔄 Trying OSM proximity search...');
      result = await this.queryOSMByProximity(poiData);
      if (result.success) {
        console.log('✅ OSM found via proximity search');
        return result;
      }
      
      // Estratégia 3: Busca expandida por categoria
      console.log('🔄 Trying OSM category search...');
      result = await this.queryOSMByCategory(poiData);
      if (result.success) {
        console.log('✅ OSM found via category search');
        return result;
      }
      
      console.log('❌ OSM boundary not found with any strategy');
      return { success: false, error: 'No OSM boundary found', processingTime: 0 };
      
    } catch (error) {
      console.error('Error in OSM boundary detection:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', processingTime: 0 };
    }
  }
  
  /**
   * Query OSM por nome exato (simplificada para evitar timeout)
   */
  private async queryOSMByName(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    const query = `
[out:json][timeout:30];
(
  relation["name"="${poiData.name}"]["type"="multipolygon"];
  way["name"="${poiData.name}"]["leisure"];
  way["name"="${poiData.name}"]["amenity"];
);
out geom;
`;
    
    return await this.executeOSMQuery(query, 'name search');
  }
  
  /**
   * Query OSM por proximidade (simplificada para evitar timeout)
   */
  private async queryOSMByProximity(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    const query = `
[out:json][timeout:30];
(
  relation["type"="multipolygon"](around:100,${poiData.location.lat},${poiData.location.lng});
  way["leisure"](around:100,${poiData.location.lat},${poiData.location.lng});
  way["amenity"](around:100,${poiData.location.lat},${poiData.location.lng});
);
out geom;
`;
    
    return await this.executeOSMQuery(query, 'proximity search');
  }
  
  /**
   * Query OSM por categoria (incluindo dados de elevação)
   */
  private async queryOSMByCategory(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    const categoryMap: Record<string, string> = {
      'park': 'leisure=park',
      'museum': 'tourism=museum',
      'restaurant': 'amenity=restaurant',
      'hotel': 'tourism=hotel',
      'tourist_attraction': 'tourism=attraction',
      'shopping_mall': 'shop=mall',
      'church': 'amenity=place_of_worship',
      'hospital': 'amenity=hospital'
    };
    
    const osmCategory = categoryMap[poiData.type] || 'tourism=attraction';
    
    const query = `
[out:json][timeout:30];
(
  relation[${osmCategory}](around:200,${poiData.location.lat},${poiData.location.lng});
  way[${osmCategory}](around:200,${poiData.location.lat},${poiData.location.lng});
);
out geom;
`;
    
    return await this.executeOSMQuery(query, 'category search');
  }
  
  /**
   * Executa query OSM e processa resultado
   */
  private async executeOSMQuery(query: string, searchType: string): Promise<ProcessingResult<BoundaryData>> {
    try {
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
        return { success: false, error: `No OSM data found for ${searchType}`, processingTime: 0 };
      }
      
      console.log(`📍 Found ${data.elements.length} OSM elements via ${searchType}`);
      
      // Encontrar melhor elemento
      const bestElement = this.findBestOSMElement(data.elements);
      const coordinates = this.extractOSMCoordinates(bestElement);
      
      if (coordinates.length < 3) {
        return { success: false, error: 'Insufficient coordinates from OSM', processingTime: 0 };
      }
      
      const center = calculatePolygonCenter(coordinates);
      const area = calculatePolygonArea(coordinates);
      const confidence = this.calculateOSMConfidence(bestElement, searchType);
      
      console.log(`✅ OSM boundary extracted: ${coordinates.length} points, area: ${area.toFixed(0)}m², confidence: ${confidence.toFixed(2)}`);
      
      // Tentar obter elevação (não-bloqueante - se falhar, não quebra o boundary)
      let elevationData;
      try {
        const elevation = await this.elevationService.getElevation(center, undefined, bestElement);
        if (elevation.confidence > 0.3) {
          elevationData = {
            min: elevation.ground,
            max: elevation.total,
            average: elevation.ground,
            center: elevation.total
          };
          console.log(`📏 Elevation added: ${elevation.total}m (${elevation.source}, confidence: ${elevation.confidence.toFixed(2)})`);
        }
      } catch (error) {
        console.warn('⚠️ Elevation extraction failed (non-blocking):', error);
      }
      
      return {
        success: true,
        data: {
          coordinates,
          center,
          area,
          confidence,
          source: 'osm' as const,
          elevation: elevationData,
          height: elevationData ? (elevationData.max - elevationData.min) : undefined
        },
        processingTime: 0
      };
      
    } catch (error) {
      console.error(`Error in OSM ${searchType}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', processingTime: 0 };
    }
  }
  
  /**
   * Encontra o melhor elemento OSM
   */
  private findBestOSMElement(elements: any[]): any {
    if (elements.length === 1) return elements[0];
    
    // Preferir relações sobre ways
    const relations = elements.filter(e => e.type === 'relation');
    if (relations.length > 0) return relations[0];
    
    // Preferir ways com mais geometria
    const ways = elements.filter(e => e.type === 'way' && e.geometry);
    if (ways.length > 0) {
      return ways.sort((a, b) => (b.geometry?.length || 0) - (a.geometry?.length || 0))[0];
    }
    
    return elements[0];
  }
  
  /**
   * Extrai coordenadas do elemento OSM
   */
  private extractOSMCoordinates(element: any): Array<{lat: number, lng: number}> {
    let coordinates: Array<{lat: number, lng: number}> = [];
    
    if (element.type === 'way' && element.geometry) {
      coordinates = element.geometry.map((point: any) => ({
        lat: point.lat,
        lng: point.lon
      }));
    } else if (element.type === 'relation' && element.members) {
      // Para relações, usar o primeiro way com geometria
      const firstWay = element.members.find((member: any) => 
        member.type === 'way' && member.geometry
      );
      if (firstWay && firstWay.geometry) {
        coordinates = firstWay.geometry.map((point: any) => ({
          lat: point.lat,
          lng: point.lon
        }));
      }
    }
    
    return coordinates;
  }
  
  /**
   * Calcula confidence do resultado OSM
   */
  private calculateOSMConfidence(element: any, searchType: string): number {
    let confidence = 0.5; // Base
    
    // Bonus por tipo de busca
    if (searchType === 'name search') confidence += 0.2;
    else if (searchType === 'proximity search') confidence += 0.1;
    else if (searchType === 'category search') confidence += 0.05;
    
    // Bonus por tipo de elemento
    if (element.type === 'relation') confidence += 0.1;
    else if (element.type === 'way') confidence += 0.05;
    
    // Bonus por tags
    if (element.tags) {
      if (element.tags.name) confidence += 0.1;
      if (element.tags.building || element.tags.leisure || element.tags.amenity) confidence += 0.05;
    }
    
    return Math.min(confidence, 0.9);
  }
  
  /**
   * Extrai dados de elevação do elemento OSM
   */
  private async extractOSMElevation(
    element: any, 
    coordinates: Array<{lat: number, lng: number}>, 
    center: {lat: number, lng: number}
  ): Promise<{min: number, max: number, average: number, center: number} | null> {
    try {
      console.log('📏 Extracting elevation data from OSM...');
      
      // Tentar obter elevação das tags do elemento
      const osmElevation = this.getElevationFromOSMTags(element);
      if (osmElevation) {
        console.log(`✅ Found OSM elevation in tags: ${osmElevation}m`);
        return {
          min: osmElevation,
          max: osmElevation,
          average: osmElevation,
          center: osmElevation
        };
      }
      
      // Se não houver elevação nas tags, usar Google Elevation API como fallback
      console.log('🔄 No OSM elevation tags, trying Google Elevation API...');
      const googleElevation = await this.getElevationFromGoogle(coordinates, center);
      
      return googleElevation;
      
    } catch (error) {
      console.warn('Failed to extract elevation data:', error);
      return null;
    }
  }
  
  /**
   * Extrai elevação das tags OSM
   */
  private getElevationFromOSMTags(element: any): number | null {
    if (!element.tags) return null;
    
    // Tentar diferentes tags de elevação
    const elevationTags = ['ele', 'elevation', 'height:ground', 'altitude'];
    
    for (const tag of elevationTags) {
      if (element.tags[tag]) {
        const elevation = parseFloat(element.tags[tag]);
        if (!isNaN(elevation)) {
          return elevation;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Obtém elevação usando Google Elevation API
   */
  private async getElevationFromGoogle(
    coordinates: Array<{lat: number, lng: number}>, 
    center: {lat: number, lng: number}
  ): Promise<{min: number, max: number, average: number, center: number} | null> {
    try {
      // Selecionar pontos estratégicos para consulta (max 10 pontos para economizar requests)
      const samplePoints = this.selectElevationSamplePoints(coordinates, center);
      
      const elevationResponse = await this.googleAPIs.getElevation(samplePoints);
      
      if (!elevationResponse.success || !elevationResponse.data?.results) {
        return null;
      }
      
      const elevations = elevationResponse.data.results.map((r: any) => r.elevation).filter((e: number) => !isNaN(e));
      
      if (elevations.length === 0) return null;
      
      const min = Math.min(...elevations);
      const max = Math.max(...elevations);
      const average = elevations.reduce((sum: number, e: number) => sum + e, 0) / elevations.length;
      
      // Elevação do centro
      const centerElevation = await this.googleAPIs.getElevation([center]);
      const centerValue = centerElevation.success && centerElevation.data?.results?.[0] 
        ? centerElevation.data.results[0].elevation 
        : average;
      
      return {
        min: Math.round(min * 10) / 10,
        max: Math.round(max * 10) / 10,
        average: Math.round(average * 10) / 10,
        center: Math.round(centerValue * 10) / 10
      };
      
    } catch (error) {
      console.warn('Failed to get Google elevation:', error);
      return null;
    }
  }
  
  /**
   * Seleciona pontos estratégicos para amostragem de elevação
   */
  private selectElevationSamplePoints(
    coordinates: Array<{lat: number, lng: number}>, 
    center: {lat: number, lng: number}
  ): Array<{lat: number, lng: number}> {
    const points = [center]; // Sempre incluir o centro
    
    // Adicionar pontos do boundary (máximo 8 pontos adicionais)
    const maxBoundaryPoints = Math.min(8, coordinates.length);
    const step = Math.max(1, Math.floor(coordinates.length / maxBoundaryPoints));
    
    for (let i = 0; i < coordinates.length; i += step) {
      if (points.length < 9) { // Google permite até 10 pontos por request
        points.push(coordinates[i]);
      }
    }
    
    return points;
  }
  
  /**
   * Extrai altura do POI das tags OSM
   */
  private extractOSMHeight(element: any): number | null {
    if (!element.tags) return null;
    
    // Tags de altura de construções
    const heightTags = ['height', 'building:height', 'building:levels'];
    
    for (const tag of heightTags) {
      if (element.tags[tag]) {
        if (tag === 'building:levels') {
          // Converter níveis para altura (aproximadamente 3m por andar)
          const levels = parseFloat(element.tags[tag]);
          if (!isNaN(levels)) {
            return levels * 3;
          }
        } else {
          const height = parseFloat(element.tags[tag]);
          if (!isNaN(height)) {
            return height;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Cria boundary estimado baseado no contexto
   */
  private async createEstimatedBoundary(poiData: POIData, context: GeographicContext): Promise<BoundaryData> {
    // Calcular raio baseado no contexto geográfico
    const baseRadius = this.calculateEstimatedRadius(poiData.type, context);
    
    // Criar boundary circular
    const coordinates = this.createCircularBoundary(poiData.location, baseRadius);
    const center = poiData.location;
    const area = calculatePolygonArea(coordinates);
    
    return {
      coordinates,
      center,
      area,
      confidence: 0.3,
      source: 'estimated' as const
    };
  }
  
  /**
   * Calcula raio estimado baseado no tipo de POI e contexto
   */
  private calculateEstimatedRadius(poiType: string, context: GeographicContext): number {
    // Raio base por tipo de POI
    const baseRadii: Record<string, number> = {
      'park': 200,
      'museum': 50,
      'monument': 30,
      'restaurant': 25,
      'hotel': 40,
      'shopping_mall': 150,
      'tourist_attraction': 100,
      'natural_feature': 300,
      'building': 30
    };
    
    let baseRadius = baseRadii[poiType] || 50;
    
    // Ajustar baseado na densidade urbana
    switch (context.urbanDensity.level) {
      case 'very_dense':
        baseRadius *= 0.7;
        break;
      case 'dense':
        baseRadius *= 0.8;
        break;
      case 'medium':
        baseRadius *= 1.0;
        break;
      case 'low':
        baseRadius *= 1.2;
        break;
      case 'rural':
        baseRadius *= 1.5;
        break;
    }
    
    // Ajustar baseado na elevação
    switch (context.elevationContext.type) {
      case 'mountainous':
        baseRadius *= 1.3;
        break;
      case 'hilly':
        baseRadius *= 1.1;
        break;
      case 'flat':
        baseRadius *= 1.0;
        break;
    }
    
    return Math.max(baseRadius, 20); // Mínimo de 20 metros
  }
  
  /**
   * Cria boundary circular
   */
  private createCircularBoundary(center: { lat: number; lng: number }, radius: number): Array<{lat: number, lng: number}> {
    const coordinates: Array<{lat: number, lng: number}> = [];
    const points = 16; // Número de pontos no círculo
    
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      const lat = center.lat + (radius / 111000) * Math.cos(angle);
      const lng = center.lng + (radius / (111000 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
      coordinates.push({ lat, lng });
    }
    
    // Fechar o polígono
    coordinates.push(coordinates[0]);
    
    return coordinates;
  }
}
