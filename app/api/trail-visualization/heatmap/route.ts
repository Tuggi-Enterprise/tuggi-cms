import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { TrailVisualizationService, HeatMapParams } from '@/lib/services/trail-visualization.service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check CMS permissions
    const { data: cmsUser } = await supabase
      .schema('core')
      .from('cms_users')
      .select('role')
      .eq('email', session.user.email)
      .single()

    if (!cmsUser || !['admin', 'editor'].includes(cmsUser.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)

    // Parse bounds (required)
    const boundsParam = searchParams.get('bounds')
    if (!boundsParam) {
      return NextResponse.json(
        {
          success: false,
          error: 'bounds parameter is required'
        },
        { status: 400 }
      )
    }

    const [north, south, east, west] = boundsParam.split(',').map(Number)
    if (isNaN(north) || isNaN(south) || isNaN(east) || isNaN(west)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid bounds format. Expected: north,south,east,west'
        },
        { status: 400 }
      )
    }

    const bounds = { north, south, east, west }

    // Parse optional parameters
    const gridSize = searchParams.get('gridSize') ? parseFloat(searchParams.get('gridSize')!) : undefined
    const startDate = searchParams.get('startDate') || undefined
    const endDate = searchParams.get('endDate') || undefined
    const useMaterializedView = searchParams.get('useMaterializedView') !== 'false'

    const params: HeatMapParams = {
      bounds,
      gridSize,
      startDate,
      endDate,
      useMaterializedView
    }

    const result = await TrailVisualizationService.getHeatMapData(params)

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
    console.error('Error in heatmap API:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}

