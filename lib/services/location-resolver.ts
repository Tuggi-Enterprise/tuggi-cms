/**
 * Location Resolver Service
 * 
 * Implements hierarchical fallback system for geographic boundary searches
 * Handles city → county fallback when specific city boundaries are not available
 */

import { getSupabase } from '../core/supabase-client'

// Types
export interface LocationSearchResult {
  status: 'success' | 'fallback' | 'not_found'
  boundary_data?: {
    name: string
    name_en?: string
    geom: any
    admin_level: number
    coordinates?: Array<{lat: number, lng: number}>
  }
  display_name: string
  original_search: string
  boundary_type: 'city' | 'county' | 'state' | 'unknown'
  message: string
  warning: boolean
  confidence: number
}

export interface CityCountyMapping {
  county: string
  state: string
  admin_level?: number
}

/**
 * LocationResolver - Main class for hierarchical location search
 */
export class LocationResolver {
  private supabase: any
  
  // City → County mapping for known cities
  private readonly cityCountyMap: Record<string, CityCountyMapping> = {
    // Florida cities
    'orlando': { county: 'orange county', state: 'florida', admin_level: 6 },
    'miami': { county: 'miami-dade county', state: 'florida', admin_level: 6 },
    'tampa': { county: 'hillsborough county', state: 'florida', admin_level: 6 },
    'jacksonville': { county: 'duval county', state: 'florida', admin_level: 6 },
    'fort lauderdale': { county: 'broward county', state: 'florida', admin_level: 6 },
    'st. petersburg': { county: 'pinellas county', state: 'florida', admin_level: 6 },
    'tallahassee': { county: 'leon county', state: 'florida', admin_level: 6 },
    'gainesville': { county: 'alachua county', state: 'florida', admin_level: 6 },
    'key west': { county: 'monroe county', state: 'florida', admin_level: 6 },
    
    // New York cities
    'new york': { county: 'new york county', state: 'new york', admin_level: 6 },
    'brooklyn': { county: 'kings county', state: 'new york', admin_level: 6 },
    'queens': { county: 'queens county', state: 'new york', admin_level: 6 },
    'bronx': { county: 'bronx county', state: 'new york', admin_level: 6 },
    'staten island': { county: 'richmond county', state: 'new york', admin_level: 6 },
    'buffalo': { county: 'erie county', state: 'new york', admin_level: 6 },
    'rochester': { county: 'monroe county', state: 'new york', admin_level: 6 },
    'syracuse': { county: 'onondaga county', state: 'new york', admin_level: 6 },
    'albany': { county: 'albany county', state: 'new york', admin_level: 6 },
    
    // California cities
    'los angeles': { county: 'los angeles county', state: 'california', admin_level: 6 },
    'san francisco': { county: 'san francisco county', state: 'california', admin_level: 6 },
    'san diego': { county: 'san diego county', state: 'california', admin_level: 6 },
    'san jose': { county: 'santa clara county', state: 'california', admin_level: 6 },
    'sacramento': { county: 'sacramento county', state: 'california', admin_level: 6 },
    'oakland': { county: 'alameda county', state: 'california', admin_level: 6 },
    'fresno': { county: 'fresno county', state: 'california', admin_level: 6 },
    
    // Texas cities
    'houston': { county: 'harris county', state: 'texas', admin_level: 6 },
    'dallas': { county: 'dallas county', state: 'texas', admin_level: 6 },
    'austin': { county: 'travis county', state: 'texas', admin_level: 6 },
    'san antonio': { county: 'bexar county', state: 'texas', admin_level: 6 },
    'fort worth': { county: 'tarrant county', state: 'texas', admin_level: 6 },
    'el paso': { county: 'el paso county', state: 'texas', admin_level: 6 }
  }
  
  constructor(supabaseClient: any) {
    this.supabase = supabaseClient
  }
  
  /**
   * Main method for location resolution with hierarchical fallback
   */
  async resolveLocation(
    searchTerm: string, 
    lat?: number, 
    lng?: number, 
    state?: string
  ): Promise<LocationSearchResult> {
    const normalizedSearch = searchTerm.toLowerCase().trim()
    
    console.log(`🔍 LocationResolver: Starting search for "${searchTerm}"`)
    
    // STEP 1: Direct city search (admin_level 8-10)
    console.log('📍 Step 1: Direct city search...')
    const directResult = await this.searchDirectCity(normalizedSearch, lat, lng, state)
    if (directResult.status === 'success') {
      console.log('✅ Found direct city match')
      return directResult
    }
    
    // STEP 2: County fallback using mapping
    console.log('📍 Step 2: County fallback using city mapping...')
    const countyResult = await this.searchCountyFallback(normalizedSearch, lat, lng)
    if (countyResult.status === 'fallback') {
      console.log('✅ Found county fallback match')
      return countyResult
    }
    
    // STEP 3: Generic spatial search
    console.log('📍 Step 3: Generic spatial search...')
    if (lat && lng) {
      const spatialResult = await this.searchSpatialFallback(lat, lng, searchTerm)
      if (spatialResult.status !== 'not_found') {
        console.log('✅ Found spatial fallback match')
        return spatialResult
      }
    }
    
    // STEP 4: Name-based search (last resort)
    console.log('📍 Step 4: Name-based search fallback...')
    const nameResult = await this.searchNameFallback(normalizedSearch)
    if (nameResult.status !== 'not_found') {
      console.log('✅ Found name-based fallback match')
      return nameResult
    }
    
    console.log('❌ No matches found')
    return this.formatNotFoundResponse(searchTerm)
  }
  
  /**
   * Search for direct city match (admin_level 8-10)
   */
  private async searchDirectCity(
    cityName: string, 
    lat?: number, 
    lng?: number, 
    state?: string
  ): Promise<LocationSearchResult> {
    try {
      let query = this.supabase
        .schema('core')
        .from('city_boundaries')
        .select('name, name_en, geom, admin_level')
        .in('admin_level', [8, 9, 10]) // City/town/village levels
      
      // Add spatial constraint if coordinates provided
      if (lat && lng) {
        query = query.overlaps('geom', `POINT(${lng} ${lat})`)
      }
      
      // Add name search
      query = query.or(`name.ilike.%${cityName}%,name_en.ilike.%${cityName}%`)
      
      const result = await query.limit(5)
      
      if (result.data && result.data.length > 0) {
        // Find best match
        const bestMatch = this.findBestNameMatch(result.data, cityName)
        if (bestMatch) {
          return this.formatSuccessResponse(bestMatch, cityName, 'city')
        }
      }
      
      return this.formatNotFoundResponse(cityName)
    } catch (error) {
      console.error('Error in searchDirectCity:', error)
      return this.formatNotFoundResponse(cityName)
    }
  }
  
  /**
   * Search for county using city→county mapping
   */
  private async searchCountyFallback(
    cityName: string, 
    lat?: number, 
    lng?: number
  ): Promise<LocationSearchResult> {
    try {
      const countyInfo = this.getCityCountyMapping(cityName)
      if (!countyInfo) {
        return this.formatNotFoundResponse(cityName)
      }
      
      console.log(`🗺️ Mapped ${cityName} → ${countyInfo.county}, ${countyInfo.state}`)
      
      let query = this.supabase
        .schema('core')
        .from('city_boundaries')
        .select('name, name_en, geom, admin_level')
        .in('admin_level', [4, 5, 6]) // County/region levels
      
      // Search for county name
      query = query.or(`name.ilike.%${countyInfo.county}%,name_en.ilike.%${countyInfo.county}%`)
      
      const result = await query.limit(5)
      
      if (result.data && result.data.length > 0) {
        const bestMatch = this.findBestNameMatch(result.data, countyInfo.county)
        if (bestMatch) {
          return this.formatFallbackResponse(bestMatch, cityName, 'county')
        }
      }
      
      return this.formatNotFoundResponse(cityName)
    } catch (error) {
      console.error('Error in searchCountyFallback:', error)
      return this.formatNotFoundResponse(cityName)
    }
  }
  
  /**
   * Spatial search fallback using coordinates
   */
  private async searchSpatialFallback(
    lat: number, 
    lng: number, 
    originalSearch: string
  ): Promise<LocationSearchResult> {
    try {
      const result = await this.supabase
        .schema('core')
        .from('city_boundaries')
        .select('name, name_en, geom, admin_level')
        .overlaps('geom', `POINT(${lng} ${lat})`)
        .lte('admin_level', 10)
        .order('admin_level', { ascending: true })
        .limit(5)
      
      if (result.data && result.data.length > 0) {
        // Prefer city-level boundaries first
        const cityLevel = result.data.find((b: any) => b.admin_level >= 8 && b.admin_level <= 10)
        if (cityLevel) {
          return this.formatSuccessResponse(cityLevel, originalSearch, 'city')
        }
        
        // Fall back to county level
        const countyLevel = result.data.find((b: any) => b.admin_level >= 4 && b.admin_level <= 7)
        if (countyLevel) {
          return this.formatFallbackResponse(countyLevel, originalSearch, 'county')
        }
        
        // Use any available boundary
        return this.formatFallbackResponse(result.data[0], originalSearch, 'unknown')
      }
      
      return this.formatNotFoundResponse(originalSearch)
    } catch (error) {
      console.error('Error in searchSpatialFallback:', error)
      return this.formatNotFoundResponse(originalSearch)
    }
  }
  
  /**
   * Name-based search fallback (last resort)
   */
  private async searchNameFallback(searchTerm: string): Promise<LocationSearchResult> {
    try {
      const result = await this.supabase
        .schema('core')
        .from('city_boundaries')
        .select('name, name_en, geom, admin_level')
        .or(`name.ilike.%${searchTerm}%,name_en.ilike.%${searchTerm}%`)
        .order('admin_level', { ascending: true })
        .limit(5)
      
      if (result.data && result.data.length > 0) {
        const bestMatch = this.findBestNameMatch(result.data, searchTerm)
        if (bestMatch) {
          const boundaryType = this.getBoundaryType(bestMatch.admin_level)
          if (bestMatch.admin_level >= 8) {
            return this.formatSuccessResponse(bestMatch, searchTerm, boundaryType)
          } else {
            return this.formatFallbackResponse(bestMatch, searchTerm, boundaryType)
          }
        }
      }
      
      return this.formatNotFoundResponse(searchTerm)
    } catch (error) {
      console.error('Error in searchNameFallback:', error)
      return this.formatNotFoundResponse(searchTerm)
    }
  }
  
  /**
   * Get county mapping for a city
   */
  private getCityCountyMapping(cityName: string): CityCountyMapping | null {
    const normalized = cityName.toLowerCase().trim()
    return this.cityCountyMap[normalized] || null
  }
  
  /**
   * Find best name match from results
   */
  private findBestNameMatch(results: any[], searchTerm: string): any | null {
    if (!results || results.length === 0) return null
    
    const normalized = searchTerm.toLowerCase()
    
    // Exact match first
    const exactMatch = results.find(r => 
      (r.name && r.name.toLowerCase() === normalized) ||
      (r.name_en && r.name_en.toLowerCase() === normalized)
    )
    if (exactMatch) return exactMatch
    
    // Partial match
    const partialMatch = results.find(r => 
      (r.name && r.name.toLowerCase().includes(normalized)) ||
      (r.name_en && r.name_en.toLowerCase().includes(normalized))
    )
    if (partialMatch) return partialMatch
    
    // Return first result as fallback
    return results[0]
  }
  
  /**
   * Determine boundary type from admin level
   */
  private getBoundaryType(adminLevel: number): 'city' | 'county' | 'state' | 'unknown' {
    if (adminLevel >= 8) return 'city'
    if (adminLevel >= 4 && adminLevel <= 7) return 'county'
    if (adminLevel >= 2 && adminLevel <= 3) return 'state'
    return 'unknown'
  }
  
  /**
   * Parse PostGIS geometry to coordinates
   */
  private parseGeometry(geom: any): Array<{lat: number, lng: number}> | undefined {
    if (!geom || !geom.coordinates) return undefined
    
    try {
      let coordinates = geom.coordinates
      
      if (geom.type === 'MultiPolygon') {
        coordinates = coordinates[0] // Take first polygon
      }
      
      if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        return coordinates[0].map((coord: number[]) => ({
          lat: coord[1],
          lng: coord[0]
        }))
      }
    } catch (error) {
      console.error('Error parsing geometry:', error)
    }
    
    return undefined
  }
  
  /**
   * Format success response
   */
  private formatSuccessResponse(
    data: any, 
    originalSearch: string, 
    boundaryType: 'city' | 'county' | 'state' | 'unknown'
  ): LocationSearchResult {
    return {
      status: 'success',
      boundary_data: {
        ...data,
        coordinates: this.parseGeometry(data.geom)
      },
      display_name: data.name_en || data.name,
      original_search: originalSearch,
      boundary_type: boundaryType,
      message: `Encontrado: ${data.name_en || data.name}`,
      warning: false,
      confidence: 0.95
    }
  }
  
  /**
   * Format fallback response
   */
  private formatFallbackResponse(
    data: any, 
    originalSearch: string, 
    boundaryType: 'city' | 'county' | 'state' | 'unknown'
  ): LocationSearchResult {
    const displayName = data.name_en || data.name
    const typeLabel = boundaryType === 'county' ? 'condado' : 
                     boundaryType === 'state' ? 'estado' : 'região'
    
    return {
      status: 'fallback',
      boundary_data: {
        ...data,
        coordinates: this.parseGeometry(data.geom)
      },
      display_name: displayName,
      original_search: originalSearch,
      boundary_type: boundaryType,
      message: `Mostrando ${displayName} (${typeLabel}) - boundary da cidade "${originalSearch}" não disponível`,
      warning: true,
      confidence: 0.75
    }
  }
  
  /**
   * Format not found response
   */
  private formatNotFoundResponse(originalSearch: string): LocationSearchResult {
    return {
      status: 'not_found',
      display_name: '',
      original_search: originalSearch,
      boundary_type: 'unknown',
      message: `Nenhum boundary encontrado para "${originalSearch}"`,
      warning: true,
      confidence: 0
    }
  }
}

/**
 * Convenience function to create LocationResolver instance
 */
export function createLocationResolver(supabaseClient: any): LocationResolver {
  return new LocationResolver(supabaseClient)
}

/**
 * Export city-county mapping for external use
 */
export function getCityCountyMappings(): Record<string, CityCountyMapping> {
  const resolver = new LocationResolver(null)
  return (resolver as any).cityCountyMap
}