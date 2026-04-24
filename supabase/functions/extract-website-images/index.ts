import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuthHeader } from '../_shared/auth-middleware.ts';
import { checkRateLimit, createRateLimitResponse, RATE_LIMIT_CONFIG } from '../_shared/rate-limiter.ts';
import { createSecureMediaHeaders } from '../_shared/security-headers.ts';
import {
  validateRequestBody,
  createValidationErrorResponse,
  ExtractWebsiteImagesSchema,
} from '../_shared/validation-schemas.ts';
import { createAuditLogger } from '../_shared/audit-logger.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebsiteImageRequest {
  attractionId: string;
  attractionName: string;
  websiteUrl: string;
}

interface ImageInfo {
  url: string;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  mime?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: createSecureHeaders(corsHeaders) });
  }

  // ✅ VALIDAR AUTENTICAÇÃO
  const authResult = await validateAuthHeader(req)
  if (!authResult.valid) {
    console.warn(`[Extract-Website-Images] ❌ Unauthorized: ${authResult.error}`)
    return new Response(
      JSON.stringify({ error: 'Unauthorized', detail: authResult.error }),
      { status: 401, headers: createSecureHeaders(corsHeaders) }
    )
  }
  console.log(`[Extract-Website-Images] ✅ Authorized: ${authResult.email}`)

  // ✅ RATE LIMITING CHECK
  const config = RATE_LIMIT_CONFIG['extract-website']
  const rateLimit = checkRateLimit(req, 'extract-website', config.maxRequests, config.windowSeconds)
  if (!rateLimit.allowed) {
    console.warn(`[Extract-Website-Images] ⚠️ Rate limit exceeded for ${rateLimit.clientId}`)
    return createRateLimitResponse(rateLimit, corsHeaders)
  }
  console.log(`[Extract-Website-Images] ✅ Rate limit OK (${rateLimit.remaining} remaining)`)

  try {
    const { attractionId, attractionName, websiteUrl }: WebsiteImageRequest = await req.json();

    if (!attractionId || !attractionName || !websiteUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: attractionId, attractionName, websiteUrl' }),
        { status: 400, headers: { headers: createSecureHeaders(corsHeaders) } }
      );
    }

    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${requestId}] Starting website image extraction for: ${attractionName}`);
    console.log(`[${requestId}] Website URL: ${websiteUrl}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SECRET_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Extract images from website
    const images = await extractImagesFromWebsite(websiteUrl, attractionName);
    
    if (images.length === 0) {
      console.log(`[${requestId}] No suitable images found on website`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'No suitable images found on website',
          availableImages: 0
        }),
        { headers: { headers: createSecureHeaders(corsHeaders) } }
      );
    }

    console.log(`[${requestId}] Found ${images.length} potential images`);

    // Select the best image (first one for now)
    const bestImage = images[0];
    console.log(`[${requestId}] Selected image: ${bestImage.title}`);

    // Download image
    const imageData = await downloadWebsiteImage(bestImage);
    
    // Generate filename and storage path
    const fileName = generateWebsiteFilename(attractionName, bestImage.title, 1);
    const folderId = `website-${attractionId.substring(0, 8)}`;
    
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
      `${bestImage.description || attractionName} - Website image`
    );

    // Update attraction table with primary image URL and source
    const { error: updateError } = await supabaseAdmin
      .schema('core')
      .from('attractions')
      .update({ 
        image_url: publicUrlData.publicUrl,
        image_source: 'website'
      })
      .eq('id', attractionId);

    if (updateError) {
      throw new Error(`Failed to update attraction: ${updateError.message}`);
    }

    console.log(`[${requestId}] Successfully processed website image for ${attractionName}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Website image extracted and stored successfully',
        imageId,
        imageUrl: publicUrlData.publicUrl,
        images: [{
          url: publicUrlData.publicUrl,
          title: bestImage.title,
          description: bestImage.description
        }],
        availableImages: images.length
      }),
      { headers: { headers: createSecureHeaders(corsHeaders) } }
    );

  } catch (error) {
    console.error('Error in extract-website-images:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to extract website image', 
        details: error.message 
      }),
      { status: 500, headers: { headers: createSecureHeaders(corsHeaders) } }
    );
  }
});

async function extractImagesFromWebsite(websiteUrl: string, attractionName: string): Promise<ImageInfo[]> {
  try {
    console.log(`Fetching website content from: ${websiteUrl}`);
    
    const response = await fetch(websiteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TuggiBot/1.0; +https://tuggi.com/bot)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    console.log(`Website content fetched, length: ${html.length} characters`);

    // Extract images using regex patterns
    const images: ImageInfo[] = [];
    
    // Pattern 1: Standard img tags
    const imgTagPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    
    while ((match = imgTagPattern.exec(html)) !== null) {
      const src = match[1];
      const fullImgTag = match[0];
      
      // Extract additional attributes
      const titleMatch = fullImgTag.match(/title=["']([^"']+)["']/i);
      const altMatch = fullImgTag.match(/alt=["']([^"']+)["']/i);
      const widthMatch = fullImgTag.match(/width=["']?(\d+)["']?/i);
      const heightMatch = fullImgTag.match(/height=["']?(\d+)["']?/i);
      
      // Convert relative URLs to absolute
      const absoluteUrl = new URL(src, websiteUrl).href;
      
      // Filter out small images, icons, and non-relevant images
      if (isValidWebsiteImage(absoluteUrl, titleMatch?.[1] || altMatch?.[1] || '', attractionName)) {
        images.push({
          url: absoluteUrl,
          title: titleMatch?.[1] || altMatch?.[1] || 'Website image',
          description: altMatch?.[1] || titleMatch?.[1],
          width: widthMatch ? parseInt(widthMatch[1]) : undefined,
          height: heightMatch ? parseInt(heightMatch[1]) : undefined
        });
      }
    }

    // Pattern 2: CSS background images
    const backgroundPattern = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi;
    while ((match = backgroundPattern.exec(html)) !== null) {
      const src = match[1];
      const absoluteUrl = new URL(src, websiteUrl).href;
      
      if (isValidWebsiteImage(absoluteUrl, '', attractionName)) {
        images.push({
          url: absoluteUrl,
          title: 'Background image',
          description: 'CSS background image'
        });
      }
    }

    // Pattern 3: Data attributes and other sources
    const dataSrcPattern = /data-src=["']([^"']+)["']/gi;
    while ((match = dataSrcPattern.exec(html)) !== null) {
      const src = match[1];
      const absoluteUrl = new URL(src, websiteUrl).href;
      
      if (isValidWebsiteImage(absoluteUrl, '', attractionName)) {
        images.push({
          url: absoluteUrl,
          title: 'Lazy-loaded image',
          description: 'Data-src image'
        });
      }
    }

    console.log(`Found ${images.length} potential images from website`);
    return images;

  } catch (error) {
    console.error('Error extracting images from website:', error);
    throw error;
  }
}

function isValidWebsiteImage(url: string, title: string, attractionName: string): boolean {
  // Skip if URL is invalid
  if (!url || url.length < 10) return false;
  
  // Skip common non-content images
  const skipPatterns = [
    /\.(ico|svg)$/i,
    /logo/i,
    /icon/i,
    /button/i,
    /banner/i,
    /advertisement/i,
    /ad_/i,
    /pixel/i,
    /tracking/i,
    /analytics/i,
    /facebook/i,
    /twitter/i,
    /instagram/i,
    /youtube/i,
    /google/i,
    /placeholder/i,
    /loading/i,
    /spinner/i,
    /arrow/i,
    /chevron/i,
    /close/i,
    /menu/i,
    /hamburger/i,
    /search/i,
    /cart/i,
    /user/i,
    /profile/i,
    /avatar/i,
    /default/i,
    /no-image/i,
    /missing/i,
    /error/i,
    /404/i,
    /blank/i,
    /transparent/i,
    /1x1/i,
    /pixel/i,
    /track/i,
    /beacon/i,
    /counter/i,
    /stat/i,
    /metric/i
  ];
  
  // Check skip patterns
  for (const pattern of skipPatterns) {
    if (pattern.test(url) || pattern.test(title)) {
      return false;
    }
  }
  
  // Skip very small images (likely icons)
  const sizeMatch = url.match(/(\d+)x(\d+)/);
  if (sizeMatch) {
    const width = parseInt(sizeMatch[1]);
    const height = parseInt(sizeMatch[2]);
    if (width < 200 || height < 200) {
      return false;
    }
  }
  
  // Prefer images that might be related to the attraction
  const attractionKeywords = attractionName.toLowerCase().split(' ').filter(word => word.length > 3);
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  
  // If image URL or title contains attraction keywords, prioritize it
  const hasRelevantKeywords = attractionKeywords.some(keyword => 
    urlLower.includes(keyword) || titleLower.includes(keyword)
  );
  
  // Accept images that are either relevant or don't match skip patterns
  return hasRelevantKeywords || !skipPatterns.some(pattern => pattern.test(urlLower));
}

async function downloadWebsiteImage(imageInfo: ImageInfo): Promise<Uint8Array> {
  try {
    console.log(`Downloading image from: ${imageInfo.url}`);
    
    const response = await fetch(imageInfo.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TuggiBot/1.0; +https://tuggi.com/bot)',
        'Referer': new URL(imageInfo.url).origin
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const imageData = new Uint8Array(await response.arrayBuffer());
    console.log(`Downloaded image, size: ${imageData.length} bytes`);
    
    return imageData;

  } catch (error) {
    console.error('Error downloading website image:', error);
    throw error;
  }
}

function generateWebsiteFilename(attractionName: string, imageTitle: string, index: number): string {
  // Clean and normalize the attraction name
  const cleanName = attractionName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  
  // Clean and normalize the image title
  const cleanTitle = imageTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30);
  
  const timestamp = Date.now();
  const extension = getFileExtension(imageTitle) || 'jpg';
  
  return `${cleanName}-${cleanTitle}-${timestamp}-${index}.${extension}`;
}

function getFileExtension(filename: string): string | null {
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

async function storeImageInBucket(
  imageData: Uint8Array, 
  folderId: string, 
  fileName: string, 
  mimeType?: string
): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SECRET_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const storagePath = `${folderId}/${fileName}`;
  
  const { error } = await supabaseAdmin.storage
    .from('travel-app-images')
    .upload(storagePath, imageData, {
      contentType: mimeType || 'image/jpeg',
      upsert: true
    });

  if (error) {
    throw new Error(`Failed to upload image: ${error.message}`);
  }

  console.log(`Image stored at: ${storagePath}`);
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
  const supabaseServiceKey = Deno.env.get('SUPABASE_SECRET_KEY')!;
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
