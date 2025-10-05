import { api, apiManager } from '../lib/core/api-manager'
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
  wikidataId: string;
}

interface WikidataImageInfo {
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

// Extract images from Wikidata
async function extractWikidataImages(wikidataId: string): Promise<WikidataImageInfo[]> {
  try {
    // Query Wikidata API for entity claims
    const apiUrl = `https://www.wikidata.org/w/api.php?` + new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: wikidataId,
      props: 'claims'
    });

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Wikidata API error: ${response.status}`);
    }

    const data = response.data;
    const entity = data.entities[wikidataId];

    if (!entity) {
      throw new Error(`Entity ${wikidataId} not found in Wikidata`);
    }

    // Look for image claims (P18)
    const imageClaims = entity.claims?.P18;
    if (!imageClaims || imageClaims.length === 0) {
      return [];
    }

    // Get detailed info for each image
    const imageInfos: WikidataImageInfo[] = [];
    
    for (const claim of imageClaims.slice(0, 3)) { // Limit to 3 images
      try {
        const imageName = claim.mainsnak?.datavalue?.value;
        if (imageName) {
          const imageInfo = await getWikidataImageInfo(imageName);
          if (imageInfo) {
            imageInfos.push(imageInfo);
          }
        }
      } catch (error) {
        console.warn(`Failed to get info for image ${claim.mainsnak?.datavalue?.value}: ${error.message}`);
      }
    }

    return imageInfos;

  } catch (error) {
    throw new Error(`Failed to extract Wikidata images: ${error.message}`);
  }
}

// Get detailed image information from Wikimedia Commons
async function getWikidataImageInfo(imageName: string): Promise<WikidataImageInfo | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      titles: `File:${imageName}`,
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1600'
    });

    const response = await api.wiki.media({);
    if (!response.ok) {
      throw new Error(`Wikimedia API error: ${response.status}`);
    }

    const data = response.data;
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
    console.error(`Error getting Wikidata image info: ${error.message}`);
    return null;
  }
}

// Download image from Wikimedia Commons
async function downloadWikidataImage(imageInfo: WikidataImageInfo): Promise<ArrayBuffer> {
  const response = await fetch(imageInfo.url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  return await response.arrayBuffer();
}

// Generate filename for Wikidata images
const generateWikidataFilename = (attractionName: string, imageTitle: string, index: number = 1): string => {
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
      alt_text: altText || `Image from Wikidata for attraction ${attractionId}`
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
  console.log(`[${requestId}] Extract Wikidata images function request received:`, req.method);

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
    const { attractionId, attractionName, wikidataId } = body;

    console.log(`[${requestId}] Processing Wikidata images for: ${attractionName}`);
    console.log(`[${requestId}] Wikidata ID: ${wikidataId}`);

    // Validate input
    if (!attractionId || !attractionName || !wikidataId) {
      return new Response(
        JSON.stringify({ error: 'attractionId, attractionName, and wikidataId are required' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // Extract images from Wikidata
    const images = await extractWikidataImages(wikidataId);
    
    if (images.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false,
          message: 'No images found in Wikidata',
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
    const imageData = await downloadWikidataImage(bestImage);
    
    // Generate filename and storage path
    const fileName = generateWikidataFilename(attractionName, bestImage.title, 1);
    const folderId = `wikidata-${attractionId.substring(0, 8)}`;
    
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
        image_source: 'wikidata'
      })
      .eq('id', attractionId);

    console.log(`[${requestId}] Successfully processed Wikidata image: ${storagePath}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: 1,
        total: images.length,
        imageSource: 'wikidata',
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
    console.error(`[${requestId}] Error in extract-wikidata-images function:`, error);
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
