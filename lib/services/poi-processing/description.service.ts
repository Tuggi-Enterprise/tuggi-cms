/**
 * Description Service - POI Processing Module
 * 
 * Centralized service for POI description generation and management
 * Extracted from generate-optimized API for modularity and reusability
 * 
 * Features:
 * - Generate new descriptions
 * - Improve existing descriptions  
 * - Validate description quality
 * - Support for multiple languages
 * - Integration with verification system
 */

import { createClient } from '@supabase/supabase-js'
import { OSMEnrichmentService, type EnrichedPOIData } from './osm-enrichment.service'

// Service role client for database operations - Edge Functions compatible
const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
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
 * Verification source interface
 */
interface VerificationSource {
  id: string;
  name: string;
  url: string;
  source_type: string;
  country_code?: string;
  city?: string;
  priority?: number;
  is_active?: boolean;
  [key: string]: any; // For additional properties
}

/**
 * Universal processing result interface for all POI services
 * Ensures consistency across DescriptionService, TriggerPointsService, AudioService, etc.
 */
export interface ProcessingResult<T> {
  success: boolean
  data?: T
  error?: string
  processing_time: number
  metadata: {
    step: string
    model_used?: string
    tokens_consumed?: number
    quality_score?: number
    progress?: number
    status: 'pending' | 'processing' | 'completed' | 'failed'
    user_id?: string
    request_id?: string
    timestamp: string
  }
}

/**
 * Processing status for tracking progress
 */
export interface ProcessingStatus {
  step: string
  progress: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  started_at: string
  completed_at?: string
  error?: string
}

export interface POIData {
  id?: string
  // When id is provided, these fields are optional (will be fetched from database - SSOT)
  // When id is not provided, name, city, and country are required
  name?: string
  city?: string
  country?: string
  state?: string
  formatted_address?: string
  vicinity?: string
  google_types?: string[]
  rating?: number
  user_ratings_total?: number
  price_level?: number
  business_status?: string
  opening_hours?: any
  website?: string
  formatted_phone_number?: string
  photos_references?: string[]
  google_place_id?: string
  lat?: number
  lng?: number
  reference_links?: string[]
  image_url?: string
  osm_tags?: any
}

export interface DescriptionOptions {
  language?: string
  use_dynamic_sources?: boolean
  optimization_mode?: boolean
  existing_description?: string
  description_id?: string
  persist_verification?: boolean
  auto_generate_audio?: boolean
  user_id?: string
  enrich_with_osm?: boolean // New option to enable OSM enrichment
  skip_enrichment_if_exists?: boolean // Skip enrichment if data already exists
  track_progress?: boolean // New option to enable progress tracking
  status_callback?: (status: ProcessingStatus) => void // Callback for status updates
  request_id?: string // Unique request identifier
}

export interface VerificationResult {
  aprovada: boolean
  pontuacao: number
  datas_detectadas: string[]
  fatos_verificaveis: string[]
  problemas: string[]
  sugestoes_melhoria: string
}

/**
 * Description-specific data structure
 */
export interface DescriptionData {
  description: string
  verification?: VerificationResult
  description_id?: string
  audio_generation?: {
    success: boolean
    audio_url?: string
    error?: string
  }
  osm_enrichment?: {
    success: boolean
    data_quality_score?: number
    fields_updated?: string[]
    error?: string
  }
  quality_analysis?: {
    overall_score: number
    confidence_level: 'high' | 'medium' | 'low'
    justifications: {
      content_quality: number
      source_reliability: number
      factual_accuracy: number
      completeness: number
      language_quality: number
    }
    issues_found: string[]
    recommendations: string[]
    model_used: 'pro' | 'flash'
    data_richness: 'rich' | 'limited'
  }
}

/**
 * Description result using universal ProcessingResult interface
 */
export interface DescriptionResult extends ProcessingResult<DescriptionData> {
  // Inherits all ProcessingResult fields
  // data?: DescriptionData
  // success: boolean
  // error?: string
  // processing_time: number
  // metadata: { step, model_used, etc. }
}

// =====================================
// MAIN SERVICE CLASS
// =====================================

export class DescriptionService {
  
  /**
   * Acquire processing lock to prevent race conditions
   */
  private static async acquireProcessingLock(poiId: string, userId: string = 'description-service'): Promise<boolean> {
    try {
      const { data: existing, error: checkError } = await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .select('processing_lock_by, processing_lock_at')
        .eq('id', poiId)
        .single()

      if (checkError) {
        console.warn(`⚠️ Error checking lock: ${checkError.message}`)
        return false
      }

      // Check if already locked
      if (existing?.processing_lock_by && existing?.processing_lock_at) {
        const lockTime = new Date(existing.processing_lock_at)
        const now = new Date()
        const lockAge = now.getTime() - lockTime.getTime()
        const lockTimeout = 10 * 60 * 1000 // 10 minutes

        // If lock is still valid, reject
        if (lockAge < lockTimeout) {
          console.log(`🚫 POI ${poiId} is locked by ${existing.processing_lock_by} (locked ${Math.round(lockAge / 1000)}s ago)`)
          return false
        }
        // Lock expired, we can proceed
        console.log(`⏰ Lock expired for POI ${poiId}, proceeding...`)
      }

      // Acquire lock
      const { error: lockError } = await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .update({
          processing_lock_by: userId,
          processing_lock_at: new Date().toISOString()
        })
        .eq('id', poiId)

      if (lockError) {
        console.warn(`⚠️ Error acquiring lock: ${lockError.message}`)
        return false
      }

      console.log(`🔒 Lock acquired for POI ${poiId}`)
      return true

    } catch (error) {
      console.warn(`⚠️ Error in acquireProcessingLock: ${error}`)
      return false
    }
  }

  /**
   * Release processing lock
   */
  private static async releaseProcessingLock(poiId: string): Promise<void> {
    try {
      await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .update({
          processing_lock_by: null,
          processing_lock_at: null
        })
        .eq('id', poiId)

      console.log(`🔓 Lock released for POI ${poiId}`)
    } catch (error) {
      console.warn(`⚠️ Error releasing lock: ${error}`)
    }
  }

  /**
   * Check if description already exists
   */
  private static async getExistingDescription(poiId: string, language: string = 'pt-br'): Promise<any | null> {
    try {
      const { data, error } = await getSupabaseAdmin()
        .schema('core')
        .from('attraction_descriptions')
        .select('id, description, verification_status')
        .eq('attraction_id', poiId)
        .eq('language', language)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') {
        console.warn(`⚠️ Error checking existing description: ${error.message}`)
        return null
      }

      return data || null
    } catch (error) {
      console.warn(`⚠️ Error in getExistingDescription: ${error}`)
      return null
    }
  }
  
  /**
   * Generate new description for POI
   * SSOT: All data comes from core.attractions when poiData.id exists
   */
  static async generate(
    poiData: POIData, 
    options: DescriptionOptions = {}
  ): Promise<DescriptionResult> {
    const startTime = Date.now()
    let lockAcquired = false
    
    try {
      // SSOT: If ID exists, fetch ALL data from database
      if (poiData.id) {
        console.log(`📊 Fetching complete POI data from database (SSOT)...`)
        const dbPOI = await this.fetchCompletePOIData(poiData.id)
        
        if (!dbPOI || !dbPOI.name || !dbPOI.city || !dbPOI.country) {
          return {
            success: false,
            error: `POI not found in database or missing required fields: ${poiData.id}`,
            processing_time: Date.now() - startTime,
            metadata: {
              step: 'data_fetch',
              status: 'failed',
              user_id: options.user_id,
              request_id: options.request_id || `desc_${Date.now()}`,
              timestamp: new Date().toISOString()
            }
          }
        }
        
        // Override poiData with database data (database is source of truth)
        // At this point, name, city, country are guaranteed to exist
        poiData = { ...dbPOI } as POIData & { name: string; city: string; country: string }
        console.log(`✅ Using POI data from database (SSOT): ${poiData.name}`)
      }

      // At this point, if no ID was provided, name/city/country must be provided
      // If ID was provided, they were fetched from database
      if (!poiData.name || !poiData.city || !poiData.country) {
        return {
          success: false,
          error: 'Missing required parameters: name, city, country (or provide id to fetch from database)',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'validation',
            status: 'failed',
            user_id: options.user_id,
            request_id: options.request_id || `desc_${Date.now()}`,
            timestamp: new Date().toISOString()
          }
        }
      }

      console.log(`🚀 Generating description for: ${poiData.name}`)
      
      // Validate required parameters
      const validation = this.validatePOIData(poiData)
      if (!validation.valid) {
        return {
          success: false,
          error: `Missing required parameters: ${validation.missing.join(', ')}`,
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'validation',
            status: 'failed',
            user_id: options.user_id,
            request_id: options.request_id || `desc_${Date.now()}`,
            timestamp: new Date().toISOString()
          }
        }
      }

      // Check if description already exists (avoid unnecessary processing)
      if (poiData.id && !options.existing_description) {
        const existing = await this.getExistingDescription(poiData.id, options.language || 'pt-br')
        if (existing) {
          console.log(`ℹ️ Description already exists for POI ${poiData.id}, returning existing`)
          return {
            success: true,
            processing_time: Date.now() - startTime,
            data: {
              description: existing.description,
              description_id: existing.id,
              verification: {
                aprovada: existing.verification_status === 'approved',
                pontuacao: 0,
                datas_detectadas: [],
                fatos_verificaveis: [],
                problemas: [],
                sugestoes_melhoria: ''
              }
            },
            metadata: {
              step: 'existing_description',
              status: 'completed',
              user_id: options.user_id,
              request_id: options.request_id || `desc_${Date.now()}`,
              timestamp: new Date().toISOString()
            }
          }
        }
      }

      // Acquire processing lock to prevent race conditions
      if (poiData.id) {
        const userId = options.user_id || 'description-service'
        lockAcquired = await this.acquireProcessingLock(poiData.id, userId)
        
        if (!lockAcquired) {
          return {
            success: false,
            error: 'Description generation already in progress for this POI. Please wait and try again.',
            processing_time: Date.now() - startTime,
            metadata: {
              step: 'lock_acquisition',
              status: 'failed',
              user_id: options.user_id,
              request_id: options.request_id || `desc_${Date.now()}`,
              timestamp: new Date().toISOString()
            }
          }
        }
      }

      // Get API key
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
      if (!apiKey) {
        return {
          success: false,
          error: 'Gemini API key not configured',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'configuration',
            status: 'failed',
            user_id: options.user_id,
            request_id: options.request_id || `desc_${Date.now()}`,
            timestamp: new Date().toISOString()
          }
        }
      }

      let osmEnrichmentResult = null
      let enrichedData: EnrichedPOIData | null = null

      // Fetch enriched POI data from database (including OSM fields)
      console.log(`📊 Fetching enriched POI data from database...`)
      const enrichedPOIData = await this.fetchEnrichedPOIData(poiData.id || '')

      // Step 1: OSM Enrichment (if enabled)
      if (options.enrich_with_osm !== false && poiData.id) { // Default to true
        console.log(`🗺️ Checking OSM enrichment for POI: ${poiData.id}`)
        
        const needsEnrichment = options.skip_enrichment_if_exists !== false ? 
          await OSMEnrichmentService.needsEnrichment(poiData.id) : true

        if (needsEnrichment) {
          console.log(`🔄 Enriching POI with OSM data...`)
          
          // Use data from database (SSOT)
          const enrichmentInput = {
            poi_id: poiData.id,
            name: poiData.name, // From database
            city: poiData.city, // From database
            country: poiData.country, // From database
            google_place_id: poiData.google_place_id, // From database
            lat: poiData.lat, // From database
            lng: poiData.lng // From database
          }

          osmEnrichmentResult = await OSMEnrichmentService.enrichPOI(enrichmentInput)
          
          if (osmEnrichmentResult.success) {
            console.log(`✅ OSM enrichment completed (Quality: ${osmEnrichmentResult.data_quality_score}%)`)
            enrichedData = osmEnrichmentResult.enriched_data || null
          } else {
            console.log(`⚠️ OSM enrichment failed: ${osmEnrichmentResult.message}`)
          }
        } else {
          console.log(`ℹ️ POI already enriched with OSM data, retrieving existing data`)
          enrichedData = await OSMEnrichmentService.getEnrichedPOIData(poiData.id)
          osmEnrichmentResult = { success: true, message: 'Already enriched, using existing data' }
        }
      }

      // Get sources for AI analysis (but skip scraping if disabled)
      let finalSources: any[] = []
      let scrapedContent: any = null
      
      if (options.use_dynamic_sources ?? true) {
        // Full RAG enabled - get sources and scrape content
        // Get layered sources (name, city, country guaranteed at this point)
        const layeredSources = await this.getLayeredSources(
          poiData.city!, 
          poiData.country!, 
          options.use_dynamic_sources ?? true
        )
        
        console.log(`📚 Found ${layeredSources.length} layered sources for ${poiData.city}, ${poiData.country}`)

        // Check city cache first (FASE 3)
        const cityCache = await this.getCityRAGCache(poiData.city!, poiData.country!)
        finalSources = layeredSources

        if (cityCache && this.isCacheValid(cityCache)) {
          console.log(`🚀 Using cached RAG data for ${poiData.city}`)
          finalSources = cityCache.sources_found?.sources || layeredSources
          scrapedContent = cityCache.scraped_content
          await this.updateCacheUsage(cityCache.id)
        } else {
        console.log(`🔍 No valid cache found for ${poiData.city}, processing fresh data`)
        
        // Save RAG sources to database for future use
        if (layeredSources.length > 0) {
          await this.saveRAGSources(poiData.id || '', layeredSources, enrichedPOIData)
        }

        // FASE 1: RAG ATIVO - Scrape content from discovered sources + reference links
        const allSourcesToScrape = [...layeredSources]
        
        // Add reference links as high-priority sources
        if (enrichedPOIData.reference_links && enrichedPOIData.reference_links.length > 0) {
          const referenceLinkSources = enrichedPOIData.reference_links
            .filter((link: string) => link && link.trim())
            .slice(0, 3) // Limit to 3 reference links
            .map((link: string, index: number) => ({
              source_name: `User Reference Link ${index + 1}`,
              source_type: 'reference',
              layer: 'user',
              base_url: link.trim(),
              priority: 1 // Highest priority
            }))
          
          console.log(`🔗 Adding ${referenceLinkSources.length} reference link(s) to scraping queue`)
          allSourcesToScrape.unshift(...referenceLinkSources) // Add at the beginning (highest priority)
        }
        
        if (allSourcesToScrape.length > 0) {
          console.log(`🌐 Starting active RAG - scraping content from ${allSourcesToScrape.length} sources (${layeredSources.length} layered + ${allSourcesToScrape.length - layeredSources.length} reference links)`)
          scrapedContent = await this.scrapeSourcesContent(allSourcesToScrape, poiData)
          
          // Save scraped content
          await this.saveScrapedContent(poiData.id || '', scrapedContent)
          
          // Update city cache (only with layered sources, not reference links)
          await this.updateCityCache(poiData.city!, poiData.country!, poiData.state, layeredSources, scrapedContent)
        }
        }
      } else {
        // RAG disabled but provide sources for AI analysis (no scraping)
        console.log('🔗 RAG scraping disabled - providing sources for AI analysis only')
        
        const layeredSources = await this.getLayeredSources(
          poiData.city!, 
          poiData.country!, 
          false // Don't use dynamic sources for scraping
        )
        
        finalSources = layeredSources
        console.log(`🔗 Found ${finalSources.length} sources for AI to analyze (no scraping)`)
      }

      // Build optimized content section - prioritize processed data over raw URLs
      const hasProcessedContent = scrapedContent?.scraped_sources?.some((s: any) => s.success)
      
      let sourcesSection = ''
      let scrapedContentSection = ''
      
      if (hasProcessedContent) {
        // ✅ OTIMIZADO: Use processed content instead of raw URLs
        console.log('📊 Using processed content from database (optimized)')
        scrapedContentSection = this.buildOptimizedContentSection(scrapedContent, enrichedPOIData)
        // Only show source attribution, not full URLs
        sourcesSection = this.buildSourceAttribution(finalSources)
      } else {
        // ❌ FALLBACK: Use traditional URL-based approach
        console.log('🔗 Using traditional URL-based sources (fallback)')
        // SSOT: Use only database data (no fallback to frontend)
        sourcesSection = this.buildSourcesSection(
          finalSources, 
          enrichedPOIData.website, // Only from database
          enrichedPOIData.reference_links || [] // Only from database
        )
      }
      
      // Create optimized prompt (KISS: Direct data passing, no intermediate formatting)
      const prompt = this.createOptimizedPrompt({
        name: poiData.name,
        poiData, // SSOT: All data comes from database when id exists
        sourcesSection,
        scrapedContentSection,
        existingDescription: options.existing_description,
        existingTokens: [], // TODO: Implement token system if needed
        optimizationMode: options.optimization_mode ?? true,
        enrichedData,
        layeredSources: finalSources, // Pass layered sources for compact format
        enrichedPOIData // Pass enriched data for prompt building
      })

      // Log prompt summary
      console.log(`📝 Generated prompt: ${prompt.length} characters`)

      // Generate description using Gemini (with intelligent model selection)
      const description = await this.generateWithGemini(prompt, apiKey, sourcesSection, enrichedPOIData, scrapedContentSection, poiData)
      
      // Log Gemini response summary
      console.log(`🤖 Gemini response: ${description?.length || 0} characters`)
      
      if (!description) {
        return {
          success: false,
          error: 'Failed to generate description with Gemini API',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'generation',
            status: 'failed',
            user_id: options.user_id,
            request_id: options.request_id || `desc_${Date.now()}`,
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // Calculate description quality score and justifications
      const qualityAnalysis = this.calculateDescriptionQualityScore(
        description, 
        poiData, 
        finalSources, 
        enrichedPOIData, 
        scrapedContent
      )

      // Verify generated description (name guaranteed at this point)
      const verification = await this.verifyGeneratedDescription(description, poiData.name!, apiKey)

      const result: DescriptionResult = {
        success: true,
        processing_time: Date.now() - startTime,
        data: {
          description,
          verification,
          osm_enrichment: osmEnrichmentResult ? {
            success: osmEnrichmentResult.success,
            data_quality_score: osmEnrichmentResult.data_quality_score,
            fields_updated: osmEnrichmentResult.fields_updated,
            error: osmEnrichmentResult.success ? undefined : osmEnrichmentResult.error
          } : undefined,
          quality_analysis: qualityAnalysis
        },
        metadata: {
          step: 'description_generation',
          model_used: qualityAnalysis?.model_used || 'unknown',
          quality_score: qualityAnalysis?.overall_score || 0,
          progress: 100,
          status: 'completed',
          user_id: options.user_id,
          request_id: options.request_id || `desc_${Date.now()}`,
          timestamp: new Date().toISOString()
        }
      }

      // Save description if attraction ID provided
      if (poiData.id && options.persist_verification !== false) {
        const saveResult = await this.saveDescription(
          poiData.id,
          description,
          verification,
          options.language ?? 'pt-br',
          options.description_id,
          qualityAnalysis
        )
        
        if (saveResult.success) {
          if (result.data) {
            result.data.description_id = saveResult.description_id
            
            // Generate audio if enabled and description approved
            if (options.auto_generate_audio && verification.aprovada && verification.pontuacao >= 75) {
              result.data.audio_generation = await this.generateAudio(poiData.id, description, options.language ?? 'pt-br')
            }
          }
        }
      }

      return result

    } catch (error: any) {
      console.error('❌ Error generating description:', error)
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'exception_handling',
          status: 'failed',
          user_id: options.user_id,
          request_id: options.request_id || `desc_${Date.now()}`,
          timestamp: new Date().toISOString()
        }
      }
    } finally {
      // Always release lock if acquired
      if (lockAcquired && poiData.id) {
        await this.releaseProcessingLock(poiData.id)
      }
    }
  }

  /**
   * Improve existing description
   */
  static async improve(
    poiData: POIData,
    existingDescription: string,
    options: DescriptionOptions = {}
  ): Promise<DescriptionResult> {
    console.log(`🔄 Improving existing description for: ${poiData.name}`)
    
    return this.generate(poiData, {
      ...options,
      existing_description: existingDescription
    })
  }

  /**
   * Validate description quality without generating
   */
  static async validate(
    description: string,
    poiName: string
  ): Promise<VerificationResult> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('Gemini API key not configured')
    }

    return this.verifyGeneratedDescription(description, poiName, apiKey)
  }

  // =====================================
  // PRIVATE HELPER METHODS
  // =====================================

  /**
   * Shared utility: Check if a value is valid (not null, undefined, or empty string)
   * DRY: Single source for validation logic used across all build functions
   */
  private static isValid(value: any): boolean {
    if (value === null || value === undefined) return false
    if (typeof value === 'string' && value.trim() === '') return false
    return true
  }

  /**
   * Validate POI data has required fields
   */
  private static validatePOIData(poiData: POIData): { valid: boolean; missing: string[] } {
    // If ID exists, validation will happen after fetching from database (SSOT)
    if (poiData.id) {
      return { valid: true, missing: [] }
    }
    
    // If no ID, require name, city, and country
    const required = ['name', 'city', 'country']
    const missing = required.filter(field => !poiData[field as keyof POIData])
    
    return {
      valid: missing.length === 0,
      missing
    }
  }

  /**
   * Get layered sources for location with full RAG implementation
   */
  private static async getLayeredSources(
    city: string, 
    country: string, 
    useDynamicSources: boolean = true
  ): Promise<any[]> {
    try {
      if (!useDynamicSources) {
        return this.getFallbackSources(country)
      }

      // Enhanced country mapping
      const countryCodeMap: Record<string, string> = {
        'Brazil': 'BR', 'Brasil': 'BR',
        'España': 'ES', 'Spain': 'ES', 'Espanha': 'ES',
        'United States': 'US', 'USA': 'US', 'Estados Unidos': 'US',
        'Ireland': 'IE', 'Irlanda': 'IE',
        'México': 'MX', 'Mexico': 'MX',
        'Chile': 'CL',
        'Argentina': 'AR',
        'Colombia': 'CO', 'Colômbia': 'CO',
        'Peru': 'PE', 'Perú': 'PE',
        'Portugal': 'PT',
        'France': 'FR', 'França': 'FR',
        'Italy': 'IT', 'Itália': 'IT',
        'Germany': 'DE', 'Alemanha': 'DE',
        'United Kingdom': 'GB', 'Reino Unido': 'GB'
      }

      const countryCode = countryCodeMap[country] || country.toUpperCase()
      
      console.log(`🔍 Fetching layered sources for ${city}, ${countryCode}`)

      // Get layered sources from database using RPC
      const { data: layeredSources, error: layeredError } = await getSupabaseAdmin()
        .schema('core')
        .rpc('get_verification_sources_layered', {
          p_city_name: city,
          p_country_code: countryCode,
          p_limit: 8
        })
        
      // Prioritize city sources over national ones
      if (layeredSources) {
        layeredSources.sort((a: any, b: any) => {
          // First criterion: city sources before national
          if (a.layer === 'city' && b.layer !== 'city') return -1
          if (a.layer !== 'city' && b.layer === 'city') return 1
          // Second criterion: priority (lower number = higher priority)
          return (a.priority || 10) - (b.priority || 10)
        })
      }

      let sources = layeredSources || []

      // If layered sources are limited, try individual country sources
      if (!sources.length || sources.length < 3) {
        console.log('🔄 Layered sources limited, fetching country sources...')
        
        const { data: countrySources, error: countryError } = await getSupabaseAdmin()
          .schema('core')
          .from('country_verification_sources')
          .select(`
            source_name,
            source_type,
            base_url,
            search_endpoint,
            priority
          `)
          .eq('country_code', countryCode)
          .eq('is_active', true)
          .order('priority', { ascending: true })
          .limit(8)

        if (countrySources && countrySources.length > 0) {
          // Add layer info to country sources
          const sourcesWithLayer = countrySources.map((s: VerificationSource) => ({ ...s, layer: 'national' }))
          sources = [...sources, ...sourcesWithLayer]
        }
      }

      // Add fallback sources if we still have few sources
      if (sources.length < 2) {
        sources = [...sources, ...this.getFallbackSources(countryCode)]
      }

      console.log(`✅ Found ${sources.length} verification sources for ${city}, ${countryCode}`)
      return sources.slice(0, 8) // Limit to 8 sources max

    } catch (error) {
      console.warn('⚠️ Error in getLayeredSources:', error)
      return this.getFallbackSources(country)
    }
  }

  /**
   * Fetch complete POI data from database (SSOT - Single Source of Truth)
   * SSOT: Unified function that fetches ALL POI data in a single query
   * When poiId is provided, ALL data comes from core.attractions table
   */
  private static async fetchCompletePOIData(poiId: string): Promise<POIData | null> {
    try {
      const { data: poi, error } = await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          city,
          country,
          state,
          formatted_address,
          vicinity,
          website,
          reference_links,
          google_place_id,
          google_types,
          rating,
          user_ratings_total,
          price_level,
          business_status,
          formatted_phone_number,
          international_phone_number,
          opening_hours,
          image_url,
          photos_references,
          osm_tags,
          osm_wikipedia_url,
          contact_phone,
          contact_email,
          heritage_status,
          unesco_status,
          unesco_inscription_date,
          architectural_style,
          historical_period,
          landmark_type,
          architect,
          construction_status,
          completion_estimated_year,
          landmark_level,
          importance_level,
          cultural_significance,
          osm_category,
          osm_description,
          monument_type,
          commemorated_event,
          commemorated_person,
          building_colour,
          roof_colour,
          building_material,
          attraction_coordinate!inner(latitude, longitude)
        `)
        .eq('id', poiId)
        .single()

      if (error || !poi) {
        console.warn(`⚠️ Error fetching complete POI data: ${error?.message || 'POI not found'}`)
        return null
      }

      // Map database data to POIData interface (SSOT: single mapping point)
      return {
        id: poi.id,
        name: poi.name,
        city: poi.city,
        country: poi.country,
        state: poi.state,
        formatted_address: poi.formatted_address,
        vicinity: poi.vicinity,
        website: poi.website,
        reference_links: poi.reference_links || [],
        google_place_id: poi.google_place_id,
        google_types: poi.google_types || [],
        rating: poi.rating,
        user_ratings_total: poi.user_ratings_total,
        price_level: poi.price_level,
        business_status: poi.business_status,
        formatted_phone_number: poi.formatted_phone_number,
        opening_hours: poi.opening_hours,
        image_url: poi.image_url,
        photos_references: poi.photos_references,
        osm_tags: poi.osm_tags,
        lat: poi.attraction_coordinate?.[0]?.latitude,
        lng: poi.attraction_coordinate?.[0]?.longitude
      }

    } catch (error) {
      console.warn(`⚠️ Error in fetchCompletePOIData: ${error}`)
      return null
    }
  }

  /**
   * Fetch enriched POI data from database (including OSM fields)
   * SSOT: Single query fetches all data (basic + enriched) to avoid duplication
   * Returns enriched data with OSM fields for prompt building
   */
  private static async fetchEnrichedPOIData(poiId: string): Promise<any> {
    try {
      // SSOT: Single query for all data (basic + enriched fields)
      const { data: enrichedPOI, error } = await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          city,
          country,
          state,
          website,
          reference_links,
          google_place_id,
          google_types,
          rating,
          user_ratings_total,
          price_level,
          business_status,
          formatted_phone_number,
          international_phone_number,
          opening_hours,
          osm_wikipedia_url,
          contact_phone,
          contact_email,
          heritage_status,
          unesco_status,
          unesco_inscription_date,
          architectural_style,
          historical_period,
          landmark_type,
          architect,
          construction_status,
          completion_estimated_year,
          landmark_level,
          importance_level,
          cultural_significance,
          osm_category,
          osm_tags,
          osm_description,
          monument_type,
          commemorated_event,
          commemorated_person,
          building_colour,
          roof_colour,
          building_material
        `)
        .eq('id', poiId)
        .single()

      if (error || !enrichedPOI) {
        console.warn(`⚠️ Error fetching enriched POI data: ${error?.message || 'POI not found'}`)
        return {}
      }

      console.log(`📊 Fetched enriched POI data:`, {
        has_website: !!enrichedPOI.website,
        has_reference_links: !!(enrichedPOI.reference_links && enrichedPOI.reference_links.length > 0),
        reference_links_count: enrichedPOI.reference_links?.length || 0,
        has_osm_wikipedia: !!enrichedPOI.osm_wikipedia_url,
        has_contact_info: !!(enrichedPOI.contact_phone || enrichedPOI.contact_email),
        heritage_status: enrichedPOI.heritage_status,
        unesco_status: enrichedPOI.unesco_status,
        architectural_style: enrichedPOI.architectural_style,
        landmark_level: enrichedPOI.landmark_level,
        cultural_significance: enrichedPOI.cultural_significance
      })
      
      // Log reference links if available
      if (enrichedPOI.reference_links && enrichedPOI.reference_links.length > 0) {
        console.log(`🔗 Reference links from DB:`, enrichedPOI.reference_links)
      }

      return enrichedPOI || {}

    } catch (error) {
      console.warn(`⚠️ Error in fetchEnrichedPOIData: ${error}`)
      return {}
    }
  }

  /**
   * Get fallback sources when database sources are not available
   */
  private static getFallbackSources(countryCode: string): any[] {
    const fallbackSources: Record<string, any[]> = {
      'BR': [
        { source_name: 'IPHAN', source_type: 'heritage', layer: 'national', base_url: 'portal.iphan.gov.br', priority: 1 },
        { source_name: 'Ministério do Turismo', source_type: 'government', layer: 'national', base_url: 'turismo.gov.br', priority: 2 }
      ],
      'US': [
        { source_name: 'National Park Service', source_type: 'heritage', layer: 'national', base_url: 'nps.gov', priority: 1 },
        { source_name: 'Visit USA', source_type: 'tourism', layer: 'national', base_url: 'visitusa.com', priority: 2 }
      ],
      'ES': [
        { source_name: 'Patrimonio Nacional', source_type: 'heritage', layer: 'national', base_url: 'patrimonionacional.es', priority: 1 },
        { source_name: 'Spain Tourism', source_type: 'tourism', layer: 'national', base_url: 'spain.info', priority: 2 }
      ]
    }

    return fallbackSources[countryCode] || [
      { source_name: 'UNESCO World Heritage', source_type: 'heritage', layer: 'international', base_url: 'whc.unesco.org', priority: 1 },
      { source_name: 'Wikipedia', source_type: 'encyclopedia', layer: 'international', base_url: 'wikipedia.org', priority: 2 }
    ]
  }

  /**
   * Build sources section for prompt
   */
  private static buildSourcesSection(
    layeredSources: any[], 
    website?: string, 
    referenceLinks?: string[]
  ): string {
    const lines: string[] = []

    const add = (label: string, items: any[], take: number) => {
      if (!items.length) return
      lines.push(label)
      items.slice(0, take).forEach(s => {
        const layer = s.layer ? ` [${String(s.layer).toUpperCase()}]` : ''
        const url = s.base_url ? ` - ${s.base_url}` : ''
        lines.push(`- ${s.source_name} (${s.source_type}${layer})${url}`)
      })
    }

    // PRIORITY ORDER:
    // 1. Official website (if available)
    // 2. User-provided references
    // 3. City/municipal sources
    // 4. National sources

    // 1. Official website
    if (website) {
      lines.push('🌐 OFFICIAL WEBSITE:')
      lines.push(`- ${website} (primary source)`)
    }

    // 2. User references (from POI reference_links field in database)
    const validLinks = (referenceLinks || []).filter(link => link && link.trim()).slice(0, 3)
    if (validLinks.length) {
      console.log(`🔗 Using ${validLinks.length} reference link(s) from database:`, validLinks)
      lines.push('🔗 USER REFERENCES (HIGH PRIORITY):')
      validLinks.forEach(link => lines.push(`- ${link}`))
    } else if (referenceLinks && referenceLinks.length > 0) {
      console.log(`⚠️ Reference links found but all empty/invalid:`, referenceLinks)
    }

    if (layeredSources.length > 0) {
      // Separate sources by type and layer
      const byTypeAndLayer = (type: string, layer: string) => layeredSources
        .filter((s: any) => s.source_type === type && s.layer === layer)
        .sort((a: any, b: any) => (a.priority || 10) - (b.priority || 10))
      
      // 3. City sources
      add('🏛️ CITY HERITAGE & GOV:', [
        ...byTypeAndLayer('heritage', 'city'),
        ...byTypeAndLayer('government', 'city')
      ], 3)
      
      // Other city sources
      const cityAcademic = byTypeAndLayer('academic', 'city')
      const cityLocal = byTypeAndLayer('local', 'city')
      const cityMedia = byTypeAndLayer('media', 'city')
      
      if ([...cityAcademic, ...cityLocal, ...cityMedia].length > 0) {
        add('📍 OTHER CITY SOURCES:', [
          ...cityAcademic,
          ...cityLocal, 
          ...cityMedia
        ], 2)
      }
      
      // 4. National sources (HIGHEST PRIORITY - IPHAN, UNESCO, IBRAM, etc.)
      const nationalHeritage = byTypeAndLayer('heritage', 'national')
      const nationalGov = byTypeAndLayer('government', 'national')
      
      // Prioritize well-known heritage/government sources
      const prioritySources = ['IPHAN', 'UNESCO', 'IBRAM', 'Ministério do Turismo', 'Patrimônio Nacional']
      const prioritizedHeritage = [
        ...nationalHeritage.filter((s: any) => prioritySources.some(p => s.source_name?.includes(p))),
        ...nationalHeritage.filter((s: any) => !prioritySources.some(p => s.source_name?.includes(p)))
      ]
      const prioritizedGov = [
        ...nationalGov.filter((s: any) => prioritySources.some(p => s.source_name?.includes(p))),
        ...nationalGov.filter((s: any) => !prioritySources.some(p => s.source_name?.includes(p)))
      ]
      
      add('🏛️ NATIONAL HERITAGE & GOV (HIGHEST PRIORITY - IPHAN, UNESCO, IBRAM):', [
        ...prioritizedHeritage,
        ...prioritizedGov
      ], 3)
      
      // Other national sources
      const byType = (t: string) => layeredSources
        .filter((s: any) => s.source_type === t && s.layer === 'national')
        .sort((a: any, b: any) => (a.priority || 10) - (b.priority || 10))
      
      add('🎓 NATIONAL ACADEMIC & OFFICIAL:', [...byType('academic'), ...byType('official')], 2)
    }

    if (!lines.length) {
      lines.push('📚 SOURCES: UNESCO, IPHAN, IBRAM, government heritage, official tourism, Wikipedia')
    }

    lines.push('')
    lines.push('⚠️ CRITICAL VERIFICATION:')
    lines.push('- Use ONLY facts explicitly confirmed by the sources above')
    lines.push('- Government and heritage sources (IPHAN, UNESCO, IBRAM) are MOST RELIABLE - prioritize them')
    lines.push('- If a fact is not in these sources, OMIT it entirely - never invent or assume')
    lines.push('- Every date, fact, or curiosity MUST be traceable to a source listed above')
    return lines.join('\n')
  }

  /**
   * Build enriched POI data section for prompt
   * Optimized to include only valid, non-null fields from homolog.pois schema
   */
  private static buildEnrichedPOIDataSection(enrichedData: any): string {
    const sections: string[] = []

    // Helper to check if value is valid (not null, not empty, not 'none')
    // DRY: Uses shared isValid utility
    const isValid = (value: any): boolean => {
      if (!this.isValid(value)) return false
      if (typeof value === 'string' && value === 'none') return false
      return true
    }

    // 🌐 OFFICIAL SOURCES FROM DATABASE (Priority 1)
    if (enrichedData.website || enrichedData.osm_wikipedia_url || enrichedData.wikipedia) {
      sections.push('🌐 FONTES OFICIAIS:')
      if (enrichedData.website) {
        sections.push(`- Site oficial: ${enrichedData.website}`)
      }
      if (enrichedData.osm_wikipedia_url || enrichedData.wikipedia) {
        sections.push(`- Wikipedia: ${enrichedData.osm_wikipedia_url || enrichedData.wikipedia}`)
      }
      if (enrichedData.wikidata) {
        sections.push(`- Wikidata: ${enrichedData.wikidata}`)
      }
    }

    // 📅 DATAS E PERÍODOS HISTÓRICOS (Priority 2 - Critical for descriptions)
    const temporalInfo = []
    if (isValid(enrichedData.start_date)) {
      temporalInfo.push(`Data de construção/inauguração: ${enrichedData.start_date}`)
    }
    if (isValid(enrichedData.historic_period)) {
      temporalInfo.push(`Período histórico: ${enrichedData.historic_period}`)
    }
    if (isValid(enrichedData.completion_estimated_year)) {
      temporalInfo.push(`Ano de conclusão: ${enrichedData.completion_estimated_year}`)
    }
    if (isValid(enrichedData.unesco_inscription_date)) {
      temporalInfo.push(`Inscrição UNESCO: ${enrichedData.unesco_inscription_date}`)
    }
    
    if (temporalInfo.length > 0) {
      sections.push('📅 INFORMAÇÕES TEMPORAIS:')
      temporalInfo.forEach(info => sections.push(`- ${info}`))
    }

    // 🏛️ HERITAGE & UNESCO STATUS (Priority 3 - Only if confirmed)
    if (isValid(enrichedData.heritage_status)) {
      sections.push('🏛️ STATUS PATRIMONIAL:')
      sections.push(`- Nível: ${enrichedData.heritage_status}`)
      
      if (isValid(enrichedData.unesco_status)) {
        sections.push(`- UNESCO: ${enrichedData.unesco_status}`)
      }
    }

    // 🏗️ DETALHES ARQUITETÔNICOS (Priority 4)
    const architecturalInfo = []
    if (isValid(enrichedData.architectural_style)) {
      architecturalInfo.push(`Estilo: ${enrichedData.architectural_style}`)
    }
    if (isValid(enrichedData.architect)) {
      architecturalInfo.push(`Arquiteto: ${enrichedData.architect}`)
    }
    if (isValid(enrichedData.historical_period)) {
      architecturalInfo.push(`Período: ${enrichedData.historical_period}`)
    }
    if (isValid(enrichedData.building_material)) {
      architecturalInfo.push(`Material: ${enrichedData.building_material}`)
    }
    if (isValid(enrichedData.height)) {
      architecturalInfo.push(`Altura: ${enrichedData.height}m`)
    }
    
    if (architecturalInfo.length > 0) {
      sections.push('🏗️ INFORMAÇÕES ARQUITETÔNICAS:')
      architecturalInfo.forEach(info => sections.push(`- ${info}`))
    }

    // 🎭 INFORMAÇÕES CULTURAIS E MONUMENTOS (Priority 5)
    const culturalInfo = []
    if (isValid(enrichedData.cultural_significance) && enrichedData.cultural_significance !== 'low') {
      culturalInfo.push(`Significância cultural: ${enrichedData.cultural_significance}`)
    }
    if (isValid(enrichedData.monument_type)) {
      culturalInfo.push(`Tipo de monumento: ${enrichedData.monument_type}`)
      }
    if (isValid(enrichedData.monument_event)) {
      culturalInfo.push(`Evento: ${enrichedData.monument_event}`)
    }
    if (isValid(enrichedData.monument_person)) {
      culturalInfo.push(`Homenageado: ${enrichedData.monument_person}`)
      }
    if (isValid(enrichedData.landmark_type)) {
      culturalInfo.push(`Tipo de marco: ${enrichedData.landmark_type}`)
    }
    
    if (culturalInfo.length > 0) {
      sections.push('🎭 INFORMAÇÕES CULTURAIS:')
      culturalInfo.forEach(info => sections.push(`- ${info}`))
    }

    // 🏛️ TIPOS ESPECÍFICOS POR CATEGORIA (Priority 6)
    const typeSpecificInfo = []
    if (isValid(enrichedData.museum_type)) {
      typeSpecificInfo.push(`Tipo de museu: ${enrichedData.museum_type}`)
    }
    if (isValid(enrichedData.museum_collection)) {
      typeSpecificInfo.push(`Coleção: ${enrichedData.museum_collection}`)
    }
    if (isValid(enrichedData.leisure_type)) {
      typeSpecificInfo.push(`Tipo de lazer: ${enrichedData.leisure_type}`)
    }
    if (isValid(enrichedData.natural_type)) {
      typeSpecificInfo.push(`Tipo natural: ${enrichedData.natural_type}`)
      }
    if (isValid(enrichedData.natural_water)) {
      typeSpecificInfo.push(`Tipo de água: ${enrichedData.natural_water}`)
    }
    
    if (typeSpecificInfo.length > 0) {
      sections.push('🏛️ TIPOS ESPECÍFICOS:')
      typeSpecificInfo.forEach(info => sections.push(`- ${info}`))
    }

    // 🎨 CARACTERÍSTICAS FÍSICAS (Priority 7 - Lower priority)
    const physicalInfo = []
    if (isValid(enrichedData.building_colour)) {
      physicalInfo.push(`Cor do edifício: ${enrichedData.building_colour}`)
    }
    if (isValid(enrichedData.roof_colour)) {
      physicalInfo.push(`Cor do telhado: ${enrichedData.roof_colour}`)
    }
    
    if (physicalInfo.length > 0) {
      sections.push('🎨 CARACTERÍSTICAS FÍSICAS:')
      physicalInfo.forEach(info => sections.push(`- ${info}`))
    }

    // 🗺️ DESCRIÇÃO OSM (Priority 8 - Direct factual content)
    if (isValid(enrichedData.osm_description) && enrichedData.osm_description.length > 20) {
      sections.push('🗺️ INFORMAÇÃO OSM:')
      sections.push(`- ${enrichedData.osm_description}`)
    }

    // Return formatted sections or empty message
    if (sections.length === 0) {
      return 'Nenhum dado enriquecido disponível no banco de dados.'
    }

    return sections.join('\n')
  }

  /**
   * Build location details string
   * Note: city and country are guaranteed at this point (validated in generate())
   */
  private static buildLocationDetails(poiData: POIData): string {
    const parts = [poiData.city!, poiData.state, poiData.country!].filter(Boolean)
    return parts.join(', ')
  }

  /**
   * Build POI data section for prompt (optimized from homolog.pois schema)
   * Only includes valid, non-null fields relevant for descriptions
   */
  private static buildPOIDataSection(poiData: any): string {
    const sections: string[] = []
    
    // DRY: Uses shared isValid utility

    // Basic info (always included if available)
    sections.push(`Nome: ${poiData.name || 'N/A'}`)
    
    const locationParts = [poiData.city, poiData.state, poiData.country].filter(Boolean)
    if (locationParts.length > 0) {
      sections.push(`Local: ${locationParts.join(', ')}`)
    }
    
    if (this.isValid(poiData.neighborhood)) {
      sections.push(`Bairro: ${poiData.neighborhood}`)
    }

    // Category info
    if (this.isValid(poiData.primary_category)) {
      sections.push(`Categoria: ${poiData.primary_category}`)
    } else if (this.isValid(poiData.category)) {
      sections.push(`Categoria: ${poiData.category}`)
    }

    // Historical/temporal data (high priority)
    if (this.isValid(poiData.start_date)) {
      sections.push(`Data de construção/inauguração: ${poiData.start_date}`)
    }
    if (this.isValid(poiData.historic_period)) {
      sections.push(`Período histórico: ${poiData.historic_period}`)
    }

    // Architectural data (if building/structure)
    if (this.isValid(poiData.architectural_style)) {
      sections.push(`Estilo arquitetônico: ${poiData.architectural_style}`)
    }
    if (this.isValid(poiData.architect)) {
      sections.push(`Arquiteto: ${poiData.architect}`)
    }
    if (this.isValid(poiData.building_material)) {
      sections.push(`Material: ${poiData.building_material}`)
    }
    if (this.isValid(poiData.height)) {
      sections.push(`Altura: ${poiData.height}m`)
    }

    // Type-specific data (only if relevant to category)
    if (poiData.category === 'monument' || poiData.primary_category === 'monument') {
      if (this.isValid(poiData.monument_type)) {
        sections.push(`Tipo de monumento: ${poiData.monument_type}`)
      }
      if (this.isValid(poiData.monument_event)) {
        sections.push(`Evento: ${poiData.monument_event}`)
      }
      if (this.isValid(poiData.monument_person)) {
        sections.push(`Homenageado: ${poiData.monument_person}`)
      }
    }

    if (poiData.category === 'museum' || poiData.primary_category === 'museum') {
      if (this.isValid(poiData.museum_type)) {
        sections.push(`Tipo de museu: ${poiData.museum_type}`)
      }
      if (this.isValid(poiData.museum_collection)) {
        sections.push(`Coleção: ${poiData.museum_collection}`)
      }
    }

    if (poiData.category === 'park' || poiData.primary_category === 'park' || poiData.category === 'leisure') {
      if (this.isValid(poiData.leisure_type)) {
        sections.push(`Tipo de lazer: ${poiData.leisure_type}`)
      }
    }

    if (poiData.category === 'natural' || poiData.primary_category === 'natural') {
      if (this.isValid(poiData.natural_type)) {
        sections.push(`Tipo natural: ${poiData.natural_type}`)
      }
      if (this.isValid(poiData.natural_water)) {
        sections.push(`Tipo de água: ${poiData.natural_water}`)
      }
    }

    // Cultural significance
    if (this.isValid(poiData.cultural_significance) && poiData.cultural_significance !== 'low') {
      sections.push(`Significância cultural: ${poiData.cultural_significance}`)
    }

    // Heritage status (only if confirmed)
    if (this.isValid(poiData.heritage_status) && poiData.heritage_status !== 'none') {
      sections.push(`Status patrimonial: ${poiData.heritage_status}`)
    }
    if (this.isValid(poiData.unesco_status) && poiData.unesco_status !== 'none') {
      sections.push(`UNESCO: ${poiData.unesco_status}`)
      if (this.isValid(poiData.unesco_inscription_date)) {
        sections.push(`Inscrição UNESCO: ${poiData.unesco_inscription_date}`)
      }
    }

    // Reference sources (always include if available)
    if (this.isValid(poiData.website)) {
      sections.push(`Site oficial: ${poiData.website}`)
    }
    if (this.isValid(poiData.wikipedia)) {
      sections.push(`Wikipedia: ${poiData.wikipedia}`)
    }
    if (this.isValid(poiData.wikidata)) {
      sections.push(`Wikidata: ${poiData.wikidata}`)
    }

    return sections.join('\n')
  }

  /**
   * Build OSM data section for prompt (optimized for relevance)
   */
  private static buildOSMDataSection(enrichedData: EnrichedPOIData): string {
    const essentialInfo: string[] = []

    // 🏛️ PRIORITY 1: Heritage/UNESCO (most important for descriptions)
    if (enrichedData.heritage_status === 'unesco_world_heritage' || enrichedData.unesco_status === 'world_heritage_site') {
      essentialInfo.push('UNESCO World Heritage Site')
    } else if (enrichedData.heritage_status === 'national_heritage') {
      essentialInfo.push('National Heritage Site')
    } else if (enrichedData.heritage_status && enrichedData.heritage_status !== 'none') {
      essentialInfo.push(`Heritage: ${enrichedData.heritage_status}`)
    }

    // 📅 PRIORITY 2: Construction date (critical for historical context)
    if (enrichedData.completion_estimated_year) {
      essentialInfo.push(`Built: ${enrichedData.completion_estimated_year}`)
    }

    // 🏗️ PRIORITY 3: Architectural style (adds character to description)
    if (enrichedData.architectural_style) {
      essentialInfo.push(`Style: ${enrichedData.architectural_style}`)
    }

    // 👤 PRIORITY 4: Architect (adds prestige and context)
    if (enrichedData.architect) {
      essentialInfo.push(`Architect: ${enrichedData.architect}`)
    }

    // 🎯 PRIORITY 5: Landmark type and importance level (helps categorize)
    if (enrichedData.landmark_type && !['building', 'structure', 'place'].includes(enrichedData.landmark_type)) {
      essentialInfo.push(`Type: ${enrichedData.landmark_type}`)
    }
    
    // Add importance level if significant (>= 6 means national/international)
    if (enrichedData.landmark_level && enrichedData.landmark_level >= 6) {
      const levelDescription = enrichedData.landmark_level >= 8 ? 'international' : 'national'
      essentialInfo.push(`Importance: ${levelDescription}`)
    }

    // 📖 PRIORITY 6: OSM Description (direct factual content)
    if (enrichedData.osm_description && enrichedData.osm_description.length > 20) {
      essentialInfo.push(`OSM Info: "${enrichedData.osm_description}"`)
    }

    // 📚 PRIORITY 7: Wikipedia reference (for additional context)
    if (enrichedData.osm_wikipedia_url) {
      essentialInfo.push(`Wikipedia: ${enrichedData.osm_wikipedia_url}`)
    }

    // Return compact format if we have essential info
    if (essentialInfo.length > 0) {
      return `OSM DATA: ${essentialInfo.join(' | ')}\n`
    }

    return ''
  }

  /**
   * Build Google data section
   */
  private static buildGoogleDataSection(poiData: POIData): string {
    const googleInfo: string[] = []
    
    if (poiData.google_types && poiData.google_types.length > 0) {
      googleInfo.push(`Types: ${poiData.google_types.join(', ')}`)
    }
    
    if (poiData.rating) {
      googleInfo.push(`Rating: ${poiData.rating}/5`)
    }
    
    if (poiData.user_ratings_total) {
      googleInfo.push(`Reviews: ${poiData.user_ratings_total}`)
    }
    
    if (poiData.price_level) {
      googleInfo.push(`Price Level: ${poiData.price_level}/4`)
    }
    
    return googleInfo.join(', ') || 'No Google data available'
  }

  /**
   * Build compact JSON format for location data (token optimization)
   */
  private static buildLocationDetailsCompact(poiData: POIData): string {
    const data: any = {
      n: poiData.name,
      c: poiData.city,
      s: poiData.state,
      co: poiData.country
    }
    // Remove null/undefined values
    Object.keys(data).forEach(key => data[key] == null && delete data[key])
    return JSON.stringify(data)
  }

  /**
   * Build compact JSON format for POI database data (token optimization)
   */
  private static buildPOIDataSectionCompact(poiData: any): string {
    const data: any = {}
    
    // DRY: Uses shared isValid utility

    // Use short keys to save tokens
    if (this.isValid(poiData.name)) data.n = poiData.name
    if (this.isValid(poiData.city)) data.c = poiData.city
    if (this.isValid(poiData.state)) data.s = poiData.state
    if (this.isValid(poiData.country)) data.co = poiData.country
    if (this.isValid(poiData.neighborhood)) data.b = poiData.neighborhood
    if (this.isValid(poiData.primary_category)) data.cat = poiData.primary_category
    else if (this.isValid(poiData.category)) data.cat = poiData.category
    
    // Historical/temporal (high priority)
    if (this.isValid(poiData.start_date)) data.d = poiData.start_date
    if (this.isValid(poiData.historic_period)) data.p = poiData.historic_period
    
    // Architectural
    if (this.isValid(poiData.architectural_style)) data.st = poiData.architectural_style
    if (this.isValid(poiData.architect)) data.arch = poiData.architect
    if (this.isValid(poiData.building_material)) data.mat = poiData.building_material
    if (this.isValid(poiData.height)) data.h = poiData.height
    
    // Heritage
    if (this.isValid(poiData.heritage_status) && poiData.heritage_status !== 'none') data.her = poiData.heritage_status
    if (this.isValid(poiData.unesco_status) && poiData.unesco_status !== 'none') data.unesco = poiData.unesco_status
    if (this.isValid(poiData.unesco_inscription_date)) data.ud = poiData.unesco_inscription_date
    
    // References
    if (this.isValid(poiData.website)) data.w = poiData.website
    if (this.isValid(poiData.wikipedia)) data.wiki = poiData.wikipedia
    if (this.isValid(poiData.wikidata)) data.wd = poiData.wikidata

    // Type-specific (only if relevant)
    if (poiData.category === 'monument' || poiData.primary_category === 'monument') {
      if (this.isValid(poiData.monument_type)) data.mt = poiData.monument_type
      if (this.isValid(poiData.monument_event)) data.me = poiData.monument_event
      if (this.isValid(poiData.monument_person)) data.mp = poiData.monument_person
    }
    if (poiData.category === 'museum' || poiData.primary_category === 'museum') {
      if (this.isValid(poiData.museum_type)) data.mut = poiData.museum_type
      if (this.isValid(poiData.museum_collection)) data.mc = poiData.museum_collection
    }

    return Object.keys(data).length > 0 ? JSON.stringify(data) : '{}'
  }

  /**
   * Build compact JSON format for Google data (token optimization)
   */
  private static buildGoogleDataSectionCompact(poiData: POIData): string {
    const data: any = {}
    
    if (poiData.google_types && poiData.google_types.length > 0) {
      data.t = poiData.google_types
    }
    if (poiData.rating) data.r = poiData.rating
    if (poiData.user_ratings_total) data.rev = poiData.user_ratings_total
    if (poiData.price_level) data.p = poiData.price_level
    
    return Object.keys(data).length > 0 ? JSON.stringify(data) : '{}'
  }

  /**
   * Build compact JSON format for OSM data (token optimization)
   */
  private static buildOSMDataSectionCompact(enrichedData: EnrichedPOIData): string {
    const data: any = {}
    
    if (enrichedData.heritage_status && enrichedData.heritage_status !== 'none') {
      data.her = enrichedData.heritage_status
    }
    if (enrichedData.unesco_status && enrichedData.unesco_status !== 'none') {
      data.unesco = enrichedData.unesco_status
    }
    if (enrichedData.completion_estimated_year) {
      data.y = enrichedData.completion_estimated_year
    }
    if (enrichedData.architectural_style) {
      data.st = enrichedData.architectural_style
    }
    if (enrichedData.architect) {
      data.arch = enrichedData.architect
    }
    if (enrichedData.landmark_type && !['building', 'structure', 'place'].includes(enrichedData.landmark_type)) {
      data.lt = enrichedData.landmark_type
    }
    if (enrichedData.landmark_level && enrichedData.landmark_level >= 6) {
      data.imp = enrichedData.landmark_level >= 8 ? 'intl' : 'nat'
    }
    if (enrichedData.osm_description && enrichedData.osm_description.length > 20) {
      data.desc = enrichedData.osm_description
    }
    if (enrichedData.osm_wikipedia_url) {
      data.wiki = enrichedData.osm_wikipedia_url
    }
    
    return Object.keys(data).length > 0 ? JSON.stringify(data) : '{}'
  }

  /**
   * Build compact format for sources (token optimization)
   * Uses minimal formatting while maintaining priority information
   */
  private static buildSourcesSectionCompact(
    layeredSources: any[], 
    website?: string, 
    referenceLinks?: string[]
  ): string {
    const sources: any = {}
    
    // Priority 1: Official website
    if (website) sources.official = [website]
    
    // Priority 2: User references
    const validLinks = (referenceLinks || []).filter(link => link && link.trim()).slice(0, 3)
    if (validLinks.length) sources.user = validLinks
    
    // Priority 3: City sources (heritage, government)
    const cityHeritage = layeredSources
      .filter((s: any) => s.layer === 'city' && (s.source_type === 'heritage' || s.source_type === 'government'))
      .slice(0, 3)
      .map((s: any) => s.source_name)
    if (cityHeritage.length) sources.city = cityHeritage
    
    // Priority 4: National sources (heritage, government) - HIGHEST PRIORITY
    const prioritySources = ['IPHAN', 'UNESCO', 'IBRAM', 'Ministério do Turismo', 'Patrimônio Nacional']
    const nationalHeritage = layeredSources
      .filter((s: any) => s.layer === 'national' && (s.source_type === 'heritage' || s.source_type === 'government'))
      .sort((a: any, b: any) => {
        const aPriority = prioritySources.some(p => a.source_name?.includes(p))
        const bPriority = prioritySources.some(p => b.source_name?.includes(p))
        if (aPriority && !bPriority) return -1
        if (!aPriority && bPriority) return 1
        return (a.priority || 10) - (b.priority || 10)
      })
      .slice(0, 3)
      .map((s: any) => s.source_name)
    if (nationalHeritage.length) sources.national = nationalHeritage
    
    // If no sources, provide fallback
    if (Object.keys(sources).length === 0) {
      sources.fallback = ['UNESCO', 'IPHAN', 'IBRAM', 'government heritage', 'official tourism', 'Wikipedia']
    }
    
    return JSON.stringify(sources)
  }

  /**
   * Calculate description quality score and provide detailed justifications
   */
  private static calculateDescriptionQualityScore(
    description: string,
    poiData: any,
    sources: any[],
    enrichedData: any,
    scrapedContent: any
  ): any {
    console.log('📊 Calculating description quality score...')
    
    const wordCount = description.split(/\s+/).length
    const charCount = description.length
    
    // 1. Content Quality (0-100)
    let contentQuality = 50 // Base score
    
    // Length appropriateness
    if (wordCount >= 30 && wordCount <= 150) contentQuality += 20
    else if (wordCount >= 20 && wordCount <= 200) contentQuality += 10
    else if (wordCount < 10) contentQuality -= 20
    
    // Structure quality
    if (description.includes('Curiosidade:')) contentQuality += 10
    if (description.match(/\b(século|fundad|construíd|estabelecid)\b/i)) contentQuality += 10
    if (description.match(/\b\d{4}\b/)) contentQuality += 10 // Has specific year
    
    // Language quality
    if (!description.includes('importante') || !description.includes('rica história')) contentQuality += 10
    if (description.match(/\b(convida|oferece|demonstra|reflete)\b/i)) contentQuality += 5
    
    // 2. Source Reliability (0-100)
    let sourceReliability = 30 // Base
    const sourceCount = sources.length
    
    if (sourceCount >= 3) sourceReliability += 30
    else if (sourceCount >= 2) sourceReliability += 20
    else if (sourceCount >= 1) sourceReliability += 10
    
    // Quality of sources
    const hasOfficialSources = sources.some(s => 
      s.source_url?.includes('gov.br') || 
      s.source_url?.includes('iphan') ||
      s.source_type === 'official_website'
    )
    if (hasOfficialSources) sourceReliability += 20
    
    // 3. Factual Accuracy (0-100) - Based on verification
    let factualAccuracy = 70 // Default assumption
    
    // Check for potential invention indicators
    if (description.toLowerCase().includes('patrimônio histórico') && 
        !sources.some(s => s.content?.toLowerCase().includes('patrimônio'))) {
      factualAccuracy -= 30
    }
    
    if (description.toLowerCase().includes('iphan') && 
        !sources.some(s => s.content?.toLowerCase().includes('iphan'))) {
      factualAccuracy -= 30
    }
    
    // Positive indicators
    if (description.match(/\b(século XVIII|século XIX|século XX)\b/i)) factualAccuracy += 10
    if (enrichedData?.osm_description) factualAccuracy += 10
    
    // 4. Completeness (0-100)
    let completeness = 40 // Base
    
    // Essential elements
    if (description.toLowerCase().startsWith(poiData.name.toLowerCase().split(' ')[0])) completeness += 15
    if (description.includes(poiData.city)) completeness += 10
    if (description.match(/\b\d{4}\b|\bséculo\b/i)) completeness += 15 // Has date
    if (description.includes('Curiosidade:')) completeness += 20
    
    // 5. Language Quality (0-100)
    let languageQuality = 70 // Base
    
    // Positive indicators
    if ((description.match(/[.!?][\s]*[A-Z]/g)?.length || 0) >= 2) languageQuality += 10 // Multiple sentences
    if (!description.includes('...')) languageQuality += 5
    if (!description.match(/\b(muito|bem|grande|importante)\b.*\b(muito|bem|grande|importante)\b/i)) languageQuality += 10
    
    // Negative indicators
    if (description.includes('rica história')) languageQuality -= 10
    if (description.includes('importante cidade')) languageQuality -= 10
    
    // Calculate overall score (weighted average)
    const overallScore = Math.round(
      (contentQuality * 0.25) +      // 25% content quality
      (sourceReliability * 0.20) +   // 20% source reliability  
      (factualAccuracy * 0.25) +     // 25% factual accuracy
      (completeness * 0.20) +        // 20% completeness
      (languageQuality * 0.10)       // 10% language quality
    )
    
    // Determine confidence level
    const confidenceLevel = 
      overallScore >= 80 ? 'high' :
      overallScore >= 60 ? 'medium' : 'low'
    
    // Determine model and data richness
    const poiTypes = poiData?.google_types || []
    const proTypes = ['tourist_attraction', 'locality', 'political', 'point_of_interest']
    const modelUsed = poiTypes.some((type: string) => proTypes.includes(type)) ? 'pro' : 'flash'
    const dataRichness = sourceCount >= 2 || enrichedData?.osm_description ? 'rich' : 'limited'
    
    // Identify issues
    const issues = []
    if (contentQuality < 60) issues.push('Qualidade de conteúdo baixa')
    if (sourceReliability < 50) issues.push('Poucas fontes confiáveis')
    if (factualAccuracy < 70) issues.push('Possível invenção de informações')
    if (completeness < 60) issues.push('Descrição incompleta')
    if (languageQuality < 60) issues.push('Qualidade de linguagem baixa')
    
    // Generate recommendations
    const recommendations = []
    if (wordCount < 30) recommendations.push('Expandir descrição com mais detalhes')
    if (sourceCount < 2) recommendations.push('Adicionar mais fontes de dados')
    if (!description.includes('Curiosidade:')) recommendations.push('Incluir fato curioso')
    if (overallScore < 70) recommendations.push('Revisar e melhorar qualidade geral')
    
    const result = {
      overall_score: overallScore,
      confidence_level: confidenceLevel,
      justifications: {
        content_quality: Math.round(contentQuality),
        source_reliability: Math.round(sourceReliability),
        factual_accuracy: Math.round(factualAccuracy),
        completeness: Math.round(completeness),
        language_quality: Math.round(languageQuality)
      },
      issues_found: issues,
      recommendations: recommendations,
      model_used: modelUsed,
      data_richness: dataRichness
    }
    
    console.log(`📊 Description Quality Score: ${overallScore}% (${confidenceLevel})`)
    if (issues.length > 0) {
      console.log(`   - Issues: ${issues.join(', ')}`)
    }
    
    return result
  }

  /**
   * Create optimized prompt for Gemini with model-specific instructions
   */
  private static createOptimizedPrompt({
    name, sourcesSection, scrapedContentSection,
    existingDescription, existingTokens, optimizationMode = true,
    enrichedData = null, poiData = null, layeredSources = [], enrichedPOIData = null
  }: any): string {
    const hasTokens = existingTokens && existingTokens.length > 0
    const hasExisting = existingDescription && existingDescription.trim()
    
    // Fixed 25-second audio format (max 85 words)
    const audioTime = '25s'
    const maxWords = 85
    const isDataRich = false // Simplified: all descriptions follow same format

    return `<role>
You are an expert travel guide writer specializing in Brazilian cultural heritage and landmarks.
</role>

<task>
Generate a concise, factual description in Brazilian Portuguese for a ${audioTime} audio narration (maximum ${maxWords} words).
</task>

<constraints>
<constraint id="accuracy">
- Use ONLY well-known historical facts and verifiable information
- PRIORITIZE sources provided below, but may supplement with established historical knowledge
- NEVER INVENT: physical features, functions, services, dates, or events
- NEVER SPECULATE: avoid words like "aproximadamente", "cerca de", "provavelmente", "pode ter"
</constraint>

<constraint id="prohibited_content">
- FORBIDDEN unless explicitly in sources: "patrimônio histórico", "tombado", "IPHAN", "Ministério da Cultura"
- AVOID unverified claims about heritage status, IPHAN/UNESCO designations, or government programs
- FORBIDDEN: addresses, directions, hours, prices, contacts, invented features, speculation
</constraint>

<constraint id="source_priority">
Priority order (highest to lowest):
1. Official website (if available)
2. User-provided references
3. City/municipal sources
4. National sources
5. Well-established historical facts (periods/centuries, regional context, architectural styles)
</constraint>

<constraint id="dates">
- Include dates ONLY if confirmed in sources
- Prefer: year (YYYY) > century > decade
- NEVER use: "aproximadamente", "cerca de", "provavelmente"
- If no confirmed date: omit temporal references, use present tense only
</constraint>

<constraint id="format">
- Prefer short sentences for text-to-speech
- No lists or bullet points
- Maximum ${maxWords} words
- Target: 30-85 words for ${audioTime} audio
</constraint>
</constraints>

<structure>
<sentence_1>
- Start with POI name (never start with city name)
- Include 1-2 visible/observable elements when certain (material, style, era, original use)
</sentence_1>

<sentence_2>
- Include primary verifiable DATE if available (year preferred; century/decade if no year)
- If no date: describe current primary function/status
</sentence_2>

<sentence_3>
- Include 1-2 verified or well-established facts
- Focus on: architecture, founding, notable events, local characteristics, cultural significance
- Keep it simple and direct
</sentence_3>

<sentence_4>
- End with natural closing line connecting visitor to the place
- Describe visual/atmospheric element visible now
- No hyperbole or invitations
- if any, add a funfact about the place to keep peeople encharted
</sentence_4>
</structure>

<tone>
- Friendly, knowledgeable tour guide voice
- Warm, engaging tone while maintaining accuracy
- Vivid but factual language
- Avoid hype; focus on authentic stories
- Share interesting historical facts, cultural significance, or local traditions
</tone>

<knowledge_policy>
- You may use established historical knowledge about Brazilian cities, regions, and landmarks
- Sources below are trusted references - draw reasonable conclusions based on source types and contexts
- Do NOT name or cite institutions/sources in the output text
- Use source context (official websites, government sources, cultural institutions) to inform description
- Distinguish: general historical context (allowed) vs. specific current claims (require source verification)
</knowledge_policy>

<context>
<data format="compact_json">
{
  "loc": ${poiData ? this.buildLocationDetailsCompact(poiData) : JSON.stringify({ n: name })},
  "poi": ${poiData ? this.buildPOIDataSectionCompact(poiData) : JSON.stringify({ n: name })},
  "google": ${poiData ? this.buildGoogleDataSectionCompact(poiData) : '{}'},
  "osm": ${enrichedData ? this.buildOSMDataSectionCompact(enrichedData) : '{}'},
  "sources": ${this.buildSourcesSectionCompact(layeredSources || [], poiData?.website, poiData?.reference_links)}
}
</data>

${scrapedContentSection ? `<scraped_content>
${scrapedContentSection}
</scraped_content>` : ''}

${hasTokens ? `<tokens>
${JSON.stringify(existingTokens.map((t: any) => ({ t: t.token, w: t.weight })))}
</tokens>` : ''}

<data_legend>
Key abbreviations: n=name, c=city, s=state, co=country, b=neighborhood, cat=category, d=date, p=period, st=style, arch=architect, mat=material, h=height, her=heritage, unesco=unesco_status, w=website, wiki=wikipedia, wd=wikidata, t=types, r=rating, rev=reviews, y=year, lt=landmark_type, imp=importance, desc=description
</data_legend>
</context>

<output_format>
Generate ONLY the final Portuguese text. No commentary, metadata, explanations, or source citations.
</output_format>

[Generation ID: ${Date.now()}-${Math.random().toString(36).substr(2, 9)}]`
  }

  /**
   * Determine which Gemini model to use based on specific Google types
   * Note: All descriptions now use fixed 25s audio format (max 85 words)
   * Model selection is based on data richness, not audio duration
   * PRO: tourist_attraction, locality, political, point_of_interest
   * FLASH: all others
   */
  private static determineGeminiModel(sourcesSection: string, enrichedPOISection: string, scrapedContentSection?: string, poiData?: any): 'pro' | 'flash' {
    const poiTypes = poiData?.google_types || []
    
    // PRO types: specific important categories
    const proTypes = ['tourist_attraction', 'locality', 'political', 'point_of_interest']
    
    // Check if POI has any PRO type
    const hasProType = poiTypes.some((type: string) => proTypes.includes(type))
    
    const modelChoice = hasProType ? 'pro' : 'flash'
    const audioTime = hasProType ? '40s' : '20s'
    
    // Log reasoning
    if (hasProType) {
      const matchedTypes = poiTypes.filter((type: string) => proTypes.includes(type))
      console.log(`🎯 Model selection: ${matchedTypes.join(', ')} -> PRO (${audioTime} audio)`)
    } else {
      console.log(`🎯 Model selection: ${poiTypes.join(', ')} -> FLASH (${audioTime} audio)`)
    }
    
    return modelChoice
  }

  /**
   * Generate description using Gemini API with intelligent model selection
   */
  private static async generateWithGemini(prompt: string, apiKey: string, sourcesSection: string, enrichedPOIData: any, scrapedContentSection?: string, poiData?: any): Promise<string | null> {
    // Always use Flash models (2.5 Flash-Lite as primary, 2.5 Flash as fallback)
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    ]
    
    console.log(`🤖 Using Gemini Flash models for POI description generation`)

    for (const endpoint of endpoints) {
      try {
        const modelName = endpoint.includes('flash-lite') ? 'Flash-Lite' : 'Flash'
        console.log(`🤖 Calling Gemini API: ${modelName}`)
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }],
            generationConfig: {
              temperature: 0.7,        // Reduced for more consistency
              topK: 40,               // Reduced for more focused responses  
              topP: 0.8,              // Reduced for better factual accuracy
              maxOutputTokens: 350,
              candidateCount: 1       // Ensure single response
            }
          })
        })

        if (!response.ok) {
          console.log(`❌ Gemini API error: ${response.status} ${response.statusText}`)
          continue
        }

        const data = await response.json()
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
          const description = data.candidates[0].content.parts[0].text.trim()
          return description
        } else {
          console.log('⚠️ No valid content in Gemini response:', data)
        }

      } catch (error) {
        console.error(`❌ Error with endpoint ${endpoint}:`, error)
        continue
      }
    }

    return null
  }

  /**
   * Verify generated description quality
   */
  private static async verifyGeneratedDescription(
    description: string, 
    name: string, 
    apiKey: string
  ): Promise<VerificationResult> {
    console.log('🔍 Verificando qualidade da descrição gerada...')
    
    const verificationPrompt = `<role>
Quality verification specialist for 25s tourist audio descriptions. Evaluate objectively using measurable criteria.
</role>

<task>
Analyze description for "${name}" and provide structured quality assessment with scoring.
</task>

<context>
<desc>${description}</desc>
<constraints>
25s audio (max 85 words). Goal: 1-2 facts. Be generous considering length limit.
</constraints>
</context>

<criteria>
<crit id="dates" w="15">
Check: date (year) OR period? Extract all. Score: 0=none|10=period|15=year
</crit>

<crit id="facts" w="30" req="true">
Check: ≥1 verifiable fact? Types: history, architecture, culture, founding, characteristics. Generic OK. Extract all. Score: 0=none|15=1 generic|25=1-2 specific|30=multiple. REQUIRED for approval.
</crit>

<crit id="style" w="15">
Check: friendly guide tone? Look: engaging, warm, factual. Avoid: marketing, hype. Score: 0=poor|8=ok|15=excellent
</crit>

<crit id="prohibited" w="20" req="true" block="true">
Check: prohibited content? Prohibited: addresses, hours, prices, contacts, directions. BLOCKING: auto-reject if found. Score: 0=has|20=clean
</crit>

<crit id="tts" w="10">
Check: TTS suitable? Look: short sentences, natural flow. Avoid: run-ons, complex punctuation. Score: 0=poor|5=ok|10=excellent
</crit>

<crit id="lang" w="10" req="true">
Check: correct Brazilian Portuguese? Look: grammar, spelling, BR (not EU), natural. Score: 0=major errors|5=minor|10=perfect. REQUIRED for approval.
</crit>
</criteria>

<scoring>
<approve>
"aprovada":true IF: ≥1 fact AND no prohibited AND correct PT-BR AND score≥60
"aprovada":false IF: no facts OR prohibited OR major errors OR score<60
</approve>

<calc>
Sum all scores (max 100). Use VARIED: 65,70,75,80,85,90,95. Min:60, Max:100.
</calc>
</scoring>

<output>
Respond ONLY with valid JSON:
{"aprovada":boolean,"pontuacao":0-100,"datas_detectadas":string[],"fatos_verificaveis":string[],"problemas":string[],"sugestoes_melhoria":string}
</output>`

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: verificationPrompt
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Verification API error: ${response.status}`)
      }

      const data = await response.json()
      const verificationText = data.candidates[0].content.parts[0].text

      // Extract JSON from response
      const jsonMatch = verificationText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in verification response')
      }

      const verificationResult = JSON.parse(jsonMatch[0])
      console.log(`✅ Verification completed: ${verificationResult.aprovada ? 'APPROVED' : 'REJECTED'} (${verificationResult.pontuacao}/100)`)

      return verificationResult

    } catch (error: any) {
      console.error('❌ Error verifying description:', error)
      // Return default verification result
      return {
        aprovada: false,
        pontuacao: 0,
        datas_detectadas: [],
        fatos_verificaveis: [],
        problemas: ['Verification failed'],
        sugestoes_melhoria: 'Unable to verify description quality'
      }
    }
  }

  /**
   * Save description to database
   */
  private static async saveDescription(
    attractionId: string,
    description: string,
    verification: VerificationResult,
    language: string = 'pt-br',
    descriptionId?: string,
    qualityAnalysis?: any
  ): Promise<{ success: boolean; description_id?: string; error?: string }> {
    try {
      console.log(`💾 Saving description in ${language} for attraction ${attractionId}`)
      
      // Check if description already exists
      const { data: existingDescription, error: checkError } = await getSupabaseAdmin()
        .schema('core')
        .from('attraction_descriptions')
        .select('id')
        .eq('attraction_id', attractionId)
        .eq('language', language)
        .single()

      if (checkError && checkError.code !== 'PGRST116') {
        throw new Error(`Error checking existing description: ${checkError.message}`)
      }

      let savedDescription
      if (existingDescription || descriptionId) {
        // Update existing description
        const { data: updatedDescription, error: updateError } = await getSupabaseAdmin()
          .schema('core')
          .from('attraction_descriptions')
          .update({
            description: description,
            verification_status: verification.aprovada ? 'approved' : 'needs_review',
            last_verified_at: new Date().toISOString()
          })
          .eq('id', descriptionId || existingDescription?.id)
          .select('id')
          .single()

        if (updateError) {
          throw new Error(`Error updating description: ${updateError.message}`)
        }
        savedDescription = updatedDescription
      } else {
        // Insert new description
        const { data: newDescription, error: insertError } = await getSupabaseAdmin()
          .schema('core')
          .from('attraction_descriptions')
          .insert({
            attraction_id: attractionId,
            language: language,
            description: description,
            verification_status: verification.aprovada ? 'approved' : 'needs_review',
            last_verified_at: new Date().toISOString()
          })
          .select('id')
          .single()

        if (insertError) {
          throw new Error(`Error inserting description: ${insertError.message}`)
        }
        savedDescription = newDescription
      }

      console.log(`✅ Description saved in ${language} with ID:`, savedDescription?.id)
      
      // Save quality analysis to attractions table for audit
      if (qualityAnalysis) {
        await this.saveDescriptionQualityScore(attractionId, qualityAnalysis, language)
      }
      
      return { success: true, description_id: savedDescription?.id }

    } catch (error: any) {
      console.error(`❌ Error saving description:`, error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Save RAG sources and extracted data to database
   */
  private static async saveRAGSources(
    poiId: string,
    layeredSources: any[],
    enrichedPOIData: any
  ): Promise<void> {
    try {
      console.log(`💾 Saving RAG data for POI: ${poiId}`)

      // Extract verified facts from enriched data
      const verifiedFacts = this.extractVerifiedFacts(enrichedPOIData)
      
      // Extract temporal tokens (years, dates)
      const temporalTokens = this.extractTemporalTokens(enrichedPOIData)
      
      // Extract entity tokens (people, architects)
      const entityTokens = this.extractEntityTokens(enrichedPOIData)
      
      // Calculate quality scores
      const sourcesQualityScore = this.calculateSourcesQualityScore(layeredSources)
      const completenessScore = this.calculateCompletenessScore(enrichedPOIData)
      const reliabilityScore = this.calculateReliabilityScore(layeredSources)

      // Prepare RAG data for storage
      const ragSourcesData = {
        sources: layeredSources.map(source => ({
          name: source.source_name,
          type: source.source_type,
          layer: source.layer,
          url: source.base_url,
          priority: source.priority,
          search_endpoint: source.search_endpoint
        })),
        search_timestamp: new Date().toISOString(),
        total_found: layeredSources.length
      }

      const ragContentData = {
        official_website: enrichedPOIData.website,
        wikipedia_url: enrichedPOIData.osm_wikipedia_url,
        osm_description: enrichedPOIData.osm_description,
        heritage_info: {
          status: enrichedPOIData.heritage_status,
          unesco_status: enrichedPOIData.unesco_status,
          unesco_date: enrichedPOIData.unesco_inscription_date
        },
        architectural_info: {
          style: enrichedPOIData.architectural_style,
          architect: enrichedPOIData.architect,
          period: enrichedPOIData.historical_period,
          completion_year: enrichedPOIData.completion_estimated_year
        },
        cultural_info: {
          significance: enrichedPOIData.cultural_significance,
          monument_type: enrichedPOIData.monument_type,
          commemorated_event: enrichedPOIData.commemorated_event,
          commemorated_person: enrichedPOIData.commemorated_person
        }
      }

      // Update POI with RAG data
      const { error } = await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .update({
          rag_sources_found: ragSourcesData,
          rag_sources_last_search: new Date().toISOString(),
          rag_sources_quality_score: sourcesQualityScore,
          rag_content_extracted: ragContentData,
          rag_content_last_updated: new Date().toISOString(),
          rag_verified_facts: verifiedFacts,
          rag_temporal_tokens: temporalTokens,
          rag_entity_tokens: entityTokens,
          rag_completeness_score: completenessScore,
          rag_reliability_score: reliabilityScore,
          rag_freshness_days: 0, // Just updated
          rag_source_count: layeredSources.length,
          rag_last_successful_search: new Date().toISOString(),
          rag_search_failure_count: 0
        })
        .eq('id', poiId)

      if (error) {
        console.warn(`⚠️ Error saving RAG data: ${error.message}`)
      } else {
        console.log(`✅ RAG data saved successfully for POI: ${poiId}`)
        console.log(`📊 Quality scores - Sources: ${sourcesQualityScore}, Completeness: ${completenessScore}, Reliability: ${reliabilityScore}`)
      }

    } catch (error) {
      console.warn(`⚠️ Error in saveRAGSources: ${error}`)
    }
  }

  /**
   * Extract verified facts from enriched POI data
   */
  private static extractVerifiedFacts(enrichedData: any): any {
    const facts: any = {}

    // Architectural facts
    if (enrichedData.architectural_style) facts.architectural_style = enrichedData.architectural_style
    if (enrichedData.architect) facts.architect = enrichedData.architect
    if (enrichedData.completion_estimated_year) facts.completion_year = enrichedData.completion_estimated_year

    // Heritage facts
    if (enrichedData.heritage_status && enrichedData.heritage_status !== 'none') {
      facts.heritage_status = enrichedData.heritage_status
    }
    if (enrichedData.unesco_status && enrichedData.unesco_status !== 'none') {
      facts.unesco_status = enrichedData.unesco_status
      if (enrichedData.unesco_inscription_date) facts.unesco_date = enrichedData.unesco_inscription_date
    }

    // Cultural facts
    if (enrichedData.cultural_significance && enrichedData.cultural_significance !== 'low') {
      facts.cultural_significance = enrichedData.cultural_significance
    }

    return Object.keys(facts).length > 0 ? facts : null
  }

  /**
   * Extract temporal tokens (years, dates)
   */
  private static extractTemporalTokens(enrichedData: any): string[] {
    const tokens: string[] = []

    if (enrichedData.completion_estimated_year) {
      tokens.push(enrichedData.completion_estimated_year.toString())
    }
    if (enrichedData.unesco_inscription_date) {
      const year = new Date(enrichedData.unesco_inscription_date).getFullYear()
      tokens.push(year.toString())
    }
    if (enrichedData.historical_period) {
      // Extract years from period descriptions like "século XVIII" or "1800-1850"
      const yearMatches = enrichedData.historical_period.match(/\b\d{4}\b/g)
      if (yearMatches) tokens.push(...yearMatches)
    }

    return [...new Set(tokens)] // Remove duplicates
  }

  /**
   * Extract entity tokens (people, architects)
   */
  private static extractEntityTokens(enrichedData: any): string[] {
    const tokens: string[] = []

    if (enrichedData.architect) tokens.push(enrichedData.architect)
    if (enrichedData.commemorated_person) tokens.push(enrichedData.commemorated_person)

    return [...new Set(tokens)] // Remove duplicates
  }

  /**
   * Calculate quality score for found sources
   */
  private static calculateSourcesQualityScore(sources: any[]): number {
    if (!sources.length) return 0

    let totalScore = 0
    for (const source of sources) {
      let sourceScore = 50 // Base score

      // Higher score for official sources
      if (source.source_type === 'heritage') sourceScore += 30
      if (source.source_type === 'government') sourceScore += 25
      if (source.source_type === 'official') sourceScore += 20
      if (source.source_type === 'academic') sourceScore += 15

      // Higher score for city-level sources
      if (source.layer === 'city') sourceScore += 15
      if (source.layer === 'national') sourceScore += 10

      // Priority bonus
      if (source.priority <= 3) sourceScore += 10

      totalScore += Math.min(sourceScore, 100)
    }

    return Math.round(totalScore / sources.length)
  }

  /**
   * Calculate completeness score based on available data
   */
  private static calculateCompletenessScore(enrichedData: any): number {
    let score = 0
    const maxScore = 100

    // Essential info (40 points)
    if (enrichedData.website) score += 10
    if (enrichedData.osm_wikipedia_url) score += 10
    if (enrichedData.osm_description) score += 10
    if (enrichedData.heritage_status && enrichedData.heritage_status !== 'none') score += 10

    // Architectural info (30 points)
    if (enrichedData.architectural_style) score += 10
    if (enrichedData.architect) score += 10
    if (enrichedData.completion_estimated_year) score += 10

    // Cultural info (20 points)
    if (enrichedData.cultural_significance && enrichedData.cultural_significance !== 'low') score += 10
    if (enrichedData.monument_type) score += 5
    if (enrichedData.commemorated_event || enrichedData.commemorated_person) score += 5

    // Contact/practical info (10 points)
    if (enrichedData.contact_phone || enrichedData.contact_email) score += 5
    if (enrichedData.opening_hours) score += 5

    return Math.min(score, maxScore)
  }

  /**
   * Calculate reliability score based on source types and layers
   */
  private static calculateReliabilityScore(sources: any[]): number {
    if (!sources.length) return 0

    const heritageCount = sources.filter(s => s.source_type === 'heritage').length
    const governmentCount = sources.filter(s => s.source_type === 'government').length
    const officialCount = sources.filter(s => s.source_type === 'official').length
    const cityCount = sources.filter(s => s.layer === 'city').length

    let score = 40 // Base score

    // Source type bonuses
    if (heritageCount > 0) score += 25
    if (governmentCount > 0) score += 20
    if (officialCount > 0) score += 15

    // Layer bonuses
    if (cityCount > 0) score += 15

    // Multiple sources bonus
    if (sources.length >= 3) score += 10
    if (sources.length >= 5) score += 5

    return Math.min(score, 100)
  }

  // =====================================
  // RAG ATIVO (FASE 1) METHODS
  // =====================================

  /**
   * Scrape content from discovered sources
   */
  private static async scrapeSourcesContent(sources: any[], poiData: POIData): Promise<any> {
    console.log(`🌐 Scraping content from ${sources.length} sources...`)
    
    const scrapedResults = []
    const maxSources = 3 // Limit to avoid overwhelming
    const timeout = 8000 // 8 seconds timeout
    
    for (const source of sources.slice(0, maxSources)) {
      try {
        console.log(`🔍 Scraping: ${source.source_name} - ${source.base_url}`)
        
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        
        const response = await fetch(source.base_url, {
          headers: {
            'User-Agent': 'TuggiApp/1.0 (Educational Research)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
          },
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          console.warn(`❌ Failed to fetch ${source.base_url}: ${response.status}`)
          continue
        }
        
        const html = await response.text()
        // name and city are guaranteed at this point (validated above)
        const extractedContent = this.extractRelevantContent(html, poiData.name!, poiData.city!)
        
        if (extractedContent.relevantText) {
          scrapedResults.push({
            source_name: source.source_name,
            source_url: source.base_url,
            source_type: source.source_type,
            extracted_content: extractedContent,
            scraped_at: new Date().toISOString(),
            success: true
          })
          console.log(`✅ Successfully scraped ${source.source_name}`)
        } else {
          console.warn(`⚠️ No relevant content found in ${source.source_name}`)
        }
        
      } catch (error: any) {
        console.warn(`❌ Error scraping ${source.source_name}:`, error.message)
        scrapedResults.push({
          source_name: source.source_name,
          source_url: source.base_url,
          error: error.message,
          scraped_at: new Date().toISOString(),
          success: false
        })
      }
    }
    
    console.log(`📊 Scraping completed: ${scrapedResults.filter(r => r.success).length}/${scrapedResults.length} successful`)
    
    return {
      scraped_sources: scrapedResults,
      total_attempted: sources.length,
      successful_count: scrapedResults.filter(r => r.success).length,
      scraped_at: new Date().toISOString()
    }
  }

  /**
   * Extract relevant content from HTML
   */
  private static extractRelevantContent(html: string, poiName: string, cityName: string): any {
    try {
      // Simple text extraction (in production, use a proper HTML parser)
      const cleanText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      
      // Look for relevant sections mentioning the POI or city
      const keywords = [poiName, cityName, 'história', 'construção', 'arquitetura', 'patrimônio', 'século']
      const sentences = cleanText.split(/[.!?]+/).filter(s => s.length > 20)
      
      const relevantSentences = sentences.filter(sentence => {
        const lowerSentence = sentence.toLowerCase()
        return keywords.some(keyword => lowerSentence.includes(keyword.toLowerCase()))
      }).slice(0, 5) // Max 5 relevant sentences
      
      // Extract dates/years
      const dateMatches = cleanText.match(/\b(1[5-9]\d{2}|20\d{2})\b/g) || []
      const uniqueDates = [...new Set(dateMatches)].slice(0, 10)
      
      // Extract potential architect/person names (capitalized words)
      const nameMatches = cleanText.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || []
      const uniqueNames = [...new Set(nameMatches)].slice(0, 10)
      
      return {
        relevantText: relevantSentences.join('. '),
        extractedDates: uniqueDates,
        extractedNames: uniqueNames,
        totalTextLength: cleanText.length,
        relevanceScore: relevantSentences.length * 10 // Simple scoring
      }
      
    } catch (error) {
      console.warn('Error extracting content:', error)
      return { relevantText: '', extractedDates: [], extractedNames: [], relevanceScore: 0 }
    }
  }

  /**
   * Save scraped content to database
   */
  private static async saveScrapedContent(poiId: string, scrapedContent: any): Promise<void> {
    try {
      const successfulScrapes = scrapedContent.scraped_sources?.filter((s: any) => s.success) || []
      const failedScrapes = scrapedContent.scraped_sources?.filter((s: any) => !s.success) || []
      
      // Extract keywords and facts from scraped content
      const allKeywords: string[] = []
      const allFacts: any = {}
      
      successfulScrapes.forEach((scrape: any) => {
        if (scrape.extracted_content?.extractedDates) {
          allKeywords.push(...scrape.extracted_content.extractedDates)
        }
        if (scrape.extracted_content?.extractedNames) {
          allKeywords.push(...scrape.extracted_content.extractedNames)
        }
      })
      
      // Calculate content quality score
      const avgRelevanceScore = successfulScrapes.length > 0 
        ? successfulScrapes.reduce((sum: number, s: any) => sum + (s.extracted_content?.relevanceScore || 0), 0) / successfulScrapes.length
        : 0
      
      const contentQualityScore = Math.min(avgRelevanceScore, 100)
      
      const { error } = await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .update({
          rag_scraped_content: scrapedContent,
          rag_content_quality_score: contentQualityScore,
          rag_keywords_extracted: [...new Set(allKeywords)],
          rag_facts_extracted: Object.keys(allFacts).length > 0 ? allFacts : null,
          rag_scraping_last_attempt: new Date().toISOString(),
          rag_scraping_success_count: successfulScrapes.length,
          rag_scraping_failure_count: failedScrapes.length,
          rag_urls_scraped: successfulScrapes.map((s: any) => s.source_url),
          rag_urls_failed: failedScrapes.map((s: any) => s.source_url)
        })
        .eq('id', poiId)
      
      if (error) {
        console.warn(`⚠️ Error saving scraped content: ${error.message}`)
      } else {
        console.log(`✅ Scraped content saved - Quality score: ${contentQualityScore}`)
      }
      
    } catch (error) {
      console.warn(`⚠️ Error in saveScrapedContent: ${error}`)
    }
  }

  /**
   * Build optimized content section using processed data from database
   * FOCUS: Provide factual material for structured audio description
   */
  private static buildOptimizedContentSection(scrapedContent: any, enrichedPOIData: any): string {
    const lines: string[] = ['📋 FACTUAL CONTENT FOR AUDIO DESCRIPTION:']
    
    const successfulScrapes = scrapedContent.scraped_sources?.filter((s: any) => s.success) || []
    
    // Collect factual elements
    const factualElements: any = {
      localCharacteristics: [], // "terra da linguiça", "conhecida por"
      foundationFacts: [],
      historicalDates: [],
      culturalFacts: [],
      architecturalFacts: [],
      curiousFacts: []
    }
    
    // Separate reference links from other sources for priority handling
    const referenceLinkScrapes = successfulScrapes.filter((s: any) => s.source_name?.includes('Reference Link'))
    const otherScrapes = successfulScrapes.filter((s: any) => !s.source_name?.includes('Reference Link'))
    
    // Extract factual elements from scraped content (prioritize reference links)
    const processScrape = (scrape: any, isReferenceLink: boolean) => {
      if (scrape.extracted_content?.relevantText) {
        const text = scrape.extracted_content.relevantText.toLowerCase()
        const sourceLabel = isReferenceLink ? `${scrape.source_name} [HIGHEST PRIORITY]` : scrape.source_name
        
        // Categorize content for factual description
        if (text.includes('conhecida por') || text.includes('famosa por') || text.includes('terra da') || text.includes('capital da')) {
          factualElements.localCharacteristics.push({
            source: sourceLabel,
            text: scrape.extracted_content.relevantText.substring(0, 120)
          })
        }
        if (text.includes('fundad') || text.includes('origin') || text.includes('criação') || text.includes('estabelecid') || text.includes('inaugurad')) {
          factualElements.foundationFacts.push({
            source: sourceLabel,
            text: scrape.extracted_content.relevantText.substring(0, 150)
          })
        }
        if (text.includes('tradição') || text.includes('festa') || text.includes('cultura') || text.includes('típico')) {
          factualElements.culturalFacts.push({
            source: sourceLabel, 
            text: scrape.extracted_content.relevantText.substring(0, 150)
          })
        }
        if (text.includes('arquitet') || text.includes('construção') || text.includes('estilo') || text.includes('projetad')) {
          factualElements.architecturalFacts.push({
            source: sourceLabel,
            text: scrape.extracted_content.relevantText.substring(0, 150)
          })
        }
        if (text.includes('curioso') || text.includes('interessante') || text.includes('único') || text.includes('especial')) {
          factualElements.curiousFacts.push({
            source: sourceLabel,
            text: scrape.extracted_content.relevantText.substring(0, 120)
          })
        }
      }
      
      // Extract dates for historical timeline (prioritize reference links)
      if (scrape.extracted_content?.extractedDates) {
        scrape.extracted_content.extractedDates.forEach((date: string) => {
          const year = parseInt(date)
          if (year >= 1500 && year <= 2000) { // Focus on historical dates
            const dateLabel = isReferenceLink ? `${date} [EXPLICIT FROM REFERENCE LINK - HIGHEST PRIORITY]` : `${date} [EXPLICIT]`
            factualElements.historicalDates.push(dateLabel)
          }
        })
      }
    }
    
    // Process reference links first (highest priority)
    referenceLinkScrapes.forEach((scrape: any) => processScrape(scrape, true))
    // Then process other sources
    otherScrapes.forEach((scrape: any) => processScrape(scrape, false))
    
    // Add enriched POI data for factual content
    if (enrichedPOIData.completion_estimated_year) {
      const year = enrichedPOIData.completion_estimated_year
      if (year >= 1500 && year <= 2000) {
        factualElements.historicalDates.push(`${year} (construção)`)
      }
    }
    
    if (enrichedPOIData.architect) {
      factualElements.architecturalFacts.push({
        source: 'database',
        text: `Projetado pelo arquiteto ${enrichedPOIData.architect}`
      })
    }
    
    if (enrichedPOIData.commemorated_person) {
      factualElements.curiousFacts.push({
        source: 'database',
        text: `Homenageia ${enrichedPOIData.commemorated_person}`
      })
    }
    
    if (enrichedPOIData.commemorated_event) {
      factualElements.curiousFacts.push({
        source: 'database',
        text: `Relacionado ao evento: ${enrichedPOIData.commemorated_event}`
      })
    }
    
    // Build structured sections for audio description
    if (factualElements.localCharacteristics.length > 0) {
      lines.push('🏷️ LOCAL CHARACTERISTICS (for context):')
      factualElements.localCharacteristics.slice(0, 2).forEach((char: any) => {
        lines.push(`"${char.text}" (${char.source})`)
      })
    }
    
    if (factualElements.foundationFacts.length > 0) {
      // Prioritize foundation facts from reference links
      const referenceLinkFacts = factualElements.foundationFacts.filter((f: any) => f.source.includes('[HIGHEST PRIORITY]'))
      const factsToShow = referenceLinkFacts.length > 0 ? referenceLinkFacts : factualElements.foundationFacts
      
      lines.push('🏛️ FOUNDATION/ORIGIN:')
      factsToShow.slice(0, 1).forEach((fact: any) => {
        lines.push(`"${fact.text}" (${fact.source})`)
      })
    }
    
    if (factualElements.historicalDates.length > 0) {
      // Separate explicit dates from reference links (highest priority)
      const referenceLinkDates = factualElements.historicalDates.filter((d: string) => d.includes('[EXPLICIT FROM REFERENCE LINK'))
      const otherExplicitDates = factualElements.historicalDates.filter((d: string) => d.includes('[EXPLICIT]') && !d.includes('REFERENCE LINK'))
      
      // Log extracted dates for debugging
      console.log('📅 Dates extracted from scraped content:', {
        allDates: factualElements.historicalDates,
        referenceLinkDates: referenceLinkDates.map((d: string) => d.replace(' [EXPLICIT FROM REFERENCE LINK - HIGHEST PRIORITY]', '')),
        otherExplicitDates: otherExplicitDates.map((d: string) => d.replace(' [EXPLICIT]', ''))
      })
      
      if (referenceLinkDates.length > 0) {
        const dates = referenceLinkDates.map((d: string) => d.replace(' [EXPLICIT FROM REFERENCE LINK - HIGHEST PRIORITY]', '')).slice(0, 3)
        lines.push(`📅 EXPLICIT DATES FROM REFERENCE LINKS (USE THESE - HIGHEST PRIORITY): ${dates.join(', ')}`)
      }
      if (otherExplicitDates.length > 0 && referenceLinkDates.length === 0) {
        const dates = otherExplicitDates.map((d: string) => d.replace(' [EXPLICIT]', '')).slice(0, 3)
        lines.push(`📅 EXPLICIT DATES FROM SOURCES: ${dates.join(', ')}`)
      }
    } else {
      console.log('📅 No dates extracted from scraped content - description should use present tense only')
    }
    
    if (enrichedPOIData.architectural_style) {
      lines.push(`🏗️ ARCHITECTURAL STYLE: ${enrichedPOIData.architectural_style}`)
    }
    
    if (enrichedPOIData.heritage_status && enrichedPOIData.heritage_status !== 'none') {
      lines.push(`🏆 HERITAGE STATUS: ${enrichedPOIData.heritage_status}`)
    }
    
    if (enrichedPOIData.unesco_status && enrichedPOIData.unesco_status !== 'none') {
      let unescoText = enrichedPOIData.unesco_status
      if (enrichedPOIData.unesco_inscription_date) {
        unescoText += ` (${enrichedPOIData.unesco_inscription_date})`
      }
      lines.push(`🌍 UNESCO STATUS: ${unescoText}`)
    }
    
    if (factualElements.culturalFacts.length > 0) {
      lines.push('🎭 CULTURAL SIGNIFICANCE:')
      factualElements.culturalFacts.slice(0, 2).forEach((fact: any) => {
        lines.push(`"${fact.text}" (${fact.source})`)
      })
    }
    
    if (factualElements.architecturalFacts.length > 0) {
      lines.push('🏛️ ARCHITECTURAL DETAILS:')
      factualElements.architecturalFacts.slice(0, 1).forEach((fact: any) => {
        lines.push(`"${fact.text}" (${fact.source})`)
      })
    }
    
    if (factualElements.curiousFacts.length > 0) {
      lines.push('💡 CURIOUS FACTS (for "Fato curioso:" endings):')
      factualElements.curiousFacts.slice(0, 3).forEach((fact: any) => {
        lines.push(`"${fact.text}" (${fact.source})`)
      })
    }
    
    if (lines.length === 1) {
      return '' // No factual material found
    }
    
    lines.push('')
    lines.push('📋 AUDIO STRUCTURE: [Local Context] + [Main Description] + [Fato curioso: ...] + [Fato curioso: ...]')
    return lines.join('\n')
  }

  /**
   * Build source attribution (simplified, without full URLs)
   */
  private static buildSourceAttribution(sources: any[]): string {
    if (!sources.length) return ''
    
    const lines: string[] = ['📚 SOURCE ATTRIBUTION:']
    
    // Group by type for cleaner presentation
    const byType = sources.reduce((acc: any, source) => {
      const type = source.source_type || 'other'
      if (!acc[type]) acc[type] = []
      acc[type].push(source.source_name)
      return acc
    }, {})
    
    Object.entries(byType).forEach(([type, names]: [string, any]) => {
      const typeIcon = type === 'heritage' ? '🏛️' : 
                      type === 'government' ? '🏛️' : 
                      type === 'academic' ? '🎓' : 
                      type === 'encyclopedia' ? '📖' : '📄'
      lines.push(`${typeIcon} ${type.toUpperCase()}: ${names.slice(0, 3).join(', ')}`)
    })
    
    return lines.join('\n')
  }

  /**
   * Build scraped content section for prompt (legacy - kept for fallback)
   */
  private static buildScrapedContentSection(scrapedContent: any): string {
    if (!scrapedContent?.scraped_sources?.length) {
      return ''
    }
    
    const lines: string[] = ['🌐 REAL CONTENT FROM SOURCES:']
    
    const successfulScrapes = scrapedContent.scraped_sources.filter((s: any) => s.success)
    
    successfulScrapes.forEach((scrape: any, index: number) => {
      if (scrape.extracted_content?.relevantText) {
        lines.push(`\n📄 ${scrape.source_name} (${scrape.source_type}):`)
        lines.push(`"${scrape.extracted_content.relevantText.substring(0, 300)}..."`)
        
        if (scrape.extracted_content.extractedDates?.length) {
          lines.push(`📅 Dates found: ${scrape.extracted_content.extractedDates.slice(0, 5).join(', ')}`)
        }
        
        if (scrape.extracted_content.extractedNames?.length) {
          lines.push(`👤 Names found: ${scrape.extracted_content.extractedNames.slice(0, 3).join(', ')}`)
        }
      }
    })
    
    if (lines.length === 1) {
      return '' // No content found
    }
    
    lines.push('\n⚠️ PRIORITY: Use facts from real scraped content above when available.')
    return lines.join('\n')
  }

  // =====================================
  // CACHE COMPARTILHADO (FASE 3) METHODS  
  // =====================================

  /**
   * Get RAG cache for city
   */
  private static async getCityRAGCache(city: string, country: string): Promise<any> {
    try {
      const { data, error } = await getSupabaseAdmin()
        .schema('core')
        .from('rag_city_cache')
        .select('*')
        .eq('city', city)
        .eq('country', country)
        .single()
      
      if (error && error.code !== 'PGRST116') {
        console.warn(`⚠️ Error fetching city cache: ${error.message}`)
        return null
      }
      
      return data
    } catch (error) {
      console.warn(`⚠️ Error in getCityRAGCache: ${error}`)
      return null
    }
  }

  /**
   * Check if cache is still valid (not older than 7 days)
   */
  private static isCacheValid(cache: any): boolean {
    if (!cache?.last_updated) return false
    
    const cacheAge = Date.now() - new Date(cache.last_updated).getTime()
    const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
    
    return cacheAge < maxAge
  }

  /**
   * Update cache usage statistics
   */
  private static async updateCacheUsage(cacheId: string): Promise<void> {
    try {
      const { data: current } = await getSupabaseAdmin()
        .schema('core')
        .from('rag_city_cache')
        .select('usage_count')
        .eq('id', cacheId)
        .single()

      const nextCount = (current?.usage_count || 0) + 1

      await getSupabaseAdmin()
        .schema('core')
        .from('rag_city_cache')
        .update({
          last_used: new Date().toISOString(),
          usage_count: nextCount
        })
        .eq('id', cacheId)
    } catch (error) {
      console.warn(`⚠️ Error updating cache usage: ${error}`)
    }
  }

  /**
   * Update city cache with new data
   */
  private static async updateCityCache(
    city: string, 
    country: string, 
    state: string | undefined,
    sources: any[], 
    scrapedContent: any
  ): Promise<void> {
    try {
      const sourcesData = {
        sources: sources.map((s: any) => ({
          name: s.source_name,
          type: s.source_type,
          layer: s.layer,
          url: s.base_url,
          priority: s.priority
        })),
        total_found: sources.length,
        cached_at: new Date().toISOString()
      }
      
      const sourcesQualityScore = this.calculateSourcesQualityScore(sources)
      const contentQualityScore = scrapedContent?.scraped_sources
        ?.filter((s: any) => s.success)
        ?.reduce((sum: number, s: any) => sum + (s.extracted_content?.relevanceScore || 0), 0) / 
        (scrapedContent?.scraped_sources?.filter((s: any) => s.success)?.length || 1) || 0
      
      // Extract common keywords and facts
      const allKeywords = scrapedContent?.scraped_sources
        ?.filter((s: any) => s.success)
        ?.flatMap((s: any) => [...(s.extracted_content?.extractedDates || []), ...(s.extracted_content?.extractedNames || [])])
        || []
      
      const { error } = await getSupabaseAdmin()
        .schema('core')
        .from('rag_city_cache')
        .upsert({
          city,
          country,
          state,
          sources_found: sourcesData,
          sources_quality_score: sourcesQualityScore,
          sources_count: sources.length,
          scraped_content: scrapedContent,
          content_quality_score: Math.min(contentQualityScore, 100),
          common_keywords: [...new Set(allKeywords)],
          last_updated: new Date().toISOString(),
          last_used: new Date().toISOString(),
          usage_count: 1
        }, {
          onConflict: 'city,country,state'
        })
      
      if (error) {
        console.warn(`⚠️ Error updating city cache: ${error.message}`)
      } else {
        console.log(`✅ City cache updated for ${city}, ${country}`)
      }
      
    } catch (error) {
      console.warn(`⚠️ Error in updateCityCache: ${error}`)
    }
  }

  /**
   * Generate audio for description (placeholder - will be implemented in AudioService)
   */
  private static async generateAudio(
    attractionId: string,
    description: string,
    language: string = 'pt-br'
  ): Promise<{ success: boolean; audio_url?: string; error?: string }> {
    console.log(`🎵 Audio generation requested for ${attractionId} in ${language}`)
    console.log('ℹ️ Audio generation will be implemented in AudioService')
    
    // TODO: This will be moved to AudioService
    // Return success without implementation for now
    return {
      success: true,
      audio_url: undefined,
      error: undefined
    }
  }

  /**
   * Save description quality score to attractions table for audit
   */
  private static async saveDescriptionQualityScore(
    attractionId: string, 
    qualityAnalysis: any, 
    language: string
  ): Promise<void> {
    try {
      console.log(`📊 Saving quality score: ${qualityAnalysis.overall_score}%`)
      
      const { error } = await getSupabaseAdmin()
        .schema('core')
        .from('attractions')
        .update({
          // Use the existing RAG content quality score field for description quality
          rag_content_quality_score: qualityAnalysis.overall_score,
          // Store detailed justifications in processing audit log
          processing_audit_log: {
            description_quality: {
              overall_score: qualityAnalysis.overall_score,
              confidence_level: qualityAnalysis.confidence_level,
              justifications: qualityAnalysis.justifications,
              issues_found: qualityAnalysis.issues_found,
              recommendations: qualityAnalysis.recommendations,
              model_used: qualityAnalysis.model_used,
              data_richness: qualityAnalysis.data_richness,
              language: language,
              calculated_at: new Date().toISOString()
            }
          }
        })
        .eq('id', attractionId)

      if (error) {
        console.error('❌ Error saving description quality score:', error)
      } else {
        console.log('✅ Description quality score saved successfully')
      }
    } catch (error) {
      console.error('❌ Error in saveDescriptionQualityScore:', error)
    }
  }
}
