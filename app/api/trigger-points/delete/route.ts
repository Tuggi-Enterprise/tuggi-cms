import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '../../../../lib/core/supabase-client'

const supabase = getSupabase('service')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { trigger_point_id } = body

    if (!trigger_point_id) {
      return NextResponse.json(
        { error: 'Missing required field: trigger_point_id' },
        { status: 400 }
      )
    }

    console.log('🗑️ Deleting trigger point with service role:', trigger_point_id)

    // Delete trigger point using service role (bypasses RLS issues)
    const { data, error } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .delete()
      .eq('id', trigger_point_id)
      .select()
      .single()

    if (error) {
      console.error('❌ Error deleting trigger point:', error)
      return NextResponse.json(
        { error: 'Failed to delete trigger point', details: error },
        { status: 500 }
      )
    }

    console.log('✅ Trigger point deleted successfully:', data?.id)

    return NextResponse.json({
      success: true,
      data
    })

  } catch (error) {
    console.error('❌ Error processing delete request:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
