// Detector de boundaries usando Google APIs com fallback para OSM

import { GoogleAPIsService } from '../services/google-apis.service';
import { ElevationService } from '../services/elevation.service';
import { POIData, GeographicContext, BoundaryData, ProcessingResult } from '../types/interfaces';
import { convertViewportToPolygon, calculatePolygonArea, calculatePolygonAreaInM2, calculatePolygonCenter, calculateDistance } from '../utils/calculations';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { getSupabase } from '../../../core/supabase-client';

export class BoundaryDetector {
  private googleAPIs: GoogleAPIsService;
  private elevationService: ElevationService;
  
  /**
   * 🔄 RETRY COM BACKOFF EXPONENCIAL para queries OSM (QUALIDADE > VELOCIDADE)
   * Retry até conseguir os dados necessários, não continua sem eles
   */
  private async retryOSMQuery(
    query: string,
    description: string,
    maxRetries: number = 5,
    initialDelay: number = 2000 // 2 segundos inicial
  ): Promise<Response> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timeout = 100000; // 100s timeout por tentativa
        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: query,
          headers: { 'Content-Type': 'text/plain' },
          signal: AbortSignal.timeout(timeout)
        });
        
        if (response.ok) {
          return response;
        }
        
        // Se não for timeout (504), pode ser outro erro - tentar novamente
        if (response.status === 504 || response.status === 429) {
          console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} failed: ${response.status} (timeout/rate limit)`);
        } else {
          console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} failed: ${response.status}`);
        }
        
        lastError = new Error(`OSM query failed: ${response.status}`);
        
        // Se não for a última tentativa, aguardar antes de retry
        if (attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt - 1); // Backoff exponencial: 2s, 4s, 8s, 16s, 32s
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} error:`, lastError.message);
        
        // Se não for a última tentativa, aguardar antes de retry
        if (attempt < maxRetries) {
          const delay = initialDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Se chegou aqui, todas as tentativas falharam
    console.error(`❌ [RETRY FAILED] ${description} failed after ${maxRetries} attempts`);
    throw lastError || new Error(`OSM query failed after ${maxRetries} attempts`);
  }
  
  constructor() {
    this.googleAPIs = new GoogleAPIsService();
    this.elevationService = new ElevationService();
  }
  
  /**
   * Detecta boundary de um POI usando múltiplas estratégias
   * ✅ REFATORADO: Não precisa de context - busca dados OSM primeiro, depois calcula densidade e classifica
   * 🆕 PRIORIDADE 1: OSM ID direto (se disponível)
   * PRIORIDADE 2: OSM por nome (mais preciso)
   * PRIORIDADE 3: Fallback estimado
   */
  async detectBoundary(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    const startTime = Date.now();
    
    try {
      // ✅ REGRA: OSM tem prioridade sobre banco de dados
      // 1. Buscar boundary no OSM primeiro (sempre verificar OSM)
      let osmBoundaryResult: ProcessingResult<BoundaryData> | null = null;
      
      // Tentar OSM ID direto primeiro (mais preciso)
      if (poiData.osm_id && poiData.osm_type) {
        osmBoundaryResult = await this.detectOSMBoundaryByID(
          String(poiData.osm_id), 
          poiData.osm_type, 
          poiData
        );
      }
      
      // Se OSM ID falhou, tentar busca por nome
      if (!osmBoundaryResult?.success) {
        osmBoundaryResult = await this.detectOSMBoundary(poiData);
      }
      
      // 2. Se OSM encontrou boundary, usar OSM (PRIORIDADE)
      if (osmBoundaryResult?.success && osmBoundaryResult.data) {
        return {
          success: true,
          data: { ...osmBoundaryResult.data, source: 'osm', osmIdentified: true },
          processingTime: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString(),
            strategy: 'osm_priority',
            database_boundary_found: false,
            osm_boundary_found: true,
            osm_identified: true
          }
        };
      }
      
      // 3. Se OSM não encontrou, buscar no banco de dados (fallback)
      let dbBoundaryResult: ProcessingResult<BoundaryData> | null = null;
      if (poiData.id) {
        dbBoundaryResult = await this.fetchBoundaryFromDatabase(poiData.id);
        if (dbBoundaryResult.success && dbBoundaryResult.data) {
          return {
            success: true,
            data: dbBoundaryResult.data,
            processingTime: Date.now() - startTime,
            metadata: {
              step: 'boundary_detection',
              status: 'completed',
              timestamp: new Date().toISOString(),
              strategy: 'database_fallback',
              database_boundary_found: true,
              osm_boundary_found: false
            }
          };
        }
      }
      
      // 4. Fallback final: POI não encontrado em nenhum lugar
      const estimatedResult = await this.createEstimatedBoundary(poiData);
      return {
        success: true,
        data: { ...estimatedResult, source: 'estimated', osmIdentified: false },
        processingTime: Date.now() - startTime,
        metadata: {
          step: 'boundary_detection',
          status: 'completed',
          timestamp: new Date().toISOString(),
          strategy: 'estimated_fallback',
          database_boundary_found: false,
          osm_boundary_found: false,
          osm_identified: false
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
   * 🆕 Busca boundary do banco de dados (PRIMEIRA PRIORIDADE)
   * POIs podem ter boundary corrigido manualmente ou desenhado à mão
   */
  private async fetchBoundaryFromDatabase(poiId: string): Promise<ProcessingResult<BoundaryData>> {
    try {
      const supabase = getSupabase('service');
      
      // ✅ Usar RPC para converter GEOGRAPHY para GeoJSON
      const { data: geojsonData, error: rpcError } = await supabase
        .schema('core')
        .rpc('get_boundary_geometry', { p_attraction_id: poiId });
      
      if (rpcError || !geojsonData) {
        return { success: false, error: 'No boundary found in database', processingTime: 0 };
      }
      
      // Buscar metadata do boundary
      const { data: metadata, error: metadataError } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select(`
          boundary_type,
          boundary_source,
          boundary_confidence,
          boundary_area_m2,
          boundary_centroid_lat,
          boundary_centroid_lng,
          latitude,
          longitude
        `)
        .eq('attraction_id', poiId)
        .maybeSingle();
      
      if (metadataError) {
        console.warn(`⚠️ Error fetching boundary metadata: ${metadataError.message}`);
      }
      
      // Converter GeoJSON string para objeto
      let geometry: any;
      try {
        geometry = typeof geojsonData === 'string' ? JSON.parse(geojsonData) : geojsonData;
      } catch (parseError) {
        console.warn(`⚠️ Error parsing GeoJSON: ${parseError}`);
        return { success: false, error: 'Invalid GeoJSON format', processingTime: 0 };
      }
      
      let coordinates: Array<{lat: number, lng: number}> = [];
      
      // Extrair coordenadas do GeoJSON
      if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
        // GeoJSON Polygon: coordinates[0] é o anel externo
        coordinates = geometry.coordinates[0].map((coord: [number, number]) => ({
          lng: coord[0], // GeoJSON usa [lng, lat]
          lat: coord[1]
        }));
      } else if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
        // MultiPolygon: usar o primeiro polígono
        if (geometry.coordinates[0] && geometry.coordinates[0][0]) {
          coordinates = geometry.coordinates[0][0].map((coord: [number, number]) => ({
            lng: coord[0],
            lat: coord[1]
          }));
        }
      } else if (geometry.type === 'Point') {
        // Point: criar boundary circular pequeno
        const center = {
          lat: geometry.coordinates[1],
          lng: geometry.coordinates[0]
        };
        coordinates = this.createCircularBoundary(center, 50); // 50m radius
      } else if (geometry.type === 'LineString') {
        // LineString: usar coordenadas diretamente
        coordinates = geometry.coordinates.map((coord: [number, number]) => ({
          lng: coord[0],
          lat: coord[1]
        }));
      } else {
        console.warn(`⚠️ Unsupported geometry type: ${geometry.type}`);
        // Fallback: usar coordenadas do centro se disponível
        if (metadata?.boundary_centroid_lat && metadata?.boundary_centroid_lng) {
          const center = {
            lat: Number(metadata.boundary_centroid_lat),
            lng: Number(metadata.boundary_centroid_lng)
          };
          coordinates = this.createCircularBoundary(center, 50);
        } else if (metadata?.latitude && metadata?.longitude) {
          const center = {
            lat: Number(metadata.latitude),
            lng: Number(metadata.longitude)
          };
          coordinates = this.createCircularBoundary(center, 50);
        } else {
          return { success: false, error: `Unsupported geometry type: ${geometry.type}`, processingTime: 0 };
        }
      }
      
      if (coordinates.length < 3) {
        return { success: false, error: 'Invalid boundary coordinates (need at least 3 points)', processingTime: 0 };
      }
      
      // Calcular centro e área
      const center = calculatePolygonCenter(coordinates);
      // ✅ Se metadata já tem área em m², usar; senão calcular usando função SSOT
      const area = metadata?.boundary_area_m2 ? Number(metadata.boundary_area_m2) : calculatePolygonAreaInM2(coordinates);
      const confidence = metadata?.boundary_confidence ? Number(metadata.boundary_confidence) : 0.8;
      
      const boundary: BoundaryData = {
        coordinates,
        center,
        area,
        confidence,
        source: (metadata?.boundary_source as 'osm' | 'nominatim' | 'manual' | 'estimated') || 'manual',
        // Metadata adicional
        osmTags: undefined,
        classification: undefined
      };
      
      
      return {
        success: true,
        data: boundary,
        processingTime: 0
      };
      
    } catch (error) {
      console.error(`Error fetching boundary from database:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error', 
        processingTime: 0 
      };
    }
  }
  
  /**
   * 🆕 Detecta boundary usando OSM ID diretamente (se disponível)
   * Estratégia consolidada: 1 query inicial com raio padrão, expande se necessário
   */
  private async detectOSMBoundaryByID(osmID: string, osmType: string, poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    try {
      
      // 🚀 ESTRATÉGIA CONSOLIDADA: Query inicial com raio padrão seguro (500m)
      // Isso cobre 95% dos casos (FLAT: 180m, CANYON: 75m, MEDIUM pequeno: <500m)
      const INITIAL_RADIUS = 500; // Raio padrão seguro que cobre maioria dos casos
      
      // Query OSM diretamente pelo ID + dados consolidados com raio inicial
      const query = `
[out:json][timeout:30];
${osmType}(${osmID});
out geom tags;
`;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' },
        signal: AbortSignal.timeout(40000)
      });
      
      if (!response.ok) {
        console.warn(`⚠️ OSM query failed for ${osmType}(${osmID}): ${response.status}`);
        return { success: false, error: `OSM query failed: ${response.status}`, processingTime: 0 };
      }
      
      const data = await response.json();
      const elements = data.elements || [];
      
      if (elements.length === 0) {
        console.warn(`⚠️ No OSM element found for ${osmType}(${osmID})`);
        return { success: false, error: 'OSM element not found', processingTime: 0 };
      }
      
      const element = elements[0];
      
      // Processar geometria
      let coordinates: Array<{ lat: number; lng: number }> = [];
      
      if (osmType === 'way' && element.geometry) {
        // Way: usar geometria diretamente
        coordinates = element.geometry.map((point: any) => ({
          lat: point.lat,
          lng: point.lon
        }));
      } else if (osmType === 'node') {
        // Node: criar boundary circular pequeno
        const center = { lat: element.lat, lng: element.lon };
        const radius = 10; // 10m para nodes
        coordinates = this.createCircularBoundary(center, radius);
      } else if (osmType === 'relation' && element.members) {
        // Relation: usar outer way
        // Por enquanto, criar boundary estimado
        const center = poiData.location;
        const radius = 20;
        coordinates = this.createCircularBoundary(center, radius);
      }
      
      if (coordinates.length < 3) {
        console.warn(`⚠️ Insufficient coordinates for ${osmType}(${osmID})`);
        return { success: false, error: 'Insufficient coordinates', processingTime: 0 };
      }
      
      const center = calculatePolygonCenter(coordinates);
      const area = calculatePolygonAreaInM2(coordinates); // ✅ DRY: usar função SSOT (retorna m²)
      
      // ✅ VALIDAÇÃO: Verificar se o boundary OSM corresponde à localização do POI
      const distanceFromPOI = calculateDistance(center, poiData.location);
      const maxAllowedDistance = 200; // 200m máximo de distância entre centro do boundary e localização do POI
      
      if (distanceFromPOI > maxAllowedDistance) {
        console.warn(`⚠️ OSM boundary center (${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}) is too far from POI location (${poiData.location.lat.toFixed(6)}, ${poiData.location.lng.toFixed(6)})`);
        console.warn(`   → Distance: ${distanceFromPOI.toFixed(0)}m (max allowed: ${maxAllowedDistance}m)`);
        console.warn(`   → OSM ID may be incorrect or element doesn't match POI - rejecting OSM boundary`);
        return { success: false, error: `OSM boundary too far from POI location (${distanceFromPOI.toFixed(0)}m > ${maxAllowedDistance}m)`, processingTime: 0 };
      }
      
      // ✅ VALIDAÇÃO ADICIONAL: Verificar se o nome/tags do elemento OSM correspondem ao POI
      const poiTags = element.tags || {};
      const osmName = poiTags.name || poiTags['name:pt'] || '';
      const poiNameLower = poiData.name.toLowerCase();
      const osmNameLower = osmName.toLowerCase();
      
      // Verificar correspondência de nome (parcial ou exata)
      const nameMatches = osmName && (
        osmNameLower === poiNameLower ||
        osmNameLower.includes(poiNameLower) ||
        poiNameLower.includes(osmNameLower) ||
        osmNameLower.replace(/\s+/g, '') === poiNameLower.replace(/\s+/g, '')
      );
      
      // Se distância está OK mas nome não corresponde, avisar mas não rejeitar (pode ser variação de nome)
      if (!nameMatches && osmName) {
        console.warn(`⚠️ OSM element name "${osmName}" doesn't match POI name "${poiData.name}"`);
        console.warn(`   → Distance is OK (${distanceFromPOI.toFixed(0)}m), but name mismatch suggests possible incorrect OSM ID`);
      }
      
      // Extrair tags e processar como no fluxo normal
      const poiHeight = this.extractOSMHeight({ tags: poiTags });
      
      // Buscar elevação
      const elevation = await this.elevationService.getElevation(center, undefined, { tags: poiTags });
      let elevationData;
      if (elevation && elevation.confidence > 0.5) {
        elevationData = {
          min: elevation.ground - 10,
          max: elevation.ground + 10,
          average: elevation.ground,
          center: elevation.total
        };
      }
      
      // 🚀 QUERY CONSOLIDADA INICIAL: Raio padrão seguro (500m)
      // ✅ CRÍTICO: Coletar dados OSM ANTES da classificação para calcular densidade correta
      const expandedBoundaryInitial = this.expandBoundary(coordinates, INITIAL_RADIUS);
      const expandedPolygonInitial = expandedBoundaryInitial.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
      
      const consolidatedQueryInitial = `
[out:json][timeout:90];
(
  ${osmType}(${osmID});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](poly:"${expandedPolygonInitial}");
  way["building"](poly:"${expandedPolygonInitial}");
  way["natural"~"^(tree|wood|forest)$"](poly:"${expandedPolygonInitial}");
  way["barrier"~"^(wall|fence|hedge)$"](poly:"${expandedPolygonInitial}");
  node["natural"~"^(peak|volcano)$"](poly:"${expandedPolygonInitial}");
  way["natural"~"^(peak|volcano|mountain)$"](poly:"${expandedPolygonInitial}");
);
out geom tags;
`;
      
      let consolidatedStreets: any[] = [];
      let consolidatedBuildings: any[] = [];
      let consolidatedVegetation: any[] = [];
      let consolidatedBarriers: any[] = [];
      let consolidatedPeaks: any[] = [];
      
      // 🔄 RETRY COM BACKOFF: Query consolidada é CRÍTICA
      const consolidatedResponseInitial = await this.retryOSMQuery(
        consolidatedQueryInitial,
        'Consolidated OSM query (POI + streets + buildings)',
        5, // 5 tentativas
        2000 // 2s delay inicial
      );
      
      if (consolidatedResponseInitial.ok) {
        const consolidatedData = await consolidatedResponseInitial.json();
        const consolidatedElements = consolidatedData.elements || [];
        
        for (const el of consolidatedElements) {
          if (el.tags?.highway) {
            consolidatedStreets.push(el);
          } else if (el.tags?.building) {
            consolidatedBuildings.push(el);
          } else if (el.tags?.natural === 'peak' || el.tags?.natural === 'volcano' || el.tags?.natural === 'mountain') {
            consolidatedPeaks.push(el);
          } else if (el.tags?.natural) {
            consolidatedVegetation.push(el);
          } else if (el.tags?.barrier) {
            consolidatedBarriers.push(el);
          }
        }
        
      } else {
        console.warn(`⚠️ Initial consolidated query failed: ${consolidatedResponseInitial.status}`);
      }
      
      // ===============================================
      // STEP 2: RECALCULAR DENSIDADE URBANA COM DADOS OSM COLETADOS
      // ===============================================
      // ✅ CRÍTICO: Recalcular densidade urbana ANTES da classificação
      // usando os dados de buildings/streets já coletados
      
      // Processar dados coletados
      let processedStreets = this.processOSMStreets(consolidatedStreets, coordinates); // ✅ let para permitir reatribuição se houver query expandida
      const processedBuildings = this.processOSMBuildings(consolidatedBuildings);
      const processedVegetation = this.processOSMVegetation(consolidatedVegetation);
      const processedBarriers = this.processOSMBarriers(consolidatedBarriers);
      const processedPeaks = this.processOSMPeaks(consolidatedPeaks);
      
      // Criar boundary temporário com dados coletados para cálculo de densidade
      const tempBoundaryForDensity: BoundaryData = {
        coordinates,
        center,
        area,
        confidence: 0.8,
        source: 'osm',
        streets: processedStreets,
        buildings: processedBuildings,
        vegetation: processedVegetation,
        barriers: processedBarriers,
        peaks: processedPeaks, // ✅ SSLT: dados já coletados
        height: poiHeight || undefined
      };
      
      // Calcular densidade urbana usando dados OSM coletados (PRIMEIRA VEZ - sem redundância)
      const GeographicContextAnalyzer = (await import('./geographic-analyzer')).GeographicContextAnalyzer;
      const geographicAnalyzer = new GeographicContextAnalyzer();
      const contextForClassification = await geographicAnalyzer.analyzeGeographicContext(poiData, tempBoundaryForDensity);
      
      
      // ===============================================
      // STEP 3: CLASSIFICAR POI
      // ===============================================
      
      const POIClassifierService = (await import('../services/poi-classifier.service')).POIClassifierService;
      const classifier = new POIClassifierService();
      const classification = await classifier.classifyPOI(
        poiData,
        poiHeight || undefined,
        elevationData ? { center: elevationData.center } : undefined,
        area,
        contextForClassification, // ✅ Usar contexto atualizado com densidade correta
        poiTags
      );
      
      
      // 🎯 BULLET 2: Calcular tamanho do boundary (raio máximo do centro até o ponto mais distante)
      const maxBoundaryRadius = Math.max(
        ...coordinates.map(coord => calculateDistance(center, coord))
      );
      
      // 🎯 BULLET 3: O raio de busca é SEMPRE a partir do BOUNDARY (perímetro), não do centro
      // Para FLAT: 120m significa 120m FORA do boundary, não do centro
      const requiredRadius = classification.searchRadius; // Raio a partir do boundary
      const totalSearchRadiusFromCenter = maxBoundaryRadius + requiredRadius; // Raio total do centro
      
      
      // 🎯 BULLET 3: Verificar se os dados de ruas obtidos são suficientes
      // A busca inicial expande o boundary por INITIAL_RADIUS para fora
      // Se o boundary já tem maxBoundaryRadius, e queremos requiredRadius do boundary,
      // precisamos buscar a (maxBoundaryRadius + requiredRadius) do centro
      const initialSearchCovers = totalSearchRadiusFromCenter <= INITIAL_RADIUS;
      
      // 🚀 QUERY EXPANDIDA: Se busca inicial não foi suficiente, buscar ruas expandidas
      if (!initialSearchCovers) {
        
        // ✅ CORRETO: Expandir o boundary por requiredRadius (a partir do perímetro)
        const expandedBoundaryFinal = this.expandBoundary(coordinates, requiredRadius);
        const expandedPolygonFinal = expandedBoundaryFinal.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
        
        // Query expandida apenas para ruas (mais leve que buscar tudo)
        const expandedStreetsQuery = `
[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](poly:"${expandedPolygonFinal}");
);
out geom tags;
`;
        
        try {
          // 🔄 RETRY COM BACKOFF: Query expandida é importante para POIs grandes
          // ✅ QUALIDADE > VELOCIDADE: Aumentar tentativas para garantir dados
          console.log(`🔄 [IMPORTANT] Fetching expanded streets (radius: ${requiredRadius}m) - will retry up to 5 times if timeout`);
          const expandedStreetsResponse = await this.retryOSMQuery(
            expandedStreetsQuery,
            `Expanded streets query (${requiredRadius}m radius)`,
            5, // ✅ 5 tentativas (igual ao padrão, crítico para POIs grandes)
            3000 // 3s delay inicial (backoff exponencial: 3s, 6s, 12s, 24s, 48s)
          );
          
          if (expandedStreetsResponse.ok) {
            const expandedData = await expandedStreetsResponse.json();
            const expandedElements = expandedData.elements || [];
            
            // Mesclar ruas expandidas (substituir ruas iniciais)
            const expandedStreets = expandedElements.filter((el: any) => el.tags?.highway);
            consolidatedStreets = expandedStreets;
            
            // ✅ Reprocessar ruas expandidas
            processedStreets = this.processOSMStreets(consolidatedStreets, coordinates);
            
            console.log(`✅ Expanded query: ${consolidatedStreets.length} streets (merged with initial data)`);
          } else {
            console.warn(`⚠️ Expanded streets query failed: ${expandedStreetsResponse.status}, using initial data`);
            // Usar dados iniciais como fallback
          }
        } catch (error) {
          console.warn(`⚠️ Expanded streets query error: ${error}, using initial data`);
          // Usar dados iniciais como fallback
        }
      } else {
      }
      
      const boundary: BoundaryData = {
        coordinates,
        center,
        area,
        confidence: 0.95, // Alta confiança quando temos OSM ID
        source: 'osm',
        height: poiHeight || undefined,
        elevation: elevationData,
        osmTags: poiTags,
        classification,
        streets: processedStreets, // ✅ Usar dados processados
        buildings: processedBuildings, // ✅ Usar dados processados
        vegetation: processedVegetation, // ✅ Usar dados processados
        barriers: processedBarriers, // ✅ Usar dados processados
        peaks: processedPeaks // ✅ SSLT: dados já coletados na query consolidada
      };
      
      
      return {
        success: true,
        data: boundary,
        processingTime: 0
      };
      
    } catch (error) {
      console.error(`Error detecting boundary by OSM ID:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error', processingTime: 0 };
    }
  }
  
  /**
   * Cria boundary circular (para nodes)
   */
  private createCircularBoundary(center: { lat: number; lng: number }, radius: number): Array<{ lat: number; lng: number }> {
    const points: Array<{ lat: number; lng: number }> = [];
    const numPoints = 16; // 16 pontos para círculo suave
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const lat = center.lat + (radius / 111320) * Math.cos(angle);
      const lng = center.lng + (radius / (111320 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle);
      points.push({ lat, lng });
    }
    
    return points;
  }
  
  /**
   * Converte elemento OSM de rua para StreetData
   */
  private convertOSMStreetToStreetData(osmElement: any): any {
    const coordinates = osmElement.geometry ? osmElement.geometry.map((p: any) => ({
      lat: p.lat,
      lng: p.lon
    })) : [];
    
    return {
      id: `osm_way_${osmElement.id}`,
      type: osmElement.tags?.highway || 'unclassified',
      name: osmElement.tags?.name,
      coordinates,
      accessibility: osmElement.tags?.access === 'no' ? 'restricted' : 'public',
      confidence: 0.9,
      tags: osmElement.tags
    };
  }
  
  /**
   * Detecta boundary usando Google Places API com múltiplas estratégias
   */
  private async detectGoogleBoundary(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    try {
      
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
    
    const area = calculatePolygonAreaInM2(coordinates); // ✅ DRY: usar função SSOT (retorna m²)
    
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
    return calculateDistance(location, placeLocation); // ✅ DRY: usar função SSOT
  }
  
  // ✅ DRY: calculateDistance removido - usar função importada de utils/calculations.ts
  
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
   * Processa elementos de picos/montanhas do OSM
   * ✅ SSLT: Reutilizar dados já coletados na query consolidada
   */
  private processOSMPeaks(peakElements: any[]): any[] {
    return peakElements.map((element: any) => {
      // Para nodes, coordenadas podem vir diretamente ou em geometry
      let coordinates: Array<{ lat: number; lng: number }> = [];
      
      if (element.type === 'node') {
        if (element.lat && element.lon) {
          coordinates = [{ lat: element.lat, lng: element.lon }];
        } else if (element.geometry && element.geometry.length > 0) {
          const point = element.geometry[0];
          if (point && point.lat && point.lon) {
            coordinates = [{ lat: point.lat, lng: point.lon }];
          }
        }
      } else if (element.geometry && element.geometry.length > 0) {
        // Para ways, usar geometry
        coordinates = element.geometry.map((point: any) => ({
          lat: point.lat,
          lng: point.lon
        }));
      }
      
      return {
        id: `osm_peak_${element.id}`,
        type: 'peak',
        coordinates,
        tags: element.tags || {},
        naturalType: element.tags?.natural || 'unknown',
        osmType: element.type // 'node' ou 'way'
      };
    });
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
   * Gera variações do nome do POI para busca no OSM
   * Extrai partes do nome, remove parênteses, traços, etc.
   */
  private generateNameVariations(name: string): string[] {
    const variations: string[] = [];
    const nameLower = name.toLowerCase();
    
    // 1. Nome original (primeira tentativa)
    variations.push(name);
    
    // 2. Remover conteúdo entre parênteses (ex: "Estádio Nabi Abi Chedid (Arena Red Bull)" -> "Estádio Nabi Abi Chedid")
    const withoutParens = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (withoutParens !== name && withoutParens.length > 3) {
      variations.push(withoutParens);
    }
    
    // 3. Remover conteúdo entre colchetes
    const withoutBrackets = name.replace(/\s*\[[^\]]*\]\s*/g, '').trim();
    if (withoutBrackets !== name && withoutBrackets.length > 3) {
      variations.push(withoutBrackets);
    }
    
    // 4. Remover tudo após traço (ex: "Nome - Sufixo" -> "Nome")
    const withoutDash = name.split(' - ')[0].split(' – ')[0].trim();
    if (withoutDash !== name && withoutDash.length > 3) {
      variations.push(withoutDash);
    }
    
    // 5. Variações específicas por tipo de POI
    if (nameLower.includes('estádio') || nameLower.includes('stadium') || nameLower.includes('arena')) {
      // Para estádios: remover prefixo "Estádio" ou "Arena"
      variations.push(
        name.replace(/estádio\s+/gi, '').trim(),
        name.replace(/stadium\s+/gi, '').trim(),
        name.replace(/arena\s+/gi, '').trim()
      );
      // Pegar parte principal (ex: "Nabi Abi Chedid")
      const words = name.split(' ').filter(w => 
        w.length > 2 && 
        !w.match(/^(estádio|stadium|arena|red|bull)$/gi)
      );
      if (words.length > 0) {
        variations.push(words.join(' '));
        if (words.length > 1) {
          variations.push(words.slice(0, 2).join(' ')); // Primeiras 2 palavras
        }
      }
    } else if (nameLower.includes('museu') || nameLower.includes('museum')) {
      variations.push(
        name.replace(/museu\s+/gi, '').trim(),
        name.replace(/museum\s+/gi, '').trim()
      );
    } else if (nameLower.includes('parque') || nameLower.includes('park')) {
      variations.push(
        name.replace(/parque\s+/gi, '').trim(),
        name.replace(/park\s+/gi, '').trim()
      );
    } else if (nameLower.includes('igreja') || nameLower.includes('church') || nameLower.includes('catedral') || nameLower.includes('cathedral')) {
      variations.push(
        name.replace(/igreja\s+/gi, '').trim(),
        name.replace(/church\s+/gi, '').trim(),
        name.replace(/catedral\s+/gi, '').trim(),
        name.replace(/cathedral\s+/gi, '').trim()
      );
    }
    
    // 6. Variações genéricas: primeiras palavras, últimas palavras
    const words = name.split(' ').filter(w => w.length > 2);
    if (words.length > 1) {
      variations.push(
        words[0], // Primeira palavra
        words.slice(0, 2).join(' '), // Primeiras 2 palavras
        words.slice(-2).join(' '), // Últimas 2 palavras
        words[words.length - 1] // Última palavra
      );
    }
    
    // Remover duplicatas, strings vazias e muito curtas
    const uniqueVariations = [...new Set(variations)]
      .filter(term => term && term.trim().length > 2)
      .slice(0, 10); // Limitar a 10 variações para evitar muitas requisições
    
    return uniqueVariations;
  }
  
  /**
   * Extrai categoria do resultado do Nominatim
   * Retorna a categoria normalizada (ex: "stadium", "park", "museum")
   */
  private extractCategoryFromNominatim(result: any): string | null {
    try {
      const extratags = result.extratags || {};
      const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'railway', 'public_transport', 'shop', 'highway', 'building'];
      
      // Primeiro: buscar tags específicas (não *=yes)
      for (const tag of priorityTags) {
        if (extratags[tag] && extratags[tag] !== 'yes') {
          return extratags[tag]; // Retorna apenas o valor (ex: "stadium", "park")
        }
      }
      
      // Segundo: se não encontrou, buscar tags com valor "yes" mas usar o tipo da tag
      for (const tag of priorityTags) {
        if (extratags[tag] === 'yes') {
          // Se o tipo da tag é válido, usar ele como categoria
          if (tag !== 'building' && tag !== 'highway') { // building e highway são muito genéricos
            return tag;
          }
        }
      }
      
      // Terceiro: se ainda não encontrou, usar class/type do Nominatim
      if (result.class && result.type) {
        // Se type não for genérico, usar type
        if (result.type !== 'yes' && result.type !== 'no') {
          return result.type;
        } else if (result.class !== 'place' && result.class !== 'boundary') {
          // Caso contrário, usar class se não for muito genérico
          if (result.class !== 'building' && result.class !== 'highway') {
            return result.class;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Error extracting category from Nominatim:', error);
      return null;
    }
  }
  
  /**
   * Normaliza categoria do POI (Google type) para comparar com categoria OSM
   * Mapeia tipos do Google para categorias OSM equivalentes
   */
  private normalizePOICategory(poiType: string): string[] {
    const normalized = poiType.toLowerCase();
    const equivalentCategories: string[] = [];
    
    // 🆕 point_of_interest é um tipo genérico do Google Places - aceita qualquer categoria OSM válida
    if (normalized === 'point_of_interest') {
      // Lista de categorias OSM comuns que são válidas para point_of_interest
      return [
        'stadium', 'sports_centre', 'arena',
        'park', 'recreation_ground', 'garden',
        'museum', 'gallery',
        'church', 'cathedral', 'place_of_worship',
        'restaurant', 'cafe', 'fast_food',
        'hotel', 'hostel', 'motel',
        'attraction', 'viewpoint', 'monument',
        'mall', 'shopping_centre',
        'hospital', 'clinic',
        'school', 'university', 'college',
        'zoo', 'wildlife_park',
        'aquarium',
        'library',
        'theatre', 'cinema',
        'theme_park', 'amusement_ride',
        'beach',
        'peak', 'volcano',
        'lake', 'reservoir',
        'airport', 'aerodrome',
        'station', 'halt',
        'bus_station', 'bus_stop',
        'tourism', 'amenity', 'historic', 'natural', 'leisure',
        'point_of_interest' // Incluir o próprio tipo também
      ];
    }
    
    // Mapeamento de tipos Google para categorias OSM
    const categoryMap: Record<string, string[]> = {
      'stadium': ['stadium', 'sports_centre', 'arena'],
      'park': ['park', 'recreation_ground', 'garden'],
      'museum': ['museum', 'gallery'],
      'church': ['church', 'cathedral', 'place_of_worship'],
      'restaurant': ['restaurant', 'cafe', 'fast_food'],
      'hotel': ['hotel', 'hostel', 'motel'],
      'tourist_attraction': ['attraction', 'viewpoint', 'monument'],
      'shopping_mall': ['mall', 'shopping_centre'],
      'hospital': ['hospital', 'clinic'],
      'school': ['school', 'university', 'college'],
      'zoo': ['zoo', 'wildlife_park'],
      'aquarium': ['aquarium'],
      'library': ['library'],
      'theater': ['theatre', 'cinema'],
      'amusement_park': ['theme_park', 'amusement_ride'],
      'beach': ['beach'],
      'mountain': ['peak', 'volcano'],
      'lake': ['lake', 'reservoir'],
      'airport': ['airport', 'aerodrome'],
      'train_station': ['station', 'halt'],
      'bus_station': ['bus_station', 'bus_stop'],
      // 🆕 establishment é um tipo genérico do Google - aceita várias categorias naturais
      'establishment': ['peak', 'volcano', 'natural', 'park', 'attraction', 'viewpoint', 'monument', 'tourism', 'leisure', 'point_of_interest'],
      // 🆕 natural é uma categoria do banco - compatível com várias categorias OSM naturais
      'natural': ['peak', 'volcano', 'natural', 'park', 'mountain', 'hill', 'viewpoint']
    };
    
    // Buscar mapeamento direto
    if (categoryMap[normalized]) {
      equivalentCategories.push(...categoryMap[normalized]);
    }
    
    // Adicionar o tipo original também (caso seja compatível)
    if (!equivalentCategories.includes(normalized)) {
      equivalentCategories.push(normalized);
    }
    
    return equivalentCategories;
  }
  
  /**
   * Compara categoria do POI com categoria do Nominatim
   * Retorna true se as categorias são compatíveis
   */
  private compareCategories(poiType: string, osmCategory: string | null): boolean {
    if (!osmCategory) {
      // Se não encontrou categoria no OSM, não rejeitar (pode ser um POI sem categoria definida)
      return true;
    }
    
    // 🆕 Se poiType for 'unknown', aceitar qualquer categoria OSM (mais permissivo)
    if (poiType === 'unknown' || !poiType) {
      console.log(`ℹ️ POI type is 'unknown', accepting OSM category: ${osmCategory}`);
      return true;
    }
    
    const normalizedOsmCategory = osmCategory.toLowerCase();
    const equivalentCategories = this.normalizePOICategory(poiType);
    
    // Verificar se a categoria OSM está na lista de categorias equivalentes
    const isCompatible = equivalentCategories.some(cat => 
      normalizedOsmCategory === cat.toLowerCase() ||
      normalizedOsmCategory.includes(cat.toLowerCase()) ||
      cat.toLowerCase().includes(normalizedOsmCategory)
    );
    
    return isCompatible;
  }
  
  /**
   * Valida resultado do Nominatim pela distância, localidade e categoria
   * Retorna true se o resultado é válido para o POI
   * 🆕 Ajusta threshold dinamicamente baseado em confiança do match
   */
  private validateNominatimResult(
    result: any,
    poiData: POIData,
    maxDistance: number = 10 // metros - raio muito restritivo para evitar falsos positivos
  ): boolean {
    try {
      const resultLat = parseFloat(result.lat);
      const resultLng = parseFloat(result.lon);
      
      if (isNaN(resultLat) || isNaN(resultLng)) {
        return false;
      }
      
      // 1. Validar distância (com ajuste dinâmico para matches de alta confiança)
      const distance = calculateDistance( // ✅ DRY: usar função SSOT
        { lat: poiData.location.lat, lng: poiData.location.lng },
        { lat: resultLat, lng: resultLng }
      );
      
      // 🆕 Verificar se é um match de 100% (nome exato + mesma cidade/estado)
      const exactNameMatch = result.display_name?.toLowerCase().includes(poiData.name.toLowerCase()) ||
                             poiData.name.toLowerCase().includes(result.display_name?.toLowerCase() || '');
      
      // 🆕 IMPORTANTE: Se temos OSM ID, não precisamos validar cidade/estado
      // OSM IDs são únicos globalmente e já identificam o POI corretamente
      const hasOSMID = result.osm_id && result.osm_type;
      
      // 🆕 Verificar cidade e estado
      const osmCity = result.address?.city || result.extratags?.['addr:city'];
      const osmState = result.address?.state || result.extratags?.['is_in:state'];
      const cityMatch = !poiData.city || !osmCity || 
                       poiData.city.toLowerCase().includes(osmCity.toLowerCase()) ||
                       osmCity.toLowerCase().includes(poiData.city.toLowerCase());
      // 🆕 Normalizar estados brasileiros (RJ = Rio de Janeiro, SP = São Paulo, etc.)
      const stateMatch = !poiData.state || !osmState || 
                        this.normalizeBrazilianState(poiData.state) === this.normalizeBrazilianState(osmState);
      
      // 🆕 Match 100%: nome exato + mesma cidade/estado = aceitar independente da distância (até 500m)
      // OU: nome exato + OSM ID (não precisa validar cidade/estado)
      const isPerfectMatch = (exactNameMatch && cityMatch && stateMatch) || (exactNameMatch && hasOSMID);
      
      if (isPerfectMatch) {
        // Aceitar até 500m para matches perfeitos
        const perfectMatchMaxDistance = 500;
        if (distance <= perfectMatchMaxDistance) {
          // Pular validação de distância e categoria para matches perfeitos
        } else {
          console.log(`⚠️ Perfect match but too far: ${distance.toFixed(0)}m (max: ${perfectMatchMaxDistance}m)`);
          return false;
        }
      } else {
        // Para matches não perfeitos, usar lógica original
        const isHighConfidenceMatch = exactNameMatch && hasOSMID;
        const isBuilding = result.type === 'building' || 
                          result.class === 'building' ||
                          (result.osm_type === 'way' && result.type === 'way');
        
        // 🏔️ NOVO: Detectar peaks/picos/montanhas (landmarks naturais)
        const isPeak = result.type === 'peak' || 
                      result.class === 'peak' ||
                      result.type === 'natural' ||
                      result.class === 'natural' ||
                      result.osm_type === 'node' && (result.type === 'peak' || result.class === 'peak') ||
                      poiData.name.toLowerCase().includes('pico') ||
                      poiData.name.toLowerCase().includes('morro') ||
                      poiData.name.toLowerCase().includes('cristo') ||
                      poiData.name.toLowerCase().includes('mountain') ||
                      poiData.name.toLowerCase().includes('montanha');
        
        let effectiveMaxDistance = maxDistance;
        
        // 🏔️ PRIORIDADE 1: Peaks/picos têm threshold muito maior
        if (isPeak) {
          if (isHighConfidenceMatch) {
            effectiveMaxDistance = Math.max(maxDistance, 500); // Peak com OSM ID + nome exato: até 500m
            console.log(`🏔️ High-confidence peak/landmark match: using ${effectiveMaxDistance}m threshold (distance: ${distance.toFixed(0)}m)`);
          } else if (exactNameMatch) {
            effectiveMaxDistance = Math.max(maxDistance, 300); // Peak com nome exato: até 300m
            console.log(`🏔️ Peak/landmark with exact name match: using ${effectiveMaxDistance}m threshold (distance: ${distance.toFixed(0)}m)`);
          } else {
            effectiveMaxDistance = Math.max(maxDistance, 200); // Peak detectado: até 200m
            console.log(`🏔️ Peak/landmark detected: using ${effectiveMaxDistance}m threshold (distance: ${distance.toFixed(0)}m)`);
          }
        } else if (isHighConfidenceMatch) {
          if (isBuilding) {
            effectiveMaxDistance = Math.max(maxDistance, 100); // Edifícios: até 100m
            console.log(`🏗️ High-confidence building match: using ${effectiveMaxDistance}m threshold (distance: ${distance.toFixed(0)}m)`);
          } else {
            effectiveMaxDistance = Math.max(maxDistance, 50); // Outros: até 50m
            console.log(`📍 High-confidence match: using ${effectiveMaxDistance}m threshold (distance: ${distance.toFixed(0)}m)`);
          }
        }
        
        if (distance > effectiveMaxDistance) {
          console.log(`⚠️ Result too far: ${distance.toFixed(0)}m (max: ${effectiveMaxDistance}m)`);
          return false;
        }
      }
      
      // 2. Validar categoria (NOVO - evita falsos positivos)
      // 🆕 Para matches perfeitos, pular validação de categoria
      // 🏔️ Para peaks detectados no nome, aceitar qualquer categoria OSM relacionada a peaks
      const isPeakInName = poiData.name.toLowerCase().includes('pico') ||
                          poiData.name.toLowerCase().includes('morro') ||
                          poiData.name.toLowerCase().includes('cristo') ||
                          poiData.name.toLowerCase().includes('mountain') ||
                          poiData.name.toLowerCase().includes('montanha');
      
      if (!isPerfectMatch) {
        const osmCategory = this.extractCategoryFromNominatim(result);
        
        // 🏔️ Se é peak no nome, aceitar categorias relacionadas a peaks
        if (isPeakInName) {
          const peakRelatedCategories = ['peak', 'volcano', 'natural', 'park', 'mountain', 'hill', 'viewpoint', 'attraction'];
          const isPeakRelated = osmCategory && peakRelatedCategories.some(cat => 
            osmCategory.toLowerCase().includes(cat) || cat.includes(osmCategory.toLowerCase())
          );
          if (isPeakRelated) {
            console.log(`🏔️ Peak detected in name, accepting OSM category: ${osmCategory}`);
            // Aceitar - não fazer return false
          } else {
            // Se não for categoria relacionada a peak, validar normalmente
            if (!this.compareCategories(poiData.type, osmCategory)) {
              console.log(`⚠️ Category mismatch: POI=${poiData.type}, OSM=${osmCategory || 'unknown'}`);
              return false;
            }
          }
        } else {
          // Para não-peaks, validar normalmente
          if (!this.compareCategories(poiData.type, osmCategory)) {
            console.log(`⚠️ Category mismatch: POI=${poiData.type}, OSM=${osmCategory || 'unknown'}`);
            return false;
          }
        }
      }
      
      // 3. Validar localidade (cidade/estado)
      // 🆕 IMPORTANTE: Se temos OSM ID, não precisamos validar cidade/estado
      // OSM IDs são únicos globalmente e já identificam o POI corretamente
      // hasOSMID já foi definido acima (linha 1060)
      
      if (!hasOSMID && !isPerfectMatch && poiData.state && osmState) {
        // Apenas validar estado se NÃO temos OSM ID (busca por nome precisa de validação)
        // 🆕 Normalizar estados brasileiros (RJ = Rio de Janeiro, SP = São Paulo, etc.)
        const stateMatch = this.normalizeBrazilianState(poiData.state) === this.normalizeBrazilianState(osmState);
        if (!stateMatch) {
          console.log(`⚠️ State mismatch: POI=${poiData.state}, OSM=${osmState}`);
          return false; // Estado deve ser exato (após normalização)
        }
      } else if (hasOSMID) {
      }
      
      // Log de cidade (não rejeitar por cidade, apenas logar)
      if (poiData.city && osmCity) {
        const cityMatch = poiData.city.toLowerCase().includes(osmCity.toLowerCase()) ||
                         osmCity.toLowerCase().includes(poiData.city.toLowerCase());
        if (!cityMatch) {
          console.log(`⚠️ City mismatch: POI=${poiData.city}, OSM=${osmCity}`);
          // Não rejeitar por cidade, apenas logar (cidades podem ter nomes diferentes)
        }
      }
      
      return true;
    } catch (error) {
      console.warn('Error validating Nominatim result:', error);
      return false;
    }
  }
  
  /**
   * Query OSM por nome com variações (restrito a região próxima)
   */
  private async queryOSMByName(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    
    try {
      const lat = poiData.location.lat;
      const lng = poiData.location.lng;
      
      // Gerar variações do nome
      const nameVariations = this.generateNameVariations(poiData.name);
      
      // Viewbox restritivo: 0.01 graus = ~1.1km (muito próximo)
      // Isso evita encontrar POIs com mesmo nome mas em outras cidades
      const viewboxSize = 0.01; // ~1.1km
      const viewbox = `${lng-viewboxSize},${lat+viewboxSize},${lng+viewboxSize},${lat-viewboxSize}`;
      
      // Tentar cada variação sequencialmente até encontrar um resultado válido
      for (let i = 0; i < nameVariations.length; i++) {
        const searchTerm = nameVariations[i];
        
        const encodedName = encodeURIComponent(searchTerm);
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?` +
          `q=${encodedName}&` +
          `lat=${lat}&lon=${lng}&` +
          `bounded=1&viewbox=${viewbox}&` +
          `format=json&polygon_geojson=1&addressdetails=1&extratags=1&limit=5`;

        try {
          const response = await fetch(nominatimUrl, {
            headers: {
              'User-Agent': 'TuggiCMS/1.0 (boundary-detection)'
            }
          });

          if (!response.ok) {
            console.warn(`⚠️ Nominatim API error ${response.status} for variation "${searchTerm}"`);
            continue; // Tentar próxima variação
          }

          const results = await response.json();
          console.log(`📍 Nominatim found ${results.length} results for "${searchTerm}"`);

          if (results.length === 0) {
            continue; // Tentar próxima variação
          }

          // Validar e processar resultados
          for (const result of results) {
            // 🆕 Calcular threshold dinâmico baseado no tipo de resultado e confiança do match
            let maxDistance = 10; // Default conservador
            
            // Se nome corresponde exatamente, aumentar threshold
            const exactNameMatch = result.display_name?.toLowerCase().includes(poiData.name.toLowerCase()) ||
                                   poiData.name.toLowerCase().includes(result.display_name?.toLowerCase() || '');
            
            // 🏔️ NOVO: Detectar peaks/picos/montanhas (landmarks naturais)
            const isPeak = result.type === 'peak' || 
                          result.class === 'peak' ||
                          result.type === 'natural' ||
                          result.class === 'natural' ||
                          result.osm_type === 'node' && (result.type === 'peak' || result.class === 'peak') ||
                          poiData.name.toLowerCase().includes('pico') ||
                          poiData.name.toLowerCase().includes('morro') ||
                          poiData.name.toLowerCase().includes('cristo') ||
                          poiData.name.toLowerCase().includes('mountain') ||
                          poiData.name.toLowerCase().includes('montanha');
            
            // Se é um edifício (building), threshold maior (edifícios grandes podem ter pontos de referência diferentes)
            const isBuilding = result.type === 'building' || 
                              result.class === 'building' ||
                              result.osm_type === 'way' && result.type === 'way';
            
            // 🏔️ PRIORIDADE 1: Peaks/picos têm threshold muito maior (landmarks visíveis de longe)
            if (isPeak) {
              if (exactNameMatch && result.osm_id) {
                maxDistance = 500; // Peak com nome exato + OSM ID: até 500m
                console.log(`🏔️ Peak/landmark with exact name match + OSM ID: using ${maxDistance}m threshold`);
              } else if (exactNameMatch) {
                maxDistance = 300; // Peak com nome exato: até 300m
                console.log(`🏔️ Peak/landmark with exact name match: using ${maxDistance}m threshold`);
              } else {
                maxDistance = 200; // Peak detectado no nome: até 200m
                console.log(`🏔️ Peak/landmark detected: using ${maxDistance}m threshold`);
              }
            }
            // Se tem OSM ID e nome corresponde, é muito provável que seja o POI correto
            else if (result.osm_id && exactNameMatch) {
              if (isBuilding) {
                maxDistance = 100; // Edifícios: até 100m (edifícios grandes)
                console.log(`🏗️ Building with exact name match: using ${maxDistance}m threshold`);
              } else {
                maxDistance = 50; // Outros: até 50m
                console.log(`📍 Exact name match: using ${maxDistance}m threshold`);
              }
            } else if (isBuilding) {
              maxDistance = 50; // Edifícios sem match exato: 50m
              console.log(`🏗️ Building detected: using ${maxDistance}m threshold`);
            }
            
            // Validar distância, categoria e localidade (threshold dinâmico)
            if (!this.validateNominatimResult(result, poiData, maxDistance)) {
              console.log(`⚠️ Result rejected for "${searchTerm}": validation failed`);
              continue;
            }
            
            if (result.geojson && result.geojson.coordinates) {
              
              // 🏔️ Detectar se é peak para usar boundary maior
              const isPeakResult = result.type === 'peak' || 
                                  result.class === 'peak' ||
                                  result.type === 'natural' ||
                                  result.class === 'natural' ||
                                  poiData.name.toLowerCase().includes('pico') ||
                                  poiData.name.toLowerCase().includes('morro') ||
                                  poiData.name.toLowerCase().includes('cristo') ||
                                  poiData.name.toLowerCase().includes('mountain') ||
                                  poiData.name.toLowerCase().includes('montanha');
              
              const processed = await this.processNominatimGeometry(result.geojson, lat, lng, isPeakResult);
              if (processed.success && processed.coordinates.length > 2) {
                const center = this.calculatePolygonCenter(processed.coordinates);
                const area = calculatePolygonAreaInM2(processed.coordinates); // ✅ DRY: usar função SSOT
                
                
                // NOVA LÓGICA: Extrair elevação e altura para resultados do Nominatim
                let elevationData;
                let poiHeight;
                let consolidatedStreets: any[] = [];
                let consolidatedBuildings: any[] = [];
                let consolidatedVegetation: any[] = [];
                let consolidatedBarriers: any[] = [];
                let consolidatedPeaks: any[] = [];
                let poiClassification: any = undefined;
                
                try {
                  console.log(`🏗️ Extracting POI elevation and height for Nominatim result...`);
                  console.log(`📍 POI center: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);
                  console.log(`🏷️ Nominatim result type: ${result.geojson.type}, osm_type: ${result.osm_type}, osm_id: ${result.osm_id}`);
                  
                  // 🚀 ESTRATÉGIA CONSOLIDADA: 1 query inicial com raio padrão, expande se necessário
                  if (result.osm_id && result.osm_type) {
                    try {
                      // 🚀 QUERY CONSOLIDADA INICIAL: Raio padrão seguro (500m)
                      // Isso cobre 95% dos casos (FLAT: 180m, CANYON: 75m, MEDIUM pequeno: <500m)
                      const INITIAL_RADIUS = 500;
                      const expandedBoundaryInitial = this.expandBoundary(processed.coordinates, INITIAL_RADIUS);
                      const expandedPolygonInitial = expandedBoundaryInitial.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
                      
                      // ✅ CORREÇÃO: Garantir que OSM ID seja tratado como número na query
                      const osmIDForQuery = typeof result.osm_id === 'string' ? parseInt(result.osm_id, 10) : result.osm_id;
                      
                      const consolidatedQueryInitial = `
[out:json][timeout:90];
(
  ${result.osm_type}(${osmIDForQuery});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](poly:"${expandedPolygonInitial}");
  way["building"](poly:"${expandedPolygonInitial}");
  way["building"~"^(stadium|arena|sports_centre|leisure)$"](poly:"${expandedPolygonInitial}");
  way["natural"~"^(tree|wood|forest)$"](poly:"${expandedPolygonInitial}");
  way["barrier"~"^(wall|fence|hedge)$"](poly:"${expandedPolygonInitial}");
  node["natural"~"^(peak|volcano)$"](poly:"${expandedPolygonInitial}");
  way["natural"~"^(peak|volcano|mountain)$"](poly:"${expandedPolygonInitial}");
);
out geom tags;
`;
                      
                      // 🔄 RETRY COM BACKOFF: Query consolidada é CRÍTICA - não continuar sem ela
                      const osmTagsResponseInitial = await this.retryOSMQuery(
                        consolidatedQueryInitial,
                        'Consolidated OSM query (POI + streets + buildings)',
                        5, // 5 tentativas
                        2000 // 2s delay inicial
                      );
                      
                      let poiTags: any = {};
                      let poiElementFromQuery: any = null;
                      
                      // Se chegou aqui, a query foi bem-sucedida (retry garantiu)
                      if (osmTagsResponseInitial.ok) {
                        const consolidatedData = await osmTagsResponseInitial.json();
                        
                        if (consolidatedData.elements && consolidatedData.elements.length > 0) {
                          // ✅ CORREÇÃO: Normalizar OSM ID para comparação (pode ser string ou número)
                          const targetOSMID = String(result.osm_id);
                          
                          // Separar elementos por tipo
                          // ✅ CORREÇÃO: Comparar como strings para evitar problemas de tipo
                          poiElementFromQuery = consolidatedData.elements.find((el: any) => 
                            String(el.id) === targetOSMID && el.type === result.osm_type
                          );
                          
                          if (!poiElementFromQuery) {
                            console.warn(`⚠️ POI element not found in query response! Looking for ${result.osm_type}(${targetOSMID})`);
                            console.log(`   Available element IDs: ${consolidatedData.elements.slice(0, 10).map((el: any) => `${el.type}(${el.id})`).join(', ')}${consolidatedData.elements.length > 10 ? '...' : ''}`);
                          } else {
                          }
                          
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
                          const peakElements = consolidatedData.elements.filter((el: any) => 
                            (el.tags?.natural === 'peak' || el.tags?.natural === 'volcano' || el.tags?.natural === 'mountain') &&
                            (el.geometry || (el.type === 'node' && el.lat && el.lon))
                          );
                          
                          
                          // Extrair tags do POI
                          if (poiElementFromQuery && poiElementFromQuery.tags) {
                            poiTags = poiElementFromQuery.tags;
                          } else {
                            console.warn(`⚠️ Could not retrieve POI tags - element not found in query response`);
                          }
                          
                          // Extrair altura do POI
                          if (poiElementFromQuery) {
                            poiHeight = this.extractOSMHeight(poiElementFromQuery);
                            if (poiHeight) {
                              console.log(`📏 POI height from OSM: ${poiHeight}m`);
                            }
                          } else {
                            // Fallback: tentar buscar altura diretamente usando OSM ID
                            console.log(`🔍 Attempting direct height query for ${result.osm_type}(${targetOSMID})...`);
                            try {
                              const heightQuery = `
[out:json][timeout:30];
${result.osm_type}(${targetOSMID});
out tags;
`;
                              const heightResponse = await this.retryOSMQuery(
                                heightQuery,
                                `Direct height query for ${result.osm_type}(${targetOSMID})`,
                                3,
                                2000
                              );
                              
                              if (heightResponse.ok) {
                                const heightData = await heightResponse.json();
                                const heightElement = heightData.elements?.find((el: any) => 
                                  String(el.id) === targetOSMID && el.type === result.osm_type
                                );
                                if (heightElement) {
                                  poiHeight = this.extractOSMHeight(heightElement);
                                  if (poiHeight) {
                                    console.log(`📏 POI height from direct query: ${poiHeight}m`);
                                  }
                                }
                              }
                            } catch (error) {
                              console.warn(`⚠️ Direct height query failed: ${error}`);
                            }
                          }
                          
                          // Processar dados iniciais
                          consolidatedStreets = this.processOSMStreets(streetElements, processed.coordinates);
                          consolidatedBuildings = this.processOSMBuildings(buildingElements);
                          consolidatedVegetation = this.processOSMVegetation(vegetationElements);
                          consolidatedBarriers = this.processOSMBarriers(barrierElements);
                          consolidatedPeaks = this.processOSMPeaks(peakElements);
                        } else {
                          // Se não encontrou elementos, ainda é sucesso (pode ser POI sem dados)
                          console.log(`⚠️ Consolidated query succeeded but no elements found (POI may have no surrounding data)`);
                        }
                      } else {
                        // Este caso não deveria acontecer (retry garante sucesso), mas manter para segurança
                        throw new Error(`Consolidated query failed after retries: ${osmTagsResponseInitial.status}`);
                      }
                      
                      // ===============================================
                      // STEP 2: Extrair elevação
                      // ===============================================
                      console.log(`🔍 Step 2: Extracting elevation...`);
                      
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
                      // STEP 2.5: CALCULAR DENSIDADE URBANA COM DADOS OSM COLETADOS
                      // ===============================================
                      // ✅ PRIMEIRA VEZ: Calcular densidade urbana com dados OSM reais (sem redundância)
                      console.log(`🔍 Step 2.5: Calculating urban density with collected OSM data...`);
                      
                      // Processar dados coletados (consolidatedStreets já foi processado na linha 1536)
                      const processedBuildings = this.processOSMBuildings(consolidatedBuildings);
                      const processedVegetation = this.processOSMVegetation(consolidatedVegetation);
                      const processedBarriers = this.processOSMBarriers(consolidatedBarriers);
                      const processedPeaks = this.processOSMPeaks(consolidatedPeaks);
                      
                      // Criar boundary temporário com dados coletados para cálculo de densidade
                      const tempBoundaryForDensity: BoundaryData = {
                        coordinates: processed.coordinates,
                        center,
                        area,
                        confidence: 0.8,
                        source: 'osm',
                        streets: consolidatedStreets, // ✅ Já processado na linha 1536
                        buildings: processedBuildings,
                        vegetation: processedVegetation,
                        barriers: processedBarriers,
                        peaks: processedPeaks, // ✅ SSLT: dados já coletados
                        height: poiHeight || undefined
                      };
                      
                      // Calcular densidade urbana usando dados OSM coletados (PRIMEIRA VEZ)
                      const GeographicContextAnalyzer = (await import('./geographic-analyzer')).GeographicContextAnalyzer;
                      const geographicAnalyzer = new GeographicContextAnalyzer();
                      const contextForClassification = await geographicAnalyzer.analyzeGeographicContext(poiData, tempBoundaryForDensity);
                      
                      
                      // ===============================================
                      // STEP 3: CLASSIFICAR POI
                      // ===============================================
                      
                      const POIClassifierService = (await import('../services/poi-classifier.service')).POIClassifierService;
                      const classifier = new POIClassifierService();
                      
                      const classification = await classifier.classifyPOI(
                        poiData,
                        poiHeight || undefined,
                        elevationData ? { center: elevationData.center } : undefined,
                        area,
                        contextForClassification, // ✅ Usar contexto atualizado com densidade correta
                        poiTags
                      );
                      
                      console.log(`✅ POI Classification: ${classification.group.toUpperCase()}`);
                      console.log(`📏 Search radius: ${classification.searchRadius}m (${classification.metadata.reasoning})`);
                      
                      // Armazenar classificação para retorno
                      poiClassification = classification;
                      
                      // ===============================================
                      // STEP 4: Query expandida se necessário
                      // ===============================================
                      // 🎯 BULLET 2: Calcular tamanho do boundary (raio máximo do centro até o ponto mais distante)
                      const maxBoundaryRadius = Math.max(
                        ...processed.coordinates.map(coord => calculateDistance(center, coord))
                      );
                      console.log(`📏 Boundary max radius: ${maxBoundaryRadius.toFixed(0)}m (from center to farthest boundary point)`);
                      console.log(`📏 Boundary area: ${area.toFixed(0)}m²`);
                      
                      // 🎯 BULLET 3: O raio de busca é SEMPRE a partir do BOUNDARY (perímetro), não do centro
                      const requiredRadius = classification.searchRadius; // Raio a partir do boundary
                      const totalSearchRadiusFromCenter = maxBoundaryRadius + requiredRadius; // Raio total do centro
                      
                      console.log(`📏 Required search radius FROM BOUNDARY: ${requiredRadius}m`);
                      console.log(`📏 Total search radius FROM CENTER: ${totalSearchRadiusFromCenter.toFixed(0)}m (boundary: ${maxBoundaryRadius.toFixed(0)}m + search: ${requiredRadius}m)`);
                      
                      // 🎯 BULLET 3: Verificar se os dados de ruas obtidos são suficientes
                      const initialSearchCovers = totalSearchRadiusFromCenter <= INITIAL_RADIUS;
                      
                      if (!initialSearchCovers) {
                        console.log(`🔍 Step 4: Initial search (${INITIAL_RADIUS}m) is NOT sufficient for boundary (${maxBoundaryRadius.toFixed(0)}m) + search radius (${requiredRadius}m)`);
                        console.log(`   → Need to search ${totalSearchRadiusFromCenter.toFixed(0)}m from center, but initial was only ${INITIAL_RADIUS}m`);
                        console.log(`   → Making expanded search using BOUNDARY as reference (not center)`);
                        
                        // ✅ CORRETO: Expandir o boundary por requiredRadius (a partir do perímetro)
                        const expandedBoundaryFinal = this.expandBoundary(processed.coordinates, requiredRadius);
                        const expandedPolygonFinal = expandedBoundaryFinal.map(coord => `${coord.lat} ${coord.lng}`).join(' ');
                        
                        // Query expandida apenas para ruas (mais leve que buscar tudo)
                        const expandedStreetsQuery = `
[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]["access"!~"^(no)$"](poly:"${expandedPolygonFinal}");
);
out geom tags;
`;
                        
                        try {
                          // 🔄 RETRY COM BACKOFF: Query expandida é importante para POIs grandes
                          // ✅ QUALIDADE > VELOCIDADE: Aumentar tentativas para garantir dados
                          console.log(`🔄 [IMPORTANT] Fetching expanded streets (radius: ${requiredRadius}m) - will retry up to 5 times if timeout`);
                          const expandedStreetsResponse = await this.retryOSMQuery(
                            expandedStreetsQuery,
                            `Expanded streets query (${requiredRadius}m radius)`,
                            5, // ✅ 5 tentativas (igual ao padrão, crítico para POIs grandes)
                            3000 // 3s delay inicial (backoff exponencial: 3s, 6s, 12s, 24s, 48s)
                          );
                          
                          if (expandedStreetsResponse.ok) {
                            const expandedData = await expandedStreetsResponse.json();
                            const expandedElements = expandedData.elements || [];
                            
                            // Mesclar ruas expandidas (substituir ruas iniciais)
                            const expandedStreetElements = expandedElements.filter((el: any) => 
                              el.tags?.highway && el.geometry && el.geometry.length > 1
                            );
                            consolidatedStreets = this.processOSMStreets(expandedStreetElements, processed.coordinates);
                            
                            console.log(`✅ Expanded query: ${consolidatedStreets.length} streets (merged with initial data)`);
                          } else {
                            console.warn(`⚠️ Expanded streets query failed: ${expandedStreetsResponse.status}, using initial data`);
                            // Usar dados iniciais como fallback
                          }
                        } catch (error) {
                          console.warn(`⚠️ Expanded streets query error: ${error}, using initial data`);
                          // Usar dados iniciais como fallback
                        }
                      } else {
                        console.log(`✅ Initial search (${INITIAL_RADIUS}m) is sufficient for boundary (${maxBoundaryRadius.toFixed(0)}m) + search radius (${requiredRadius}m)`);
                        console.log(`   → Total needed: ${totalSearchRadiusFromCenter.toFixed(0)}m from center, initial covers: ${INITIAL_RADIUS}m`);
                        console.log(`   → Using initial query data`);
                      }
                    } catch (error) {
                      console.warn(`⚠️ Failed to get consolidated data from OSM ID:`, error);
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
                        // 🔄 RETRY COM BACKOFF: Query de altura é importante - tentar até conseguir
                        console.log(`🔄 [IMPORTANT] Fetching architectural elements for height - will retry if timeout`);
                        const response = await this.retryOSMQuery(
                          architecturalQuery,
                          'Architectural elements query (for POI height)',
                          3, // 3 tentativas (menos crítico que query consolidada)
                          3000 // 3s delay inicial
                        );
                        
                        if (response.ok) {
                          const data = await response.json();
                          if (data.elements && data.elements.length > 0) {
                            // Criar boundary temporário para verificação
                            const tempBoundary: BoundaryData = {
                              coordinates: processed.coordinates,
                              center,
                              area,
                              confidence: 0.8,
                              source: 'osm'
                            };
                            poiHeight = this.extractHeightFromMultipleElements(data.elements, center, tempBoundary);
                            if (poiHeight) {
                              console.log(`✅ Found POI height from architectural elements: ${poiHeight}m`);
                            }
                          } else {
                            console.log(`⚠️ No architectural elements found around Nominatim result`);
                          }
                        }
                      } catch (error) {
                        // Se retry falhou, logar mas não bloquear (altura não é crítica para continuar)
                        console.warn(`⚠️ Architectural elements search failed after retries (non-blocking):`, error instanceof Error ? error.message : error);
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
                
                // Retornar sucesso com o primeiro resultado válido encontrado
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
                    peaks: consolidatedPeaks && consolidatedPeaks.length > 0 ? this.processOSMPeaks(consolidatedPeaks) : undefined, // ✅ SSLT: picos já coletados
                    classification: poiClassification || undefined, // NOVO: classificação do POI
                    osmTags: undefined // NOVO: tags OSM para classificação (será preenchido se disponível)
                  },
                  processingTime: 0
                };
              }
            }
          }
        } catch (error) {
          // Erro ao processar esta variação - tentar próxima
          console.warn(`⚠️ Error processing variation "${searchTerm}":`, error);
          continue; // Tentar próxima variação
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
      const area = calculatePolygonAreaInM2(coordinates); // ✅ DRY: usar função SSOT (retorna m²)
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
        const distance = elementCenter ? calculateDistance(poiCenter, elementCenter) : 0; // ✅ DRY: usar função SSOT
        
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
    const distance = calculateDistance(poiCenter, elementCenter); // ✅ DRY: usar função SSOT
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
  private async createEstimatedBoundary(poiData: POIData): Promise<BoundaryData> {
    // ✅ REFATORADO: Usar raio padrão pequeno (50m) para POIs não encontrados
    // Não precisa de context - POI não encontrado provavelmente é pequeno/irrelevante
    const baseRadius = 50; // Raio padrão para POIs não encontrados
    
    // Criar boundary circular
    const coordinates = this.createCircularBoundary(poiData.location, baseRadius);
    const center = poiData.location;
    const area = calculatePolygonAreaInM2(coordinates); // ✅ DRY: usar função SSOT (retorna m²)
    
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
    lng: number,
    isPeak: boolean = false
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
        // Se for apenas um ponto, criar um polígono ao redor
        // 🏔️ Para peaks, usar raio maior (200m) para melhor cobertura
        const radius = isPeak ? 200 : 50; // Peaks: 200m, outros: 50m
        console.log(`📍 Point geometry detected (${isPeak ? 'peak' : 'regular'}): creating ${radius}m radius boundary`);
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
  
  // ✅ DRY: calculatePolygonArea removido - usar calculatePolygonAreaInM2 de utils/calculations.ts
  
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
  
  /**
   * 🆕 Normaliza estados brasileiros (abreviações ↔ nomes completos)
   * Exemplos: "RJ" = "Rio de Janeiro", "SP" = "São Paulo"
   * OSM IDs são únicos globalmente, então se temos OSM ID não precisamos validar cidade/estado
   */
  private normalizeBrazilianState(state: string | null | undefined): string {
    if (!state) return '';
    
    const normalized = state.trim().toLowerCase();
    
    // Mapeamento de abreviações para nomes completos
    const stateMap: Record<string, string> = {
      'rj': 'rio de janeiro',
      'sp': 'são paulo',
      'mg': 'minas gerais',
      'rs': 'rio grande do sul',
      'pr': 'paraná',
      'sc': 'santa catarina',
      'ba': 'bahia',
      'go': 'goiás',
      'pe': 'pernambuco',
      'ce': 'ceará',
      'pa': 'pará',
      'ma': 'maranhão',
      'pb': 'paraíba',
      'am': 'amazonas',
      'es': 'espírito santo',
      'rn': 'rio grande do norte',
      'al': 'alagoas',
      'pi': 'piauí',
      'to': 'tocantins',
      'mt': 'mato grosso',
      'ms': 'mato grosso do sul',
      'df': 'distrito federal',
      'se': 'sergipe',
      'ro': 'rondônia',
      'ac': 'acre',
      'ap': 'amapá',
      'rr': 'roraima'
    };
    
    // Se for abreviação, retornar nome completo
    if (stateMap[normalized]) {
      return stateMap[normalized];
    }
    
    // Se já for nome completo, normalizar (remover acentos, lowercase)
    return normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
}
