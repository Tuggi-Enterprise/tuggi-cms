/**
 * Local SQLite Database Manager
 * 
 * Server-side only database operations
 * 
 * @module lib/services/local-sqlite-db
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { SimpleOSMPOI } from '../hooks/use-osm-importer-simple'

export class LocalSQLiteDB {
  private db: Database.Database | null = null
  private dbPath: string

  constructor() {
    this.dbPath = join(process.cwd(), 'data', 'geojson.db')
  }

  /**
   * Initialize database and create tables
   */
  async initialize(): Promise<void> {
    if (this.db) return

    try {
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      
      // Create tables
      await this.createTables()
      console.log('✅ [SQLite] Database initialized:', this.dbPath)
    } catch (error) {
      console.error('❌ [SQLite] Database initialization failed:', error)
      throw error
    }
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Create geojson_features table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geojson_features (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        city TEXT,
        state TEXT,
        country TEXT,
        neighborhood TEXT,
        street_name TEXT,
        house_number TEXT,
        postal_code TEXT,
        formatted_address TEXT,
        primary_category TEXT,
        primary_category_type TEXT,
        categories TEXT,
        osm_tags TEXT,
        osm_id TEXT,
        osm_type TEXT,
        website TEXT,
        contact_phone TEXT,
        contact_email TEXT,
        operator_name TEXT,
        wheelchair_accessible TEXT,
        wheelchair_toilets TEXT,
        accessibility_notes TEXT,
        height REAL,
        building_material TEXT,
        building_colour TEXT,
        roof_colour TEXT,
        architectural_style TEXT,
        historic_period TEXT,
        landmark_type TEXT,
        architect TEXT,
        construction_status TEXT,
        start_date TEXT,
        heritage_status TEXT,
        unesco_status TEXT,
        unesco_inscription_date TEXT,
        unesco_reference TEXT,
        landmark_level INTEGER,
        importance_level TEXT,
        museum_type TEXT,
        museum_collection TEXT,
        museum_audience TEXT,
        museum_education TEXT,
        leisure_type TEXT,
        natural_type TEXT,
        natural_water TEXT,
        sport_facilities TEXT,
        leisure_playground TEXT,
        monument_type TEXT,
        monument_event TEXT,
        monument_person TEXT,
        parking_capacity TEXT,
        public_transport TEXT,
        access_points TEXT,
        entrance_fee TEXT,
        urban_density TEXT,
        noise_level TEXT,
        air_quality TEXT,
        shade_availability TEXT,
        cultural_significance TEXT,
        local_traditions TEXT,
        seasonal_attractions TEXT,
        source_file TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create geojson_coordinates table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geojson_coordinates (
        id TEXT PRIMARY KEY,
        feature_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        elevation_m INTEGER,
        distance_from_sao_paulo_km REAL,
        distance_from_rio_km REAL,
        boundary_geometry TEXT,
        boundary_type TEXT,
        boundary_source TEXT,
        boundary_confidence REAL,
        boundary_area_m2 REAL,
        boundary_centroid_lat REAL,
        boundary_centroid_lng REAL,
        show_in_map BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (feature_id) REFERENCES geojson_features(id) ON DELETE CASCADE
      )
    `)

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_geojson_features_name ON geojson_features(name);
      CREATE INDEX IF NOT EXISTS idx_geojson_features_city ON geojson_features(city);
      CREATE INDEX IF NOT EXISTS idx_geojson_features_category ON geojson_features(primary_category);
      CREATE INDEX IF NOT EXISTS idx_geojson_coordinates_lat_lng ON geojson_coordinates(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_geojson_coordinates_feature_id ON geojson_coordinates(feature_id);
    `)
  }

  /**
   * Save POI to local database
   */
  async savePOI(poi: SimpleOSMPOI, sourceFile: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const featureId = poi._id
    const geometry = poi.geometry

    // Extract coordinates
    let latitude = 0
    let longitude = 0
    let elevation = null

    if (geometry?.type === 'Point' && geometry.coordinates) {
      longitude = geometry.coordinates[0]
      latitude = geometry.coordinates[1]
      elevation = (geometry.coordinates as number[]).length > 2 ? (geometry.coordinates as number[])[2] : null
    }

    // Extract properties
    const props = poi.properties
    const categories = this.extractCategories(props)
    const location = this.extractLocationData(props)

    // Insert feature
    const insertFeature = this.db.prepare(`
      INSERT OR REPLACE INTO geojson_features (
        id, name, description, city, state, country, neighborhood,
        street_name, house_number, postal_code, formatted_address,
        primary_category, primary_category_type, categories, osm_tags,
        osm_id, osm_type, website, contact_phone, contact_email,
        operator_name, wheelchair_accessible, wheelchair_toilets,
        accessibility_notes, height, building_material, building_colour,
        roof_colour, architectural_style, historic_period, landmark_type,
        architect, construction_status, start_date, heritage_status,
        unesco_status, unesco_inscription_date, unesco_reference,
        landmark_level, importance_level, museum_type, museum_collection,
        museum_audience, museum_education, leisure_type, natural_type,
        natural_water, sport_facilities, leisure_playground, monument_type,
        monument_event, monument_person, parking_capacity, public_transport,
        access_points, entrance_fee, urban_density, noise_level,
        air_quality, shade_availability, cultural_significance,
        local_traditions, seasonal_attractions, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    insertFeature.run(
      featureId,
      props.name || 'Unnamed POI',
      props.description || null,
      location.city,
      location.state,
      location.country,
      location.neighborhood,
      location.street_name,
      location.house_number,
      location.postal_code,
      location.formatted_address,
      categories.primary,
      categories.primaryType,
      JSON.stringify(categories.all),
      JSON.stringify(props),
      props.osm_id || null,
      props.osm_type || null,
      props.website || null,
      props.contact_phone || null,
      props.contact_email || null,
      props.operator_name || null,
      props.wheelchair_accessible || null,
      props.wheelchair_toilets || null,
      props.accessibility_notes || null,
      props.height || null,
      props.building_material || null,
      props.building_colour || null,
      props.roof_colour || null,
      props.architectural_style || null,
      props.historic_period || null,
      props.landmark_type || null,
      props.architect || null,
      props.construction_status || null,
      props.start_date || null,
      props.heritage_status || null,
      props.unesco_status || null,
      props.unesco_inscription_date || null,
      props.unesco_reference || null,
      props.landmark_level || null,
      props.importance_level || null,
      props.museum_type || null,
      props.museum_collection || null,
      props.museum_audience || null,
      props.museum_education || null,
      props.leisure_type || null,
      props.natural_type || null,
      props.natural_water || null,
      props.sport_facilities || null,
      props.leisure_playground || null,
      props.monument_type || null,
      props.monument_event || null,
      props.monument_person || null,
      props.parking_capacity || null,
      props.public_transport || null,
      props.access_points || null,
      props.entrance_fee || null,
      props.urban_density || null,
      props.noise_level || null,
      props.air_quality || null,
      props.shade_availability || null,
      props.cultural_significance || null,
      props.local_traditions || null,
      props.seasonal_attractions || null,
      sourceFile
    )

    // Insert coordinates
    const insertCoords = this.db.prepare(`
      INSERT OR REPLACE INTO geojson_coordinates (
        id, feature_id, latitude, longitude, elevation_m,
        distance_from_sao_paulo_km, distance_from_rio_km,
        boundary_geometry, boundary_type, boundary_source,
        boundary_confidence, boundary_area_m2, boundary_centroid_lat,
        boundary_centroid_lng
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const coordId = `${featureId}-coord`
    const distances = this.calculateDistances(latitude, longitude)

    insertCoords.run(
      coordId,
      featureId,
      latitude,
      longitude,
      elevation,
      distances.saoPaulo,
      distances.rio,
      null, // boundary_geometry
      null, // boundary_type
      null, // boundary_source
      null, // boundary_confidence
      null, // boundary_area_m2
      null, // boundary_centroid_lat
      null  // boundary_centroid_lng
    )
  }

  /**
   * Extract categories from properties
   */
  private extractCategories(props: Record<string, any>) {
    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'shop', 'highway', 'building']
    let primary = null
    let primaryType = null

    for (const tag of priorityTags) {
      if (props[tag]) {
        primary = `${tag}=${props[tag]}`
        primaryType = tag
        break
      }
    }

    const all = Object.entries(props)
      .filter(([key, value]) => priorityTags.includes(key) && value)
      .map(([key, value]) => `${key}=${value}`)

    return { primary, primaryType, all }
  }

  /**
   * Extract location data from properties
   */
  private extractLocationData(props: Record<string, any>) {
    return {
      city: props['addr:city'] || props['is_in:city'] || props['addr:suburb'] || null,
      state: props['addr:state'] || props['is_in:state'] || props['addr:province'] || null,
      country: props['addr:country'] || props['is_in:country'] || null,
      neighborhood: props['addr:neighbourhood'] || props['addr:suburb'] || null,
      street_name: props['addr:street'] || null,
      house_number: props['addr:housenumber'] || null,
      postal_code: props['addr:postcode'] || null,
      formatted_address: props['addr:full'] || null
    }
  }

  /**
   * Calculate distances from São Paulo and Rio
   */
  private calculateDistances(lat: number, lng: number): { saoPaulo: number, rio: number } {
    const saoPaulo = { lat: -23.5505, lng: -46.6333 }
    const rio = { lat: -22.9068, lng: -43.1729 }

    return {
      saoPaulo: this.haversineDistance(lat, lng, saoPaulo.lat, saoPaulo.lng),
      rio: this.haversineDistance(lat, lng, rio.lat, rio.lng)
    }
  }

  /**
   * Haversine distance calculation
   */
  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371 // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return Math.round(R * c * 10) / 10
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{ features: number, coordinates: number }> {
    if (!this.db) throw new Error('Database not initialized')

    const features = this.db.prepare('SELECT COUNT(*) as count FROM geojson_features').get() as { count: number }
    const coordinates = this.db.prepare('SELECT COUNT(*) as count FROM geojson_coordinates').get() as { count: number }

    return {
      features: features.count,
      coordinates: coordinates.count
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
