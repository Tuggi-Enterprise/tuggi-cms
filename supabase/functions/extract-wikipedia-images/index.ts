import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "../_shared/cors.ts";
import { validateAuthHeader } from '../_shared/auth-middleware.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { createSecureMediaHeaders } from '../_shared/security-headers.ts';
import {
  validateRequestBody,
  createValidationErrorResponse,
  ExtractWikipediaImagesSchema,
} from '../_shared/validation-schemas.ts';
import { createAuditLogger } from '../_shared/audit-logger.ts';

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  attractionName: string;
  wikipediaUrl: string;
}

interface WikipediaImageInfo {
  title: string;
  url: string;
  description: string;
  author: string;
  license: string;
  size: number;
  width: number;
  height: number;
  mime: string;
}

// Extract images from Wikipedia page
async function extractWikipediaImages(wikipediaUrl: string): Promise<WikipediaImageInfo[]> {
  try {
    // Parse Wikipedia URL to get page title
    const url = new URL(wikipediaUrl);
    const pathParts = url.pathname.split('/');
    const pageTitle = pathParts[pathParts.length - 1];
    
    if (!pageTitle) {
      throw new Error('Could not extract page title from Wikipedia URL');
    }

    // Use Wikipedia API to get page images
    const apiUrl = `https://${url.hostname}/w/api.php?` + new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'images',
      titles: decodeURIComponent(pageTitle),
      imlimit: '10'
    });

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }

    const data = await response.json();
    const pages = data.query?.pages;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (!page || !page.images) {
      return [];
    }

    // Get detailed info for each image
    const imageInfos: WikipediaImageInfo[] = [];
    
    for (const image of page.images.slice(0, 3)) { // Limit to 3 images
      try {
        const imageInfo = await getWikipediaImageInfo(image.title, url.hostname);
        if (imageInfo) {
          imageInfos.push(imageInfo);
        }
      } catch (error) {
        console.warn(`Failed to get info for image ${image.title}: ${error.message}`);
      }
    }

    return imageInfos;

  } catch (error) {
    throw new Error(`Failed to extract Wikipedia images: ${error.message}`);
  }
}

// Get detailed image information from Wikipedia
async function getWikipediaImageInfo(imageTitle: string, hostname: string): Promise<WikipediaImageInfo | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      titles: imageTitle,
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1600'
    });

    const response = await fetch(`https://${hostname}/w/api.php?${params}`);
    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }

    const data = await response.json();
    const pages = data.query?.pages;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (!page || !page.imageinfo || page.imageinfo.length === 0) {
      return null;
    }

    const imageInfo = page.imageinfo[0];
    const metadata = imageInfo.extmetadata || {};

    return {
      title: page.title,
      url: imageInfo.url,
      description: metadata.ImageDescription?.value || '',
      author: metadata.Artist?.value || metadata.Creator?.value || 'Unknown',
      license: metadata.LicenseShortName?.value || metadata.License?.value || 'Unknown',
      size: imageInfo.size || 0,
      width: imageInfo.width || 0,
      height: imageInfo.height || 0,
      mime: imageInfo.mime || 'image/jpeg'
    };

  } catch (error) {
    console.error(`Error getting Wikipedia image info: ${error.message}`);
    return null;
  }
}

// Download image from Wikipedia
async function downloadWikipediaImage(imageInfo: WikipediaImageInfo): Promise<ArrayBuffer> {
  const response = await fetch(imageInfo.url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  return await response.arrayBuffer();
}

// Generate filename for Wikipedia images
const generateWikipediaFilename = (attractionName: string, imageTitle: string, index: number = 1): string => {
  const cleanAttractionName = attractionName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30);

  const cleanImageTitle = imageTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 20);

  const timestamp = Date.now();
  const extension = getFileExtension(imageTitle);
  
  return `${cleanAttractionName}-${cleanImageTitle}-${timestamp}-${index}${extension}`;
};

// Get file extension from image title
const getFileExtension = (imageTitle: string): string => {
  const match = imageTitle.match(/\.([^.]+)$/);
  if (match) {
    return `.${match[1].toLowerCase()}`;
  }
  return '.jpg';
};

// Store image in Supabase Storage
const storeImageInBucket = async (
  imageData: ArrayBuffer,
  folderId: string,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<string> => {
  const storagePath = `${folderId}/${fileName}`;
  
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

// Delete old image from storage and database
const deleteOldImage = async (attractionId: string): Promise<void> => {
  try {
    // Get current image info from attraction_image table
    const { data: currentImages, error: fetchError } = await supabaseAdmin
      .schema('core')
      .from('attraction_image')
      .select('id, storage_path')
      .eq('attraction_id', attractionId);

    if (fetchError) {
      console.warn(`Warning: Could not fetch current images for ${attractionId}: ${fetchError.message}`);
      return;
    }

    if (!currentImages || currentImages.length === 0) {
      console.log(`No existing images found for attraction ${attractionId}`);
      return;
    }

    // Delete images from storage
    for (const image of currentImages) {
      if (image.storage_path) {
        try {
          const { error: deleteError } = await supabaseAdmin.storage
            .from('travel-app-images')
            .remove([image.storage_path]);

          if (deleteError) {
            console.warn(`Warning: Could not delete old image ${image.storage_path}: ${deleteError.message}`);
          } else {
            console.log(`✅ Deleted old image: ${image.storage_path}`);
          }
        } catch (error) {
          console.warn(`Warning: Error deleting image ${image.storage_path}: ${error.message}`);
        }
      }
    }

    // Delete image references from database
    const { error: deleteDbError } = await supabaseAdmin
      .schema('core')
      .from('attraction_image')
      .delete()
      .eq('attraction_id', attractionId);

    if (deleteDbError) {
      console.warn(`Warning: Could not delete image references from database: ${deleteDbError.message}`);
    } else {
      console.log(`✅ Deleted ${currentImages.length} image references from database`);
    }

  } catch (error) {
    console.warn(`Warning: Error in deleteOldImage: ${error.message}`);
  }
};

// Save image reference in attraction_image table
const saveImageReference = async (
  attractionId: string,
  publicUrl: string,
  storagePath: string,
  reference: string,
  altText?: string
): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attraction_image')
    .insert({
      attraction_id: attractionId,
      image_url: publicUrl,
      storage_path: storagePath,
      photo_reference: reference,
      alt_text: altText || `Image from Wikipedia for attraction ${attractionId}`
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
  console.log(`[${requestId}] Extract Wikipedia images function request received:`, req.method);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 200,
      headers: createSecureHeaders(corsHeaders) 
    });
  }

  // ✅ VALIDAR AUTENTICAÇÃO
  const authResult = await validateAuthHeader(req)
  if (!authResult.valid) {
    console.warn(`[Extract-Wikipedia-Images] ❌ Unauthorized: ${authResult.error}`)
    return new Response(
      JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
      { status: 401, headers: createSecureHeaders(corsHeaders) }
    )
  }
  console.log(`[Extract-Wikipedia-Images] ✅ Authorized: ${authResult.email}`)

  // ✅ RATE LIMITING CHECK
  const config = RATE_LIMIT_CONFIG['extract-wikipedia']
  const rateLimit = checkRateLimit(req, 'extract-wikipedia', config.maxRequests, config.windowSeconds)
  if (!rateLimit.allowed) {
    console.warn(`[Extract-Wikipedia-Images] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
    return createRateLimitResponse(rateLimit, corsHeaders)
  }
  console.log(`[Extract-Wikipedia-Images] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

  try {
    // Check authorization (already validated)
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
    const { attractionId, attractionName, wikipediaUrl } = body;

    console.log(`[${requestId}] Processing Wikipedia images for: ${attractionName}`);
    console.log(`[${requestId}] Wikipedia URL: ${wikipediaUrl}`);

    // Validate input
    if (!attractionId || !attractionName || !wikipediaUrl) {
      return new Response(
        JSON.stringify({ error: 'attractionId, attractionName, and wikipediaUrl are required' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // Extract images from Wikipedia
    const images = await extractWikipediaImages(wikipediaUrl);
    
    if (images.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false,
          message: 'No images found on Wikipedia page',
          images: []
        }),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // Process the first image (best one)
    const bestImage = images[0];
    console.log(`[${requestId}] Processing image: ${bestImage.title}`);

    // Delete old image before saving new one
    console.log(`[${requestId}] Deleting old image for attraction ${attractionId}...`);
    await deleteOldImage(attractionId);

    // Download image
    const imageData = await downloadWikipediaImage(bestImage);
    
    // Generate filename and storage path
    const fileName = generateWikipediaFilename(attractionName, bestImage.title, 1);
    const folderId = `wikipedia-${attractionId.substring(0, 8)}`;
    
    // Store in bucket
    const storagePath = await storeImageInBucket(imageData, folderId, fileName, bestImage.mime);
    
    // Generate public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('travel-app-images')
      .getPublicUrl(storagePath);
    
    // Save reference in database
    const imageId = await saveImageReference(
      attractionId,
      publicUrlData.publicUrl,
      storagePath,
      bestImage.title,
      `${bestImage.description || attractionName} - ${bestImage.author} (${bestImage.license})`
    );

    // Update attraction table with primary image URL and source
    await supabaseAdmin
      .schema('core')
      .from('attractions')
      .update({ 
        image_url: publicUrlData.publicUrl,
        image_source: 'wikipedia'
      })
      .eq('id', attractionId);

    console.log(`[${requestId}] Successfully processed Wikipedia image: ${storagePath}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: 1,
        total: images.length,
        imageSource: 'wikipedia',
        images: [{
          id: imageId,
          url: publicUrlData.publicUrl,
          storage_path: storagePath,
          title: bestImage.title,
          author: bestImage.author,
          license: bestImage.license
        }],
        availableImages: images.length
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
    console.error(`[${requestId}] Error in extract-wikipedia-images function:`, error);
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
