import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

const supabaseService = getSupabase('service')

/**
 * POST /api/pois/bulk-garbage
 * Marks multiple POIs as garbage (blacklisted) and deletes them from core.attractions.
 * Only system admins can perform this action.
 */
export async function POST(request: NextRequest) {
  try {
    const { poiIds } = await request.json()
    
    if (!poiIds || !Array.isArray(poiIds) || poiIds.length === 0) {
      return NextResponse.json({ error: 'POI IDs array is required' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })

    // Only admins can mark as garbage
    const isAdmin = cmsUser.role === 'admin' || cmsUser.role === 'super_admin'
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
    }

    // Call bulk RPC to delete as garbage
    const { error: rpcError } = await supabaseService
      .rpc('bulk_delete_poi_as_garbage', {
        p_poi_ids: poiIds,
        p_admin_id: cmsUser.id
      })

    if (rpcError) {
      console.error('Error calling bulk_delete_poi_as_garbage:', rpcError)
      return NextResponse.json({ error: 'Failed to mark POIs as garbage' }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'DELETE_POI',
      entity: 'POI',
      entityId: poiIds.join(', '),
      userId: cmsUser.id,
      userEmail: session.user.email || null,
      description: `Bulk marked ${poiIds.length} POIs as garbage and deleted.`
    })

    return NextResponse.json({ success: true, message: `${poiIds.length} POIs marked as garbage` })

  } catch (err) {
    console.error('Error in bulk POI garbage delete:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
