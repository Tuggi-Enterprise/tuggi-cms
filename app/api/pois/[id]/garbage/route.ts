import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

const supabaseService = getSupabase('service')

/**
 * POST /api/pois/[id]/garbage
 * Marks a POI as garbage (blacklisted) and deletes it from core.attractions.
 * Only system admins can perform this action.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: poiId } = await params
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Use RPC to get user info
    const { data: userData, error: userErr } = await supabaseAuth
      .schema('core')
      .rpc('get_cms_user_info', { p_email: session.user.email as string })
    
    const cmsUser = Array.isArray(userData) ? userData[0] : userData

    if (userErr || !cmsUser) return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })

    // Call RPC to delete as garbage and get name in one go
    const { data: deleteResult, error: rpcError } = await supabaseService
      .schema('core')
      .rpc('delete_poi_as_garbage', {
        p_poi_id: poiId,
        p_admin_id: cmsUser.id
      })

    if (rpcError) {
      console.error('Error calling delete_poi_as_garbage:', rpcError)
      return NextResponse.json({ error: rpcError.message || 'Failed to mark POI as garbage' }, { status: 500 })
    }

    const attractionName = Array.isArray(deleteResult) ? deleteResult[0]?.poi_name : (deleteResult as any)?.poi_name || 'POI'

    await logAuditEvent({
      request,
      action: 'DELETE_POI',
      entity: 'POI',
      entityId: poiId,
      userId: cmsUser.id,
      userEmail: session.user.email || null,
      description: `POI "${attractionName}" marked as garbage and deleted.`
    })

    return NextResponse.json({ success: true, message: 'POI marked as garbage' })

  } catch (err) {
    console.error('Error in POI garbage delete:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
