import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { TriggerPointSavingService } from '@/lib/services/trigger-point-saving'

export async function POST(request: NextRequest) {
  try {
    // Only admins can delete trigger points
    const supabaseAuth = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
    }
    const body = await request.json()
    const { trigger_point_id, attraction_id } = body

    if (!trigger_point_id) {
      return NextResponse.json(
        { error: 'Missing required field: trigger_point_id' },
        { status: 400 }
      )
    }

    if (!attraction_id) {
      return NextResponse.json(
        { error: 'Missing required field: attraction_id' },
        { status: 400 }
      )
    }

    console.log('🗑️ Deleting trigger point using unified service:', trigger_point_id)

    // Use unified service to delete
    const result = await TriggerPointSavingService.deleteTriggerPoints(
      attraction_id,
      [trigger_point_id]
    )

    if (result.error) {
      console.error('❌ Error deleting trigger point:', result.error)
      return NextResponse.json(
        { error: result.error || 'Failed to delete trigger point' },
        { status: 500 }
      )
    }

    console.log('✅ Trigger point deleted successfully:', trigger_point_id)

    return NextResponse.json({
      success: true,
      deleted: result.deleted
    })

  } catch (error) {
    console.error('❌ Error processing delete request:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
