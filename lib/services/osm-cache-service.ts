import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * Service to manage local persistent cache for OSM/Overpass queries
 */
export class OSMCacheService {
  private db: Database.Database;
  private static instance: OSMCacheService;

  private constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'osm_cache.db');
    this.db = new Database(dbPath);
    this.init();
  }

  public static getInstance(): OSMCacheService {
    if (!OSMCacheService.instance) {
      OSMCacheService.instance = new OSMCacheService();
    }
    return OSMCacheService.instance;
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS overpass_cache (
        query_hash TEXT PRIMARY KEY,
        query_text TEXT,
        response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_created_at ON overpass_cache(created_at)`);
  }

  /**
   * Generates a hash for the query to use as key
   */
  private hashQuery(query: string): string {
    return crypto.createHash('sha256').update(query.trim()).digest('hex');
  }

  /**
   * Retrieves a cached response
   */
  public get(query: string, maxAgeDays: number = 5): any | null {
    const hash = this.hashQuery(query);
    const stmt = this.db.prepare(`
      SELECT response, created_at FROM overpass_cache 
      WHERE query_hash = ? AND created_at >= datetime('now', '-' || ? || ' days')
    `);
    
    const row = stmt.get(hash, maxAgeDays) as { response: string, created_at: string } | undefined;
    
    if (row) {
      try {
        return JSON.parse(row.response);
      } catch (e) {
        console.error('Failed to parse cached OSM response', e);
        return null;
      }
    }
    
    return null;
  }

  /**
   * Saves a response to cache
   */
  public set(query: string, response: any): void {
    const hash = this.hashQuery(query);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO overpass_cache (query_hash, query_text, response, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(hash, query.trim(), JSON.stringify(response));
  }

  /**
   * Cleans up old cache entries
   */
  public cleanup(days: number = 5): number {
    const stmt = this.db.prepare(`
      DELETE FROM overpass_cache WHERE created_at < datetime('now', '-' || ? || ' days')
    `);
    
    const result = stmt.run(days);
    return result.changes;
  }

  /**
   * Clears all cache
   */
  public clearAll(): void {
    this.db.exec(`DELETE FROM overpass_cache`);
  }
}
