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
  attractionName: string;
  imageSource: 'google_places' | 'wikimedia_commons';
  
  // Para Google Places (existente)
  googlePlaceId?: string;
  photoReferences?: string[];
  
  // Para Wikimedia Commons (novo)
  wikimediaUrl?: string;
  osmTags?: any;
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

// Generate filename for Wikimedia Commons images
const generateWikimediaFilename = (attractionName: string, imageTitle: string, index: number = 1): string => {
  // Clean the attraction name
  const cleanAttractionName = attractionName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30);

  // Clean the image title
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
  return '.jpg'; // Default fallback
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

// Extract and download image from Wikimedia Commons
const downloadWikimediaImage = async (wikimediaUrl: string, osmTags?: any): Promise<{imageData: ArrayBuffer, imageInfo: any}> => {
  let imageUrl: string;
  let imageInfo: any;

  // Try to extract from OSM tags first
  if (osmTags && osmTags.wikimedia_commons) {
    const result = await extractImageFromOSMTags(osmTags);
    if (result.success && result.images.length > 0) {
      imageInfo = result.images[0];
      imageUrl = imageInfo.url;
    } else {
      throw new Error(`Failed to extract image from OSM tags: ${result.error}`);
    }
  } else {
    // Fallback to direct URL processing
    const result = await extractImageFromUrl(wikimediaUrl);
    if (result.success && result.images.length > 0) {
      imageInfo = result.images[0];
      imageUrl = imageInfo.url;
    } else {
      throw new Error(`Failed to extract image from URL: ${result.error}`);
    }
  }

  // Download the image
  const response = await fetch(imageUrl, {
    method: 'GET',
    headers: {
      'Accept': 'image/jpeg, image/png, image/webp, image/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download image from Wikimedia: ${response.statusText}`);
  }

  const imageData = await response.arrayBuffer();
  return { imageData, imageInfo };
};

// Extract image from OSM tags
const extractImageFromOSMTags = async (osmTags: any): Promise<{success: boolean, images: any[], error?: string}> => {
  try {
    if (!osmTags || !osmTags.wikimedia_commons) {
      return {
        success: false,
        images: [],
        error: 'No wikimedia_commons field found in OSM tags'
      };
    }

    const wikimediaCommons = osmTags.wikimedia_commons;
    
    // Check if it's a category or file URL
    if (wikimediaCommons.includes('/wiki/Category:')) {
      return await getImagesFromCategory(wikimediaCommons);
    } else if (wikimediaCommons.includes('/wiki/File:')) {
      return await getImageFromFile(wikimediaCommons);
    } else {
      return {
        success: false,
        images: [],
        error: 'Unsupported Wikimedia Commons URL format'
      };
    }
  } catch (error) {
    return {
      success: false,
      images: [],
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

// Extract image from direct URL
const extractImageFromUrl = async (url: string): Promise<{success: boolean, images: any[], error?: string}> => {
  try {
    if (url.includes('/wiki/Category:')) {
      return await getImagesFromCategory(url);
    } else if (url.includes('/wiki/File:')) {
      return await getImageFromFile(url);
    } else {
      return {
        success: false,
        images: [],
        error: 'Unsupported Wikimedia Commons URL format'
      };
    }
  } catch (error) {
    return {
      success: false,
      images: [],
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

// Get images from Wikimedia Commons category
const getImagesFromCategory = async (categoryUrl: string): Promise<{success: boolean, images: any[], error?: string}> => {
  try {
    const categoryName = extractCategoryName(categoryUrl);
    if (!categoryName) {
      return {
        success: false,
        images: [],
        error: 'Could not extract category name from URL'
      };
    }

    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmtype: 'file',
      cmlimit: '5', // Limit to 5 images to choose from
      cmnamespace: '6' // File namespace
    });

    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    if (!response.ok) {
      throw new Error(`Wikimedia API error: ${response.status}`);
    }

    const data = await response.json();
    const files = data.query?.categorymembers || [];

    if (files.length === 0) {
      return {
        success: false,
        images: [],
        error: 'No images found in category'
      };
    }

    // Get detailed info for the first file (we only need 1 image)
    const imageInfo = await getImageInfo(files[0].title);
    if (!imageInfo) {
      return {
        success: false,
        images: [],
        error: 'Could not get image info'
      };
    }

    return {
      success: true,
      images: [imageInfo]
    };
  } catch (error) {
    return {
      success: false,
      images: [],
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

// Get image from Wikimedia Commons file
const getImageFromFile = async (fileUrl: string): Promise<{success: boolean, images: any[], error?: string}> => {
  try {
    const fileName = extractFileName(fileUrl);
    if (!fileName) {
      return {
        success: false,
        images: [],
        error: 'Could not extract file name from URL'
      };
    }

    const imageInfo = await getImageInfo(fileName);
    if (!imageInfo) {
      return {
        success: false,
        images: [],
        error: 'Could not get image info'
      };
    }

    return {
      success: true,
      images: [imageInfo]
    };
  } catch (error) {
    return {
      success: false,
      images: [],
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

// Get detailed image information from Wikimedia Commons
const getImageInfo = async (fileName: string): Promise<any | null> => {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: fileName,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1600' // High resolution
  });

  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!response.ok) {
    throw new Error(`Wikimedia API error: ${response.status}`);
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
};

// Extract category name from Wikimedia Commons category URL
const extractCategoryName = (url: string): string | null => {
  const match = url.match(/\/wiki\/Category:(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

// Extract file name from Wikimedia Commons file URL
const extractFileName = (url: string): string | null => {
  const match = url.match(/\/wiki\/File:(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
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
  folderId: string,
  fileName: string,
  contentType: string = 'image/jpeg'
): Promise<string> => {
  // Use your existing folder structure: folderId/filename
  const storagePath = `${folderId}/${fileName}`;
  
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
  publicUrl: string,
  storagePath: string,
  source: 'google_places' | 'wikimedia_commons',
  reference: string,
  altText?: string
): Promise<string> => {
  // Insert into attraction_image table with your existing schema
  const { data, error } = await supabaseAdmin
    .schema('core')
    .from('attraction_image')
    .insert({
      attraction_id: attractionId,
      image_url: publicUrl,
      storage_path: storagePath,
      photo_reference: reference,
      alt_text: altText || `Image from ${source} for attraction ${attractionId}`
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
    console.log(`[${requestId}] Request body received:`, JSON.stringify(body, null, 2));
    
    const { attractionId, attractionName, imageSource, googlePlaceId, photoReferences, wikimediaUrl, osmTags } = body;
    
    console.log(`[${requestId}] Parsed values:`, {
      attractionId: !!attractionId,
      attractionName: !!attractionName,
      imageSource,
      googlePlaceId: !!googlePlaceId,
      photoReferences: photoReferences?.length || 0,
      wikimediaUrl: !!wikimediaUrl,
      osmTags: !!osmTags,
      osmTagsWikimediaCommons: !!osmTags?.wikimedia_commons
    });

    // Validate input based on image source
    console.log(`[${requestId}] Validating basic fields...`);
    if (!attractionId || !attractionName || !imageSource) {
      console.log(`[${requestId}] Basic validation failed:`, {
        attractionId: !!attractionId,
        attractionName: !!attractionName,
        imageSource: !!imageSource
      });
      return new Response(
        JSON.stringify({ error: 'attractionId, attractionName, and imageSource are required' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    if (imageSource === 'google_places' && (!photoReferences || photoReferences.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'photoReferences are required for google_places source' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    if (imageSource === 'wikimedia_commons' && !wikimediaUrl && !osmTags?.wikimedia_commons) {
      console.log(`[${requestId}] Wikimedia validation failed:`, {
        wikimediaUrl: !!wikimediaUrl,
        osmTags: !!osmTags,
        osmTagsWikimediaCommons: !!osmTags?.wikimedia_commons
      });
      return new Response(
        JSON.stringify({ error: 'wikimediaUrl or osmTags.wikimedia_commons is required for wikimedia_commons source' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    if (imageSource === 'google_places' && !GOOGLE_API_KEY) {
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

    console.log(`[${requestId}] Processing image from ${imageSource} for attraction ${attractionId}`);
    
    // Debug environment variables (without exposing secrets)
    console.log(`[${requestId}] Environment check:`, {
      hasGoogleKey: !!GOOGLE_API_KEY,
      hasProjectUrl: !!PROJECT_URL,
      hasServiceKey: !!SERVICE_ROLE_KEY,
      googleKeyLength: GOOGLE_API_KEY?.length || 0,
      projectUrl: PROJECT_URL,
      imageSource
    });

    const storedImages: StoredImage[] = [];
    const errors: string[] = [];

    try {
      let imageData: ArrayBuffer;
      let fileName: string;
      let folderId: string;
      let reference: string;
      let altText: string;
      let contentType: string = 'image/jpeg';

      if (imageSource === 'google_places') {
        // Process Google Places image
        const photoRef = photoReferences[0]; // Only process first image
        console.log(`[${requestId}] Processing Google Places photo: ${photoRef}`);

        imageData = await downloadGooglePhoto(photoRef, '1600');
        fileName = generateFilename(googlePlaceId, 1);
        folderId = googlePlaceId;
        reference = photoRef;
        altText = `Image from Google Places for ${attractionName}`;

      } else if (imageSource === 'wikimedia_commons') {
        // Process Wikimedia Commons image
        console.log(`[${requestId}] Processing Wikimedia Commons image`);
        
        const { imageData: wikimediaImageData, imageInfo } = await downloadWikimediaImage(
          wikimediaUrl || '', 
          osmTags
        );
        
        imageData = wikimediaImageData;
        fileName = generateWikimediaFilename(attractionName, imageInfo.title, 1);
        folderId = `wikimedia-${attractionId.substring(0, 8)}`; // Use attraction ID prefix for folder
        reference = imageInfo.title;
        altText = `${imageInfo.description || attractionName} - ${imageInfo.author} (${imageInfo.license})`;
        contentType = imageInfo.mime || 'image/jpeg';

      } else {
        throw new Error(`Unsupported image source: ${imageSource}`);
      }

      // Store in bucket using your folder structure
      const storagePath = await storeImageInBucket(imageData, folderId, fileName, contentType);
      
      // Generate public URL using your existing format
      const { data: publicUrlData } = supabaseAdmin.storage
        .from('travel-app-images')
        .getPublicUrl(storagePath);
      
      // Save reference in database with public URL
      const imageId = await saveImageReference(
        attractionId,
        publicUrlData.publicUrl,
        storagePath,
        imageSource,
        reference,
        altText
      );

      storedImages.push({
        id: imageId,
        url: publicUrlData.publicUrl,
        storage_path: storagePath
      });

      console.log(`[${requestId}] Successfully processed ${imageSource} image: ${storagePath}`);

    } catch (error) {
      const errorMsg = `Failed to process ${imageSource} image: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[${requestId}] ${errorMsg}`, error);
      errors.push(errorMsg);
    }

    // Update attraction table with primary image URL and source if we have images
    if (storedImages.length > 0 && storedImages[0]) {
      try {
        await supabaseAdmin
          .schema('core')
          .from('attractions')
          .update({ 
            image_url: storedImages[0].url,
            image_source: imageSource
          })
          .eq('id', attractionId);
        
        console.log(`[${requestId}] Updated attraction ${attractionId} with primary image URL and source: ${imageSource}`);
      } catch (error) {
        console.warn(`[${requestId}] Failed to update attraction image_url and image_source: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: storedImages.length > 0,
        processed: storedImages.length,
        total: imageSource === 'google_places' ? (photoReferences?.length || 0) : 1,
        imageSource,
        images: storedImages,
        errors: errors.length > 0 ? errors : undefined
      }),
      {
        status: storedImages.length > 0 ? 200 : 400,
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