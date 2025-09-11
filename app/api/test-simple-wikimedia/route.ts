import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('🧪 Simple test - Request body:', JSON.stringify(body, null, 2));
    
    // Test with minimal data first
    const minimalRequest = {
      attractionId: body.attractionId,
      attractionName: body.attractionName,
      imageSource: 'wikimedia_commons',
      wikimediaUrl: body.wikimediaUrl
    };
    
    console.log('🧪 Simple test - Minimal request:', JSON.stringify(minimalRequest, null, 2));
    
    // Call the edge function with minimal data
    const { data, error } = await supabase.functions.invoke('store-poi-images', {
      body: minimalRequest
    });

    if (error) {
      console.error('❌ Simple test error:', error);
      return NextResponse.json({
        error: 'Edge function error',
        details: error,
        request: minimalRequest
      }, { status: 500 });
    }

    console.log('✅ Simple test success:', data);

    return NextResponse.json({
      success: true,
      data,
      request: minimalRequest,
      message: 'Simple test completed'
    });

  } catch (error) {
    console.error('💥 Simple test error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Simple Wikimedia test endpoint',
    usage: 'POST with minimal data to test edge function'
  });
}
