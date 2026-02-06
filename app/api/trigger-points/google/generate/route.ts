// API route para geração de trigger points usando Google APIs

import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';
import { POIData, TriggerPointGenerationOptions } from '@/lib/services/trigger-points-google/types/interfaces';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby plan limit (max 60s)

export async function POST(request: NextRequest) {
  try {
    // Restrict to admin users
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ success: false, error: 'Unauthorized - Authentication required' }, { status: 401 })
    }
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()
    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Unauthorized - Admin only' }, { status: 403 })
    }
    const body = await request.json();
    const { poiData, options = {} } = body;
    
    // Validar dados de entrada
    if (!poiData) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'POI data is required' 
        },
        { status: 400 }
      );
    }
    
    // Validar estrutura básica do POI
    const validation = validatePOIData(poiData);
    if (!validation.valid) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid POI data', 
          details: validation.errors 
        },
        { status: 400 }
      );
    }
    
    // Validar opções
    const optionsValidation = validateOptions(options);
    if (!optionsValidation.valid) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid options', 
          details: optionsValidation.errors 
        },
        { status: 400 }
      );
    }
    
    console.log(`🚀 API: Generating trigger points for POI: ${poiData.name} (${poiData.id})`);
    
    // Gerar trigger points
    const predictor = new CoreTriggerPointPredictor();
    const predictionResult = await predictor.predictTriggerPointsComplete(poiData, options);
    
    // Gerar estatísticas
    const statistics = predictor.generateStatistics(predictionResult.triggerPoints);
    
    const result = {
      success: true,
      data: {
        poiId: poiData.id,
        poiName: poiData.name,
        triggerPoints: predictionResult.triggerPoints,
        count: predictionResult.triggerPoints.length,
        generatedAt: new Date().toISOString(),
        processingTime: predictionResult.processingTime,
        statistics,
        options: options
      },
      boundary: predictionResult.boundary,
      context: predictionResult.context,
      metadata: predictionResult.metadata
    };
    
    console.log(`✅ API: Generated ${predictionResult.triggerPoints.length} trigger points for ${poiData.name}`);
    
    // Auto-approval logic: If we have good trigger points, activate the POI
    const maxConfidence = predictionResult.triggerPoints.length > 0
      ? Math.max(...predictionResult.triggerPoints.map(tp => tp.confidence || 0))
      : 0
      
    if (predictionResult.triggerPoints.length >= 1 && maxConfidence > 0.4) {
      console.log(`🚀 API: Auto-approving POI ${poiData.id} (${poiData.name}) due to good trigger points (max confidence: ${maxConfidence})`);
      
      const { getSupabase } = await import('@/lib/core/supabase-client');
      const supabase = getSupabase('service');
      
      const { error: approveError } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: true,
          processing_status: 'completed'
        })
        .eq('id', poiData.id);
      
      if (approveError) {
        console.error(`❌ API: Failed to auto-approve POI ${poiData.id}:`, approveError.message);
      } else {
        (result as any).auto_approved = true;
      }
    }
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('API Error:', error);
    
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

/**
 * Valida dados do POI
 */
function validatePOIData(poiData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!poiData.id || typeof poiData.id !== 'string') {
    errors.push('POI ID is required and must be a string');
  }
  
  if (!poiData.name || typeof poiData.name !== 'string') {
    errors.push('POI name is required and must be a string');
  }
  
  if (!poiData.location || typeof poiData.location !== 'object') {
    errors.push('POI location is required and must be an object');
  } else {
    if (typeof poiData.location.lat !== 'number' || poiData.location.lat < -90 || poiData.location.lat > 90) {
      errors.push('POI latitude must be a number between -90 and 90');
    }
    
    if (typeof poiData.location.lng !== 'number' || poiData.location.lng < -180 || poiData.location.lng > 180) {
      errors.push('POI longitude must be a number between -180 and 180');
    }
  }
  
  if (!poiData.type || typeof poiData.type !== 'string') {
    errors.push('POI type is required and must be a string');
  }
  
  if (!poiData.country || typeof poiData.country !== 'string') {
    errors.push('POI country is required and must be a string');
  }
  
  if (!poiData.city || typeof poiData.city !== 'string') {
    errors.push('POI city is required and must be a string');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Valida opções de geração
 */
function validateOptions(options: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (options.maxSearchRadius !== undefined) {
    if (typeof options.maxSearchRadius !== 'number' || options.maxSearchRadius < 100 || options.maxSearchRadius > 5000) {
      errors.push('maxSearchRadius must be a number between 100 and 5000');
    }
  }
  
  if (options.minQuality !== undefined) {
    if (typeof options.minQuality !== 'number' || options.minQuality < 0 || options.minQuality > 1) {
      errors.push('minQuality must be a number between 0 and 1');
    }
  }
  
  if (options.maxTriggerPoints !== undefined) {
    if (typeof options.maxTriggerPoints !== 'number' || options.maxTriggerPoints < 1 || options.maxTriggerPoints > 50) {
      errors.push('maxTriggerPoints must be a number between 1 and 50');
    }
  }
  
  if (options.maxConcurrent !== undefined) {
    if (typeof options.maxConcurrent !== 'number' || options.maxConcurrent < 1 || options.maxConcurrent > 10) {
      errors.push('maxConcurrent must be a number between 1 and 10');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
