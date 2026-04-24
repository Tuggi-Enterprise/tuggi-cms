/**
 * City Correction Edge Function
 * 
 * Processes POI city corrections in batches using free geocoding APIs
 * Handles rate limiting, cross-validation, and audit logging
 * 
 * Features:
 * - Nominatim OSM reverse geocoding (primary)
 * - GeoNames API integration (secondary)  
 * - Cross-validation between sources
 * - Batch processing with rate limiting
 * - Comprehensive audit trail
 * - Progress tracking
 * - Error handling and recovery
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuthHeader } from '../_shared/auth-middleware.ts'
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts'
import { createSecureHeaders } from '../_shared/security-headers.ts'
import {
  validateRequestBody,
  createValidationErrorResponse,
  CityCorrectionSchema,
} from '../_shared/validation-schemas.ts'
import { createAuditLogger } from '../_shared/audit-logger.ts'

// =====================================
// INTERFACES AND TYPES
// =====================================

interface POILocation {
  id: string
  name: string
  latitude: number
  longitude: number
  city: string
  state?: string
  country: string
}

interface CityVerificationResult {
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

interface BatchProcessingOptions {
  confidence_threshold?: number
  enable_cross_validation?: boolean
  batch_size?: number
  delay_between_requests?: number
  dry_run?: boolean
  country_filter?: string
  state_filter?: string
  limit?: number
}

interface ProcessingProgress {
  total_pois: number
  processed: number
  corrections_applied: number
  manual_review_needed: number
  errors: number
  current_poi?: string
  status: 'starting' | 'processing' | 'completed' | 'failed'
  started_at: string
  estimated_completion?: string
}

// =====================================
// RATE LIMITING
// =====================================

class EdgeRateLimiter {
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

  getStatus() {
    return {
      requestCount: this.requestCount,
      dailyLimit: this.dailyLimit,
      remaining: this.dailyLimit - this.requestCount
    }
  }
}

// Rate limiters for different services
const nominatimLimiter = new EdgeRateLimiter(86400, 500) // 1 req/0.5s (reduced from 1.1s)
const geonamesLimiter = new EdgeRateLimiter(1000, 1000)  // ~1000/day, ~1 per 1s (reduced from 3s)

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
          'User-Agent': 'TuggiCMS/1.0 (city-correction-edge-function)'
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
      // Get username from environment
      const username = Deno.env.get('GEONAMES_USERNAME') || 'tuggi_cms'
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
// MAIN PROCESSING SERVICE
// =====================================

class EdgeCityCorrectionService {
  private supabase: any
  private progressKey: string

  constructor(supabaseClient: any, progressKey: string = 'default') {
    this.supabase = supabaseClient
    this.progressKey = progressKey
  }

  /**
   * Process batch of POIs for city correction
   */
  async processContinuous(options: BatchProcessingOptions = {}): Promise<any> {
    const MAX_EXECUTION_TIME = 20 * 60 * 1000 // 20 minutes
    const MAX_POIS_PER_RUN = 200 // Maximum POIs to process in one run
    const startTime = Date.now()
    
    let totalProcessed = 0
    let totalCorrections = 0
    let totalManualReviews = 0
    let totalErrors = 0
    const sampleCorrections: any[] = []
    
    console.log(`🚀 Starting continuous processing (max ${MAX_POIS_PER_RUN} POIs or ${MAX_EXECUTION_TIME/60000} minutes)`)
    
    try {
      while (totalProcessed < MAX_POIS_PER_RUN) {
        // Check execution time
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          console.log('⏰ Maximum execution time reached, stopping...')
          break
        }
        
        // Get next POI
        const pois = await this.getPOIsForCorrection(1, 0, options.country_filter, options.state_filter)
        
        if (pois.length === 0) {
          console.log('✅ No more POIs to process!')
          break
        }

        const poi = pois[0]
        console.log(`🔍 [${totalProcessed + 1}/${MAX_POIS_PER_RUN}] Verifying: ${poi.name} (${poi.city})`)

        try {
          // Process the POI
          const result = await this.verifySinglePOI(poi, options.enable_cross_validation || true, options.dry_run || false)
          
          if (result.needs_correction && !options.dry_run) {
            await this.applyCityCorrection(poi.id, result.suggested_city, result.confidence, result.audit_data)
            console.log(`✅ Applied correction: ${poi.city} → ${result.suggested_city}`)
            totalCorrections++
            
            if (sampleCorrections.length < 5) {
              sampleCorrections.push({
                poi_name: poi.name,
                old_city: poi.city,
                new_city: result.suggested_city,
                confidence: result.confidence
              })
            }
          } else if (result.needs_manual_review && !options.dry_run) {
            await this.createManualReview(poi.id, poi.city, result.suggested_city, result.confidence, result.audit_data)
            console.log(`📋 Manual review: ${poi.city} → ${result.suggested_city} (${result.confidence}%)`)
            totalManualReviews++
          } else {
            // Even if no correction needed, mark as processed to avoid reprocessing
            if (!options.dry_run) {
              console.log(`📝 Marking ${poi.name} as processed...`)
              await this.markAsProcessed(poi.id, result.audit_data)
              console.log(`✅ Marked ${poi.name} as processed in database`)
            }
            console.log(`✓ No correction needed: ${poi.name}`)
          }
          
          totalProcessed++
          
          // Progress update every 10 POIs
          if (totalProcessed % 10 === 0) {
            const elapsedMinutes = (Date.now() - startTime) / 60000
            const rate = totalProcessed / elapsedMinutes
            console.log(`📊 Progress: ${totalProcessed} POIs processed (${rate.toFixed(1)} POIs/min)`)
          }
          
          // Small delay between POIs to be respectful to APIs
          await new Promise(resolve => setTimeout(resolve, 500))
          
        } catch (error) {
          console.error(`❌ Error processing ${poi.name}:`, error)
          totalErrors++
        }
      }
      
      const processingTime = Date.now() - startTime
      const rate = totalProcessed / (processingTime / 60000)
      
      console.log(`\n📊 Continuous processing completed:`)
      console.log(`   Processed: ${totalProcessed} POIs`)
      console.log(`   Corrections: ${totalCorrections}`)
      console.log(`   Manual reviews: ${totalManualReviews}`)
      console.log(`   Errors: ${totalErrors}`)
      console.log(`   Time: ${(processingTime/1000).toFixed(1)}s`)
      console.log(`   Rate: ${rate.toFixed(1)} POIs/min`)

      return {
        success: true,
        total_processed: totalProcessed,
        corrections_applied: totalCorrections,
        manual_review_needed: totalManualReviews,
        errors: totalErrors,
        processing_time: processingTime,
        processing_rate: rate,
        dry_run: options.dry_run || false,
        rate_limiter_status: {
          nominatim: nominatimLimiter.getStatus(),
          geonames: geonamesLimiter.getStatus()
        },
        sample_corrections: sampleCorrections
      }

    } catch (error) {
      console.error('❌ Error in continuous processing:', error)
      return {
        success: false,
        total_processed: totalProcessed,
        corrections_applied: totalCorrections,
        manual_review_needed: totalManualReviews,
        errors: totalErrors + 1,
        processing_time: Date.now() - startTime,
        error: error.message
      }
    }
  }

  async processSinglePOI(options: BatchProcessingOptions = {}): Promise<any> {
    const startTime = Date.now()
    
    try {
      console.log('🔍 Processing single POI for city correction...')
      
      // Get one POI that needs correction
      const pois = await this.getPOIsForCorrection(1, 0, options.country_filter, options.state_filter)
      
      if (pois.length === 0) {
        return {
          success: true,
          total_processed: 0,
          corrections_applied: 0,
          manual_review_needed: 0,
          errors: 0,
          processing_time: Date.now() - startTime,
          message: 'No POIs found for correction'
        }
      }

      const poi = pois[0]
      console.log(`🔍 Verifying city for: ${poi.name} (${poi.city})`)
      console.log(`📋 POI ID: ${poi.id}`)

      // Process the single POI
      const isDryRun = options.dry_run || false
      console.log(`🔧 Dry run mode: ${isDryRun}`)
      const result = await this.verifySinglePOI(poi, options.enable_cross_validation || true, isDryRun)
      
      if (result.needs_correction && !options.dry_run) {
        await this.applyCityCorrection(poi.id, result.suggested_city, result.confidence, result.audit_data)
        console.log(`✅ Applied city correction: ${poi.city} → ${result.suggested_city}`)
      } else if (result.needs_manual_review && !options.dry_run) {
        await this.createManualReview(poi.id, poi.city, result.suggested_city, result.confidence, result.audit_data)
        console.log(`📋 Created manual review: ${poi.city} → ${result.suggested_city} (${result.confidence}%)`)
      }

      return {
        success: true,
        total_processed: 1,
        corrections_applied: result.needs_correction ? 1 : 0,
        manual_review_needed: result.needs_manual_review ? 1 : 0,
        errors: 0,
        processing_time: Date.now() - startTime,
        dry_run: options.dry_run || false,
        current_poi_name: poi.name,
        current_poi_city: poi.city,
        rate_limiter_status: {
          nominatim: nominatimLimiter.getStatus(),
          geonames: geonamesLimiter.getStatus()
        },
        sample_corrections: result.needs_correction ? [{
          poi_name: poi.name,
          old_city: poi.city,
          new_city: result.suggested_city,
          confidence: result.confidence
        }] : []
      }

    } catch (error) {
      console.error('❌ Error processing single POI:', error)
      return {
        success: false,
        total_processed: 0,
        corrections_applied: 0,
        manual_review_needed: 0,
        errors: 1,
        processing_time: Date.now() - startTime,
        error: error.message
      }
    }
  }

  async processBatch(options: BatchProcessingOptions = {}): Promise<any> {
    const {
      confidence_threshold = 85,
      enable_cross_validation = true,
      batch_size = 2, // Reduced to avoid timeout
      dry_run = false,
      country_filter,
      state_filter,
      limit = 30 // Process 30 POIs per function call (increased for better efficiency)
    } = options

    const startTime = Date.now()
    
    try {
      console.log('🚀 Starting Edge Function city correction batch')
      
      // Initialize progress tracking
      await this.updateProgress({
        total_pois: 0,
        processed: 0,
        corrections_applied: 0,
        manual_review_needed: 0,
        errors: 0,
        status: 'starting',
        started_at: new Date().toISOString()
      })

      // Get total POIs available for correction (objective)
      const { count: totalAvailablePOIs } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })
        .is('city_correction_audit', null)

      // Get batch of POIs to process now
      const pois = await this.getPOIsForCorrection(limit, country_filter, state_filter)
      
      if (pois.length === 0) {
        await this.updateProgress({
          total_pois: 0,
          target_goal: totalAvailablePOIs || 0,
          processed: 0,
          corrections_applied: 0,
          manual_review_needed: 0,
          errors: 0,
          status: 'completed',
          started_at: new Date().toISOString(),
          message: 'No POIs found for this batch'
        })
        
        return {
          success: true,
          message: 'No POIs found for this batch',
          target_goal: totalAvailablePOIs,
          total_processed: 0,
          corrections_applied: 0,
          manual_review_needed: 0,
          errors: 0,
          processing_time: Date.now() - startTime
        }
      }

      // Update progress with total count and target goal
      await this.updateProgress({
        total_pois: pois.length,
        target_goal: totalAvailablePOIs || 0,
        processed: 0,
        corrections_applied: 0,
        manual_review_needed: 0,
        errors: 0,
        status: 'processing',
        started_at: new Date().toISOString(),
        estimated_completion: new Date(Date.now() + (pois.length * 10000)).toISOString() // ~10s per POI
      })

      console.log(`📦 Processing ${pois.length} POIs`)
      
      let corrections_applied = 0
      let manual_review_needed = 0
      let errors = 0
      const results: CityVerificationResult[] = []

      // Process POIs in batches
      for (let i = 0; i < pois.length; i += batch_size) {
        const batch = pois.slice(i, i + batch_size)
        console.log(`📦 Processing batch ${Math.floor(i / batch_size) + 1}/${Math.ceil(pois.length / batch_size)}`)
        
        for (const poi of batch) {
          try {
            // Update progress
            await this.updateProgress({
              processed: results.length,
              current_poi: poi.name,
              status: 'processing'
            })

            const result = await this.verifySinglePOI(poi, {
              confidence_threshold,
              enable_cross_validation
            })
            
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
            
            // Update progress after each POI
            await this.updateProgress({
              processed: results.length,
              corrections_applied,
              manual_review_needed,
              errors,
              current_poi: poi.name
            })
            
          } catch (error) {
            console.error(`❌ Error processing POI ${poi.id}:`, error)
            errors++
            
            results.push({
              poi_id: poi.id,
              original_city: poi.city,
              verified_city: null,
              confidence: 0,
              source: 'no_change',
              needs_correction: false,
              needs_manual_review: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }
        
        // Progress update after batch
        const processed = Math.min(i + batch_size, pois.length)
        const progress = ((processed / pois.length) * 100).toFixed(1)
        console.log(`📊 Progress: ${processed}/${pois.length} (${progress}%)`)
      }

      const processing_time = Date.now() - startTime
      
      // Check if we've reached the target goal
      const { count: remainingPOIs } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('id, attraction_coordinate!inner(id)', { count: 'exact', head: true })
        .is('city_correction_audit', null)

      const targetGoal = totalAvailablePOIs || 0
      const totalProcessedSoFar = targetGoal - (remainingPOIs || 0)
      const isGoalCompleted = (remainingPOIs || 0) === 0

      console.log(`📊 Goal Progress: ${totalProcessedSoFar}/${targetGoal} (${Math.round((totalProcessedSoFar / targetGoal) * 100)}%)`)
      console.log(`📦 Remaining POIs: ${remainingPOIs}`)

      if (isGoalCompleted) {
        // Goal completed - mark as completed
        await this.updateProgress({
          total_pois: pois.length,
          target_goal: targetGoal,
          processed: results.length,
          total_processed_so_far: totalProcessedSoFar,
          corrections_applied,
          manual_review_needed,
          errors,
          status: 'completed',
          current_poi: undefined,
          completed_at: new Date().toISOString(),
          message: 'All POIs processed successfully!'
        })

        console.log(`🎉 GOAL COMPLETED! All ${targetGoal} POIs have been processed.`)
      } else {
        // Goal not completed - mark as needs_retry for automatic retry
        await this.updateProgress({
          total_pois: pois.length,
          target_goal: targetGoal,
          processed: results.length,
          total_processed_so_far: totalProcessedSoFar,
          remaining_pois: remainingPOIs,
          corrections_applied,
          manual_review_needed,
          errors,
          status: 'needs_retry',
          current_poi: undefined,
          message: `Batch completed. ${remainingPOIs} POIs remaining. Auto-retry scheduled.`
        })

        console.log(`🔄 Batch completed, but goal not reached. ${remainingPOIs} POIs remaining.`)
        console.log(`⏰ Auto-retry will be triggered by monitoring system.`)
      }

      console.log(`✅ Batch processing completed:`)
      console.log(`   Batch processed: ${results.length}`)
      console.log(`   Total processed so far: ${totalProcessedSoFar}/${targetGoal}`)
      console.log(`   Corrections applied: ${corrections_applied}`)
      console.log(`   Manual review needed: ${manual_review_needed}`)
      console.log(`   Errors: ${errors}`)
      console.log(`   Processing time: ${(processing_time / 1000).toFixed(2)}s`)

      return {
        success: true,
        total_processed: results.length,
        corrections_applied,
        manual_review_needed,
        errors,
        processing_time,
        dry_run,
        rate_limiter_status: {
          nominatim: nominatimLimiter.getStatus(),
          geonames: geonamesLimiter.getStatus()
        },
        sample_corrections: results
          .filter(r => r.needs_correction)
          .slice(0, 5)
          .map(r => ({
            poi_name: pois.find(p => p.id === r.poi_id)?.name,
            original_city: r.original_city,
            verified_city: r.verified_city,
            confidence: r.confidence,
            source: r.source
          }))
      }

    } catch (error) {
      console.error('💥 Batch processing failed:', error)
      
      // Update progress with error status
      await this.updateProgress({
        status: 'failed',
        errors: 1
      })

      throw error
    }
  }

  /**
   * Verify and correct a single POI's city information
   */
  private async verifySinglePOI(
    poi: POILocation,
    options: { confidence_threshold: number; enable_cross_validation: boolean }
  ): Promise<CityVerificationResult> {
    
    console.log(`🔍 Verifying city for: ${poi.name} (${poi.city})`)
    
    try {
      // Get data from both sources (but handle errors gracefully)
      const nominatimResult = await NominatimService.reverseGeocode(poi.latitude, poi.longitude)
      
      let geonamesResult = null
      try {
        geonamesResult = await GeoNamesService.findNearbyPlaceName(poi.latitude, poi.longitude)
      } catch (geonamesError) {
        console.log(`⚠️ GeoNames unavailable for ${poi.name}: ${geonamesError.message}`)
      }
      
      // Analyze results
      const analysis = this.analyzeGeocodingResults(
        poi, 
        nominatimResult, 
        geonamesResult, 
        options.enable_cross_validation
      )
      
      // Determine if correction is needed
      const needs_correction = (analysis.confidence >= options.confidence_threshold && 
                              analysis.verified_city && 
                              analysis.verified_city.toLowerCase() !== poi.city.toLowerCase()) ||
                              this.isInvalidCityName(poi.city)
      
      const needs_manual_review = analysis.confidence >= 60 && 
                                 analysis.confidence < options.confidence_threshold
      
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
   * Get POIs that need city correction
   */
  private async getPOIsForCorrection(
    limit: number = 1000,
    country?: string,
    state?: string
  ): Promise<POILocation[]> {
    
    // Build query with JOIN to get coordinates directly
    let query = this.supabase
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
  private analyzeGeocodingResults(
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
    
    // No data from either source - return default structure
    return {
      verified_city: null,
      verified_state: null,
      verified_country: null,
      confidence: 0,
      source: 'no_change'
    }
  }

  /**
   * Check if a city name is clearly invalid and needs correction
   */
  private isInvalidCityName(cityName: string): boolean {
    if (!cityName) return true
    
    const invalidPatterns = [
      /^locality$/i,
      /^administrative$/i,
      /^district$/i,
      /^region$/i,
      /^area$/i,
      /^zone$/i,
      /^undefined$/i,
      /^null$/i,
      /^unknown$/i,
      /^\s*$/  // empty or whitespace only
    ]
    
    return invalidPatterns.some(pattern => pattern.test(cityName.trim()))
  }

  /**
   * Normalize city names for comparison
   */
  private normalizeCity(city: string | null): string {
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
  private async applyCityCorrection(result: CityVerificationResult): Promise<void> {
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
    
    const { error } = await this.supabase
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
  private async createManualReviewRecord(result: CityVerificationResult): Promise<void> {
    // Create a manual review record
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
    
    const { error } = await this.supabase
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

  /**
   * Update processing progress
   */
  private async markAsProcessed(poiId: string, auditData: any): Promise<void> {
    const audit = {
      processed: true,
      processed_at: new Date().toISOString(),
      needs_correction: false,
      needs_manual_review: false,
      ...auditData
    }

    console.log(`🗄️  Updating POI ${poiId} with audit:`, JSON.stringify(audit, null, 2))

    const { data, error } = await this.supabase
      .schema('core')
      .from('attractions')
      .update({
        city_correction_audit: audit
      })
      .eq('id', poiId)

    if (error) {
      console.error(`❌ Error marking POI ${poiId} as processed:`, error)
      throw error
    } else {
      console.log(`✅ Successfully updated POI ${poiId} in database`)
    }
  }

  private async updateProgress(progress: Partial<ProcessingProgress>): Promise<void> {
    try {
      // Get existing progress data to merge
      const { data: existingData } = await this.supabase
        .schema('core')
        .from('city_correction_progress')
        .select('progress_data')
        .eq('progress_key', this.progressKey)
        .single()

      // Merge with existing data
      const mergedProgress = {
        ...(existingData?.progress_data || {}),
        ...progress
      }

      // Store progress in a simple table or use a simple key-value approach
      const progressData = {
        progress_key: this.progressKey,
        progress_data: mergedProgress,
        updated_at: new Date().toISOString()
      }

      // Upsert progress record
      const { error } = await this.supabase
        .schema('core')
        .from('city_correction_progress')
        .upsert(progressData, { onConflict: 'progress_key' })

      if (error) {
        console.error('❌ Error updating progress:', error)
      } else {
        console.log('✅ Progress updated:', JSON.stringify(mergedProgress))
      }
    } catch (error) {
      console.error('❌ Error in updateProgress:', error)
    }
  }
}

// =====================================
// EDGE FUNCTION HANDLER
// =====================================

Deno.serve(async (req) => {
  const startTime = Date.now()
  let progressKey = 'default'
  
  try {
    // CORS headers
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: createSecureHeaders({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
        })
      })
    }

    // ✅ VALIDAR AUTENTICAÇÃO
    const authResult = await validateAuthHeader(req)
    if (!authResult.valid) {
      console.warn(`[City-Correction] ❌ Unauthorized: ${authResult.error}`)
      return new Response(
        JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
        { status: 401, headers: createSecureHeaders({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Content-Type': 'application/json'
        })}
      )
    }
    console.log(`[City-Correction] ✅ Authorized: ${authResult.email}`)

    // ✅ RATE LIMITING CHECK
    const config = RATE_LIMIT_CONFIG['city-correction']
    const rateLimit = checkRateLimit(req, 'city-correction', config.maxRequests, config.windowSeconds)
    if (!rateLimit.allowed) {
      console.warn(`[City-Correction] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
      return createRateLimitResponse(rateLimit, corsHeaders)
    }
    console.log(`[City-Correction] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

    // ✅ VALIDAR REQUEST BODY
    const validation = await validateRequestBody(CityCorrectionSchema, req, 'City-Correction');
    if (!validation.valid) {
        console.warn(`[City-Correction] ❌ Validation failed:`, validation.errors);
        return createValidationErrorResponse(validation.errors!, corsHeaders);
    }
    const requestBody = validation.data!;

    // 📋 INITIALIZE AUDIT LOGGER
    const auditLogger = createAuditLogger('City-Correction');
    const startTime = Date.now();

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SECRET_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Parse request body
    const body = await req.json()
    const {
      action = 'process_batch',
      options = {},
      progress_key = 'default'
    } = body

    progressKey = progress_key
    console.log(`🚀 Edge Function: ${action} (started at ${new Date().toISOString()})`)

    // Initialize service
    const service = new EdgeCityCorrectionService(supabaseClient, progress_key)

    let result
    switch (action) {
      case 'process_batch':
        result = await service.processBatch(options)
        break
        
      case 'process_single':
        result = await service.processSinglePOI(options)
        break
        
      case 'process_continuous':
        result = await service.processContinuous(options)
        break
        
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    const duration = Date.now() - startTime
    console.log(`✅ Edge Function completed successfully in ${duration}ms`)

    return new Response(
      JSON.stringify({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
        duration_ms: duration
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )

  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`💥 Edge Function error after ${duration}ms:`, error)
    
    // Try to mark job as failed if we have a progress_key
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SECRET_KEY') ?? '',
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      )
      
      await supabaseClient
        .schema('core')
        .from('city_correction_progress')
        .update({
          progress_data: {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            failed_at: new Date().toISOString()
          }
        })
        .eq('progress_key', progressKey)
      
      console.log(`✅ Marked job ${progressKey} as failed`)
    } catch (updateError) {
      console.error('❌ Failed to update job status:', updateError)
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        duration_ms: duration
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})
