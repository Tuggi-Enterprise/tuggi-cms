import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    const userId = getUserIdFromRequest(request)
    
    console.log('🔧 Creating trigger point with service role:', {
      attraction_id,
      lat,
      lng,
      access,
      name,
      description,
      created_by: userId
    })

    // Prepare insert data with user tracking
    const insertData: any = {
      attraction_id,
      location: `POINT(${lng} ${lat})`,
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
      validation_notes: `Manually created by ${userId ? 'user' : 'system'}`
    }

    // Add user tracking if user ID is available
    if (userId) {
      insertData.created_by = userId
      insertData.updated_by = userId
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
