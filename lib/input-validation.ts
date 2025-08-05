import { z } from 'zod'
import DOMPurify from 'isomorphic-dompurify'

// Common validation schemas
export const schemas = {
  // Basic string validation with XSS protection
  safeString: z.string().min(1).max(1000).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] })
  }),
  
  // Email validation
  email: z.string().email().max(255),
  
  // URL validation
  url: z.string().url().max(2000),
  
  // Coordinates validation
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  
  // Google Place ID validation
  placeId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),
  
  // Language code validation (ISO 639-1)
  languageCode: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  
  // Pagination validation
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  
  // Search radius validation (in meters)
  radius: z.coerce.number().int().min(1).max(50000).default(1000),
  
  // Audio generation validation
  audioText: z.string().min(1).max(4000).transform((val: string) => {
    // Remove potentially harmful characters but keep basic punctuation
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] })
      .replace(/[<>"']/g, '') // Remove quotes and angle brackets
      .trim()
  }),
  
  audioVoice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).optional(),
  audioSpeed: z.number().min(0.25).max(4.0).optional(),
  
  // Description generation validation
  poiName: z.string().min(1).max(200).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] }).trim()
  }),
  
  cityName: z.string().min(1).max(100).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] }).trim()
  }),
  
  countryName: z.string().min(1).max(100).transform((val: string) => {
    return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] }).trim()
  }),
  
  // UUID validation
  uuid: z.string().uuid(),
  
  // File upload validation
  fileName: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(255),
  fileSize: z.number().int().min(1).max(10 * 1024 * 1024), // 10MB max
  
  // JSON validation with size limit
  jsonData: z.any().refine((val: any) => {
    try {
      const str = JSON.stringify(val)
      return str.length <= 100000 // 100KB limit
    } catch {
      return false
    }
  }, 'Invalid JSON or too large')
}

// Validation helper functions
export class InputValidator {
  static validateAndSanitize<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
    try {
      const result = schema.parse(data)
      return { success: true, data: result }
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ')
        return { success: false, error: errorMessage }
      }
      return { success: false, error: 'Validation failed' }
    }
  }
  
  static sanitizeHtml(html: string, allowedTags: string[] = []): string {
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: allowedTags })
  }
  
  static validateSearchParams(searchParams: URLSearchParams, schema: Record<string, z.ZodSchema>) {
    const data: Record<string, any> = {}
    const errors: string[] = []
    
    for (const [key, zodSchema] of Object.entries(schema)) {
      const value = searchParams.get(key)
      if (value !== null) {
        const result = this.validateAndSanitize(zodSchema, value)
        if (result.success) {
          data[key] = result.data
        } else {
          errors.push(`${key}: ${result.error}`)
        }
      }
    }
    
    return { data, errors }
  }
  
  static validateRequestBody(body: any, schema: z.ZodSchema) {
    return this.validateAndSanitize(schema, body)
  }
  
  // SQL injection prevention helpers
  static escapeSqlString(str: string): string {
    return str.replace(/'/g, "''")
  }
  
  static isValidIdentifier(identifier: string): boolean {
    // Only allow alphanumeric characters and underscores for table/column names
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)
  }
  
  // Rate limiting helpers
  static generateRateLimitKey(ip: string, endpoint: string): string {
    return `rate_limit:${ip}:${endpoint}`
  }
  
  // Security headers validation
  static validateSecurityHeaders(headers: Headers): { warnings: string[] } {
    const warnings: string[] = []
    
    if (!headers.get('authorization')) {
      warnings.push('Missing authorization header')
    }
    
    const userAgent = headers.get('user-agent')
    if (!userAgent || userAgent.length < 10) {
      warnings.push('Suspicious or missing user agent')
    }
    
    return { warnings }
  }
}

// Common validation schemas for API routes
export const apiSchemas = {
  // Places API validation
  placesNearby: {
    location: z.string().regex(/^-?\d+\.\d+,-?\d+\.\d+$/).optional(),
    radius: schemas.radius,
    type: z.string().max(50).optional(),
    keyword: schemas.safeString.optional(),
    language: schemas.languageCode
  },
  
  placeDetails: {
    place_id: schemas.placeId,
    fields: z.string().max(500).optional(),
    language: schemas.languageCode
  },
  
  // Audio generation validation
  audioGenerate: {
    text: schemas.audioText,
    voice: schemas.audioVoice,
    speed: schemas.audioSpeed,
    language: schemas.languageCode
  },
  
  // Description generation validation
  descriptionGenerate: {
    name: schemas.poiName,
    city: schemas.cityName,
    country: schemas.countryName,
    language: schemas.languageCode
  }
}