import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { InputValidator } from './input-validation'
import { securityLogger } from './security-logger'

export interface ValidationConfig {
  searchParams?: Record<string, z.ZodSchema>
  body?: z.ZodSchema
  headers?: Record<string, z.ZodSchema>
}

export function withValidation(config: ValidationConfig) {
  return function(handler: (req: NextRequest, validatedData: any) => Promise<NextResponse>) {
    return async function(request: NextRequest): Promise<NextResponse> {
      try {
        const validatedData: any = {}
        const errors: string[] = []
        
        // Validate search parameters
        if (config.searchParams) {
          const { data, errors: paramErrors } = InputValidator.validateSearchParams(
            request.nextUrl.searchParams,
            config.searchParams
          )
          validatedData.searchParams = data
          errors.push(...paramErrors)
        }
        
        // Validate request body
        if (config.body && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
          try {
            const body = await request.json()
            const result = InputValidator.validateRequestBody(body, config.body)
            if (result.success) {
              validatedData.body = result.data
            } else {
              errors.push(`Body validation: ${result.error}`)
            }
          } catch (error) {
            errors.push('Invalid JSON in request body')
          }
        }
        
        // Validate headers
        if (config.headers) {
          const headerData: Record<string, any> = {}
          for (const [key, schema] of Object.entries(config.headers)) {
            const value = request.headers.get(key)
            if (value !== null) {
              const result = InputValidator.validateAndSanitize(schema, value)
              if (result.success) {
                headerData[key] = result.data
              } else {
                errors.push(`Header ${key}: ${result.error}`)
              }
            }
          }
          validatedData.headers = headerData
        }
        
        // Check for validation errors
        if (errors.length > 0) {
          await securityLogger.logSuspiciousActivity(
            request,
            `Validation failed: ${errors.join(', ')}`
          )
          return NextResponse.json(
            { error: 'Validation failed', details: errors },
            { status: 400 }
          )
        }
        
        // Check for suspicious patterns
        const { warnings } = InputValidator.validateSecurityHeaders(request.headers)
        if (warnings.length > 0) {
          await securityLogger.logSuspiciousActivity(
            request,
            `Security warnings: ${warnings.join(', ')}`
          )
        }
        
        return await handler(request, validatedData)
        
      } catch (error) {
        await securityLogger.logSecurityEvent({
          event_type: 'api_error',
          ip_address: request.headers.get('x-forwarded-for') || 'unknown',
          endpoint: request.nextUrl.pathname,
          details: { error: String(error) },
          severity: 'medium'
        })
        
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        )
      }
    }
  }
}

// Pre-configured validation middleware for common use cases
export const withPlacesValidation = withValidation({
  searchParams: {
    location: z.string().regex(/^-?\d+\.\d+,-?\d+\.\d+$/).optional(),
    radius: z.coerce.number().int().min(1).max(50000).default(1000),
    type: z.string().max(50).optional(),
    keyword: z.string().min(1).max(100).optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional()
  }
})

export const withPlaceDetailsValidation = withValidation({
  searchParams: {
    place_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),
    fields: z.string().max(500).optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional()
  }
})

export const withAudioValidation = withValidation({
  body: z.object({
    text: z.string().min(1).max(4000),
    voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).optional(),
    speed: z.number().min(0.25).max(4.0).optional(),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional()
  })
})

export const withDescriptionValidation = withValidation({
  body: z.object({
    name: z.string().min(1).max(200),
    city: z.string().min(1).max(100),
    country: z.string().min(1).max(100),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional()
  })
})