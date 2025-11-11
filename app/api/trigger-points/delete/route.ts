import { NextRequest, NextResponse } from 'next/server'
import { TriggerPointSavingService } from '@/lib/services/trigger-point-saving'

export async function POST(request: NextRequest) {
  try {
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
