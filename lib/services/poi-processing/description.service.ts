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

// Service role client for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
)

// =====================================
// INTERFACES AND TYPES
// =====================================

export interface POIData {
  id?: string
  name: string
  city: string
  country: string
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
}

export interface VerificationResult {
  aprovada: boolean
  pontuacao: number
  datas_detectadas: string[]
  fatos_verificaveis: string[]
  problemas: string[]
  sugestoes_melhoria: string
}

export interface DescriptionResult {
  success: boolean
  description?: string
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
  error?: string
  processing_time?: number
}

// =====================================
// MAIN SERVICE CLASS
// =====================================

export class DescriptionService {
  
  /**
   * Generate new description for POI
   */
  static async generate(
    poiData: POIData, 
    options: DescriptionOptions = {}
  ): Promise<DescriptionResult> {
    const startTime = Date.now()
    
    try {
      console.log(`🚀 Generating description for: ${poiData.name}`)
      
      // Validate required parameters
      const validation = this.validatePOIData(poiData)
      if (!validation.valid) {
        return {
          success: false,
          error: `Missing required parameters: ${validation.missing.join(', ')}`
        }
      }

      // Get API key
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        return {
          success: false,
          error: 'Gemini API key not configured'
        }
      }

      let osmEnrichmentResult = null
      let enrichedData: EnrichedPOIData | null = null

      // Step 0: Fetch enriched POI data from database (including OSM fields)
      console.log(`📊 Fetching enriched POI data from database...`)
      const enrichedPOIData = await this.fetchEnrichedPOIData(poiData.id || '')

      // Step 1: OSM Enrichment (if enabled)
      if (options.enrich_with_osm !== false && poiData.id) { // Default to true
        console.log(`🗺️ Checking OSM enrichment for POI: ${poiData.id}`)
        
        const needsEnrichment = options.skip_enrichment_if_exists !== false ? 
          await OSMEnrichmentService.needsEnrichment(poiData.id) : true

        if (needsEnrichment) {
          console.log(`🔄 Enriching POI with OSM data...`)
          
          const enrichmentInput = {
            poi_id: poiData.id,
            name: poiData.name,
            city: poiData.city,
            country: poiData.country,
            google_place_id: poiData.google_place_id,
            lat: poiData.lat,
            lng: poiData.lng
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

      // Get layered sources
      const layeredSources = await this.getLayeredSources(
        poiData.city, 
        poiData.country, 
        options.use_dynamic_sources ?? true
      )
      
      console.log(`📚 Found ${layeredSources.length} layered sources for ${poiData.city}, ${poiData.country}`)

      // Check city cache first (FASE 3)
      const cityCache = await this.getCityRAGCache(poiData.city, poiData.country)
      let finalSources = layeredSources
      let scrapedContent: any = null

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

        // FASE 1: RAG ATIVO - Scrape content from discovered sources
        if (layeredSources.length > 0) {
          console.log(`🌐 Starting active RAG - scraping content from ${layeredSources.length} sources`)
          scrapedContent = await this.scrapeSourcesContent(layeredSources, poiData)
          
          // Save scraped content
          await this.saveScrapedContent(poiData.id || '', scrapedContent)
          
          // Update city cache
          await this.updateCityCache(poiData.city, poiData.country, poiData.state, layeredSources, scrapedContent)
        }
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
        sourcesSection = this.buildSourcesSection(
          finalSources, 
          enrichedPOIData.website || poiData.website, 
          enrichedPOIData.reference_links || poiData.reference_links
        )
      }
      
      // Build location details
      const locationDetails = this.buildLocationDetails(poiData)
      
      // Build Google data section
      const googleData = this.buildGoogleDataSection(poiData)

      // Build enriched POI data section
      const enrichedPOISection = this.buildEnrichedPOIDataSection(enrichedPOIData)

      // Create optimized prompt
      const prompt = this.createOptimizedPrompt({
        name: poiData.name,
        locationDetails,
        sourcesSection,
        googleData,
        enrichedPOISection,
        scrapedContentSection, // NOVO: Conteúdo real das fontes!
        existingDescription: options.existing_description,
        existingTokens: [], // TODO: Implement token system if needed
        optimizationMode: options.optimization_mode ?? true,
        enrichedData
      })

      // Log prompt for analysis
      console.log('\n' + '='.repeat(80))
      console.log('📝 PROMPT ENVIADO PARA GEMINI:')
      console.log('='.repeat(80))
      console.log(prompt)
      console.log('='.repeat(80))
      console.log(`📏 Tamanho do prompt: ${prompt.length} caracteres\n`)

      // Generate description using Gemini
      const description = await this.generateWithGemini(prompt, apiKey)
      
      // Log Gemini response for analysis
      console.log('\n' + '🤖'.repeat(40))
      console.log('🤖 RESPOSTA DO GEMINI:')
      console.log('🤖'.repeat(40))
      console.log(description || 'NULL/EMPTY RESPONSE')
      console.log('🤖'.repeat(40))
      console.log(`📏 Tamanho da resposta: ${description?.length || 0} caracteres\n`)
      
      if (!description) {
        return {
          success: false,
          error: 'Failed to generate description with Gemini API'
        }
      }

      // Verify generated description
      const verification = await this.verifyGeneratedDescription(description, poiData.name, apiKey)

      const result: DescriptionResult = {
        success: true,
        description,
        verification,
        osm_enrichment: osmEnrichmentResult ? {
          success: osmEnrichmentResult.success,
          data_quality_score: osmEnrichmentResult.data_quality_score,
          fields_updated: osmEnrichmentResult.fields_updated,
          error: osmEnrichmentResult.success ? undefined : osmEnrichmentResult.error
        } : undefined,
        processing_time: Date.now() - startTime
      }

      // Save description if attraction ID provided
      if (poiData.id && options.persist_verification !== false) {
        const saveResult = await this.saveDescription(
          poiData.id,
          description,
          verification,
          options.language ?? 'pt-br',
          options.description_id
        )
        
        if (saveResult.success) {
          result.description_id = saveResult.description_id
          
          // Generate audio if enabled and description approved
          if (options.auto_generate_audio && verification.aprovada && verification.pontuacao >= 75) {
            result.audio_generation = await this.generateAudio(poiData.id, description, options.language ?? 'pt-br')
          }
        }
      }

      return result

    } catch (error: any) {
      console.error('❌ Error generating description:', error)
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        processing_time: Date.now() - startTime
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
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('Gemini API key not configured')
    }

    return this.verifyGeneratedDescription(description, poiName, apiKey)
  }

  // =====================================
  // PRIVATE HELPER METHODS
  // =====================================

  /**
   * Validate POI data has required fields
   */
  private static validatePOIData(poiData: POIData): { valid: boolean; missing: string[] } {
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
      const { data: layeredSources, error: layeredError } = await supabaseAdmin
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
        
        const { data: countrySources, error: countryError } = await supabaseAdmin
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
          const sourcesWithLayer = countrySources.map(s => ({ ...s, layer: 'national' }))
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
   * Fetch enriched POI data from database (including OSM fields)
   */
  private static async fetchEnrichedPOIData(poiId: string): Promise<any> {
    try {
      const { data: enrichedPOI, error } = await supabaseAdmin
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

      if (error) {
        console.warn(`⚠️ Error fetching enriched POI data: ${error.message}`)
        return {}
      }

      console.log(`📊 Fetched enriched POI data:`, {
        has_website: !!enrichedPOI.website,
        has_osm_wikipedia: !!enrichedPOI.osm_wikipedia_url,
        has_contact_info: !!(enrichedPOI.contact_phone || enrichedPOI.contact_email),
        heritage_status: enrichedPOI.heritage_status,
        unesco_status: enrichedPOI.unesco_status,
        architectural_style: enrichedPOI.architectural_style,
        landmark_level: enrichedPOI.landmark_level,
        cultural_significance: enrichedPOI.cultural_significance
      })

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

    // 2. User references
    const validLinks = (referenceLinks || []).filter(link => link && link.trim()).slice(0, 3)
    if (validLinks.length) {
      lines.push('🔗 USER REFERENCES (HIGH PRIORITY):')
      validLinks.forEach(link => lines.push(`- ${link}`))
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
      
      // 4. National sources
      add('🏛️ NATIONAL HERITAGE & GOV:', [
        ...byTypeAndLayer('heritage', 'national'),
        ...byTypeAndLayer('government', 'national')
      ], 2)
      
      // Other national sources
      const byType = (t: string) => layeredSources
        .filter((s: any) => s.source_type === t && s.layer === 'national')
        .sort((a: any, b: any) => (a.priority || 10) - (b.priority || 10))
      
      add('🎓 NATIONAL ACADEMIC & OFFICIAL:', [...byType('academic'), ...byType('official')], 2)
    }

    if (!lines.length) {
      lines.push('📚 SOURCES: UNESCO, Wikipedia, official tourism, government heritage')
    }

    lines.push('')
    lines.push('⚠️ VERIFY: Use only facts that these sources confirm. If unsure, omit.')
    return lines.join('\n')
  }

  /**
   * Build enriched POI data section for prompt
   */
  private static buildEnrichedPOIDataSection(enrichedData: any): string {
    const sections: string[] = []

    // 🌐 OFFICIAL SOURCES FROM DATABASE
    if (enrichedData.website || enrichedData.osm_wikipedia_url) {
      sections.push('🌐 OFFICIAL POI SOURCES:')
      if (enrichedData.website) {
        sections.push(`- Official Website: ${enrichedData.website}`)
      }
      if (enrichedData.osm_wikipedia_url) {
        sections.push(`- Wikipedia: ${enrichedData.osm_wikipedia_url}`)
      }
    }

    // 🏛️ HERITAGE & UNESCO STATUS
    if (enrichedData.heritage_status !== 'none' && enrichedData.heritage_status) {
      sections.push('🏛️ HERITAGE STATUS:')
      sections.push(`- Heritage Level: ${enrichedData.heritage_status}`)
      
      if (enrichedData.unesco_status !== 'none' && enrichedData.unesco_status) {
        sections.push(`- UNESCO Status: ${enrichedData.unesco_status}`)
        if (enrichedData.unesco_inscription_date) {
          sections.push(`- UNESCO Inscription: ${enrichedData.unesco_inscription_date}`)
        }
      }
    }

    // 🏗️ ARCHITECTURAL DETAILS
    const architecturalInfo = []
    if (enrichedData.architectural_style) architecturalInfo.push(`Style: ${enrichedData.architectural_style}`)
    if (enrichedData.architect) architecturalInfo.push(`Architect: ${enrichedData.architect}`)
    if (enrichedData.historical_period) architecturalInfo.push(`Period: ${enrichedData.historical_period}`)
    if (enrichedData.completion_estimated_year) architecturalInfo.push(`Built: ${enrichedData.completion_estimated_year}`)
    
    if (architecturalInfo.length > 0) {
      sections.push('🏗️ ARCHITECTURAL INFO:')
      architecturalInfo.forEach(info => sections.push(`- ${info}`))
    }

    // 🎭 CULTURAL & MONUMENT INFO
    if (enrichedData.cultural_significance && enrichedData.cultural_significance !== 'low') {
      sections.push('🎭 CULTURAL SIGNIFICANCE:')
      sections.push(`- Level: ${enrichedData.cultural_significance}`)
      
      if (enrichedData.monument_type) {
        sections.push(`- Type: ${enrichedData.monument_type}`)
      }
      if (enrichedData.commemorated_event) {
        sections.push(`- Commemorates: ${enrichedData.commemorated_event}`)
      }
      if (enrichedData.commemorated_person) {
        sections.push(`- Person: ${enrichedData.commemorated_person}`)
      }
    }

    // 🎨 PHYSICAL CHARACTERISTICS
    const physicalInfo = []
    if (enrichedData.building_colour) physicalInfo.push(`Building Color: ${enrichedData.building_colour}`)
    if (enrichedData.roof_colour) physicalInfo.push(`Roof Color: ${enrichedData.roof_colour}`)
    if (enrichedData.building_material) physicalInfo.push(`Material: ${enrichedData.building_material}`)
    
    if (physicalInfo.length > 0) {
      sections.push('🎨 PHYSICAL DETAILS:')
      physicalInfo.forEach(info => sections.push(`- ${info}`))
    }

    // 📞 CONTACT INFO (if available)
    if (enrichedData.contact_phone || enrichedData.contact_email) {
      sections.push('📞 CONTACT INFO AVAILABLE:')
      if (enrichedData.contact_phone) sections.push(`- Phone: Available`)
      if (enrichedData.contact_email) sections.push(`- Email: Available`)
    }

    // 🗺️ OSM DESCRIPTION (if available)
    if (enrichedData.osm_description) {
      sections.push('🗺️ OSM DESCRIPTION:')
      sections.push(`- ${enrichedData.osm_description}`)
    }

    if (sections.length === 0) {
      return 'No enriched data available from database.'
    }

    return sections.join('\n')
  }

  /**
   * Build location details string
   */
  private static buildLocationDetails(poiData: POIData): string {
    const parts = [poiData.city, poiData.state, poiData.country].filter(Boolean)
    return parts.join(', ')
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
   * Create optimized prompt for Gemini
   */
  private static createOptimizedPrompt({
    name, locationDetails, sourcesSection, googleData, enrichedPOISection, scrapedContentSection,
    existingDescription, existingTokens, optimizationMode = true,
    enrichedData = null 
  }: any): string {
    const hasTokens = existingTokens && existingTokens.length > 0
    const hasExisting = existingDescription && existingDescription.trim()

    return `You are an expert travel guide writer. Produce a concise, factual description in Brazilian Portuguese.

CRITICAL RULES (BALANCED):
- Use well-known historical facts and verifiable information about the location
- PRIORITIZE the sources below when available, but you may supplement with established historical knowledge
- NEVER INVENT physical features, functions, or services (e.g., "serves as viewpoint", "offers panoramic views")
- NEVER SPECULATE with words like "aproximadamente", "cerca de", "provavelmente", "pode ter"
- AVOID unverified claims about current heritage status, specific IPHAN/UNESCO designations, or active government programs
- SOURCE PRIORITY ORDER:
  1. Official website (if available)
  2. User-provided references  
  3. City/municipal sources
  4. National sources
  5. Well-established historical facts (periods/centuries, regional context, common architectural styles)
- PRIORITIZE DATES: construction/inauguration/foundation; include restoration if documented. Aim to include one temporal anchor (year/century/decade) when accurate.
- Prefer short sentences for TTS. No lists.
- FORBIDDEN: addresses, directions, hours, prices, contacts, invented features, speculation.

STRUCTURE & FLOW:
- Start with the POI name; never start with the city.
- Include 1–2 visible/observable elements when certain (e.g., material, style, era, original use).
- End with a natural closing line that connects the visitor to the place (no hyperbole).

TONE & ENGAGEMENT (GUIDE STYLE):
- Friendly, knowledgeable tour guide voice
- Share interesting historical facts, cultural significance, or local traditions
- Include curious details about architecture, founding, notable events, or local characteristics
- Vivid but factual language; avoid hype; focus on authentic stories
- Warm, engaging tone while maintaining accuracy

SOURCES:
${sourcesSection}

KNOWLEDGE POLICY:
- You may use established historical knowledge about Brazilian cities, regions, and landmarks.
- Do NOT name or cite institutions/sources in the output text.
- Distinguish general historical context (allowed) from specific current claims that require source verification (avoid if not in sources).

TASK (90–140 words):
- Start with: POI name + primary verifiable DATE (year preferred; century/decade if no year).
- Then 1–2 verified or well-established facts (architect/style/events) if documented; keep it engaging.
- Optionally current function/significance if officially recorded.
- Avoid generic fillers (e.g., "importante cidade", "rica história"); prefer concrete facts.

DATE POLICY:
- Include a year only if confirmed. Otherwise use century/decade.
- Never use "aproximadamente", "cerca de", "provavelmente".

ATTRACTION DATA:
- Name: ${name}
- Location: ${locationDetails}
- Google: ${googleData}

POI DATABASE INFORMATION:
${enrichedPOISection}

${scrapedContentSection ? scrapedContentSection + '\n' : ''}

${enrichedData ? this.buildOSMDataSection(enrichedData) : ''}

${hasTokens ? `TOKENS:\n${existingTokens.map((t: any) => `- ${t.token} (${t.weight})`).join('\n')}` : ''}
${hasExisting ? `EXISTING (for improvement):\n${existingDescription}` : ''}

OUTPUT: Only the final Portuguese text.

[Generation ID: ${Date.now()}-${Math.random().toString(36).substr(2, 9)}]`
  }

  /**
   * Generate description using Gemini API
   */
  private static async generateWithGemini(prompt: string, apiKey: string): Promise<string | null> {
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`
    ]

    for (const endpoint of endpoints) {
      try {
        console.log(`🤖 Calling Gemini API: ${endpoint.includes('pro-latest') ? 'Pro Latest' : 'Pro'}`)
        
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
        
        // Log raw Gemini API response for debugging
        console.log('🔍 Raw Gemini API Response:', JSON.stringify(data, null, 2))
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
          const description = data.candidates[0].content.parts[0].text.trim()
          console.log(`✅ Extracted description: ${description.substring(0, 100)}...`)
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
    
    const verificationPrompt = `
Você é um verificador especializado em qualidade de descrições turísticas curtas (áudio de 25 segundos). Analise a descrição abaixo para o ponto turístico "${name}" e avalie com critérios brandos:

DESCRIÇÃO A SER VERIFICADA:
"""
${description}
"""

CONTEXTO IMPORTANTE:
- Esta é uma descrição CURTA para áudio de 25 segundos (máximo 300-350 caracteres)
- Nem todos os lugares têm informações detalhadas disponíveis
- O objetivo é fornecer pelo menos 1-2 fatos interessantes, não uma descrição completa
- Algumas atrações podem ter informações limitadas ou genéricas

CRITÉRIOS DE VERIFICAÇÃO (BRANDOS):
1. PRESENÇA DE DATAS: A descrição contém pelo menos uma data OU período histórico? (Não é obrigatório, mas desejável)
2. FATOS VERIFICÁVEIS: Há pelo menos 1 fato que parece verificável? (Mesmo que genérico)
3. ESTILO DE GUIA: A descrição tem tom minimamente amigável?
4. PROIBIÇÕES: Contém endereços, horários, preços ou direções específicas? (Único critério rígido)
5. ADEQUAÇÃO PARA ÁUDIO: As frases são adequadas para TTS?
6. PORTUGUÊS BRASILEIRO: O texto está em português brasileiro correto?

PONTUAÇÃO BRANDA (SEJA VARIADO):
- Aprove a descrição se tiver pelo menos 1 fato e estiver em português correto
- Pontuação mínima de 60 se tiver pelo menos um fato verificável
- Use pontuações variadas: 65, 70, 75, 80, 85, 90, 95 baseado na qualidade real
- Seja generoso na avaliação, considerando o limite de 25 segundos
- NÃO use sempre a mesma pontuação - varie baseado na qualidade específica

RESPONDA EM JSON:
{
  "aprovada": true/false,
  "pontuacao": 0-100,
  "datas_detectadas": ["lista", "de", "datas"],
  "fatos_verificaveis": ["fato 1", "fato 2"],
  "problemas": ["problema 1", "problema 2"],
  "sugestoes_melhoria": "sugestão concisa e realista para o limite de 25 segundos"
}`

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
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
    descriptionId?: string
  ): Promise<{ success: boolean; description_id?: string; error?: string }> {
    try {
      console.log(`💾 Saving description in ${language} for attraction ${attractionId}`)
      
      // Check if description already exists
      const { data: existingDescription, error: checkError } = await supabaseAdmin
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
        const { data: updatedDescription, error: updateError } = await supabaseAdmin
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
        const { data: newDescription, error: insertError } = await supabaseAdmin
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
      const { error } = await supabaseAdmin
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
        const extractedContent = this.extractRelevantContent(html, poiData.name, poiData.city)
        
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
      
      const { error } = await supabaseAdmin
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
    
    // Extract factual elements from scraped content
    successfulScrapes.forEach((scrape: any) => {
      if (scrape.extracted_content?.relevantText) {
        const text = scrape.extracted_content.relevantText.toLowerCase()
        
        // Categorize content for factual description
        if (text.includes('conhecida por') || text.includes('famosa por') || text.includes('terra da') || text.includes('capital da')) {
          factualElements.localCharacteristics.push({
            source: scrape.source_name,
            text: scrape.extracted_content.relevantText.substring(0, 120)
          })
        }
        if (text.includes('fundad') || text.includes('origin') || text.includes('criação') || text.includes('estabelecid')) {
          factualElements.foundationFacts.push({
            source: scrape.source_name,
            text: scrape.extracted_content.relevantText.substring(0, 150)
          })
        }
        if (text.includes('tradição') || text.includes('festa') || text.includes('cultura') || text.includes('típico')) {
          factualElements.culturalFacts.push({
            source: scrape.source_name, 
            text: scrape.extracted_content.relevantText.substring(0, 150)
          })
        }
        if (text.includes('arquitet') || text.includes('construção') || text.includes('estilo') || text.includes('projetad')) {
          factualElements.architecturalFacts.push({
            source: scrape.source_name,
            text: scrape.extracted_content.relevantText.substring(0, 150)
          })
        }
        if (text.includes('curioso') || text.includes('interessante') || text.includes('único') || text.includes('especial')) {
          factualElements.curiousFacts.push({
            source: scrape.source_name,
            text: scrape.extracted_content.relevantText.substring(0, 120)
          })
        }
      }
      
      // Extract dates for historical timeline
      if (scrape.extracted_content?.extractedDates) {
        scrape.extracted_content.extractedDates.forEach((date: string) => {
          const year = parseInt(date)
          if (year >= 1500 && year <= 2000) { // Focus on historical dates
            factualElements.historicalDates.push(`${date}`)
          }
        })
      }
    })
    
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
      lines.push('🏛️ FOUNDATION/ORIGIN:')
      factualElements.foundationFacts.slice(0, 1).forEach((fact: any) => {
        lines.push(`"${fact.text}" (${fact.source})`)
      })
    }
    
    if (factualElements.historicalDates.length > 0) {
      const uniqueDates = [...new Set(factualElements.historicalDates)].sort()
      lines.push(`📅 HISTORICAL DATES: ${uniqueDates.slice(0, 4).join(', ')}`)
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
      const { data, error } = await supabaseAdmin
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
      const { data: current } = await supabaseAdmin
        .schema('core')
        .from('rag_city_cache')
        .select('usage_count')
        .eq('id', cacheId)
        .single()

      const nextCount = (current?.usage_count || 0) + 1

      await supabaseAdmin
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
        sources: sources.map(s => ({
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
      
      const { error } = await supabaseAdmin
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
    return {
      success: false,
      error: 'Audio generation not yet implemented in modular architecture'
    }
  }
}
