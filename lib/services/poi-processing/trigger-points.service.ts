/**
 * Trigger Points Service - POI Processing Module
 * 
 * Centralized service for POI trigger points generation and management
 * Extracted from detect/route.ts for modularity and reusability
 * 
 * Features:
 * - Generate trigger points for POIs
 * - Regenerate existing trigger points
 * - Validate trigger point quality
 * - Integration with DescriptionService
 * - OSM boundary detection and analysis
 * - Quality scoring and confidence calculation
 */

import { createClient } from '@supabase/supabase-js'
import { OSMEnrichmentService, type EnrichedPOIData } from './osm-enrichment.service'
import { ProcessingResult, ProcessingStatus, POIData } from './description.service'

// Service role client for database operations - Edge Functions compatible
const getSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: { 
      autoRefreshToken: false, 
      persistSession: false,
      detectSessionInUrl: false // Important for Edge Functions
    }
  })
}

// Lazy initialization for Edge Functions compatibility
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

/**
 * Trigger point data structure
 */
export interface TriggerPoint {
  lat: number
  lng: number
  type: 'primary' | 'secondary' | 'fallback'
  reasoning: string
  confidence: number
  distance_from_poi: number
  expected_bearing: number
  radius_meters: number
  auto_status?: 'approved' | 'review' | 'rejected'
  priority?: number
  score_factors?: Record<string, any>
}

/**
 * Boundary data structure
 */
export interface BoundaryData {
  type: 'polygon' | 'circle'
  coordinates: Array<{lat: number, lng: number}>
  area_m2: number
  perimeter_m: number
  confidence: number
  source: string
}

/**
 * Trigger point generation options
 */
export interface TriggerPointOptions {
  language: string
  gender: string
  use_description_context?: boolean
  boundary_strategy?: 'osm' | 'fallback' | 'hybrid'
  trigger_point_count?: number
  min_distance_meters?: number
  max_distance_meters?: number
  user_id?: string
  request_id?: string
}

/**
 * Trigger point generation result
 */
export interface TriggerPointResult {
  attraction_id: string
  trigger_points: TriggerPoint[]
  boundary: BoundaryData
  confidence_score: number
  processing_metadata: {
    total_points: number
    primary_count: number
    secondary_count: number
    fallback_count: number
    average_confidence: number
    boundary_source: string
    generation_method: string
  }
}

/**
 * Validation result for trigger points
 */
export interface ValidationResult {
  valid: boolean
  issues: string[]
  suggestions: string[]
  quality_score: number
}

/**
 * Landmark information for high-visibility POIs
 */
export interface LandmarkInfo {
  isHighVisibility: boolean
  elevationDiff: number
  maxRange: number
  landmarkType?: string
}

// =====================================
// CORE TRIGGER POINTS SERVICE
// =====================================

export class TriggerPointsService {

  /**
   * Generate trigger points for a POI
   * Main entry point for trigger point generation
   */
  static async generate(
    poiData: POIData, 
    options: TriggerPointOptions
  ): Promise<ProcessingResult<TriggerPointResult>> {
    const startTime = Date.now()
    
    try {
      console.log(`🎯 Generating trigger points for POI: ${poiData.name}`)
      
      // Step 1: OSM Data Enrichment
      const enrichmentResult = await this.enrichPOIData(poiData)
      if (!enrichmentResult.success) {
        return this.createErrorResult('OSM enrichment failed', startTime, options)
      }
      
      // Step 2: Boundary Detection
      const boundaryResult = await this.detectBoundary(poiData, enrichmentResult.data!, options)
      if (!boundaryResult.success) {
        return this.createErrorResult('Boundary detection failed', startTime, options)
      }
      
      // Step 3: Trigger Point Generation
      const triggerPointsResult = await this.generateTriggerPoints(
        poiData, 
        boundaryResult.data!, 
        enrichmentResult.data!, 
        options
      )
      
      // Step 4: Quality Scoring
      const qualityResult = await this.calculateQualityScore(
        triggerPointsResult.data!, 
        boundaryResult.data!, 
        options
      )
      
      // Step 5: Save to Database
      const saveResult = await this.saveTriggerPoints(
        poiData.id!, 
        triggerPointsResult.data!, 
        boundaryResult.data!.source
      )
      
      const processingTime = Date.now() - startTime
      
      console.log(`✅ Trigger points generated successfully: ${triggerPointsResult.data!.length} points`)
      
      return {
        success: true,
        data: {
          attraction_id: poiData.id!,
          trigger_points: triggerPointsResult.data!,
          boundary: boundaryResult.data!,
          confidence_score: qualityResult.data!.overall_score,
          processing_metadata: {
            total_points: triggerPointsResult.data!.length,
            primary_count: triggerPointsResult.data!.filter(tp => tp.type === 'primary').length,
            secondary_count: triggerPointsResult.data!.filter(tp => tp.type === 'secondary').length,
            fallback_count: triggerPointsResult.data!.filter(tp => tp.type === 'fallback').length,
            average_confidence: triggerPointsResult.data!.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPointsResult.data!.length,
            boundary_source: boundaryResult.data!.source,
            generation_method: 'osm_enhanced'
          }
        },
        processing_time: processingTime,
        metadata: {
          step: 'trigger_points_generation',
          status: 'completed',
          quality_score: qualityResult.data!.overall_score,
          user_id: options.user_id,
          request_id: options.request_id,
          timestamp: new Date().toISOString()
        }
      }
      
    } catch (error) {
      console.error(`❌ Error generating trigger points:`, error)
      return this.createErrorResult(`Generation failed: ${error}`, startTime, options)
    }
  }

  /**
   * Regenerate trigger points for an existing POI
   */
  static async regenerate(
    attractionId: string, 
    options: TriggerPointOptions
  ): Promise<ProcessingResult<TriggerPointResult>> {
    const startTime = Date.now()
    
    try {
      console.log(`🔄 Regenerating trigger points for attraction: ${attractionId}`)
      
      // Fetch POI data from database
      const poiData = await this.fetchPOIData(attractionId)
      if (!poiData) {
        return this.createErrorResult('POI not found', startTime, options)
      }
      
      // Generate new trigger points
      return await this.generate(poiData, options)
      
    } catch (error) {
      console.error(`❌ Error regenerating trigger points:`, error)
      return this.createErrorResult(`Regeneration failed: ${error}`, startTime, options)
    }
  }

  /**
   * Validate trigger points quality
   */
  static async validate(triggerPoints: TriggerPoint[]): Promise<ProcessingResult<ValidationResult>> {
    const startTime = Date.now()
    
    try {
      console.log(`🔍 Validating ${triggerPoints.length} trigger points`)
      
      const issues: string[] = []
      const suggestions: string[] = []
      
      // Validation 1: Check spacing between points
      const spacingIssues = this.validateSpacing(triggerPoints)
      issues.push(...spacingIssues)
      
      // Validation 2: Check confidence distribution
      const confidenceIssues = this.validateConfidence(triggerPoints)
      issues.push(...confidenceIssues)
      
      // Validation 3: Check type distribution
      const typeIssues = this.validateTypeDistribution(triggerPoints)
      issues.push(...typeIssues)
      
      // Validation 4: Check distance distribution
      const distanceIssues = this.validateDistanceDistribution(triggerPoints)
      issues.push(...distanceIssues)
      
      // Calculate quality score
      const qualityScore = this.calculateValidationScore(triggerPoints, issues)
      
      // Generate suggestions
      if (issues.length > 0) {
        suggestions.push('Consider regenerating with different parameters')
        suggestions.push('Review boundary detection accuracy')
        suggestions.push('Adjust confidence thresholds')
      }
      
      const processingTime = Date.now() - startTime
      
      return {
        success: true,
        data: {
          valid: issues.length === 0,
          issues,
          suggestions,
          quality_score: qualityScore
        },
        processing_time: processingTime,
        metadata: {
          step: 'trigger_points_validation',
          status: 'completed',
          quality_score: qualityScore,
          timestamp: new Date().toISOString()
        }
      }
      
    } catch (error) {
      console.error(`❌ Error validating trigger points:`, error)
      return this.createErrorResult(`Validation failed: ${error}`, startTime)
    }
  }

  /**
   * Get processing status for a POI
   */
  static async getProcessingStatus(attractionId: string): Promise<ProcessingStatus> {
    try {
      const supabase = getSupabaseAdmin()
      
      // Check if trigger points exist
      const { data: triggerPoints, error } = await supabase
        .schema('core')
        .from('trigger_points')
        .select('id, created_at, updated_at')
        .eq('attraction_id', attractionId)
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (error) {
        throw error
      }
      
      if (triggerPoints && triggerPoints.length > 0) {
        return {
          step: 'trigger_points',
          progress: 100,
          status: 'completed',
          started_at: triggerPoints[0].created_at,
          completed_at: triggerPoints[0].updated_at || triggerPoints[0].created_at
        }
      }
      
      return {
        step: 'trigger_points',
        progress: 0,
        status: 'pending',
        started_at: new Date().toISOString()
      }
      
    } catch (error) {
      console.error(`❌ Error getting processing status:`, error)
      return {
        step: 'trigger_points',
        progress: 0,
        status: 'failed',
        started_at: new Date().toISOString(),
        error: `Status check failed: ${error}`
      }
    }
  }

  // =====================================
  // PRIVATE HELPER METHODS
  // =====================================

  /**
   * Enrich POI data with OSM information
   */
  private static async enrichPOIData(poiData: POIData): Promise<ProcessingResult<EnrichedPOIData>> {
    try {
      // For now, return mock enriched data
      // TODO: Implement actual OSM enrichment
      const mockEnrichedData: EnrichedPOIData = {
        // Mock data structure
      } as EnrichedPOIData
      
      return {
        success: true,
        data: mockEnrichedData,
        processing_time: 0,
        metadata: {
          step: 'osm_enrichment',
          status: 'completed',
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `OSM enrichment failed: ${error}`,
        processing_time: 0,
        metadata: {
          step: 'osm_enrichment',
          status: 'failed',
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Detect boundary for POI using REAL OSM data - NO ASSUMPTIONS
   * Follows exact same strategy as current system
   */
  private static async detectBoundary(
    poiData: POIData, 
    enrichedData: EnrichedPOIData, 
    options: TriggerPointOptions
  ): Promise<ProcessingResult<BoundaryData>> {
    const startTime = Date.now()
    
    try {
      console.log(`🌍 Detecting REAL OSM boundary for: ${poiData.name}`)
      
      // STRATEGY 1: OSM Nominatim search by name (highest confidence)
      console.log('🔍 Strategy 1: OSM Nominatim search by name...')
      const nominatimResult = await this.searchOSMByName(poiData.lat!, poiData.lng!, poiData.name)
      
      if (nominatimResult.success && nominatimResult.boundary) {
        console.log('✅ Found precise boundary from OSM Nominatim')
        return {
          success: true,
          data: {
            ...nominatimResult.boundary,
            source: 'osm_nominatim'
          },
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // STRATEGY 2: OSM Reverse Geocoding (medium confidence)
      console.log('🔍 Strategy 2: OSM Reverse Geocoding...')
      const reverseResult = await this.searchOSMByCoordinates(poiData.lat!, poiData.lng!)
      
      if (reverseResult.success && reverseResult.boundary) {
        console.log('✅ Found boundary from OSM Reverse Geocoding')
        return {
          success: true,
          data: {
            ...reverseResult.boundary,
            source: 'osm_reverse_geocoding'
          },
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // STRATEGY 3: Unified Overpass API (comprehensive search)
      console.log('🔍 Strategy 3: Unified Overpass API search...')
      const overpassResult = await this.queryUnifiedOverpassData(poiData.lat!, poiData.lng!, poiData.name)
      
      if (overpassResult.success && overpassResult.boundary) {
        console.log('✅ Found boundary from Unified Overpass')
        return {
          success: true,
          data: {
            ...overpassResult.boundary,
            source: 'unified_overpass'
          },
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // STRATEGY 4: Fallback Street Analysis (street-based boundary)
      console.log('🔍 Strategy 4: Fallback Street Analysis...')
      const fallbackResult = await this.createFallbackBoundaryFromStreets(poiData.lat!, poiData.lng!, poiData.name)
      
      if (fallbackResult.success && fallbackResult.boundary) {
        console.log('✅ Created boundary from street analysis')
        return {
          success: true,
          data: {
            ...fallbackResult.boundary,
            source: 'fallback_street_analysis'
          },
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'boundary_detection',
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // FINAL FALLBACK: Estimated boundary (as per memory requirement)
      // Memory: "If a POI is not found in OSM, it must use the existing monolith fallback to create a virtual boundary and proceed"
      console.log('⚠️ All OSM strategies failed - using estimated boundary as FINAL fallback (following monolith behavior)')
      const estimatedBoundary = this.createEstimatedBoundary(poiData.lat!, poiData.lng!, poiData.name)
      
      return {
        success: true,
        data: {
          ...estimatedBoundary,
          source: 'estimated_boundary'
        },
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'boundary_detection',
          status: 'completed',
          timestamp: new Date().toISOString()
        }
      }
      
    } catch (error) {
      return {
        success: false,
        error: `Boundary detection failed: ${error}`,
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'boundary_detection',
          status: 'failed',
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Generate trigger points following the correct sequential logic
   */
  private static async generateTriggerPoints(
    poiData: POIData,
    boundary: BoundaryData,
    enrichedData: EnrichedPOIData,
    options: TriggerPointOptions
  ): Promise<ProcessingResult<TriggerPoint[]>> {
    const startTime = Date.now()
    
    try {
      console.log(`🎯 Generating trigger points for: ${poiData.name}`)
      console.log(`📐 Boundary area: ${boundary.area_m2.toLocaleString()}m², perimeter: ${boundary.perimeter_m.toLocaleString()}m`)
      
      // STEP 1: ✅ Boundary already generated (passed as parameter)
      
      // STEP 2-5: Combined street search to reduce API calls and avoid rate limiting
      console.log(`🔍 STEP 2-5: Finding streets with combined query to avoid rate limiting...`)
      
      // STEP 4: Detect POI height for range calculation (do this first)
      console.log(`🏗️ STEP 4: Detecting POI height for range calculation...`)
      const poiHeight = await this.detectPOIHeight(poiData.lat!, poiData.lng!)
      console.log(`📏 POI height: ${poiHeight.height}m (confidence: ${poiHeight.confidence})`)
      
      const heightBasedRange = await this.calculateHeightBasedRange(poiHeight, boundary.area_m2, poiData.lat!, poiData.lng!)
      console.log(`📐 Height-based range: ${heightBasedRange}m`)
      
      // Combined street search (reduces from 2-3 API calls to 1)
      const { boundaryStreets, expandedStreets } = await this.getCombinedStreetData(
        poiData.lat!, 
        poiData.lng!, 
        boundary.coordinates,
        heightBasedRange
      )
      
      console.log(`🗺️ Combined result: ${boundaryStreets.length} boundary streets, ${expandedStreets.length} expanded streets`)
      
      // STEP 3: Add TPs on closest streets to boundary (⚡ LEGACY STRATEGY: visibility checked during generation)
      console.log(`🎯 STEP 3: Adding TPs on closest streets to boundary...`)
      let validTPs: TriggerPoint[] = []
      for (const street of boundaryStreets) {
        const boundaryTPs = await this.addTPsOnStreetNearBoundary(street, boundary.coordinates, poiData)
        validTPs.push(...boundaryTPs) // Already filtered during generation
      }
      console.log(`📍 Added ${validTPs.length} valid TPs near boundary (pre-filtered for visibility)`)
      
      // STEP 5: Add TPs on expanded area streets (⚡ LEGACY STRATEGY: visibility checked during generation)
      console.log(`📡 STEP 5: Adding TPs in expanded area...`)
      for (const street of expandedStreets) {
        const expandedTPs = await this.addTPsOnStreetInRange(street, poiData, heightBasedRange, boundary.coordinates)
        validTPs.push(...expandedTPs) // Already filtered during generation
      }
      console.log(`📍 Total valid TPs after expansion: ${validTPs.length} (all pre-filtered for visibility)`)
      
      // ⚡ LEGACY STRATEGY: Calculate dynamic minPointDistance (exact legacy logic)
      const poiArea = this.calculatePolygonArea(boundary.coordinates)
      let minPointDistance = 50 // Default (LEGACY)
      
      if (poiArea > 1000000) { // Large areas like Ibirapuera - LEGACY VALUES
        minPointDistance = 30 // Closer points OK for large areas
      } else if (poiArea > 100000) { // Medium areas - LEGACY VALUES
        minPointDistance = 40
      } else if (poiArea < 50000) { // Small areas - LEGACY VALUES
        minPointDistance = 60 // Spread out more for small areas
      }
      
      console.log(`📐 LEGACY: Using minPointDistance=${minPointDistance}m for area=${poiArea.toLocaleString()}m²`)
      
      // Remove duplicates using LEGACY algorithm (simple and fast)
      const uniqueTPs = this.removeDuplicatePointsLegacy(validTPs, minPointDistance)
      console.log(`🔄 Removed duplicates: ${validTPs.length} → ${uniqueTPs.length} unique TPs`)
      
      // Final classification
      const finalTPs = this.classifyTriggerPointsByDistance(uniqueTPs, poiData.lat!, poiData.lng!)
      
      console.log(`✅ Generated ${finalTPs.length} final trigger points`)
      console.log(`⚡ LEGACY PERFORMANCE: Visibility checked during generation (much faster!)`)
      
      return {
        success: true,
        data: finalTPs,
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'trigger_points_generation',
          status: 'completed',
          timestamp: new Date().toISOString(),
          // Standard metadata only
        }
      }
      
    } catch (error) {
      return {
        success: false,
        error: `Trigger points generation failed: ${error}`,
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'trigger_points_generation',
          status: 'failed',
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Calculate quality score for trigger points
   */
  private static async calculateQualityScore(
    triggerPoints: TriggerPoint[],
    boundary: BoundaryData,
    options: TriggerPointOptions
  ): Promise<ProcessingResult<{ overall_score: number }>> {
    try {
      // Calculate overall quality score based on multiple factors
      let score = 0
      
      // Factor 1: Number of trigger points (optimal: 3-8)
      const pointCount = triggerPoints.length
      if (pointCount >= 3 && pointCount <= 8) {
        score += 25
      } else if (pointCount > 0) {
        score += Math.max(0, 25 - Math.abs(pointCount - 5) * 5)
      }
      
      // Factor 2: Average confidence
      const avgConfidence = triggerPoints.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPoints.length
      score += avgConfidence * 30
      
      // Factor 3: Type distribution (primary should be present)
      const hasPrimary = triggerPoints.some(tp => tp.type === 'primary')
      if (hasPrimary) score += 20
      
      // Factor 4: Boundary confidence
      score += boundary.confidence * 25
      
      const overallScore = Math.min(100, Math.round(score))
      
      return {
        success: true,
        data: { overall_score: overallScore },
        processing_time: 0,
        metadata: {
          step: 'quality_scoring',
          status: 'completed',
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `Quality scoring failed: ${error}`,
        processing_time: 0,
        metadata: {
          step: 'quality_scoring',
          status: 'failed',
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Save trigger points to database
   */
  private static async saveTriggerPoints(
    attractionId: string,
    triggerPoints: TriggerPoint[],
    boundarySource: string
  ): Promise<ProcessingResult<{ saved: number }>> {
    try {
      const supabase = getSupabaseAdmin()
      
      // Prepare trigger points for database
      const triggerPointsToSave = triggerPoints.map(tp => ({
        attraction_id: attractionId,
        location: `POINT(${tp.lng} ${tp.lat})`,
        radius_meters: tp.radius_meters,
        expected_bearing: tp.expected_bearing,
        bearing_threshold: 30,
        type: tp.type,
        priority: tp.priority || this.getDefaultPriority(tp.type),
        is_active: true,
        confidence_score: tp.confidence,
        auto_status: tp.auto_status || 'review',
        manual_status: 'pending',
        final_status: tp.auto_status || 'pending',
        score_factors: tp.score_factors || {},
        generation_method: 'osm_enhanced',
        boundary_source: boundarySource,
        created_at: new Date().toISOString()
      }))
      
      // Delete existing trigger points for this attraction
      await supabase
        .schema('core')
        .from('trigger_points')
        .delete()
        .eq('attraction_id', attractionId)
      
      // Insert new trigger points
      const { data, error } = await supabase
        .schema('core')
        .from('trigger_points')
        .insert(triggerPointsToSave)
        .select()
      
      if (error) {
        throw error
      }
      
      return {
        success: true,
        data: { saved: data?.length || 0 },
        processing_time: 0,
        metadata: {
          step: 'database_save',
          status: 'completed',
          timestamp: new Date().toISOString()
        }
      }
      
    } catch (error) {
      return {
        success: false,
        error: `Database save failed: ${error}`,
        processing_time: 0,
        metadata: {
          step: 'database_save',
          status: 'failed',
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Fetch POI data from database
   */
  private static async fetchPOIData(attractionId: string): Promise<POIData | null> {
    try {
      const supabase = getSupabaseAdmin()
      
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          city,
          country,
          state,
          attraction_coordinate!left(latitude, longitude)
        `)
        .eq('id', attractionId)
        .single()
      
      if (error || !data) {
        return null
      }
      
      const coordinate = data.attraction_coordinate?.[0]
      if (!coordinate) {
        return null
      }
      
      return {
        id: data.id,
        name: data.name,
        city: data.city,
        country: data.country,
        state: data.state,
        lat: coordinate.latitude,
        lng: coordinate.longitude
      }
      
    } catch (error) {
      console.error(`❌ Error fetching POI data:`, error)
      return null
    }
  }

  /**
   * Get default priority for trigger point type
   */
  private static getDefaultPriority(type: string): number {
    switch (type) {
      case 'primary': return 1
      case 'secondary': return 2
      case 'fallback': return 3
      default: return 2
    }
  }

  /**
   * Create error result
   */
  private static createErrorResult(
    error: string, 
    startTime: number, 
    options?: TriggerPointOptions
  ): ProcessingResult<any> {
    const processingTime = Date.now() - startTime
    
    return {
      success: false,
      error,
      processing_time: processingTime,
      metadata: {
        step: 'trigger_points_generation',
        status: 'failed',
        user_id: options?.user_id,
        request_id: options?.request_id,
        timestamp: new Date().toISOString()
      }
    }
  }

  // =====================================
  // VALIDATION HELPER METHODS
  // =====================================

  /**
   * Validate spacing between trigger points
   */
  private static validateSpacing(triggerPoints: TriggerPoint[]): string[] {
    const issues: string[] = []
    const minSpacing = 60 // meters
    
    for (let i = 0; i < triggerPoints.length; i++) {
      for (let j = i + 1; j < triggerPoints.length; j++) {
        const distance = this.calculateDistance(
          triggerPoints[i].lat, triggerPoints[i].lng,
          triggerPoints[j].lat, triggerPoints[j].lng
        )
        
        if (distance < minSpacing) {
          issues.push(`Trigger points ${i + 1} and ${j + 1} are too close (${Math.round(distance)}m < ${minSpacing}m)`)
        }
      }
    }
    
    return issues
  }

  /**
   * Validate confidence distribution
   */
  private static validateConfidence(triggerPoints: TriggerPoint[]): string[] {
    const issues: string[] = []
    
    const lowConfidence = triggerPoints.filter(tp => tp.confidence < 0.5)
    if (lowConfidence.length > triggerPoints.length * 0.3) {
      issues.push('Too many low-confidence trigger points (>30%)')
    }
    
    return issues
  }

  /**
   * Validate type distribution
   */
  private static validateTypeDistribution(triggerPoints: TriggerPoint[]): string[] {
    const issues: string[] = []
    
    const primaryCount = triggerPoints.filter(tp => tp.type === 'primary').length
    if (primaryCount === 0) {
      issues.push('No primary trigger points found')
    }
    
    if (primaryCount > triggerPoints.length * 0.5) {
      issues.push('Too many primary trigger points (>50%)')
    }
    
    return issues
  }

  /**
   * Validate distance distribution
   */
  private static validateDistanceDistribution(triggerPoints: TriggerPoint[]): string[] {
    const issues: string[] = []
    
    const veryClose = triggerPoints.filter(tp => tp.distance_from_poi < 30)
    const veryFar = triggerPoints.filter(tp => tp.distance_from_poi > 300)
    
    if (veryClose.length > 0) {
      issues.push(`${veryClose.length} trigger points are very close to POI (<30m)`)
    }
    
    if (veryFar.length > triggerPoints.length * 0.3) {
      issues.push('Too many trigger points are very far from POI (>300m)')
    }
    
    return issues
  }

  /**
   * Calculate validation score
   */
  private static calculateValidationScore(triggerPoints: TriggerPoint[], issues: string[]): number {
    let score = 100
    
    // Deduct points for each issue
    score -= issues.length * 10
    
    // Bonus for good distribution
    const primaryCount = triggerPoints.filter(tp => tp.type === 'primary').length
    const avgConfidence = triggerPoints.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPoints.length
    
    if (primaryCount > 0 && primaryCount <= triggerPoints.length * 0.4) score += 10
    if (avgConfidence > 0.7) score += 10
    
    return Math.max(0, Math.min(100, score))
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private static calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000 // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  /**
   * Calculate bearing from point 1 to point 2
   */
  private static calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = (lng2 - lng1) * Math.PI / 180
    const lat1Rad = lat1 * Math.PI / 180
    const lat2Rad = lat2 * Math.PI / 180
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad)
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)
    
    const bearing = Math.atan2(y, x) * 180 / Math.PI
    return (bearing + 360) % 360
  }

  /**
   * Calculate polygon area in square meters
   */
  private static calculatePolygonArea(coordinates: Array<{lat: number, lng: number}>): number {
    let area = 0
    const n = coordinates.length - 1
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      area += coordinates[i].lat * coordinates[j].lng
      area -= coordinates[j].lat * coordinates[i].lng
    }
    
    area = Math.abs(area) / 2
    
    // Convert to meters²
    const metersPerDegree = 111000
    return Math.round(area * metersPerDegree * metersPerDegree)
  }

  /**
   * Search OSM by name using Nominatim - REAL IMPLEMENTATION
   * Extracted from current system
   */
  private static async searchOSMByName(lat: number, lng: number, name: string): Promise<{success: boolean, boundary?: BoundaryData}> {
    try {
      console.log(`🔍 REAL OSM Nominatim search for: ${name} near (${lat}, ${lng})`)
      
      // Create search variations like current system
      const baseSearchTerm = name.toLowerCase().trim()
      const uniqueVariations = Array.from(new Set([
        baseSearchTerm,
        baseSearchTerm.replace(/\s+/g, ' '),
        baseSearchTerm.replace(/[^\w\s]/g, ''),
        baseSearchTerm.split(' ')[0],
        baseSearchTerm.includes(' ') ? baseSearchTerm.split(' ').slice(0, 2).join(' ') : baseSearchTerm
      ]))
      
      console.log(`🔍 Testing ${uniqueVariations.length} name variations`)
      
      for (const searchTerm of uniqueVariations) {
        console.log(`🔍 Searching for: "${searchTerm}"`)
        
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?` +
          `q=${encodeURIComponent(searchTerm)}&` +
          `format=json&` +
          `polygon_geojson=1&` +
          `limit=10&` +
          `viewbox=${lng-0.1},${lat-0.1},${lng+0.1},${lat+0.1}&` +
          `bounded=1&` +
          `addressdetails=1&` +
          `extratags=1`
        
        // Rate limiting for Nominatim
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        const response = await fetch(nominatimUrl, {
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)'
          }
        })
        
        if (!response.ok) {
          console.log(`❌ Nominatim request failed: ${response.status}`)
          continue
        }
        
        const results = await response.json()
        if (results && results.length > 0) {
          console.log(`📊 Nominatim found ${results.length} results for "${searchTerm}"`)
          
          // Score and validate results like current system
          const scoredResults = results
            .map((result: any) => {
              const resultLat = parseFloat(result.lat)
              const resultLng = parseFloat(result.lon)
              const distance = this.calculateDistance(lat, lng, resultLat, resultLng)
              
              // Validation like current system
              const validation = this.validatePOIPolygon(result, searchTerm, lat, lng)
              const isValidDistance = distance <= validation.maxAcceptableDistance
              
              return {
                result,
                score: validation.nameScore * validation.distanceScore * validation.typeScore,
                distance,
                isValidDistance,
                validation
              }
            })
            .filter((item: any) => item.score > 0.3) // Minimum threshold
            .sort((a: any, b: any) => b.score - a.score)
          
          // Try best matches first
          for (const { result, score, distance, isValidDistance } of scoredResults) {
            if (score > 0.3) {
              if (!isValidDistance) {
                console.log(`⚠️ Rejecting "${result.display_name?.split(',')[0]}" - too far (${Math.round(distance)}m)`)
                continue
              }
              
              // Process the geometry
              if (result.geojson && result.geojson.coordinates) {
                const boundary = this.processOSMGeometry(result.geojson, lat, lng)
                if (boundary.success) {
                  console.log(`🎯 Best match: "${result.display_name?.split(',')[0]}" (Score: ${score.toFixed(2)}, Distance: ${Math.round(distance)}m)`)
                  return {
                    success: true,
                    boundary: {
                      type: boundary.boundary!.type,
                      coordinates: boundary.boundary!.coordinates,
                      area_m2: boundary.boundary!.area_m2,
                      perimeter_m: boundary.boundary!.perimeter_m,
                      confidence: Math.min(0.95, score), // Cap at 0.95 for Nominatim
                      source: 'osm_nominatim'
                    }
                  }
                }
              }
            }
          }
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      console.log(`❌ OSM Nominatim search failed: Tested ${uniqueVariations.length} variations, no valid polygons found`)
      return { success: false }
      
    } catch (error) {
      console.error('❌ OSM Nominatim search failed:', error)
      return { success: false }
    }
  }

  /**
   * Validate POI polygon match - REAL IMPLEMENTATION from current system
   */
  private static validatePOIPolygon(result: any, searchTerm: string, poiLat: number, poiLng: number): {
    nameScore: number
    distanceScore: number
    typeScore: number
    maxAcceptableDistance: number
  } {
    const resultLat = parseFloat(result.lat)
    const resultLng = parseFloat(result.lon)
    const distance = this.calculateDistance(poiLat, poiLng, resultLat, resultLng)
    
    // Name matching logic from current system
    let nameScore = 0
    const resultName = result.display_name.toLowerCase()
    const searchName = searchTerm.toLowerCase()
    
    if (resultName.includes(searchName)) nameScore = 1.0
    else if (searchName.includes(resultName.split(',')[0].toLowerCase())) nameScore = 0.8
    else nameScore = 0.3
    
    // Distance score with different thresholds for different POI types
    let distanceScore
    let maxAcceptableDistance
    
    if (searchName.includes('parque') || searchName.includes('park')) {
      // Parks can be larger and further - more lenient distance scoring
      maxAcceptableDistance = 1000
      distanceScore = distance < 500 ? 1.0 : Math.max(0, (1000 - distance) / 1000)
    } else if (searchName.includes('pico') || searchName.includes('morro') || searchName.includes('cristo')) {
      // Landmarks can be even further due to their nature - very lenient scoring
      maxAcceptableDistance = 2000
      distanceScore = distance < 1000 ? 1.0 : Math.max(0, (2000 - distance) / 2000)
    } else {
      // Buildings need to be very close - stricter validation
      maxAcceptableDistance = 200
      distanceScore = distance < 100 ? 1.0 : Math.max(0, (200 - distance) / 200)
    }
    
    // Type relevance scoring from current system
    let typeScore = 1.0
    if (result.type === 'building' || result.category === 'building') typeScore = 1.4
    if (result.osm_type === 'way') typeScore *= 1.1
    if (result.type === 'leisure' || result.category === 'leisure') typeScore = 1.3 // Boost for parks
    if (result.osm_type === 'relation') typeScore *= 1.2 // Relations often represent complex areas
    
    return {
      nameScore,
      distanceScore,
      typeScore,
      maxAcceptableDistance
    }
  }

  /**
   * Process OSM geometry into boundary - REAL IMPLEMENTATION
   */
  private static processOSMGeometry(geojson: any, poiLat: number, poiLng: number): {success: boolean, boundary?: BoundaryData} {
    try {
      if (!geojson || !geojson.coordinates) {
        return { success: false }
      }
      
      let coordinates: Array<{lat: number, lng: number}> = []
      
      // Handle different geometry types
      if (geojson.type === 'Polygon') {
        // Use outer ring
        const ring = geojson.coordinates[0]
        coordinates = ring.map(([lng, lat]: number[]) => ({ lat, lng }))
      } else if (geojson.type === 'MultiPolygon') {
        // Use largest polygon
        let largestPolygon = geojson.coordinates[0][0]
        let maxArea = 0
        
        for (const polygon of geojson.coordinates) {
          const ring = polygon[0]
          const tempCoords = ring.map(([lng, lat]: number[]) => ({ lat, lng }))
          const area = this.calculatePolygonArea(tempCoords)
          if (area > maxArea) {
            maxArea = area
            largestPolygon = ring
          }
        }
        
        coordinates = largestPolygon.map(([lng, lat]: number[]) => ({ lat, lng }))
      } else {
        return { success: false }
      }
      
      // Validate polygon
      if (coordinates.length < 3) {
        return { success: false }
      }
      
      // Calculate metrics
      const area_m2 = this.calculatePolygonArea(coordinates)
      const perimeter_m = this.calculatePolygonPerimeter(coordinates)
      
      // Check if POI is reasonably within or near boundary
      const center = this.calculatePolygonCenter(coordinates)
      const distanceToCenter = this.calculateDistance(poiLat, poiLng, center.lat, center.lng)
      const isInside = this.isPointInPolygon({ lat: poiLat, lng: poiLng }, coordinates)
      
      // Confidence based on geometry quality
      let confidence = 0.8 // Base for real OSM data
      
      if (isInside) confidence += 0.1 // Bonus if POI is inside
      if (area_m2 > 1000 && area_m2 < 10000000) confidence += 0.05 // Reasonable size
      if (distanceToCenter < 100) confidence += 0.05 // Close to center
      
      return {
        success: true,
        boundary: {
          type: 'polygon',
          coordinates,
          area_m2,
          perimeter_m,
          confidence: Math.min(0.95, confidence),
          source: 'osm_geometry'
        }
      }
      
    } catch (error) {
      console.error('❌ Error processing OSM geometry:', error)
      return { success: false }
    }
  }

  /**
   * Search OSM by coordinates using reverse geocoding - REAL IMPLEMENTATION
   */
  private static async searchOSMByCoordinates(lat: number, lng: number): Promise<{success: boolean, boundary?: BoundaryData}> {
    try {
      console.log(`🔍 OSM Reverse Geocoding for: (${lat}, ${lng})`)
      
      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?` +
        `lat=${lat}&lon=${lng}&format=json&polygon_geojson=1&addressdetails=1&zoom=18`
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const response = await fetch(reverseUrl, {
        headers: { 'User-Agent': 'TuggiCMS/1.0 (reverse-geocoding)' }
      })
      
      if (!response.ok) return { success: false }
      
      const result = await response.json()
      if (result?.geojson?.coordinates) {
        const boundary = this.processOSMGeometry(result.geojson, lat, lng)
        if (boundary.success) {
          console.log(`✅ Found boundary via reverse geocoding: ${result.display_name?.split(',')[0] || 'Unknown'}`)
          return {
            success: true,
            boundary: {
              ...boundary.boundary!,
              confidence: 0.85, // Fixed confidence for reverse geocoding
              source: 'osm_reverse_geocoding'
            }
          }
        }
      }
      
      return { success: false }
      
    } catch (error) {
      console.error('❌ OSM reverse geocoding failed:', error)
      return { success: false }
    }
  }

  /**
   * Query unified Overpass data - REAL IMPLEMENTATION
   */
  private static async queryUnifiedOverpassData(lat: number, lng: number, name: string): Promise<{success: boolean, boundary?: BoundaryData}> {
    try {
      console.log(`🔍 Unified Overpass search for: ${name}`)
      
      const query = `[out:json][timeout:120];
      (
        way[leisure~"^(park|recreation_ground|garden|nature_reserve)$"](around:2000,${lat},${lng});
        relation[leisure~"^(park|recreation_ground|garden|nature_reserve)$"](around:2000,${lat},${lng});
        way[tourism](around:1500,${lat},${lng});
        relation[tourism](around:1500,${lat},${lng});
        way[historic](around:1500,${lat},${lng});
        relation[historic](around:1500,${lat},${lng});
        way[amenity](around:1000,${lat},${lng});
        relation[amenity](around:1000,${lat},${lng});
        way[name~"${name.split(' ')[0]}"](around:2000,${lat},${lng});
        relation[name~"${name.split(' ')[0]}"](around:2000,${lat},${lng});
      );
      out geom tags;`
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (unified-search)',
          'Content-Type': 'text/plain'
        }
      })
      
      if (!response.ok) return { success: false }
      
      const data = await response.json()
      if (!data.elements || data.elements.length === 0) return { success: false }
      
      // Process and score polygons
      const allPolygons = []
      
      for (const element of data.elements) {
        if (element.geometry && element.geometry.length >= 3) {
          const coordinates = element.geometry.map((node: any) => ({ lat: node.lat, lng: node.lon }))
          
          // Close polygon
          const first = coordinates[0]
          const last = coordinates[coordinates.length - 1]
          if (first.lat !== last.lat || first.lng !== last.lng) {
            coordinates.push(first)
          }
          
          const center = this.calculatePolygonCenter(coordinates)
          const distance = this.calculateDistance(lat, lng, center.lat, center.lng)
          const area = this.calculatePolygonArea(coordinates)
          
          // Calculate relevance score
          let relevanceScore = 0
          
          if (area > 50000) relevanceScore += 3
          else if (area > 10000) relevanceScore += 2
          else if (area > 1000) relevanceScore += 1
          
          if (distance < 500) relevanceScore += 3
          else if (distance < 1000) relevanceScore += 2
          else if (distance < 1500) relevanceScore += 1
          
          const tags = element.tags || {}
          if (tags.leisure === 'park') relevanceScore += 4
          if (tags.name && tags.name.toLowerCase().includes(name.toLowerCase().split(' ')[0])) relevanceScore += 5
          if (tags.landuse === 'recreation_ground') relevanceScore += 3
          if (tags.tourism) relevanceScore += 3
          if (tags.historic) relevanceScore += 2
          
          allPolygons.push({ coordinates, area, distance, tags, relevanceScore })
        }
      }
      
      if (allPolygons.length === 0) return { success: false }
      
      // Select best polygon by relevance score
      allPolygons.sort((a, b) => b.relevanceScore - a.relevanceScore)
      const bestPolygon = allPolygons[0]
      
      if (bestPolygon.relevanceScore >= 2) {
        return {
          success: true,
          boundary: {
            type: 'polygon',
            coordinates: bestPolygon.coordinates,
            area_m2: bestPolygon.area,
            perimeter_m: this.calculatePolygonPerimeter(bestPolygon.coordinates),
            confidence: Math.min(0.85, bestPolygon.relevanceScore / 10),
            source: 'unified_overpass'
          }
        }
      }
      
      return { success: false }
      
    } catch (error) {
      console.error('❌ Unified Overpass search failed:', error)
      return { success: false }
    }
  }

  /**
   * Create fallback boundary from streets - REAL IMPLEMENTATION
   */
  private static async createFallbackBoundaryFromStreets(lat: number, lng: number, poiName: string): Promise<{success: boolean, boundary?: BoundaryData}> {
    try {
      console.log(`🔄 Fallback street analysis for: ${poiName}`)
      
      // Find immediate streets (50m radius)
      const immediateStreets = await this.findStreetsNearBoundary([], 80) // Fallback for immediate streets
      
      if (!immediateStreets || immediateStreets.length === 0) {
        return { success: false }
      }
      
      // Create minimal boundary (20m radius)
      const boundary = this.createCircularBoundary(lat, lng, 20)
      
      return {
        success: true,
        boundary: {
          ...boundary,
          confidence: 0.65,
          source: 'fallback_street_analysis'
        }
      }
      
    } catch (error) {
      console.error('❌ Fallback street analysis failed:', error)
      return { success: false }
    }
  }

  /**
   * Create circular boundary helper
   */
  private static createCircularBoundary(centerLat: number, centerLng: number, radiusMeters: number): BoundaryData {
    const coordinates: Array<{lat: number, lng: number}> = []
    const numPoints = 16
    
    for (let i = 0; i <= numPoints; i++) {
      const angle = (i * 2 * Math.PI) / numPoints
      const deltaLat = (radiusMeters * Math.cos(angle)) / 111000
      const deltaLng = (radiusMeters * Math.sin(angle)) / (111000 * Math.cos(centerLat * Math.PI / 180))
      
      coordinates.push({
        lat: centerLat + deltaLat,
        lng: centerLng + deltaLng
      })
    }
    
    const area_m2 = Math.PI * radiusMeters * radiusMeters
    const perimeter_m = 2 * Math.PI * radiusMeters
    
    return {
      type: 'circle',
      coordinates,
      area_m2,
      perimeter_m,
      confidence: 0.6,
      source: 'circular_estimation'
    }
  }

  /**
   * Create estimated boundary when OSM boundary not found
   * Uses name-based radius estimation like current system (REAL data-driven approach)
   */
  private static createEstimatedBoundary(lat: number, lng: number, name: string): BoundaryData {
    console.log(`🔧 Creating estimated boundary for: ${name} (FINAL fallback - following monolith behavior)`)
    
    // REAL name-based radius estimation (from current system)
    let radiusMeters = 100 // default 100m
    
    const nameLower = name.toLowerCase()
    if (nameLower.includes('parque') || nameLower.includes('park')) radiusMeters = 200
    else if (nameLower.includes('lago') || nameLower.includes('lake')) radiusMeters = 150
    else if (nameLower.includes('shopping') || nameLower.includes('mall')) radiusMeters = 120
    else if (nameLower.includes('museu') || nameLower.includes('museum')) radiusMeters = 80
    else if (nameLower.includes('igreja') || nameLower.includes('church')) radiusMeters = 50
    
    console.log(`📐 Name-based radius estimation: ${radiusMeters}m (based on "${nameLower}")`)
    
    // Use helper function to create circular boundary
    const boundary = this.createCircularBoundary(lat, lng, radiusMeters)
    
    return {
      ...boundary,
      confidence: 0.4, // LOW confidence for estimated boundary (honest about data quality)
      source: 'estimated_boundary'
    }
  }

  /**
   * Calculate polygon perimeter in meters
   */
  private static calculatePolygonPerimeter(coordinates: Array<{lat: number, lng: number}>): number {
    let perimeter = 0
    
    for (let i = 0; i < coordinates.length - 1; i++) {
      const distance = this.calculateDistance(
        coordinates[i].lat, coordinates[i].lng,
        coordinates[i + 1].lat, coordinates[i + 1].lng
      )
      perimeter += distance
    }
    
    return Math.round(perimeter)
  }

  /**
   * Find nearby streets using Overpass API
   */
  private static async findNearbyStreets(lat: number, lng: number, name: string, landmarkInfo?: LandmarkInfo): Promise<any[]> {
    try {
      console.log('🗺️ Searching for nearby streets with Overpass API...')
      
      // Check if this is a high-visibility landmark
      const landmark = landmarkInfo || await this.checkHighVisibilityLandmark(lat, lng)
      
      // UNIFIED RULES: Same for all POIs, based only on maxRange
      const majorRadius = Math.min(landmark.maxRange * 1.2, 2000) // Unified max 2km
      const mediumRadius = Math.min(landmark.maxRange, 1500) // Unified max 1.5km
      const minorRadius = Math.min(landmark.maxRange * 0.7, 1000) // Unified max 1km
      
      console.log(`🔍 Street search radius: major=${majorRadius}m, medium=${mediumRadius}m, minor=${minorRadius}m`)
      
      // Enhanced Overpass query for external streets
      const overpassQuery = `[out:json][timeout:60];
      (
        // Major highways and roads (priority - further out)
        way[highway~"^(motorway|trunk|primary|secondary)$"](around:${majorRadius},${lat},${lng});
        
        // Tertiary roads (medium distance)
        way[highway~"^(tertiary)$"](around:${mediumRadius},${lat},${lng});
        
        // Residential streets (closer but still external)
        way[highway~"^(residential|living_street)$"](around:${minorRadius},${lat},${lng});
        
        // Named roads that are likely external access routes
        way[highway~"^(trunk|primary|secondary|tertiary|residential)$"][name](around:${mediumRadius},${lat},${lng});
      );
      out geom;`
      
      // Enhanced rate limiting with exponential backoff
      await this.rateLimitedDelay()
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: overpassQuery,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (street-trigger-generation)',
          'Content-Type': 'text/plain'
        }
      })
      
      if (!response.ok) {
        throw new Error(`Overpass API error: ${response.status}`)
      }
      
      const data = await response.json()
      return this.processOverpassStreetData(data, lat, lng, name, landmark)
      
    } catch (error) {
      console.error('❌ Error finding nearby streets:', error)
      return []
    }
  }

  /**
   * Process Overpass API street data
   */
  private static processOverpassStreetData(data: any, lat: number, lng: number, name: string, landmark: LandmarkInfo): any[] {
    console.log(`📊 Overpass found ${data.elements?.length || 0} street elements`)
    
    const streets: any[] = []
    
    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        if (element.geometry && element.geometry.length >= 2) {
          const coordinates = element.geometry.map((node: any) => ({
            lat: node.lat,
            lng: node.lon
          }))
          
          // Calculate distance to POI
          const closestPoint = this.findClosestPointOnStreet(coordinates, lat, lng)
          const distance = this.calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng)
          
          // Filter for external streets only
          const highwayType = element.tags?.highway || 'unknown'
          const isExternalStreet = [
            'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street',
            'pedestrian', 'service', 'footway', 'path', 'track'
          ].includes(highwayType)
          
          if (isExternalStreet && distance >= 15) { // UNIFIED: Minimum 15m from POI for all types
            const streetName = element.tags?.name || 'Unnamed Street'
            const confidence = this.calculateStreetConfidence(element.tags || {}, distance)
            
            streets.push({
              coordinates,
              name: streetName,
              highway_type: highwayType,
              distance_to_poi: distance,
              closestPoint,
              confidence,
              tags: element.tags
            })
          }
        }
      }
    }
    
    // UNIFIED RULES: Same scoring for all POIs
    return streets.sort((a, b) => {
      // Unified scoring: closer and higher confidence first
      const scoreA = a.confidence / (1 + a.distance_to_poi / 100)
      const scoreB = b.confidence / (1 + b.distance_to_poi / 100)
      return scoreB - scoreA
    }).slice(0, 30) // Limit to top 30 streets
  }

  /**
   * Calculate street confidence score
   */
  private static calculateStreetConfidence(tags: any, distance: number): number {
    let confidence = 0.5 // Base confidence
    
    // Highway type bonus
    const highway = tags.highway || 'unknown'
    const highwayBonusMap: Record<string, number> = {
      'motorway': 0.3,
      'trunk': 0.25,
      'primary': 0.2,
      'secondary': 0.15,
      'tertiary': 0.1,
      'residential': 0.05,
      'living_street': 0.05
    }
    const highwayBonus = highwayBonusMap[highway] || 0
    
    confidence += highwayBonus
    
    // Named street bonus
    if (tags.name && tags.name !== 'Unnamed Street') {
      confidence += 0.1
    }
    
    // Distance penalty (closer is better, but not too close)
    if (distance < 50) {
      confidence += 0.1
    } else if (distance > 500) {
      confidence -= (distance - 500) / 5000 // Gradual penalty for distant streets
    }
    
    return Math.max(0.1, Math.min(1.0, confidence))
  }

  /**
   * Find closest point on street to POI
   */
  private static findClosestPointOnStreet(streetCoordinates: Array<{lat: number, lng: number}>, poiLat: number, poiLng: number): {lat: number, lng: number} {
    let closestPoint = streetCoordinates[0]
    let minDistance = this.calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
    
    for (const point of streetCoordinates) {
      const distance = this.calculateDistance(poiLat, poiLng, point.lat, point.lng)
      if (distance < minDistance) {
        minDistance = distance
        closestPoint = point
      }
    }
    
    return closestPoint
  }

  /**
   * Check if POI is a high-visibility landmark using elevation and height
   */
  private static async checkHighVisibilityLandmark(lat: number, lng: number): Promise<LandmarkInfo> {
    try {
      console.log(`🏔️ Checking high-visibility landmark status for ${lat}, ${lng}`)
      
      // Step 1: Check elevation relative to city base
      const [cityBaseElevation, poiElevation] = await Promise.all([
        this.getCityBaseElevation(lat, lng),
        this.getPOIElevation(lat, lng)
      ])
      
      if (poiElevation !== null) {
        const elevationDiff = poiElevation - cityBaseElevation
        console.log(`📏 Elevation analysis: POI=${poiElevation}m, CityBase=${cityBaseElevation}m, Diff=${elevationDiff}m`)
        
        // High visibility if significantly elevated above city base (>200m difference)
        if (elevationDiff > 200) {
          const maxRange = Math.min(Math.sqrt(elevationDiff) * 150, 5000) // Conservative range
          console.log(`🏔️ Significant elevation above city detected: ${elevationDiff}m above base, max range: ${maxRange.toFixed(0)}m`)
          return {
            isHighVisibility: true,
            elevationDiff,
            maxRange,
            landmarkType: 'elevated'
          }
        }
      }
      
      // Step 2: Check POI height and urban density for non-elevated landmarks
      console.log(`📍 No significant elevation found - applying height + urban density logic`)
      
      const [poiHeight, urbanDensity] = await Promise.all([
        this.detectPOIHeight(lat, lng),
        this.detectUrbanDensity(lat, lng)
      ])
      
      console.log(`🏗️ POI height: ${poiHeight.height}m (${poiHeight.category}, confidence: ${poiHeight.confidence})`)
      console.log(`🏙️ Urban density: ${urbanDensity}`)
      
      // Calculate range based on height and urban density
      let maxRange = 1000 // Default range
      if (poiHeight.confidence > 0) {
        maxRange = await this.calculateHeightBasedRange(poiHeight, 1000000, lat, lng) // Use boundary area fallback
        console.log(`🎯 Height-based range: ${maxRange}m (${poiHeight.category} POI in ${urbanDensity} area)`)
      }
      
      // High visibility if very tall building
      const isHighVisibility = poiHeight.category === 'very_high' || 
                              (poiHeight.category === 'high' && urbanDensity !== 'very_dense')
      
      return {
        isHighVisibility,
        elevationDiff: 0,
        maxRange,
        landmarkType: isHighVisibility ? 'tall_building' : 'regular'
      }
      
    } catch (error) {
      console.error('❌ Error checking high-visibility landmark:', error)
      return {
        isHighVisibility: false,
        elevationDiff: 0,
        maxRange: 1000,
        landmarkType: 'regular'
      }
    }
  }

  /**
   * Generate optimal trigger points from boundary (fallback method)
   */
  private static async generateOptimalTriggerPoints(boundary: BoundaryData, poiLat: number, poiLng: number, poiName: string): Promise<TriggerPoint[]> {
    console.log('🎯 Generating optimal trigger points from boundary')
    
    const triggerPoints: TriggerPoint[] = []
    const coordinates = boundary.coordinates
    
    // Strategy: Points along polygon edges, offset outward for street positioning
    for (let i = 0; i < coordinates.length - 1; i += Math.max(1, Math.floor(coordinates.length / 12))) {
      const point = coordinates[i]
      
      // Offset point outward from POI center to position on nearby streets
      const offsetPoint = this.offsetPointFromCenter(point.lat, point.lng, poiLat, poiLng, 75) // 75m offset
      
      const distance = this.calculateDistance(poiLat, poiLng, offsetPoint.lat, offsetPoint.lng)
      const bearing = this.calculateBearing(offsetPoint.lat, offsetPoint.lng, poiLat, poiLng)
      
      // Determine priority based on position
      const type = i < 4 ? 'primary' : i < 8 ? 'secondary' : 'fallback'
      
      triggerPoints.push({
        lat: offsetPoint.lat,
        lng: offsetPoint.lng,
        type,
        reasoning: `Strategic point ${i + 1} based on real OSM boundary`,
        confidence: 0.9,
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 20,
        auto_status: 'review'
      })
    }
    
    return triggerPoints
  }

  /**
   * Generate triggers on streets
   */
  private static async generateTriggersOnStreets(
    poiLat: number, 
    poiLng: number, 
    boundaryCoordinates: Array<{lat: number, lng: number}>, 
    streets: any[],
    landmarkInfo?: LandmarkInfo
  ): Promise<TriggerPoint[]> {
    const triggerPoints: TriggerPoint[] = []
    
    for (const street of streets) {
      // Find strategic points on this street
      const streetPoints = await this.findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo)
      triggerPoints.push(...streetPoints)
    }
    
    // Calculate POI area for dynamic filtering
    const poiArea = this.calculatePolygonArea(boundaryCoordinates)
    
    // UNIFIED RULES: Same for all POIs, based only on area
    const areaBasedMinPointDistance = Math.max(20, Math.sqrt(poiArea) * 0.05) // Scales with area
    const minPointDistance = Math.round(areaBasedMinPointDistance)
    
    // Remove duplicates (points too close to each other) - unified rules
    const duplicateThreshold = minPointDistance
    
    // UNIFIED RULES: Same for all POIs, based only on area
    const areaBasedMaxPoints = Math.min(25, Math.max(8, Math.sqrt(poiArea) / 100)) // Scales with area
    const maxPoints = Math.round(areaBasedMaxPoints)
    
    const filteredPoints = this.removeDuplicatePoints(triggerPoints, duplicateThreshold)
    
    return filteredPoints.slice(0, maxPoints)
  }

  /**
   * Find strategic points on a street
   */
  private static async findStrategicPointsOnStreet(
    street: any, 
    poiLat: number, 
    poiLng: number, 
    boundaryCoordinates: Array<{lat: number, lng: number}>, 
    landmarkInfo?: LandmarkInfo
  ): Promise<TriggerPoint[]> {
    const points: TriggerPoint[] = []
    
    // Find closest point on street to POI
    const closestPoint = this.findClosestPointOnStreet(street.coordinates, poiLat, poiLng)
    const distance = this.calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
    const bearing = this.calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng)
    
    // Check if this point has good visibility to POI
    const hasVisibility = await this.checkVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo)
    
    if (hasVisibility) {
      points.push({
        lat: closestPoint.lat,
        lng: closestPoint.lng,
        type: 'primary',
        reasoning: `Closest point on ${street.name} (${street.highway_type}) with POI visibility`,
        confidence: street.confidence * (hasVisibility ? 1.0 : 0.7),
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 20,
        auto_status: 'review'
      })
    }
    
    return points
  }

  /**
   * Check visibility to POI from point with height awareness
   */
  private static async checkVisibilityToPOI(
    point: {lat: number, lng: number}, 
    boundaryCoordinates: Array<{lat: number, lng: number}>, 
    poiLat: number, 
    poiLng: number, 
    landmarkInfo?: LandmarkInfo
  ): Promise<boolean> {
    const distance = this.calculateDistance(poiLat, poiLng, point.lat, point.lng)
    
    // Calculate POI area to adjust criteria dynamically
    const poiArea = this.calculatePolygonArea(boundaryCoordinates)
    
    // Use POI area to calculate dynamic ranges - UNIFIED FOR ALL POIs
    const areaBasedMinDistance = Math.max(20, Math.sqrt(poiArea) * 0.1) // 20m minimum, scales with area
    const areaBasedMaxDistance = Math.min(3000, Math.sqrt(poiArea) * 2) // Scales with area, max 3km
    const areaBasedBuffer = Math.max(5, Math.sqrt(poiArea) * 0.02) // Buffer scales with area
    
    let minDistance = Math.round(areaBasedMinDistance)
    let maxDistance = Math.round(areaBasedMaxDistance)
    let bufferDistance = Math.round(areaBasedBuffer)
    
    console.log(`📐 UNIFIED RULES - Area: ${poiArea.toLocaleString()}m² → Range: ${minDistance}m-${maxDistance}m, Buffer: ${bufferDistance}m`)
    
    // Must be at proper distance for street positioning
    if (distance < minDistance || distance > maxDistance) return false
    
    // Check if point is inside POI boundary (would mean no external visibility)
    const isInside = this.isPointInPolygon(point, boundaryCoordinates)
    if (isInside) return false
    
    // Additional check: ensure point is not too close to boundary (buffer zone)
    const distanceToBoundary = this.calculateDistanceToPolygon(point, boundaryCoordinates)
    if (distanceToBoundary < bufferDistance) return false
    
    // UNIFIED: Same obstruction check for all POIs (no type-based logic)
    try {
      const hasObstruction = await this.checkBuildingObstructions(point, poiLat, poiLng)
      if (hasObstruction) {
        console.log(`🚫 Trigger point blocked by building obstructions`)
        return false
      }
    } catch (error) {
      console.log('⚠️ Obstruction check failed, allowing trigger point')
      // If obstruction check fails, allow the trigger point
    }
    
    return true
  }

  /**
   * STEP 2: Find streets near boundary perimeter (not POI center)
   */
  private static async findStreetsNearBoundary(
    boundaryCoordinates: Array<{lat: number, lng: number}>, 
    maxDistanceFromBoundary: number
  ): Promise<any[]> {
    try {
      console.log(`🗺️ Searching for streets within ${maxDistanceFromBoundary}m of boundary perimeter...`)
      
      // Calculate boundary bounding box for efficient search
      const bounds = this.calculateBoundingBox(boundaryCoordinates)
      const searchRadius = maxDistanceFromBoundary + 200 // Add buffer for search
      
      // Overpass query to find streets near the boundary area
      const overpassQuery = `[out:json][timeout:60];
      (
        // All types of roads within expanded bounding box
        way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian|service|footway|path|track)$"](around:${searchRadius},${bounds.center.lat},${bounds.center.lng});
      );
      out geom;`
      
      await this.rateLimitedDelay() // Enhanced rate limiting
      
      const response = await this.retryOverpassCall('https://overpass-api.de/api/interpreter', overpassQuery)
      
      const data = await response.json()
      return this.filterStreetsByBoundaryDistance(data, boundaryCoordinates, maxDistanceFromBoundary)
      
    } catch (error) {
      console.error('❌ Error finding streets near boundary:', error)
      return []
    }
  }

  /**
   * Filter streets by distance to boundary perimeter
   */
  private static filterStreetsByBoundaryDistance(
    overpassData: any, 
    boundaryCoordinates: Array<{lat: number, lng: number}>, 
    maxDistance: number
  ): any[] {
    const streets: any[] = []
    
    if (overpassData.elements && overpassData.elements.length > 0) {
      for (const element of overpassData.elements) {
        if (element.geometry && element.geometry.length >= 2) {
          const streetCoordinates = element.geometry.map((node: any) => ({
            lat: node.lat,
            lng: node.lon
          }))
          
          // Find minimum distance from street to boundary perimeter
          const minDistanceToBoundary = this.calculateMinDistanceToPolygon(streetCoordinates, boundaryCoordinates)
          
          if (minDistanceToBoundary <= maxDistance) {
            const streetName = element.tags?.name || 'Unnamed Street'
            const highwayType = element.tags?.highway || 'unknown'
            
            streets.push({
              coordinates: streetCoordinates,
              name: streetName,
              highway_type: highwayType,
              distance_to_boundary: minDistanceToBoundary,
              confidence: this.calculateStreetConfidence(element.tags || {}, minDistanceToBoundary),
              tags: element.tags,
              osm_id: element.id
            })
          }
        }
      }
    }
    
    // Sort by distance to boundary (closest first)
    return streets.sort((a, b) => a.distance_to_boundary - b.distance_to_boundary)
  }

  /**
   * Calculate minimum distance from street points to polygon boundary
   */
  private static calculateMinDistanceToPolygon(
    streetCoordinates: Array<{lat: number, lng: number}>, 
    polygonCoordinates: Array<{lat: number, lng: number}>
  ): number {
    let minDistance = Infinity
    
    for (const streetPoint of streetCoordinates) {
      const distance = this.calculateDistanceToPolygon(streetPoint, polygonCoordinates)
      if (distance < minDistance) {
        minDistance = distance
      }
    }
    
    return minDistance
  }

  /**
   * STEP 3: Add TPs on streets near boundary
   */
  private static async addTPsOnStreetNearBoundary(
    street: any,
    boundaryCoordinates: Array<{lat: number, lng: number}>,
    poiData: POIData
  ): Promise<TriggerPoint[]> {
    // ⚡ LEGACY STRATEGY: Use findStrategicPointsOnStreet (EXACT REPLICA)
    return this.findStrategicPointsOnStreetLegacy(street, poiData.lat!, poiData.lng!, boundaryCoordinates)
  }

  /**
   * STEP 5: Find streets in expanded area based on POI height
   */
  private static async findStreetsInExpandedArea(
    poiLat: number,
    poiLng: number,
    heightBasedRange: number,
    excludeStreets: any[]
  ): Promise<any[]> {
    try {
      console.log(`🗺️ Searching for streets within ${heightBasedRange}m range...`)
      
      // Overpass query for expanded area
      const overpassQuery = `[out:json][timeout:60];
      (
        // Focus on major roads for expanded area
        way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street)$"](around:${heightBasedRange},${poiLat},${poiLng});
      );
      out geom;`
      
      await this.rateLimitedDelay() // Enhanced rate limiting
      
      const response = await this.retryOverpassCall('https://overpass-api.de/api/interpreter', overpassQuery)
      
      const data = await response.json()
      const expandedStreets = this.processExpandedAreaStreets(data, poiLat, poiLng, heightBasedRange)
      
      // Filter out streets already processed in boundary search
      const excludeIds = new Set(excludeStreets.map(s => s.osm_id))
      return expandedStreets.filter(street => !excludeIds.has(street.osm_id))
      
    } catch (error) {
      console.error('❌ Error finding streets in expanded area:', error)
      return []
    }
  }

  /**
   * Process streets found in expanded area
   */
  private static processExpandedAreaStreets(data: any, poiLat: number, poiLng: number, maxRange: number): any[] {
    const streets: any[] = []
    
    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        if (element.geometry && element.geometry.length >= 2) {
          const streetCoordinates = element.geometry.map((node: any) => ({
            lat: node.lat,
            lng: node.lon
          }))
          
          // Find closest point on street to POI
          const closestPoint = this.findClosestPointOnStreet(streetCoordinates, poiLat, poiLng)
          const distance = this.calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
          
          if (distance <= maxRange) {
            const streetName = element.tags?.name || 'Unnamed Street'
            const highwayType = element.tags?.highway || 'unknown'
            
            streets.push({
              coordinates: streetCoordinates,
              name: streetName,
              highway_type: highwayType,
              distance_to_poi: distance,
              closest_point: closestPoint,
              confidence: this.calculateStreetConfidence(element.tags || {}, distance),
              tags: element.tags,
              osm_id: element.id
            })
          }
        }
      }
    }
    
    // Sort by distance to POI (closest first)
    return streets.sort((a, b) => a.distance_to_poi - b.distance_to_poi)
  }

  /**
   * Add TPs on street within height-based range
   */
  private static async addTPsOnStreetInRange(
    street: any,
    poiData: POIData,
    maxRange: number,
    boundaryCoordinates?: Array<{lat: number, lng: number}>
  ): Promise<TriggerPoint[]> {
    if (street.closest_point && street.distance_to_poi <= maxRange && boundaryCoordinates) {
      // ⚡ LEGACY STRATEGY: Use full strategic point finding
      return this.findStrategicPointsOnStreetLegacy(street, poiData.lat!, poiData.lng!, boundaryCoordinates)
    }
    
    return []
  }

  /**
   * STEP 4: Calculate height-based range for POI visibility (⚡ LEGACY LOGIC)
   */
  private static async calculateHeightBasedRange(poiHeight: any, boundaryArea: number, poiLat: number, poiLng: number): Promise<number> {
    // ⚡ LEGACY: Check if this is a high-visibility landmark first
    const landmark = await this.checkHighVisibilityLandmarkLegacy(poiLat, poiLng, 0)
    
    if (landmark.isHighVisibility) {
      console.log(`🏔️ Using landmark-based range: ${landmark.maxRange}m`)
      return landmark.maxRange
    }
    
    // ⚡ LEGACY: Use height + urban density if we have real height data
    if (poiHeight.confidence > 0) {
      const urbanDensity = await this.detectUrbanDensityLegacy(poiLat, poiLng)
      const heightBasedRange = this.calculateHeightBasedRangeLegacy(poiHeight, urbanDensity)
      console.log(`📐 Using height-based range: ${heightBasedRange}m (LEGACY logic)`)
      return heightBasedRange
    }
    
    // ⚡ LEGACY: Fallback to urban density only
    const urbanDensity = await this.detectUrbanDensityLegacy(poiLat, poiLng)
    const baseRanges = {
      'very_dense': 150,
      'dense': 250,
      'medium': 400,
      'low': 600,
      'rural': 800
    }
    
    const fallbackRange = baseRanges[urbanDensity]
    console.log(`📐 Using urban density fallback range: ${fallbackRange}m (${urbanDensity})`)
    return fallbackRange
  }

  /**
   * ⚡ LEGACY: Strategic Points on Street (EXACT REPLICA)
   */
  private static async findStrategicPointsOnStreetLegacy(
    street: any, 
    poiLat: number, 
    poiLng: number, 
    boundaryCoordinates: Array<{lat: number, lng: number}>
  ): Promise<TriggerPoint[]> {
    const points: TriggerPoint[] = []
    
    // Strategy 1: Find closest point on street to POI (LEGACY)
    const closestPoint = this.findClosestPointOnStreet(street.coordinates, poiLat, poiLng)
    const distance = this.calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
    const bearing = this.calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng)
    
    // Check if this point has good visibility to POI (LEGACY)
    const hasVisibility = await this.checkLegacyVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng)
    
    if (distance > 1000) {
      console.log(`🔍 Distant street point: ${street.name} at ${distance.toFixed(0)}m - visibility: ${hasVisibility}`)
    }
    
    // Dynamic distance check (LEGACY LOGIC)
    if (hasVisibility) { // Let checkLegacyVisibilityToPOI handle distance validation
      points.push({
        lat: closestPoint.lat,
        lng: closestPoint.lng,
        type: 'primary',
        reasoning: `Ponto mais próximo na ${street.name} (${street.highway_type}) com visibilidade do POI`,
        confidence: street.confidence * 1.0,
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 20,
        auto_status: 'review'
      })
    }

    // Strategy 2: Find points at street intersections (LEGACY)
    const intersectionPoints = this.findIntersectionPointsLegacy(street.coordinates)
    for (const intersection of intersectionPoints) {
      const intDistance = this.calculateDistance(poiLat, poiLng, intersection.lat, intersection.lng)
      const intBearing = this.calculateBearing(intersection.lat, intersection.lng, poiLat, poiLng)
      const intVisibility = await this.checkLegacyVisibilityToPOI(intersection, boundaryCoordinates, poiLat, poiLng)
      
      if (intVisibility) {
        points.push({
          lat: intersection.lat,
          lng: intersection.lng,
          type: 'secondary',
          reasoning: `Cruzamento na ${street.name} com boa visibilidade`,
          confidence: street.confidence * 0.9,
          distance_from_poi: intDistance,
          expected_bearing: intBearing,
          radius_meters: 20,
          auto_status: 'review'
        })
      }
    }
    
    return points
  }

  /**
   * ⚡ LEGACY: Find intersection points on street
   */
  private static findIntersectionPointsLegacy(coordinates: Array<{lat: number, lng: number}>): Array<{lat: number, lng: number}> {
    const intersections: Array<{lat: number, lng: number}> = []
    
    // Look for direction changes that might indicate intersections
    for (let i = 1; i < coordinates.length - 1; i++) {
      const prev = coordinates[i - 1]
      const curr = coordinates[i]
      const next = coordinates[i + 1]
      
      // Calculate bearing changes
      const bearing1 = this.calculateBearing(prev.lat, prev.lng, curr.lat, curr.lng)
      const bearing2 = this.calculateBearing(curr.lat, curr.lng, next.lat, next.lng)
      const bearingDiff = Math.abs(bearing1 - bearing2)
      
      // If significant direction change, likely an intersection
      if (bearingDiff > 30 && bearingDiff < 330) {
        intersections.push(curr)
      }
    }
    
    return intersections
  }

  /**
   * ⚡ LEGACY: Check if POI is a high-visibility landmark (EXACT REPLICA)
   */
  private static async checkHighVisibilityLandmarkLegacy(
    poiLat: number, 
    poiLng: number, 
    currentDistance: number
  ): Promise<{ isHighVisibility: boolean, maxRange: number, elevationDiff: number }> {
    console.log(`🔍 Checking landmark for coordinates: ${poiLat}, ${poiLng}`)
    
    // Known high-elevation landmarks with their elevations (only truly high landmarks)
    const knownLandmarks = [
      { name: 'cristo redentor', lat: -22.9519, lng: -43.2105, radius: 1000, elevation: 710, baseElevation: 10 }, // Rio sea level
      { name: 'pão de açúcar', lat: -22.9487, lng: -43.1566, radius: 1000, elevation: 396, baseElevation: 10 },
      { name: 'corcovado', lat: -22.9519, lng: -43.2105, radius: 1000, elevation: 710, baseElevation: 10 },
      { name: 'pico do jaraguá', lat: -23.4561, lng: -46.7677, radius: 1000, elevation: 1135, baseElevation: 760 }, // SP elevation
      { name: 'jaraguá', lat: -23.4561, lng: -46.7677, radius: 1000, elevation: 1135, baseElevation: 760 },
    ]
    
    // Check if current POI matches known landmarks
    for (const landmark of knownLandmarks) {
      const distance = this.calculateDistance(poiLat, poiLng, landmark.lat, landmark.lng)
      console.log(`🔍 Checking ${landmark.name}: distance = ${distance.toFixed(2)}m (radius: ${landmark.radius}m)`)
      if (distance < landmark.radius) {
        const elevationDiff = landmark.elevation - landmark.baseElevation
        const theoreticalRange = Math.sqrt(elevationDiff) * 200 // Conservative multiplier
        const maxRange = Math.min(Math.max(theoreticalRange, 2000), 8000) // Between 2km-8km
        
        console.log(`🗿 Detected ${landmark.name}: ${landmark.elevation}m elevation, ${elevationDiff}m above base, max range: ${maxRange.toFixed(0)}m`)
        return { isHighVisibility: true, maxRange, elevationDiff }
      }
    }
    
    // For now, simplified approach: no elevation API calls (avoiding 429 errors)
    // Get POI height and urban density for height-based range
    const [poiHeight, urbanDensity] = await Promise.all([
      this.detectPOIHeightLegacy(poiLat, poiLng),
      this.detectUrbanDensityLegacy(poiLat, poiLng)
    ])
    
    console.log(`🏗️ POI height: ${poiHeight.height}m (${poiHeight.category}, confidence: ${poiHeight.confidence})`)
    console.log(`🏙️ Urban density: ${urbanDensity}`)
    
    // Only use height-based range if we have REAL data (confidence > 0)
    let maxRange = 1000 // Default range
    if (poiHeight.confidence > 0) {
      maxRange = this.calculateHeightBasedRangeLegacy(poiHeight, urbanDensity)
      console.log(`📐 Using height-based range: ${maxRange}m (based on REAL data)`)
    } else {
      console.log(`📐 Using default range: ${maxRange}m (no real height data available)`)
    }
    
    return { isHighVisibility: false, maxRange, elevationDiff: 0 }
  }

  /**
   * ⚡ LEGACY: Detect POI height (SIMPLIFIED - avoiding API calls)
   */
  private static async detectPOIHeightLegacy(
    lat: number, 
    lng: number
  ): Promise<{ height: number, category: 'low' | 'medium' | 'high' | 'very_high', confidence: number }> {
    // Simplified approach: no real height data search to avoid API overload
    console.log('❌ NO REAL HEIGHT DATA found in OSM for this location (simplified approach)')
    return { 
      height: 0, 
      category: 'low', 
      confidence: 0.0 // Zero confidence = no real data
    }
  }

  /**
   * ⚡ LEGACY: Detect urban density (SIMPLIFIED - avoiding API calls)
   */
  private static async detectUrbanDensityLegacy(
    lat: number, 
    lng: number
  ): Promise<'very_dense' | 'dense' | 'medium' | 'low' | 'rural'> {
    // Simplified approach: assume medium density to avoid additional API calls
    console.log('📍 Using medium density (simplified approach to avoid API overload)')
    return 'medium'
  }

  /**
   * ⚡ LEGACY: Calculate height-based range (EXACT REPLICA)
   */
  private static calculateHeightBasedRangeLegacy(
    poiHeight: { height: number, category: 'low' | 'medium' | 'high' | 'very_high', confidence: number },
    urbanDensity: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural'
  ): number {
    // Base ranges by urban density (for ground-level POIs)
    const baseRanges = {
      'very_dense': 150,  // Very dense cities - close TPs only
      'dense': 250,       // Dense cities  
      'medium': 400,      // Medium density
      'low': 600,         // Low density
      'rural': 800        // Rural areas
    }
    
    const baseRange = baseRanges[urbanDensity]
    
    // Height multipliers - taller POIs can be seen over obstacles
    let heightMultiplier = 1.0
    
    switch (poiHeight.category) {
      case 'low': // < 20m - ground level, blocked by most buildings
        heightMultiplier = 1.0
        console.log(`🏠 Low POI (${poiHeight.height}m) - no height advantage`)
        break
        
      case 'medium': // 20-50m - can see over 1-2 story buildings
        if (urbanDensity === 'very_dense' || urbanDensity === 'dense') {
          heightMultiplier = 1.3 // Modest increase in dense areas
        } else {
          heightMultiplier = 1.5 // Better visibility in less dense areas
        }
        console.log(`🏢 Medium POI (${poiHeight.height}m) - can see over low buildings (${heightMultiplier}x)`)
        break
        
      case 'high': // 50-100m - can see over most residential buildings
        if (urbanDensity === 'very_dense') {
          heightMultiplier = 1.5 // Still limited by other tall buildings
        } else if (urbanDensity === 'dense') {
          heightMultiplier = 2.0 // Good visibility over most buildings
        } else {
          heightMultiplier = 2.5 // Excellent visibility in less dense areas
        }
        console.log(`🏗️ High POI (${poiHeight.height}m) - can see over most buildings (${heightMultiplier}x)`)
        break
        
      case 'very_high': // > 100m - landmark status, visible from far
        if (urbanDensity === 'very_dense') {
          heightMultiplier = 2.0 // Limited by other skyscrapers
        } else {
          heightMultiplier = 3.0 // True landmark visibility
        }
        console.log(`🏙️ Very High POI (${poiHeight.height}m) - landmark visibility (${heightMultiplier}x)`)
        break
    }
    
    // Apply confidence factor - lower confidence = more conservative range
    const confidenceFactor = 0.5 + (poiHeight.confidence * 0.5) // 0.5 to 1.0
    
    const finalRange = Math.round(baseRange * heightMultiplier * confidenceFactor)
    
    // Cap ranges to reasonable limits
    const cappedRange = Math.min(Math.max(finalRange, 100), 1500)
    
    console.log(`📊 Range calculation: base=${baseRange}m × height=${heightMultiplier}x × confidence=${confidenceFactor.toFixed(2)} = ${finalRange}m (capped: ${cappedRange}m)`)
    
    return cappedRange
  }

  /**
   * ⚡ LEGACY VISIBILITY CHECK: Replicates exact logic from legacy code
   */
  private static async checkLegacyVisibilityToPOI(
    point: {lat: number, lng: number}, 
    boundaryCoordinates: Array<{lat: number, lng: number}>, 
    poiLat: number, 
    poiLng: number
  ): Promise<boolean> {
    // Enhanced visibility check for street-based trigger points
    const distance = this.calculateDistance(poiLat, poiLng, point.lat, point.lng)
    
    // Calculate POI area to adjust criteria dynamically
    const poiArea = this.calculatePolygonArea(boundaryCoordinates)
    
    // ⚡ LEGACY: Check if this is a high-visibility landmark
    const landmark = await this.checkHighVisibilityLandmarkLegacy(poiLat, poiLng, distance)
    
    // ⚡ LEGACY: Dynamic distance limits based on POI size and elevation
    let minDistance = 80
    let maxDistance = 800
    let bufferDistance = 20
    
    if (landmark.isHighVisibility) { // High elevation landmarks
      minDistance = 300  // Much further minimum distance for elevated POIs
      maxDistance = landmark.maxRange // Dynamic range based on elevation
      bufferDistance = 10
      console.log(`🏔️ High-visibility landmark detected - extended range: ${minDistance}m-${maxDistance}m (elevation diff: ${landmark.elevationDiff}m)`)
    } else if (poiArea > 1000000) { // Large areas like Ibirapuera (>1M m²)
      minDistance = 50
      maxDistance = 1200
      bufferDistance = 15
    } else if (poiArea > 100000) { // Medium areas (>100k m²)
      minDistance = 60
      maxDistance = 1000
      bufferDistance = 18
    } else if (poiArea > 10000) { // Small areas (>10k m²)
      minDistance = 80
      maxDistance = 800
      bufferDistance = 25
    } else { // Very small areas (buildings)
      minDistance = 100
      maxDistance = 600
      bufferDistance = 30
    }
    
    // Must be at proper distance for street positioning  
    if (distance < minDistance || distance > maxDistance) return false
    
    // Check if point is inside POI boundary (would mean no external visibility)
    const isInside = this.isPointInPolygon(point, boundaryCoordinates)
    if (isInside) return false
    
    // Additional check: ensure point is not too close to boundary (buffer zone)
    const distanceToBoundary = this.calculateDistanceToPolygon(point, boundaryCoordinates)
    if (distanceToBoundary < bufferDistance) return false
    
    // ⚡ LEGACY: For urban areas (small POIs), check for building obstructions
    // Skip obstruction check for high-visibility landmarks
    if (poiArea < 100000 && !landmark.isHighVisibility) { // Only for very small POIs in dense urban areas, excluding landmarks
      try {
        const hasObstruction = await this.checkBuildingObstructions(point, poiLat, poiLng)
        if (hasObstruction) {
          console.log(`🚫 Trigger point blocked by building obstructions`)
          return false
        }
      } catch (error) {
        console.log('⚠️ Obstruction check failed, allowing trigger point')
        // If obstruction check fails, allow the trigger point
      }
    } else if (landmark.isHighVisibility) {
      console.log(`🏔️ Skipping building obstruction check for high-visibility landmark`)
    }
    
    return true
  }

  /**
   * ⚡ EARLY FILTER: Validate TP candidate before expensive checks
   */
  private static isValidTPCandidate(
    triggerPoint: TriggerPoint, 
    boundaryCoordinates: Array<{lat: number, lng: number}>
  ): boolean {
    // 1. Distance check (reasonable limits)
    if (triggerPoint.distance_from_poi < 20 || triggerPoint.distance_from_poi > 5000) {
      return false
    }
    
    // 2. Inside boundary check (already done in generation, but double-check)
    const isInside = this.isPointInPolygon(triggerPoint, boundaryCoordinates)
    if (isInside) {
      return false
    }
    
    // 3. Confidence check (minimum quality threshold)
    if (triggerPoint.confidence < 0.1) {
      return false
    }
    
    // 4. Valid coordinates check
    if (!triggerPoint.lat || !triggerPoint.lng || 
        Math.abs(triggerPoint.lat) > 90 || Math.abs(triggerPoint.lng) > 180) {
      return false
    }
    
    return true
  }

  /**
   * STEP 6: Check visibility from TP to POI with height awareness
   */
  private static async checkTPVisibilityToPOI(
    triggerPoint: TriggerPoint,
    poiData: POIData,
    boundaryCoordinates: Array<{lat: number, lng: number}>,
    poiHeight: any
  ): Promise<boolean> {
    // ⚡ NOTE: Basic checks (distance, boundary, coordinates) already done in isValidTPCandidate
    
    // Only perform expensive checks here: Building obstruction analysis
    if (poiHeight.confidence > 0) {
      try {
        const hasObstruction = await this.checkBuildingObstructions(triggerPoint, poiData.lat!, poiData.lng!)
        if (hasObstruction) {
          return false
        }
      } catch (error) {
        // If obstruction check fails, allow the point (conservative approach)
        console.log(`⚠️ Obstruction check failed for TP at (${triggerPoint.lat}, ${triggerPoint.lng}), allowing point`)
      }
    }
    
    return true
  }

  /**
   * Classify trigger points by distance instead of street type
   */
  private static classifyTriggerPointsByDistance(
    triggerPoints: TriggerPoint[],
    poiLat: number,
    poiLng: number
  ): TriggerPoint[] {
    return triggerPoints.map(tp => {
      // Reclassify based on distance
      if (tp.distance_from_poi <= 200) {
        tp.type = 'primary'
      } else if (tp.distance_from_poi <= 800) {
        tp.type = 'secondary'
      } else {
        tp.type = 'secondary' // Keep as secondary for far distances
      }
      
      return tp
    })
  }

  // =====================================
  // RATE LIMITING AND RETRY LOGIC
  // =====================================
  
  private static overpassRequestCount = 0
  private static lastOverpassRequest = 0
  
  /**
   * Enhanced rate limiting with exponential backoff
   */
  private static async rateLimitedDelay(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastOverpassRequest
    
    // Base delay: 2 seconds between requests
    let baseDelay = 2000
    
    // Exponential backoff based on request count
    if (this.overpassRequestCount > 5) {
      baseDelay = 5000 // 5 seconds after 5 requests
    }
    if (this.overpassRequestCount > 10) {
      baseDelay = 10000 // 10 seconds after 10 requests
    }
    if (this.overpassRequestCount > 15) {
      baseDelay = 20000 // 20 seconds after 15 requests
    }
    
    // Ensure minimum delay between requests
    if (timeSinceLastRequest < baseDelay) {
      const waitTime = baseDelay - timeSinceLastRequest
      console.log(`⏱️ Rate limiting: waiting ${waitTime}ms (request #${this.overpassRequestCount + 1})`)
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
    
    this.overpassRequestCount++
    this.lastOverpassRequest = Date.now()
    
    // Reset counter after 5 minutes of inactivity
    if (this.overpassRequestCount > 0 && timeSinceLastRequest > 300000) {
      console.log('🔄 Resetting rate limit counter after 5 minutes of inactivity')
      this.overpassRequestCount = 0
    }
  }
  
  /**
   * Retry Overpass API call with exponential backoff
   */
  private static async retryOverpassCall(
    url: string, 
    query: string, 
    maxRetries: number = 3
  ): Promise<Response> {
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimitedDelay()
        
        const response = await fetch(url, {
          method: 'POST',
          body: query,
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (poi-processing)',
            'Content-Type': 'text/plain'
          }
        })
        
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 2000
          
          console.log(`⚠️ Rate limited (429) on attempt ${attempt}/${maxRetries}. Waiting ${waitTime}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
          
          if (attempt === maxRetries) {
            throw new Error(`Rate limited after ${maxRetries} attempts`)
          }
          continue
        }
        
        if (!response.ok) {
          throw new Error(`Overpass API error: ${response.status} ${response.statusText}`)
        }
        
        // Success - reset counter
        if (attempt > 1) {
          console.log(`✅ Overpass call succeeded on attempt ${attempt}`)
        }
        return response
        
      } catch (error) {
        lastError = error as Error
        
        if (attempt === maxRetries) {
          console.error(`❌ Overpass call failed after ${maxRetries} attempts:`, error)
          throw lastError
        }
        
        const waitTime = Math.pow(2, attempt) * 1000 // Exponential backoff
        console.log(`⚠️ Attempt ${attempt} failed, retrying in ${waitTime}ms...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
    
    throw lastError || new Error('Overpass call failed')
  }
  
  /**
   * Combined Overpass query to reduce API calls
   */
  private static async getCombinedStreetData(
    lat: number, 
    lng: number, 
    boundaryCoordinates: Array<{lat: number, lng: number}>,
    heightBasedRange: number
  ): Promise<{boundaryStreets: any[], expandedStreets: any[]}> {
    try {
      console.log('🔄 Making combined Overpass query to reduce API calls...')
      
      // Calculate boundary bounding box
      const bounds = this.calculateBoundingBox(boundaryCoordinates)
      const boundaryRadius = 100 // 100m from boundary
      const searchRadius = Math.max(boundaryRadius + 200, heightBasedRange + 200)
      
      // Combined query for both boundary streets and expanded area streets
      const combinedQuery = `[out:json][timeout:90];
      (
        // Streets near boundary (priority)
        way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian|service|footway|path|track)$"](around:${boundaryRadius + 200},${bounds.center.lat},${bounds.center.lng});
        
        // Streets in expanded area
        way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street)$"](around:${searchRadius},${lat},${lng});
      );
      out geom;`
      
      const response = await this.retryOverpassCall('https://overpass-api.de/api/interpreter', combinedQuery)
      const data = await response.json()
      
      // Process and separate results
      const boundaryStreets = this.filterStreetsByBoundaryDistance(data, boundaryCoordinates, boundaryRadius)
      const expandedStreets = this.processExpandedAreaStreets(data, lat, lng, heightBasedRange)
      
      // Remove duplicates between boundary and expanded streets
      const boundaryIds = new Set(boundaryStreets.map(s => s.osm_id))
      const filteredExpandedStreets = expandedStreets.filter(street => !boundaryIds.has(street.osm_id))
      
      console.log(`📊 Combined query result: ${boundaryStreets.length} boundary streets, ${filteredExpandedStreets.length} expanded streets`)
      
      return {
        boundaryStreets,
        expandedStreets: filteredExpandedStreets
      }
      
    } catch (error) {
      console.error('❌ Combined Overpass query failed, falling back to separate calls:', error)
      
      // Fallback to original separate calls with longer delays
      await new Promise(resolve => setTimeout(resolve, 5000)) // 5 second delay
      
      const boundaryStreets = await this.findStreetsNearBoundary(boundaryCoordinates, 100)
      
      await new Promise(resolve => setTimeout(resolve, 5000)) // Another 5 second delay
      
      const expandedStreets = await this.findStreetsInExpandedArea(lat, lng, heightBasedRange, boundaryStreets)
      
      return { boundaryStreets, expandedStreets }
    }
  }

  /**
   * Calculate bounding box for boundary coordinates
   */
  private static calculateBoundingBox(coordinates: Array<{lat: number, lng: number}>): {
    center: {lat: number, lng: number},
    bounds: {north: number, south: number, east: number, west: number}
  } {
    let north = -90, south = 90, east = -180, west = 180
    
    for (const coord of coordinates) {
      if (coord.lat > north) north = coord.lat
      if (coord.lat < south) south = coord.lat
      if (coord.lng > east) east = coord.lng
      if (coord.lng < west) west = coord.lng
    }
    
    return {
      center: {
        lat: (north + south) / 2,
        lng: (east + west) / 2
      },
      bounds: { north, south, east, west }
    }
  }

  /**
   * Generate directional trigger points
   */
  private static async generateDirectionalTriggerPoints(
    poiLat: number, 
    poiLng: number, 
    streets: any[], 
    boundaryCoordinates?: Array<{lat: number, lng: number}>
  ): Promise<TriggerPoint[]> {
    const triggerPoints: TriggerPoint[] = []
    
    // Define cardinal directions
    const directions = [
      { name: 'North', bearing: 0 },
      { name: 'Northeast', bearing: 45 },
      { name: 'East', bearing: 90 },
      { name: 'Southeast', bearing: 135 },
      { name: 'South', bearing: 180 },
      { name: 'Southwest', bearing: 225 },
      { name: 'West', bearing: 270 },
      { name: 'Northwest', bearing: 315 }
    ]
    
    for (const direction of directions) {
      let bestStreet = null
      let minDistance = Infinity
      
      for (const street of streets) {
        const closestPoint = this.findClosestPointOnStreet(street.coordinates, poiLat, poiLng)
        const bearing = this.calculateBearing(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
        const distance = this.calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
        
        // Check if this street is in the desired direction (within 45 degrees)
        const bearingDiff = Math.abs(bearing - direction.bearing)
        const normalizedDiff = Math.min(bearingDiff, 360 - bearingDiff)
        
        if (normalizedDiff <= 45 && distance < minDistance && distance >= 25 && distance <= 80) {
          minDistance = distance
          bestStreet = street
        }
      }
      
      // Add trigger point for this direction if street found
      if (bestStreet && minDistance >= 25 && minDistance <= 80) {
        const optimalPoint = this.findOptimalPointOnStreet(bestStreet, poiLat, poiLng, boundaryCoordinates)
        const optimalDistance = this.calculateDistance(poiLat, poiLng, optimalPoint.lat, optimalPoint.lng)
        const confidence = Math.max(0.5, 1.0 - (optimalDistance / 40))
        
        triggerPoints.push({
          lat: optimalPoint.lat,
          lng: optimalPoint.lng,
          type: optimalDistance >= 25 && optimalDistance <= 35 ? 'primary' : (optimalDistance <= 50 ? 'secondary' : 'fallback'),
          reasoning: `Optimal walking point on ${bestStreet.name} in ${direction.name} direction`,
          confidence: confidence,
          distance_from_poi: optimalDistance,
          expected_bearing: this.calculateBearing(optimalPoint.lat, optimalPoint.lng, poiLat, poiLng),
          radius_meters: 20,
          auto_status: 'review'
        })
      }
    }
    
    return triggerPoints
  }

  /**
   * Find optimal point on street
   */
  private static findOptimalPointOnStreet(
    street: any, 
    poiLat: number, 
    poiLng: number, 
    boundaryCoordinates?: Array<{lat: number, lng: number}>
  ): {lat: number, lng: number} {
    const coordinates = street.coordinates
    const streetLength = coordinates.length
    
    if (streetLength < 2) {
      return street.closestPoint
    }
    
    // Sample multiple points along the street
    const candidatePoints = []
    const sampleCount = Math.max(3, Math.min(8, Math.floor(streetLength / 2)))
    const step = Math.max(1, Math.floor(streetLength / sampleCount))
    
    for (let i = 0; i < streetLength; i += step) {
      const point = coordinates[i]
      const distanceToPOI = this.calculateDistance(poiLat, poiLng, point.lat, point.lng)
      
      // Check if point is outside boundary and at reasonable distance
      const isOutsideBoundary = boundaryCoordinates ? !this.isPointInPolygon(point, boundaryCoordinates) : true
      
      if (isOutsideBoundary && distanceToPOI >= 15 && distanceToPOI <= 120) {
        candidatePoints.push({
          point,
          distance: distanceToPOI,
          score: 1.0 / (1 + Math.abs(distanceToPOI - 40)) // Prefer ~40m distance
        })
      }
    }
    
    if (candidatePoints.length === 0) {
      return street.closestPoint
    }
    
    // Return point with best score
    candidatePoints.sort((a, b) => b.score - a.score)
    return candidatePoints[0].point
  }

  /**
   * ⚡ LEGACY: Remove duplicate points (exact replica of legacy algorithm)
   */
  private static removeDuplicatePointsLegacy(points: TriggerPoint[], minDistance: number): TriggerPoint[] {
    const filtered: TriggerPoint[] = []
    
    for (const point of points) {
      let tooClose = false
      
      // ⚡ LEGACY LOGIC: Check distance to each existing point
      for (const existing of filtered) {
        const distance = this.calculateDistance(point.lat, point.lng, existing.lat, existing.lng)
        if (distance < minDistance) {
          tooClose = true
          break // ⚡ LEGACY: Stop at first duplicate found (performance!)
        }
      }
      
      if (!tooClose) {
        filtered.push(point) // ⚡ LEGACY: Add in original order (no sorting!)
      }
    }
    
    return filtered
  }

  /**
   * Remove duplicate points that are too close (COMPLEX VERSION - kept for compatibility)
   */
  private static removeDuplicatePoints(triggerPoints: TriggerPoint[], minSpacing: number): TriggerPoint[] {
    const filtered: TriggerPoint[] = []
    const sortedByPriority = [...triggerPoints].sort((a, b) => {
      // Sort by priority: primary > secondary > fallback
      const priorityOrder = { primary: 3, secondary: 2, fallback: 1 }
      const priorityDiff = (priorityOrder[a.type] || 0) - (priorityOrder[b.type] || 0)
      if (priorityDiff !== 0) return -priorityDiff
      
      // If same priority, sort by confidence (higher first)
      return (b.confidence || 0) - (a.confidence || 0)
    })

    for (const tp of sortedByPriority) {
      // Check if this trigger point is too close to any already accepted one
      const isTooClose = filtered.some(existingTp => {
        const distance = this.calculateDistance(tp.lat, tp.lng, existingTp.lat, existingTp.lng)
        return distance < minSpacing
      })

      if (!isTooClose) {
        filtered.push(tp)
      }
    }

    return filtered
  }

  /**
   * Classify trigger points by street quality
   */
  private static classifyTriggerPointsByStreet(triggerPoints: TriggerPoint[], poiLat: number, poiLng: number): TriggerPoint[] {
    return triggerPoints.map(tp => {
      // Reclassify based on distance and confidence
      let newType = tp.type
      
      if (tp.distance_from_poi <= 50 && tp.confidence >= 0.8) {
        newType = 'primary'
      } else if (tp.distance_from_poi <= 100 && tp.confidence >= 0.6) {
        newType = 'secondary'
      } else {
        newType = 'fallback'
      }
      
      // Determine auto status
      let autoStatus = 'review'
      if (tp.confidence >= 0.75 || newType === 'primary') {
        autoStatus = 'approved'
      } else if (tp.confidence < 0.5) {
        autoStatus = 'rejected'
      }
      
      return {
        ...tp,
        type: newType,
        auto_status: autoStatus as 'approved' | 'review' | 'rejected'
      }
    })
  }

  /**
   * Check if point is inside polygon
   */
  private static isPointInPolygon(point: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): boolean {
    let inside = false
    const x = point.lng
    const y = point.lat
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng
      const yi = polygon[i].lat
      const xj = polygon[j].lng
      const yj = polygon[j].lat
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }
    
    return inside
  }

  /**
   * Offset point from center
   */
  private static offsetPointFromCenter(pointLat: number, pointLng: number, centerLat: number, centerLng: number, offsetMeters: number): {lat: number, lng: number} {
    // Calculate bearing from center to point
    const bearing = this.calculateBearing(centerLat, centerLng, pointLat, pointLng)
    
    // Calculate new position offset outward
    const bearingRad = bearing * Math.PI / 180
    const offsetDegrees = offsetMeters / 111000 // Convert meters to degrees
    
    const newLat = pointLat + offsetDegrees * Math.cos(bearingRad)
    const newLng = pointLng + offsetDegrees * Math.sin(bearingRad)
    
    return { lat: newLat, lng: newLng }
  }

  /**
   * Get city base elevation with caching
   */
  private static cityElevationCache = new Map<string, number>()

  private static async getCityBaseElevation(lat: number, lng: number): Promise<number> {
    try {
      // Create cache key with rounded coordinates
      const cacheKey = `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`
      
      // Check cache first
      if (this.cityElevationCache.has(cacheKey)) {
        const cachedElevation = this.cityElevationCache.get(cacheKey)!
        console.log(`🏙️ Using cached city elevation for ${lat}, ${lng}: ${cachedElevation}m`)
        return cachedElevation
      }
      
      console.log(`🏙️ Getting city base elevation for ${lat}, ${lng}`)
      
      // METHOD 1: Try known cities database first
      const knownElevation = await this.getKnownCityElevation(lat, lng)
      if (knownElevation !== null) {
        console.log(`✅ Using known city elevation: ${knownElevation}m`)
        this.cityElevationCache.set(cacheKey, knownElevation)
        return knownElevation
      }
      
      // METHOD 2: Try Open Elevation API
      const openElevation = await this.getOpenElevationAPI(lat, lng)
      if (openElevation !== null && openElevation > 0) {
        console.log(`✅ Using Open Elevation API: ${openElevation}m`)
        this.cityElevationCache.set(cacheKey, openElevation)
        return openElevation
      }
      
      // METHOD 3: OSM elevation sampling (REAL DATA only)
      console.log(`🔄 Sampling REAL OSM elevation data...`)
      const osmElevation = await this.sampleOSMElevation(lat, lng)
      if (osmElevation !== null) {
        console.log(`✅ Using REAL OSM elevation: ${osmElevation}m`)
        this.cityElevationCache.set(cacheKey, osmElevation)
        return osmElevation
      }
      
      // NO FALLBACK - throw error when no real data available
      console.log(`❌ NO REAL ELEVATION DATA available for (${lat}, ${lng})`)
      throw new Error('No real elevation data available - cannot proceed without assumptions')
      
    } catch (error) {
      console.error('❌ Error getting city base elevation:', error)
      throw error // Don't hide the error - let caller handle lack of real data
    }
  }

  /**
   * Get known city elevation from database
   */
  private static async getKnownCityElevation(lat: number, lng: number): Promise<number | null> {
    // Known major cities with their elevations
    const knownCities = [
      { name: 'São Paulo', lat: -23.5505, lng: -46.6333, elevation: 760 },
      { name: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729, elevation: 31 },
      { name: 'Brasília', lat: -15.7801, lng: -47.9292, elevation: 1172 },
      { name: 'Belo Horizonte', lat: -19.9167, lng: -43.9345, elevation: 852 },
      { name: 'Salvador', lat: -12.9714, lng: -38.5014, elevation: 8 },
      { name: 'Fortaleza', lat: -3.7319, lng: -38.5267, elevation: 16 },
      { name: 'Curitiba', lat: -25.4284, lng: -49.2733, elevation: 935 },
      { name: 'Recife', lat: -8.0476, lng: -34.8770, elevation: 4 }
    ]
    
    // Find closest city within 50km
    for (const city of knownCities) {
      const distance = this.calculateDistance(lat, lng, city.lat, city.lng)
      if (distance <= 50000) { // Within 50km
        console.log(`🏙️ Found known city: ${city.name} (${distance.toFixed(0)}m away)`)
        return city.elevation
      }
    }
    
    return null
  }

  /**
   * Get elevation from Open Elevation API
   */
  private static async getOpenElevationAPI(lat: number, lng: number): Promise<number | null> {
    try {
      const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`)
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      if (data.results && data.results.length > 0) {
        return data.results[0].elevation
      }
      
      return null
    } catch (error) {
      console.error('❌ Open Elevation API error:', error)
      return null
    }
  }

  /**
   * Sample OSM elevation data - REAL DATA fallback
   */
  private static async sampleOSMElevation(lat: number, lng: number): Promise<number | null> {
    try {
      console.log(`📊 Sampling REAL OSM elevation data around (${lat}, ${lng})`)
      
      const query = `[out:json][timeout:30];
      (
        node[ele](around:2000,${lat},${lng});
        way[ele](around:2000,${lat},${lng});
      );
      out tags;`
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (elevation-sampling)',
          'Content-Type': 'text/plain'
        }
      })
      
      if (!response.ok) {
        console.log(`❌ OSM elevation sampling failed: ${response.status}`)
        return null
      }
      
      const data = await response.json()
      if (data.elements && data.elements.length > 0) {
        const elevations: number[] = []
        
        for (const element of data.elements) {
          if (element.tags?.ele) {
            const elevation = parseFloat(element.tags.ele)
            if (!isNaN(elevation) && elevation > 0) {
              elevations.push(elevation)
            }
          }
        }
        
        if (elevations.length > 0) {
          // Use median for stability
          elevations.sort((a, b) => a - b)
          const median = elevations[Math.floor(elevations.length / 2)]
          console.log(`✅ REAL OSM elevation sample: ${median}m (from ${elevations.length} points)`)
          return median
        }
      }
      
      console.log(`❌ No elevation data found in OSM sampling`)
      return null
    } catch (error) {
      console.error('❌ OSM elevation sampling failed:', error)
      return null
    }
  }

  /**
   * Get POI elevation from OSM
   */
  private static async getPOIElevation(lat: number, lng: number): Promise<number | null> {
    try {
      const overpassQuery = `[out:json][timeout:30];
      (
        node[ele](around:100,${lat},${lng});
        way[ele](around:100,${lat},${lng});
        relation[ele](around:100,${lat},${lng});
      );
      out tags;`
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: overpassQuery,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (elevation-detection)',
          'Content-Type': 'text/plain'
        }
      })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      if (data.elements && data.elements.length > 0) {
        for (const element of data.elements) {
          if (element.tags?.ele) {
            const elevation = parseInt(element.tags.ele)
            if (!isNaN(elevation)) {
              console.log(`📏 Found POI elevation in OSM: ${elevation}m`)
              return elevation
            }
          }
        }
      }
      
      return null
    } catch (error) {
      console.error('❌ Error getting POI elevation from OSM:', error)
      return null
    }
  }

  /**
   * Detect POI height from OSM building data
   */
  private static async detectPOIHeight(lat: number, lng: number): Promise<{
    height: number
    category: 'low' | 'medium' | 'high' | 'very_high'
    confidence: number
  }> {
    try {
      console.log(`🏗️ Detecting POI height for ${lat}, ${lng}`)
      
      const heightQuery = `[out:json][timeout:60];
      (
        // Search for buildings with direct height data
        way[building][height](around:50,${lat},${lng});
        relation[building][height](around:50,${lat},${lng});
        
        // Search for buildings with building:height
        way[building]["building:height"](around:50,${lat},${lng});
        relation[building]["building:height"](around:50,${lat},${lng});
        
        // Search for buildings with building:levels
        way[building]["building:levels"](around:50,${lat},${lng});
        relation[building]["building:levels"](around:50,${lat},${lng});
        
        // Search for towers with height
        way[man_made=tower][height](around:200,${lat},${lng});
        relation[man_made=tower][height](around:200,${lat},${lng});
        
        // Search for building parts with height
        way["building:part"][height](around:100,${lat},${lng});
        relation["building:part"][height](around:100,${lat},${lng});
      );
      out tags;`
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: heightQuery,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (height-detection)',
          'Content-Type': 'text/plain'
        }
      })
      
      if (!response.ok) {
        return { height: 15, category: 'medium', confidence: 0.3 }
      }
      
      const data = await response.json()
      if (data.elements && data.elements.length > 0) {
        let bestHeight = 0
        let bestConfidence = 0
        
        for (const element of data.elements) {
          const tags = element.tags || {}
          let height = 0
          let confidence = 0
          
          // Try to get height from various tags
          if (tags.height) {
            const heightValue = parseFloat(tags.height.replace(/[^\d.]/g, ''))
            if (!isNaN(heightValue)) {
              height = heightValue
              confidence = 0.9 // High confidence for direct height
            }
          } else if (tags['building:height']) {
            const heightValue = parseFloat(tags['building:height'].replace(/[^\d.]/g, ''))
            if (!isNaN(heightValue)) {
              height = heightValue
              confidence = 0.8 // High confidence for building:height
            }
          } else if (tags['building:levels']) {
            const levels = parseInt(tags['building:levels'])
            if (!isNaN(levels)) {
              height = levels * 3.5 // Estimate 3.5m per floor
              confidence = 0.6 // Medium confidence for estimated height
            }
          }
          
          // Keep the best (highest confidence) height found
          if (confidence > bestConfidence) {
            bestHeight = height
            bestConfidence = confidence
          }
        }
        
        if (bestHeight > 0) {
          const category = this.categorizeHeight(bestHeight)
          console.log(`🏗️ Found POI height: ${bestHeight}m (${category}, confidence: ${bestConfidence})`)
          return { height: bestHeight, category, confidence: bestConfidence }
        }
      }
      
      // NO REAL DATA FOUND - be honest about it
      console.log(`❌ NO REAL HEIGHT DATA found in OSM for this location`)
      return { height: 0, category: 'low', confidence: 0.0 } // ZERO confidence = no real data
      
    } catch (error) {
      console.error('❌ Error detecting POI height:', error)
      // DON'T ASSUME - return zero confidence when error occurs
      return { height: 0, category: 'low', confidence: 0.0 }
    }
  }

  /**
   * Categorize height into low/medium/high/very_high
   */
  private static categorizeHeight(height: number): 'low' | 'medium' | 'high' | 'very_high' {
    if (height < 20) return 'low'
    if (height < 50) return 'medium'
    if (height < 100) return 'high'
    return 'very_high'
  }

  /**
   * Detect urban density around POI
   */
  private static async detectUrbanDensity(lat: number, lng: number): Promise<'very_dense' | 'dense' | 'medium' | 'low' | 'rural'> {
    try {
      // Sample building density in 500m radius
      const densityQuery = `[out:json][timeout:30];
      (
        way[building](around:500,${lat},${lng});
        relation[building](around:500,${lat},${lng});
      );
      out tags;`
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: densityQuery,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (density-detection)',
          'Content-Type': 'text/plain'
        }
      })
      
      if (!response.ok) {
        return 'medium' // Default
      }
      
      const data = await response.json()
      const buildingCount = data.elements?.length || 0
      
      // Classify based on building density
      if (buildingCount > 200) return 'very_dense'
      if (buildingCount > 100) return 'dense'
      if (buildingCount > 50) return 'medium'
      if (buildingCount > 10) return 'low'
      return 'rural'
      
    } catch (error) {
      console.error('❌ Error detecting urban density:', error)
      return 'medium'
    }
  }


  /**
   * Check for building obstructions between trigger point and POI (height-aware)
   */
  private static async checkBuildingObstructions(
    triggerPoint: {lat: number, lng: number}, 
    poiLat: number, 
    poiLng: number
  ): Promise<boolean> {
    try {
      console.log(`🔍 Checking building obstructions between trigger point and POI`)
      
      // Get POI height for obstruction calculations
      const poiHeight = await this.detectPOIHeight(poiLat, poiLng)
      
      // NO ASSUMPTIONS - if no real height data, cannot do height-aware obstruction check
      if (poiHeight.confidence === 0.0) {
        console.log(`⚠️ No REAL POI height data available - skipping height-aware obstruction check`)
        return false // Conservative: assume no obstruction if we can't measure properly
      }
      
      const poiHeightValue = poiHeight.height
      console.log(`🏗️ REAL POI height: ${poiHeightValue}m (confidence: ${poiHeight.confidence}) - checking obstacles`)
      
      // Calculate search area between trigger point and POI
      const distance = this.calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng)
      const searchRadius = Math.min(distance / 2, 200) // Search in corridor between points
      
      // Find buildings that might obstruct the view
      const obstructionQuery = `[out:json][timeout:30];
      (
        way[building](around:${searchRadius},${(triggerPoint.lat + poiLat) / 2},${(triggerPoint.lng + poiLng) / 2});
        relation[building](around:${searchRadius},${(triggerPoint.lat + poiLat) / 2},${(triggerPoint.lng + poiLng) / 2});
      );
      out geom tags;`
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: obstructionQuery,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (obstruction-check)',
          'Content-Type': 'text/plain'
        }
      })
      
      if (!response.ok) {
        console.log(`⚠️ Obstruction check failed: ${response.status}`)
        return false // If can't check, assume no obstruction
      }
      
      const data = await response.json()
      if (!data.elements || data.elements.length === 0) {
        console.log(`✅ No buildings found in line of sight`)
        return false
      }
      
      console.log(`🔍 Found ${data.elements.length} potential obstructions`)
      
      // Check if any building intersects the line of sight
      let obstructionCount = 0
      
      for (const element of data.elements) {
        if (element.geometry && element.geometry.length >= 3) {
          const buildingCoords = element.geometry.map((node: any) => ({
            lat: node.lat,
            lng: node.lon
          }))
          
          // Check if building is between trigger point and POI
          const buildingCenter = this.calculatePolygonCenter(buildingCoords)
          const distanceToTrigger = this.calculateDistance(triggerPoint.lat, triggerPoint.lng, buildingCenter.lat, buildingCenter.lng)
          const distanceToPOI = this.calculateDistance(poiLat, poiLng, buildingCenter.lat, buildingCenter.lng)
          const totalDistance = this.calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng)
          
          // If building is roughly between trigger point and POI (with some tolerance)
          if (distanceToTrigger + distanceToPOI <= totalDistance * 1.2) {
            // Check if line of sight passes through or very close to building
            if (this.lineIntersectsPolygon(triggerPoint, {lat: poiLat, lng: poiLng}, buildingCoords)) {
              
              // HEIGHT-AWARE OBSTRUCTION CHECK
              const obstacleHeight = this.getEstimatedBuildingHeight(element.tags || {})
              const canSeeOver = poiHeightValue > obstacleHeight + 10 // POI must be 10m+ higher to see over
              
              if (canSeeOver) {
                console.log(`👁️ POI (${poiHeightValue}m) can see over obstacle (${obstacleHeight}m) - not blocking`)
              } else {
                obstructionCount++
                
                // Get building info for logging
                const buildingType = element.tags?.building || 'unknown'
                const buildingName = element.tags?.name || `${buildingType} building`
                console.log(`🚫 Obstruction detected: ${buildingName} (${obstacleHeight}m high, ${distanceToTrigger.toFixed(0)}m from trigger point)`)
              }
            }
          }
        }
      }
      
      // If more than 2 significant obstructions, consider it blocked
      const isBlocked = obstructionCount > 2
      
      if (isBlocked) {
        console.log(`❌ Line of sight blocked by ${obstructionCount} buildings`)
      } else {
        console.log(`✅ Line of sight clear (${obstructionCount} minor obstructions)`)
      }
      
      return isBlocked
      
    } catch (error) {
      console.error('❌ Error checking building obstructions:', error)
      return false // If error, assume no obstructions for safety
    }
  }

  /**
   * Calculate polygon center
   */
  private static calculatePolygonCenter(coordinates: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
    const latSum = coordinates.reduce((sum, coord) => sum + coord.lat, 0)
    const lngSum = coordinates.reduce((sum, coord) => sum + coord.lng, 0)
    
    return {
      lat: latSum / coordinates.length,
      lng: lngSum / coordinates.length
    }
  }

  /**
   * Check if a line intersects with a polygon (building)
   */
  private static lineIntersectsPolygon(
    point1: {lat: number, lng: number}, 
    point2: {lat: number, lng: number}, 
    polygon: Array<{lat: number, lng: number}>
  ): boolean {
    // Simple implementation: check if line passes near polygon center
    const polygonCenter = this.calculatePolygonCenter(polygon)
    const distanceToLine = this.distancePointToLine(polygonCenter, point1, point2)
    
    // If polygon center is within 50m of the line, consider it intersecting
    return distanceToLine < 50
  }

  /**
   * Calculate distance from point to line
   */
  private static distancePointToLine(
    point: {lat: number, lng: number},
    lineStart: {lat: number, lng: number},
    lineEnd: {lat: number, lng: number}
  ): number {
    // Convert to meters for calculation
    const A = this.calculateDistance(lineStart.lat, lineStart.lng, lineEnd.lat, lineEnd.lng)
    const B = this.calculateDistance(lineStart.lat, lineStart.lng, point.lat, point.lng)
    const C = this.calculateDistance(lineEnd.lat, lineEnd.lng, point.lat, point.lng)
    
    // Use Heron's formula to calculate area, then distance
    const s = (A + B + C) / 2
    const area = Math.sqrt(s * (s - A) * (s - B) * (s - C))
    
    if (A === 0) return B // Degenerate case
    
    return (2 * area) / A
  }

  /**
   * Calculate distance to polygon boundary
   */
  private static calculateDistanceToPolygon(point: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): number {
    let minDistance = Infinity
    
    for (let i = 0; i < polygon.length - 1; i++) {
      const distance = this.distancePointToLine(point, polygon[i], polygon[i + 1])
      minDistance = Math.min(minDistance, distance)
    }
    
    return minDistance
  }

  /**
   * Get estimated building height from OSM tags
   */
  private static getEstimatedBuildingHeight(tags: any): number {
    // Try direct height first
    if (tags.height) {
      const height = parseFloat(tags.height.replace(/[^\d.]/g, ''))
      if (!isNaN(height)) return height
    }
    
    if (tags['building:height']) {
      const height = parseFloat(tags['building:height'].replace(/[^\d.]/g, ''))
      if (!isNaN(height)) return height
    }
    
    // Try levels
    if (tags['building:levels']) {
      const levels = parseInt(tags['building:levels'])
      if (!isNaN(levels)) return levels * 3.5
    }
    
    // Estimate by building type
    const buildingType = tags.building || 'residential'
    
    switch (buildingType) {
      case 'skyscraper': return 200
      case 'tower': return 150
      case 'office': return 60
      case 'commercial': return 25
      case 'retail': return 8
      case 'industrial': return 15
      case 'warehouse': return 12
      case 'apartments': return 35
      case 'house': return 8
      case 'garage': return 4
      case 'shed': return 4
      default: 
        console.log(`⚠️ Unknown building type: ${buildingType} - using median residential height`)
        return 12 // Median residential building height in Brazil (data-driven estimate)
    }
  }
}
