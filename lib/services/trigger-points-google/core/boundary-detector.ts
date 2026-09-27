// Detector de boundaries usando Google APIs com fallback para OSM

import { heightFromTags, SANITY_MAX_TP_DISTANCE_M, VisibilityClass } from '../config/visibility-class';
import { GoogleAPIsService } from '../services/google-apis.service';
import { ElevationService } from '../services/elevation.service';
import { POIData, GeographicContext, BoundaryData, ProcessingResult } from '../types/interfaces';
import { convertViewportToPolygon, calculatePolygonArea, calculatePolygonAreaInM2, calculatePolygonCenter, calculatePolygonPerimeter, calculateDistance, isPointInPolygon, isDrawnCircle } from '../utils/calculations';
import { ElevationAnalysisService } from '../services/elevation-service';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { isCuratedBoundaryImplausible } from '../utils/osm-validation';
import { assembleOuterRings, chainSameIdentity, chooseContainingBoundary, corridorRing, footprintRing, LINE_CORRIDOR_HALF_WIDTH_M, outerRing, type BoundaryRejection, type OsmAreaElement } from '../utils/boundary-choice';

/**
 * Radius of the circle that marks a POI with no footprint of its own: an OSM node, a pin with
 * nothing at it, a stored point (INV-E1b). A 50 m "estimated" circle (~8,300 m²) swallowed the
 * street in front of the Igreja da Penna and the TP landed inside it (#772).
 */
export const POINT_CIRCLE_RADIUS_M = 10;
import { getSupabase } from '../../../core/supabase-client';

/** Surveyed summits for the ground-top read (E4): one point per `processOSMPeaks` element. */
function peakPoints(peaks: any[] | undefined): Array<{ lat: number; lng: number; tags?: Record<string, unknown> }> {
  return (peaks ?? [])
    .filter(p => p?.coordinates?.length)
    .map(p => ({ lat: p.coordinates[0].lat, lng: p.coordinates[0].lng, tags: p.tags }));
}

export class BoundaryDetector {
  private googleAPIs: GoogleAPIsService;
  private elevationService: ElevationService;
  /** E1 candidates refused during the current `detectBoundary`, for the trace (E0). */
  private rejections: BoundaryRejection[] = [];
  
  /**
   * 🔄 RETRY COM BACKOFF EXPONENCIAL para queries OSM (QUALIDADE > VELOCIDADE)
   * Retry até conseguir os dados necessários, não continua sem eles.
   * Agora usa MÚLTIPLOS MIRRORS para evitar rate limiting (429/504).
   */
  private async retryOSMQuery(
    query: string,
    description: string,
    maxRetries: number = 7,
    initialDelay: number = 2000 // 2 segundos inicial
  ): Promise<Response> {
    // Lista de mirrors do Overpass API para resiliência
    const mirrors = [
      'https://overpass.openstreetmap.fr/api/interpreter',  // 1º: cobertura global verificada 6/6 (PT/IE/BR/US/JP/AU) e ~2s
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://z.overpass-api.de/api/interpreter',
      'https://overpass.osm.ch/api/interpreter',
      'https://overpass.be/api/interpreter',
      'https://overpass-api.enit.it/api/interpreter'
    ];
    
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Rotacionar mirror a cada tentativa
      const mirror = mirrors[(attempt - 1) % mirrors.length];
      
      try {
        const timeout = 100000; // 100s timeout por tentativa
        const response = await fetch(mirror, {
          method: 'POST',
          body: query,
          headers: { 
            'Content-Type': 'text/plain',
            'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)'
          },
          signal: AbortSignal.timeout(timeout)
        });
        
        if (response.ok) {
          return response;
        }
        
        console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} failed (mirror: ${new URL(mirror).hostname}): ${response.status}`);
        
        lastError = new Error(`OSM query failed: ${response.status}`);
        
        // Se não for a última tentativa, aguardar antes de retry com backoff exponencial + jitter
        if (attempt < maxRetries) {
          const jitter = Math.random() * 1000;
          const delay = (initialDelay * Math.pow(2, attempt - 1)) + jitter;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} error (mirror: ${new URL(mirror).hostname}):`, lastError.message);
        
        if (attempt < maxRetries) {
          const jitter = Math.random() * 1000;
          const delay = (initialDelay * Math.pow(2, attempt - 1)) + jitter;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Se chegou aqui, todas as tentativas falharam
    console.error(`❌ [RETRY FAILED] ${description} failed after ${maxRetries} attempts across multiple mirrors`);
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
      this.rejections = [];
      // INV-E1a: OSM by typed id → OSM that contains the pin → online search → drawn circle.
      let osmBoundaryResult: ProcessingResult<BoundaryData> | null = null;
      // A node id has no footprint: its circle only marks the point, and is the last resort.
      let pointCircle: ProcessingResult<BoundaryData> | null = null;

      if (poiData.osm_id && poiData.osm_type) {
        const byId = await this.detectOSMBoundaryByID(String(poiData.osm_id), poiData.osm_type, poiData);
        if (byId.success && byId.data?.synthetic) pointCircle = byId;
        else osmBoundaryResult = byId;
      }

      if (!osmBoundaryResult?.success) {
        const containing = await this.detectContainingBoundary(poiData, pointCircle?.data?.osmTags);
        // A named ground of another name at the pin no longer skips the name search: every pin
        // stands in its city's boundary, and the fallback it guarded against is now the 10 m
        // point circle, not the 50 m one that swallowed the avenue (Árvore de Natal, #772).
        if (containing.success) osmBoundaryResult = containing;
      }

      // Name search is for a POI without an id: with a node id it finds the same point again
      // (Irmão Menor came back as a 200 m circle).
      if (!osmBoundaryResult?.success && !pointCircle) {
        osmBoundaryResult = await this.detectOSMBoundary(poiData);
      }

      if (!osmBoundaryResult?.success && pointCircle) osmBoundaryResult = pointCircle;

      // 2. Se OSM encontrou boundary, usar OSM (PRIORIDADE)
      if (osmBoundaryResult?.success && osmBoundaryResult.data) {
        // INV-E1b: a drawn circle is `synthetic`, whatever path drew it (node, Nominatim point).
        const synthetic = !!osmBoundaryResult.data.synthetic || isDrawnCircle(osmBoundaryResult.data.coordinates);
        return {
          success: true,
          data: await this.withClassification({
            ...osmBoundaryResult.data,
            source: synthetic ? 'synthetic' : 'osm',
            synthetic,
            osmIdentified: true,
            rejected: this.rejections.length ? [...this.rejections] : undefined,
          }, poiData),
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
            data: await this.withClassification({ ...dbBoundaryResult.data, rejected: this.rejections.length ? [...this.rejections] : undefined }, poiData),
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
        data: await this.withClassification({ ...estimatedResult, osmIdentified: false, rejected: this.rejections.length ? [...this.rejections] : undefined }, poiData),
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
   * Every boundary leaves the detector classified (BR-AUDIO-010). The DB fallback and the
   * estimated circle had no class, and the POI fell into the 300 m unclassified cap — a
   * 2.6 km beach got 1 TP (Praia do Recreio, #779).
   */
  private async withClassification(boundary: BoundaryData, poiData: POIData): Promise<BoundaryData> {
    const measured = await this.measureBoundary(boundary, poiData);
    const physical = measured.physical;
    // E1, relief footprint (#772): a POI with no footprint of its own that stands on a hill takes
    // the slope as its border, measured on the DEM — never a mapped polygon by its type. Not for a
    // `landmark_high`: its reach is the horizon, and the slope would only take its trail and cable
    // car TPs away (inside the border, INV-E11).
    if (!boundary.synthetic || measured.classification?.group === VisibilityClass.LANDMARK_HIGH || !physical) return measured;
    const ring = await ElevationAnalysisService.reliefFootprint(poiData.location, physical.localBaseM);
    if (!ring) return measured;
    const areaM2 = calculatePolygonAreaInM2(ring);
    return this.measureBoundary({
      ...boundary,
      type: 'polygon',
      coordinates: ring,
      area_m2: areaM2,
      perimeter_m: calculatePolygonPerimeter(ring),
      source: 'dem_relief',
      synthetic: false,
    }, poiData);
  }

  private async measureBoundary(boundary: BoundaryData, poiData: POIData): Promise<BoundaryData> {
    // Always measured here, on the FINAL boundary (E3 → E4 → E5, P8): on the name path the class
    // was decided before the height and the 2nd elevation read, and Cristo left with height 0.
    const loose = poiData as POIData & { tags?: Record<string, unknown> };
    const tags = (boundary.osmTags ?? poiData.osm_tags ?? loose.tags) as Record<string, unknown> | undefined;
    const { measureAndClassify } = await import('../services/poi-classifier.service');
    const { classification, physical } = await measureAndClassify({
      poiData,
      boundary: boundary.coordinates,
      synthetic: boundary.synthetic,
      areaM2: boundary.area_m2,
      tags,
      // Measured only: never a height the caller registered on the POI (INV-E3).
      knownHeightM: boundary.height ?? undefined,
      peaks: peakPoints(boundary.peaks),
      context: boundary.cachedContext,
    });
    // Legacy readers (street-analyzer, validator) still read boundary.elevation: give them the
    // measured top when the path left none.
    const withElevation = !boundary.elevation && physical.groundTopM !== null
      ? { elevation: { min: physical.groundTopM, max: physical.groundTopM, average: physical.groundTopM, center: physical.groundTopM } }
      : {};
    // One height for the class, the fan and the sight line (INV-E3).
    return { ...boundary, ...withElevation, height: physical.heightM || undefined, physical, classification };
  }

  /**
   * 🆕 Busca boundary do banco de dados (PRIMEIRA PRIORIDADE)
   * POIs podem ter boundary corrigido manualmente ou desenhado à mão
   */
  public async fetchBoundaryFromDatabase(poiId: string): Promise<ProcessingResult<BoundaryData>> {
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
      let synthetic = metadata?.boundary_source === 'estimated';
      
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
        coordinates = this.createCircularBoundary(center, POINT_CIRCLE_RADIUS_M);
        synthetic = true;
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
          coordinates = this.createCircularBoundary(center, POINT_CIRCLE_RADIUS_M);
          synthetic = true;
        } else if (metadata?.latitude && metadata?.longitude) {
          const center = {
            lat: Number(metadata.latitude),
            lng: Number(metadata.longitude)
          };
          coordinates = this.createCircularBoundary(center, POINT_CIRCLE_RADIUS_M);
          synthetic = true;
        } else {
          return { success: false, error: `Unsupported geometry type: ${geometry.type}`, processingTime: 0 };
        }
      }
      
      if (coordinates.length < 3) {
        return { success: false, error: 'Invalid boundary coordinates (need at least 3 points)', processingTime: 0 };
      }
      // Earlier pipeline runs saved the drawn fallback circle as if it were the footprint.
      if (isDrawnCircle(coordinates)) synthetic = true;
      
      // Calcular centro e área
      const center = calculatePolygonCenter(coordinates);
      // ✅ Se metadata já tem área em m², usar; senão calcular usando função SSOT
      const area = metadata?.boundary_area_m2 ? Number(metadata.boundary_area_m2) : calculatePolygonAreaInM2(coordinates);
      const confidence = metadata?.boundary_confidence ? Number(metadata.boundary_confidence) : 0.8;
      
      const storedSource = (metadata?.boundary_source as BoundaryData['source'] | null) || 'manual';
      const boundary: BoundaryData = {
        type: 'polygon',
        coordinates,
        center,
        area_m2: area,
        perimeter_m: 0,
        confidence,
        // A stored drawn circle is still a drawn circle (INV-E1b): earlier runs saved it as 'osm'.
        // 'estimated' and the curator's 'manual'/'manual_drawing' keep their predictor branches.
        source: synthetic && !['estimated', 'manual', 'manual_drawing'].includes(storedSource) ? 'synthetic' : storedSource,
        synthetic,
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
  private async detectOSMBoundaryByID(
    osmID: string,
    osmType: string,
    poiData: POIData,
    /** An element already chosen (E1 "contains the pin") and the POI's own tags, which it keeps. */
    chosen?: { element: OsmAreaElement; tags?: Record<string, unknown> }
  ): Promise<ProcessingResult<BoundaryData>> {
    try {
      
      // 🚀 ESTRATÉGIA CONSOLIDADA: Query inicial com raio padrão reduzido (150m) para evitar timeout/406 no Overpass
      // Isso cobre o contexto imediato e a query expandida cuida do resto se necessário.
      const INITIAL_RADIUS = 150; // Raio reduzido para evitar timeouts em áreas urbanas densas
      
      // 🌍 ESTRATÉGIA 1: LOCAL OSM DB (busca por ID direto)
      const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
      const localData = chosen ? null : LocalOSMFetcher.getInstance().fetchElementById(osmType, osmID);
      
      let elements: any[] = [];
      
      if (chosen) {
        elements = [chosen.element];
      } else if (localData && localData.elements.length > 0) {
        elements = localData.elements;
      } else {
        // 🔄 ESTRATÉGIA 2: OVERPASS API (Fallback). `out geom`, not `out geom tags`: the `tags`
        // verbosity drops a relation's members, and without them there is no ring to assemble.
        const query = `
[out:json][timeout:30];
${osmType}(${osmID});
out geom;
`;
        const response = await this.retryOSMQuery(
          query,
          `OSM ID query: ${osmType}(${osmID})`,
          7,
          2000
        );
        
        if (!response.ok) {
          console.warn(`⚠️ OSM query failed for ${osmType}(${osmID}): ${response.status}`);
          return { success: false, error: `OSM query failed: ${response.status}`, processingTime: 0 };
        }
        
        const data = await response.json();
        elements = data.elements || [];
      }
      
      if (elements.length === 0) {
        console.warn(`⚠️ No OSM element found for ${osmType}(${osmID})`);
        return { success: false, error: 'OSM element not found', processingTime: 0 };
      }
      
      const element = elements[0];

      // Processar geometria
      let coordinates: Array<{ lat: number; lng: number }> = [];
      // A node has no footprint: the circle only marks the point (see BoundaryData.synthetic).
      let synthetic = false;

      const g = Array.isArray(element.geometry) ? element.geometry : [];
      const openWay = !chosen && osmType === 'way' && g.length >= 2
        && !(g[0].lat === g[g.length - 1].lat && (g[0].lon ?? g[0].lng) === (g[g.length - 1].lon ?? g[g.length - 1].lng));
      if (openWay) {
        // A line (bridge, promenade): the run of ways of the same identity around it, as a corridor.
        coordinates = await this.sameIdentityCorridor(element);
      } else if ((osmType === 'way' || osmType === 'relation') && Array.isArray(element.geometry) && element.geometry.length >= 3) {
        // Way, or relation (local DB: its rings one after another; the footprint is the outer one)
        const points = element.geometry.map((point: any) => ({
          lat: point.lat,
          lng: point.lon ?? point.lng
        }));
        coordinates = osmType === 'relation' ? outerRing(points, poiData.location) : points;
      } else if (osmType === 'node') {
        const center = { lat: element.lat, lng: element.lon };
        coordinates = this.createCircularBoundary(center, POINT_CIRCLE_RADIUS_M);
        synthetic = true;
      } else if (osmType === 'relation') {
        // Overpass relation: its outer ways joined into rings (INV-E1a). Only when no ring closes
        // is the pin marked by a circle.
        const ring = footprintRing(assembleOuterRings(element.members), poiData.location);
        if (ring) {
          coordinates = ring;
        } else {
          coordinates = this.createCircularBoundary(poiData.location, POINT_CIRCLE_RADIUS_M);
          synthetic = true;
        }
      }
      
      if (coordinates.length < 3) {
        console.warn(`⚠️ Insufficient coordinates for ${osmType}(${osmID})`);
        return { success: false, error: 'Insufficient coordinates', processingTime: 0 };
      }
      
      const center = calculatePolygonCenter(coordinates);
      const area = calculatePolygonAreaInM2(coordinates); // ✅ DRY: usar função SSOT (retorna m²)
      
      // Princípio: quando o POI tem `osm_id` armazenado, o ID é a fonte de
      // verdade (curado upstream — admin UI, import). Divergência de nome ou
      // centróide a >200 m só vira warning — EXCETO o caso implausível: pino fora
      // do polígono e centróide a >1 km. Aí o id aponta para outro elemento e o
      // boundary é recusado (BR-AUDIO-010; auditoria de TP, 2026-09-27).
      const distanceFromPOI = calculateDistance(center, poiData.location);
      const poiTags = chosen ? (chosen.tags ?? {}) : (element.tags || {});
      const osmName = chosen ? '' : (poiTags.name || poiTags['name:pt'] || '');

      if (isCuratedBoundaryImplausible(poiData.location, coordinates)) {
        console.warn(`🚫 osm_id=${osmType}(${osmID}) rejected: pin outside polygon and far from its edge`);
        return { success: false, error: 'Curated osm_id boundary is implausible (pin outside, > 500 m from the edge)', processingTime: 0 };
      }

      if (distanceFromPOI > 200) {
        const pinIsInsideBoundary = isPointInPolygon(poiData.location, coordinates);
        console.log(`📐 osm_id=${osmType}(${osmID}) centroid is ${distanceFromPOI.toFixed(0)}m from POI pin (area=${(area / 1000000).toFixed(2)}km², pin inside=${pinIsInsideBoundary}) — trusting curated osm_id`);
      }
      if (osmName) {
        const osmNameLower = osmName.toLowerCase();
        const poiNameLower = poiData.name.toLowerCase();
        const nameMatches =
          osmNameLower === poiNameLower ||
          osmNameLower.includes(poiNameLower) ||
          poiNameLower.includes(osmNameLower) ||
          osmNameLower.replace(/\s+/g, '') === poiNameLower.replace(/\s+/g, '');
        if (!nameMatches) {
          console.warn(`⚠️ osm_id=${osmType}(${osmID}) name "${osmName}" differs from POI name "${poiData.name}" — trusting curated osm_id (verify upstream if unexpected)`);
        }
      }
      
      // Height measured on the element only: there is no height by type tag (INV-E3, 2026-09-27).
      const poiHeight = this.extractOSMHeight({ tags: poiTags });
      
      // Buscar elevação
      const elevation = await this.elevationService.getElevation(center, undefined, { tags: poiTags }, undefined, poiData);
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
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|track|service)$"]["access"!~"^(no)$"](poly:"${expandedPolygonInitial}");
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
      
      // 🌍 ESTRATÉGIA 1: LOCAL OSM DB
      const localConsolidated = LocalOSMFetcher.getInstance().fetchAsOverpassData(
        center, INITIAL_RADIUS,
        { includeBuildings: true, targetOsmId: osmID, targetOsmType: osmType }
      );
      
      let consolidatedResponseInitial: any;
      if (localConsolidated && localConsolidated.elements.length > 0) {
        consolidatedResponseInitial = { ok: true, json: async () => localConsolidated };
      } else {
        // 🔄 ESTRATÉGIA 2: OVERPASS API (Fallback)
        consolidatedResponseInitial = await this.retryOSMQuery(
          consolidatedQueryInitial,
          'Consolidated OSM query (POI + streets + buildings)',
          7,
          2000
        );
      }
      
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
        type: 'polygon',
        coordinates,
        center,
        area_m2: area,
        perimeter_m: 0,
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
      
      // Provisional class, only to size the street query below; `withClassification` measures
      // again on the final boundary with the same function (E5).
      const { measureAndClassify } = await import('../services/poi-classifier.service');
      const { classification } = await measureAndClassify({
        poiData,
        boundary: coordinates,
        synthetic,
        areaM2: area,
        tags: poiTags,
        knownHeightM: poiHeight || undefined,
        peaks: peakPoints(processedPeaks),
        context: contextForClassification,
      });
      
      
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
          // 🌍 ESTRATÉGIA 1: LOCAL OSM DB
          const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
          const localData = LocalOSMFetcher.getInstance().fetchAsOverpassData(
            coordinates[0], requiredRadius, { includeBuildings: false }
          );
          
          let expandedStreetsResponse: any;
          if (localData && localData.elements.length > 0) {
             expandedStreetsResponse = { ok: true, json: async () => localData };
          } else {
            // 🔄 RETRY COM BACKOFF: Query expandida é importante para POIs grandes
            console.log(`🔄 [IMPORTANT] Fetching expanded streets (radius: ${requiredRadius}m) - will retry up to 5 times if timeout`);
            expandedStreetsResponse = await this.retryOSMQuery(
              expandedStreetsQuery,
              `Expanded streets query (${requiredRadius}m radius)`,
              7,
              3000
            );
          }
          
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
        type: 'polygon',
        coordinates,
        center,
        area_m2: area,
        perimeter_m: 0,
        confidence: 0.95, // Alta confiança quando temos OSM ID
        source: 'osm',
        synthetic,
        height: poiHeight || undefined,
        elevation: elevationData,
        osmTags: poiTags,
        classification,
        streets: processedStreets, // ✅ Usar dados processados
        buildings: processedBuildings, // ✅ Usar dados processados
        vegetation: processedVegetation, // ✅ Usar dados processados
        barriers: processedBarriers, // ✅ Usar dados processados
        peaks: processedPeaks, // ✅ SSLT: dados já coletados na query consolidada
        // ✅ Cache do context já computado durante classification (linha 547).
        // Predictor reusa em vez de chamar analyzeGeographicContext novamente
        // (economia: 1 chamada de density/elevation/OSM analysis por POI).
        cachedContext: contextForClassification,
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
      // 🛡️ NORMALIZAÇÃO CRÍTICA: Overpass retorna 'lon', mas o sistema usa 'lng'
      geometry: (element.geometry || []).map((point: any) => ({
        lat: point.lat,
        lng: point.lng !== undefined ? point.lng : point.lon
      })),
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
      'service': 'service',
      // Non-road routes classified with prefixed names matching isStreetAccessible
      // Non-motorized / active transport
      'cycleway': 'cycleway',
      'footway': 'footway',
      'path': 'path',
      'bus_guideway': 'bus_guideway',
      // Maritime
      'ferry': 'ferry',
      'waterway': 'waterway',
      // Railway (prefixed so isStreetAccessible can match by exact type)
      'rail': 'railway_rail',
      'light_rail': 'railway_light_rail',
      'tram': 'railway_tram',
      'subway': 'railway_subway',
      'monorail': 'railway_monorail',
      'narrow_gauge': 'railway_narrow_gauge',
      'preserved': 'railway_preserved',
      // Aerialway
      'cable_car': 'aerialway_cable_car',
      'gondola': 'aerialway_gondola',
      'chair_lift': 'aerialway_chair_lift',
      'mixed_lift': 'aerialway_mixed_lift',
    };

    // Preserva o tag original quando não está mapeado. Crítico: o fallback
    // antigo era 'unclassified' (presente nos accessible types), o que fazia
    // `footway`, `cycleway`, `path`, `bridleway`, `track` etc. passarem
    // mascarados como vias veiculares. Fix: deixar o original fluir pra que
    // o filtro `isStreetAccessible` rejeite corretamente.
    return highwayMap[highway] || highway;
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
  /**
   * INV-E1a "OSM that contains the pin" (local DB, then Overpass): the areas holding the pin,
   * judged by `boundary-choice#chooseContainingBoundary` (INV-E1c). The chosen polygon is the
   * border; the class keeps reading the POI's own tags (`ownTags`, else `osm_tags`).
   * Replaces the proximity/category searches, which took the longest way in 200 m — a street
   * or a 0.69 km² polygon (Monumento Árvore de Natal, #772).
   */
  private async detectContainingBoundary(poiData: POIData, ownTags?: Record<string, unknown>): Promise<ProcessingResult<BoundaryData>> {
    // The engine input carries the POI tags as `tags` (poi-migration-pipeline#buildEngineInput).
    const tags = (ownTags ?? poiData.osm_tags ?? (poiData as POIData & { tags?: unknown }).tags) as Record<string, unknown> | undefined;
    const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
    let elements: OsmAreaElement[] | null = LocalOSMFetcher.getInstance().fetchAreasContaining(poiData.location);
    if (!elements) {
      const { lat, lng } = poiData.location;
      const query = `
[out:json][timeout:60];
is_in(${lat},${lng})->.a;
(way(pivot.a); relation(pivot.a); way(around:1,${lat},${lng})["building"];);
out geom tags;
`;
      try {
        const response = await this.retryOSMQuery(query, 'OSM areas containing the pin', 3, 2000);
        const data = await response.json();
        // Overpass relations carry member geometries; each closed outer member is a candidate ring.
        elements = (data.elements ?? []).flatMap((el: any) => el.type !== 'relation'
          ? [el]
          : (el.members ?? []).filter((m: any) => m.role === 'outer' && m.geometry?.length >= 4)
              .map((m: any) => ({ type: 'relation', id: el.id, tags: el.tags, geometry: m.geometry })));
      } catch (error) {
        console.warn(`⚠️ Overpass is_in failed for ${poiData.name}:`, error instanceof Error ? error.message : error);
        return { success: false, error: 'Overpass is_in failed', processingTime: 0 };
      }
    }
    const { chosen, rejected } = chooseContainingBoundary(
      poiData.location, { name: poiData.name, hasOwnNode: poiData.osm_type === 'node' && !!poiData.osm_id }, elements ?? []
    );
    this.rejections.push(...rejected);
    if (!chosen) return { success: false, error: 'No OSM area fits the POI at the pin', processingTime: 0 };
    return this.detectOSMBoundaryByID(String(chosen.element.id), chosen.element.type, poiData, {
      element: { ...chosen.element, geometry: chosen.ring.map(p => ({ lat: p.lat, lon: p.lng })) },
      tags,
    });
  }

  private async detectOSMBoundary(poiData: POIData): Promise<ProcessingResult<BoundaryData>> {
    try {
      console.log(`🗺️ OSM boundary detection (primary) for: ${poiData.name}`);
      
      // Estratégia 1: Busca por nome exato (mais provável de funcionar)
      let result = await this.queryOSMByName(poiData);
      if (result.success) {
        console.log('✅ OSM found via exact name match');
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
    
    // 5. Without the leading word — the generic form of the old per-category prefix
    // stripping ("Estádio X", "Igreja X", "Museu X" → "X"). No POI name or category is a
    // branch here (engine-agnostic, epic #772; BR-AUDIO-010).
    const spaced = withoutParens.split(' ').filter(w => w.length > 0);
    if (spaced.length > 2) {
      variations.push(spaced.slice(1).join(' '));
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
        // Identity (osm id + exact name) widens the match to 50 m. The geocoder class/type
        // (peak, building, …) never decides it (operator, 2026-09-27; BR-AUDIO-010).
        const effectiveMaxDistance = exactNameMatch && hasOSMID ? Math.max(maxDistance, 50) : maxDistance;
        if (distance > effectiveMaxDistance) {
          console.log(`⚠️ Result too far: ${distance.toFixed(0)}m (max: ${effectiveMaxDistance}m)`);
          return false;
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
              'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)'
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
            // Identity widens the match; the geocoder class/type never decides it (2026-09-27).
            const exactNameMatch = result.display_name?.toLowerCase().includes(poiData.name.toLowerCase()) ||
                                   poiData.name.toLowerCase().includes(result.display_name?.toLowerCase() || '');
            const maxDistance = result.osm_id && exactNameMatch ? 50 : 10;

            // Validar distância, categoria e localidade (threshold dinâmico)
            if (!this.validateNominatimResult(result, poiData, maxDistance)) {
              console.log(`⚠️ Result rejected for "${searchTerm}": validation failed`);
              continue;
            }
            
            if (result.geojson && result.geojson.coordinates) {
              
              const processed = await this.processNominatimGeometry(result.geojson, lat, lng);
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
                // Captura context computado pelo classifier pra reuso no predictor.
                let cachedContextForReturn: any = undefined;
                
                try {
                  console.log(`🏗️ Extracting POI elevation and height for Nominatim result...`);
                  console.log(`📍 POI center: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);
                  console.log(`🏷️ Nominatim result type: ${result.geojson.type}, osm_type: ${result.osm_type}, osm_id: ${result.osm_id}`);
                  
                  // 🚀 ESTRATÉGIA CONSOLIDADA: 1 query inicial com raio padrão, expande se necessário
                  if (result.osm_id && result.osm_type) {
                    try {
                      // 🚀 QUERY CONSOLIDADA INICIAL: Raio reduzido (150m) para evitar timeout/406 no Overpass
                      // Isso cobre o contexto imediato e a query expandida da etapa 4 cuida do resto se necessário.
                      const INITIAL_RADIUS = 150;
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
                      
                      // 🌍 ESTRATÉGIA 1: LOCAL OSM DB
                      const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
                      const localData = LocalOSMFetcher.getInstance().fetchAsOverpassData(
                        center, INITIAL_RADIUS,
                        { includeBuildings: true, targetOsmId: String(result.osm_id), targetOsmType: result.osm_type }
                      );
                      
                      let osmTagsResponseInitial: any;
                      if (localData && localData.elements.length > 0) {
                        osmTagsResponseInitial = { ok: true, json: async () => localData };
                      } else {
                        // 🔄 RETRY COM BACKOFF: Query consolidada é CRÍTICA
                        osmTagsResponseInitial = await this.retryOSMQuery(
                          consolidatedQueryInitial,
                          'Consolidated OSM query (POI + streets + buildings)',
                          7, 2000
                        );
                      }
                      
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
                          
                          // Extrair altura do POI (Phase 2.E: heurística por tag
                          // fallback quando OSM não tem `height`/`building:levels`).
                          if (poiElementFromQuery) {
                            poiHeight = this.extractOSMHeight(poiElementFromQuery);
                            if (poiHeight) {
                              console.log(`📏 POI height from OSM: ${poiHeight}m`);
                            }
                          } else {
                            // Fallback: tentar buscar altura diretamente usando OSM ID
                            console.log(`🔍 Attempting direct height query for ${result.osm_type}(${targetOSMID})...`);
                            try {
                              // 🌍 ESTRATÉGIA 1: LOCAL OSM DB
                              const localElement = LocalOSMFetcher.getInstance().fetchElementById(result.osm_type, targetOSMID);
                              
                              let heightElement: any = null;
                              if (localElement && localElement.elements.length > 0) {
                                heightElement = localElement.elements.find((el: any) => 
                                  String(el.id) === targetOSMID && el.type === result.osm_type
                                );
                              } else {
                                // 🔄 ESTRATÉGIA 2: OVERPASS API (Fallback)
                                const heightQuery = `
[out:json][timeout:30];
${result.osm_type}(${targetOSMID});
out tags;
`;
                                const heightResponse = await this.retryOSMQuery(
                                  heightQuery,
                                  `Direct height query for ${result.osm_type}(${targetOSMID})`,
                                  2, 1000
                                );
                                
                                if (heightResponse.ok) {
                                  const heightData = await heightResponse.json();
                                  heightElement = heightData.elements?.find((el: any) => 
                                    String(el.id) === targetOSMID && el.type === result.osm_type
                                  );
                                }
                              }
                              
                              if (heightElement) {
                                  poiHeight = this.extractOSMHeight(heightElement);
                                  if (poiHeight) {
                                    console.log(`📏 POI height from direct query: ${poiHeight}m`);
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
                      const elevation = await this.elevationService.getElevation(center, undefined, { tags: poiTags }, undefined, poiData);
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
                        type: 'polygon',
                        coordinates: processed.coordinates,
                        center,
                        area_m2: area,
                        perimeter_m: 0,
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
                      cachedContextForReturn = contextForClassification;
                      
                      
                      // ===============================================
                      // STEP 3: CLASSIFICAR POI
                      // ===============================================
                      
                      // Provisional class, only to size the street query below; `withClassification`
                      // measures again on the final boundary with the same function (E5).
                      const { measureAndClassify } = await import('../services/poi-classifier.service');
                      const { classification } = await measureAndClassify({
                        poiData,
                        boundary: processed.coordinates,
                        areaM2: area,
                        tags: poiTags,
                        knownHeightM: poiHeight || undefined,
                        peaks: peakPoints(processedPeaks),
                        context: contextForClassification,
                      });
                      
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
                        
                        const streetTypes = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified';
                          
                        // Query expandida apenas para ruas (mais leve que buscar apenas o que importa)
                        const expandedStreetsQuery = `
[out:json][timeout:180];
(
  way["highway"~"^(${streetTypes})$"]["access"!~"^(no)$"](poly:"${expandedPolygonFinal}");
);
out geom tags;
`;
                        
                        try {
                          // 🌍 ESTRATÉGIA 1: LOCAL OSM DB
                          const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
                          const localData = LocalOSMFetcher.getInstance().fetchAsOverpassData(
                            center, requiredRadius, { includeBuildings: false }
                          );
                          
                          let expandedStreetsResponse: any;
                          if (localData && localData.elements.length > 0) {
                             expandedStreetsResponse = { ok: true, json: async () => localData };
                          } else {
                            console.log(`🔄 [IMPORTANT] Fetching expanded streets (radius: ${requiredRadius}m) - will retry up to 7 times using mirror rotation`);
                            expandedStreetsResponse = await this.retryOSMQuery(
                              expandedStreetsQuery,
                              `Expanded streets query (${requiredRadius}m radius)`,
                              7, 3000
                            );
                          }
                          
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
                        type: 'polygon',
                        coordinates: processed.coordinates,
                        center,
                        area_m2: area,
                        perimeter_m: 0,
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
                        // 🌍 ESTRATÉGIA 1: LOCAL OSM DB
                        console.log(`🔄 [IMPORTANT] Fetching architectural elements for height`);
                        const { LocalOSMFetcher: ArchFetcher } = await import('../services/local-osm-fetcher');
                        const localArch = ArchFetcher.getInstance().fetchAsOverpassData(
                          center, Math.sqrt(area) / 2, { includeBuildings: true }
                        );
                        
                        let archElements: any[] = [];
                        if (localArch && localArch.elements.length > 0) {
                          archElements = localArch.elements.filter((el: any) => 
                            el.tags?.height || el.tags?.['building:height'] || el.tags?.['building:part'] || el.tags?.man_made
                          );
                        }
                        
                        // Se localArch existe (mesmo vazio), não bater no Overpass para queries secundárias (altura é opcional)
                        if (archElements.length === 0 && (!localArch || localArch.elements.length === 0)) {
                          // 🔄 ESTRATÉGIA 2: OVERPASS API (Fallback)
                          const response = await this.retryOSMQuery(
                            architecturalQuery,
                            'Architectural elements query (for POI height)',
                            7, 3000
                          );
                          
                          if (response.ok) {
                            const data = await response.json();
                            archElements = data.elements || [];
                          }
                        }
                        
                        if (archElements.length > 0) {
                            // Criar boundary temporário para verificação
                            const tempBoundary: BoundaryData = {
                              type: 'polygon',
                              coordinates: processed.coordinates,
                              center,
                              area_m2: area,
                              perimeter_m: 0,
                              confidence: 0.8,
                              source: 'osm'
                            };
                            poiHeight = this.extractHeightFromMultipleElements(archElements, center, tempBoundary);
                            if (poiHeight) {
                              console.log(`✅ Found POI height from architectural elements: ${poiHeight}m`);
                            }
                          } else {
                            console.log(`⚠️ No architectural elements found around Nominatim result`);
                          }
                      } catch (error) {
                        // Se retry falhou, logar mas não bloquear (altura não é crítica para continuar)
                        console.warn(`⚠️ Architectural elements search failed after retries (non-blocking):`, error instanceof Error ? error.message : error);
                      }
                    } // Fechamento do bloco if (!poiHeight) - busca arquitetônica
                  } // Fechamento do bloco if (!poiHeight) - principal
                  
                  // Para Nominatim, não temos tags OSM, então pular direto para Google Elevation
                  const elevation = await this.elevationService.getElevation(center, undefined, result, undefined, poiData);
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
                    type: 'polygon',
                    coordinates: processed.coordinates,
                    center,
                    area_m2: area,
                    perimeter_m: 0,
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
                    osmTags: undefined, // NOVO: tags OSM para classificação (será preenchido se disponível)
                    // ✅ Cache do context computado pela classification (linha ~1919).
                    // Predictor reusa em vez de chamar analyzeGeographicContext novamente.
                    cachedContext: cachedContextForReturn,
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
    // One floor ruler for the engine (INV-E3): config/visibility-class#heightFromTags.
    return heightFromTags(element?.tags)?.heightM ?? null;
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
    
    // Only a building inside the POI footprint is the POI: a type tag near it or a neighbour
    // within 30 m is not (the Cristo took the 24 m of a kiosk, P8; operator, 2026-09-27).
    console.log(`❌ Element external (${distance.toFixed(0)}m, outside the footprint) - external`);
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
   * INV-E1a for a POI whose curated way is OPEN (a line: bridge, promenade, avenue): the ways of
   * the same identity (name / official_name) and via kind that continue it end to end, as a
   * corridor of the way's own `width`, else LINE_CORRIDOR_HALF_WIDTH_M each side. The Ponte
   * Rio-Niterói id is one 45-point motorway segment, and read as a ring it was a 1,040 m² sliver.
   * Overpass down: the segment alone, as a corridor.
   */
  private async sameIdentityCorridor(element: any): Promise<Array<{ lat: number; lng: number }>> {
    const names = ['name', 'official_name'].map(k => element.tags?.[k]).filter((n: unknown) => typeof n === 'string' && n !== '');
    let ways: any[] = [];
    if (names.length > 0) {
      const esc = (n: string) => n.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const query = `
[out:json][timeout:60];
way(${element.id})->.a;
(${names.map((n: string) => `way(around.a:${SANITY_MAX_TP_DISTANCE_M})["name"="${esc(n)}"];way(around.a:${SANITY_MAX_TP_DISTANCE_M})["official_name"="${esc(n)}"];`).join('')});
out geom;
`;
      try {
        const response = await this.retryOSMQuery(query, `ways of the same identity as way(${element.id})`, 3, 2000);
        ways = (await response.json()).elements ?? [];
      } catch (error) {
        console.warn(`⚠️ Same-identity ways of way(${element.id}) unavailable:`, error instanceof Error ? error.message : error);
      }
    }
    const width = parseFloat(String(element.tags?.width ?? ''));
    const halfWidthM = Number.isFinite(width) && width > 0 ? width / 2 : LINE_CORRIDOR_HALF_WIDTH_M;
    return corridorRing(chainSameIdentity(element, ways), halfWidthM);
  }

  private async createEstimatedBoundary(poiData: POIData): Promise<BoundaryData> {
    // Nothing found: the pin as a point, the same circle an OSM node gets, down the same engine
    // path (INV-E1b). As `estimated` it took the one-TP legacy fallback of the predictor, and the
    // Árvore de Natal lost its car-street TP.
    const coordinates = this.createCircularBoundary(poiData.location, POINT_CIRCLE_RADIUS_M);
    return {
      type: 'polygon',
      coordinates,
      center: poiData.location,
      area_m2: calculatePolygonAreaInM2(coordinates),
      perimeter_m: 0,
      confidence: 0.3,
      source: 'synthetic' as const,
      synthetic: true
    };
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
        // A point has no footprint: the same circle as an OSM node (INV-E1b).
        coordinates = this.createCircularBoundary({ lat, lng }, POINT_CIRCLE_RADIUS_M);
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
    
    // 🛡️ PROTEÇÃO: Evitar NaN ou distâncias negativas/zero
    if (isNaN(distanceMeters) || distanceMeters <= 0) {
      console.warn(`⚠️ Invalid expansion distance: ${distanceMeters}m - skipping expansion`);
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
