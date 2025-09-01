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
      trigger_point_id,
      lat,
      lng,
      radius_meters,
      expected_bearing,
      bearing_threshold,
      type,
      priority,
      is_active,
      direction,
      access,
      name,
      description
    } = body

    if (!trigger_point_id) {
      return NextResponse.json(
        { error: 'Missing required field: trigger_point_id' },
        { status: 400 }
      )
    }

    // Get user ID for tracking
    const userId = getUserIdFromRequest(request)
    
    console.log('🔧 Updating trigger point with service role:', {
      trigger_point_id,
      lat,
      lng,
      access,
      name,
      description,
      updated_by: userId
    })

    // Prepare update data with user tracking
    const updateData: any = {
      updated_at: new Date().toISOString(),
      ...(lat && lng && { location: `POINT(${lng} ${lat})` }),
      ...(radius_meters !== undefined && { radius_meters }),
      ...(expected_bearing !== undefined && { expected_bearing }),
      ...(bearing_threshold !== undefined && { bearing_threshold }),
      ...(type && { type }),
      ...(priority !== undefined && { priority }),
      ...(is_active !== undefined && { is_active }),
      ...(direction !== undefined && { direction }),
      ...(access && { access }),
      ...(name && { name }),
      ...(description && { description })
    }

    // Add user tracking if user ID is available
    if (userId) {
      updateData.updated_by = userId
    }

    // Update trigger point using service role (bypasses RLS issues)
    const { data, error } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .update(updateData)
      .eq('id', trigger_point_id)
      .select()
      .single()

    if (error) {
      console.error('❌ Error updating trigger point:', error)
      return NextResponse.json(
        { error: 'Failed to update trigger point', details: error },
        { status: 500 }
      )
    }

    console.log('✅ Trigger point updated successfully:', data.id)

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
