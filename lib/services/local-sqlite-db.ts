/**
 * Local SQLite Database Manager
 * 
 * Server-side only database operations
 * 
 * @module lib/services/local-sqlite-db
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { SimpleOSMPOI } from '../types/osm-types'

export class LocalSQLiteDB {
  private db: Database.Database | null = null
  private dbPath: string

  // Public getter for database access
  get database(): Database.Database | null {
    return this.db
  }

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

    // Create excluded_features table for blacklist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS excluded_features (
        id TEXT PRIMARY KEY,
        feature_id TEXT NOT NULL,
        name TEXT,
        reason TEXT DEFAULT 'user_deleted',
        excluded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        excluded_by TEXT DEFAULT 'user',
        source_file TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create indexes and constraints
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_geojson_features_name ON geojson_features(name);
      CREATE INDEX IF NOT EXISTS idx_geojson_features_city ON geojson_features(city);
      CREATE INDEX IF NOT EXISTS idx_geojson_features_category ON geojson_features(primary_category);
      CREATE INDEX IF NOT EXISTS idx_geojson_coordinates_lat_lng ON geojson_coordinates(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_geojson_coordinates_feature_id ON geojson_coordinates(feature_id);
      
      -- Unique constraints to prevent duplicates
      CREATE UNIQUE INDEX IF NOT EXISTS idx_geojson_features_osm_unique 
      ON geojson_features(osm_type, osm_id) 
      WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;
    `)
  }

  /**
   * Clear all data from database
   */
  async clearAllData(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    console.log('🧹 [SQLite] Clearing all data...')
    
    // Clear coordinates first (due to foreign key constraint)
    this.db.exec('DELETE FROM geojson_coordinates')
    
    // Clear features
    this.db.exec('DELETE FROM geojson_features')
    
    // Reset auto-increment counters (only if sqlite_sequence exists)
    try {
      this.db.exec('DELETE FROM sqlite_sequence WHERE name IN ("geojson_features", "geojson_coordinates")')
    } catch (error) {
      // sqlite_sequence table doesn't exist, which is fine
      console.log('ℹ️ [SQLite] sqlite_sequence table not found (normal for non-AUTOINCREMENT tables)')
    }
    
    console.log('✅ [SQLite] All data cleared successfully')
  }

  /**
   * Move selected features to excluded_features (blacklist)
   */
  async deleteSelectedFeatures(featureIds: string[]): Promise<{ deleted: number, errors: string[] }> {
    if (!this.db) throw new Error('Database not initialized')
    if (!featureIds || featureIds.length === 0) {
      return { deleted: 0, errors: [] }
    }

    console.log('🗑️ [SQLite] Moving selected features to blacklist:', { count: featureIds.length, featureIds: featureIds.slice(0, 5) })
    
    const errors: string[] = []
    let movedCount = 0

    try {
      // Use transaction for better performance and consistency
      this.db.exec('BEGIN TRANSACTION')
      
      // Get feature data before moving
      const featuresPlaceholders = featureIds.map(() => '?').join(',')
      const getFeaturesStmt = this.db.prepare(`
        SELECT id, name, city, state, country, primary_category, osm_id, osm_type, source_file
        FROM geojson_features 
        WHERE id IN (${featuresPlaceholders})
      `)
      const features = getFeaturesStmt.all(...featureIds) as any[]
      
      console.log(`🔍 [SQLite] Found ${features.length} features to delete (requested ${featureIds.length})`)
      
      if (features.length === 0) {
        console.warn('⚠️ [SQLite] No features found with provided IDs. Checking if IDs exist in database...')
        // Check if any features exist at all
        const allFeaturesStmt = this.db.prepare(`SELECT COUNT(*) as count FROM geojson_features`)
        const totalCount = allFeaturesStmt.get() as { count: number }
        console.log(`📊 [SQLite] Total features in database: ${totalCount.count}`)
        
        // Check a few sample IDs to see what format they have
        if (featureIds.length > 0) {
          const sampleId = featureIds[0]
          const sampleStmt = this.db.prepare(`SELECT id, typeof(id) as id_type FROM geojson_features LIMIT 1`)
          const sample = sampleStmt.get() as any
          console.log(`🔍 [SQLite] Sample feature ID format: ${sample?.id} (type: ${sample?.id_type})`)
          console.log(`🔍 [SQLite] Requested ID format: ${sampleId} (type: ${typeof sampleId})`)
        }
      }
      
      // Move features to excluded_features table
      const insertExcludedStmt = this.db.prepare(`
        INSERT INTO excluded_features (
          id, feature_id, name, reason, excluded_by, source_file, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      
      for (const feature of features) {
        try {
          const excludedId = `excluded-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const metadata = JSON.stringify({
            city: feature.city,
            state: feature.state,
            country: feature.country,
            primary_category: feature.primary_category,
            osm_id: feature.osm_id,
            osm_type: feature.osm_type,
            original_id: feature.id
          })
          
          insertExcludedStmt.run(
            excludedId,
            feature.id,
            feature.name || 'Unnamed',
            'user_deleted',
            'user',
            feature.source_file || 'unknown',
            metadata
          )
          console.log(`✅ [SQLite] Added feature to blacklist: ${feature.name || feature.id}`)
        } catch (err) {
          console.error(`❌ [SQLite] Error adding feature ${feature.id} to blacklist:`, err)
          errors.push(`Failed to add feature ${feature.id} to blacklist: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      }
      
      if (features.length > 0) {
        // Use the actual feature IDs found (not the requested ones)
        const foundFeatureIds = features.map(f => f.id)
        const foundPlaceholders = foundFeatureIds.map(() => '?').join(',')
        
        // Delete coordinates first (due to foreign key constraint)
        const deleteCoordinatesStmt = this.db.prepare(`
          DELETE FROM geojson_coordinates 
          WHERE feature_id IN (${foundPlaceholders})
        `)
        const coordResult = deleteCoordinatesStmt.run(...foundFeatureIds)
        console.log(`🗑️ [SQLite] Deleted ${coordResult.changes || 0} coordinate records`)
        
        // Delete features from main table
        const deleteFeaturesStmt = this.db.prepare(`
          DELETE FROM geojson_features 
          WHERE id IN (${foundPlaceholders})
        `)
        const result = deleteFeaturesStmt.run(...foundFeatureIds)
        
        movedCount = result.changes || 0
        console.log(`🗑️ [SQLite] Deleted ${movedCount} features from main table`)
      } else {
        console.warn('⚠️ [SQLite] No features found to delete. IDs may not match.')
        errors.push(`No features found with the provided IDs. Check if IDs match the database format.`)
      }
      
      this.db.exec('COMMIT')
      
      console.log('✅ [SQLite] Selected features moved to blacklist successfully:', { moved: movedCount })
      
    } catch (error) {
      this.db.exec('ROLLBACK')
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      errors.push(`Failed to move features to blacklist: ${errorMsg}`)
      console.error('❌ [SQLite] Error moving selected features to blacklist:', error)
    }

    return { deleted: movedCount, errors }
  }

  /**
   * Check if a feature is in the blacklist (excluded_features)
   */
  async isFeatureExcluded(featureId: string): Promise<boolean> {
    if (!this.db) return false
    
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM excluded_features WHERE feature_id = ?
    `)
    const result = stmt.get(featureId) as { count: number }
    
    return result.count > 0
  }

  /**
   * Get all excluded features (for management)
   */
  async getExcludedFeatures(): Promise<any[]> {
    if (!this.db) return []
    
    const stmt = this.db.prepare(`
      SELECT * FROM excluded_features 
      ORDER BY excluded_at DESC
    `)
    
    return stmt.all()
  }

  /**
   * Restore a feature from blacklist
   */
  async restoreExcludedFeature(excludedId: string): Promise<{ success: boolean, error?: string }> {
    if (!this.db) return { success: false, error: 'Database not initialized' }
    
    try {
      this.db.exec('BEGIN TRANSACTION')
      
      // Get excluded feature data
      const getExcludedStmt = this.db.prepare(`
        SELECT * FROM excluded_features WHERE id = ?
      `)
      const excludedFeature = getExcludedStmt.get(excludedId)
      
      if (!excludedFeature) {
        this.db.exec('ROLLBACK')
        return { success: false, error: 'Excluded feature not found' }
      }
      
      // Parse metadata
      const metadata = JSON.parse((excludedFeature as any).metadata || '{}')
      
      // Restore to geojson_features (simplified - would need full feature data)
      // This is a placeholder - in practice, you'd need the full feature data
      console.log('🔄 [SQLite] Restoring excluded feature:', (excludedFeature as any).feature_id)
      
      // Remove from excluded_features
      const deleteExcludedStmt = this.db.prepare(`
        DELETE FROM excluded_features WHERE id = ?
      `)
      deleteExcludedStmt.run(excludedId)
      
      this.db.exec('COMMIT')
      
      return { success: true }
      
    } catch (error) {
      this.db.exec('ROLLBACK')
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Save POI to local database
   */
  async savePOI(poi: SimpleOSMPOI, sourceFile: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const featureId = poi._id
    
    // Check if feature is in blacklist
    const isExcluded = await this.isFeatureExcluded(featureId)
    if (isExcluded) {
      console.log('🚫 [SQLite] Skipping excluded feature:', featureId)
      return
    }
    
    const geometry = poi.geometry

    // Extract coordinates
    let latitude = 0
    let longitude = 0
    let elevation = null

    if (geometry?.type === 'Point' && geometry.coordinates) {
      longitude = geometry.coordinates[0]
      latitude = geometry.coordinates[1]
      elevation = (geometry.coordinates as number[]).length > 2 ? (geometry.coordinates as number[])[2] : null
    } else if (geometry?.type === 'LineString' && geometry.coordinates) {
      // Calculate centroid for LineString
      const coords = geometry.coordinates as any
      let sumLng = 0, sumLat = 0
      for (const coord of coords) {
        sumLng += coord[0]
        sumLat += coord[1]
      }
      longitude = sumLng / coords.length
      latitude = sumLat / coords.length
    } else if (geometry?.type === 'MultiPolygon' && geometry.coordinates) {
      // Calculate centroid for MultiPolygon (use first polygon)
      const firstPolygon = (geometry.coordinates as any)[0][0] // First polygon, first ring
      let sumLng = 0, sumLat = 0
      for (const coord of firstPolygon) {
        sumLng += coord[0]
        sumLat += coord[1]
      }
      longitude = sumLng / firstPolygon.length
      latitude = sumLat / firstPolygon.length
    } else if (geometry?.type === 'Polygon' && geometry.coordinates) {
      // Calculate centroid for Polygon
      const firstRing = (geometry.coordinates as any)[0] // First ring (exterior)
      let sumLng = 0, sumLat = 0
      for (const coord of firstRing) {
        sumLng += coord[0]
        sumLat += coord[1]
      }
      longitude = sumLng / firstRing.length
      latitude = sumLat / firstRing.length
    }

    // Extract properties
    const props = poi.properties
    const categories = this.extractCategories(props)
    const tourismFlags = this.extractTourismFlags(props)
    
    // Use the already extracted location data from OSMService
    const location = {
      city: props.city || null,
      state: props.state || null,
      country: props.country || null,
      neighborhood: null,
      street_name: null,
      house_number: null,
      postal_code: null,
      formatted_address: null
    }
    
    // Debug: Log extracted data
    // console.log('🔍 [SQLite] Extracted data for POI:', {
    //   name: props.name || 'Unnamed POI',
    //   categories,
    //   location,
    //   hasOsmId: !!props.osm_id,
    //   hasOsmType: !!props.osm_type
    // })

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
        local_traditions, seasonal_attractions, source_file,
        is_historic, is_touristic, has_train, has_ferry, has_bus,
        has_wheelchair_access, has_water, has_fishing, has_playground,
        is_building, has_ruins,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?,?,?,?,?,?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      sourceFile,
      tourismFlags.is_historic,
      tourismFlags.is_touristic,
      tourismFlags.has_train,
      tourismFlags.has_ferry,
      tourismFlags.has_bus,
      tourismFlags.has_wheelchair_access,
      tourismFlags.has_water,
      tourismFlags.has_fishing,
      tourismFlags.has_playground,
      tourismFlags.is_building,
      tourismFlags.has_ruins,
      new Date().toISOString(), // created_at
      new Date().toISOString()  // updated_at
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
   * Extract tourism flags from properties
   */
  private extractTourismFlags(props: Record<string, any>) {
    return {
      is_historic: props.historic === 'yes' ? 1 : 0,
      is_touristic: props.tourism === 'yes' ? 1 : 0,
      has_train: props.train === 'yes' ? 1 : 0,
      has_ferry: props.ferry === 'yes' ? 1 : 0,
      has_bus: props.bus === 'yes' ? 1 : 0,
      has_wheelchair_access: props.wheelchair === 'yes' ? 1 : 0,
      has_water: props.water === 'yes' ? 1 : 0,
      has_fishing: props.fishing === 'yes' ? 1 : 0,
      has_playground: props.playground === 'yes' ? 1 : 0,
      is_building: props.building === 'yes' ? 1 : 0,
      has_ruins: props.ruins === 'yes' ? 1 : 0
    }
  }

  /**
   * Extract categories from properties
   */
  private extractCategories(props: Record<string, any>) {
    // Check if category is already processed (from OSMService.getPrimaryCategory)
    if (props.category && typeof props.category === 'string' && props.category.includes('=')) {
      const [primaryType, primaryValue] = props.category.split('=')
      return {
        primary: primaryValue, // Just the category value (e.g., "park")
        primaryType: primaryType, // The type (e.g., "leisure")
        all: [props.category]
      }
    }

    // Original logic for raw OSM data
    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'railway', 'public_transport', 'shop', 'highway', 'building']
    let primary = null
    let primaryType = null

    // First pass: look for specific categories (not *=yes)
    for (const tag of priorityTags) {
      if (props[tag] && props[tag] !== 'yes') {
        primary = props[tag] // Just the value (e.g., "park")
        primaryType = tag // The type (e.g., "leisure")
        break
      }
    }

    // Second pass: if no specific category found, use *=yes as fallback
    if (!primary) {
      for (const tag of priorityTags) {
        if (props[tag] === 'yes') {
          primary = props[tag] // "yes"
          primaryType = tag // The type (e.g., "building")
          break
        }
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
    // Try to extract from OSM tags first
    let city = props['addr:city'] || props['is_in:city'] || props['addr:suburb'] || null
    let state = props['addr:state'] || props['is_in:state'] || props['addr:province'] || null
    let country = props['addr:country'] || props['is_in:country'] || null
    
    // If no location data found in OSM tags, try alternative fields
    if (!city) {
      city = props.city || props.place || null
    }
    if (!state) {
      state = props.state || props.region || null
    }
    if (!country) {
      country = props.country || null
    }
    
    // If still no data, we'll need to use reverse geocoding later
    // For now, return what we have
    return {
      city,
      state,
      country,
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
