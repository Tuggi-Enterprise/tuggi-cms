import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "../_shared/cors.ts";

const GOOGLE_API_KEY = Deno.env.get('VITE_GOOGLE_MAPS_API_KEY') || '';
const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const ANON_KEY = Deno.env.get('ANON_KEY') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  googlePlaceId: string;
  photoReferences: string[];
  attractionName: string;
}

interface StoredImage {
  id: string;
  url: string;
  storage_path: string;
}

// Helper to clean and validate a photo reference
const cleanPhotoReference = (ref: string): string => {
  if (ref.startsWith('http')) {
    try {
      const url = new URL(ref);
      const params = new URLSearchParams(url.search);
      const extractedRef = params.get('photoreference');
      if (extractedRef) {
        return extractedRef;
      }
    } catch (e) {
      console.error('Failed to parse URL:', e);
    }
  }
  return ref;
};

// Generate filename using your existing pattern: placeId_timestamp.jpg
const generateFilename = (googlePlaceId: string, index: number): string => {
  const timestamp = Date.now();
  return `${googlePlaceId}_${timestamp}_${index}.jpg`;
};

// Download image from Google Places API
const downloadGooglePhoto = async (photoReference: string, maxWidth: string = '1600'): Promise<ArrayBuffer> => {
  const cleanRef = cleanPhotoReference(photoReference);
  const googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photoreference=${cleanRef}&key=${GOOGLE_API_KEY}`;
  
  const response = await fetch(googleUrl, {
    method: 'GET',
    headers: {
      'Accept': 'image/jpeg, image/png, image/webp, image/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image from Google API: ${response.statusText}`);
  }

  return await response.arrayBuffer();
};

// Create thumbnail from image data
const createThumbnail = async (imageData: ArrayBuffer): Promise<ArrayBuffer> => {
  // For now, we'll use the same image as thumbnail
  // In a production environment, you might want to use an image processing library
  // to actually resize the image to create a proper thumbnail
  return imageData;
};

// Store image in Supabase Storage using your existing organization
const storeImageInBucket = async (
  imageData: ArrayBuffer,
  googlePlaceId: string,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<string> => {
  // Use your existing folder structure: googlePlaceId/filename
  const storagePath = `${googlePlaceId}/${fileName}`;
  
  // Store image in travel-app-images bucket
  const { error: uploadError } = await supabaseAdmin.storage
    .from('travel-app-images')
    .upload(storagePath, imageData, {
      contentType,
      duplex: 'half'
    });

  if (uploadError) {
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  return storagePath;
};

// Save image reference in attraction_image table using your existing schema
const saveImageReference = async (
  attractionId: string,
  storagePath: string,
  googlePhotoReference: string
): Promise<string> => {
  // Insert into attraction_image table with your existing schema
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attraction_image')
    .insert({
      attraction_id: attractionId,
      storage_path: storagePath,
      photo_reference: googlePhotoReference
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save image reference: ${error.message}`);
  }

  return data.id;
};

serve(async (req) => {
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] Store POI images function request received:`, req.method);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 200,
      headers: corsHeaders 
    });
  }

  try {
    // Check authorization
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { 
          status: 401, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // Parse request body
    const body = await req.json() as RequestBody;
    const { attractionId, googlePlaceId, photoReferences, attractionName } = body;

    // Validate input
    if (!attractionId || !photoReferences || photoReferences.length === 0) {
      return new Response(
        JSON.stringify({ error: 'attractionId and photoReferences are required' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    if (!GOOGLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Google API key not configured' }),
        { 
          status: 500, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    console.log(`[${requestId}] Processing ${photoReferences.length} photos for attraction ${attractionId}`);
    
    // Debug environment variables (without exposing secrets)
    console.log(`[${requestId}] Environment check:`, {
      hasGoogleKey: !!GOOGLE_API_KEY,
      hasProjectUrl: !!PROJECT_URL,
      hasServiceKey: !!SERVICE_ROLE_KEY,
      googleKeyLength: GOOGLE_API_KEY?.length || 0,
      projectUrl: PROJECT_URL
    });

    const storedImages: StoredImage[] = [];
    const errors: string[] = [];

    // Process only the first photo reference (primary image only)
    for (let i = 0; i < photoReferences.length && i < 1; i++) { // Limit to 1 image
      try {
        const photoRef = photoReferences[i];
        console.log(`[${requestId}] Processing photo ${i + 1}/${photoReferences.length}`);

        // Download image from Google in high resolution
        const imageData = await downloadGooglePhoto(photoRef, '1600');
        
        // Generate filename using your pattern: placeId_timestamp_index.jpg
        const fileName = generateFilename(googlePlaceId, i + 1);
        
        // Store in bucket using your folder structure
        const storagePath = await storeImageInBucket(imageData, googlePlaceId, fileName);
        
        // Save reference in database
        const imageId = await saveImageReference(
          attractionId,
          storagePath,
          photoRef
        );

        // Generate public URL using your existing format
        const { data: publicUrlData } = supabaseAdmin.storage
          .from('travel-app-images')
          .getPublicUrl(storagePath);

        storedImages.push({
          id: imageId,
          url: publicUrlData.publicUrl,
          storage_path: storagePath
        });

        console.log(`[${requestId}] Successfully processed photo ${i + 1}: ${storagePath}`);

      } catch (error) {
        const errorMsg = `Failed to process photo ${i + 1}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[${requestId}] ${errorMsg}`, error);
        errors.push(errorMsg);
      }
    }

    // Update attraction table with primary image URL if we have images
    if (storedImages.length > 0 && storedImages[0]) {
      try {
        await supabaseAdmin
          .schema('core')
          .from('attractions')
          .update({ image_url: storedImages[0].url })
          .eq('id', attractionId);
        
        console.log(`[${requestId}] Updated attraction ${attractionId} with primary image URL`);
      } catch (error) {
        console.warn(`[${requestId}] Failed to update attraction image_url: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: storedImages.length,
        total: photoReferences.length,
        images: storedImages,
        errors: errors.length > 0 ? errors : undefined
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error) {
    console.error(`[${requestId}] Error in store-poi-images function:`, error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});