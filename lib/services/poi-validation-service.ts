/**
 * POI Validation Service
 * 
 * This service handles POI name validation using Google Gemini AI with:
 * - Rate limiting for API calls
 * - Batch processing capabilities
 * - Database integration
 * - Error handling and retry logic
 * - Progress tracking
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

// Types
export interface POI {
  id: string
  name: string
  city: string
  state?: string
  country: string
  category: string
  formatted_address?: string
  osm_tags?: Record<string, any>
  coordinates: {
    lat: number
    lng: number
  }
}

export interface ValidationResult {
  id: string
  attraction_id: string
  current_name: string
  is_accurate: boolean
  confidence_score: number
  suggested_name?: string
  change_type?: 'none' | 'prefix_added' | 'complementary_info_added' | 'full_name_change' | 'core_preserved'
  reasoning: string
  name_issues: string[]
  improvement_suggestions: string[]
  requires_manual_review: boolean
  review_priority: 'low' | 'medium' | 'high' | 'critical'
  approved: boolean
  auto_approved: boolean
  name_changed: boolean
  old_name?: string
  new_name_applied?: string
  processed_at: string
  gemini_model_used: string
  processing_time_ms: number
  poi_type?: string
  descriptors_added?: string[]
  classification_confidence?: number
  evidence_found?: boolean
  evidence_source?: string
}

export interface GeminiResponse {
  is_accurate: boolean
  confidence_score: number
  poi_type: string
  suggested_name: string | null
  change_type: 'none' | 'prefix_added' | 'complementary_info_added' | 'full_name_change' | 'core_preserved'
  reasoning: string
  name_issues: string[]
  improvement_suggestions: string[]
  descriptors_added: string[]
  classification_confidence: number
  evidence_found: boolean
  evidence_source: string
}

export interface BatchProgress {
  batch_id: string
  total_pois: number
  processed: number
  failed: number
  auto_approved: number
  manual_review: number
  start_time: Date
  estimated_completion: Date | null
  current_batch_number: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  last_processed_id?: string
}

export interface ValidationConfig {
  gemini_model: 'gemini-1.5-flash'
  batch_size: number
  rate_limit_delay: number
  auto_approval_threshold: number
  max_retries: number
}

// Rate limiting configuration - Gemini Flash only
const RATE_LIMITS = {
  'gemini-1.5-flash': {
    requests_per_minute: 15,
    requests_per_hour: 1500,
    cooldown_ms: 4000,
    max_retries: 3,
    backoff_multiplier: 2
  }
}

// Default configuration
const DEFAULT_CONFIG: ValidationConfig = {
  gemini_model: 'gemini-1.5-flash',
  batch_size: 50,
  rate_limit_delay: 4000,
  auto_approval_threshold: 70,
  max_retries: 3
}

class RateLimiter {
  private requestTimes: number[] = []
  private model: 'gemini-1.5-flash'
  
  constructor(model: 'gemini-1.5-flash') {
    this.model = model
  }
  
  async waitForNextRequest(): Promise<void> {
    const now = Date.now()
    const limits = RATE_LIMITS[this.model]
    
    // Remove requests older than 1 minute
    this.requestTimes = this.requestTimes.filter(time => now - time < 60000)
    
    // Check if we need to wait
    if (this.requestTimes.length >= limits.requests_per_minute) {
      const oldestRequest = Math.min(...this.requestTimes)
      const waitTime = 60000 - (now - oldestRequest)
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`)
        await this.sleep(waitTime)
      }
    }
    
    // Add current request time
    this.requestTimes.push(now)
    
    // Apply cooldown
    await this.sleep(limits.cooldown_ms)
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export class POIValidationService {
  private supabase: any
  private genAI: GoogleGenerativeAI
  private model: any
  private rateLimiter: RateLimiter
  private config: ValidationConfig
  
  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    geminiApiKey: string,
    config: Partial<ValidationConfig> = {}
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey)
    this.genAI = new GoogleGenerativeAI(geminiApiKey)
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    this.rateLimiter = new RateLimiter('gemini-1.5-flash')
  }
  
  private buildValidationPrompt(poi: POI): string {
    const osmTagsStr = poi.osm_tags ? JSON.stringify(poi.osm_tags, null, 2) : 'None'
    
    return `Analyze this Brazilian POI and improve its name by adding missing prefixes or complementary information. NEVER invent information.

POI Data:
- Name: "${poi.name}"
- Location: ${poi.city}, ${poi.state || 'N/A'}, ${poi.country}
- Address: ${poi.formatted_address || 'N/A'}
- Category: ${poi.category}
- OSM Tags: ${osmTagsStr}

🎯 PRIMARY GOAL: Add missing prefixes to make names more descriptive
- "Ibirapuera" → "Parque Ibirapuera" (add missing prefix)
- "Maracanã" → "Estádio Maracanã" (add missing prefix)
- "Cristo Redentor" → "Monumento Cristo Redentor" (add missing prefix)

🚨 CRITICAL RULES:
1. NEVER invent information - only use provided data
2. If OSM data contradicts name (e.g., "Locomotiva" + "peak"), return confidence < 30
3. If no OSM tags, be extra conservative - only add obvious prefixes
4. Preserve core name - only add prefixes or complementary info

📋 DECISION LOGIC:
1. Does name need a prefix? (e.g., "Ibirapuera" needs "Parque")
2. Is OSM data consistent with name? (if not, flag for review)
3. Can I add helpful context? (location, type clarification)

Examples:
✅ "Ibirapuera" → "Parque Ibirapuera" (add prefix)
✅ "Museu do Futebol" → "Museu do Futebol" (keep - already has prefix)
❌ "Locomotiva X" + OSM "peak" → Flag for review (contradiction)

Respond in JSON:
{
  "is_accurate": boolean,
  "confidence_score": number (0-100),
  "poi_type": string,
  "suggested_name": string or null,
  "change_type": string (none, prefix_added, complementary_info_added, full_name_change, core_preserved),
  "reasoning": string,
  "name_issues": string[],
  "improvement_suggestions": string[],
  "descriptors_added": string[],
  "classification_confidence": number (0-100),
  "evidence_found": boolean,
  "evidence_source": string
}`
  }
  
  private async callGeminiAPI(prompt: string, retries = 0): Promise<GeminiResponse> {
    try {
      await this.rateLimiter.waitForNextRequest()
      
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const text = response.text()
      
      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in Gemini response')
      }
      
      const parsed = JSON.parse(jsonMatch[0])
      
      // Validate required fields
      if (typeof parsed.is_accurate !== 'boolean' || 
          typeof parsed.confidence_score !== 'number' ||
          !parsed.reasoning) {
        throw new Error('Invalid Gemini response format')
      }
      
      // Ensure confidence score is within valid range
      parsed.confidence_score = Math.max(0, Math.min(100, parsed.confidence_score))
      parsed.classification_confidence = Math.max(0, Math.min(100, parsed.classification_confidence || 0))
      
      return parsed
    } catch (error) {
      const limits = RATE_LIMITS['gemini-1.5-flash']
      
      if (retries < limits.max_retries) {
        const backoffDelay = limits.cooldown_ms * Math.pow(limits.backoff_multiplier, retries)
        console.warn(`Gemini API call failed, retrying in ${backoffDelay}ms (${retries + 1}/${limits.max_retries}):`, (error as Error).message)
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay))
        return this.callGeminiAPI(prompt, retries + 1)
      }
      
      throw new Error(`Gemini API call failed after ${limits.max_retries} retries: ${(error as Error).message}`)
    }
  }
  
  private determineReviewPriority(confidenceScore: number, evidenceFound: boolean): 'low' | 'medium' | 'high' | 'critical' {
    if (confidenceScore < 30) return 'critical'
    if (confidenceScore < 50) return 'high'
    if (confidenceScore < 70) return 'medium'
    if (!evidenceFound && confidenceScore < 85) return 'medium'
    return 'low'
  }
  
  async validatePOI(poi: POI): Promise<ValidationResult> {
    const startTime = Date.now()
    
    try {
      console.log(`🔍 Validating: ${poi.name} (${poi.city})`)
      
      const prompt = this.buildValidationPrompt(poi)
      const geminiResponse = await this.callGeminiAPI(prompt)
      
      const processingTime = Date.now() - startTime
      
      // Determine review priority
      const reviewPriority = this.determineReviewPriority(
        geminiResponse.confidence_score, 
        geminiResponse.evidence_found
      )
      
      // Determine if auto-approval is possible
      const autoApprove = geminiResponse.confidence_score >= this.config.auto_approval_threshold && 
                         geminiResponse.suggested_name !== null &&
                         geminiResponse.evidence_found
      
      const result: ValidationResult = {
        id: crypto.randomUUID(),
        attraction_id: poi.id,
        current_name: poi.name,
        is_accurate: geminiResponse.is_accurate,
        confidence_score: geminiResponse.confidence_score,
        suggested_name: geminiResponse.suggested_name || undefined,
        reasoning: geminiResponse.reasoning,
        name_issues: geminiResponse.name_issues || [],
        improvement_suggestions: geminiResponse.improvement_suggestions || [],
        requires_manual_review: !autoApprove,
        review_priority: reviewPriority,
        approved: autoApprove,
        auto_approved: autoApprove,
        name_changed: autoApprove && geminiResponse.suggested_name !== null,
        old_name: autoApprove ? poi.name : undefined,
        new_name_applied: autoApprove ? (geminiResponse.suggested_name || undefined) : undefined,
        processed_at: new Date().toISOString(),
        gemini_model_used: 'gemini-1.5-flash',
        processing_time_ms: processingTime,
        poi_type: geminiResponse.poi_type,
        descriptors_added: geminiResponse.descriptors_added || [],
        classification_confidence: geminiResponse.classification_confidence,
        evidence_found: geminiResponse.evidence_found,
        evidence_source: geminiResponse.evidence_source
      }
      
      if (autoApprove) {
        console.log(`✅ Auto-approved: ${poi.name} → ${geminiResponse.suggested_name} (${geminiResponse.confidence_score}%)`)
      } else {
        console.log(`⏸️  Manual review: ${poi.name} (${geminiResponse.confidence_score}%, ${reviewPriority} priority)`)
      }
      
      return result
    } catch (error) {
      console.error(`❌ Failed to validate POI ${poi.id}:`, (error as Error).message)
      
      // Return error result
      return {
        id: crypto.randomUUID(),
        attraction_id: poi.id,
        current_name: poi.name,
        is_accurate: true, // Default to accurate on error
        confidence_score: 0,
        reasoning: `Validation failed: ${(error as Error).message}`,
        name_issues: ['validation_error'],
        improvement_suggestions: [],
        requires_manual_review: true,
        review_priority: 'critical',
        approved: false,
        auto_approved: false,
        name_changed: false,
        processed_at: new Date().toISOString(),
        gemini_model_used: 'gemini-1.5-flash',
        processing_time_ms: Date.now() - startTime,
        evidence_found: false,
        evidence_source: 'validation_error'
      }
    }
  }
  
  async saveValidationResult(result: ValidationResult, poi: POI): Promise<void> {
    try {
      const { error } = await this.supabase
        .schema('core')
        .from('poi_name_validations')
        .insert([{
          id: result.id,
          attraction_id: result.attraction_id,
          current_name: result.current_name,
          current_category: poi.category,
          current_address: poi.formatted_address,
          current_coordinates: `(${poi.coordinates.lat},${poi.coordinates.lng})`,
          current_city: poi.city,
          current_state: poi.state,
          current_country: poi.country,
          current_osm_tags: poi.osm_tags || {},
          is_accurate: result.is_accurate,
          confidence_score: result.confidence_score,
          suggested_name: result.suggested_name,
          reasoning: result.reasoning,
          name_issues: result.name_issues,
          improvement_suggestions: result.improvement_suggestions,
          poi_type: result.poi_type,
          change_type: result.change_type,
          classification_confidence: result.classification_confidence,
          descriptors_added: result.descriptors_added,
          evidence_found: result.evidence_found,
          evidence_source: result.evidence_source,
          requires_manual_review: result.requires_manual_review,
          review_priority: result.review_priority,
          approved: result.approved,
          auto_approved: result.auto_approved,
          name_changed: result.name_changed,
          old_name: result.old_name,
          new_name_applied: result.new_name_applied,
          processed_at: result.processed_at,
          gemini_model_used: result.gemini_model_used,
          processing_time_ms: result.processing_time_ms
        }])
      
      if (error) {
        console.error('Failed to save validation result:', error)
        throw error
      }
    } catch (error) {
      console.error('Database error saving validation result:', error)
      throw error
    }
  }
  
  async applyNameChange(poiId: string, newName: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .schema('core')
        .from('attractions')
        .update({ name: newName })
        .eq('id', poiId)
      
      if (error) {
        console.error(`Failed to update POI ${poiId} name:`, error)
        throw error
      }
      
      console.log(`✅ Applied name change: ${newName}`)
    } catch (error) {
      console.error('Failed to apply name change:', error)
      throw error
    }
  }
  
  async getPOIsToProcess(lastProcessedId: string | null = null, limit = 50): Promise<POI[]> {
    try {
      // Strategy: Use SQL to directly find unprocessed POIs
      // This is much more efficient than filtering in the application
      const { data: unprocessedPOIs, error } = await this.supabase
        .schema('core')
        .rpc('get_unprocessed_pois', {
          batch_limit: limit,
          last_id: lastProcessedId
        })
      
      if (error) {
        console.error('RPC function failed, falling back to manual filtering:', error)
        
        // Fallback: Use the old method but with larger batches
        return await this.getPOIsManualFilter(lastProcessedId, limit)
      }
      
      if (!unprocessedPOIs || unprocessedPOIs.length === 0) {
        console.log('📊 No more unprocessed POIs found')
        return []
      }
      
      console.log(`✅ Found ${unprocessedPOIs.length} unprocessed POIs`)
      
      // Get coordinates for the unprocessed POIs
      const poiIds = unprocessedPOIs.map(p => p.id)
      const { data: coordinates, error: coordError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id, latitude, longitude')
        .in('attraction_id', poiIds)
      
      if (coordError) {
        console.error('Failed to fetch coordinates:', coordError)
      }
      
      // Map coordinates to POIs
      const coordsMap = new Map()
      if (coordinates) {
        coordinates.forEach(coord => {
          coordsMap.set(coord.attraction_id, {
            lat: coord.latitude,
            lng: coord.longitude
          })
        })
      }
      
      return unprocessedPOIs.map((poi: any) => ({
        id: poi.id,
        name: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country,
        category: poi.category,
        formatted_address: poi.formatted_address,
        osm_tags: poi.osm_tags,
        coordinates: coordsMap.get(poi.id) || { lat: 0, lng: 0 }
      }))
    } catch (error) {
      console.error('Database error fetching POIs:', error)
      return []
    }
  }

  // Fallback method for manual filtering
  async getPOIsManualFilter(lastProcessedId: string | null = null, limit = 50): Promise<POI[]> {
    try {
      const batchSize = limit * 10 // Get 10x more to account for heavy filtering
      let attempts = 0
      const maxAttempts = 20 // Increase attempts
      let currentId = lastProcessedId
      
      while (attempts < maxAttempts) {
        let query = this.supabase
          .schema('core')
          .from('attractions')
          .select(`
            id,
            name,
            city,
            state,
            country,
            category,
            formatted_address,
            osm_tags
          `)
          .eq('country', 'BR')
          .order('id', { ascending: true })
          .limit(batchSize)
        
        if (currentId) {
          query = query.gt('id', currentId)
        }
        
        const { data: attractions, error: error1 } = await query
        
        if (error1) {
          console.error('Failed to fetch attractions:', error1)
          throw error1
        }
        
        if (!attractions || attractions.length === 0) {
          console.log('📊 No more POIs found in database')
          return []
        }
        
        // Check which ones are already processed
        const attractionIds = attractions.map(a => a.id)
        const { data: processedValidations, error: error2 } = await this.supabase
          .schema('core')
          .from('poi_name_validations')
          .select('attraction_id')
          .in('attraction_id', attractionIds)
        
        if (error2) {
          console.error('Failed to check processed validations:', error2)
        }
        
        // Filter out already processed POIs
        const processedSet = new Set(processedValidations?.map(v => v.attraction_id) || [])
        const unprocessedAttractions = attractions.filter(a => !processedSet.has(a.id))
        
        console.log(`📊 Batch ${attempts + 1}: Found ${unprocessedAttractions.length} unprocessed POIs (filtered ${attractions.length - unprocessedAttractions.length} already processed)`)
        
        if (unprocessedAttractions.length > 0) {
          const result = unprocessedAttractions.slice(0, limit)
          console.log(`✅ Returning ${result.length} unprocessed POIs`)
          
          return result.map((poi: any) => ({
            id: poi.id,
            name: poi.name,
            city: poi.city,
            state: poi.state,
            country: poi.country,
            category: poi.category,
            formatted_address: poi.formatted_address,
            osm_tags: poi.osm_tags,
            coordinates: { lat: 0, lng: 0 } // Will be filled later
          }))
        }
        
        // Move to next batch
        currentId = attractions[attractions.length - 1].id
        attempts++
        console.log(`🔄 Moving to next batch, starting from ID: ${currentId}`)
      }
      
      console.log(`❌ No unprocessed POIs found after ${maxAttempts} attempts`)
      return []
    } catch (error) {
      console.error('Database error in manual filter:', error)
      return []
    }
  }
  
  async getTotalPOICount(): Promise<number> {
    try {
      // Get total Brazilian POIs
      const { count: totalBR, error: totalError } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })
        .eq('country', 'BR')
      
      if (totalError) {
        console.error('Failed to get total POI count:', totalError)
        return 0
      }
      
      // Get processed count
      const { count: processedCount, error: processedError } = await this.supabase
        .schema('core')
        .from('poi_name_validations')
        .select('*', { count: 'exact', head: true })
      
      if (processedError) {
        console.error('Failed to get processed POI count:', processedError)
        return totalBR || 0  // Return total if can't get processed count
      }
      
      const remaining = (totalBR || 0) - (processedCount || 0)
      console.log(`📊 POI Count: ${totalBR} total, ${processedCount} processed, ${remaining} remaining`)
      
      return remaining
    } catch (error) {
      console.error('Database error getting POI count:', error)
      return 0
    }
  }
  
  async createBatch(totalPois: number): Promise<string> {
    try {
      const { data, error } = await this.supabase
        .schema('core')
        .from('poi_validation_batches')
        .insert([{
          batch_name: `POI Validation - ${new Date().toISOString()}`,
          total_pois: totalPois,
          status: 'pending',
          batch_size: this.config.batch_size,
          gemini_model_used: 'gemini-1.5-flash',
          rate_limit_config: RATE_LIMITS[this.config.gemini_model],
          started_at: new Date().toISOString()
        }])
        .select('id')
        .single()
      
      if (error) {
        console.error('Failed to create batch:', error)
        throw error
      }
      
      return data.id
    } catch (error) {
      console.error('Database error creating batch:', error)
      throw error
    }
  }
  
  async updateBatchProgress(batchId: string, progress: Partial<BatchProgress>): Promise<void> {
    try {
      const { error } = await this.supabase
        .schema('core')
        .from('poi_validation_batches')
        .update({
          processed_count: progress.processed,
          failed_count: progress.failed,
          status: progress.status,
          ...(progress.status === 'completed' && { completed_at: new Date().toISOString() }),
          processing_stats: {
            auto_approved: progress.auto_approved,
            manual_review: progress.manual_review,
            estimated_completion: progress.estimated_completion
          }
        })
        .eq('id', batchId)
      
      if (error) {
        console.error('Failed to update batch progress:', error)
        throw error
      }
    } catch (error) {
      console.error('Database error updating batch progress:', error)
    }
  }
  
  async getValidationStats(): Promise<any> {
    try {
      const { data, error } = await this.supabase
        .schema('core')
        .from('poi_validation_stats')
        .select('*')
        .single()
      
      if (error) {
        console.error('Failed to get validation stats:', error)
        return null
      }
      
      return data
    } catch (error) {
      console.error('Database error getting validation stats:', error)
      return null
    }
  }
  
  async getReviewQueue(limit = 50, priority?: string): Promise<any[]> {
    try {
      let query = this.supabase
        .schema('core')
        .from('poi_review_queue')
        .select('*')
        .limit(limit)
      
      if (priority) {
        query = query.eq('review_priority', priority)
      }
      
      const { data, error } = await query
      
      if (error) {
        console.error('Failed to get review queue:', error)
        return []
      }
      
      return data || []
    } catch (error) {
      console.error('Database error getting review queue:', error)
      return []
    }
  }
  
  async approveValidation(validationId: string, reviewerNotes?: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .schema('core')
        .from('poi_name_validations')
        .update({
          approved: true,
          approved_at: new Date().toISOString(),
          reviewer_notes: reviewerNotes
        })
        .eq('id', validationId)
      
      if (error) {
        console.error('Failed to approve validation:', error)
        throw error
      }
    } catch (error) {
      console.error('Database error approving validation:', error)
      throw error
    }
  }
  
  async rejectValidation(validationId: string, rejectionReason: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .schema('core')
        .from('poi_name_validations')
        .update({
          approved: false,
          rejection_reason: rejectionReason,
          requires_manual_review: false
        })
        .eq('id', validationId)
      
      if (error) {
        console.error('Failed to reject validation:', error)
        throw error
      }
    } catch (error) {
      console.error('Database error rejecting validation:', error)
      throw error
    }
  }
}
