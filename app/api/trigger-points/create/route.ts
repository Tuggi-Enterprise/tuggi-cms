import { NextRequest, NextResponse } from 'next/server'
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
      direction = null,
      access = 'both',
      name,
      description
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
    
    console.log('🔧 Creating trigger point with service role:', {
      attraction_id,
      lat,
      lng,
      access,
      name,
      description,
      auth_user_id: authUserId,
      cms_user_id: cmsUserId
    })

    // Prepare insert data with user tracking
    const insertData: any = {
      attraction_id,
      // Use EWKT with SRID for PostGIS geography
      location: `SRID=4326;POINT(${lng} ${lat})`,
      radius_meters,
      expected_bearing,
      bearing_threshold,
      type,
      priority,
      is_active,
      direction,
      // For manual TPs, set appropriate confidence system values
      confidence_score: 0.8, // Manual TPs get high confidence
      manual_status: 'approved', // Manual TPs are approved by default
      generation_method: 'manual',
      validation_notes: `Manually created by ${cmsUserId ? 'user' : 'system'}`
    }

    // Add user tracking if cms user ID is available
    if (cmsUserId) {
      insertData.created_by = cmsUserId
      insertData.updated_by = cmsUserId
    }

    // Insert trigger point using service role (bypasses RLS issues)
    const { data, error } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('❌ Error inserting trigger point:', error)
      return NextResponse.json(
        { error: 'Failed to insert trigger point', details: error },
        { status: 500 }
      )
    }

    console.log('✅ Trigger point created successfully:', data.id)

    return NextResponse.json({
      success: true,
      data
    })

  } catch (error) {
    console.error('❌ Error processing request:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
