import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    console.log('🔧 Creating trigger point with service role:', {
      attraction_id,
      lat,
      lng,
      access,
      name,
      description
    })

    // Insert trigger point using service role (bypasses RLS issues)
    const { data, error } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .insert({
        attraction_id,
        location: `POINT(${lng} ${lat})`,
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
      })
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
