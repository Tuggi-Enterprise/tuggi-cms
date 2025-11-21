import { NextRequest, NextResponse } from 'next/server'
import { TrailVisualizationService, TrailQueryParams } from '@/lib/services/trail-visualization.service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse bounds
    const boundsParam = searchParams.get('bounds')
    let bounds: TrailQueryParams['bounds'] | undefined
    if (boundsParam) {
      const [north, south, east, west] = boundsParam.split(',').map(Number)
      if (!isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west)) {
        bounds = { north, south, east, west }
      }
    }

    // Parse user IDs
    const userIdsParam = searchParams.get('userIds')
    const userIds = userIdsParam ? userIdsParam.split(',').filter(Boolean) : undefined

    // Parse trip session IDs
    const tripSessionIdsParam = searchParams.get('tripSessionIds')
    const tripSessionIds = tripSessionIdsParam ? tripSessionIdsParam.split(',').filter(Boolean) : undefined

    // Parse dates
    const startDate = searchParams.get('startDate') || undefined
    const endDate = searchParams.get('endDate') || undefined

    // Parse filters
    const onlyMoving = searchParams.get('onlyMoving') === 'true'

    // Parse pagination
    const limit = parseInt(searchParams.get('limit') || '5000', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const params: TrailQueryParams = {
      bounds,
      userIds,
      tripSessionIds,
      startDate,
      endDate,
      onlyMoving,
      limit,
      offset
    }

    const result = await TrailVisualizationService.getTrails(params)

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: result.data
    })
  } catch (error) {
    console.error('Error in trails API:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}

