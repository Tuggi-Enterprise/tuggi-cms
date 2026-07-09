// Rate Limiter para APIs externas

// Declare Deno for TypeScript
declare const Deno: any;

export interface RateLimiter {
  key: string;
  capacity: number;
  refillRate: number; // tokens por segundo
  tokens: number;
  lastRefill: number;
}

// Cache em memória para rate limiters
const rateLimiters = new Map<string, RateLimiter>();

// Cache para resultados de API
const apiCache = new Map<string, { data: any; expires: number }>();

export function getRateLimiter(key: string, capacity: number, refillRate: number): RateLimiter {
  if (!rateLimiters.has(key)) {
    rateLimiters.set(key, {
      key,
      capacity,
      refillRate,
      tokens: capacity,
      lastRefill: Date.now()
    });
  }
  
  return rateLimiters.get(key)!;
}

export async function waitForToken(limiter: RateLimiter): Promise<void> {
  const now = Date.now();
  const timePassed = (now - limiter.lastRefill) / 1000; // segundos
  
  // Refill tokens
  const tokensToAdd = timePassed * limiter.refillRate;
  limiter.tokens = Math.min(limiter.capacity, limiter.tokens + tokensToAdd);
  limiter.lastRefill = now;
  
  // Se não há tokens, aguardar
  if (limiter.tokens < 1) {
    const waitTime = (1 - limiter.tokens) / limiter.refillRate * 1000;
    console.log(`⏳ Rate limit: aguardando ${Math.round(waitTime)}ms para ${limiter.key}`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return waitForToken(limiter); // Recursivo para garantir
  }
  
  // Consumir token
  limiter.tokens -= 1;
}

export function getCacheKey(operation: string, data: string): string {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hash = Array.from(dataBuffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${operation}_${hash.substring(0, 16)}`;
}

export function getFromCache<T>(key: string): T | null {
  const cached = apiCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  apiCache.delete(key);
  return null;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  apiCache.set(key, {
    data,
    expires: Date.now() + ttlMs
  });
}

// Configurações específicas para Gemini API
export const GEMINI_RATE_LIMITS = {
  // Gemini 2.5 Flash: 10 RPM, 250 RPD
  'gemini-2.5-flash': {
    capacity: 10,
    refillRate: 10 / 60, // 10 tokens por minuto = 0.167 tokens/segundo
    cacheTTL: 24 * 60 * 60 * 1000 // 24 horas
  },
  // Gemini 2.5 Flash-Lite: 15 RPM, 300 RPD
  'gemini-2.5-flash-lite': {
    capacity: 15,
    refillRate: 15 / 60, // 15 tokens por minuto = 0.25 tokens/segundo
    cacheTTL: 24 * 60 * 60 * 1000 // 24 horas
  },
  // Modelos 3.x (2.5 aposentado/flapping)
  'gemini-3.5-flash': {
    capacity: 10,
    refillRate: 10 / 60,
    cacheTTL: 24 * 60 * 60 * 1000
  },
  'gemini-3.1-flash-lite': {
    capacity: 15,
    refillRate: 15 / 60,
    cacheTTL: 24 * 60 * 60 * 1000
  }
};

// Função wrapper para chamadas da API Gemini
export async function callGeminiAPI(
  model: string,
  prompt: string,
  operation: string = 'generate'
): Promise<any> {
  const config = GEMINI_RATE_LIMITS[model as keyof typeof GEMINI_RATE_LIMITS];
  if (!config) {
    throw new Error(`Modelo ${model} não configurado para rate limiting`);
  }
  
  // Verificar cache primeiro
  const cacheKey = getCacheKey(operation, prompt);
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`✅ Cache hit para ${operation}`);
    return cached;
  }
  
  // Rate limiting
  const limiter = getRateLimiter(model, config.capacity, config.refillRate);
  await waitForToken(limiter);
  
  console.log(`🔄 Chamando Gemini API (${model}) - tokens restantes: ${Math.round(limiter.tokens)}`);
  
  // Fazer a chamada real da API
  const apiKey = (Deno as any).env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Salvar no cache
  setCache(cacheKey, data, config.cacheTTL);
  
  return data;
}

// Função para limpar cache expirado
export function cleanupExpiredCache(): number {
  const now = Date.now();
  let deletedCount = 0;
  
  for (const [key, value] of apiCache.entries()) {
    if (value.expires <= now) {
      apiCache.delete(key);
      deletedCount++;
    }
  }
  
  return deletedCount;
}

// Função para obter estatísticas de uso
export function getUsageStats() {
  const stats = {
    rateLimiters: {} as Record<string, any>,
    cacheSize: apiCache.size,
    cacheKeys: Array.from(apiCache.keys())
  };
  
  for (const [key, limiter] of rateLimiters.entries()) {
    stats.rateLimiters[key] = {
      tokens: Math.round(limiter.tokens),
      capacity: limiter.capacity,
      refillRate: limiter.refillRate
    };
  }
  
  return stats;
}
