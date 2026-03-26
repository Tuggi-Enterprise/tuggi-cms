/**
 * API Manager - Single Source of Truth for External APIs
 * 
 * Centralized management of all external API calls following DRY and SSOF principles.
 * Eliminates duplicate API implementations and provides consistent error handling,
 * rate limiting, and retry logic across the entire project.
 * 
 * Features:
 * - Unified API client for all external services
 * - Automatic rate limiting and retry logic
 * - Consistent error handling and logging
 * - Environment-based configuration
 * - Edge Functions compatibility
 * - Request/response caching
 * - API usage analytics
 */

// import { RateLimiter } from '../utils/rate-limiter'

// Simple rate limiter implementation
class RateLimiter {
  private requests: number[] = []
  
  constructor(private apiType: string) {}
  
  async waitForSlot(): Promise<void> {
    // Simple rate limiting implementation
    const now = Date.now()
    this.requests = this.requests.filter(time => now - time < 60000) // Keep last minute
    
    if (this.requests.length >= 10) { // Max 10 requests per minute
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    this.requests.push(now)
  }
  
  getRequestCount(): number {
    return this.requests.length
  }
}

// API Configuration
interface APIConfig {
  baseUrl: string
  apiKey?: string
  rateLimit: {
    requests: number
    window: number // in milliseconds
  }
  retry: {
    attempts: number
    delay: number // in milliseconds
  }
  timeout: number // in milliseconds
  headers?: Record<string, string>
}

// API Types
export type APIType = 
  | 'google-maps' 
  | 'google-places' 
  | 'google-elevation'
  | 'google-gemini'
  | 'google-tts'
  | 'openstreetmap-nominatim'
  | 'openstreetmap-overpass'
  | 'open-elevation'
  | 'geonames'
  | 'wikimedia'
  | 'wikipedia'
  | 'wikidata'
  | 'openai'
  | 'anthropic'

// API Response wrapper
export interface APIResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  statusCode?: number
  rateLimitInfo?: {
    remaining: number
    resetTime: number
  }
  requestId: string
  timestamp: number
}

// API Manager - Singleton
export class APIManager {
  private static instance: APIManager
  private configs: Map<APIType, APIConfig> = new Map()
  private rateLimiters: Map<APIType, RateLimiter> = new Map()
  private cache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map()
  
  private constructor() {
    this.initializeConfigs()
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): APIManager {
    if (!APIManager.instance) {
      APIManager.instance = new APIManager()
    }
    return APIManager.instance
  }
  
  /**
   * Initialize API configurations
   */
  private initializeConfigs(): void {
    // Google Maps APIs
    this.configs.set('google-maps', {
      baseUrl: 'https://maps.googleapis.com/maps/api',
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      rateLimit: { requests: 1000, window: 60000 }, // 1000 requests per minute
      retry: { attempts: 3, delay: 1000 },
      timeout: 10000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('google-places', {
      baseUrl: 'https://maps.googleapis.com/maps/api/place',
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      rateLimit: { requests: 1000, window: 60000 },
      retry: { attempts: 3, delay: 1000 },
      timeout: 10000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('google-elevation', {
      baseUrl: 'https://maps.googleapis.com/maps/api/elevation',
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      rateLimit: { requests: 1000, window: 60000 },
      retry: { attempts: 3, delay: 1000 },
      timeout: 10000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    // Google AI APIs
    this.configs.set('google-gemini', {
      baseUrl: 'https://generativelanguage.googleapis.com/v1',
      apiKey: process.env.GEMINI_API_KEY,
      rateLimit: { requests: 60, window: 60000 }, // 60 requests per minute
      retry: { attempts: 3, delay: 2000 },
      timeout: 30000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('google-tts', {
      baseUrl: 'https://texttospeech.googleapis.com/v1',
      apiKey: process.env.GOOGLE_TTS_API_KEY,
      rateLimit: { requests: 100, window: 60000 },
      retry: { attempts: 3, delay: 1000 },
      timeout: 15000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    // OpenStreetMap APIs
    this.configs.set('openstreetmap-nominatim', {
      baseUrl: 'https://nominatim.openstreetmap.org',
      rateLimit: { requests: 1, window: 1000 }, // 1 request per second
      retry: { attempts: 3, delay: 2000 },
      timeout: 10000,
      headers: { 'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)' }
    })
    
    this.configs.set('openstreetmap-overpass', {
      baseUrl: 'https://overpass-api.de/api/interpreter',
      rateLimit: { requests: 2, window: 1000 }, // 2 requests per second
      retry: { attempts: 3, delay: 1000 },
      timeout: 30000,
      headers: { 'User-Agent': 'TuggiCMS/1.0 (overpass-queries)' }
    })
    
    // Other APIs
    this.configs.set('open-elevation', {
      baseUrl: 'https://api.open-elevation.com/api/v1',
      rateLimit: { requests: 10, window: 1000 },
      retry: { attempts: 3, delay: 1000 },
      timeout: 10000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('geonames', {
      baseUrl: 'http://api.geonames.org',
      apiKey: process.env.GEONAMES_USERNAME,
      rateLimit: { requests: 1000, window: 3600000 }, // 1000 requests per hour
      retry: { attempts: 3, delay: 1000 },
      timeout: 10000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('wikimedia', {
      baseUrl: 'https://commons.wikimedia.org/w/api.php',
      rateLimit: { requests: 50, window: 60000 },
      retry: { attempts: 3, delay: 1000 },
      timeout: 15000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('wikipedia', {
      baseUrl: 'https://pt.wikipedia.org/w/api.php',
      rateLimit: { requests: 50, window: 60000 },
      retry: { attempts: 3, delay: 1000 },
      timeout: 15000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('wikidata', {
      baseUrl: 'https://www.wikidata.org/w/api.php',
      rateLimit: { requests: 50, window: 60000 },
      retry: { attempts: 3, delay: 1000 },
      timeout: 15000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('openai', {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      rateLimit: { requests: 60, window: 60000 },
      retry: { attempts: 3, delay: 2000 },
      timeout: 30000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    this.configs.set('anthropic', {
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
      rateLimit: { requests: 60, window: 60000 },
      retry: { attempts: 3, delay: 2000 },
      timeout: 30000,
      headers: { 'User-Agent': 'TuggiCMS/1.0' }
    })
    
    // Initialize rate limiters
    for (const [apiType, config] of this.configs) {
      this.rateLimiters.set(apiType, new RateLimiter(apiType))
    }
  }
  
  /**
   * Make API request with rate limiting, retry logic, and error handling
   */
  async request<T = any>(
    apiType: APIType,
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      params?: Record<string, any>
      body?: any
      headers?: Record<string, string>
      cache?: boolean
      cacheTTL?: number // in milliseconds
    } = {}
  ): Promise<APIResponse<T>> {
    const requestId = this.generateRequestId()
    const startTime = Date.now()
    
    try {
      const config = this.configs.get(apiType)
      if (!config) {
        throw new Error(`Unknown API type: ${apiType}`)
      }
      
      // Check cache first
      if (options.cache !== false) {
        const cacheKey = this.generateCacheKey(apiType, endpoint, options.params)
        const cached = this.cache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
          return {
            success: true,
            data: cached.data,
            requestId,
            timestamp: startTime
          }
        }
      }
      
      // Rate limiting
      const rateLimiter = this.rateLimiters.get(apiType)!
      await rateLimiter.waitForSlot()
      
      // Build URL
      const url = this.buildUrl(config, endpoint, options.params)
      
      // Prepare request
      const requestOptions: RequestInit = {
        method: options.method || 'GET',
        headers: {
          ...config.headers,
          ...options.headers
        },
        signal: AbortSignal.timeout(config.timeout)
      }
      
      if (options.body) {
        requestOptions.body = typeof options.body === 'string' 
          ? options.body 
          : JSON.stringify(options.body)
        if (requestOptions.headers) {
          (requestOptions.headers as any)['Content-Type'] = 'application/json'
        }
      }
      
      // Add API key if required
      if (config.apiKey) {
        if (apiType.includes('google')) {
          url.searchParams.set('key', config.apiKey)
        } else if (apiType === 'openai') {
          if (requestOptions.headers) {
            (requestOptions.headers as any)['Authorization'] = `Bearer ${config.apiKey}`
          }
        } else if (apiType === 'anthropic') {
          if (requestOptions.headers) {
            (requestOptions.headers as any)['x-api-key'] = config.apiKey
          }
        }
      }
      
      // Make request with retry logic
      let lastError: Error | null = null
      
      // Lista de mirrors do Overpass API para resiliência
      const overpassMirrors = apiType === 'openstreetmap-overpass' ? [
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter',
        'https://z.overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.osm.ch/api/interpreter',
        'https://overpass.be/api/interpreter'
      ] : null
      
      for (let attempt = 1; attempt <= config.retry.attempts; attempt++) {
        try {
          let requestUrl = url.toString()
          
          // Se for Overpass, rotacionar mirror
          if (overpassMirrors) {
            const mirror = overpassMirrors[(attempt - 1) % overpassMirrors.length]
            requestUrl = mirror
          }
          
          const response = await fetch(requestUrl, requestOptions)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const data = await response.json()
          
          // Cache successful response
          if (options.cache !== false) {
            const cacheKey = this.generateCacheKey(apiType, endpoint, options.params)
            this.cache.set(cacheKey, {
              data,
              timestamp: Date.now(),
              ttl: options.cacheTTL || 300000 // 5 minutes default
            })
          }
          
          return {
            success: true,
            data,
            statusCode: response.status,
            requestId,
            timestamp: startTime
          }
          
        } catch (error) {
          lastError = error as Error
          
          if (attempt < config.retry.attempts) {
            // Adicionar jitter opcional aqui se necessário
            await new Promise(resolve => 
              setTimeout(resolve, (config.retry.delay * attempt) + (Math.random() * 500))
            )
          }
        }
      }
      
      throw lastError || new Error('Request failed after all retries')
      
    } catch (error) {
      console.error(`API Request failed [${apiType}]:`, error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId,
        timestamp: startTime
      }
    }
  }
  
  /**
   * Convenience methods for common API calls
   */
  
  // Google Maps APIs
  async getGoogleMapsData(endpoint: string, params: Record<string, any> = {}) {
    return this.request('google-maps', endpoint, { params })
  }
  
  async getGooglePlacesData(endpoint: string, params: Record<string, any> = {}) {
    return this.request('google-places', endpoint, { params })
  }
  
  async getGoogleElevationData(params: Record<string, any>) {
    return this.request('google-elevation', 'json', { params })
  }
  
  // OpenStreetMap APIs
  async getNominatimData(endpoint: string, params: Record<string, any> = {}) {
    return this.request('openstreetmap-nominatim', endpoint, { params })
  }
  
  async getOverpassData(query: string) {
    return this.request('openstreetmap-overpass', '', {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
  
  // AI APIs
  async getGeminiResponse(prompt: string, model: string = 'gemini-2.5-flash-lite') {
    return this.request('google-gemini', `models/${model}:generateContent`, {
      method: 'POST',
      body: {
        contents: [{ parts: [{ text: prompt }] }]
      }
    })
  }
  
  async getOpenAIResponse(endpoint: string, body: any) {
    return this.request('openai', endpoint, {
      method: 'POST',
      body
    })
  }
  
  // Wikimedia APIs
  async getWikimediaData(params: Record<string, any>) {
    return this.request('wikimedia', '', { params })
  }
  
  async getWikipediaData(params: Record<string, any>) {
    return this.request('wikipedia', '', { params })
  }
  
  async getWikidataData(params: Record<string, any>) {
    return this.request('wikidata', '', { params })
  }
  
  // Utility methods
  private buildUrl(config: APIConfig, endpoint: string, params?: Record<string, any>): URL {
    const url = new URL(endpoint, config.baseUrl)
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      })
    }
    
    return url
  }
  
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  private generateCacheKey(apiType: APIType, endpoint: string, params?: Record<string, any>): string {
    const paramString = params ? JSON.stringify(params) : ''
    return `${apiType}:${endpoint}:${paramString}`
  }
  
  /**
   * Clear cache for specific API or all APIs
   */
  clearCache(apiType?: APIType): void {
    if (apiType) {
      for (const [key] of this.cache) {
        if (key.startsWith(`${apiType}:`)) {
          this.cache.delete(key)
        }
      }
    } else {
      this.cache.clear()
    }
  }
  
  /**
   * Get API usage statistics
   */
  getUsageStats(): Record<string, any> {
    const stats: Record<string, any> = {}
    
    for (const [apiType, rateLimiter] of this.rateLimiters) {
      stats[apiType] = {
        requests: rateLimiter.getRequestCount(),
        cacheSize: Array.from(this.cache.keys()).filter(key => key.startsWith(`${apiType}:`)).length
      }
    }
    
    return stats
  }
}

/**
 * Convenience functions for common use cases
 */

// Get singleton instance
export const getAPIManager = () => APIManager.getInstance()

// Direct API calls
export const api = {
  google: {
    maps: (endpoint: string, params?: Record<string, any>) => 
      getAPIManager().getGoogleMapsData(endpoint, params),
    places: (endpoint: string, params?: Record<string, any>) => 
      getAPIManager().getGooglePlacesData(endpoint, params),
    elevation: (params: Record<string, any>) => 
      getAPIManager().getGoogleElevationData(params),
    gemini: (prompt: string, model?: string) => 
      getAPIManager().getGeminiResponse(prompt, model)
  },
  
  osm: {
    nominatim: (endpoint: string, params?: Record<string, any>) => 
      getAPIManager().getNominatimData(endpoint, params),
    overpass: (query: string) => 
      getAPIManager().getOverpassData(query)
  },
  
  wiki: {
    media: (params: Record<string, any>) => 
      getAPIManager().getWikimediaData(params),
    pedia: (params: Record<string, any>) => 
      getAPIManager().getWikipediaData(params),
    data: (params: Record<string, any>) => 
      getAPIManager().getWikidataData(params)
  },
  
  ai: {
    openai: (endpoint: string, body: any) => 
      getAPIManager().getOpenAIResponse(endpoint, body),
    gemini: (prompt: string, model?: string) => 
      getAPIManager().getGeminiResponse(prompt, model)
  }
}

/**
 * Legacy compatibility - maintains existing API
 */
export const apiManager = getAPIManager()
