import { memoryCache } from '@/lib/cache/memory-cache'

/**
 * Invalida todas as entradas de cache relacionadas a POIs
 * @param reason Motivo da invalidação (para logs)
 * @returns Número de entradas de cache removidas
 */
export function invalidatePOICache(reason?: string): number {
  const allKeys = Array.from((memoryCache as any).cache.keys()) as string[]
  let clearedEntries = 0
  
  for (const key of allKeys) {
    if (key.startsWith('pois-search') || key.startsWith('pois-search-all')) {
      memoryCache.delete(key)
      clearedEntries++
    }
  }
  
  console.log(`🧹 POI Cache invalidated: ${clearedEntries} entries cleared${reason ? ` (${reason})` : ''}`)
  return clearedEntries
}

/**
 * Invalida cache específico por padrão de chave
 * @param pattern Padrão da chave para invalidar
 * @param reason Motivo da invalidação
 * @returns Número de entradas removidas
 */
export function invalidateCacheByPattern(pattern: string, reason?: string): number {
  const allKeys = Array.from((memoryCache as any).cache.keys()) as string[]
  let clearedEntries = 0
  
  for (const key of allKeys) {
    if (key.includes(pattern)) {
      memoryCache.delete(key)
      clearedEntries++
    }
  }
  
  console.log(`🧹 Cache invalidated by pattern '${pattern}': ${clearedEntries} entries cleared${reason ? ` (${reason})` : ''}`)
  return clearedEntries
}

/**
 * Invalida todo o cache (usar com cuidado)
 * @param reason Motivo da invalidação completa
 */
export function invalidateAllCache(reason?: string): void {
  const stats = memoryCache.getStats()
  memoryCache.clear()
  console.log(`🧹 ALL Cache cleared: ${stats.total} entries removed${reason ? ` (${reason})` : ''}`)
}