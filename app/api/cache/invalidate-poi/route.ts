import { NextResponse } from 'next/server'
import { invalidatePOICache } from '@/lib/cache/poi-cache-invalidator'

/**
 * API para invalidar cache de POIs manualmente
 * Útil para invalidação via frontend ou outras integrações
 */
export async function POST() {
  try {
    const clearedEntries = invalidatePOICache('Manual API invalidation')
    
    return NextResponse.json({
      success: true,
      message: 'POI cache invalidated successfully',
      clearedEntries,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error invalidating POI cache:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to invalidate POI cache',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

/**
 * API para obter estatísticas do cache (GET)
 */
export async function GET() {
  try {
    const { memoryCache } = await import('@/lib/cache/memory-cache')
    const stats = memoryCache.getStats()
    
    // Contar entradas relacionadas a POIs
    const allKeys = Array.from((memoryCache as any).cache.keys()) as string[]
    const poiCacheEntries = allKeys.filter(key => 
      key.startsWith('pois-search') || key.startsWith('pois-search-all')
    ).length
    
    return NextResponse.json({
      success: true,
      stats: {
        ...stats,
        poiCacheEntries
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error getting cache stats:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get cache statistics',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}