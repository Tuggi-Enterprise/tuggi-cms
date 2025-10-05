/**
 * City Correction Service - POI Processing Module
 * 
 * 100% FREE city correction using multiple free geocoding sources
 * Corrects inaccurate city names in POI data using coordinates
 * 
 * Features:
 * - Nominatim OSM reverse geocoding (primary source)
 * - GeoNames API integration (secondary source)
 * - Cross-validation between sources
 * - Batch processing with rate limiting
 * - Audit trail for all corrections
 * - Manual review system for edge cases
 */

import { getSupabase } from '../../core/supabase-client'

// Service role client for database operations
const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  
  return getSupabase('service')
}

// Lazy initialization
let supabaseAdmin: any = null
const getSupabaseAdmin = () => {
  if (!supabaseAdmin) {
    supabaseAdmin = getSupabaseClient()
  }
  return supabaseAdmin!
}

// =====================================
// INTERFACES AND TYPES
// =====================================

export interface POILocation {
  id: string
  name: string
  latitude: number
  longitude: number
  city: string
  state?: string
  country: string
}

export interface CityVerificationResult {
  poi_id: string
  original_city: string
  verified_city: string | null
  verified_state?: string | null
  verified_country?: string | null
  confidence: number
  source: 'nominatim' | 'geonames' | 'cross_validated' | 'no_change'
  needs_correction: boolean
  needs_manual_review: boolean
  raw_data?: {
    nominatim?: any
    geonames?: any
  }
  error?: string
}

export interface BatchCorrectionResult {
  total_processed: number
  corrections_applied: number
  manual_review_needed: number
  errors: number
  processing_time: number
  results: CityVerificationResult[]
}

export interface CorrectionOptions {
  confidence_threshold?: number  // Default: 85
  enable_cross_validation?: boolean  // Default: true
  enable_manual_review?: boolean     // Default: true
  batch_size?: number               // Default: 100
  delay_between_requests?: number   // Default: 1100ms (Nominatim limit)
  dry_run?: boolean                 // Default: false
}

// =====================================
// RATE LIMITING
// =====================================

class RateLimiter {
  private lastRequest: number = 0
  private requestCount: number = 0
  private dailyLimit: number
  private delayMs: number

  constructor(dailyLimit: number, delayMs: number) {
    this.dailyLimit = dailyLimit
    this.delayMs = delayMs
  }

  async waitForNextRequest(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequest
    
    if (timeSinceLastRequest < this.delayMs) {
      const waitTime = this.delayMs - timeSinceLastRequest
      console.log(`⏳ Rate limiting: waiting ${waitTime}ms`)
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
    
    this.lastRequest = Date.now()
    this.requestCount++
    
    if (this.requestCount >= this.dailyLimit) {
      throw new Error(`Daily rate limit of ${this.dailyLimit} requests exceeded`)
    }
  }

  reset(): void {
    this.requestCount = 0
  }
}

// Rate limiters for different services
const nominatimLimiter = new RateLimiter(86400, 1100) // 1 req/second with buffer
const geonamesLimiter = new RateLimiter(1000, 90000)  // ~1000/day, ~1 per 90s

// =====================================
// GEOCODING SERVICES
// =====================================

class NominatimService {
  static async reverseGeocode(lat: number, lng: number): Promise<any> {
    await nominatimLimiter.waitForNextRequest()
    
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?` +
        `lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=10`
      
      console.log(`🌍 Nominatim reverse geocoding: ${lat}, ${lng}`)
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (city-correction-service)'
        }
      })
      
      if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (!data.address) {
        return null
      }
      
      // Extract city information from address components
      const address = data.address
      const city = address.city || 
                  address.town || 
                  address.municipality || 
                  address.village || 
                  address.hamlet ||
                  address.county
      
      const state = address.state || 
                   address.province || 
                   address.region
      
      const country = address.country
      
      return {
        city,
        state,
        country,
        confidence: 85, // Fixed confidence for Nominatim
        raw_data: data
      }
      
    } catch (error) {
      console.error('❌ Nominatim error:', error)
      return null
    }
  }
}

class GeoNamesService {
  static async findNearbyPlaceName(lat: number, lng: number): Promise<any> {
    await geonamesLimiter.waitForNextRequest()
    
    try {
      // Using free GeoNames API - requires username registration
      const username = process.env.GEONAMES_USERNAME || 'tuggi_cms'
      const url = `http://api.geonames.org/findNearbyPlaceNameJSON?` +
        `lat=${lat}&lng=${lng}&username=${username}&radius=10&maxRows=1`
      
      console.log(`🌎 GeoNames nearby place: ${lat}, ${lng}`)
      
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`GeoNames API error: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (data.status || !data.geonames || data.geonames.length === 0) {
        return null
      }
      
      const place = data.geonames[0]
      
      return {
        city: place.name,
        state: place.adminName1,
        country: place.countryName,
        confidence: 75, // Fixed confidence for GeoNames
        raw_data: data
      }
      
    } catch (error) {
      console.error('❌ GeoNames error:', error)
      return null
    }
  }
}

// =====================================
// MAIN SERVICE CLASS
// =====================================

export class CityCorrectionService {
  
  /**
   * Verify and correct a single POI's city information
   */
  static async verifySinglePOI(
    poi: POILocation, 
    options: CorrectionOptions = {}
  ): Promise<CityVerificationResult> {
    
    const {
      confidence_threshold = 85,
      enable_cross_validation = true
    } = options
    
    console.log(`🔍 Verifying city for: ${poi.name} (${poi.city})`)
    
    try {
      // Get data from both sources (but handle GeoNames errors gracefully)
      const nominatimResult = await NominatimService.reverseGeocode(poi.latitude, poi.longitude)
      
      let geonamesResult = null
      try {
        geonamesResult = await GeoNamesService.findNearbyPlaceName(poi.latitude, poi.longitude)
      } catch (geonamesError) {
        console.log(`⚠️ GeoNames unavailable for ${poi.name}: ${geonamesError instanceof Error ? geonamesError.message : 'Unknown error'}`)
        // Continue with just Nominatim
      }
      
      // Analyze results
      const analysis = this.analyzeGeocodingResults(
        poi, 
        nominatimResult, 
        geonamesResult, 
        enable_cross_validation
      )
      
      // Determine if correction is needed
      const needs_correction = !!(analysis.confidence >= confidence_threshold && 
                              analysis.verified_city && 
                              analysis.verified_city.toLowerCase() !== poi.city.toLowerCase())
      
      const needs_manual_review = !!(analysis.confidence >= 60 && 
                                 analysis.confidence < confidence_threshold)
      
      return {
        poi_id: poi.id,
        original_city: poi.city,
        verified_city: analysis.verified_city,
        verified_state: analysis.verified_state,
        verified_country: analysis.verified_country,
        confidence: analysis.confidence,
        source: analysis.source,
        needs_correction,
        needs_manual_review,
        raw_data: {
          nominatim: nominatimResult,
          geonames: geonamesResult
        }
      }
      
    } catch (error) {
      console.error(`❌ Error verifying POI ${poi.id}:`, error)
      return {
        poi_id: poi.id,
        original_city: poi.city,
        verified_city: null,
        confidence: 0,
        source: 'no_change',
        needs_correction: false,
        needs_manual_review: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  /**
   * Process multiple POIs in batch
   */
  static async processBatch(
    pois: POILocation[], 
    options: CorrectionOptions = {}
  ): Promise<BatchCorrectionResult> {
    
    const {
      batch_size = 100,
      dry_run = false
    } = options
    
    const startTime = Date.now()
    const results: CityVerificationResult[] = []
    let corrections_applied = 0
    let manual_review_needed = 0
    let errors = 0
    
    console.log(`🚀 Starting batch correction for ${pois.length} POIs`)
    
    // Process in batches to manage memory and rate limits
    for (let i = 0; i < pois.length; i += batch_size) {
      const batch = pois.slice(i, i + batch_size)
      console.log(`📦 Processing batch ${Math.floor(i / batch_size) + 1}/${Math.ceil(pois.length / batch_size)}`)
      
      for (const poi of batch) {
        try {
          const result = await this.verifySinglePOI(poi, options)
          results.push(result)
          
          if (result.needs_correction) {
            corrections_applied++
            
            if (!dry_run) {
              await this.applyCityCorrection(result)
            }
          }
          
          if (result.needs_manual_review) {
            manual_review_needed++
            
            if (!dry_run) {
              await this.createManualReviewRecord(result)
            }
          }
          
          if (result.error) {
            errors++
          }
          
        } catch (error) {
          console.error(`❌ Batch processing error for POI ${poi.id}:`, error)
          errors++
        }
      }
      
      // Progress update
      const processed = Math.min(i + batch_size, pois.length)
      const progress = ((processed / pois.length) * 100).toFixed(1)
      console.log(`📊 Progress: ${processed}/${pois.length} (${progress}%)`)
    }
    
    const processing_time = Date.now() - startTime
    
    console.log(`✅ Batch processing completed:`)
    console.log(`   Total processed: ${results.length}`)
    console.log(`   Corrections applied: ${corrections_applied}`)
    console.log(`   Manual review needed: ${manual_review_needed}`)
    console.log(`   Errors: ${errors}`)
    console.log(`   Processing time: ${(processing_time / 1000).toFixed(2)}s`)
    
    return {
      total_processed: results.length,
      corrections_applied,
      manual_review_needed,
      errors,
      processing_time,
      results
    }
  }
  
  /**
   * Get POIs that need city correction
   */
  static async getPOIsForCorrection(
    limit: number = 1000,
    country?: string,
    state?: string
  ): Promise<POILocation[]> {
    
    const supabase = getSupabaseAdmin()
    
    // Build query with JOIN to get coordinates directly
    let query = supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, 
        name, 
        city, 
        state, 
        country,
        attraction_coordinate!inner(latitude, longitude)
      `)
      .is('city_correction_audit', null) // Not already processed
      .limit(limit)
    
    if (country) {
      query = query.eq('country', country)
    }
    
    if (state) {
      query = query.eq('state', state)
    }
    
    const { data, error } = await query
    
    if (error) {
      throw new Error(`Error fetching POIs: ${error.message}`)
    }
    
    // Transform the nested structure to flat POILocation objects
    const poisWithCoords = (data || []).map((poi: any) => ({
      id: poi.id,
      name: poi.name,
      city: poi.city,
      state: poi.state,
      country: poi.country,
      latitude: poi.attraction_coordinate[0]?.latitude,
      longitude: poi.attraction_coordinate[0]?.longitude
    })).filter((poi: any) => poi.latitude && poi.longitude) // Only include POIs with coordinates
    
    return poisWithCoords
  }
  
  /**
   * Analyze geocoding results from multiple sources
   */
  private static analyzeGeocodingResults(
    poi: POILocation,
    nominatimResult: any,
    geonamesResult: any,
    enable_cross_validation: boolean
  ): {
    verified_city: string | null
    verified_state: string | null
    verified_country: string | null
    confidence: number
    source: 'nominatim' | 'geonames' | 'cross_validated' | 'no_change'
  } {
    
    // Both sources returned data
    if (nominatimResult && geonamesResult && enable_cross_validation) {
      const nominatimCity = this.normalizeCity(nominatimResult.city)
      const geonamesCity = this.normalizeCity(geonamesResult.city)
      
      // Cities match - high confidence
      if (nominatimCity === geonamesCity) {
        return {
          verified_city: nominatimResult.city,
          verified_state: nominatimResult.state || geonamesResult.state,
          verified_country: nominatimResult.country || geonamesResult.country,
          confidence: 95,
          source: 'cross_validated'
        }
      }
      
      // Cities don't match - use Nominatim (more reliable for cities)
      return {
        verified_city: nominatimResult.city,
        verified_state: nominatimResult.state,
        verified_country: nominatimResult.country,
        confidence: 75, // Lower confidence due to disagreement
        source: 'nominatim'
      }
    }
    
    // Only Nominatim returned data
    if (nominatimResult && nominatimResult.city) {
      return {
        verified_city: nominatimResult.city,
        verified_state: nominatimResult.state,
        verified_country: nominatimResult.country,
        confidence: 85,
        source: 'nominatim'
      }
    }
    
    // Only GeoNames returned data
    if (geonamesResult && geonamesResult.city) {
      return {
        verified_city: geonamesResult.city,
        verified_state: geonamesResult.state,
        verified_country: geonamesResult.country,
        confidence: 75,
        source: 'geonames'
      }
    }
    
    // No data from either source
    return {
      verified_city: null,
      verified_state: null,
      verified_country: null,
      confidence: 0,
      source: 'no_change'
    }
  }
  
  /**
   * Normalize city names for comparison
   */
  private static normalizeCity(city: string | null): string {
    if (!city) return ''
    
    return city
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9\s]/g, '') // Remove special chars
      .replace(/\s+/g, ' ') // Normalize spaces
  }
  
  /**
   * Apply city correction to database
   */
  private static async applyCityCorrection(result: CityVerificationResult): Promise<void> {
    const supabase = getSupabaseAdmin()
    
    const updateData: any = {
      city_correction_audit: {
        original_city: result.original_city,
        corrected_city: result.verified_city,
        confidence: result.confidence,
        source: result.source,
        corrected_at: new Date().toISOString(),
        auto_corrected: true
      },
      updated_at: new Date().toISOString()
    }
    
    // Update city if we have high confidence
    if (result.verified_city) {
      updateData.city = result.verified_city
    }
    
    if (result.verified_state) {
      updateData.state = result.verified_state
    }
    
    if (result.verified_country) {
      updateData.country = result.verified_country
    }
    
    const { error } = await supabase
      .schema('core')
      .from('attractions')
      .update(updateData)
      .eq('id', result.poi_id)
    
    if (error) {
      console.error(`❌ Error applying correction for POI ${result.poi_id}:`, error)
      throw error
    }
    
    console.log(`✅ Applied city correction: ${result.original_city} → ${result.verified_city}`)
  }
  
  /**
   * Create manual review record for uncertain cases
   */
  private static async createManualReviewRecord(result: CityVerificationResult): Promise<void> {
    const supabase = getSupabaseAdmin()
    
    // Create a manual review record (you might want to create a dedicated table for this)
    const auditData = {
      city_correction_audit: {
        original_city: result.original_city,
        suggested_city: result.verified_city,
        confidence: result.confidence,
        source: result.source,
        needs_manual_review: true,
        created_at: new Date().toISOString(),
        raw_data: result.raw_data
      },
      updated_at: new Date().toISOString()
    }
    
    const { error } = await supabase
      .schema('core')
      .from('attractions')
      .update(auditData)
      .eq('id', result.poi_id)
    
    if (error) {
      console.error(`❌ Error creating manual review record for POI ${result.poi_id}:`, error)
      throw error
    }
    
    console.log(`📋 Created manual review: ${result.original_city} → ${result.verified_city} (${result.confidence}%)`)
  }
}

// =====================================
// UTILITY FUNCTIONS
// =====================================

/**
 * Reset rate limiters (useful for testing or daily resets)
 */
export function resetRateLimiters(): void {
  nominatimLimiter.reset()
  geonamesLimiter.reset()
  console.log('✅ Rate limiters reset')
}

/**
 * Get rate limiter status
 */
export function getRateLimiterStatus(): {
  nominatim: { requestCount: number, dailyLimit: number }
  geonames: { requestCount: number, dailyLimit: number }
} {
  return {
    nominatim: { 
      requestCount: (nominatimLimiter as any).requestCount, 
      dailyLimit: (nominatimLimiter as any).dailyLimit 
    },
    geonames: { 
      requestCount: (geonamesLimiter as any).requestCount, 
      dailyLimit: (geonamesLimiter as any).dailyLimit 
    }
  }
}
