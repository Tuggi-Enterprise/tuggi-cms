import Database from 'better-sqlite3';
import { POIData, BoundaryData, StreetData } from '../types/interfaces';
import { BuildingData, OSMDataBundle } from './osm-data-fetcher';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config';
import { isPublicWay } from '../config/visibility-class';
import { isPointInPolygon } from '../utils/calculations';
import { outerRings } from '../utils/boundary-choice';
import { listOsmRegions, localOsmDir, regionAt, OsmRegion } from '../../local-osm-regions';
import { findMunicipality, type Municipality, type PoiOsmElement } from '../../admin-boundaries';

/**
 * 🌍 LOCAL OSM FETCHER — Singleton
 * 
 * Consulta as bases SQLite locais (uma por país/região, `local-osm-regions`) para obter ruas,
 * prédios e boundaries sem depender de APIs externas (Overpass, Nominatim).
 * 
 * Princípios:
 * - Singleton: uma conexão SQLite por região, aberta no primeiro uso e reutilizada pelo processo
 * - DRY: Helpers centralizados (calculateBBox, toOverpassElement, queryStreets, queryBuildings)
 * - KISS: Interface simples com fallback transparente (retorna null = cache miss)
 */
/** Sanity bound on the query points along one edge (fetchStreetsAlongBoundary). */
const BOUNDARY_SAMPLE_CAP = 600;

type RtreeFlags = { pois: boolean; streets: boolean; buildings: boolean };

/** One local OSM region (`local-osm-regions`), opened read-only on first use. */
interface RegionHandle extends Pick<OsmRegion, 'name' | 'covers'> {
  dbPath?: string;
  db: Database.Database | null;
  rtree: RtreeFlags;
}

export class LocalOSMFetcher {
  private static instance: LocalOSMFetcher;
  /** One file per country or region (#833, L1); every query picks the one covering its point. */
  private regions: RegionHandle[] = [];
  // The region selected by `select()`. Every public method selects first and then runs
  // synchronously (better-sqlite3 has no await), so concurrent POIs never see each other's pick.
  private db: Database.Database | null = null;
  // Detected per region on open, so per-query checks are free. See hotfix-osm-rtree-index.ts.
  private rtreeAvailable: RtreeFlags = { pois: false, streets: false, buildings: false };

  private constructor() {
    const dir = localOsmDir();
    try {
      this.regions = listOsmRegions(dir).map(r => ({ ...r, db: null, rtree: { pois: false, streets: false, buildings: false } }));
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Invalid local OSM directory ${dir}:`, error);
    }
    if (this.regions.length === 0) {
      console.log(`⚠️ [LocalOSMFetcher] No local OSM region in ${dir}`);
    } else {
      console.log(`✅ [LocalOSMFetcher] Local OSM regions in ${dir}: ${this.regions.map(r => r.name).join(', ')}`);
    }
  }

  /** Names of the local regions, for the coverage gate (`local-osm-regions#requireLocalOsmCoverage`). */
  public regionList(): Array<Pick<OsmRegion, 'name' | 'covers'>> {
    return this.regions;
  }

  private open(region: RegionHandle): boolean {
    if (region.db) return true;
    if (!region.dbPath) return false;
    try {
      const db = new Database(region.dbPath, { readonly: true });
      // Probe for R-tree spatial indexes — used by queryStreets/queryBuildings
      // when present. Missing = falls back transparently to the legacy b-tree.
      const has = (name: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
      region.rtree = { pois: has('pois_rtree'), streets: has('streets_rtree'), buildings: has('buildings_rtree') };
      region.db = db;
      const available = Object.entries(region.rtree).filter(([, v]) => v).map(([k]) => k);
      console.log(available.length > 0
        ? `🗺️  [LocalOSMFetcher] ${region.name}: R-tree spatial index detected for: ${available.join(', ')}`
        : `ℹ️  [LocalOSMFetcher] ${region.name}: R-tree spatial index not present — using b-tree fallback. Run scripts/hotfix-osm-rtree-index.ts to enable.`);
      return true;
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Failed to open ${region.dbPath}:`, error);
      return false;
    }
  }

  private use(region: RegionHandle | null): boolean {
    if (!region || !this.open(region)) {
      this.db = null;
      return false;
    }
    this.db = region.db;
    this.rtreeAvailable = region.rtree;
    return true;
  }

  /** Selects the region covering the point; null (= no local data) outside every region. */
  private select(point: { lat: number; lng: number } | undefined): Database.Database | null {
    return this.use(point ? regionAt(this.regions, point.lat, point.lng) : null) ? this.db : null;
  }

  private bboxCentre(b: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
    return { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
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
  /**
   * Every street read goes through here, so a way closed to the public never reaches E7 on any
   * path (main, perimeter, reach rescue, far tiles): `config/visibility-class#isPublicWay`.
   */
  private queryStreets(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }, types?: string[]): any[] {
    return this.queryStreetRows(bbox, types).filter((row: any) =>
      !row.tags_json || !/"(access|military)"/.test(row.tags_json) || isPublicWay(JSON.parse(row.tags_json)));
  }

  private queryStreetRows(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }, types?: string[]): any[] {
    if (!this.db) return [];
    if (types?.length) {
      const marks = types.map(() => '?').join(',');
      const sql = this.rtreeAvailable.streets
        ? `SELECT s.id, s.name, s.type, s.geometry_json, s.tags_json FROM streets s
           JOIN streets_rtree r ON r.rowid = s.rowid
           WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lng <= ? AND r.max_lng >= ? AND s.type IN (${marks})
           LIMIT ?`
        : `SELECT id, name, type, geometry_json, tags_json FROM streets
           WHERE min_lat <= ? AND max_lat >= ? AND min_lng <= ? AND max_lng >= ? AND type IN (${marks})
           LIMIT ?`;
      return this.db.prepare(sql).all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng, ...types, TRIGGER_POINTS_CONSTANTS.memory.maxStreetsPerQuery) as any[];
    }
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
    // One row per outer ring: the DB stores a multipolygon's rings in sequence (`outerRings`).
    return (stmt.all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng, limit) as any[]).flatMap(row => {
      const rings = outerRings(JSON.parse(row.geometry_json));
      return rings.length <= 1 ? [row] : rings.map(r => ({ ...row, geometry_json: JSON.stringify(r) }));
    });
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
    const db = this.select(poiData.location);
    if (!db) return null;

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
        const stmt = db.prepare(`
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
          ? db.prepare(`
              SELECT p.osm_id, p.geometry_json, p.tags_json FROM pois p
              JOIN pois_rtree r ON r.rowid = p.rowid
              WHERE json_extract(p.tags_json, '$.name') = ?
                AND r.min_lat <= ? AND r.max_lat >= ?
                AND r.min_lng <= ? AND r.max_lng >= ?
              LIMIT 1
            `)
          : db.prepare(`
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
    const db = this.select(center);
    if (!db) return null;

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
    const db = this.select(center);
    if (!db) return null;

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
        const stmt = db.prepare(`
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
    /** Only these `streets.type` values (municipal border mode: main roads, `admin-border-tps`). */
    types?: readonly string[]
  ): StreetData[] | null {
    if (!boundaryCoords || boundaryCoords.length === 0) return null;
    // The region of any vertex it covers, not of the first one: a border on a national frontier
    // starts outside the extract (Lustenau, on the Rhine, 2026-10-09: vertex 0 off `at.poly`, 0 streets).
    const db = this.select(boundaryCoords.find(p => regionAt(this.regions, p.lat, p.lng)) ?? boundaryCoords[0]);
    if (!db) return null;

    try {
      const samples = this.sampleBoundaryPoints(boundaryCoords, radiusPerPointM);
      if (samples.length === 0) return null;

      const seen = new Set<string>();
      const merged: StreetData[] = [];

      for (const sp of samples) {
        const bbox = this.calculateBBox(sp, radiusPerPointM);
        const rows = this.queryStreets(bbox, types ? [...types] : undefined);
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
   * Streets of the given types in a disc of `radiusM` around `center`, queried tile by tile
   * (`tileM`) so the per-query LIMIT never cuts a whole direction off: one bbox of 30 km hit
   * the LIMIT and returned whatever the index gave first (E7, INV-E7c, #772).
   */
  public fetchStreetsInTiles(
    center: { lat: number; lng: number },
    radiusM: number,
    types: string[],
    tileM: number
  ): StreetData[] | null {
    const db = this.select(center);
    if (!db) return null;
    const seen = new Set<string>();
    const out: StreetData[] = [];
    const n = Math.ceil(radiusM / tileM);
    for (let i = -n; i < n; i++) {
      for (let j = -n; j < n; j++) {
        // skip tiles whose nearest corner is beyond the disc
        const dn = Math.max(0, i * tileM, -(i + 1) * tileM), de = Math.max(0, j * tileM, -(j + 1) * tileM);
        if (dn * dn + de * de > radiusM * radiusM) continue;
        const lat0 = center.lat + (i * tileM) / 111000;
        const lat1 = center.lat + ((i + 1) * tileM) / 111000;
        const k = 111000 * Math.cos((center.lat * Math.PI) / 180);
        const lng0 = center.lng + (j * tileM) / k;
        const lng1 = center.lng + ((j + 1) * tileM) / k;
        for (const row of this.queryStreets({ minLat: lat0, maxLat: lat1, minLng: lng0, maxLng: lng1 }, types)) {
          const id = String(row.id);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({
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
    }
    return out;
  }

  /**
   * Amostra N pontos distribuídos ao longo do perímetro de um polígono.
   * Mesma lógica do VisibilityMapBuilder.sampleBoundary — refatorável depois.
   */
  /**
   * Points along the edge, one every `spacingM` (the query radius), so the query squares overlap
   * and every stretch of the edge is searched out to the radius. A fixed count (4 up to 2 km of
   * perimeter, 12 beyond) with a 60 m radius left most of the edge unsearched: the Estádio Nilton
   * Santos (1 km) had streets on four sides and candidates on two; the Lagoa Rodrigo de Freitas
   * lost 1 km of Av. Borges de Medeiros (#772). BOUNDARY_SAMPLE_CAP is only a sanity bound.
   */
  private sampleBoundaryPoints(
    coords: Array<{ lat: number; lng: number }>,
    spacingM: number
  ): Array<{ lat: number; lng: number }> {
    if (coords.length === 0) return [];
    const segLen = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const dLat = (b.lat - a.lat) * 111_000;
      const dLng = (b.lng - a.lng) * 111_000 * Math.cos(a.lat * Math.PI / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng);
    };
    let perimeter = 0;
    for (let i = 0; i < coords.length - 1; i++) perimeter += segLen(coords[i], coords[i + 1]);
    const centroid = {
      lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
      lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length,
    };
    if (perimeter <= spacingM) return [centroid];

    const step = Math.max(spacingM, perimeter / BOUNDARY_SAMPLE_CAP);
    const samples: Array<{ lat: number; lng: number }> = [coords[0]];
    let walked = 0;
    let nextTarget = step;
    for (let i = 0; i < coords.length - 1; i++) {
      const len = segLen(coords[i], coords[i + 1]);
      while (len > 0 && walked + len >= nextTarget) {
        const t = (nextTarget - walked) / len;
        samples.push({
          lat: coords[i].lat + (coords[i + 1].lat - coords[i].lat) * t,
          lng: coords[i].lng + (coords[i + 1].lng - coords[i].lng) * t,
        });
        nextTarget += step;
      }
      walked += len;
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
    const db = this.select(this.bboxCentre(bbox));
    if (!db) return null;

    try {
      // Caminho rápido: R-tree narrows down primeiro; json_extract substitui o
      // LIKE legado (mais correto — só casa quando a tag entrance existe de fato,
      // não quando "entrance" aparece em qualquer outro campo do tags_json).
      // Fallback b-tree pra máquinas que ainda não rodaram hotfix-osm-rtree-index.
      const stmt = this.rtreeAvailable.pois
        ? db.prepare(`
            SELECT p.geometry_json, p.tags_json FROM pois p
            JOIN pois_rtree r ON r.rowid = p.rowid
            WHERE json_extract(p.tags_json, '$.entrance') IS NOT NULL
              AND r.min_lat <= ? AND r.max_lat >= ?
              AND r.min_lng <= ? AND r.max_lng >= ?
          `)
        : db.prepare(`
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
   * Surveyed summits (`natural=peak|volcano` nodes with `ele`) in a bbox — the ground-top read
   * of the TP engine (E4, INV-E4a). SRTM here is a 90 m grid and puts Corcovado at 568 m;
   * the summit node says 710. null without the local DB.
   */
  public fetchSummits(
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  ): Array<{ lat: number; lng: number; tags: Record<string, unknown> }> | null {
    const db = this.select(this.bboxCentre(bbox));
    if (!db) return null;
    try {
      const stmt = this.rtreeAvailable.pois
        ? db.prepare(`
            SELECT p.geometry_json, p.tags_json FROM pois p
            JOIN pois_rtree r ON r.rowid = p.rowid
            WHERE json_extract(p.tags_json, '$.natural') IN ('peak', 'volcano')
              AND json_extract(p.tags_json, '$.ele') IS NOT NULL
              AND r.min_lat <= ? AND r.max_lat >= ?
              AND r.min_lng <= ? AND r.max_lng >= ?
          `)
        : db.prepare(`
            SELECT geometry_json, tags_json FROM pois
            WHERE json_extract(tags_json, '$.natural') IN ('peak', 'volcano')
              AND json_extract(tags_json, '$.ele') IS NOT NULL
              AND min_lat <= ? AND max_lat >= ?
              AND min_lng <= ? AND max_lng >= ?
          `);
      const rows = stmt.all(bbox.maxLat, bbox.minLat, bbox.maxLng, bbox.minLng) as any[];
      const out: Array<{ lat: number; lng: number; tags: Record<string, unknown> }> = [];
      for (const row of rows ?? []) {
        try {
          const geom = JSON.parse(row.geometry_json);
          const point = Array.isArray(geom) ? geom[0] : geom;
          if (!point || typeof point.lat !== 'number') continue;
          out.push({ lat: point.lat, lng: point.lng ?? point.lon, tags: JSON.parse(row.tags_json || '{}') });
        } catch {
          // ignora rows com geometry/tags inválidos
        }
      }
      return out;
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching summits:`, error);
      return null;
    }
  }

  /**
   * E1 (INV-E1c, BR-POI-009): the tags of every named OSM node standing inside `ring`. An unnamed
   * area holding a named place of another name is the ground under it, not a POI: the 100 km²
   * forest of the Maciço da Pedra Branca holds 112 named peaks and streams (#779).
   * null when the local DB is not available.
   */
  public namedNodesInside(ring: Array<{ lat: number; lng: number }>): Array<Record<string, unknown>> | null {
    const db = ring.length < 3 ? null : this.select(ring[0]);
    if (!db) return null;
    try {
      const lats = ring.map(p => p.lat);
      const lngs = ring.map(p => p.lng);
      const box = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
      const rows = db.prepare(this.rtreeAvailable.pois
        ? `SELECT p.geometry_json, p.tags_json FROM pois p JOIN pois_rtree r ON r.rowid = p.rowid
           WHERE r.min_lat >= ? AND r.max_lat <= ? AND r.min_lng >= ? AND r.max_lng <= ? AND p.osm_type = 'node'`
        : `SELECT geometry_json, tags_json FROM pois
           WHERE min_lat >= ? AND max_lat <= ? AND min_lng >= ? AND max_lng <= ? AND osm_type = 'node'`
      ).all(...box) as Array<{ geometry_json: string; tags_json: string | null }>;
      const out: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        const tags = row.tags_json ? JSON.parse(row.tags_json) : null;
        if (!tags?.name) continue;
        const g = JSON.parse(row.geometry_json);
        const p = Array.isArray(g) ? g[0] : g;
        if (p && isPointInPolygon({ lat: p.lat, lng: p.lng ?? p.lon }, ring)) out.push(tags);
      }
      return out;
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching named nodes inside a ring:`, error);
      return null;
    }
  }

  /**
   * E1 (INV-E1a, "OSM that contains the pin"): every mapped area whose bounding box holds the
   * pin — `pois` (ways and multipolygons) and `buildings` — as Overpass elements. The caller
   * decides which one is the border (`boundary-choice#chooseContainingBoundary`).
   * null when the local DB is not available (the caller goes to Overpass). `marginM` widens the
   * box around the pin: a border of the POI's identity may stand next to it (INV-E1c).
   */
  public fetchAreasContaining(pin: { lat: number; lng: number }, marginM = 0): any[] | null {
    const db = this.select(pin);
    if (!db) return null;
    try {
      const out: any[] = [];
      const dLat = marginM / 110_540;
      const dLng = marginM / (111_320 * Math.cos((pin.lat * Math.PI) / 180));
      for (const table of ['pois', 'buildings'] as const) {
        const cols = table === 'pois' ? 'p.id, p.osm_id, p.osm_type, p.geometry_json, p.tags_json' : 'p.id, p.geometry_json, p.tags_json';
        const rtree = this.rtreeAvailable[table];
        const rows = db.prepare(rtree
          ? `SELECT ${cols} FROM ${table} p JOIN ${table}_rtree r ON r.rowid = p.rowid
             WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lng <= ? AND r.max_lng >= ?`
          : `SELECT ${cols} FROM ${table} p
             WHERE p.min_lat <= ? AND p.max_lat >= ? AND p.min_lng <= ? AND p.max_lng >= ?`
        ).all(pin.lat + dLat, pin.lat - dLat, pin.lng + dLng, pin.lng - dLng) as any[];
        for (const row of rows) {
          const el = this.toOverpassElement(row, 'way');
          if (el.type !== 'node') out.push(el);
        }
      }
      return out;
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching areas containing the pin:`, error);
      return null;
    }
  }

  /**
   * BR-POI-010: the municipality whose seat is the POI's OSM element (`admin-boundaries#findMunicipality`),
   * from the region covering the pin. null outside every region, and for a region whose import found no
   * country (or predates BR-POI-010).
   */
  public municipalityAt(pin: { lat: number; lng: number } | undefined, element: PoiOsmElement): Municipality | null {
    const region = pin ? regionAt(this.regions, pin.lat, pin.lng) : null;
    if (!pin || !region || !this.use(region)) return null;
    try {
      return findMunicipality(this.db!, pin, element);
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error reading municipal borders:`, error);
      return null;
    }
  }

  /**
   * Busca um elemento OSM específico por tipo e ID no banco local.
   *
   * No OSM o id só é único DENTRO do tipo: node 123 e way 123 são elementos diferentes.
   * Toda busca aqui casa tipo E id — sem tipo, a busca devolvia outro elemento e o boundary
   * nascia no lugar errado (auditoria de TP, 2026-09-27). Estratégias:
   *   1. Colunas osm_id + osm_type na tabela pois (pbf2json)
   *   2. "@id" + "@type" dentro de tags_json em pois, streets e buildings (osmium)
   * Retorna null se não encontrado (= fallback para Overpass online, que também é tipado).
   */
  public fetchElementById(
    osmType: string,
    osmId: string
  ): { elements: any[] } | null {
    // No coordinate here: the first region holding the id answers (neighbouring extracts share
    // their border buffer, and either copy of an element is the same element).
    for (const region of this.regions) {
      if (!this.use(region)) continue;
      const found = this.elementByIdInSelected(osmType, osmId);
      if (found) return found;
    }
    console.log(`⚠️ [LocalOSMFetcher] Element ${osmType}(${osmId}) NOT found in local database.`);
    return null;
  }

  private elementByIdInSelected(osmType: string, osmId: string): { elements: any[] } | null {
    if (!this.db) return null;

    try {
      let row: any = null;

      const poiByColStmt = this.db.prepare(`
        SELECT id, osm_id, osm_type, geometry_json, tags_json FROM pois
        WHERE osm_id = ? AND osm_type = ? LIMIT 1
      `);
      row = poiByColStmt.get(osmId, osmType) as any;
      if (row) {
        console.log(`🚀 [LocalOSMFetcher] Found element ${osmType}(${osmId}) by ID column in 'pois'`);
      }

      // O índice de expressão em json_extract(tags_json, '$."@id"') resolve o id; o
      // "@type" filtra as poucas linhas que sobram. CAST para INTEGER casa o tipo do índice.
      const osmIdInt = parseInt(osmId, 10);
      const isNumericId = Number.isFinite(osmIdInt) && String(osmIdInt) === String(osmId).trim();

      if (!row && isNumericId) {
        for (const table of ['pois', 'streets', 'buildings'] as const) {
          const columns = table === 'pois' ? 'id, osm_id, osm_type, geometry_json, tags_json' : 'id, geometry_json, tags_json';
          row = this.db.prepare(`
            SELECT ${columns} FROM ${table}
            WHERE json_extract(tags_json, '$."@id"') = ?
              AND json_extract(tags_json, '$."@type"') = ?
            LIMIT 1
          `).get(osmIdInt, osmType) as any;
          if (row) break;
        }
      }

      if (!row) return null;

      const element = this.toOverpassElement(row, osmType);
      console.log(`🚀 [LocalOSMFetcher] Found ${osmType}(${osmId}) in local DB`);
      return { elements: [element] };
    } catch (error) {
      console.error(`❌ [LocalOSMFetcher] Error fetching element by ID:`, error);
      return null;
    }
  }
}
