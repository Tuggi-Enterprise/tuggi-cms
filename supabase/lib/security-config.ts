/**
 * Configurações centralizadas de segurança para o Tuggi CMS
 * Este arquivo define configurações padrão para diferentes tipos de APIs
 */

import { z } from 'zod'
import { schemas } from './input-validation'

// Configurações de Rate Limiting por tipo de endpoint
export const rateLimitConfigs = {
  // APIs públicas (sem autenticação)
  public: {
    maxRequests: 200,
    windowMs: 60000, // 1 minuto
  },
  
  // APIs protegidas (com autenticação)
  protected: {
    maxRequests: 100,
    windowMs: 60000, // 1 minuto
  },
  
  // APIs de upload/modificação
  mutation: {
    maxRequests: 50,
    windowMs: 60000, // 1 minuto
  },
  
  // APIs de upload de arquivos
  upload: {
    maxRequests: 10,
    windowMs: 60000, // 1 minuto
  },
  
  // APIs administrativas
  admin: {
    maxRequests: 30,
    windowMs: 60000, // 1 minuto
  }
} as const

// Configurações de segurança avançada por tipo de endpoint
export const securityConfigs = {
  // Configuração para APIs públicas
  public: {
    enableIPBlocking: true,
    enableSuspiciousActivityDetection: true,
    maxRequestSize: 1024 * 1024, // 1MB
    requireHTTPS: process.env.NODE_ENV === 'production',
    allowedMethods: ['GET'] as const,
  },
  
  // Configuração para APIs protegidas
  protected: {
    enableIPBlocking: true,
    enableSuspiciousActivityDetection: true,
    maxRequestSize: 5 * 1024 * 1024, // 5MB
    requireHTTPS: process.env.NODE_ENV === 'production',
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE'] as const,
  },
  
  // Configuração para APIs de upload
  upload: {
    enableIPBlocking: true,
    enableSuspiciousActivityDetection: true,
    maxRequestSize: 50 * 1024 * 1024, // 50MB
    requireHTTPS: process.env.NODE_ENV === 'production',
    allowedMethods: ['POST'] as const,
  },
  
  // Configuração para APIs administrativas
  admin: {
    enableIPBlocking: true,
    enableSuspiciousActivityDetection: true,
    maxRequestSize: 10 * 1024 * 1024, // 10MB
    requireHTTPS: process.env.NODE_ENV === 'production',
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE'] as const,
  }
} as const

// Schemas de validação comuns para diferentes tipos de APIs
export const validationSchemas = {
  // Schema para APIs de lugares (Google Places)
  places: {
    searchParams: {
      query: schemas.safeString,
      location: z.string().optional(),
      radius: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(50000)).optional(),
      language: schemas.languageCode.optional(),
    }
  },
  
  // Schema para detalhes de lugares
  placeDetails: {
    searchParams: {
      place_id: schemas.placeId,
      language: schemas.languageCode.optional(),
    }
  },
  
  // Schema para geração de descrições
  generateDescription: {
    body: z.object({
      name: schemas.poiName,
      city: schemas.cityName.optional(),
      country: schemas.countryName.optional(),
      language: schemas.languageCode.optional(),
    })
  },
  
  // Schema para geração de áudio
  generateAudio: {
    body: z.object({
      text: schemas.audioText,
      language: schemas.languageCode.optional(),
    })
  },
  
  // Schema para paginação
  pagination: {
    searchParams: {
      page: z.string().transform(val => parseInt(val)).pipe(z.number().min(1)).optional(),
      limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional(),
    }
  },
  
  // Schema para IDs de recursos
  resourceId: {
    searchParams: {
      id: z.string().uuid('ID deve ser um UUID válido'),
    }
  },
  
  // Schema para coordenadas geográficas
  coordinates: {
    searchParams: {
      lat: z.string().transform(val => parseFloat(val)).pipe(z.number().min(-90).max(90)),
      lng: z.string().transform(val => parseFloat(val)).pipe(z.number().min(-180).max(180)),
    }
  }
} as const

// Configurações de CORS por ambiente
export const corsConfigs = {
  development: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  },
  
  production: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://yourdomain.com'],
    credentials: true,
  }
} as const

// Headers de segurança padrão
export const securityHeaders = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.openai.com https://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ')
} as const

// Configurações de logging por ambiente
export const loggingConfigs = {
  development: {
    level: 'debug',
    destination: 'console',
    includeStackTrace: true,
  },
  
  production: {
    level: 'info',
    destination: 'external', // Configurar serviço externo
    includeStackTrace: false,
  }
} as const

// Configurações de monitoramento
export const monitoringConfigs = {
  // Limites para bloqueio automático de IPs
  ipBlocking: {
    maxFailedAttempts: 5,
    maxRateLimitViolations: 3,
    blockDurationMs: 15 * 60 * 1000, // 15 minutos
  },
  
  // Configurações de análise de risco
  riskAnalysis: {
    suspiciousUserAgents: [
      'bot', 'crawler', 'spider', 'scraper',
      'curl', 'wget', 'python-requests'
    ],
    
    suspiciousHeaders: [
      'x-forwarded-for',
      'x-real-ip',
      'x-cluster-client-ip'
    ],
    
    maxRequestsPerMinute: 300,
  },
  
  // Configurações de limpeza de dados antigos
  cleanup: {
    intervalMs: 60 * 60 * 1000, // 1 hora
    maxAgeMs: 24 * 60 * 60 * 1000, // 24 horas
  }
} as const

// Função para obter configuração baseada no ambiente
export function getEnvironmentConfig<T>(configs: Record<string, T>): T {
  const env = process.env.NODE_ENV || 'development'
  return configs[env] || configs.development
}

// Função para mesclar configurações personalizadas
export function mergeSecurityConfig<T extends Record<string, any>>(
  defaultConfig: T,
  customConfig: Partial<T> = {}
): T {
  return { ...defaultConfig, ...customConfig }
}

// Tipos para TypeScript
export type RateLimitConfig = typeof rateLimitConfigs[keyof typeof rateLimitConfigs]
export type SecurityConfig = typeof securityConfigs[keyof typeof securityConfigs]
export type ValidationSchema = typeof validationSchemas[keyof typeof validationSchemas]
export type CorsConfig = typeof corsConfigs[keyof typeof corsConfigs]
export type LoggingConfig = typeof loggingConfigs[keyof typeof loggingConfigs]
export type MonitoringConfig = typeof monitoringConfigs