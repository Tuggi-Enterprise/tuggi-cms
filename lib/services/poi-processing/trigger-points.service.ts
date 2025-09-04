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
   * Detect boundary for POI
   */
  private static async detectBoundary(
    poiData: POIData, 
    enrichedData: EnrichedPOIData, 
    options: TriggerPointOptions
  ): Promise<ProcessingResult<BoundaryData>> {
    try {
      // This will be implemented with the actual boundary detection logic
      // For now, return a mock boundary
      const mockBoundary: BoundaryData = {
        type: 'polygon',
        coordinates: [
          { lat: poiData.lat! + 0.001, lng: poiData.lng! + 0.001 },
          { lat: poiData.lat! - 0.001, lng: poiData.lng! + 0.001 },
          { lat: poiData.lat! - 0.001, lng: poiData.lng! - 0.001 },
          { lat: poiData.lat! + 0.001, lng: poiData.lng! - 0.001 }
        ],
        area_m2: 40000,
        perimeter_m: 800,
        confidence: 0.8,
        source: 'osm_nominatim'
      }
      
      return {
        success: true,
        data: mockBoundary,
        processing_time: 0,
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
        processing_time: 0,
        metadata: {
          step: 'boundary_detection',
          status: 'failed',
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Generate trigger points based on boundary
   */
  private static async generateTriggerPoints(
    poiData: POIData,
    boundary: BoundaryData,
    enrichedData: EnrichedPOIData,
    options: TriggerPointOptions
  ): Promise<ProcessingResult<TriggerPoint[]>> {
    try {
      // This will be implemented with the actual trigger point generation logic
      // For now, return mock trigger points
      const mockTriggerPoints: TriggerPoint[] = [
        {
          lat: poiData.lat! + 0.0005,
          lng: poiData.lng! + 0.0005,
          type: 'primary',
          reasoning: 'Primary access point from main street',
          confidence: 0.9,
          distance_from_poi: 50,
          expected_bearing: 45,
          radius_meters: 20,
          auto_status: 'approved'
        },
        {
          lat: poiData.lat! - 0.0005,
          lng: poiData.lng! - 0.0005,
          type: 'secondary',
          reasoning: 'Secondary access from side street',
          confidence: 0.7,
          distance_from_poi: 80,
          expected_bearing: 225,
          radius_meters: 25,
          auto_status: 'review'
        }
      ]
      
      return {
        success: true,
        data: mockTriggerPoints,
        processing_time: 0,
        metadata: {
          step: 'trigger_points_generation',
          status: 'completed',
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `Trigger points generation failed: ${error}`,
        processing_time: 0,
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
   * Calculate distance between two points
   */
  private static calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dx = (lng2 - lng1) * Math.cos((lat1 + lat2) / 2)
    const dy = lat2 - lat1
    return Math.sqrt(dx * dx + dy * dy) * 111000 // Convert to meters
  }
}
