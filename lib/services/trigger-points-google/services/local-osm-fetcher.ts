import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { POIData, BoundaryData, StreetData } from '../types/interfaces';
import { BuildingData, OSMDataBundle } from './osm-data-fetcher';

/**
 * 🌍 LOCAL OSM FETCHER — Singleton
 * 
 * Consulta o banco SQLite local (data/local_osm.db) para obter ruas, prédios
 * e boundaries sem depender de APIs externas (Overpass, Nominatim).
 * 
 * Princípios:
 * - Singleton: Uma única conexão SQLite reutilizada por todo o processo
 * - DRY: Helpers centralizados (calculateBBox, toOverpassElement, queryStreets, queryBuildings)
 * - KISS: Interface simples com fallback transparente (retorna null = cache miss)
 */
export class LocalOSMFetcher {
  private static instance: LocalOSMFetcher;
  private db: Database.Database | null = null;
  private dbPath: string;

  private constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'local_osm.db');
    
    try {
      if (!fs.existsSync(this.dbPath)) {
        console.log(`⚠️ [LocalOSMFetcher] Local OSM DB not found at ${this.dbPath}`);
        return;
      }
      
      this.db = new Database(this.dbPath, { readonly: true });
      console.log(`✅ [LocalOSMFetcher] Connected to local OSM database`);
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Failed to connect to local database:`, error);
    }
  }

  public static getInstance(): LocalOSMFetcher {
    if (!LocalOSMFetcher.instance) {
      LocalOSMFetcher.instance = new LocalOSMFetcher();
    }
    return LocalOSMFetcher.instance;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS DRY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calcula bounding box a partir de um centro e raio em metros.
   * SSOT: Único local com essa fórmula no projeto.
   */
  private calculateBBox(center: { lat: number; lng: number }, radiusMeters: number) {
    const latDelta = radiusMeters / 111000;
    const lngDelta = radiusMeters / (111000 * Math.cos(center.lat * Math.PI / 180));
    return {
      minLat: center.lat - latDelta,
      maxLat: center.lat + latDelta,
      minLng: center.lng - lngDelta,
      maxLng: center.lng + lngDelta
    };
  }

  /**
   * Converte uma row do SQLite para o formato Overpass API element.
   * DRY: Elimina o mapeamento duplicado em fetchOverpassMock.
   * 
   * IMPORTANTE: O formato Overpass API difere por tipo:
   * - node: { type: "node", id, lat, lon, tags }
   * - way:  { type: "way", id, tags, geometry: [{lat, lon}, ...] }
   */
  private toOverpassElement(row: any, elementType: string, defaultTags: Record<string, string> = {}) {
    const points = JSON.parse(row.geometry_json);
    const tags = row.tags_json ? JSON.parse(row.tags_json) : { ...defaultTags };
    
    // Se for uma rua e não tiver tag highway, garantir uma padrão para o detector não descartar
    if (elementType === 'way' && !tags.highway && row.type) {
      tags.highway = row.type;
    }

    // Extrair ID numérico real. Se falhar, tenta extrair do ID de texto (ex: osm_way_123 -> 123)
    let osmNumericId = tags['@id'];
    if (!osmNumericId) {
      const idStr = String(row.osm_id || row.id || '');
      const match = idStr.match(/\d+/);
      osmNumericId = match ? parseInt(match[0], 10) : Math.floor(Math.random() * 1000000);
    }
    
    const osmElementType = tags['@type'] ?? elementType;
    
    // Nodes: Overpass retorna lat/lon no nível raiz (sem geometry array)
    if (osmElementType === 'node' || (Array.isArray(points) && points.length === 1 && elementType === 'node')) {
      const p = Array.isArray(points) ? points[0] : points;
      return {
        type: 'node',
        id: osmNumericId,
        lat: p.lat,
        lon: p.lng ?? p.lon,
        tags
      };
    }
    
    // Ways/Relations: Overpass retorna geometry como array de {lat, lon}
    return {
      type: osmElementType,
      id: osmNumericId,
      tags,
      geometry: (points || []).map((p: any) => ({ lat: p.lat, lon: p.lng ?? p.lon }))
    };
  }

  /**
   * Busca ruas no banco local por bounding box.
   * Retorna rows crus do SQLite (caller decide o formato de saída).
   */
  private queryStreets(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT id, name, type, geometry_json, tags_json
      FROM streets
      WHERE min_lat <= ? AND max_lat >= ?
        AND min_lng <= ? AND max_lng >= ?
    `);
    return stmt.all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng) as any[];
  }

  /**
   * Busca prédios no banco local por bounding box.
   */
  private queryBuildings(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT id, geometry_json, height, tags_json
      FROM buildings
      WHERE min_lat <= ? AND max_lat >= ?
        AND min_lng <= ? AND max_lng >= ?
    `);
    return stmt.all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng) as any[];
  }

  /**
   * Converte rows de streets para StreetData[].
   */
  private toStreetData(rows: any[]): StreetData[] {
    return rows.map(row => ({
      id: row.id,
      name: row.name || 'Unknown Street',
      type: row.type || 'residential',
      coordinates: JSON.parse(row.geometry_json),
      accessibility: 'public',
      confidence: 0.9,
      tags: row.tags_json ? JSON.parse(row.tags_json) : {}
    }));
  }

  /**
   * Cria um BoundaryData válido a partir de coordenadas, calculando center, area e perimeter.
   */
  private createBoundaryFromCoords(coords: Array<{lat: number; lng: number}>, id: string | number): BoundaryData {
    // Calcular centro
    const center = {
      lat: coords.reduce((sum, c) => sum + c.lat, 0) / coords.length,
      lng: coords.reduce((sum, c) => sum + c.lng, 0) / coords.length
    };
    
    // Calcular área (Shoelace formula em m²) e perímetro
    let area = 0;
    let perimeter = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      // Shoelace em graus → converter para metros (~111000m por grau lat)
      area += coords[i].lng * coords[j].lat - coords[j].lng * coords[i].lat;
      // Distância entre pontos consecutivos
      const dLat = (coords[j].lat - coords[i].lat) * 111000;
      const dLng = (coords[j].lng - coords[i].lng) * 111000 * Math.cos(center.lat * Math.PI / 180);
      perimeter += Math.sqrt(dLat * dLat + dLng * dLng);
    }
    const areaM2 = Math.abs(area / 2) * 111000 * 111000 * Math.cos(center.lat * Math.PI / 180);

    return {
      id,
      type: 'polygon',
      coordinates: coords,
      center,
      area_m2: areaM2,
      perimeter_m: perimeter,
      confidence: 0.9,
      source: 'osm'
    } as BoundaryData;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Busca dados OSM completos (ruas + prédios + boundary) para um POI.
   * Retorna null se não houver dados suficientes (0 ruas = cache miss).
   */
  public fetchLocalData(poiData: POIData, radius: number): OSMDataBundle | null {
    if (!this.db) return null;

    try {
      const searchRadius = Math.min(radius, 500) * 1.2;
      const bbox = this.calculateBBox(poiData.location, searchRadius);

      // 1. Streets
      const streetRows = this.queryStreets(bbox);
      const streets = this.toStreetData(streetRows);

      // 2. Buildings
      const buildingRows = this.queryBuildings(bbox);
      const buildings: BuildingData[] = buildingRows.map(row => ({
        id: row.id,
        geometry: JSON.parse(row.geometry_json),
        height: row.height || 0,
        tags: row.tags_json ? JSON.parse(row.tags_json) : {}
      }));

      // 3. Boundary (por OSM ID ou nome)
      let boundary: BoundaryData | null = null;
      let tags: Record<string, string> = {};
      
      if (poiData.osm_id && poiData.osm_type) {
        const stmt = this.db.prepare(`
          SELECT geometry_json, tags_json FROM pois
          WHERE osm_type = ? AND osm_id = ? LIMIT 1
        `);
        const row = stmt.get(poiData.osm_type, poiData.osm_id) as any;
        if (row) {
          const coords = JSON.parse(row.geometry_json);
          boundary = this.createBoundaryFromCoords(coords, poiData.osm_id);
          tags = row.tags_json ? JSON.parse(row.tags_json) : {};
        }
      }

      if (!boundary && poiData.name) {
        const stmt = this.db.prepare(`
          SELECT osm_id, geometry_json, tags_json FROM pois
          WHERE json_extract(tags_json, '$.name') = ?
            AND min_lat <= ? AND max_lat >= ?
            AND min_lng <= ? AND max_lng >= ?
          LIMIT 1
        `);
        const row = stmt.get(poiData.name, bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng) as any;
        if (row) {
          const coords = JSON.parse(row.geometry_json);
          boundary = this.createBoundaryFromCoords(coords, row.osm_id);
          tags = row.tags_json ? JSON.parse(row.tags_json) : {};
        }
      }

      // Cache miss: 0 ruas = não temos dados suficientes
      if (streets.length === 0) {
        return null;
      }

      console.log(`🚀 [LocalOSMFetcher] Found locally: ${streets.length} streets, ${buildings.length} buildings, boundary=${boundary ? 'yes' : 'no'}`);

      return {
        boundary,
        streets,
        buildings,
        osmTags: tags,
        fetchedAt: new Date(),
        searchRadius
      };
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error querying local DB:`, error);
      return null;
    }
  }

  /**
   * Busca ruas estendidas por raio. Retorna null se cache miss.
   */
  public fetchExtendedStreets(center: { lat: number; lng: number }, radius: number): StreetData[] | null {
    if (!this.db) return null;

    try {
      const bbox = this.calculateBBox(center, radius);
      const rows = this.queryStreets(bbox);
      if (rows.length === 0) return null;

      const streets = this.toStreetData(rows);
      console.log(`🚀 [LocalOSMFetcher] Extended streets found locally: ${streets.length}`);
      return streets;
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching extended streets:`, error);
      return null;
    }
  }

  /**
   * Retorna dados no formato Overpass API (elements[]) para integração
   * transparente com o boundary-detector.ts e geographic-analyzer.ts.
   * 
   * Aceita centro + raio (calcula bbox internamente) ou bbox direto.
   * Retorna null se não encontrar dados (= fallback para Overpass online).
   */
  public fetchAsOverpassData(
    center: { lat: number; lng: number },
    radiusMeters: number,
    options: {
      includeBuildings?: boolean;
      targetOsmId?: string;
      targetOsmType?: string;
    } = {}
  ): { elements: any[] } | null {
    if (!this.db) return null;

    try {
      const bbox = this.calculateBBox(center, radiusMeters);
      const elements: any[] = [];

      // 1. Streets
      const streetRows = this.queryStreets(bbox);
      for (const row of streetRows) {
        elements.push(this.toOverpassElement(row, 'way', { highway: 'residential' }));
      }

      // 2. Buildings
      if (options.includeBuildings !== false) {
        const buildingRows = this.queryBuildings(bbox);
        for (const row of buildingRows) {
          elements.push(this.toOverpassElement(row, 'way', { building: 'yes' }));
        }
      }

      // 3. Specific POI
      if (options.targetOsmId && options.targetOsmType) {
        const stmt = this.db.prepare(`
          SELECT id, geometry_json, tags_json FROM pois
          WHERE osm_type = ? AND osm_id = ? LIMIT 1
        `);
        const row = stmt.get(options.targetOsmType, options.targetOsmId) as any;
        if (row) {
          elements.push(this.toOverpassElement(row, options.targetOsmType));
        }
      }

      if (elements.length === 0) return null;

      console.log(`🚀 [LocalOSMFetcher] Overpass-compatible response: ${elements.length} elements`);
      return { elements };
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error in fetchAsOverpassData:`, error);
      return null;
    }
  }

  /**
   * Busca um elemento OSM específico por tipo e ID no banco local.
   * Estratégia de busca (em ordem de prioridade):
   *   1. Coluna osm_id na tabela pois (mais rápido, dados importados com pbf2json)
   *   2. Campo @id dentro de tags_json (fallback para dados importados com osmium)
   *   3. Busca em streets e buildings por tags_json @id
   * Retorna null se não encontrado (= fallback para Overpass online).
   */
  public fetchElementById(
    osmType: string,
    osmId: string
  ): { elements: any[] } | null {
    if (!this.db) return null;

    try {
      let row: any = null;

      // ═══════════════════════════════════════════════════════════════
      // ESTRATÉGIA 1: Buscar pela coluna osm_id (dados importados via pbf2json)
      // A coluna osm_id contém o ID numérico real do OSM diretamente
      // ═══════════════════════════════════════════════════════════════
      
      // 1a. Buscar na tabela pois por osm_id + osm_type
      const poiByColStmt = this.db.prepare(`
        SELECT id, osm_id, osm_type, geometry_json, tags_json FROM pois
        WHERE osm_id = ? AND osm_type = ? LIMIT 1
      `);
      row = poiByColStmt.get(osmId, osmType) as any;
      if (row) {
        console.log(`🚀 [LocalOSMFetcher] Found element ${osmType}(${osmId}) by ID column in 'pois'`);
      }

      // 1b. Buscar na tabela pois por osm_id apenas (sem filtro de tipo)
      if (!row) {
        const poiByIdStmt = this.db.prepare(`
          SELECT id, osm_id, osm_type, geometry_json, tags_json FROM pois
          WHERE osm_id = ? LIMIT 1
        `);
        row = poiByIdStmt.get(osmId) as any;
      }

      // ═══════════════════════════════════════════════════════════════
      // ESTRATÉGIA 2: Buscar pelo campo @id dentro de tags_json (osmium format)
      // Ex: {"@type":"way","@id":40666277,"name":"Mugar Property"}
      // ═══════════════════════════════════════════════════════════════
      if (!row) {
        const searchPattern = `%"@id":${osmId}%`;
        
        // 2a. Buscar na tabela pois
        const poiStmt = this.db.prepare(`
          SELECT id, osm_id, osm_type, geometry_json, tags_json FROM pois
          WHERE tags_json LIKE ? LIMIT 1
        `);
        row = poiStmt.get(searchPattern) as any;

        // 2b. Buscar na tabela streets
        if (!row) {
          const streetStmt = this.db.prepare(`
            SELECT id, geometry_json, tags_json FROM streets
            WHERE tags_json LIKE ? LIMIT 1
          `);
          row = streetStmt.get(searchPattern) as any;
        }

        // 2c. Buscar na tabela buildings
        if (!row) {
          const buildingStmt = this.db.prepare(`
            SELECT id, geometry_json, tags_json FROM buildings
            WHERE tags_json LIKE ? LIMIT 1
          `);
          row = buildingStmt.get(searchPattern) as any;
        }
      }

      if (!row) {
        console.log(`⚠️ [LocalOSMFetcher] Element ${osmType}(${osmId}) NOT found in local database.`);
        return null;
      }

      const element = this.toOverpassElement(row, osmType);
      console.log(`🚀 [LocalOSMFetcher] Found ${osmType}(${osmId}) in local DB`);
      return { elements: [element] };
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching element by ID:`, error);
      return null;
    }
  }
}
