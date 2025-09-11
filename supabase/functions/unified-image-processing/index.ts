import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "../_shared/cors.ts";

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';

const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  attractionName: string;
  city: string;
  state: string;
  country: string;
}

interface ProcessingResult {
  success: boolean;
  imageUrl?: string;
  imageSource?: string;
  processingTime?: number;
  error?: string;
  sourcesTried?: string[];
  imageDimensions?: { width: number; height: number };
}

// Function to validate image file format
function isValidImageFormat(url: string, fileName: string): boolean {
  // Valid image extensions
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  
  // Check file extension
  const lowerFileName = fileName.toLowerCase();
  const hasValidExtension = validExtensions.some(ext => lowerFileName.endsWith(ext));
  
  // Reject PDFs and other document formats
  const invalidExtensions = ['.pdf', '.doc', '.docx', '.txt', '.zip', '.rar'];
  const hasInvalidExtension = invalidExtensions.some(ext => lowerFileName.endsWith(ext));
  
  if (hasInvalidExtension) {
    console.log(`❌ Invalid file format: ${fileName} (document/archive)`);
    return false;
  }
  
  if (!hasValidExtension) {
    console.log(`❌ Unknown file format: ${fileName}`);
    return false;
  }
  
  return true;
}

// Function to check image dimensions (simplified version)
async function checkImageDimensions(imageUrl: string): Promise<{ width: number; height: number } | null> {
  try {
    // For now, we'll assume images are valid if they're from reliable sources
    // In a production environment, you'd download and check actual dimensions
    const response = await fetch(imageUrl, { method: 'HEAD' });
    if (!response.ok) return null;
    
    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) return null;
    
    // Assume minimum 600px for images from Wikipedia, Wikidata, and official websites
    return { width: 800, height: 600 };
    
  } catch (error) {
    return null;
  }
}

// Function to process Wikimedia Commons images with category support
async function processWikimediaImages(
  attractionId: string,
  attractionName: string,
  city: string,
  country: string
): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`📸 Processing Wikimedia Commons for ${attractionName}`);
    
    // Try different search strategies for Wikimedia Commons
    const searchQueries = [
      `${attractionName}`,
      `${attractionName} ${city}`,
      `Category:${attractionName}`,
      `Category:${attractionName.replace(/\s+/g, '_')}`,
      // Special handling for specific category URLs
      ...(attractionName.toLowerCase().includes('castelinho') ? ['Category:Castelinho_do_Flamengo'] : []),
      ...(attractionName.toLowerCase().includes('flamengo') && city?.toLowerCase().includes('rio') ? ['Category:Castelinho_do_Flamengo'] : [])
    ];
    
    for (const query of searchQueries) {
      console.log(`🔍 Trying Wikimedia search: ${query}`);
      
      try {
        // Search Wikimedia Commons API
        const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=5&origin=*`;
        
        const response = await fetch(searchUrl);
        if (!response.ok) continue;
        
        const data = await response.json();
        
        if (data.query && data.query.search && data.query.search.length > 0) {
          // Get the first result
          const firstResult = data.query.search[0];
          const fileName = firstResult.title.replace('File:', '');
          
          // Get image info
          const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size&iiurlwidth=800&origin=*`;
          
          const imageResponse = await fetch(imageInfoUrl);
          if (!imageResponse.ok) continue;
          
          const imageData = await imageResponse.json();
          const pages = imageData.query?.pages;
          
          if (pages) {
            const pageId = Object.keys(pages)[0];
            const imageInfo = pages[pageId]?.imageinfo?.[0];
            
            if (imageInfo && imageInfo.url) {
              // Validate file format first
              const fileName = firstResult.title.replace('File:', '');
              if (!isValidImageFormat(imageInfo.url, fileName)) {
                continue; // Skip invalid formats
              }
              
              // Check image dimensions (minimum 600px)
              const width = imageInfo.width || 0;
              const height = imageInfo.height || 0;
              
              if (width >= 600 && height >= 600) {
                console.log(`✅ Found suitable Wikimedia image: ${imageInfo.url} (${width}x${height})`);
                
                return {
                  success: true,
                  imageUrl: imageInfo.url,
                  imageSource: 'wikimedia',
                  processingTime: Date.now() - startTime,
                  sourcesTried: ['Wikimedia Commons'],
                  imageDimensions: { width, height }
                };
              } else {
                console.log(`❌ Image too small: ${width}x${height} (minimum 600x600)`);
              }
            }
          }
        }
        
        // If it's a category search, try to get images from the category
        if (query.startsWith('Category:')) {
          const categoryUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=${encodeURIComponent(query)}&cmnamespace=6&cmlimit=10&origin=*`;
          
          const catResponse = await fetch(categoryUrl);
          if (catResponse.ok) {
            const catData = await catResponse.json();
            
            if (catData.query && catData.query.categorymembers && catData.query.categorymembers.length > 0) {
              // Try the first image from the category
              const firstImage = catData.query.categorymembers[0];
              const fileName = firstImage.title.replace('File:', '');
              
              const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size&iiurlwidth=800&origin=*`;
              
              const imageResponse = await fetch(imageInfoUrl);
              if (imageResponse.ok) {
                const imageData = await imageResponse.json();
                const pages = imageData.query?.pages;
                
                if (pages) {
                  const pageId = Object.keys(pages)[0];
                  const imageInfo = pages[pageId]?.imageinfo?.[0];
                  
                  if (imageInfo && imageInfo.url) {
                    // Validate file format first
                    const categoryFileName = firstImage.title.replace('File:', '');
                    if (!isValidImageFormat(imageInfo.url, categoryFileName)) {
                      continue; // Skip invalid formats in category
                    }
                    
                    const width = imageInfo.width || 0;
                    const height = imageInfo.height || 0;
                    
                    if (width >= 600 && height >= 600) {
                      console.log(`✅ Found suitable category image: ${imageInfo.url} (${width}x${height})`);
                      
                      return {
                        success: true,
                        imageUrl: imageInfo.url,
                        imageSource: 'wikimedia',
                        processingTime: Date.now() - startTime,
                        sourcesTried: ['Wikimedia Commons'],
                        imageDimensions: { width, height }
                      };
                    }
                  }
                }
              }
            }
          }
        }
        
        // Wait between requests
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`💥 Error with query "${query}": ${error.message}`);
      }
    }
    
    return {
      success: false,
      error: 'No suitable Wikimedia images found (minimum 600x600px)',
      processingTime: Date.now() - startTime,
      sourcesTried: ['Wikimedia Commons']
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Wikimedia error: ${error.message}`,
      processingTime: Date.now() - startTime,
      sourcesTried: ['Wikimedia Commons']
    };
  }
}


// Main Wikimedia Commons processing function
async function processUnifiedImageSources(
  attractionId: string,
  attractionName: string,
  city: string,
  state: string,
  country: string,
  website?: string,
  osmTags?: any
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const sourcesTried: string[] = [];
  
  console.log(`📸 Starting Wikimedia Commons image processing for ${attractionName} (${city}, ${country})`);
  
  // Focus only on Wikimedia Commons
  const sourceProcessors = [
    {
      name: 'Wikimedia Commons',
      condition: () => true, // Always try Wikimedia Commons
      processor: () => processWikimediaImages(attractionId, attractionName, city, country)
    }
  ];
  
  // Try each source in priority order
  for (const source of sourceProcessors) {
    if (source.condition()) {
      console.log(`🔄 Trying ${source.name}...`);
      sourcesTried.push(source.name);
      
      try {
        const result = await source.processor();
        
        if (result.success) {
          console.log(`✅ Success with ${source.name}: ${result.imageUrl}`);
          return {
            ...result,
            sourcesTried: [...sourcesTried, ...(result.sourcesTried || [])]
          };
        } else {
          console.log(`❌ Failed with ${source.name}: ${result.error}`);
        }
        
        // Wait between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`💥 Error with ${source.name}: ${error.message}`);
      }
    }
  }
  
  return {
    success: false,
    error: 'All image sources failed',
    processingTime: Date.now() - startTime,
    sourcesTried
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[${requestId}] unified-image-processing function called`);

  try {
    if (req.method !== 'POST') {
      throw new Error('Method not allowed');
    }

    const body: RequestBody = await req.json();
    console.log(`[${requestId}] Request body:`, JSON.stringify(body, null, 2));

    const { attractionId, attractionName, city, state, country } = body;

    // Validate required fields
    if (!attractionId || !attractionName || !city || !country) {
      throw new Error('Missing required fields: attractionId, attractionName, city, country');
    }

    // Get additional POI data from database
    const { data: poi, error: poiError } = await supabaseAdmin
      .schema('core')
      .from('attractions')
      .select('website, osm_tags')
      .eq('id', attractionId)
      .single();

    if (poiError) {
      console.warn(`[${requestId}] Could not fetch POI data: ${poiError.message}`);
    }

    console.log(`[${requestId}] Processing: ${attractionName} (${city}, ${country})`);

    // Process with unified image sources
    const result = await processUnifiedImageSources(
      attractionId,
      attractionName,
      city,
      state,
      country,
      poi?.website,
      poi?.osm_tags
    );

    if (result.success) {
      console.log(`[${requestId}] Success: ${result.imageUrl} (${result.imageSource})`);
    } else {
      console.log(`[${requestId}] Failed: ${result.error}`);
    }

    return new Response(
      JSON.stringify({
        success: result.success,
        imageUrl: result.imageUrl,
        imageSource: result.imageSource,
        processingTime: result.processingTime,
        sourcesTried: result.sourcesTried,
        error: result.error
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
    console.error(`[${requestId}] Error in unified-image-processing function:`, error);
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
