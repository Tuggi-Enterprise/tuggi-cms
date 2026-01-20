import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';import { validateAuthHeader } from '../_shared/auth-middleware.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { createSecureMediaHeaders } from '../_shared/security-headers.ts';
import {
  validateRequestBody,
  createValidationErrorResponse,
  ExtractOsmImagesSchema,
} from '../_shared/validation-schemas.ts';
import { createAuditLogger } from '../_shared/audit-logger.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OSMImageRequest {
  attractionId: string;
  attractionName: string;
  imageUrl: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: createSecureHeaders(corsHeaders) });
  }

  // ✅ VALIDAR AUTENTICAÇÃO
  const authResult = await validateAuthHeader(req)
  if (!authResult.valid) {
    console.warn(`[Extract-OSM-Images] ❌ Unauthorized: ${authResult.error}`)
    return new Response(
      JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
      { status: 401, headers: createSecureHeaders(corsHeaders) }
    )
  }
  console.log(`[Extract-OSM-Images] ✅ Authorized: ${authResult.email}`)

  // ✅ RATE LIMITING CHECK
  const config = RATE_LIMIT_CONFIG['extract-osm']
  const rateLimit = checkRateLimit(req, 'extract-osm', config.maxRequests, config.windowSeconds)
  if (!rateLimit.allowed) {
    console.warn(`[Extract-OSM-Images] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
    return createRateLimitResponse(rateLimit, corsHeaders)
  }
  console.log(`[Extract-OSM-Images] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

  try {
    const { attractionId, attractionName, imageUrl }: OSMImageRequest = await req.json();

    if (!attractionId || !attractionName || !imageUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: attractionId, attractionName, imageUrl' }),
        { status: 400, headers: { headers: createSecureHeaders(corsHeaders) } }
      );
    }

    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${requestId}] Starting OSM image extraction for: ${attractionName}`);
    console.log(`[${requestId}] Image URL: ${imageUrl}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Download image from OSM URL
    const imageData = await downloadOSMImage(imageUrl);
    
    // Generate filename and storage path
    const fileName = generateOSMFilename(attractionName, imageUrl, 1);
    const folderId = `osm-${attractionId.substring(0, 8)}`;
    
    // Store in bucket
    const storagePath = await storeImageInBucket(imageData, folderId, fileName);
    
    // Generate public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('travel-app-images')
      .getPublicUrl(storagePath);
    
    // Save reference in database
    const imageId = await saveImageReference(
      attractionId,
      publicUrlData.publicUrl,
      storagePath,
      'OSM Image',
      `${attractionName} - OSM image`
    );

    // Update attraction table with primary image URL and source
    const { error: updateError } = await supabaseAdmin
      .schema('core')
      .from('attractions')
      .update({ 
        image_url: publicUrlData.publicUrl,
        image_source: 'osm'
      })
      .eq('id', attractionId);

    if (updateError) {
      throw new Error(`Failed to update attraction: ${updateError.message}`);
    }

    console.log(`[${requestId}] Successfully processed OSM image for ${attractionName}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'OSM image extracted and stored successfully',
        imageId,
        imageUrl: publicUrlData.publicUrl,
        originalUrl: imageUrl
      }),
      { headers: { headers: createSecureHeaders(corsHeaders) } }
    );

  } catch (error) {
    console.error('Error in extract-osm-images:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to extract OSM image', 
        details: error.message 
      }),
      { status: 500, headers: { headers: createSecureHeaders(corsHeaders) } }
    );
  }
});

async function downloadOSMImage(imageUrl: string): Promise<Uint8Array> {
  try {
    console.log(`Downloading OSM image from: ${imageUrl}`);
    
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TuggiBot/1.0; +https://tuggi.com/bot)'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const imageData = new Uint8Array(await response.arrayBuffer());
    console.log(`Downloaded OSM image, size: ${imageData.length} bytes`);
    
    return imageData;

  } catch (error) {
    console.error('Error downloading OSM image:', error);
    throw error;
  }
}

function generateOSMFilename(attractionName: string, imageUrl: string, index: number): string {
  // Clean and normalize the attraction name
  const cleanName = attractionName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  
  // Extract filename from URL or create one
  const urlParts = imageUrl.split('/');
  const originalFilename = urlParts[urlParts.length - 1] || 'osm-image';
  const cleanFilename = originalFilename
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '')
    .substring(0, 30);
  
  const timestamp = Date.now();
  const extension = getFileExtension(originalFilename) || 'jpg';
  
  return `${cleanName}-${cleanFilename}-${timestamp}-${index}.${extension}`;
}

function getFileExtension(filename: string): string | null {
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

async function storeImageInBucket(
  imageData: Uint8Array, 
  folderId: string, 
  fileName: string
): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const storagePath = `${folderId}/${fileName}`;
  
  const { error } = await supabaseAdmin.storage
    .from('travel-app-images')
    .upload(storagePath, imageData, {
      contentType: 'image/jpeg',
      upsert: true
    });

  if (error) {
    throw new Error(`Failed to upload image: ${error.message}`);
  }

  console.log(`OSM image stored at: ${storagePath}`);
  return storagePath;
}

async function saveImageReference(
  attractionId: string,
  imageUrl: string,
  storagePath: string,
  title: string,
  altText: string
): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attraction_image')
    .insert({
      attraction_id: attractionId,
      image_url: imageUrl,
      storage_path: storagePath,
      alt_text: altText
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save image reference: ${error.message}`);
  }

  return data.id;
}
