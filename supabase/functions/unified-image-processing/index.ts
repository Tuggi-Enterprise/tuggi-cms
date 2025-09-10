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
}

// Function to process specialized sources (IPHAN, etc.)
async function processSpecializedSources(
  attractionId: string,
  attractionName: string,
  city: string,
  country: string
): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🏛️  Processing specialized sources for ${attractionName} (${city}, ${country})`);
    
    // For Brazilian POIs, try IPHAN first
    if (country === 'BR') {
      const response = await fetch(`${PROJECT_URL}/functions/v1/extract-iphan-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          attractionId,
          attractionName,
          searchQuery: `${attractionName} ${city}`
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.imageUrl) {
          return {
            success: true,
            imageUrl: data.imageUrl,
            imageSource: 'iphan',
            processingTime: Date.now() - startTime,
            sourcesTried: ['IPHAN']
          };
        }
      }
    }
    
    return {
      success: false,
      error: 'No specialized sources available for this country',
      processingTime: Date.now() - startTime,
      sourcesTried: ['IPHAN']
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Specialized sources error: ${error.message}`,
      processingTime: Date.now() - startTime,
      sourcesTried: ['IPHAN']
    };
  }
}

// Function to process Wikipedia images
async function processWikipediaImages(
  attractionId: string,
  attractionName: string,
  city: string,
  country: string
): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`📚 Processing Wikipedia images for ${attractionName}`);
    
    const response = await fetch(`${PROJECT_URL}/functions/v1/extract-wikipedia-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId,
        attractionName,
        city,
        country
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.imageUrl) {
        return {
          success: true,
          imageUrl: data.imageUrl,
          imageSource: 'wikipedia',
          processingTime: Date.now() - startTime,
          sourcesTried: ['Wikipedia']
        };
      }
    }
    
    return {
      success: false,
      error: 'No Wikipedia images found',
      processingTime: Date.now() - startTime,
      sourcesTried: ['Wikipedia']
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Wikipedia error: ${error.message}`,
      processingTime: Date.now() - startTime,
      sourcesTried: ['Wikipedia']
    };
  }
}

// Function to process website images
async function processWebsiteImages(
  attractionId: string,
  attractionName: string,
  website: string
): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🌐 Processing website images for ${attractionName}`);
    
    const response = await fetch(`${PROJECT_URL}/functions/v1/extract-website-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId,
        attractionName,
        website
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.imageUrl) {
        return {
          success: true,
          imageUrl: data.imageUrl,
          imageSource: 'website',
          processingTime: Date.now() - startTime,
          sourcesTried: ['Website']
        };
      }
    }
    
    return {
      success: false,
      error: 'No website images found',
      processingTime: Date.now() - startTime,
      sourcesTried: ['Website']
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Website error: ${error.message}`,
      processingTime: Date.now() - startTime,
      sourcesTried: ['Website']
    };
  }
}

// Function to process Wikidata images
async function processWikidataImages(
  attractionId: string,
  attractionName: string,
  wikidataId: string
): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🔗 Processing Wikidata images for ${attractionName}`);
    
    const response = await fetch(`${PROJECT_URL}/functions/v1/extract-wikidata-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId,
        attractionName,
        wikidataId
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.imageUrl) {
        return {
          success: true,
          imageUrl: data.imageUrl,
          imageSource: 'wikidata',
          processingTime: Date.now() - startTime,
          sourcesTried: ['Wikidata']
        };
      }
    }
    
    return {
      success: false,
      error: 'No Wikidata images found',
      processingTime: Date.now() - startTime,
      sourcesTried: ['Wikidata']
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Wikidata error: ${error.message}`,
      processingTime: Date.now() - startTime,
      sourcesTried: ['Wikidata']
    };
  }
}

// Main unified processing function
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
  
  console.log(`🎯 Starting unified image processing for ${attractionName} (${city}, ${country})`);
  
  // Priority order for image sources
  const sourceProcessors = [
    // 1. Specialized sources (IPHAN for Brazil, etc.)
    {
      name: 'Specialized Sources',
      condition: () => true, // Always try specialized sources first
      processor: () => processSpecializedSources(attractionId, attractionName, city, country)
    },
    
    // 2. Wikipedia images
    {
      name: 'Wikipedia',
      condition: () => true, // Always try Wikipedia
      processor: () => processWikipediaImages(attractionId, attractionName, city, country)
    },
    
    // 3. Wikidata images (if available)
    {
      name: 'Wikidata',
      condition: () => osmTags?.wikidata,
      processor: () => processWikidataImages(attractionId, attractionName, osmTags.wikidata)
    },
    
    // 4. Website images (if available)
    {
      name: 'Website',
      condition: () => website,
      processor: () => processWebsiteImages(attractionId, attractionName, website)
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
