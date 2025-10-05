import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/core/supabase-client';

const supabase = getSupabase('service');

export async function POST(request: NextRequest) {
  try {
    const { attractionId, attractionName, wikimediaUrl, osmTags } = await request.json();

    if (!attractionId || !attractionName) {
      return NextResponse.json(
        { error: 'attractionId and attractionName are required' },
        { status: 400 }
      );
    }

    // Prepare request body for the edge function (without osmTags to avoid validation issues)
    const requestBody = {
      attractionId,
      attractionName,
      imageSource: 'wikimedia_commons' as const,
      wikimediaUrl: wikimediaUrl || null
    };

    console.log('🚀 Calling store-poi-images edge function with:', requestBody);

    // Call the edge function
    const { data, error } = await supabase.functions.invoke('store-poi-images', {
      body: requestBody
    });

    if (error) {
      console.error('❌ Error calling edge function:', error);
      return NextResponse.json(
        { error: 'Failed to call edge function', details: error },
        { status: 500 }
      );
    }

    console.log('✅ Edge function response:', data);

    return NextResponse.json({
      success: true,
      data,
      message: 'Wikimedia image extraction completed'
    });

  } catch (error) {
    console.error('💥 Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Wikimedia Commons Image Extraction Test Endpoint',
    usage: 'POST with { attractionId, attractionName, wikimediaUrl?, osmTags? }',
    example: {
      attractionId: 'e179587f-97b7-44db-ad39-a5b43658444c',
      attractionName: 'Monumento à Mãe Preta',
      wikimediaUrl: 'https://commons.wikimedia.org/wiki/Category:Mãe Preta by Júlio Guerra (bronze, 1955)',
      osmTags: {
        name: 'Monumento à Mãe Preta',
        historic: 'memorial',
        wikidata: 'Q45052140',
        wikimedia_commons: 'Category:Mãe Preta by Júlio Guerra (bronze, 1955)'
      }
    }
  });
}
