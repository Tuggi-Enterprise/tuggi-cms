/**
 * OSM Importer Service
 * 
 * Handles OpenStreetMap data import workflow:
 * - Parse GeoJSON files
 * - Extract location data from OSM tags
 * - Import POIs to database
 * - Duplicate detection and resolution
 * 
 * @module lib/services/osm-importer-service
 */

import { getSupabaseClient } from '@/lib/core/supabase-client'
import { OSMFeature, EditableOSMPOI, ImportBatch, ImportResults, DuplicateMatch } from '@/types/osm-importer'

export class OSMImporterService {
  private supabase = getSupabaseClient()

  /**
   * Parse OSM tags to extract location data
   */
  extractLocationFromOSMTags(properties: Record<string, any> | undefined) {
    if (!properties) {
      return {
        name: null,
        city: null,
        state: null,
        country: null,
        address: null
      }
    }
    
    // Handle both direct properties and nested tags structure
    const tags = properties.tags || properties
    
    const result = {
      name: tags.name || tags['name:en'] || tags['name:pt'] || null,
      city: tags['addr:city'] || tags['is_in:city'] || tags['addr:suburb'] || null,
      state: tags['addr:state'] || tags['is_in:state'] || tags['addr:province'] || null,
      country: tags['addr:country'] || tags['is_in:country'] || null,
      address: tags['addr:full'] || tags['addr:street'] || null
    }
    
    // Debug log for troubleshooting
    if (result.name || result.city || result.state || result.country) {
      console.log('🔍 EXTRACTED LOCATION:', {
        name: result.name,
        city: result.city,
        state: result.state,
        country: result.country,
        rawProperties: Object.keys(tags).slice(0, 10) // First 10 keys for debugging
      })
    }
    
    return result
  }

  /**
   * Get primary OSM category for a feature
   */
  getPrimaryCategory(properties: Record<string, any> | undefined): string | null {
    if (!properties) return null
    
    // Handle both direct properties and nested tags structure
    const tags = properties.tags || properties
    
    const priorityTags = ['tourism', 'amenity', 'historic', 'natural', 'leisure', 'shop', 'highway', 'building']
    for (const tag of priorityTags) {
      if (tags[tag]) return `${tag}=${tags[tag]}`
    }
    return null
  }

  /**
   * Generate unique OSM ID combining type and numeric ID
   */
  generateOSMId(type: 'node' | 'way' | 'relation', numericId: number): string {
    return `${type}-${numericId}`
  }

  /**
   * Check for duplicates in database
   */
  async checkDuplicates(features: EditableOSMPOI[]): Promise<DuplicateMatch[]> {
    const duplicates: DuplicateMatch[] = []

    for (const feature of features) {
      const location = this.extractLocationFromOSMTags(feature.properties)
      const osmId = this.generateOSMId(feature.properties.type, feature.properties.id)

      // Check by OSM ID (most reliable)
      const { data: osmDuplicate } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, country, osm_id')
        .eq('osm_id', osmId)
        .single()

      if (osmDuplicate) {
        duplicates.push({
          poi_id: feature._id,
          existing_poi: {
            id: osmDuplicate.id,
            name: osmDuplicate.name,
            city: osmDuplicate.city,
            country: osmDuplicate.country,
            osm_id: osmDuplicate.osm_id
          },
          match_type: 'osm_id',
          confidence: 1.0
        })
        continue
      }

      // Check by name + city (fuzzy match)
      if (location.name && location.city) {
        const { data: nameDuplicate } = await this.supabase
          .schema('core')
          .from('attractions')
          .select('id, name, city, country')
          .eq('name', location.name)
          .eq('city', location.city)
          .single()

        if (nameDuplicate) {
          duplicates.push({
            poi_id: feature._id,
            existing_poi: {
              id: nameDuplicate.id,
              name: nameDuplicate.name,
              city: nameDuplicate.city,
              country: nameDuplicate.country
            },
            match_type: 'name_city',
            confidence: 0.8
          })
        }
      }
    }

    return duplicates
  }

  /**
   * Import POIs to database (with transaction)
   */
  async importPOIs(
    pois: EditableOSMPOI[], 
    batchId: string,
    duplicateStrategy: 'skip' | 'replace' | 'merge'
  ): Promise<ImportResults> {
    const startTime = Date.now()
    const results: ImportResults = {
      imported: [],
      skipped: [],
      failed: [],
      summary: {
        total: pois.length,
        imported: 0,
        skipped: 0,
        failed: 0,
        processing_time_ms: 0
      }
    }

    for (const poi of pois) {
      try {
        const location = poi._edited 
          ? poi._editedFields 
          : this.extractLocationFromOSMTags(poi.properties)

        const coords = this.extractCoordinates(poi.geometry)

        if (!coords) {
          results.failed.push({ poi: location.name || 'Unknown', error: 'Invalid coordinates' })
          continue
        }

        const osmId = this.generateOSMId(poi.properties.type, poi.properties.id)

        // Check for existing POI
        const { data: existing } = await this.supabase
          .schema('core')
          .from('attractions')
          .select('id')
          .eq('osm_id', osmId)
          .single()

        if (existing) {
          if (duplicateStrategy === 'skip') {
            results.skipped.push(poi._id)
            continue
          }
          if (duplicateStrategy === 'replace') {
            await this.updateAttraction(existing.id, poi, coords, batchId)
          }
          // merge = update only null fields (implement if needed)
        } else {
          await this.insertAttraction(poi, coords, batchId, osmId)
        }

        results.imported.push(poi._id)
      } catch (error) {
        results.failed.push({ 
          poi: poi.properties.name || 'Unknown', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        })
      }
    }

    const processingTime = Date.now() - startTime
    results.summary = {
      total: pois.length,
      imported: results.imported.length,
      skipped: results.skipped.length,
      failed: results.failed.length,
      processing_time_ms: processingTime
    }

    // Update batch statistics
    await this.updateBatchStats(batchId, {
      total_processed: pois.length,
      successful_imports: results.imported.length,
      skipped_duplicates: results.skipped.length,
      failed_count: results.failed.length,
      processing_time_ms: processingTime,
      status: 'completed'
    })

    return results
  }

  /**
   * Insert new attraction into database
   */
  private async insertAttraction(
    poi: EditableOSMPOI, 
    coords: [number, number], 
    batchId: string,
    osmId: string
  ) {
    const location = poi._edited 
      ? poi._editedFields 
      : this.extractLocationFromOSMTags(poi.properties)

        // Insert attraction (NO Google references - pure OSM data)
        const { data: attraction, error: attractionError } = await this.supabase
          .schema('core')
          .from('attractions')
          .insert({
            name: location.name,
            city: location.city,
            state: location.state,
            country: location.country,
            formatted_address: 'address' in location ? location.address : null,
        
        // OSM-specific fields
        osm_id: osmId,
        osm_type: poi.properties.type,
        osm_tags: poi.properties,
        
        // NO Google fields - these remain NULL for OSM imports
        google_place_id: null,
        google_types: null,
        user_ratings_total: null,
        rating: null,
        price_level: null,
        business_status: null,
        
        // Import tracking
        import_batch_id: batchId,
        import_source: 'osm-importer',
        approved: false
      })
      .select('id')
      .single()

    if (attractionError) throw attractionError

    // Insert coordinates
    const { error: coordError } = await this.supabase
      .schema('core')
      .from('attraction_coordinate')
      .insert({
        attraction_id: attraction.id,
        latitude: coords[1],
        longitude: coords[0]
      })

    if (coordError) throw coordError
  }

  /**
   * Update existing attraction
   */
  private async updateAttraction(
    attractionId: string,
    poi: EditableOSMPOI,
    coords: [number, number],
    batchId: string
  ) {
    const location = poi._edited 
      ? poi._editedFields 
      : this.extractLocationFromOSMTags(poi.properties)

    const osmId = this.generateOSMId(poi.properties.type, poi.properties.id)

    // Update attraction
    const { error: attractionError } = await this.supabase
      .schema('core')
      .from('attractions')
      .update({
        name: location.name,
        city: location.city,
        state: location.state,
        country: location.country,
        formatted_address: 'address' in location ? location.address : null,
        osm_id: osmId,
        osm_type: poi.properties.type,
        osm_tags: poi.properties,
        import_batch_id: batchId,
        import_source: 'osm-importer'
      })
      .eq('id', attractionId)

    if (attractionError) throw attractionError

    // Update coordinates
    const { error: coordError } = await this.supabase
      .schema('core')
      .from('attraction_coordinate')
      .update({
        latitude: coords[1],
        longitude: coords[0]
      })
      .eq('attraction_id', attractionId)

    if (coordError) throw coordError
  }

  /**
   * Extract coordinates from geometry
   */
  private extractCoordinates(geometry: OSMFeature['geometry']): [number, number] | null {
    if (geometry.type === 'Point') {
      const coords = geometry.coordinates as number[]
      return [coords[0], coords[1]]
    }
    // For polygons, use centroid (implement if needed)
    return null
  }

  /**
   * Create import batch record
   */
  async createImportBatch(sourceFile: string, fileType: 'pbf' | 'geojson', filterConfig?: any) {
    const { data, error } = await this.supabase
      .schema('core')
      .from('osm_import_batches')
      .insert({
        source_file: sourceFile,
        file_type: fileType,
        filter_config: filterConfig,
        status: 'pending'
      })
      .select('id')
      .single()

    if (error) throw error
    return data.id
  }

  /**
   * Update batch statistics
   */
  async updateBatchStats(batchId: string, stats: Partial<ImportBatch> & { processing_time_ms?: number }) {
    await this.supabase
      .schema('core')
      .from('osm_import_batches')
      .update(stats)
      .eq('id', batchId)
  }

  /**
   * Get import batch details
   */
  async getImportBatch(batchId: string): Promise<ImportBatch | null> {
    const { data, error } = await this.supabase
      .schema('core')
      .from('osm_import_batches')
      .select('*')
      .eq('id', batchId)
      .single()

    if (error) return null
    return data
  }

  /**
   * List recent import batches
   */
  async getRecentBatches(limit: number = 10): Promise<ImportBatch[]> {
    const { data, error } = await this.supabase
      .schema('core')
      .from('osm_import_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return []
    return data || []
  }
}
