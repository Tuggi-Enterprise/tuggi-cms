import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { TriggerPointSavingService, TriggerPointSaveData } from '@/lib/services/trigger-point-saving'
import { getSupabase } from '../../../../lib/core/supabase-client'

const supabase = getSupabase('service')

// Helper function to get user ID from request headers
function getUserIdFromRequest(request: NextRequest): string | null {
  // Try to get user ID from authorization header or other sources
  const authHeader = request.headers.get('authorization')
  const userIdHeader = request.headers.get('x-user-id')
  
  if (userIdHeader) {
    return userIdHeader
  }
  
  // Could add JWT parsing here if needed
  return null
}

// Helper function to map auth user ID to cms user ID
async function mapAuthUserToCmsUser(authUserId: string): Promise<string | null> {
  try {
    console.log('🔄 Mapping auth user ID for update:', authUserId)
    
    // For now, use the known mapping
    // TODO: This should be replaced with a proper lookup once we understand the relationship
    if (authUserId === '7f6a0516-4867-44c7-964a-2fd99fbdbb0f') {
      const cmsUserId = '4294eb5d-bbb6-4344-a6a7-5375532ffeaf'
      console.log('✅ Mapped to CMS user ID for update:', cmsUserId)
      return cmsUserId
    }
    
    console.log('❌ No mapping found for auth user ID in update:', authUserId)
    return null
  } catch (error) {
    console.error('Error mapping auth user to cms user in update:', error)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    // Only admins can update trigger points
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
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
    const {
      trigger_point_id,
      lat,
      lng,
      radius_meters,
      expected_bearing,
      bearing_threshold,
      type,
      priority,
      is_active,
      access,
      custom_description_id
    } = body

    if (!trigger_point_id) {
      return NextResponse.json(
        { error: 'Missing required field: trigger_point_id' },
        { status: 400 }
      )
    }

    // Get user ID for tracking
    const authUserId = getUserIdFromRequest(request)
    const cmsUserId = authUserId ? await mapAuthUserToCmsUser(authUserId) : null
    
    console.log('🔧 Updating trigger point using unified service:', {
      trigger_point_id,
      lat,
      lng,
      access,
      auth_user_id: authUserId,
      cms_user_id: cmsUserId
    })

    // Prepare update data using unified service
    const updateData: Partial<TriggerPointSaveData> = {
      ...(lat != null && lng != null && { lat, lng }),
      ...(radius_meters !== undefined && { radius_meters }),
      ...(expected_bearing !== undefined && { expected_bearing }),
      ...(bearing_threshold !== undefined && { bearing_threshold }),
      ...(type && { type: type as 'primary' | 'secondary' | 'fallback' | 'special' | 'testing' }),
      ...(priority !== undefined && { priority }),
      ...(is_active !== undefined && { is_active }),
      ...(access && { access: access as 'walk' | 'car' | 'both' }),
      ...(custom_description_id !== undefined && { custom_description_id }),
      ...(cmsUserId && { updated_by: cmsUserId })
    }

    // Proactively disable learning trigger to avoid POI-related exceptions
    // This trigger has been known to cause P0001 errors on insert/update
    const { error: disableTriggerError } = await supabase
      .schema('core')
      .rpc('disable_learning_trigger')

    if (disableTriggerError) {
      console.warn('⚠️ Failed to disable learning trigger (continuing):', disableTriggerError)
    } else {
      console.log('🛑 Learning trigger disabled temporarily for safe update')
    }

    // Use unified service to update
    const result = await TriggerPointSavingService.updateSingle(trigger_point_id, updateData)

    if (!result.success) {
      console.error('❌ Error updating trigger point:', result.error)
      // Handle Postgres RAISE EXCEPTION (P0001) with clearer message
      if (result.error?.includes('P0001') || result.error?.includes('RAISE EXCEPTION')) {
        return NextResponse.json(
          {
            error: 'Database validation failed while updating trigger point',
            details: result.error,
            hint:
              'A database trigger raised an exception (likely from the learning system). The learning trigger was disabled, but your database may still have another validation. Please ensure attraction exists and has coordinates.'
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: result.error || 'Failed to update trigger point' },
        { status: 500 }
      )
    }

    console.log('✅ Trigger point updated successfully:', result.data?.id)

    return NextResponse.json({
      success: true,
      data: result.data
    })

  } catch (error) {
    console.error('❌ Error processing request:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
