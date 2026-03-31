/**
 * Homolog Enrichment Service
 * 
 * Service for enriching POIs in the homolog schema using OpenStreetMap data.
 * Focuses on populating missing location data (city, country, state) and 
 * basic POI information before migration to core.
 * 
 * Uses OSM ID lookup first, then falls back to reverse geocoding.
 */

import { getSupabase } from '../../core/supabase-client'

// Service role client for database operations (must use 'service' for homolog schema access)
const supabaseAdmin = getSupabase('service')

export interface HomologEnrichmentInput {
  uuid_id: string
  name: string
  osm_id?: string | number
  osm_type?: 'node' | 'way' | 'relation'
  lat?: number
  lng?: number
}

export interface EnrichmentResult {
  success: boolean
  uuid_id: string
  message: string
  fields_updated?: string[]
  enrichment_method?: 'osm_lookup' | 'reverse_geocoding'
  error?: string
}

export class HomologEnrichmentService {
  
  /**
   * Enrich Homolog POI with OSM data
   * Priority: OSM ID lookup > Reverse Geocoding
   */
  static async enrichPOI(input: HomologEnrichmentInput): Promise<EnrichmentResult> {
    const { uuid_id, name } = input
    
    console.log(`🔄 Starting Homolog enrichment for POI: ${name}`)

    try {
      // Step 1: Load POI data including osm_id and coordinates
      const poiData = await this.loadHomologPOI(uuid_id)
      
      if (!poiData) {
        return {
          success: false,
          uuid_id,
          message: 'POI not found in homolog',
          error: 'POI not found'
        }
      }

      // Step 2: Try OSM ID lookup first (more accurate)
      let osmData: any = null
      let enrichmentMethod: 'osm_lookup' | 'reverse_geocoding' = 'reverse_geocoding'
      
      if (poiData.osm_id && poiData.osm_type) {
        console.log(`🔍 Trying OSM ID lookup: ${poiData.osm_type}${poiData.osm_id}`)
        osmData = await this.fetchOSMDataByID(poiData.osm_id, poiData.osm_type)
        
        if (osmData) {
          enrichmentMethod = 'osm_lookup'
          console.log(`✅ OSM ID lookup successful`)
        } else {
          console.log(`⚠️ OSM ID lookup failed, falling back to reverse geocoding`)
        }
      }

      // Step 3: Fallback to reverse geocoding
      if (!osmData && poiData.lat && poiData.lng) {
        console.log(`📍 Using reverse geocoding for: ${poiData.lat}, ${poiData.lng}`)
        osmData = await this.fetchOSMDataByCoordinates(poiData.lat, poiData.lng)
      }
      
      if (!osmData) {
        return {
          success: false,
          uuid_id,
          message: 'No OSM data found via OSM ID or reverse geocoding',
          error: 'OSM data not found'
        }
      }

      // Step 4: Extract relevant information
      const updates = this.extractUpdates(osmData)
      
      if (Object.keys(updates).length === 0) {
        return {
          success: true,
          uuid_id,
          message: 'No new fields to update',
          fields_updated: [],
          enrichment_method: enrichmentMethod
        }
      }

      // Step 5: Update homolog.pois
      const updateResult = await this.updateHomologPOI(uuid_id, updates)

      if (!updateResult.success) {
        return {
          success: false,
          uuid_id,
          message: 'Failed to update database',
          error: updateResult.error
        }
      }

      console.log(`✅ Successfully enriched Homolog POI: ${name} (via ${enrichmentMethod})`)

      return {
        success: true,
        uuid_id,
        message: `POI enriched successfully via ${enrichmentMethod}`,
        fields_updated: updateResult.fields_updated,
        enrichment_method: enrichmentMethod
      }

    } catch (error: any) {
      console.error('❌ Error in Homolog enrichment:', error)
      return {
        success: false,
        uuid_id,
        message: 'Internal server error during enrichment',
        error: error.message
      }
    }
  }

  // =====================================
  // DATA LOADING
  // =====================================

  private static async loadHomologPOI(uuid_id: string): Promise<{
    osm_id?: string | number
    osm_type?: 'node' | 'way' | 'relation'
    lat?: number
    lng?: number
  } | null> {
    try {
      // Load POI with osm_id and osm_type
      const { data: poi, error: poiError } = await supabaseAdmin
        .schema('homolog')
        .from('pois')
        .select('osm_id, osm_type')
        .eq('uuid_id', uuid_id)
        .single()

      if (poiError) {
        console.error('Error loading POI:', poiError)
        return null
      }

      // Load coordinates
      const { data: coord, error: coordError } = await supabaseAdmin
        .schema('homolog')
        .from('coordinates')
        .select('latitude, longitude')
        .eq('poi_uuid_id', uuid_id)
        .single()

      if (coordError) {
        console.warn('Coordinates not found:', coordError)
      }

      // Normalize osm_type
      let osmType: 'node' | 'way' | 'relation' | undefined
      if (poi?.osm_type) {
        const type = String(poi.osm_type).toLowerCase()
        if (['node', 'way', 'relation'].includes(type)) {
          osmType = type as 'node' | 'way' | 'relation'
        }
      }

      return {
        osm_id: poi?.osm_id,
        osm_type: osmType,
        lat: coord?.latitude,
        lng: coord?.longitude
      }
    } catch (error) {
      console.error('Error loading homolog POI:', error)
      return null
    }
  }

  // =====================================
  // OSM DATA FETCHING
  // =====================================

  /**
   * Fetch OSM data by OSM ID (most accurate method)
   * Uses Nominatim /lookup endpoint
   */
  private static async fetchOSMDataByID(
    osmId: string | number,
    osmType: 'node' | 'way' | 'relation'
  ): Promise<any | null> {
    try {
      // Format: N for node, W for way, R for relation
      const typePrefix = osmType.charAt(0).toUpperCase()
      const lookupUrl = `https://nominatim.openstreetmap.org/lookup?osm_ids=${typePrefix}${osmId}&format=json&extratags=1&namedetails=1&addressdetails=1`
      
      console.log(`   Nominatim lookup URL: ${lookupUrl}`)
      
      const response = await fetch(lookupUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 - Contact: leandro@tuggi.com.br' }
      })
      
      if (response.ok) {
        const results = await response.json()
        if (Array.isArray(results) && results.length > 0) {
          return results[0]
        }
      }
      
      return null
    } catch (error) {
      console.error('❌ Error fetching OSM data by ID:', error)
      return null
    }
  }

  /**
   * Fetch OSM data by coordinates (fallback method)
   * Uses Nominatim /reverse endpoint
   */
  private static async fetchOSMDataByCoordinates(lat: number, lng: number): Promise<any | null> {
    try {
      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&extratags=1&namedetails=1&addressdetails=1`
      
      const response = await fetch(reverseUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 - Contact: leandro@tuggi.com.br' }
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data && !data.error) {
          return data
        }
      }
      
      return null
    } catch (error) {
      console.error('❌ Error fetching OSM data by coordinates:', error)
      return null
    }
  }

  // =====================================
  // DATA EXTRACTION
  // =====================================

  private static extractUpdates(osmData: any): any {
    const address = osmData.address || {}
    const extratags = osmData.extratags || {}
    const updates: any = {}

    // Location Hierarchy (with province/county fallbacks for natural/rural areas)
    if (address.city || address.town || address.village || address.municipality || address.province || address.county) {
      updates.city = address.city || address.town || address.village || address.municipality || address.province || address.county
    }
    
    if (address.state || address.province || address.region) {
      updates.state = address.state || address.province || address.region
    }
    
    if (address.country) {
      updates.country = address.country
    }
    
    if (address.postcode) {
      updates.postal_code = address.postcode
    }
    
    if (address.road) {
      updates.street_name = address.road
    }
    
    if (address.house_number) {
      updates.house_number = address.house_number
    }
    
    if (address.neighbourhood || address.suburb) {
      updates.neighborhood = address.neighbourhood || address.suburb
    }

    // Category (avoid 'place' as it's too generic)
    if (osmData.class && osmData.class !== 'place') {
      updates.category = osmData.class
    }
    
    // Store all tags in osm_properties for reference
    updates.osm_properties = {
      ...extratags,
      name: osmData.name,
      type: osmData.type,
      class: osmData.class,
      display_name: osmData.display_name,
      importance: osmData.importance
    }
    
    // Additional fields from extratags
    if (extratags.website || extratags['contact:website']) {
      updates.website = extratags.website || extratags['contact:website']
    }
    
    if (extratags.phone || extratags['contact:phone']) {
      updates.contact_phone = extratags.phone || extratags['contact:phone']
    }

    return updates
  }

  // =====================================
  // DATABASE UPDATE
  // =====================================

  private static async updateHomologPOI(uuid_id: string, updates: any) {
    try {
      const { error } = await supabaseAdmin
        .schema('homolog')
        .from('pois')
        .update(updates)
        .eq('uuid_id', uuid_id)

      if (error) {
        return { success: false, error: error.message }
      }

      return { 
        success: true, 
        fields_updated: Object.keys(updates)
      }

    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
