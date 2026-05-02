/**
 * Redis Cache — Wrapper para chamadas de API externas
 *
 * Usado pelo pipeline de migração para cachear respostas de:
 *   - Nominatim /lookup  (por osm_id)
 *   - Nominatim /reverse (por coordenada arredondada)
 *   - Overpass boundary  (por osm_id)
 *
 * O cliente é lazy-initialized e tolerante a falhas: se o Redis estiver
 * indisponível, todas as chamadas passam direto (cache miss silencioso).
 *
 * Uso:
 *   const data = await redisCache.getOrSet('nominatim:lookup:W123', 86400, () => fetch(...))
 */

import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

class RedisCache {
  private client: Redis | null = null
  private connected = false
  private connecting = false

  // ── Lazy connect ────────────────────────────────────────────────────────────
  private async getClient(): Promise<Redis | null> {
    if (this.connected && this.client) return this.client
    if (this.connecting) return null // evita conexões simultâneas

    this.connecting = true
    try {
      const client = new Redis(REDIS_URL, {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      })

      client.on('error', (err) => {
        // Loga apenas uma vez para não poluir o stdout do script
        if (this.connected) {
          console.warn(`⚠️  Redis disconnected: ${err.message}`)
        }
        this.connected = false
      })

      await client.connect()
      this.client = client
      this.connected = true
      console.log('✅ Redis cache connected')
    } catch (err: any) {
      console.warn(`⚠️  Redis unavailable (${err.message}) — running without cache`)
      this.client = null
      this.connected = false
    } finally {
      this.connecting = false
    }

    return this.client
  }

  // ── Core: get or fetch + store ──────────────────────────────────────────────
  /**
   * Tenta buscar `key` no Redis. Se não existir, executa `fn()`,
   * armazena o resultado com TTL em segundos e retorna.
   * Se o Redis estiver indisponível, executa `fn()` diretamente.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const client = await this.getClient()

    if (client) {
      try {
        const cached = await client.get(key)
        if (cached !== null) {
          return JSON.parse(cached) as T
        }
      } catch {
        // leitura falhou — continua sem cache
      }
    }

    const value = await fn()

    if (client && value !== null && value !== undefined) {
      try {
        await client.set(key, JSON.stringify(value), 'EX', ttlSeconds)
      } catch {
        // escrita falhou — ok, valor já foi obtido
      }
    }

    return value
  }

  // ── Helpers de chave ────────────────────────────────────────────────────────

  /**
   * Chave para Nominatim /lookup por OSM ID.
   * Imutável — TTL de 7 dias.
   */
  static nominatimLookupKey(osmType: string, osmId: string | number): string {
    return `nominatim:lookup:${osmType.toLowerCase()}:${osmId}`
  }

  /**
   * Chave para Nominatim /reverse por coordenada.
   * Arredonda para 3 casas decimais (~110m de precisão) para maximizar hits.
   * TTL de 7 dias.
   */
  static nominatimReverseKey(lat: number, lng: number): string {
    return `nominatim:reverse:${lat.toFixed(3)}:${lng.toFixed(3)}`
  }

  /**
   * Chave para Overpass boundary por OSM ID.
   * TTL de 24h (geometrias mudam raramente, mas podem mudar).
   */
  static overpassBoundaryKey(osmType: string, osmId: string | number): string {
    return `overpass:boundary:${osmType.toLowerCase()}:${osmId}`
  }

  /**
   * Chave para elevação de cidade via GeoNames + Open Elevation.
   * TTL 30 dias — dados geográficos de cidade são estáveis.
   */
  static elevationCityKey(city: string, country: string): string {
    return `elevation:city:${city.toLowerCase().replace(/\s+/g, '_')}:${country.toLowerCase().replace(/\s+/g, '_')}`
  }

  /**
   * Chave para amostragem regional de elevação (Open Elevation 4 pontos).
   * Arredonda para 2 casas decimais (~1km de precisão).
   * TTL 30 dias.
   */
  static elevationRegionKey(lat: number, lng: number): string {
    return `elevation:region:${lat.toFixed(2)}:${lng.toFixed(2)}`
  }

  /**
   * Chave para metadados do Google Street View por coordenada.
   * Arredonda para 5 casas decimais (~1m) — dados de cobertura são estáveis.
   * TTL 7 dias.
   */
  static streetViewMetadataKey(lat: number, lng: number): string {
    return `google:sv:metadata:${lat.toFixed(5)}:${lng.toFixed(5)}`
  }

  /**
   * Chave para Google Elevation API por lista de coordenadas.
   * Serializa até 4 pontos arredondados a 4 decimais (~11m).
   * TTL 30 dias.
   */
  static googleElevationKey(locations: Array<{ lat: number; lng: number }>): string {
    const pts = locations.map(l => `${l.lat.toFixed(4)},${l.lng.toFixed(4)}`).join('|')
    return `google:elevation:${pts}`
  }

  // ── TTLs padronizados (segundos) ────────────────────────────────────────────
  static readonly TTL = {
    NOMINATIM:    7 * 24 * 60 * 60,   // 7 dias
    OVERPASS:     24 * 60 * 60,        // 24 horas
    ELEVATION:    30 * 24 * 60 * 60,   // 30 dias
    STREET_VIEW:  7 * 24 * 60 * 60,    // 7 dias
  } as const

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit()
      this.client = null
      this.connected = false
    }
  }
}

export { RedisCache }

// Singleton — compartilhado por todo o processo
export const redisCache = new RedisCache()
