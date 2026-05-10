import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

/**
 * Service to manage and query local OSM data (extracted from PBF/GeoJSON)
 */
export class OSMLocalDataService {
  private db: Database.Database;
  private static instance: OSMLocalDataService;

  private constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'local_osm.db');
    this.db = new Database(dbPath);
    this.init();
  }

  public static getInstance(): OSMLocalDataService {
    if (!OSMLocalDataService.instance) {
      OSMLocalDataService.instance = new OSMLocalDataService();
    }
    return OSMLocalDataService.instance;
  }

  private init() {
    // Table for streets
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streets (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        geometry_json TEXT,
        min_lat REAL,
        max_lat REAL,
        min_lng REAL,
        max_lng REAL,
        tags_json TEXT
      )
    `);

    // Table for buildings
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS buildings (
        id TEXT PRIMARY KEY,
        geometry_json TEXT,
        height REAL,
        min_lat REAL,
        max_lat REAL,
        min_lng REAL,
        max_lng REAL,
        tags_json TEXT
      )
    `);

    // Table for POIs and generic boundaries (amenities, leisure, water, etc)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pois (
        id TEXT PRIMARY KEY,
        osm_type TEXT,
        osm_id TEXT,
        geometry_json TEXT,
        min_lat REAL,
        max_lat REAL,
        min_lng REAL,
        max_lng REAL,
        tags_json TEXT
      )
    `);

    // Spatial indexes (bounding box)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_streets_bbox ON streets(min_lat, max_lat, min_lng, max_lng)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_buildings_bbox ON buildings(min_lat, max_lat, min_lng, max_lng)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pois_bbox ON pois(min_lat, max_lat, min_lng, max_lng)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pois_osm ON pois(osm_type, osm_id)`);
  }

  /**
   * Imports a GeoJSON Sequence file (line-delimited JSON) into the local database
   */
  public async importGeoJSONSeq(filePath: string): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    const insertStreet = this.db.prepare(`
      INSERT OR REPLACE INTO streets (id, name, type, geometry_json, min_lat, max_lat, min_lng, max_lng, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBuilding = this.db.prepare(`
      INSERT OR REPLACE INTO buildings (id, geometry_json, height, min_lat, max_lat, min_lng, max_lng, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPOI = this.db.prepare(`
      INSERT OR REPLACE INTO pois (id, osm_type, osm_id, geometry_json, min_lat, max_lat, min_lng, max_lng, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    this.db.exec('BEGIN TRANSACTION');

    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        
        let cleanLine = line.trim();
        if (cleanLine.startsWith('\x1e')) cleanLine = cleanLine.substring(1);
        
        const feature = JSON.parse(cleanLine);
        
        // Extract OSM type and ID if present from osmium export
        const featureId = feature.id || feature['@id'];
        let osmType = feature['@type'] || 'unknown';
        let osmId = String(featureId || feature.properties?.id || Math.random().toString(36).substr(2, 9));
        
        // In some geojsonseq, the ID might be formatted as "way/12345"
        if (typeof featureId === 'string' && featureId.includes('/')) {
          const parts = featureId.split('/');
          osmType = parts[0];
          osmId = parts[1];
        }

        const tags = feature.properties || {};
        const geometry = feature.geometry;

        if (!geometry || !geometry.coordinates) continue;

        // Calculate BBox
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        const flatCoords: any[] = [];
        
        const processCoords = (coords: any) => {
          if (Array.isArray(coords[0])) {
            coords.forEach(processCoords);
          } else {
            const [lng, lat] = coords;
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            flatCoords.push({ lat, lng });
          }
        };
        processCoords(geometry.coordinates);
        
        const stringifiedTags = JSON.stringify(tags);
        const stringifiedCoords = JSON.stringify(flatCoords);

        let insertedAsMain = false;

        if (tags.highway) {
          insertStreet.run(
            `osm_way_${osmId}`,
            tags.name || tags.ref || 'Unnamed Street',
            tags.highway,
            stringifiedCoords,
            minLat, maxLat, minLng, maxLng,
            stringifiedTags
          );
          insertedAsMain = true;
        } 
        
        if (tags.building || tags.natural === 'wood' || tags.landuse === 'forest') {
          let height = 6; // Default
          if (tags.height) height = parseFloat(tags.height);
          else if (tags['building:levels']) height = parseInt(tags['building:levels']) * 3.5;

          insertBuilding.run(
            `osm_building_${osmId}`,
            stringifiedCoords,
            height,
            minLat, maxLat, minLng, maxLng,
            stringifiedTags
          );
          insertedAsMain = true;
        }
        
        // Anything that has POI-related tags goes to POI table
        const isPOI = tags.amenity || tags.leisure || tags.tourism || tags.historic || 
                      tags.natural || tags.water || tags.waterway || tags.shop ||
                      tags.aeroway || tags.railway || tags.man_made || tags.place || tags.landuse;
                      
        if (isPOI || !insertedAsMain) {
          insertPOI.run(
            `osm_poi_${osmType}_${osmId}`,
            osmType,
            osmId,
            stringifiedCoords,
            minLat, maxLat, minLng, maxLng,
            stringifiedTags
          );
        }

        count++;
        if (count % 10000 === 0) {
          console.log(`   Imported ${count.toLocaleString()} features...`);
        }
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * Finds streets "around" a point within a radius (approximate using BBox)
   */
  public findStreetsAround(lat: number, lng: number, radiusMeters: number): any[] {
    const offset = radiusMeters / 111320; // Approx conversion
    const stmt = this.db.prepare(`
      SELECT * FROM streets 
      WHERE max_lat >= ? AND min_lat <= ? 
        AND max_lng >= ? AND min_lng <= ?
    `);
    
    return stmt.all(lat - offset, lat + offset, lng - offset, lng + offset);
  }

  /**
   * Finds buildings "around" a point within a radius
   */
  public findBuildingsAround(lat: number, lng: number, radiusMeters: number): any[] {
    const offset = radiusMeters / 111320;
    const stmt = this.db.prepare(`
      SELECT * FROM buildings 
      WHERE max_lat >= ? AND min_lat <= ? 
        AND max_lng >= ? AND min_lng <= ?
    `);
    
    return stmt.all(lat - offset, lat + offset, lng - offset, lng + offset);
  }

  public hasData(): boolean {
    const row = this.db.prepare('SELECT count(*) as count FROM streets').get() as { count: number };
    return row.count > 0;
  }

  public clearAll(): void {
    this.db.exec(`DELETE FROM streets`);
    this.db.exec(`DELETE FROM buildings`);
    this.db.exec(`DELETE FROM pois`);
  }
  
  /**
   * Look up a boundary exactly by its OSM ID and OSM Type.
   * Checks the pois table first, then buildings, then streets.
   */
  public getBoundaryByID(osmType: string, osmId: string): any {
    try {
      // 1. Check POIs table (most likely for attractions)
      const stmtPoi = this.db.prepare(`
        SELECT osm_type, osm_id, geometry_json, tags_json
        FROM pois
        WHERE osm_type = ? AND osm_id = ?
      `);
      const poiResult = stmtPoi.get(osmType, osmId) as any;
      if (poiResult) {
        return {
          id: poiResult.osm_id,
          type: poiResult.osm_type,
          geometry: JSON.parse(poiResult.geometry_json),
          tags: JSON.parse(poiResult.tags_json)
        };
      }
      
      // 2. Check buildings table (ID was prefixed with osm_building_)
      const stmtBuilding = this.db.prepare(`
        SELECT id, geometry_json, tags_json
        FROM buildings
        WHERE id = ? OR id = ?
      `);
      const buildingResult = stmtBuilding.get(`osm_building_${osmId}`, `osm_building_${osmType}/${osmId}`) as any;
      if (buildingResult) {
        return {
          id: osmId,
          type: osmType,
          geometry: JSON.parse(buildingResult.geometry_json),
          tags: JSON.parse(buildingResult.tags_json)
        };
      }
      
      // 3. Check streets table
      const stmtStreet = this.db.prepare(`
        SELECT id, geometry_json, tags_json
        FROM streets
        WHERE id = ? OR id = ?
      `);
      const streetResult = stmtStreet.get(`osm_way_${osmId}`, `osm_way_${osmType}/${osmId}`) as any;
      if (streetResult) {
        return {
          id: osmId,
          type: osmType,
          geometry: JSON.parse(streetResult.geometry_json),
          tags: JSON.parse(streetResult.tags_json)
        };
      }
      
      return null;
    } catch (e) {
      console.warn(`[OSMLocalDataService] Failed to lookup boundary ${osmType}/${osmId}:`, e);
      return null;
    }
  }
}
