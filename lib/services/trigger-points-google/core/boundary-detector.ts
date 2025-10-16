// Detector de boundaries usando Google APIs com fallback para OSM

import { GoogleAPIsService } from '../services/google-apis.service';
import { ElevationService } from '../services/elevation.service';
import { POIData, GeographicContext, BoundaryData, ProcessingResult } from '../types/interfaces';
import { convertViewportToPolygon, calculatePolygonArea, calculatePolygonCenter } from '../utils/calculations';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';

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
      const osmResult = await this.detectOSMBoundary(poiData, context);
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
      
      // Estratégia 2: REMOVIDO - Google Places fallback (boundaries ruins)
      console.log('⚠️ OSM failed - skipping Google Places (unreliable boundaries)');
      
      // Estratégia 2: Smart Fallback - POI pequeno baseado em lat/lng
      console.log('🎯 Using smart fallback for small POI (lat/lng based)');
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
    
    // Tentar obter elevação via Google (não-bloqueante - DESABILITADO temporariamente)
    let elevationData;
    try {
      // TEMPORARIAMENTE DESABILITADO para não quebrar o boundary
      // const elevation = await this.elevationService.getElevation(center, { coordinates, center, area, confidence, source: 'google_places' });
    } catch (error) {
      console.warn('⚠️ Google elevation extraction failed (non-blocking):', error);
    }
    
    return {
      coordinates,
      center,
      area,
      confidence: Math.min(confidence, 0.9),
      source: 'google_places' as const
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
   * Calcula raio de busca baseado na área do POI
   */
  private calculateSearchRadiusFromArea(area: number): number {
    // Fórmula baseada na área: raio = sqrt(área / π) * 2
    // Isso garante que cobrimos uma área 4x maior que o POI
    const baseRadius = Math.sqrt(area / Math.PI) * 2;
    
    // Limitar entre 200m e 2000m
    const minRadius = 200;
    const maxRadius = 2000;
    
    const radius = Math.max(minRadius, Math.min(maxRadius, baseRadius));
    
    console.log(`📏 Calculated search radius: ${radius.toFixed(0)}m (from area: ${area.toFixed(0)}m²)`);
    return Math.round(radius);
  }

  /**
   * Processa elementos OSM de ruas em StreetData
   */
  private processOSMStreets(streetElements: any[], boundaryCoordinates: Array<{lat: number, lng: number}>): any[] {
    const streets: any[] = [];
    
    for (const element of streetElements) {
      if (element.geometry && element.geometry.length > 1) {
        const streetCoordinates = element.geometry.map((point: any) => ({
          lat: point.lat,
          lng: point.lon
        }));
        
        // Filtrar coordenadas que estão fora do boundary
        const validCoordinates = streetCoordinates.filter((coord: {lat: number, lng: number}) => 
          !this.isPointInsidePolygon(coord, boundaryCoordinates)
        );
        
        // Se mais de 30% dos pontos estão fora do boundary, incluir
        if (validCoordinates.length > streetCoordinates.length * 0.3) {
          streets.push({
            id: `osm_way_${element.id}`,
            type: this.classifyOSMHighway(element.tags?.highway || 'unknown'),
            name: element.tags?.name || element.tags?.ref || 'Unnamed Street',
            coordinates: validCoordinates,
            accessibility: this.determineAccessibility(element.tags),
            confidence: 0.9,
            tags: element.tags
          });
        }
      }
    }
    
    return streets;
  }

  /**
   * Processa elementos OSM de buildings
   */
  private processOSMBuildings(buildingElements: any[]): any[] {
    return buildingElements.map(element => ({
      id: element.id,
      type: element.tags?.building || 'building',
      coordinates: element.geometry || [],
      tags: element.tags,
      height: this.extractOSMHeight(element)
    }));
  }

  /**
   * Processa elementos de vegetação do OSM
   */
  private processOSMVegetation(vegetationElements: any[]): any[] {
    return vegetationElements.map((element: any) => ({
      id: `osm_vegetation_${element.id}`,
      type: 'vegetation',
      coordinates: element.geometry?.map((point: any) => ({
        lat: point.lat,
        lng: point.lon
      })) || [],
      tags: element.tags || {},
      naturalType: element.tags?.natural || 'unknown'
    }));
  }

  /**
   * Processa elementos de barreiras do OSM
   */
  private processOSMBarriers(barrierElements: any[]): any[] {
    return barrierElements.map((element: any) => ({
      id: `osm_barrier_${element.id}`,
      type: 'barrier',
      coordinates: element.geometry?.map((point: any) => ({
        lat: point.lat,
        lng: point.lon
      })) || [],
      tags: element.tags || {},
      barrierType: element.tags?.barrier || 'unknown'
    }));
  }

  /**
   * Classifica tipo de rua baseado na tag highway do OSM
   */
  private classifyOSMHighway(highway: string): string {
    const highwayMap: {[key: string]: string} = {
      'motorway': 'motorway',
      'trunk': 'trunk',
      'primary': 'primary',
      'secondary': 'secondary',
      'tertiary': 'tertiary',
      'residential': 'residential',
      'unclassified': 'unclassified',
      'living_street': 'residential',
      'pedestrian': 'pedestrian',
      'service': 'service'
    };
    
    return highwayMap[highway] || 'unclassified';
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
   * Detecta boundary usando OSM com múltiplas estratégias (estratégia principal)
   */
  private async detectOSMBoundary(poiData: POIData, context: GeographicContext): Promise<ProcessingResult<BoundaryData>> {
    try {
      console.log(`🗺️ OSM boundary detection (primary) for: ${poiData.name}`);
      
      // Estratégia 1: Busca por nome exato (mais provável de funcionar)
      let result = await this.queryOSMByName(poiData, context);
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
  private async queryOSMByName(poiData: POIData, context: GeographicContext): Promise<ProcessingResult<BoundaryData>> {
    console.log(`🔍 OSM name search for: "${poiData.name}" using Nominatim API`);
    
    try {
      // USAR NOMINATIM API (igual ao sistema legado que funciona)
      const encodedName = encodeURIComponent(poiData.name);
      const lat = poiData.location.lat;
      const lng = poiData.location.lng;
      
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodedName}&` +
        `lat=${lat}&lon=${lng}&` +
        `bounded=1&viewbox=${lng-0.01},${lat+0.01},${lng+0.01},${lat-0.01}&` +
        `format=json&polygon_geojson=1&addressdetails=1&extratags=1&limit=5`;

      console.log(`🌐 Nominatim URL: ${nominatimUrl}`);
      
      const response = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (boundary-detection)'
        }
      });

      if (!response.ok) {
        console.error(`❌ Nominatim API error: ${response.status}`);
        return { success: false, error: `Nominatim API error: ${response.status}`, processingTime: 0 };
      }

      const results = await response.json();
      console.log(`📍 Nominatim found ${results.length} results`);

      if (results.length === 0) {
        return { success: false, error: 'No results found in Nominatim', processingTime: 0 };
      }

      // Processar resultados do Nominatim
      for (const result of results) {
        if (result.geojson && result.geojson.coordinates) {
          console.log(`🔍 Processing Nominatim result: ${result.display_name} (type: ${result.geojson.type})`);
          
          const processed = await this.processNominatimGeometry(result.geojson, lat, lng);
          if (processed.success && processed.coordinates.length > 2) {
            const center = this.calculatePolygonCenter(processed.coordinates);
            const area = this.calculatePolygonArea(processed.coordinates);
            
            console.log(`✅ Nominatim boundary: ${processed.coordinates.length} points, area: ${area.toFixed(0)}m²`);
            
            // NOVA LÓGICA: Extrair elevação e altura para resultados do Nominatim
            let elevationData;
            let poiHeight;
            let consolidatedStreets: any[] = [];
            let consolidatedBuildings: any[] = [];
            let consolidatedVegetation: any[] = [];
            let consolidatedBarriers: any[] = [];
            let poiClassification: any = undefined;
            
            try {
              console.log(`🏗️ Extracting POI elevation and height for Nominatim result...`);
              console.log(`📍 POI center: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);
              console.log(`🏷️ Nominatim result type: ${result.geojson.type}, osm_type: ${result.osm_type}, osm_id: ${result.osm_id}`);
              
              // 🎯 NOVA ESTRATÉGIA: Classificar POI ANTES de buscar ruas
              // PASSO 1: Buscar tags do POI (query pequena)
              // PASSO 2: Extrair altura e elevação
              // PASSO 3: Classificar POI
              // PASSO 4: Query consolidada COM RAIO CORRETO
              if (result.osm_id && result.osm_type) {
                console.log(`🔍 Step 1: Getting POI tags from OSM ID: ${result.osm_type}(${result.osm_id})`);
                try {
                  // ===============================================
                  // STEP 1: Query PEQUENA apenas para tags do POI
                  // ===============================================
                  const poiTagsQuery = `
[out:json][timeout:30];
${result.osm_type}(${result.osm_id});
out tags;
`;
                  
                  const poiTagsResponse = await fetch('https://overpass-api.de/api/interpreter', {
                    method: 'POST',
                    body: poiTagsQuery,
                    headers: { 'Content-Type': 'text/plain' },
                    signal: AbortSignal.timeout(40000)
                  });
                  
                  let poiTags: any = {};
                  if (poiTagsResponse.ok) {
                    const poiTagsData = await poiTagsResponse.json();
                    const poiElement = poiTagsData.elements[0];
                    if (poiElement && poiElement.tags) {
                      poiTags = poiElement.tags;
                      console.log(`✅ Retrieved POI tags from OSM`);
                    }
                  }
                  
                  // ===============================================
                  // STEP 2: Extrair altura e elevação
                  // ===============================================
                  console.log(`🔍 Step 2: Extracting height and elevation...`);
                  
                  // Extrair altura dos tags
                  poiHeight = this.extractOSMHeight({ tags: poiTags });
                  if (poiHeight) {
                    console.log(`📏 POI height from tags: ${poiHeight}m`);
                  } else {
                    console.log(`⚠️ No height found in tags`);
                  }
                  
                  // Buscar elevação
                  const elevation = await this.elevationService.getElevation(center, undefined, { tags: poiTags });
                  if (elevation && elevation.confidence > 0.5) {
                    elevationData = {
                      min: elevation.ground - 10,
                      max: elevation.ground + 10,
                      average: elevation.ground,
                      center: elevation.total
                    };
                    console.log(`⛰️ POI elevation: ${elevation.total.toFixed(1)}m (ground: ${elevation.ground.toFixed(1)}m)`);
                  } else {
                    console.log(`⚠️ Low confidence elevation or no data`);
                  }
                  
                  // ===============================================
                  // STEP 3: CLASSIFICAR POI (NOVO!)
                  // ===============================================
                  console.log(`🔍 Step 3: Classifying POI to determine search strategy...`);
                  
                  const POIClassifierService = (await import('../services/poi-classifier.service')).POIClassifierService;
                  const classifier = new POIClassifierService();
                  
                  const classification = await classifier.classifyPOI(
                    poiData,
                    poiHeight || undefined,
                    elevationData ? { center: elevationData.center } : undefined,
                    area,
                    context,
                    poiTags
                  );
                  
                  console.log(`✅ POI Classification: ${classification.group.toUpperCase()}`);
                  console.log(`📏 Search radius: ${classification.searchRadius}m (${classification.metadata.reasoning})`);
                  
                  // Armazenar classificação para retorno
                  poiClassification = classification;
                  
                  // ===============================================
                  // STEP 4: Query consolidada COM RAIO CORRETO
                  // ===============================================
                  const searchRadius = classification.searchRadius;
                  
                  console.log(`🔍 Step 4: Fetching consolidated data with optimized radius: ${searchRadius}m`);
                  
                  // 🎯 NOVO: Calcular boundary expandido (raio para FORA do boundary)
                  const expandedBoundary = this.expandBoundary(processed.coordinates, searchRadius);
                  const expandedPolygon = expandedBoundary.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
                  
                  console.log(`🎯 Using expanded boundary polygon (${searchRadius}m outside boundary): ${expandedBoundary.length} points`);
                  
                  const consolidatedQuery = `
[out:json][timeout:180];
(
  ${result.osm_type}(${result.osm_id});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](poly:"${expandedPolygon}");
  way["building"](poly:"${expandedPolygon}");
  way["building"~"^(stadium|arena|sports_centre|leisure)$"](poly:"${expandedPolygon}");
  way["natural"~"^(tree|wood|forest)$"](poly:"${expandedPolygon}");
  way["barrier"~"^(wall|fence|hedge)$"](poly:"${expandedPolygon}");
);
out geom tags;
`;
                  
                  //console.log(`🔍 DEBUG: OSM Consolidated Query:`, consolidatedQuery);
                  
                  const osmTagsResponse = await fetch('https://overpass-api.de/api/interpreter', {
                    method: 'POST',
                    body: consolidatedQuery,
                    headers: { 'Content-Type': 'text/plain' },
                    signal: AbortSignal.timeout(200000) // 200 segundos timeout
                  });
                  
                  // console.log(`🔍 DEBUG: OSM Tags Response status:`, osmTagsResponse.status);
                  
                  if (osmTagsResponse.ok) {
                    const consolidatedData = await osmTagsResponse.json();
                    // console.log(`🔍 DEBUG: OSM Consolidated Data:`, JSON.stringify(consolidatedData, null, 2));
                    
                    if (consolidatedData.elements && consolidatedData.elements.length > 0) {
                      // Separar elementos por tipo
                      const poiElement = consolidatedData.elements.find((el: any) => el.id === result.osm_id);
                      const streetElements = consolidatedData.elements.filter((el: any) => 
                        el.tags?.highway && el.geometry && el.geometry.length > 1
                      );
                      const buildingElements = consolidatedData.elements.filter((el: any) => 
                        el.tags?.building && el.geometry
                      );
                      const vegetationElements = consolidatedData.elements.filter((el: any) => 
                        el.tags?.natural && el.geometry
                      );
                      const barrierElements = consolidatedData.elements.filter((el: any) => 
                        el.tags?.barrier && el.geometry
                      );
                      
                      console.log(`🚀 CONSOLIDATION SUCCESS: ${streetElements.length} streets, ${buildingElements.length} buildings, ${vegetationElements.length} vegetation, ${barrierElements.length} barriers`);
                      
                      // Extrair altura do POI
                      if (poiElement) {
                        poiHeight = this.extractOSMHeight(poiElement);
                        if (poiHeight) {
                          console.log(`✅ Found height from OSM ID: ${poiHeight}m`);
                        } else {
                          console.log(`⚠️ No height found in OSM ID tags`);
                        }
                      }
                      
                      // Processar ruas encontradas
                      const streets = this.processOSMStreets(streetElements, processed.coordinates);
                      // Processar buildings encontrados
                      const buildings = this.processOSMBuildings(buildingElements);

                      // Processar vegetação encontrada
                      const vegetation = this.processOSMVegetation(vegetationElements);

                      // Processar barreiras encontradas
                      const barriers = this.processOSMBarriers(barrierElements);
                      
                      console.log(`🛣️ Processed ${streets.length} streets, ${buildings.length} buildings, ${vegetation.length} vegetation, ${barriers.length} barriers`);

                      // Armazenar dados consolidados para uso posterior
                      consolidatedStreets = streets;
                      consolidatedBuildings = buildings;
                      consolidatedVegetation = vegetation;
                      consolidatedBarriers = barriers;
                    } else {
                      console.log(`⚠️ No elements found in OSM consolidated response`);
                    }
                  } else {
                    console.log(`⚠️ OSM Consolidated Response not OK: ${osmTagsResponse.status}`);
                  }
                } catch (error) {
                  console.warn(`⚠️ Failed to get tags from OSM ID:`, error);
                }
              }
              
              // SISTEMA ESCALÁVEL: Se não encontrou altura via OSM ID, usar dados consolidados primeiro
              if (!poiHeight) {
                // 🚀 NOVA LÓGICA: Usar dados consolidados se disponíveis
                if (consolidatedBuildings && consolidatedBuildings.length > 0) {
                  console.log(`🚀 CONSOLIDATION BENEFIT: Using consolidated buildings data for height analysis (${consolidatedBuildings.length} buildings)`);
                  poiHeight = this.extractHeightFromMultipleElements(consolidatedBuildings, center, {
                    coordinates: processed.coordinates,
                    center,
                    area,
                    confidence: 0.8,
                    source: 'osm'
                  });
                }
                
                // Se ainda não encontrou altura, buscar elementos arquitetônicos dentro do boundary
                if (!poiHeight) {
                  console.log(`🔄 No height from consolidated data, searching for related architectural elements around Nominatim result...`);
              
              // SOLUÇÃO SIMPLES: Buscar apenas elementos dentro do boundary
              const boundaryPolygon = processed.coordinates.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
              const architecturalQuery = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryMedium}];
(
  way["building:part"~"^(tower|spire|dome|cupola|minaret)$"](poly:"${boundaryPolygon}");
  way["man_made"~"^(tower|monument|obelisk|spire)$"](poly:"${boundaryPolygon}");
  way["tower:type"~".*"](poly:"${boundaryPolygon}");
  way["height"~".*"](poly:"${boundaryPolygon}");
  way["building:height"~".*"](poly:"${boundaryPolygon}");
);
out tags;
`;
              
              try {
                const response = await fetch('https://overpass-api.de/api/interpreter', {
                  method: 'POST',
                  body: architecturalQuery,
                  headers: { 'Content-Type': 'text/plain' }
                });
                
                if (response.ok) {
                  const data = await response.json();
                  if (data.elements && data.elements.length > 0) {
                    // console.log(`🏗️ Found ${data.elements.length} architectural elements, analyzing for height...`);
                    // Criar boundary temporário para verificação
                    const tempBoundary: BoundaryData = {
                      coordinates: processed.coordinates,
                      center,
                      area,
                      confidence: 0.8,
                      source: 'osm'
                    };
                    poiHeight = this.extractHeightFromMultipleElements(data.elements, center, tempBoundary);
                  } else {
                    console.log(`⚠️ No architectural elements found around Nominatim result`);
                  }
                } else {
                  console.warn(`⚠️ Architectural elements search failed: ${response.status}`);
                }
              } catch (error) {
                console.warn('⚠️ Architectural elements search failed (non-blocking):', error);
              }
                } // Fechamento do bloco if (!poiHeight) - busca arquitetônica
              } // Fechamento do bloco if (!poiHeight) - principal
              
              // Para Nominatim, não temos tags OSM, então pular direto para Google Elevation
              const elevation = await this.elevationService.getElevation(center, undefined, result);
              console.log(`📊 Elevation service returned:`, { 
                elevation: elevation ? elevation.total : null, 
                confidence: elevation?.confidence,
                source: elevation?.source 
              });
              
              if (elevation && elevation.confidence > 0.5) {
                elevationData = {
                  min: elevation.ground - 10,
                  max: elevation.ground + 10,
                  average: elevation.ground,
                  center: elevation.total
                };
                console.log(`⛰️ POI elevation: ${elevation.total.toFixed(1)}m (ground: ${elevation.ground.toFixed(1)}m)`);
              } else {
                console.log(`⚠️ Low confidence elevation or no data: confidence=${elevation?.confidence}`);
              }
            } catch (error) {
              console.warn('⚠️ Elevation/height extraction failed for Nominatim (non-blocking):', error);
              if (error instanceof Error) {
                console.warn('⚠️ Error details:', error.message);
              }
            }
            
            // Extrair informações de endereço do POI (usando dados do Nominatim já disponíveis)
            const address = this.extractAddressFromNominatimResult(result); // Passar resultado completo do Nominatim
            if (address) {
              console.log(`🏠 POI address from OSM: ${address.street || 'unknown street'}, ${address.number || 'no number'}`);
            }
            
            // NOVO: Verificar entradas usando lógica existente (DRY)
            const entranceData = this.determineAccessPointsFromTags(result);
            if (entranceData && entranceData.length > 0) {
              console.log(`🚪 Found access points: ${entranceData.join(', ')}`);
            }
            
            return {
              success: true,
              data: {
                coordinates: processed.coordinates,
                center,
                area,
                confidence: 0.9, // Alta confiança para Nominatim
                source: 'osm' as const,
                elevation: elevationData,
                height: poiHeight || undefined,
                address: address || undefined, // Adicionar endereço ao boundary
                streets: consolidatedStreets.length > 0 ? consolidatedStreets : undefined, // NOVO: ruas consolidadas
                buildings: consolidatedBuildings.length > 0 ? consolidatedBuildings : undefined, // NOVO: buildings consolidados
                vegetation: consolidatedVegetation.length > 0 ? consolidatedVegetation : undefined, // NOVO: vegetação consolidada
                barriers: consolidatedBarriers.length > 0 ? consolidatedBarriers : undefined, // NOVO: barreiras consolidadas
                classification: poiClassification || undefined, // NOVO: classificação do POI
                osmTags: undefined // NOVO: tags OSM para classificação (será preenchido se disponível)
              },
              processingTime: 0
            };
          }
        }
      }

      return { success: false, error: 'No valid boundaries found in Nominatim results', processingTime: 0 };

    } catch (error) {
      console.error('❌ Error in Nominatim search:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', processingTime: 0 };
    }
  }
  
  /**
   * Query OSM por proximidade (simplificada para evitar timeout)
   */
  private async queryOSMByProximity(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    const query = `
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryMedium}];
(
  relation["type"="multipolygon"](around:100,${poiData.location.lat},${poiData.location.lng});
  way["building"](around:50,${poiData.location.lat},${poiData.location.lng});
  way["leisure"](around:100,${poiData.location.lat},${poiData.location.lng});
  way["amenity"](around:100,${poiData.location.lat},${poiData.location.lng});
  way["building:part"~"^(tower|spire|dome|cupola|minaret)$"](around:200,${poiData.location.lat},${poiData.location.lng});
  way["man_made"~"^(tower|monument|obelisk|spire)$"](around:200,${poiData.location.lat},${poiData.location.lng});
  way["tower:type"~".*"](around:200,${poiData.location.lat},${poiData.location.lng});
);
out geom tags;
`;
    
    return await this.executeOSMQuery(query, 'proximity search', poiData);
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
[out:json][timeout:${TRIGGER_POINTS_CONSTANTS.timeouts.osmQueryMedium}];
(
  relation[${osmCategory}](around:200,${poiData.location.lat},${poiData.location.lng});
  way[${osmCategory}](around:200,${poiData.location.lat},${poiData.location.lng});
  way["building:part"~"^(tower|spire|dome|cupola|minaret)$"](around:200,${poiData.location.lat},${poiData.location.lng});
  way["man_made"~"^(tower|monument|obelisk|spire)$"](around:200,${poiData.location.lat},${poiData.location.lng});
  way["tower:type"~".*"](around:200,${poiData.location.lat},${poiData.location.lng});
);
out geom tags;
`;
    
    return await this.executeOSMQuery(query, 'category search', poiData);
  }
  
  /**
   * Executa query OSM e processa resultado
   */
  private async executeOSMQuery(query: string, searchType: string, poiData?: POIData): Promise<ProcessingResult<BoundaryData>> {
    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
      if (!response.ok) {
        console.error(`🚨 OSM API error ${response.status} for ${searchType}`);
        throw new Error(`OSM API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      
      if (!data.elements || data.elements.length === 0) {
        console.warn(`⚠️ No OSM elements found for ${searchType}`);
        return { success: false, error: `No OSM data found for ${searchType}`, processingTime: 0 };
      }
      
      
      // Encontrar melhor elemento
      const bestElement = this.findBestOSMElement(data.elements);
      const coordinates = this.extractOSMCoordinates(bestElement);
      
      if (coordinates.length < 3) {
        return { success: false, error: 'Insufficient coordinates from OSM', processingTime: 0 };
      }
      
      const center = calculatePolygonCenter(coordinates);
      const area = calculatePolygonArea(coordinates);
      const confidence = this.calculateOSMConfidence(bestElement, searchType);
      
      // VALIDAÇÃO: Rejeitar boundaries com área inválida
      if (area < TRIGGER_POINTS_CONSTANTS.distances.minArea) { // Área mínima configurável
        console.warn(`⚠️ OSM boundary rejected: area too small (${area.toFixed(0)}m²)`);
        return { success: false, error: `Boundary area too small: ${area.toFixed(0)}m²`, processingTime: 0 };
      }
      
      console.log(`✅ OSM boundary extracted: ${coordinates.length} points, area: ${area.toFixed(0)}m²`);
      
      // Tentar obter elevação e altura do POI (REABILITADO para análise de visibilidade)
      let elevationData;
      let poiHeight;
      try {
        console.log(`🏗️ Extracting POI elevation and height for visibility analysis...`);
        console.log(`📍 POI center: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);
        console.log(`🏷️ OSM element type: ${bestElement?.type}, id: ${bestElement?.id}`);
        
        // Extrair altura do POI dos tags OSM (sistema escalável)
        // console.log(`🔍 DEBUG: bestElement tags:`, bestElement?.tags);
        poiHeight = this.extractOSMHeight(bestElement);
        
        // Se não encontrou altura no elemento principal, buscar em elementos relacionados
        if (!poiHeight && data.elements && data.elements.length > 0) {
          // console.log(`🔄 No height in main element, searching related architectural elements...`);
          // Criar boundary temporário para verificação
          const tempBoundary: BoundaryData = {
            coordinates,
            center,
            area,
            confidence,
            source: 'osm'
          };
          poiHeight = this.extractHeightFromMultipleElements(data.elements, center, tempBoundary);
        }
        
        if (poiHeight) {
          console.log(`🏢 POI height from OSM: ${poiHeight}m`);
        } else {
          console.log(`⚠️ No height found in OSM tags or related elements`);
          // console.log(`🔍 DEBUG: Available tags:`, Object.keys(bestElement?.tags || {}));
        }
        
        // DEBUG: Verificar se altura está sendo salva corretamente
        // console.log(`🔍 DEBUG: poiHeight value: ${poiHeight}, type: ${typeof poiHeight}`);
        
        // Tentar obter elevação (opcional, não bloquear se falhar)
        console.log(`🌍 Calling ElevationService.getElevation...`);
        const elevation = await this.elevationService.getElevation(center, undefined, bestElement);
        console.log(`📊 Elevation service returned:`, { 
          elevation: elevation ? elevation.total : null, 
          confidence: elevation?.confidence,
          source: elevation?.source 
        });
        
        if (elevation && elevation.confidence > 0.5) {
          elevationData = {
            min: elevation.ground - 10,
            max: elevation.ground + 10,
            average: elevation.ground,
            center: elevation.total
          };
          console.log(`⛰️ POI elevation: ${elevation.total.toFixed(1)}m (ground: ${elevation.ground.toFixed(1)}m)`);
        } else {
          console.log(`⚠️ Low confidence elevation or no data: confidence=${elevation?.confidence}`);
        }
      } catch (error) {
        console.warn('⚠️ Elevation extraction failed (non-blocking):', error);
        if (error instanceof Error) {
          console.warn('⚠️ Error details:', error.message);
        }
      }
      
      // DEBUG: Verificar altura final antes de retornar
      console.log(`🔍 DEBUG: Final boundary height: ${poiHeight}, type: ${typeof poiHeight}`);
      
      return {
        success: true,
        data: {
          coordinates,
          center,
          area,
          confidence,
          source: 'osm' as const,
          elevation: elevationData,
          height: poiHeight || undefined
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
   * Extrai informações de endereço do resultado do Nominatim (já disponível)
   * MELHORIA INCREMENTAL: Adiciona extração do display_name sem remover lógica existente
   */
  private extractAddressFromNominatimResult(element: any): { street?: string; number?: string; city?: string; state?: string; country?: string; allStreets?: string[] } | null {
    // Se é resultado do Nominatim, usar tags do Overpass se disponível, senão usar tags do Nominatim
    const tags = element.tags || {};
    
    // MÉTODO 1: O Nominatim já retorna informações de endereço quando addressdetails=1 (MANTIDO)
    const addressFromTags = {
      street: tags['addr:street'] || tags['addr:road'] || tags['addr:pedestrian'],
      number: tags['addr:housenumber'],
      city: tags['addr:city'] || tags['addr:town'] || tags['addr:village'],
      state: tags['addr:state'],
      country: tags['addr:country']
    };
    
    // MÉTODO 2: NOVO - Extrair endereço do display_name se tags não tiverem street
    if (!addressFromTags.street && element.display_name) {
      console.log(`🔍 Trying to extract street from display_name: "${element.display_name}"`);
      
      // Parse do display_name: "Edifício Copan, Rua Araújo, Vila Buarque, República, São Paulo..."
      const displayParts = element.display_name.split(',').map((part: string) => part.trim());
      
      // Procurar por TODAS as ruas no display_name (múltiplas ruas)
      // Prioridade: Rua > Travessa > Alameda > Praça > Avenida > Estrada
      const streetPatterns = [
        { pattern: /^rua\s+/i, priority: 1, prefix: 'Rua' },
        { pattern: /^travessa\s+/i, priority: 2, prefix: 'Travessa' },
        { pattern: /^alameda\s+/i, priority: 3, prefix: 'Alameda' },
        { pattern: /^praça\s+/i, priority: 4, prefix: 'Praça' },
        { pattern: /^avenida\s+/i, priority: 5, prefix: 'Avenida' },
        { pattern: /^estrada\s+/i, priority: 6, prefix: 'Estrada' }
      ];
      
      const foundStreets: Array<{ name: string; priority: number; prefix: string }> = [];
      
      for (const part of displayParts) {
        const lowerPart = part.toLowerCase();
        
        for (const { pattern, priority, prefix } of streetPatterns) {
          if (pattern.test(lowerPart)) {
            const streetName = part.replace(pattern, '');
            console.log(`🔍 Found street: "${prefix} ${streetName}" (priority: ${priority})`);
            foundStreets.push({ name: streetName, priority, prefix });
            break; // Sair do loop de patterns para esta parte
          }
        }
      }
      
      if (foundStreets.length > 0) {
        // Ordenar por prioridade (menor número = maior prioridade)
        foundStreets.sort((a, b) => a.priority - b.priority);
        
        // Usar a rua com maior prioridade como principal
        const primaryStreet = foundStreets[0];
        console.log(`✅ Extracted primary street: "${primaryStreet.name}" (priority: ${primaryStreet.priority})`);
        
        // Log todas as ruas encontradas
        if (foundStreets.length > 1) {
          console.log(`📍 All streets found: ${foundStreets.map(s => `${s.prefix} ${s.name}`).join(', ')}`);
        }
        
        return {
          ...addressFromTags,
          street: primaryStreet.name,
          // NOVO: Adicionar todas as ruas encontradas para uso posterior
          allStreets: foundStreets.map(s => s.name)
        };
      }
    }
    
    // MÉTODO 3: NOVO - Verificar tags de entrada e orientação
    if (tags.entrance === 'main' || tags.orientation === 'front') {
      console.log(`🏠 Found entrance/orientation tags: entrance=${tags.entrance}, orientation=${tags.orientation}`);
      // Se tem tags de entrada, a rua do endereço é provavelmente a fachada principal
      if (addressFromTags.street) {
        console.log(`✅ Using address street as front facade: "${addressFromTags.street}"`);
      }
    }
    
    // Retornar resultado original (tags) se não encontrou no display_name
    return addressFromTags;
  }

  /**
   * M1: Compara cidades normalizando acentos e case
   */
  private compareCities(osmCity: string | undefined, poiCity: string): boolean {
    if (!osmCity) return true; // Se OSM não tem cidade, não rejeita
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return normalize(osmCity) === normalize(poiCity);
  }

  /**
   * NOVO: Determina pontos de acesso usando lógica existente (DRY - reutiliza determineAccessPoints)
   */
  private determineAccessPointsFromTags(nominatimResult: any): string[] | null {
    // Reutilizar lógica existente de app/api/pois/enrich-osm/route.ts
    const tags = nominatimResult?.extratags || {};
    
    const accessPoints: string[] = [];
    if (tags.entrance) accessPoints.push('main_entrance');
    if (tags['entrance:secondary']) accessPoints.push('secondary_entrance');
    
    return accessPoints.length > 0 ? accessPoints : null;
  }

  /**
   * Extrai altura do POI das tags OSM (versão escalável para múltiplos elementos)
   */
  private extractOSMHeight(element: any): number | null {
    if (!element.tags) return null;
    
    // Tags de altura de construções (ordenadas por prioridade)
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
   * Extrai altura de múltiplos elementos OSM (sistema escalável)
   * Busca por elementos arquitetônicos relacionados ao POI principal
   */
  private extractHeightFromMultipleElements(elements: any[], poiCenter: { lat: number; lng: number }, boundary?: BoundaryData): number | null {
    if (!elements || elements.length === 0) return null;
    
    
    const heightData: Array<{ height: number; element: any; distance: number; type: string }> = [];
    
    // Analisar cada elemento (todos já estão dentro do boundary)
    for (const element of elements) {
      const height = this.extractOSMHeight(element);
      if (height && height > 0) {
        // Calcular distância do elemento ao centro do POI
        const elementCenter = this.calculateElementCenter(element);
        const distance = elementCenter ? this.calculateDistance(poiCenter, elementCenter) : 0;
        
        // Classificar tipo de elemento
        const elementType = this.classifyElementType(element);
        
        heightData.push({
          height,
          element,
          distance,
          type: elementType
        });
        
      }
    }
    
    if (heightData.length === 0) {
      console.log(`⚠️ No height data found in any OSM elements inside boundary`);
      return null;
    }
    
    
    // Aplicar lógica de agregação inteligente
    const finalHeight = this.aggregateHeightsFromSameStructure(heightData);
    
    // console.log(`🏗️ Height aggregation result: ${finalHeight}m from ${heightData.length} boundary elements`);
    return finalHeight;
  }

  /**
   * Classifica o tipo de elemento arquitetônico
   */
  private classifyElementType(element: any): string {
    const tags = element.tags || {};
    
    // Prioridade: elementos mais altos e significativos
    if (tags['building:part'] === 'tower' || tags['tower:type']) {
      return 'tower';
    }
    if (tags['building:part'] === 'spire') {
      return 'spire';
    }
    if (tags['building:part'] === 'dome' || tags['building:part'] === 'cupola') {
      return 'dome';
    }
    if (tags['man_made'] === 'tower') {
      return 'man_made_tower';
    }
    if (tags['man_made'] === 'monument') {
      return 'monument';
    }
    if (tags['building:part']) {
      return 'building_part';
    }
    if (tags['building']) {
      return 'building';
    }
    
    return 'other';
  }

  /**
   * Calcula o centro de um elemento OSM
   */
  private calculateElementCenter(element: any): { lat: number; lng: number } | null {
    if (element.geometry && element.geometry.coordinates) {
      // Para ways (linhas/polígonos)
      if (Array.isArray(element.geometry.coordinates[0])) {
        const coords = element.geometry.coordinates[0];
        if (coords.length > 0) {
          const lng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
          const lat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
          return { lat, lng };
        }
      }
    }
    return null;
  }

  /**
   * Verifica se um elemento faz parte da mesma estrutura do POI
   */
  private isElementPartOfPOIStructure(element: any, poiCenter: { lat: number; lng: number }, boundary?: BoundaryData): boolean {
    const tags = element.tags || {};
    const elementCenter = this.calculateElementCenter(element);
    
    if (!elementCenter) {
      console.log(`⚠️ Cannot determine element center - assuming external`);
      return false;
    }
    
    // 1. VERIFICAÇÃO DE DISTÂNCIA: Elemento muito distante?
    const distance = this.calculateDistance(poiCenter, elementCenter);
    if (distance > TRIGGER_POINTS_CONSTANTS.distances.maxElementDistance) { // Distância máxima configurável
      console.log(`❌ Element too far (${distance.toFixed(0)}m > 100m) - external`);
      return false;
    }
    
    // 2. VERIFICAÇÃO DE BOUNDARY: Elemento dentro do boundary do POI?
    if (boundary && boundary.coordinates) {
      const isInsideBoundary = this.isPointInsidePolygon(elementCenter, boundary.coordinates);
      if (isInsideBoundary) {
        console.log(`✅ Element inside POI boundary - same structure`);
        return true;
      }
    }
    
    // 3. VERIFICAÇÃO DE TAGS: Elemento tem tags que indicam relação?
    const hasStructuralRelation = this.hasStructuralRelationTags(tags);
    if (hasStructuralRelation) {
      console.log(`✅ Element has structural relation tags - same structure`);
      return true;
    }
    
    // 4. VERIFICAÇÃO DE PROXIMIDADE: Elemento muito próximo (<30m)?
    if (distance <= TRIGGER_POINTS_CONSTANTS.distances.veryCloseDistance) {
      console.log(`✅ Element very close (${distance.toFixed(0)}m ≤ ${TRIGGER_POINTS_CONSTANTS.distances.veryCloseDistance}m) - likely same structure`);
      return true;
    }
    
    console.log(`❌ Element external (${distance.toFixed(0)}m, no relation tags) - external`);
    return false;
  }
  
  /**
   * Verifica se as tags indicam relação estrutural
   */
  private hasStructuralRelationTags(tags: any): boolean {
    // Tags que indicam que é parte de uma estrutura maior
    const structuralTags = [
      'building:part', 'part_of', 'building:use', 'building:levels',
      'amenity', 'tourism', 'historic', 'religion'
    ];
    
    // Se tem building:part, provavelmente é parte da mesma estrutura
    if (tags['building:part']) {
      return true;
    }
    
    // Se tem tags de amenity/tourism similares, pode ser parte do complexo
    if (tags['amenity'] || tags['tourism'] || tags['historic'] || tags['religion']) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Verifica se um ponto está dentro de um polígono
   */
  private isPointInsidePolygon(point: { lat: number; lng: number }, polygon: Array<{ lat: number; lng: number }>): boolean {
    // Implementação simples do ray casting algorithm
    let inside = false;
    const { lat, lng } = point;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const { lat: latI, lng: lngI } = polygon[i];
      const { lat: latJ, lng: lngJ } = polygon[j];
      
      if (((latI > lat) !== (latJ > lat)) && 
          (lng < (lngJ - lngI) * (lat - latI) / (latJ - latI) + lngI)) {
        inside = !inside;
      }
    }
    
    return inside;
  }
  
  /**
   * Agrega alturas de elementos da mesma estrutura
   */
  private aggregateHeightsFromSameStructure(heightData: Array<{ height: number; element: any; distance: number; type: string }>): number {
    if (heightData.length === 1) {
      return heightData[0].height;
    }
    
    // Priorizar elementos arquitetônicos significativos
    const significantElements = heightData.filter(item => 
      ['tower', 'spire', 'man_made_tower', 'monument'].includes(item.type)
    );
    
    if (significantElements.length > 0) {
      // Usar altura máxima dos elementos significativos
      const maxHeight = Math.max(...significantElements.map(item => item.height));
      // console.log(`🏗️ Using max height from significant elements: ${maxHeight}m`);
      return maxHeight;
    }
    
    // Fallback: usar altura máxima de todos os elementos da mesma estrutura
    const maxHeight = Math.max(...heightData.map(item => item.height));
    // console.log(`🏗️ Using max height from same-structure elements: ${maxHeight}m`);
    return maxHeight;
  }
  
  /**
   * Agrega alturas de múltiplos elementos usando lógica inteligente
   */
  private aggregateHeights(heightData: Array<{ height: number; element: any; distance: number; type: string }>): number {
    if (heightData.length === 1) {
      return heightData[0].height;
    }
    
    // Filtrar elementos muito distantes (>300m)
    const nearbyElements = heightData.filter(item => item.distance <= 300);
    if (nearbyElements.length === 0) {
      return heightData[0].height; // Fallback para o primeiro
    }
    
    // Priorizar elementos arquitetônicos significativos
    const significantElements = nearbyElements.filter(item => 
      ['tower', 'spire', 'man_made_tower', 'monument'].includes(item.type)
    );
    
    if (significantElements.length > 0) {
      // Usar altura máxima dos elementos significativos
      const maxHeight = Math.max(...significantElements.map(item => item.height));
      // console.log(`🏗️ Using max height from significant elements: ${maxHeight}m`);
      return maxHeight;
    }
    
    // Fallback: usar altura máxima de todos os elementos próximos
    const maxHeight = Math.max(...nearbyElements.map(item => item.height));
    // console.log(`🏗️ Using max height from all nearby elements: ${maxHeight}m`);
    return maxHeight;
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
    console.log(`🎯 Calculating small radius for unfound POI (likely small/irrelevant)`);
    
    // Raios MUITO MENORES para POIs não encontrados (provavelmente irrelevantes)
    const baseRadii: Record<string, number> = {
      'park': 50,           // Parques pequenos
      'museum': 20,         // Museus pequenos
      'monument': 15,       // Monumentos pontuais
      'restaurant': 10,     // Restaurantes
      'hotel': 15,          // Hotéis pequenos
      'shopping_mall': 30,  // Shopping pequeno
      'tourist_attraction': 25,
      'natural_feature': 40,
      'building': 15,       // Prédios pequenos
      'establishment': 10,  // Estabelecimentos gerais
      'point_of_interest': 15
    };
    
    let baseRadius = baseRadii[poiType] || 15; // Default muito pequeno
    
    // Ajustar baseado na densidade urbana (POIs pequenos em zonas densas)
    switch (context.urbanDensity.level) {
      case 'very_dense':
        baseRadius *= 0.8;  // Ainda menores em zonas densas
        break;
      case 'dense':
        baseRadius *= 0.9;
        break;
      case 'medium':
        baseRadius *= 1.0;
        break;
      case 'low':
        baseRadius *= 1.1;
        break;
      case 'rural':
        baseRadius *= 1.2;
        break;
    }
    
    // Limites muito conservadores para POIs não encontrados
    const finalRadius = Math.max(TRIGGER_POINTS_CONSTANTS.distances.minBoundaryRadius, Math.min(baseRadius, TRIGGER_POINTS_CONSTANTS.distances.maxBoundaryRadius)); // Limites configuráveis
    
    console.log(`📏 Small POI estimated radius: ${finalRadius}m (conservative for unfound POI)`);
    return finalRadius;
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
  
  /**
   * Extrai palavras-chave do nome para busca flexível no OSM
   */
  private extractNameKeywords(name: string): string[] {
    // Remover acentos e caracteres especiais
    const normalized = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    
    // Dividir em palavras e filtrar palavras relevantes
    const words = normalized
      .split(/\s+/)
      .filter(word => word.length > 2) // Palavras com mais de 2 caracteres
      .filter(word => !['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'para'].includes(word)); // Remover preposições
    
    // Adicionar variações comuns
    const keywords = [...words];
    
    // Para "Edifício", adicionar variações
    if (name.toLowerCase().includes('edifício') || name.toLowerCase().includes('edificio')) {
      keywords.push('building', 'edifício', 'edificio');
    }
    
    // Para "Copan", pode ser "Copacabana"
    if (name.toLowerCase().includes('copan')) {
      keywords.push('copan', 'copacabana');
    }
    
    console.log(`📝 Name keywords extracted from "${name}": ${keywords.join(', ')}`);
    return keywords;
  }
  
  /**
   * Processa geometria do Nominatim (GeoJSON)
   */
  private async processNominatimGeometry(
    geojson: any, 
    lat: number, 
    lng: number
  ): Promise<{ success: boolean; coordinates: Array<{lat: number, lng: number}> }> {
    try {
      let coordinates: Array<{lat: number, lng: number}> = [];
      
      if (geojson.type === 'Polygon' && geojson.coordinates && geojson.coordinates[0]) {
        // Converter coordenadas [lng, lat] para {lat, lng}
        coordinates = geojson.coordinates[0].map((coord: number[]) => ({
          lat: coord[1],
          lng: coord[0]
        }));
      } else if (geojson.type === 'MultiPolygon' && geojson.coordinates && geojson.coordinates[0]) {
        // Pegar o primeiro polígono do MultiPolygon
        coordinates = geojson.coordinates[0][0].map((coord: number[]) => ({
          lat: coord[1],
          lng: coord[0]
        }));
      } else if (geojson.type === 'Point') {
        // Se for apenas um ponto, criar um pequeno polígono ao redor
        const radius = 50; // 50 metros
        coordinates = this.createCircularBoundary({ lat, lng }, radius);
      }
      
      // Validar se temos coordenadas suficientes
      if (coordinates.length < 3) {
        console.warn(`⚠️ Insufficient coordinates: ${coordinates.length}`);
        return { success: false, coordinates: [] };
      }
      
      // Fechar o polígono se necessário
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      if (first.lat !== last.lat || first.lng !== last.lng) {
        coordinates.push(first);
      }
      
      console.log(`✅ Processed ${coordinates.length} coordinates from Nominatim`);
      return { success: true, coordinates };
      
    } catch (error) {
      console.error('Error processing Nominatim geometry:', error);
      return { success: false, coordinates: [] };
    }
  }
  
  /**
   * Calcula centro de um polígono
   */
  private calculatePolygonCenter(coordinates: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
    let totalLat = 0;
    let totalLng = 0;
    const count = coordinates.length;
    
    for (const coord of coordinates) {
      totalLat += coord.lat;
      totalLng += coord.lng;
    }
    
    return {
      lat: totalLat / count,
      lng: totalLng / count
    };
  }
  
  /**
   * Calcula área de um polígono (aproximação simples)
   */
  private calculatePolygonArea(coordinates: Array<{lat: number, lng: number}>): number {
    if (coordinates.length < 3) return 0;
    
    let area = 0;
    const n = coordinates.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += coordinates[i].lat * coordinates[j].lng;
      area -= coordinates[j].lat * coordinates[i].lng;
    }
    
    area = Math.abs(area) / 2;
    
    // Converter para metros quadrados (aproximação)
    const metersPerDegree = TRIGGER_POINTS_CONSTANTS.geographic.metersPerDegree;
    return area * metersPerDegree * metersPerDegree;
  }
  
  /**
   * 🎯 NOVO: Expande o boundary para fora por uma distância específica
   * Usado para buscar ruas FORA do boundary, não dentro dele
   */
  private expandBoundary(coordinates: Array<{lat: number, lng: number}>, distanceMeters: number): Array<{lat: number, lng: number}> {
    if (coordinates.length < 3) {
      console.warn(`⚠️ Cannot expand boundary: insufficient coordinates (${coordinates.length})`);
      return coordinates;
    }
    
    console.log(`🎯 Expanding boundary by ${distanceMeters}m outward (${coordinates.length} points)`);
    
    const expandedCoordinates: Array<{lat: number, lng: number}> = [];
    
    for (let i = 0; i < coordinates.length; i++) {
      const current = coordinates[i];
      const next = coordinates[(i + 1) % coordinates.length];
      const prev = coordinates[(i - 1 + coordinates.length) % coordinates.length];
      
      // Calcular vetores para os pontos adjacentes
      const toNext = {
        lat: next.lat - current.lat,
        lng: next.lng - current.lng
      };
      const toPrev = {
        lat: current.lat - prev.lat,
        lng: current.lng - prev.lng
      };
      
      // Normalizar vetores (DRY: usar função utilitária)
      const lengthNext = this.calculateVectorLength(toNext);
      const lengthPrev = this.calculateVectorLength(toPrev);
      
      if (lengthNext > 0 && lengthPrev > 0) {
        const normalizedNext = {
          lat: toNext.lat / lengthNext,
          lng: toNext.lng / lengthNext
        };
        const normalizedPrev = {
          lat: toPrev.lat / lengthPrev,
          lng: toPrev.lng / lengthPrev
        };
        
        // Calcular vetor normal (perpendicular) apontando para fora
        const normal = {
          lat: (normalizedNext.lat + normalizedPrev.lat) / 2,
          lng: (normalizedNext.lng + normalizedPrev.lng) / 2
        };
        
        // Normalizar o vetor normal (DRY: usar função utilitária)
        const normalLength = this.calculateVectorLength(normal);
        if (normalLength > 0) {
          normal.lat /= normalLength;
          normal.lng /= normalLength;
        }
        
        // Converter distância em metros para graus (aproximação)
        const distanceDegrees = distanceMeters / TRIGGER_POINTS_CONSTANTS.geographic.metersPerDegree;
        
        // Expandir o ponto para fora
        const expandedPoint = {
          lat: current.lat + normal.lat * distanceDegrees,
          lng: current.lng + normal.lng * distanceDegrees
        };
        
        expandedCoordinates.push(expandedPoint);
      } else {
        // Fallback: usar o ponto original se não conseguir calcular normal
        expandedCoordinates.push(current);
      }
    }
    
    console.log(`✅ Expanded boundary: ${coordinates.length} → ${expandedCoordinates.length} points`);
    return expandedCoordinates;
  }
  
  /**
   * 🎯 NOVO: Calcula o comprimento de um vetor 2D
   * DRY: Evita duplicação de Math.sqrt(lat² + lng²)
   */
  private calculateVectorLength(vector: { lat: number; lng: number }): number {
    return Math.sqrt(vector.lat * vector.lat + vector.lng * vector.lng);
  }
}
