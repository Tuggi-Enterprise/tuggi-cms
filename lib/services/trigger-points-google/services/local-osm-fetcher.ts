import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { POIData, BoundaryData, StreetData } from '../types/interfaces';
import { BuildingData, OSMDataBundle } from './osm-data-fetcher';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';

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
  // Detected at startup so per-query checks are free. See hotfix-osm-rtree-index.ts.
  private rtreeAvailable: { pois: boolean; streets: boolean; buildings: boolean } = {
    pois: false,
    streets: false,
    buildings: false
  };

  private constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'local_osm.db');

    try {
      if (!fs.existsSync(this.dbPath)) {
        console.log(`⚠️ [LocalOSMFetcher] Local OSM DB not found at ${this.dbPath}`);
        return;
      }

      this.db = new Database(this.dbPath, { readonly: true });
      console.log(`✅ [LocalOSMFetcher] Connected to local OSM database`);

      // Probe for R-tree spatial indexes — used by queryStreets/queryBuildings
      // when present. Missing = falls back transparently to the legacy b-tree.
      const checkRtree = (name: string): boolean => {
        const row = this.db!.prepare(
          `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
        ).get(name) as { 1: number } | undefined;
        return Boolean(row);
      };
      this.rtreeAvailable = {
        pois: checkRtree('pois_rtree'),
        streets: checkRtree('streets_rtree'),
        buildings: checkRtree('buildings_rtree')
      };
      const available = Object.entries(this.rtreeAvailable)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (available.length > 0) {
        console.log(`🗺️  [LocalOSMFetcher] R-tree spatial index detected for: ${available.join(', ')}`);
      } else {
        console.log(`ℹ️  [LocalOSMFetcher] R-tree spatial index not present — using b-tree fallback. Run scripts/hotfix-osm-rtree-index.ts to enable.`);
      }
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
   *
   * Caminho rápido: JOIN com `streets_rtree` (R-tree espacial) quando o hotfix
   * spatial index estiver aplicado (scripts/hotfix-osm-rtree-index.ts). O R-tree
   * é O(log N) verdadeiro pra bbox 4-D, enquanto o índice b-tree legado
   * `idx_streets_bbox` só consegue usar 1 das 4 colunas como range — degenera
   * em scans de dezenas de milhares de rows mesmo pra bboxes pequenas.
   *
   * Caminho legado: mantido pra retrocompatibilidade com máquinas que ainda não
   * rodaram o hotfix. Resultado é semanticamente idêntico — mesmas rows.
   */
  private queryStreets(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
    if (!this.db) return [];
    // LIMIT aplicado no SQL — impede Statement.all() de materializar centenas de
    // milhares de rows em JS (OOM fatal em POIs grandes como Central Park).
    // O cap pós-query por distância (maxStreetsPerPOI) reduz ainda mais.
    const limit = TRIGGER_POINTS_CONSTANTS.memory.maxStreetsPerQuery;
    const stmt = this.rtreeAvailable.streets
      ? this.db.prepare(`
          SELECT s.id, s.name, s.type, s.geometry_json, s.tags_json
          FROM streets s
          JOIN streets_rtree r ON r.rowid = s.rowid
          WHERE r.min_lat <= ? AND r.max_lat >= ?
            AND r.min_lng <= ? AND r.max_lng >= ?
          LIMIT ?
        `)
      : this.db.prepare(`
          SELECT id, name, type, geometry_json, tags_json
          FROM streets
          WHERE min_lat <= ? AND max_lat >= ?
            AND min_lng <= ? AND max_lng >= ?
          LIMIT ?
        `);
    return stmt.all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng, limit) as any[];
  }

  /**
   * Busca prédios no banco local por bounding box.
   * Caminho rápido R-tree / fallback b-tree — ver doc em queryStreets().
   */
  private queryBuildings(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
    if (!this.db) return [];
    const limit = TRIGGER_POINTS_CONSTANTS.memory.maxBuildingsPerQuery;
    const stmt = this.rtreeAvailable.buildings
      ? this.db.prepare(`
          SELECT b.id, b.geometry_json, b.height, b.tags_json
          FROM buildings b
          JOIN buildings_rtree r ON r.rowid = b.rowid
          WHERE r.min_lat <= ? AND r.max_lat >= ?
            AND r.min_lng <= ? AND r.max_lng >= ?
          LIMIT ?
        `)
      : this.db.prepare(`
          SELECT id, geometry_json, height, tags_json
          FROM buildings
          WHERE min_lat <= ? AND max_lat >= ?
            AND min_lng <= ? AND max_lng >= ?
          LIMIT ?
        `);
    return stmt.all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng, limit) as any[];
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
        // Caminho rápido R-tree + b-tree fallback — ver doc em queryStreets().
        const stmt = this.rtreeAvailable.pois
          ? this.db.prepare(`
              SELECT p.osm_id, p.geometry_json, p.tags_json FROM pois p
              JOIN pois_rtree r ON r.rowid = p.rowid
              WHERE json_extract(p.tags_json, '$.name') = ?
                AND r.min_lat <= ? AND r.max_lat >= ?
                AND r.min_lng <= ? AND r.max_lng >= ?
              LIMIT 1
            `)
          : this.db.prepare(`
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
   * Busca ruas ao redor de N pontos amostrados ao longo do boundary do POI.
   *
   * Substitui o paradigma "raio fixo a partir do centro" — que falha pra POIs
   * longos (pontes, calçadões, parques): o centro fica num lugar arbitrário
   * (meio do rio, etc.) e o raio fixo não cobre todas as extremidades.
   *
   * Aqui pegamos N pontos ao longo do perímetro do boundary, buscamos ruas em
   * raio pequeno ao redor de cada um, e fazemos merge. Resultado: cobertura
   * proporcional ao tamanho real do POI, sem buracos.
   */
  public fetchStreetsAlongBoundary(
    boundaryCoords: Array<{ lat: number; lng: number }>,
    radiusPerPointM: number = 200,
    maxSamplePoints: number = 16
  ): StreetData[] | null {
    if (!this.db) return null;
    if (!boundaryCoords || boundaryCoords.length === 0) return null;

    try {
      // Amostragem proporcional ao perímetro
      const samples = this.sampleBoundaryPoints(boundaryCoords, maxSamplePoints);
      if (samples.length === 0) return null;

      const seen = new Set<string>();
      const merged: StreetData[] = [];

      for (const sp of samples) {
        const bbox = this.calculateBBox(sp, radiusPerPointM);
        const rows = this.queryStreets(bbox);
        for (const row of rows) {
          const id = String(row.id);
          if (seen.has(id)) continue;
          seen.add(id);
          merged.push({
            id: row.id,
            name: row.name || 'Unknown Street',
            type: row.type || 'residential',
            coordinates: JSON.parse(row.geometry_json),
            accessibility: 'public',
            confidence: 0.9,
            tags: row.tags_json ? JSON.parse(row.tags_json) : {},
          });
        }
      }

      console.log(`🚀 [LocalOSMFetcher] Streets along boundary: ${merged.length} unique (from ${samples.length} sample points × ${radiusPerPointM}m radius)`);
      return merged;
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching streets along boundary:`, error);
      return null;
    }
  }

  /**
   * Amostra N pontos distribuídos ao longo do perímetro de um polígono.
   * Mesma lógica do VisibilityMapBuilder.sampleBoundary — refatorável depois.
   */
  private sampleBoundaryPoints(
    coords: Array<{ lat: number; lng: number }>,
    maxCount: number
  ): Array<{ lat: number; lng: number }> {
    if (coords.length === 0) return [];

    // Perímetro
    let perimeter = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const dLat = (coords[i + 1].lat - coords[i].lat) * 111_000;
      const dLng = (coords[i + 1].lng - coords[i].lng) * 111_000 * Math.cos(coords[i].lat * Math.PI / 180);
      perimeter += Math.sqrt(dLat * dLat + dLng * dLng);
    }

    // Centroide
    const centroid = {
      lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
      lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length,
    };

    let n: number;
    if (perimeter < 400) n = 1;
    else if (perimeter < 2000) n = 4;
    else if (perimeter < 5000) n = 8;
    else n = Math.min(maxCount, 12);

    if (n === 1) return [centroid];

    const samples: Array<{ lat: number; lng: number }> = [centroid];
    const spacing = perimeter / n;
    let walked = 0;
    let nextTarget = spacing;
    for (let i = 0; i < coords.length - 1 && samples.length < n; i++) {
      const dLat = (coords[i + 1].lat - coords[i].lat) * 111_000;
      const dLng = (coords[i + 1].lng - coords[i].lng) * 111_000 * Math.cos(coords[i].lat * Math.PI / 180);
      const segLen = Math.sqrt(dLat * dLat + dLng * dLng);
      while (walked + segLen >= nextTarget && samples.length < n) {
        const t = (nextTarget - walked) / segLen;
        samples.push({
          lat: coords[i].lat + (coords[i + 1].lat - coords[i].lat) * t,
          lng: coords[i].lng + (coords[i + 1].lng - coords[i].lng) * t,
        });
        nextTarget += spacing;
      }
      walked += segLen;
    }

    return samples;
  }

  /**
   * Busca pontos de entrada OSM (entrance=main / entrance=yes / entrance=*)
   * dentro de uma bounding box. Retorna nós (lat/lng) com a tag normalizada
   * em `kind` para priorização (main > yes > other).
   *
   * Cobre tanto a tabela `pois` (onde nodes de entrada costumam cair) quanto
   * possíveis nodes em `buildings` com tag de entrada.
   */
  public fetchEntrances(
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  ): Array<{ lat: number; lng: number; kind: 'main' | 'yes' | 'other' }> | null {
    if (!this.db) return null;

    try {
      // Caminho rápido: R-tree narrows down primeiro; json_extract substitui o
      // LIKE legado (mais correto — só casa quando a tag entrance existe de fato,
      // não quando "entrance" aparece em qualquer outro campo do tags_json).
      // Fallback b-tree pra máquinas que ainda não rodaram hotfix-osm-rtree-index.
      const stmt = this.rtreeAvailable.pois
        ? this.db.prepare(`
            SELECT p.geometry_json, p.tags_json FROM pois p
            JOIN pois_rtree r ON r.rowid = p.rowid
            WHERE json_extract(p.tags_json, '$.entrance') IS NOT NULL
              AND r.min_lat <= ? AND r.max_lat >= ?
              AND r.min_lng <= ? AND r.max_lng >= ?
          `)
        : this.db.prepare(`
            SELECT geometry_json, tags_json FROM pois
            WHERE tags_json LIKE '%"entrance"%'
              AND min_lat <= ? AND max_lat >= ?
              AND min_lng <= ? AND max_lng >= ?
          `);
      const rows = stmt.all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng) as any[];

      if (!rows || rows.length === 0) return null;

      const entrances: Array<{ lat: number; lng: number; kind: 'main' | 'yes' | 'other' }> = [];
      for (const row of rows) {
        try {
          const geom = JSON.parse(row.geometry_json);
          const tags = row.tags_json ? JSON.parse(row.tags_json) : {};
          const entranceTag = String(tags.entrance || '').toLowerCase();
          if (!entranceTag) continue;

          const kind: 'main' | 'yes' | 'other' =
            entranceTag === 'main' ? 'main' :
            (entranceTag === 'yes' || entranceTag === 'true') ? 'yes' : 'other';

          // Geometria de nó costuma ser um ponto único (array com 1 elemento) ou um objeto
          const point = Array.isArray(geom) ? geom[0] : geom;
          if (!point || typeof point.lat !== 'number') continue;

          entrances.push({
            lat: point.lat,
            lng: point.lng ?? point.lon,
            kind,
          });
        } catch {
          // ignora rows com geometry/tags inválidos
        }
      }

      return entrances.length > 0 ? entrances : null;
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching entrances:`, error);
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
      //
      // Usa json_extract com índice em expressão para evitar full-scan:
      //   CREATE INDEX idx_<tbl>_realosmid ON <tbl>(json_extract(tags_json, '$."@id"'));
      // O CAST para INTEGER é necessário para casar o tipo do índice (o @id no JSON
      // é numérico). Sem o índice essa query também varre a tabela inteira.
      // ═══════════════════════════════════════════════════════════════
      if (!row) {
        const osmIdInt = parseInt(osmId, 10);
        const useNumeric = Number.isFinite(osmIdInt) && String(osmIdInt) === String(osmId).trim();

        if (useNumeric) {
          // 2a. Buscar na tabela pois via índice de expressão
          const poiStmt = this.db.prepare(`
            SELECT id, osm_id, osm_type, geometry_json, tags_json FROM pois
            WHERE json_extract(tags_json, '$."@id"') = ? LIMIT 1
          `);
          row = poiStmt.get(osmIdInt) as any;

          // 2b. Buscar na tabela streets via índice de expressão
          if (!row) {
            const streetStmt = this.db.prepare(`
              SELECT id, geometry_json, tags_json FROM streets
              WHERE json_extract(tags_json, '$."@id"') = ? LIMIT 1
            `);
            row = streetStmt.get(osmIdInt) as any;
          }

          // 2c. Buscar na tabela buildings via índice de expressão
          if (!row) {
            const buildingStmt = this.db.prepare(`
              SELECT id, geometry_json, tags_json FROM buildings
              WHERE json_extract(tags_json, '$."@id"') = ? LIMIT 1
            `);
            row = buildingStmt.get(osmIdInt) as any;
          }
        } else {
          // Fallback: osmId não-numérico (raro) — mantém LIKE como último recurso.
          const searchPattern = `%"@id":${osmId}%`;
          const poiStmt = this.db.prepare(`
            SELECT id, osm_id, osm_type, geometry_json, tags_json FROM pois
            WHERE tags_json LIKE ? LIMIT 1
          `);
          row = poiStmt.get(searchPattern) as any;
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
