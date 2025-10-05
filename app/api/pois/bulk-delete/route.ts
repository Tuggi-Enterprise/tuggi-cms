import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'
import { memoryCache } from '@/lib/cache/memory-cache'

const supabase = getSupabase('service')

export async function DELETE(request: NextRequest) {
  try {
    const { poiIds } = await request.json()

    // Validate input
    if (!poiIds || !Array.isArray(poiIds) || poiIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'POI IDs array is required' },
        { status: 400 }
      )
    }

    // Limit bulk delete to prevent abuse
    if (poiIds.length > 100) {
      return NextResponse.json(
        { success: false, error: 'Cannot delete more than 100 POIs at once' },
        { status: 400 }
      )
    }

    console.log(`Attempting to delete ${poiIds.length} POIs:`, poiIds)

    // Delete POIs from database
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .delete()
      .in('id', poiIds)
      .select('id, name')

    if (error) {
      console.error('Error deleting POIs:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to delete POIs' },
        { status: 500 }
      )
    }

    console.log(`Successfully deleted ${data?.length || 0} POIs`)

    // Clear cache after successful deletion to ensure fresh data
    // Clear all POI search cache entries since POI counts and results have changed
    const cacheStats = memoryCache.getStats()
    let clearedCacheEntries = 0
    
    // Get all cache keys and clear POI-related ones
    const allKeys = Array.from((memoryCache as any).cache.keys()) as string[]
    for (const key of allKeys) {
      if (key.startsWith('pois-search') || key.startsWith('pois-search-all')) {
        memoryCache.delete(key)
        clearedCacheEntries++
      }
    }
    
    console.log(`Cleared ${clearedCacheEntries} cache entries after POI deletion`)

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${data?.length || 0} POIs`,
      deletedCount: data?.length || 0,
      deletedPois: data,
      cacheCleared: clearedCacheEntries
    })

  } catch (error) {
    console.error('Error in bulk delete:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}