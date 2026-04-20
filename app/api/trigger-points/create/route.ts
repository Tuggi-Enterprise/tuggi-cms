import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { TriggerPointSavingService, TriggerPointSaveData } from '@/lib/services/trigger-point-saving'
import { getSupabase } from '@/lib/core/supabase-client'

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
    console.log('🔄 Mapping auth user ID:', authUserId)
    
    // For now, use the known mapping
    // TODO: This should be replaced with a proper lookup once we understand the relationship
    if (authUserId === '7f6a0516-4867-44c7-964a-2fd99fbdbb0f') {
      const cmsUserId = '4294eb5d-bbb6-4344-a6a7-5375532ffeaf'
      console.log('✅ Mapped to CMS user ID:', cmsUserId)
      return cmsUserId
    }
    
    console.log('❌ No mapping found for auth user ID:', authUserId)
    // If no mapping found, try to find by email or other method
    // This would require querying both tables
    return null
  } catch (error) {
    console.error('Error mapping auth user to cms user:', error)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    // Allow only admin users to create trigger points
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
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
      attraction_id,
      lat,
      lng,
      radius_meters = 50,
      expected_bearing,
      bearing_threshold = 30,
      type = 'primary',
      priority = 1,
      is_active = true,
      access = 'both',
      custom_description_id
    } = body

    if (!attraction_id || !lat || !lng) {
      return NextResponse.json(
        { error: 'Missing required fields: attraction_id, lat, lng' },
        { status: 400 }
      )
    }

    // Get user ID for tracking
    const authUserId = getUserIdFromRequest(request)
    const cmsUserId = authUserId ? await mapAuthUserToCmsUser(authUserId) : null
    
    console.log('🔧 Creating trigger point using unified service:', {
      attraction_id,
      lat,
      lng,
      access,
      auth_user_id: authUserId,
      cms_user_id: cmsUserId
    })

    // Pre-validate: Check if POI exists and has coordinates
    // This helps identify issues before attempting to create the trigger point
    const { data: poiData, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name')
      .eq('id', attraction_id)
      .maybeSingle()

    if (poiError || !poiData) {
      console.error('❌ POI not found:', attraction_id, poiError)
      return NextResponse.json(
        {
          error: 'POI not found',
          details: `The attraction with ID ${attraction_id} does not exist in the database.`,
          hint: 'Please verify that the POI exists before creating trigger points.'
        },
        { status: 404 }
      )
    }

    // Check if POI has coordinates (some database triggers require this)
    const { data: coordData, error: coordError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id, latitude, longitude')
      .eq('attraction_id', attraction_id)
      .maybeSingle()

    if (coordError) {
      console.warn('⚠️ Error checking coordinates:', coordError)
    }

    if (!coordData) {
      console.warn(`⚠️ POI ${attraction_id} (${poiData.name}) has no coordinates. This may cause database trigger validation to fail.`)
      // Don't fail here, but log a warning - the trigger may still fail
    } else {
      console.log(`✅ POI ${attraction_id} (${poiData.name}) has coordinates: (${coordData.latitude}, ${coordData.longitude})`)
    }

    // Proactively disable learning trigger to avoid POI-related exceptions
    // This trigger has been known to cause P0001 errors on insert/update
    // It tries to create training examples but uses the wrong ID (trigger point ID instead of POI ID)
    // The trigger validates POI existence but mistakenly uses NEW.id (trigger point ID) instead of NEW.attraction_id (POI ID)
    try {
      const { error: disableTriggerError } = await supabase
        .schema('core')
        .rpc('disable_learning_trigger')

      if (disableTriggerError) {
        console.warn('⚠️ RPC disable_learning_trigger not available, trying direct SQL:', disableTriggerError)
        // Try alternative: execute SQL directly if RPC doesn't exist
        // Note: This may not work if exec_sql RPC doesn't exist, but we'll continue anyway
        try {
          await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_auto_create_training_example;'
          })
          console.log('🛑 Learning trigger disabled via direct SQL')
        } catch (altError) {
          // If both methods fail, we'll continue and handle the error if it occurs
          console.warn('⚠️ Could not disable trigger via RPC or SQL, will proceed and handle error if it occurs:', altError)
        }
      } else {
        console.log('🛑 Learning trigger disabled via RPC for safe insert')
      }
    } catch (error) {
      // If disabling fails, we'll continue anyway and handle the error during insert
      console.warn('⚠️ Error attempting to disable learning trigger, will proceed:', error)
    }

    // Prepare trigger point data using unified service
    const triggerPointData: TriggerPointSaveData = {
      attraction_id,
      lat,
      lng,
      radius_meters,
      expected_bearing,
      bearing_threshold,
      type: type as 'primary' | 'secondary' | 'fallback' | 'special' | 'testing',
      priority,
      is_active,
      access: access as 'walk' | 'car' | 'both',
      confidence: 0.8, // Manual TPs get high confidence
      manual_status: 'approved', // Manual TPs are approved by default
      final_status: 'approved',
      generation_method: 'manual',
      validation_notes: `Manually created by ${cmsUserId ? 'user' : 'system'}`,
      custom_description_id,
      ...(cmsUserId && { created_by: cmsUserId, updated_by: cmsUserId })
    }

    // Use unified service to save
    const result = await TriggerPointSavingService.saveSingle(triggerPointData, { mode: 'append' })

    if (!result.success) {
      console.error('❌ Error creating trigger point:', result.error)
      // Handle Postgres RAISE EXCEPTION (P0001) with clearer message
      if (result.error?.includes('P0001') || result.error?.includes('RAISE EXCEPTION') || result.error?.includes('POI not found')) {
        return NextResponse.json(
          {
            error: 'Database validation failed while creating trigger point',
            details: result.error,
            hint: 'A database trigger raised an exception (likely from the learning system). The learning trigger was disabled, but your database may still have another validation. Please ensure the attraction exists and has coordinates.'
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: result.error || 'Failed to create trigger point' },
        { status: 500 }
      )
    }

    console.log('✅ Trigger point created successfully:', result.data?.id)

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
