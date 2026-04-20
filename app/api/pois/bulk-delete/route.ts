import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { getSupabase } from '../../../../lib/core/supabase-client'
import { cookies } from 'next/headers'
import { memoryCache } from '@/lib/cache/memory-cache'
import { logAuditEvent } from '@/lib/services/audit-service'

const supabase = getSupabase('service')

export async function DELETE(request: NextRequest) {
  try {
    // Only admin users can perform bulk delete
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ success: false, error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Unauthorized - Admin only' }, { status: 403 })
    }
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

    await logAuditEvent({
      request,
      action: 'DELETE_POI',
      entity: 'POI',
      entityId: poiIds.join(', '),
      userId: cmsUser.id,
      userEmail: session.user.email || null,
      description: `Bulk deleted ${data?.length || 0} POIs`
    })

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

export async function POST(request: NextRequest) {
  return DELETE(request)
}