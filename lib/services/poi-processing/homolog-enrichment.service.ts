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
import { OSMCacheService } from '../osm-cache-service'
import { LocalReverseGeocoder } from '../local-reverse-geocoder'
import { LocalOSMFetcher } from '../trigger-points-google/services/local-osm-fetcher'


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

export type EnrichmentMethod =
  | 'local_osm_tags'     // city/state/country read straight from addr:* tags in local OSM
  | 'geonames_offline'   // nearest GeoNames city (offline R-tree lookup)
  | 'local_mixed'        // some fields from addr:* tags, rest from GeoNames
  | 'osm_lookup'         // Nominatim /lookup by OSM id (legacy chain)
  | 'reverse_geocoding'  // Nominatim /reverse or Photon (legacy chain)

export interface EnrichmentResult {
  success: boolean
  uuid_id: string
  message: string
  fields_updated?: string[]
  enrichment_method?: EnrichmentMethod
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

      // ─── Stage 0: Local-first lookup ────────────────────────────────
      // Try OSM tags + GeoNames before any external API. Sub-millisecond
      // when it works, no rate limits. Returns null if neither layer can
      // provide city/state/country — in which case we fall through to the
      // existing Nominatim/Photon chain.
      let osmData: any = null
      let enrichmentMethod: 'osm_lookup' | 'reverse_geocoding' | 'local_osm_tags' | 'geonames_offline' | 'local_mixed' = 'reverse_geocoding'

      const localResult = await this.tryLocalReverseGeocode(poiData)
      if (localResult) {
        osmData = {
          name,
          class: null,
          type: null,
          display_name: [localResult.city, localResult.state, localResult.country].filter(Boolean).join(', '),
          address: {
            city: localResult.city,
            state: localResult.state,
            country: localResult.country
          },
          extratags: {},
          importance: null,
          // Cite the source so it's debuggable downstream.
          _local_source: localResult.source,
          _local_distance_km: localResult.distance_km
        }
        enrichmentMethod =
          localResult.source === 'osm_tags' ? 'local_osm_tags' :
          localResult.source === 'geonames' ? 'geonames_offline' :
          'local_mixed'
        const distNote = localResult.distance_km != null
          ? ` (${localResult.distance_km.toFixed(1)} km from POI)`
          : ''
        console.log(`🌍 Local reverse geocode (${localResult.source}): ${osmData.display_name}${distNote}`)
      }

      // Step 2: Try OSM ID lookup first (more accurate)
      // Skip when local lookup already succeeded — saves a Nominatim call.

      if (!osmData && poiData.osm_id && poiData.osm_type) {
        console.log(`🔍 Trying OSM ID lookup: ${poiData.osm_type}${poiData.osm_id}`)
        osmData = await this.fetchOSMDataByID(poiData.osm_id, poiData.osm_type)

        if (osmData) {
          enrichmentMethod = 'osm_lookup'
          console.log(`✅ OSM ID lookup successful`)
        } else {
          console.log(`⚠️ OSM ID lookup failed, falling back to reverse geocoding`)
        }
      }

      // Step 3: Fallback to reverse geocoding when /lookup is missing OR has no usable city.
      // Natural features (ridges, peaks, wetlands, parks) often come from USGS topo and
      // return only state/country from /lookup, so we MUST query /reverse to learn the
      // administrative city/township via point-in-polygon at the centroid.
      const lookupCityFound = this.hasUsableCity(osmData?.address)
      if ((!osmData || !lookupCityFound) && poiData.lat && poiData.lng) {
        const reason = !osmData ? 'no /lookup result' : 'no city in /lookup address'
        console.log(`📍 Using reverse geocoding (${reason}) for: ${poiData.lat}, ${poiData.lng}`)
        const reverseData = await this.fetchOSMDataByCoordinates(poiData.lat, poiData.lng)
        if (reverseData) {
          if (osmData) {
            // Keep the original /lookup result (name, class, type, extratags) but merge
            // the /reverse address on top so the city/town cascade in extractUpdates sees it.
            osmData = {
              ...osmData,
              address: { ...(osmData.address ?? {}), ...(reverseData.address ?? {}) },
              extratags: { ...(osmData.extratags ?? {}), ...(reverseData.extratags ?? {}) }
            }
            // Mark this as a hybrid result for telemetry — still lookup-anchored but city
            // came from /reverse.
            enrichmentMethod = 'reverse_geocoding'
          } else {
            osmData = reverseData
          }
        }
      }

      // Step 4: Fallback to Photon (Komoot) when Nominatim fails completely.
      // Photon is a mirror of Nominatim that often has better coverage for edge cases
      // and is not affected by the same rate-limiting. Used as last resort when both
      // /lookup and /reverse fail but coordinates are available.
      if (!osmData && poiData.lat && poiData.lng) {
        console.log(`📡 Using Photon (Komoot) as final fallback for: ${poiData.lat}, ${poiData.lng}`)
        const photonData = await this.fetchViaPhoton(poiData.lat, poiData.lng)
        if (photonData) {
          osmData = photonData
          enrichmentMethod = 'reverse_geocoding'
        }
      }

      if (!osmData) {
        return {
          success: false,
          uuid_id,
          message: 'No OSM data found via OSM ID, Nominatim reverse, or Photon geocoding',
          error: 'OSM data not found'
        }
      }

      // Step 5: Extract relevant information
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

      // Step 6: Update homolog.pois
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

  // Mirrors the city cascade in extractUpdates(): returns true when Nominatim's
  // address payload has any field we would accept as `city`.
  private static hasUsableCity(address: any): boolean {
    if (!address) return false
    return Boolean(
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.province ||
      address.county
    )
  }

  // =====================================
  // LOCAL-FIRST REVERSE GEOCODING
  // =====================================

  /**
   * Stage 0 of enrichment — try to answer city/state/country from data we
   * already have on disk. Two layers:
   *   1. POI's own addr:* tags from the local OSM dump (cheapest, exact)
   *   2. GeoNames nearest-city lookup (sub-millisecond R-tree)
   * Returns null when neither layer can provide at least a country, in which
   * case the caller falls through to Nominatim/Photon.
   */
  private static async tryLocalReverseGeocode(
    poiData: { osm_id?: string | number; osm_type?: 'node' | 'way' | 'relation'; lat?: number; lng?: number }
  ): Promise<{ city: string | null; state: string | null; country: string | null; source: string; distance_km?: number } | null> {
    const geocoder = LocalReverseGeocoder.getInstance()

    // Pull the POI's own OSM tags from the local DB if we know which element it is.
    let tags: any = null
    if (poiData.osm_id && poiData.osm_type) {
      try {
        const fetcher = LocalOSMFetcher.getInstance()
        const found = fetcher.fetchElementById(poiData.osm_type, String(poiData.osm_id))
        const el = found?.elements?.[0]
        if (el?.tags) tags = el.tags
      } catch {
        // best-effort — missing local OSM data just means we lose Stage 1.
      }
    }

    const result = geocoder.reverseGeocode(poiData.lat, poiData.lng, tags)
    if (!result) return null

    // Require at least country before we trust the local result. State+country
    // is enough — city can come later from Nominatim if needed.
    if (!result.country && !result.state) return null

    return {
      city: result.city,
      state: result.state,
      country: result.country,
      source: result.source,
      distance_km: result.distance_km
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
      
      // 🚀 CACHE CHECK
      const cacheService = OSMCacheService.getInstance()
      const cachedData = cacheService.get(lookupUrl, 30) // Cache Nominatim for 30 days (it rarely changes)
      
      if (cachedData) {
        console.log(`   ✅ Using cached Nominatim data for OSM ID: ${osmType}${osmId}`)
        return cachedData
      }
      
      const response = await fetch(lookupUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 - Contact: leandro@tuggi.com.br' }
      })

      if (response.ok) {
        const results = await response.json()
        if (Array.isArray(results) && results.length > 0) {
          // 🚀 SAVE TO CACHE
          cacheService.set(lookupUrl, results[0])
          return results[0]
        }
        // 200 OK but empty array — POI not in Nominatim's address index
        // (common for natural features, peaks, recent edits).
        console.log(`   ℹ️  Nominatim /lookup returned empty for ${osmType}${osmId} (not in address index)`)
      } else if (response.status === 429) {
        console.warn(`   🚫 Nominatim /lookup rate-limited (HTTP 429) — Nominatim public TOS is 1 req/sec per IP. Backoff and retry, or use Photon / self-host.`)
      } else {
        console.warn(`   ⚠️  Nominatim /lookup HTTP ${response.status} for ${osmType}${osmId}`)
      }

      return null
    } catch (error) {
      console.error('❌ Error fetching OSM data by ID (network/exception):', error)
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

      // 🚀 CACHE CHECK
      const cacheService = OSMCacheService.getInstance()
      const cachedData = cacheService.get(reverseUrl, 30)

      if (cachedData) {
        console.log(`   ✅ Using cached Nominatim reverse data for coords`)
        return cachedData
      }

      const response = await fetch(reverseUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 - Contact: leandro@tuggi.com.br' }
      })

      if (response.ok) {
        const data = await response.json()
        if (data && !data.error) {
          // 🚀 SAVE TO CACHE
          cacheService.set(reverseUrl, data)
          return data
        }
        console.log(`   ℹ️  Nominatim /reverse returned no usable data for ${lat},${lng}`)
      } else if (response.status === 429) {
        console.warn(`   🚫 Nominatim /reverse rate-limited (HTTP 429) — public TOS is 1 req/sec per IP.`)
      } else {
        console.warn(`   ⚠️  Nominatim /reverse HTTP ${response.status} for ${lat},${lng}`)
      }

      return null
    } catch (error) {
      console.error('❌ Error fetching OSM data by coordinates (network/exception):', error)
      return null
    }
  }

  /**
   * Fetch OSM data via Photon (Komoot's Nominatim mirror)
   * Used as last resort when Nominatim fails. Photon often has better coverage
   * for edge cases and is independent of Nominatim's rate-limiting.
   */
  private static async fetchViaPhoton(lat: number, lng: number): Promise<any | null> {
    try {
      const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`

      // 🚀 CACHE CHECK
      const cacheService = OSMCacheService.getInstance()
      const cachedData = cacheService.get(photonUrl, 30)

      if (cachedData) {
        console.log(`   ✅ Using cached Photon data for coords`)
        return cachedData
      }

      const response = await fetch(photonUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 - Contact: leandro@tuggi.com.br' }
      })

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`   🚫 Photon rate-limited (HTTP 429)`)
        } else {
          console.warn(`   ⚠️  Photon HTTP ${response.status} for ${lat},${lng}`)
        }
        return null
      }

      {
        const data = await response.json()
        if (data?.features && data.features.length > 0) {
          const feature = data.features[0]
          // Transform Photon response to Nominatim-like format for compatibility
          const transformed = {
            name: feature.properties?.name,
            type: feature.properties?.osm_value,
            class: feature.properties?.osm_key,
            display_name: `${feature.properties?.name || ''} ${feature.geometry?.coordinates?.[1] || ''}, ${feature.geometry?.coordinates?.[0] || ''}`,
            address: {
              city: feature.properties?.city,
              town: feature.properties?.town,
              village: feature.properties?.village,
              county: feature.properties?.county,
              state: feature.properties?.state,
              country: feature.properties?.country,
              postcode: feature.properties?.postcode,
              road: feature.properties?.street
            },
            extratags: {},
            osm_id: feature.properties?.osm_id,
            osm_type: feature.properties?.osm_type
          }
          // 🚀 SAVE TO CACHE
          cacheService.set(photonUrl, transformed)
          return transformed
        }
      }

      return null
    } catch (error) {
      console.error('❌ Error fetching data via Photon:', error)
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
