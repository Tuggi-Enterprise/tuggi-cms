import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const { id, name, lat, lng } = body
    
    if (!id || !name || lat === undefined || lng === undefined) {
      return NextResponse.json({
        success: false,
        error: 'Missing required parameters: id, name, lat, lng'
      }, { status: 400 })
    }
    
    console.log(`🧪 Testing trigger points generation via Edge Function for: ${name} (${id})`)
    console.log(`📍 Coordinates: (${lat}, ${lng})`)
    console.log(`🚫 TEST MODE: Trigger points will NOT be saved to database`)
    
    // Call the Edge Function
    console.log('🚀 Calling generate-trigger-points Edge Function...')
    const edgeResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-trigger-points`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        poi_id: id,
        lat,
        lng,
        name,
        test_mode: true
      })
    })
    
    if (!edgeResponse.ok) {
      const errorText = await edgeResponse.text()
      console.error('❌ Edge Function error:', errorText)
      return NextResponse.json({
        success: false,
        error: `Edge Function error: ${edgeResponse.status} - ${errorText}`
      }, { status: 500 })
    }
    
    const edgeResult = await edgeResponse.json()
    const processingTime = Date.now() - startTime
    
    console.log('✅ Edge Function test completed successfully!')
    console.log(`📊 Generated ${edgeResult.trigger_points?.length || 0} trigger points`)
    console.log(`🎯 Boundary source: ${edgeResult.boundary?.source || 'unknown'}`)
    console.log(`⏱️ Total processing time: ${processingTime}ms`)
    
    // Adapt the response format to match the expected structure
    const adaptedResult = {
      success: true,
      data: {
        trigger_points: edgeResult.trigger_points || [],
        boundary: edgeResult.boundary || null,
        confidence: edgeResult.confidence || 0,
        processing_metadata: edgeResult.processing_metadata || {}
      },
      processing_time: processingTime,
      edge_function_result: edgeResult // Include original result for debugging
    }
    
    return NextResponse.json(adaptedResult)
    
  } catch (error) {
    const processingTime = Date.now() - startTime
    console.error('❌ Test error:', error)
    
    return NextResponse.json({
      success: false,
      error: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processing_time: processingTime
    }, { status: 500 })
  }
}
