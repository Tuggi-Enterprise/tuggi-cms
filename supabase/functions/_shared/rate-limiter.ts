/**
 * Rate Limiting Middleware for Supabase Edge Functions
 * 
 * Implementa rate limiting baseado em:
 * - IP Address (para usuários não autenticados)
 * - User ID (para usuários autenticados)
 * - Por função (diferentes limites para cada operação)
 * 
 * Usa em-memory counter com TTL para máxima performance
 * 
 * Uso:
 * const result = await checkRateLimit(req, 'generate-description', 10, 3600)
 * if (!result.allowed) {
 *   return new Response(JSON.stringify(result.error), { status: 429, headers: corsHeaders })
 * }
 */

interface RateLimitConfig {
  maxRequests: number      // Máximo de requisições
  windowSeconds: number    // Janela de tempo em segundos
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  error?: {
    message: string
    retryAfter: number
  }
}

// Store em memória com TTL
// Formato: `${key}_${timestamp}` -> count
const rateLimitStore = new Map<string, { count: number; expiresAt: number }>()

// Limpar entradas expiradas periodicamente
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.expiresAt < now) {
      rateLimitStore.delete(key)
    }
  }
}, 60000) // A cada 1 minuto

/**
 * Extrair IP do request
 * Suporta X-Forwarded-For e Cf-Connecting-Ip headers
 */
export function getClientIP(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }

  const cfConnectingIp = req.headers.get('cf-connecting-ip')
  if (cfConnectingIp) {
    return cfConnectingIp
  }

  return 'unknown'
}

/**
 * Extrair User ID do JWT token (se autenticado)
 */
export function extractUserID(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  try {
    const token = authHeader.substring(7)
    // JWT format: header.payload.signature
    const parts = token.split('.')
    if (parts.length !== 3) return null

    // Decode payload (parte do meio)
    const payload = JSON.parse(atob(parts[1]))
    return payload.sub || null
  } catch {
    return null
  }
}

/**
 * Verificar se request está dentro do rate limit
 * 
 * @param req - Request object
 * @param functionName - Nome da função (para diferentes limites)
 * @param maxRequests - Máximo de requisições permitidas
 * @param windowSeconds - Janela de tempo em segundos
 * @returns RateLimitResult com status e informações
 */
export function checkRateLimit(
  req: Request,
  functionName: string,
  maxRequests: number = 10,
  windowSeconds: number = 3600
): RateLimitResult {
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000

  // Determinar chave de rate limit: preferir user ID, caso contrário IP
  const authHeader = req.headers.get('authorization')
  const userId = extractUserID(authHeader)
  const clientIP = getClientIP(req)
  const identifier = userId || clientIP
  const key = `ratelimit:${functionName}:${identifier}`

  // Obter contador atual
  const stored = rateLimitStore.get(key)

  // Se expirou, resetar
  if (!stored || stored.expiresAt < now) {
    rateLimitStore.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    })

    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: Math.floor((now + windowSeconds * 1000) / 1000),
    }
  }

  // Verificar se ultrapassou limite
  if (stored.count >= maxRequests) {
    const retryAfter = Math.ceil((stored.expiresAt - now) / 1000)

    return {
      allowed: false,
      remaining: 0,
      resetAt: Math.floor(stored.expiresAt / 1000),
      error: {
        message: `Rate limit exceeded. Max ${maxRequests} requests per ${windowSeconds}s`,
        retryAfter,
      },
    }
  }

  // Incrementar contador
  stored.count++

  return {
    allowed: true,
    remaining: maxRequests - stored.count,
    resetAt: Math.floor(stored.expiresAt / 1000),
  }
}

/**
 * Rate Limit Config por função
 * 
 * Formato: functionName -> { maxRequests, windowSeconds }
 * Funções caras (gerar conteúdo) têm limites mais baixos
 */
export const RATE_LIMIT_CONFIG: Record<string, RateLimitConfig> = {
  // Funções caras (usar APIs externas, processar)
  'generate-description': {
    maxRequests: 5,      // 5 requisições
    windowSeconds: 3600, // por hora
  },
  'generate-native-narration': {
    maxRequests: 5,
    windowSeconds: 3600,
  },
  'generate-contextual-narration': {
    maxRequests: 5,
    windowSeconds: 3600,
  },
  'generate-translated-audio': {
    maxRequests: 5,
    windowSeconds: 3600,
  },

  // Extração de imagens (menos cara mas ainda significativa)
  'extract-iphan-images': {
    maxRequests: 10,
    windowSeconds: 3600,
  },
  'extract-osm-images': {
    maxRequests: 10,
    windowSeconds: 3600,
  },
  'extract-website-images': {
    maxRequests: 10,
    windowSeconds: 3600,
  },
  'extract-wikidata-images': {
    maxRequests: 10,
    windowSeconds: 3600,
  },
  'extract-wikipedia-images': {
    maxRequests: 10,
    windowSeconds: 3600,
  },
  'extract-specialized-images': {
    maxRequests: 10,
    windowSeconds: 3600,
  },

  // Geração de trigger points
  'generate-trigger-points': {
    maxRequests: 20,     // 20 requisições
    windowSeconds: 3600, // por hora
  },

  // Operações de verificação/processamento
  'verify-batch': {
    maxRequests: 30,
    windowSeconds: 3600,
  },
  'city-correction': {
    maxRequests: 30,
    windowSeconds: 3600,
  },
  'city-correction-monitor': {
    maxRequests: 50,
    windowSeconds: 3600,
  },

  // Armazenamento
  'store-poi-audio': {
    maxRequests: 50,
    windowSeconds: 3600,
  },
  'store-poi-images': {
    maxRequests: 50,
    windowSeconds: 3600,
  },

  // Default para funções não mapeadas
  'default': {
    maxRequests: 100,
    windowSeconds: 3600,
  },
}

/**
 * Helper para criar resposta 429 (Too Many Requests)
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      error: 'Too Many Requests',
      message: result.error?.message,
      retryAfter: result.error?.retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Retry-After': String(result.error?.retryAfter || 60),
        'X-RateLimit-Limit': '?',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(result.resetAt),
      },
    }
  )
}

/**
 * Exemplo de uso em edge function:
 * 
 * import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts'
 * 
 * serve(async (req) => {
 *   const config = RATE_LIMIT_CONFIG['generate-description']
 *   const rateLimit = checkRateLimit(req, 'generate-description', config.maxRequests, config.windowSeconds)
 *   
 *   if (!rateLimit.allowed) {
 *     return createRateLimitResponse(rateLimit, corsHeaders)
 *   }
 *   
 *   // Resto da função...
 * })
 */
