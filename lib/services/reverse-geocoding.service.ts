/**
 * Reverse Geocoding Service
 * 
 * Reusable service for reverse geocoding coordinates to get location information
 * Uses Nominatim API with rate limiting
 * 
 * Features:
 * - Rate limiting (1 request per second)
 * - Extracts city, state, country from coordinates
 * - Handles errors gracefully
 * - Returns formatted address information
 */

// =====================================
// RATE LIMITER
// =====================================

class RateLimiter {
  private requestCount: number = 0
  private windowStart: number = Date.now()
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  async waitForNextRequest(): Promise<void> {
    const now = Date.now()
    
    // Reset window if expired
    if (now - this.windowStart >= this.windowMs) {
      this.requestCount = 0
      this.windowStart = now
    }
    
    // Wait if limit reached
    if (this.requestCount >= this.maxRequests) {
      const waitTime = this.windowMs - (now - this.windowStart)
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime))
        this.requestCount = 0
        this.windowStart = Date.now()
      }
    }
    
    this.requestCount++
  }

  reset(): void {
    this.requestCount = 0
    this.windowStart = Date.now()
  }
}

// Rate limiter for Nominatim (1 request per second)
const nominatimLimiter = new RateLimiter(1, 1000)

// =====================================
// INTERFACES
// =====================================

export interface ReverseGeocodingResult {
  city: string | null
  state: string | null
  country: string | null
  formatted_address?: string | null
  confidence?: number
  raw_data?: any
}

// =====================================
// SERVICE CLASS
// =====================================

export class ReverseGeocodingService {
  /**
   * Reverse geocode coordinates to get location information
   * 
   * @param lat Latitude
   * @param lng Longitude
   * @returns Location information or null if failed
   */
  static async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodingResult | null> {
    await nominatimLimiter.waitForNextRequest()
    
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?` +
        `lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=10`
      
      console.log(`🌍 Reverse geocoding: ${lat}, ${lng}`)
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (reverse-geocoding-service)'
        }
      })
      
      if (!response.ok) {
        console.error(`❌ Nominatim API error: ${response.status}`)
        return null
      }
      
      const data = await response.json()
      
      if (!data.address) {
        console.log(`⚠️ No address data found for coordinates: ${lat}, ${lng}`)
        return null
      }
      
      // Extract location information from address components
      const address = data.address
      const city = address.city || 
                  address.town || 
                  address.municipality || 
                  address.village || 
                  address.hamlet ||
                  address.county ||
                  null
      
      const state = address.state || 
                   address.province || 
                   address.region ||
                   null
      
      const country = address.country || null
      
      // Build formatted address
      const formattedAddress = data.display_name || null
      
      return {
        city,
        state,
        country,
        formatted_address: formattedAddress,
        confidence: 85, // Fixed confidence for Nominatim
        raw_data: data
      }
      
    } catch (error) {
      console.error('❌ Reverse geocoding error:', error)
      return null
    }
  }

  /**
   * Validate coordinates (uses centralized validation utility)
   * 
   * @param lat Latitude
   * @param lng Longitude
   * @returns True if coordinates are valid
   * @deprecated Use validateCoordinates from lib/utils/coordinate-validation instead
   */
  static validateCoordinates(lat: number, lng: number): boolean {
    const { validateCoordinates } = require('../utils/coordinate-validation')
    return validateCoordinates(lat, lng).valid
  }
}

