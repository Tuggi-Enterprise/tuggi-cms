// API route para análise de contexto geográfico

import { NextRequest, NextResponse } from 'next/server';
import { GeographicContextAnalyzer } from '@/lib/services/trigger-points-google/core/geographic-analyzer';
import { POIData } from '@/lib/services/trigger-points-google/types/interfaces';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { location, poiName, poiType } = body;
    
    // Validar dados de entrada
    if (!location) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Location is required' 
        },
        { status: 400 }
      );
    }
    
    if (!location.lat || !location.lng) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Location must have lat and lng properties' 
        },
        { status: 400 }
      );
    }
    
    if (typeof location.lat !== 'number' || location.lat < -90 || location.lat > 90) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Latitude must be a number between -90 and 90' 
        },
        { status: 400 }
      );
    }
    
    if (typeof location.lng !== 'number' || location.lng < -180 || location.lng > 180) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Longitude must be a number between -180 and 180' 
        },
        { status: 400 }
      );
    }
    
    console.log(`🌍 API: Analyzing geographic context for location: ${location.lat}, ${location.lng}`);
    
    // Criar POI data básico para análise
    const poiData: POIData = {
      id: 'context_analysis',
      name: poiName || 'Context Analysis',
      location,
      type: poiType || 'unknown',
      country: 'Unknown',
      city: 'Unknown'
    };
    
    // Analisar contexto geográfico
    const analyzer = new GeographicContextAnalyzer();
    const context = await analyzer.analyzeGeographicContext(poiData);
    
    const result = {
      success: true,
      data: {
        location,
        context,
        analyzedAt: new Date().toISOString()
      }
    };
    
    console.log(`✅ API: Geographic context analyzed for ${location.lat}, ${location.lng}`);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Context Analysis API Error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
