// Detector de boundaries usando Google APIs com fallback para OSM

import { heightFromTags, SANITY_MAX_TP_DISTANCE_M, VisibilityClass } from '../config/visibility-class';
import { GoogleAPIsService } from '../services/google-apis.service';
import { ElevationService } from '../services/elevation.service';
import { POIData, GeographicContext, BoundaryData, ProcessingResult } from '../types/interfaces';
import { convertViewportToPolygon, calculatePolygonArea, calculatePolygonAreaInM2, calculatePolygonCenter, calculatePolygonPerimeter, calculateDistance, calculateDistanceToPolygon, isPointInPolygon, isDrawnCircle } from '../utils/calculations';
import { ElevationAnalysisService } from '../services/elevation-service';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { isCuratedBoundaryImplausible } from '../utils/osm-validation';
import { isNaturalLandform } from '../../../shared/poi-taxonomy';
import { regionAt } from '../../local-osm-regions';
import { boundaryFate, isMunicipalElement, type BoundaryFate, type OwnIdLookup, assembleOuterRings, chainSameIdentity, mayHaveIdentityRelation, sameIdentityWaysQuery, chooseContainingBoundary, corridorRing, footprintRing, polygonOuterRings, IDENTITY_NEAR_PIN_M, LINE_CORRIDOR_HALF_WIDTH_M, outerRing, sameFootprint, type BoundaryRejection, type OsmAreaElement } from '../utils/boundary-choice';

/**
 * Radius of the circle that marks a POI with no footprint of its own: an OSM node, a pin with
 * nothing at it, a stored point (INV-E1b). A 50 m "estimated" circle (~8,300 m²) swallowed the
 * street in front of the Igreja da Penna and the TP landed inside it (#772).
 */
export const POINT_CIRCLE_RADIUS_M = 10;

/** `detectOSMBoundaryByID` errors that say what became of the POI's own id (BR-POI-010). */
export const OSM_ID_GONE = 'OSM element not found';
export const OSM_ID_MUNICIPAL = 'OSM element is a municipality and the POI is not its seat';
export const OSM_ID_UNREACHABLE = 'OSM could not be asked for the element';

/**
 * Overpass under load answers HTTP 200 with a `remark` like "runtime error: Query timed out"
 * or "runtime error: ... out of memory" and an empty `elements`. That body is a failure, not
 * an answer: an empty result from it is not proof that the element is gone.
 */
export function isOverpassErrorBody(body: string): boolean {
  const m = body.match(/"remark"\s*:\s*"([^"]*)"/);
  return !!m && /runtime error|timed out|out of memory|rate_limited|too many requests/i.test(m[1]);
}

/** BR-POI-010: what the own-id lookup says. Any other failure came after the element was read: alive. */
export function ownIdLookupOf(byId: { success: boolean; error?: string }): OwnIdLookup {
  if (byId.success) return 'found';
  if (byId.error === OSM_ID_GONE) return 'gone';
  if (byId.error === OSM_ID_MUNICIPAL) return 'municipal';
  if (byId.error === OSM_ID_UNREACHABLE) return 'unknown';
  return 'found';
}
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
          // An overloaded Overpass answers 200 with a runtime-error `remark` and no elements.
          // Accepting it reads as "element gone" and the regen overwrites good TPs with one
          // point TP (Arena BRB Mané Garrincha, 21 → 1, 2026-10-12). Treat it as a failed try.
          const body = await response.text();
          if (isOverpassErrorBody(body)) {
            console.warn(`⚠️ [RETRY ${attempt}/${maxRetries}] ${description} answered 200 with an error remark (mirror: ${new URL(mirror).hostname})`);
            lastError = new Error(`Overpass error remark from ${new URL(mirror).hostname}`);
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, initialDelay * attempt));
            continue;
          }
          return new Response(body, { status: response.status, headers: response.headers });
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
  async detectBoundary(poiData: POIData, opts: { storedReference?: boolean } = {}): Promise<ProcessingResult<BoundaryData>> {
    const startTime = Date.now();
    
    try {
      this.rejections = [];
      // #779: a border a person corrected (CMS drawing, correction SQL) is the footprint. The
      // `rj-estado` batch re-detected and rewrote 2,186 of the 2,189 borders of Rio; it no longer
      // detects over a curated one, and the pipeline does not write it back (`curated`).
      let storedBorder: BoundaryData | undefined;
      if (poiData.id) {
        const stored = await this.fetchBoundaryFromDatabase(poiData.id);
        storedBorder = stored.success ? stored.data : undefined;
        if (stored.success && stored.data?.curated) {
          return {
            success: true,
            // An administrative border needs no class: its TPs are on the roads crossing it (BR-POI-010).
            data: stored.data.source === 'osm_admin' ? stored.data : await this.withClassification(stored.data, poiData),
            processingTime: Date.now() - startTime,
            metadata: {
              step: 'boundary_detection',
              status: 'completed',
              timestamp: new Date().toISOString(),
              strategy: 'curated_stored',
              database_boundary_found: true,
              osm_boundary_found: false
            }
          };
        }
      }
      // BR-POI-010: a POI whose OSM element is the seat of its municipality takes the municipal border.
      const municipality = await this.municipalityBoundary(poiData);
      if (municipality) {
        return {
          success: true,
          data: municipality,
          processingTime: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString(),
            strategy: 'osm_admin_municipality',
            database_boundary_found: false,
            osm_boundary_found: true,
            osm_identified: true
          }
        };
      }
      // BR-POI-010 (#779): a stored `osm` border was read from an element; without the POI's own
      // id there is no element to read it again from, and it came from an earlier run that closed
      // a passing river as a polygon (Cachoeira das 27 Voltas, 7 km²).
      const storedForFate = storedBorder && { source: storedBorder.storedSource, curated: storedBorder.curated };
      let fate: BoundaryFate = boundaryFate(storedForFate, 'none');
      if (!(poiData.osm_id && poiData.osm_type) && fate.fate === 'point') return this.ownPoint(poiData, fate, startTime);

      // INV-E1a: OSM by typed id → OSM that contains the pin → online search → drawn circle.
      let osmBoundaryResult: ProcessingResult<BoundaryData> | null = null;
      // A node id has no footprint: its circle only marks the point, and is the last resort.
      let pointCircle: ProcessingResult<BoundaryData> | null = null;

      if (poiData.osm_id && poiData.osm_type) {
        const byId = await this.detectOSMBoundaryByID(String(poiData.osm_id), poiData.osm_type, poiData);
        // BR-POI-010: the id gone or a municipality → point; alive → its geometry, never the stored one.
        fate = boundaryFate(storedForFate, ownIdLookupOf(byId));
        if (fate.fate === 'point') return this.ownPoint(poiData, fate, startTime);
        if (fate.fate === 'retry') {
          return { success: false, error: `${OSM_ID_UNREACHABLE}; the stored osm border is not reused (BR-POI-010)`, processingTime: Date.now() - startTime };
        }
        if (byId.success && byId.data?.synthetic) pointCircle = byId;
        else osmBoundaryResult = byId;
      }

      // INV-E1c (operator, 2026-10-11): a way or relation POI IS its element — its border is that
      // geometry, never another element's. The Maracanã whose id is the neighbourhood keeps the
      // neighbourhood until its id is corrected (#786 narrowed it to the stadium by name).
      const ownArea = !!poiData.osm_id && (poiData.osm_type === 'way' || poiData.osm_type === 'relation');
      if (!osmBoundaryResult?.success && !ownArea) {
        // A node, or a POI without id: only an area tied to it by id (wikidata, membership).
        const containing = await this.detectContainingBoundary(poiData, pointCircle?.data?.osmTags);
        if (containing.success) osmBoundaryResult = containing;
      }

      if (!osmBoundaryResult?.success && pointCircle) osmBoundaryResult = pointCircle;

      // #779, boundary as reference (épico #772): with `storedReference`, a detection that is not
      // the stored footprint gives way to it, judged by the database branch below as always. In
      // São Paulo the detector took the pitch inside Parque Chácara do Jockey and the river under
      // the Cebolão after the operator had fixed both borders.
      // A stored point circle is no footprint: no area tells it from a building (Casa do Sertanista).
      const detected = osmBoundaryResult?.success ? osmBoundaryResult.data : undefined;
      // BR-POI-010: never over the POI's own live id, nor for a stored `osm` border.
      if (opts.storedReference && fate.fate === 'detect' && storedBorder?.storedSource !== 'osm' && detected && detected.coordinates.length >= 3) {
        const stored = storedBorder;
        const detectedSynthetic = !!detected.synthetic || isDrawnCircle(detected.coordinates);
        if (stored && (detectedSynthetic !== !!stored.synthetic || !sameFootprint(detected.coordinates, stored.coordinates, poiData.location))) {
          this.rejections.push({ element: 'osm', reason: 'not the stored reference border (#779)' });
          osmBoundaryResult = null;
        }
      }

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
        // BR-AUDIO-010, BR-POI-009 (#779): a stored border is judged like a curated id. The Monumento
        // dos Combatentes da FAB had a stored 10.3 km² polygon with the pin 1.9 km outside it. A
        // stored `estimated` border is an earlier run's guess, not a footprint: the Escultura
        // Encontro das Águas kept a 0.83 ha circle; the pin circle below replaces it.
        const stored = dbBoundaryResult.data;
        const storedReject = !dbBoundaryResult.success || !stored ? null
          : stored.source === 'estimated' ? 'stored border is an earlier estimate, not a footprint'
          // #779: a stored slope is derived each run, never a footprint — kept, it would hold a
          // church on its 41 ha of hillside after the relief rule stopped drawing it.
          : stored.source === 'dem_relief' ? 'stored border is an earlier relief derivation, not a footprint'
          // BR-POI-010 (#779): a stored `osm` border is read from its element again or dropped, never
          // reused — the Capela Santa Quitéria kept a 30 km² border of a way gone from OSM.
          : stored.storedSource === 'osm' ? 'stored osm border is never a fallback (BR-POI-010)'
          : isCuratedBoundaryImplausible(poiData.location, stored.coordinates) ? 'stored border is implausible (pin outside, > 500 m from the edge)'
          : null;
        if (storedReject) {
          this.rejections.push({ element: 'database', reason: storedReject });
          dbBoundaryResult = null;
        }
        if (dbBoundaryResult?.success && dbBoundaryResult.data) {
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
  
  /** BR-POI-010 rules 3 and 4: the POI's border is its point — the circle a node gets (INV-E1b). */
  private async ownPoint(poiData: POIData, fate: BoundaryFate, startTime: number): Promise<ProcessingResult<BoundaryData>> {
    const reason = fate.rule === 4 ? 'own OSM element is a municipality, and the POI is not its seat (BR-POI-010)'
      : 'stored osm border without a live OSM id (BR-POI-010)';
    this.rejections.push({ element: fate.rule === 4 ? 'osm' : 'database', reason });
    const point = await this.createEstimatedBoundary(poiData);
    return {
      success: true,
      data: await this.withClassification({ ...point, osmIdentified: fate.rule === 4, rejected: [...this.rejections] }, poiData),
      processingTime: Date.now() - startTime,
      metadata: {
        step: 'boundary_detection',
        status: 'completed',
        timestamp: new Date().toISOString(),
        strategy: fate.rule === 4 ? 'point_municipal_id' : 'point_stored_osm_dropped',
        database_boundary_found: false,
        osm_boundary_found: false,
      }
    };
  }

  /**
   * BR-POI-010: the municipal border of a POI whose OSM element is the seat of its municipality
   * (`admin-boundaries#findMunicipality`), every part kept; null when it is not one. Not curated: the pipeline writes it once as
   * `osm_admin`, and from then on the stored border is read as curated.
   */
  async municipalityBoundary(poiData: Pick<POIData, 'location' | 'osm_type' | 'osm_id'>): Promise<BoundaryData | null> {
    const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
    const found = LocalOSMFetcher.getInstance().municipalityAt(poiData.location, poiData);
    const parts = found ? polygonOuterRings(found.geometry) : [];
    if (!found || parts.length === 0) return null;
    const coordinates = footprintRing(parts, poiData.location) ?? parts[0];
    console.log(`🏛️ Municipality "${found.name}" (relation ${found.osmId}): municipal border, ${parts.length} part(s) (BR-POI-010)`);
    return {
      id: found.osmId,
      type: 'polygon',
      coordinates,
      center: calculatePolygonCenter(coordinates),
      area_m2: calculatePolygonAreaInM2(coordinates),
      perimeter_m: calculatePolygonPerimeter(coordinates),
      confidence: 0.9,
      source: 'osm_admin',
      synthetic: false,
      curated: false,
      osmIdentified: true,
      adminParts: parts,
    };
  }

  /**
   * The municipal border of a POI before anything else runs, so the engine can skip the relief
   * (BR-POI-010): the stored `osm_admin` border, else the detected one. A border a person curated
   * that is not administrative wins over the seat: null.
   */
  async adminBoundaryOf(poiData: Pick<POIData, 'id' | 'location' | 'osm_type' | 'osm_id'>): Promise<BoundaryData | null> {
    if (poiData.id) {
      const stored = await this.fetchBoundaryFromDatabase(poiData.id);
      if (stored.success && stored.data?.curated) return stored.data.source === 'osm_admin' ? stored.data : null;
    }
    return this.municipalityBoundary(poiData);
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
    // Only a natural landform takes the slope (#779): a church, a theatre or a station on a hill
    // took 0.9–41 ha of hillside in Rio and São Paulo. Nor a curated border: a person chose it.
    if (!boundary.synthetic || boundary.curated || measured.classification?.group === VisibilityClass.LANDMARK_HIGH || !physical) return measured;
    if (!isNaturalLandform(poiData.category, (poiData.osm_tags ?? (poiData as POIData & { tags?: Record<string, unknown> }).tags) as Record<string, any> | undefined)) return measured;
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
      
      // BR-POI-009: the border is one ring, so of N polygon parts it is the part holding the pin;
      // without one, the largest (`footprintRing`). Parts away from the pin are not covered.
      const parts = polygonOuterRings(geometry);
      const multiPart = parts.length > 1;
      if (parts.length > 0) {
        const pin = metadata?.latitude != null && metadata?.longitude != null
          ? { lat: Number(metadata.latitude), lng: Number(metadata.longitude) }
          : undefined;
        coordinates = footprintRing(parts, pin) ?? parts[0];
      } else if (geometry.type === 'Point') {
        // Point: criar boundary circular pequeno
        const center = {
          lat: geometry.coordinates[1],
          lng: geometry.coordinates[0]
        };
        coordinates = this.createCircularBoundary(center, POINT_CIRCLE_RADIUS_M);
        synthetic = true;
      } else if (geometry.type === 'LineString') {
        // BR-POI-010 (#779): a line is no border; read as a ring it closed a river over a church.
        return { success: false, error: 'Stored border is a line, not a polygon', processingTime: 0 };
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
      // The stored area of a multi-part border sums every part; the border is the chosen part.
      const area = metadata?.boundary_area_m2 && !multiPart ? Number(metadata.boundary_area_m2) : calculatePolygonAreaInM2(coordinates);
      const confidence = metadata?.boundary_confidence ? Number(metadata.boundary_confidence) : 0.8;
      
      // BR-POI-009: a border stored without a source is not the curator's. Read as 'manual' it was
      // written back as 'manual' and became curated on the next run (3,592 borders in Portugal).
      const storedSource = (metadata?.boundary_source as BoundaryData['source'] | null) || 'unknown';
      // #779: the marker of a corrected border. The detector writes 0.9 or 0.5, never 1; the CMS
      // drawing routes write 1.0, and so must a correction SQL (keeping its `osm`/`synthetic` source).
      // Only a source actually stored counts, never the fallback above.
      // BR-POI-009: an `osm_admin` border was set on purpose and holds every part of the municipality;
      // curated, the batch never writes the pin's part alone over it.
      const admin = metadata?.boundary_source === 'osm_admin';
      const curated = (metadata?.boundary_confidence != null && Number(metadata.boundary_confidence) >= 1)
        || metadata?.boundary_source === 'manual' || metadata?.boundary_source === 'manual_drawing' || admin;
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
        storedSource: metadata?.boundary_source ?? null,
        synthetic,
        curated,
        ...(admin && parts.length > 0 ? { adminParts: parts } : {}),
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
        let data: any;
        try {
          const response = await this.retryOSMQuery(query, `OSM ID query: ${osmType}(${osmID})`, 7, 2000);
          data = await response.json();
        } catch (error) {
          console.warn(`⚠️ OSM query failed for ${osmType}(${osmID}):`, error instanceof Error ? error.message : error);
          return { success: false, error: OSM_ID_UNREACHABLE, processingTime: 0 };
        }
        elements = data.elements || [];
      }
      
      if (elements.length === 0) {
        console.warn(`⚠️ No OSM element found for ${osmType}(${osmID})`);
        return { success: false, error: OSM_ID_GONE, processingTime: 0 };
      }
      
      const element = elements[0];
      if (!chosen && isMunicipalElement(element.tags)) {
        console.warn(`🚫 ${osmType}(${osmID}) is a municipality, and the POI is not its seat (BR-POI-010)`);
        return { success: false, error: OSM_ID_MUNICIPAL, processingTime: 0 };
      }

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
      // verdade (curado upstream — admin UI, import). Divergência de
      // centróide a >200 m só vira warning — EXCETO o caso implausível: pino fora
      // do polígono e centróide a >1 km. Aí o id aponta para outro elemento e o
      // boundary é recusado (BR-AUDIO-010; auditoria de TP, 2026-09-27).
      const distanceFromPOI = calculateDistance(center, poiData.location);
      const poiTags = chosen ? (chosen.tags ?? {}) : (element.tags || {});

      if (isCuratedBoundaryImplausible(poiData.location, coordinates)) {
        console.warn(`🚫 osm_id=${osmType}(${osmID}) rejected: pin outside polygon and far from its edge`);
        return { success: false, error: 'Curated osm_id boundary is implausible (pin outside, > 500 m from the edge)', processingTime: 0 };
      }

      if (distanceFromPOI > 200) {
        const pinIsInsideBoundary = isPointInPolygon(poiData.location, coordinates);
        console.log(`📐 osm_id=${osmType}(${osmID}) centroid is ${distanceFromPOI.toFixed(0)}m from POI pin (area=${(area / 1000000).toFixed(2)}km², pin inside=${pinIsInsideBoundary}) — trusting curated osm_id`);
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
      // null = no region covers the center, or the local query failed. Covered and empty is final.
      if (localConsolidated) {
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
          if (localData) { // covered and empty is final; Overpass only for null (uncovered / failed)
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
   * INV-E1a "OSM that contains the pin" (local DB, then Overpass), for a POI that is a node or has
   * no OSM id: the areas at the pin, of which only one tied to the POI by id may be its border
   * (`boundary-choice#chooseContainingBoundary`, INV-E1c). The class keeps reading the POI's own
   * tags (`ownTags`, else `osm_tags`). A name ties nothing (operator, 2026-10-11).
   */
  private async detectContainingBoundary(poiData: POIData, ownTags?: Record<string, unknown>): Promise<ProcessingResult<BoundaryData>> {
    // The engine input carries the POI tags as `tags` (poi-migration-pipeline#buildEngineInput).
    const tags = (ownTags ?? poiData.osm_tags ?? (poiData as POIData & { tags?: unknown }).tags) as Record<string, unknown> | undefined;
    const wikidata = typeof tags?.wikidata === 'string' && /^Q\d+$/.test(tags.wikidata.trim()) ? tags.wikidata.trim() : null;
    const nodeId = poiData.osm_type === 'node' && poiData.osm_id ? String(poiData.osm_id) : null;
    // Nothing can tie an element to the POI: no search (INV-E1c, operator 2026-10-11).
    if (!wikidata && !nodeId) return { success: false, error: 'No id to tie an OSM area to the POI (wikidata, node)', processingTime: 0 };
    const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
    let elements: OsmAreaElement[] | null = LocalOSMFetcher.getInstance().fetchAreasContaining(poiData.location, IDENTITY_NEAR_PIN_M);
    if (!elements) {
      const { lat, lng } = poiData.location;
      // The relations the POI node is a member of carry `members`; the local DB keeps none.
      const memberOf = nodeId ? `node(${nodeId})->.n;relation(bn.n);` : '';
      const tied = wikidata ? `way(around:${IDENTITY_NEAR_PIN_M},${lat},${lng})["wikidata"="${wikidata}"];relation(around:${IDENTITY_NEAR_PIN_M},${lat},${lng})["wikidata"="${wikidata}"];` : '';
      const query = `
[out:json][timeout:60];
is_in(${lat},${lng})->.a;
(way(pivot.a); relation(pivot.a); way(around:1,${lat},${lng})["building"];${tied}${memberOf});
out geom;
`;
      try {
        const response = await this.retryOSMQuery(query, 'OSM areas around the pin', 3, 2000);
        const data = await response.json();
        // Overpass relations carry member geometries; each closed outer member is a candidate ring.
        elements = (data.elements ?? []).flatMap((el: any) => el.type !== 'relation'
          ? [el]
          : (el.members ?? []).filter((m: any) => m.role === 'outer' && m.geometry?.length >= 4)
              .map((m: any) => ({ type: 'relation', id: el.id, tags: el.tags, geometry: m.geometry, members: el.members })));
      } catch (error) {
        console.warn(`⚠️ Overpass is_in failed for ${poiData.name}:`, error instanceof Error ? error.message : error);
        return { success: false, error: 'Overpass is_in failed', processingTime: 0 };
      }
    }
    const { chosen, rejected } = chooseContainingBoundary(poiData.location, { wikidata, nodeId }, elements ?? []);
    this.rejections.push(...rejected);
    if (!chosen) return { success: false, error: 'No OSM area tied to the POI by id', processingTime: 0 };
    return this.detectOSMBoundaryByID(String(chosen.element.id), chosen.element.type, poiData, {
      element: { ...chosen.element, geometry: chosen.ring.map(p => ({ lat: p.lat, lon: p.lng })) },
      tags,
    });
  }

  /**
   * Extrai altura do POI das tags OSM (versão escalável para múltiplos elementos)
   */
  private extractOSMHeight(element: any): number | null {
    // One floor ruler for the engine (INV-E3): config/visibility-class#heightFromTags.
    return heightFromTags(element?.tags)?.heightM ?? null;
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
   * INV-E1a for a POI whose curated way is OPEN (a line: bridge, promenade, avenue): the ways tied
   * to it by id (same wikidata, same waterway or bridge relation; never the name) and of its via
   * kind that continue it end to end, as a corridor of the way's own `width`, else
   * LINE_CORRIDOR_HALF_WIDTH_M each side. The Ponte Rio-Niterói id is one 45-point motorway
   * segment, and read as a ring it was a 1,040 m² sliver. Overpass down: the segment alone.
   * Local DB first (operator, 2026-10-13): both halves come from there — the ways of its wikidata,
   * and the members of its bridge or waterway relation (`LocalOSMFetcher#fetchWaysByIdentityRelation`).
   * Overpass is asked only when no region covers the way (the whole query), or when the region
   * predates the relation table, holds no other way of that wikidata and the way may be in such a
   * relation (the relation half alone: transition until the region is reimported).
   */
  private async sameIdentityCorridor(element: any): Promise<Array<{ lat: number; lng: number }>> {
    const raw = String(element.tags?.wikidata ?? '').trim();
    const qid = /^Q\d+$/.test(raw) ? raw : null;
    const first = element.geometry?.[0];
    const { LocalOSMFetcher } = await import('../services/local-osm-fetcher');
    const fetcher = LocalOSMFetcher.getInstance();
    const at = first ? { lat: first.lat, lng: first.lon ?? first.lng } : undefined;
    // [] = the region answered (no wikidata to look up); null = no region covers the way.
    const local = !at || !regionAt(fetcher.regionList(), at.lat, at.lng) ? null : qid ? fetcher.fetchWaysByWikidata(at, SANITY_MAX_TP_DISTANCE_M, qid) : [];
    let ways: any[] = local ?? [];
    let source = 'local';
    let relationFromOverpass = false;
    if (local !== null && at && mayHaveIdentityRelation(element.tags)) {
      const byRelation = fetcher.fetchWaysByIdentityRelation(at, SANITY_MAX_TP_DISTANCE_M, element.id);
      // One copy per way id: a duplicate would let chainSameIdentity walk a way back over itself.
      if (byRelation) ways = ways.concat(byRelation.filter(w => !ways.some(x => String(x.id) === String(w.id))));
      else relationFromOverpass = !ways.some(w => String(w.id) !== String(element.id));
    }
    if (local === null || relationFromOverpass) {
      source = local ? 'local+overpass(relation)' : 'overpass';
      try {
        // The local DB answered the wikidata half (nothing there): ask Overpass for the relation half only.
        const query = sameIdentityWaysQuery(element.id, local ? null : qid, SANITY_MAX_TP_DISTANCE_M);
        const response = await this.retryOSMQuery(query, `ways tied by id to way(${element.id})`, 3, 2000);
        ways = ways.concat((await response.json()).elements ?? []);
      } catch (error) {
        console.warn(`⚠️ Ways tied by id to way(${element.id}) unavailable:`, error instanceof Error ? error.message : error);
      }
    }
    const width = parseFloat(String(element.tags?.width ?? ''));
    const halfWidthM = Number.isFinite(width) && width > 0 ? width / 2 : LINE_CORRIDOR_HALF_WIDTH_M;
    const ring = corridorRing(chainSameIdentity(element, ways), halfWidthM);
    console.log(`🧵 way(${element.id}) corridor: ${ways.length} tied ways (${source}), ${Math.round(calculatePolygonAreaInM2(ring))} m²`);
    return ring;
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
  
}
