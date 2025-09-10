import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('🔍 Debug - Request body received:');
    console.log(JSON.stringify(body, null, 2));
    
    // Validate the structure
    const { attractionId, attractionName, imageSource, wikimediaUrl, osmTags } = body;
    
    const validation = {
      attractionId: { value: attractionId, type: typeof attractionId, valid: !!attractionId },
      attractionName: { value: attractionName, type: typeof attractionName, valid: !!attractionName },
      imageSource: { value: imageSource, type: typeof imageSource, valid: imageSource === 'wikimedia_commons' },
      wikimediaUrl: { value: wikimediaUrl, type: typeof wikimediaUrl, valid: !!wikimediaUrl },
      osmTags: { value: osmTags, type: typeof osmTags, valid: !!osmTags }
    };
    
    console.log('🔍 Debug - Validation:');
    console.log(JSON.stringify(validation, null, 2));
    
    // Check if all required fields are present
    const missingFields = [];
    if (!attractionId) missingFields.push('attractionId');
    if (!attractionName) missingFields.push('attractionName');
    if (!imageSource) missingFields.push('imageSource');
    if (imageSource === 'wikimedia_commons' && !wikimediaUrl && !osmTags?.wikimedia_commons) {
      missingFields.push('wikimediaUrl or osmTags.wikimedia_commons');
    }
    
    if (missingFields.length > 0) {
      return NextResponse.json({
        error: 'Missing required fields',
        missingFields,
        validation
      }, { status: 400 });
    }
    
    return NextResponse.json({
      success: true,
      message: 'Request structure is valid',
      validation
    });
    
  } catch (error) {
    console.error('💥 Debug error:', error);
    return NextResponse.json({
      error: 'Failed to parse request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Debug endpoint for Wikimedia Commons requests',
    usage: 'POST with the same body structure as the main test'
  });
}
