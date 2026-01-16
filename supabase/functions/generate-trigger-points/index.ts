
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { CoreTriggerPointPredictor } from './lib/core/trigger-point-predictor.ts';
import { POIData } from './lib/types/interfaces.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  poiData: POIData;
  options?: any;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user role
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', details: userError }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', user.email)
      .eq('is_active', true)
      .single();

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse Request Body
    const body = await req.json() as RequestBody;
    const { poiData, options = {} } = body;

    // 3. Validation
    if (!poiData) {
      return new Response(JSON.stringify({ success: false, error: 'POI data is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validation = validatePOIData(poiData);
    if (!validation.valid) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid POI data', 
        details: validation.errors 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🚀 Edge API: Generating trigger points for POI: ${poiData.name} (${poiData.id})`);

    // 4. Execute Logic
    const predictor = new CoreTriggerPointPredictor();
    const predictionResult = await predictor.predictTriggerPointsComplete(poiData, options);

    // 5. Return Response
    // Note: Statistics generation removed as it's not core to the prediction logic and complicates the return type
    // If needed, it can be added to CoreTriggerPointPredictor
    
    const result = {
      success: true,
      data: {
        poiId: poiData.id,
        poiName: poiData.name,
        triggerPoints: predictionResult.triggerPoints,
        count: predictionResult.triggerPoints.length,
        generatedAt: new Date().toISOString(),
        processingTime: predictionResult.metadata.processingTime,
        options: options
      },
      boundary: predictionResult.boundary,
      context: predictionResult.context,
      metadata: predictionResult.metadata
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Helper: Validate POI Data
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
  
  // Basic type check, strict validation might be too restrictive if type names change
  if (!poiData.type || typeof poiData.type !== 'string') {
    errors.push('POI type is required and must be a string');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
