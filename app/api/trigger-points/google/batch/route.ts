// API route para processamento em lote de trigger points usando Google APIs

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { CoreTriggerPointPredictor } from '@/lib/services/trigger-points-google/core/trigger-point-predictor';
import { POIData, TriggerPointGenerationOptions, BatchGenerationRequest, BatchGenerationResult } from '@/lib/services/trigger-points-google/types/interfaces';
;
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Validate authentication and authorization
  try {
    const cookieStore = await cookies();
    const supabaseAuth = getSupabaseRouteHandler(cookieStore);
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession();

    if (authError || !session) {
      return NextResponse.json({ success: false, error: 'Unauthorized - Authentication required' }, { status: 401 });
    }

    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single();

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Unauthorized - Admin only' }, { status: 403 });
    }
  } catch (authError) {
    console.error('Auth Check Error:', authError);
    return NextResponse.json({ success: false, error: 'Authorization check failed' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { pois, options = {} } = body as BatchGenerationRequest;

    // Validar dados de entrada
    if (!pois || !Array.isArray(pois) || pois.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'POIs array is required and must not be empty'
        },
        { status: 400 }
      );
    }

    if (pois.length > 20) {
      return NextResponse.json(
        {
          success: false,
          error: 'Maximum 20 POIs allowed per batch request'
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

    console.log(`🚀 API: Processing batch of ${pois.length} POIs`);

    const startTime = Date.now();
    const predictor = new CoreTriggerPointPredictor();
    const maxConcurrent = options.maxConcurrent || 3;

    // Processar POIs em lotes para evitar sobrecarga
    const results = await processBatchConcurrently(pois, predictor, options, maxConcurrent);

    const totalProcessingTime = Date.now() - startTime;

    // Calcular estatísticas
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    const batchResult: BatchGenerationResult = {
      totalProcessed: pois.length,
      successful,
      failed,
      results,
      totalProcessingTime
    };

    console.log(`✅ API: Batch processing completed - ${successful} successful, ${failed} failed in ${totalProcessingTime}ms`);

    return NextResponse.json({
      success: true,
      data: batchResult
    });

  } catch (error) {
    console.error('Batch API Error:', error);

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
 * Processa POIs em lotes concorrentes
 */
async function processBatchConcurrently(
  pois: POIData[],
  predictor: CoreTriggerPointPredictor,
  options: TriggerPointGenerationOptions,
  maxConcurrent: number
): Promise<Array<{
  poiId: string;
  success: boolean;
  triggerPoints?: any[];
  error?: string;
  processingTime: number;
}>> {
  const results: Array<{
    poiId: string;
    success: boolean;
    triggerPoints?: any[];
    error?: string;
    processingTime: number;
  }> = [];

  // Processar em lotes de maxConcurrent
  for (let i = 0; i < pois.length; i += maxConcurrent) {
    const batch = pois.slice(i, i + maxConcurrent);

    const batchPromises = batch.map(async (poi) => {
      const startTime = Date.now();

      try {
        console.log(`🔄 Processing POI: ${poi.name} (${poi.id})`);

        const triggerPoints = await predictor.predictTriggerPoints(poi, options);
        const processingTime = Date.now() - startTime;

        console.log(`✅ Completed POI: ${poi.name} - ${triggerPoints.length} trigger points in ${processingTime}ms`);

        return {
          poiId: poi.id,
          success: true,
          triggerPoints,
          processingTime
        };

      } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`❌ Failed POI: ${poi.name} - ${error instanceof Error ? error.message : 'Unknown error'}`);

        return {
          poiId: poi.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          processingTime
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Pequena pausa entre lotes para evitar rate limiting
    if (i + maxConcurrent < pois.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
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
