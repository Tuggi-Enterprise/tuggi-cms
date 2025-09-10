import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "../_shared/cors.ts";

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  attractionName: string;
  specializedSource: string;
  imageUrl: string;
  metadata?: {
    title?: string;
    description?: string;
    license?: string;
    author?: string;
    format?: string;
    dimensions?: {
      width: number;
      height: number;
    };
  };
}

interface StoredImage {
  id: string;
  url: string;
  storage_path: string;
}

// Generate filename for specialized sources
const generateSpecializedFilename = (attractionId: string, source: string): string => {
  const timestamp = Date.now();
  const cleanSource = source.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `${attractionId}_${cleanSource}_${timestamp}.jpg`;
};

// Download image from specialized source URL
const downloadSpecializedImage = async (imageUrl: string): Promise<ArrayBuffer> => {
  console.log(`Downloading image from specialized source: ${imageUrl}`);
  
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.app; contact@tuggi.app)'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  
  return await response.arrayBuffer();
};

// Store image in Supabase bucket with specialized source path
const storeSpecializedImageInBucket = async (
  imageData: ArrayBuffer, 
  attractionId: string, 
  fileName: string,
  source: string
): Promise<string> => {
  const cleanSource = source.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const storagePath = `attractions/${attractionId}/specialized_${cleanSource}/${fileName}`;
  
  console.log(`Storing specialized image at path: ${storagePath}`);
  
  const { error } = await supabaseAdmin.storage
    .from('travel-app-images')
    .upload(storagePath, imageData, {
      contentType: 'image/jpeg',
      upsert: true
    });
  
  if (error) {
    throw new Error(`Failed to upload image: ${error.message}`);
  }
  
  return storagePath;
};

// Delete old image if it exists
const deleteOldImage = async (attractionId: string): Promise<void> => {
  try {
    // Get existing image records
    const { data: existingImages, error: fetchError } = await supabaseAdmin
      .schema('core')
      .from('attraction_image')
      .select('storage_path')
      .eq('attraction_id', attractionId);

    if (fetchError) {
      console.warn('Error fetching existing images:', fetchError.message);
      return;
    }

    if (existingImages && existingImages.length > 0) {
      // Delete files from storage
      const pathsToDelete = existingImages.map(img => img.storage_path).filter(Boolean);
      
      if (pathsToDelete.length > 0) {
        const { error: storageError } = await supabaseAdmin.storage
          .from('travel-app-images')
          .remove(pathsToDelete);

        if (storageError) {
          console.warn('Error deleting old images from storage:', storageError.message);
        } else {
          console.log(`Deleted ${pathsToDelete.length} old images from storage`);
        }
      }

      // Delete database references
      const { error: dbError } = await supabaseAdmin
        .schema('core')
        .from('attraction_image')
        .delete()
        .eq('attraction_id', attractionId);

      if (dbError) {
        console.warn('Error deleting old image references:', dbError.message);
      } else {
        console.log('Deleted old image references from database');
      }
    }
  } catch (error) {
    console.warn('Error in deleteOldImage:', error.message);
  }
};

// Save image reference in database
const saveSpecializedImageReference = async (
  attractionId: string,
  publicUrl: string,
  storagePath: string,
  source: string,
  metadata?: any
): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attraction_image')
    .insert({
      attraction_id: attractionId,
      image_url: publicUrl,
      storage_path: storagePath,
      alt_text: metadata?.title || metadata?.description || `Image from ${source}`
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save image reference: ${error.message}`);
  }

  return data.id;
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[${requestId}] extract-specialized-images function called`);

  try {
    if (req.method !== 'POST') {
      throw new Error('Method not allowed');
    }

    const body: RequestBody = await req.json();
    console.log(`[${requestId}] Request body:`, JSON.stringify(body, null, 2));

    const { attractionId, attractionName, specializedSource, imageUrl, metadata } = body;

    // Validate required fields
    if (!attractionId || !attractionName || !specializedSource || !imageUrl) {
      throw new Error('Missing required fields: attractionId, attractionName, specializedSource, imageUrl');
    }

    console.log(`[${requestId}] Processing specialized image for: ${attractionName} from ${specializedSource}`);

    // Delete old images first
    await deleteOldImage(attractionId);

    const storedImages: StoredImage[] = [];
    
    try {
      // Download image from specialized source
      const imageData = await downloadSpecializedImage(imageUrl);
      
      // Generate filename
      const fileName = generateSpecializedFilename(attractionId, specializedSource);
      
      // Store in bucket
      const storagePath = await storeSpecializedImageInBucket(imageData, attractionId, fileName, specializedSource);
      
      // Generate public URL
      const { data: publicUrlData } = supabaseAdmin.storage
        .from('travel-app-images')
        .getPublicUrl(storagePath);
      
      // Save reference in database
      const imageId = await saveSpecializedImageReference(
        attractionId,
        publicUrlData.publicUrl,
        storagePath,
        specializedSource,
        metadata
      );

      storedImages.push({
        id: imageId,
        url: publicUrlData.publicUrl,
        storage_path: storagePath
      });

      console.log(`[${requestId}] Successfully processed specialized image: ${storagePath}`);

    } catch (error) {
      const errorMsg = `Failed to process specialized image: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[${requestId}] ${errorMsg}`, error);
      throw new Error(errorMsg);
    }

    // Update attraction table with primary image URL and source
    if (storedImages.length > 0 && storedImages[0]) {
      try {
        await supabaseAdmin
          .schema('core')
          .from('attractions')
          .update({ 
            image_url: storedImages[0].url,
            image_source: `specialized_${specializedSource}`
          })
          .eq('id', attractionId);
        
        console.log(`[${requestId}] Updated attraction ${attractionId} with specialized image URL and source`);
      } catch (error) {
        console.warn(`[${requestId}] Failed to update attraction: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        source: specializedSource,
        imageUrl: storedImages[0]?.url,
        metadata: metadata,
        message: `Successfully extracted image from ${specializedSource}`
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
    console.error(`[${requestId}] Error in extract-specialized-images function:`, error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
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
