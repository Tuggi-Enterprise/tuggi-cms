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
  optimizedImageUrl?: string;
  thumbnailUrl?: string;
  imageSource?: string;
  processingTime?: number;
  error?: string;
  sourcesTried?: string[];
  imageDimensions?: { width: number; height: number };
  geoValidation?: {
    hasGPS: boolean;
    imageCoordinates?: { lat: number; lng: number };
    imageLocation?: { city?: string; state?: string; country?: string };
    isLocationMatch: boolean;
    matchLevel?: 'city' | 'state' | 'country' | 'none';
  };
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

// Rate limiter for Nominatim API
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly timeWindow: number; // in milliseconds

  constructor(maxRequests: number, timeWindowMs: number) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindowMs;
  }

  async waitForNextRequest(): Promise<void> {
    const now = Date.now();
    
    // Remove old requests outside the time window
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    // If we're at the limit, wait
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.timeWindow - (now - oldestRequest) + 100; // Add 100ms buffer
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // Record this request
    this.requests.push(Date.now());
  }
}

const nominatimLimiter = new RateLimiter(1, 1000); // 1 request per second

// Function to perform reverse geocoding using Nominatim
async function reverseGeocode(lat: number, lng: number): Promise<{ city?: string; state?: string; country?: string } | null> {
  try {
    await nominatimLimiter.waitForNextRequest();
    
    const url = `https://nominatim.openstreetmap.org/reverse?` +
      `lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=10`;
    
    console.log(`🌍 Reverse geocoding: ${lat}, ${lng}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (image-geo-validation)'
      }
    });
    
    if (!response.ok) {
      console.warn(`⚠️ Nominatim API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.address) {
      return null;
    }
    
    // Extract location information from address components
    const address = data.address;
    const city = address.city || 
                address.town || 
                address.municipality || 
                address.village || 
                address.hamlet ||
                address.county;
    
    const state = address.state || 
                 address.province || 
                 address.region;
    
    const country = address.country;
    
    return { city, state, country };
    
  } catch (error) {
    console.error('❌ Reverse geocoding error:', error);
    return null;
  }
}

// Function to extract GPS coordinates from Wikimedia Commons metadata
function extractGPSCoordinates(metadata: any): { lat: number; lng: number } | null {
  try {
    // Check for GPS coordinates in extmetadata
    const gpsLat = metadata.GPSLatitude?.value;
    const gpsLng = metadata.GPSLongitude?.value;
    
    if (gpsLat && gpsLng) {
      // Parse GPS coordinates (they might be in DMS format)
      const lat = parseGPSCoordinate(gpsLat);
      const lng = parseGPSCoordinate(gpsLng);
      
      if (lat !== null && lng !== null) {
        return { lat, lng };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting GPS coordinates:', error);
    return null;
  }
}

// Function to parse GPS coordinate from various formats
function parseGPSCoordinate(coord: string): number | null {
  try {
    // Handle different GPS coordinate formats
    if (typeof coord === 'number') {
      return coord;
    }
    
    if (typeof coord === 'string') {
      // Remove any HTML tags
      coord = coord.replace(/<[^>]*>/g, '');
      
      // Try to parse as decimal degrees
      const decimal = parseFloat(coord);
      if (!isNaN(decimal)) {
        return decimal;
      }
      
      // Try to parse DMS format (e.g., "40°26′46″N")
      const dmsMatch = coord.match(/(\d+)°(\d+)′(\d+(?:\.\d+)?)″([NSEW])/);
      if (dmsMatch) {
        const [, degrees, minutes, seconds, direction] = dmsMatch;
        let result = parseInt(degrees) + parseInt(minutes) / 60 + parseFloat(seconds) / 3600;
        
        if (direction === 'S' || direction === 'W') {
          result = -result;
        }
        
        return result;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Function to validate geographic location match
function validateLocationMatch(
  imageLocation: { city?: string; state?: string; country?: string },
  poiCity: string,
  poiState: string,
  poiCountry: string
): { isMatch: boolean; matchLevel: 'city' | 'state' | 'country' | 'none' } {
  
  // Normalize strings for comparison
  const normalize = (str: string) => str?.toLowerCase().trim().replace(/[^\w\s]/g, '');
  
  const imgCity = normalize(imageLocation.city || '');
  const imgState = normalize(imageLocation.state || '');
  const imgCountry = normalize(imageLocation.country || '');
  
  const poiCityNorm = normalize(poiCity);
  const poiStateNorm = normalize(poiState);
  const poiCountryNorm = normalize(poiCountry);
  
  // Check city match (highest priority)
  if (imgCity && poiCityNorm && imgCity === poiCityNorm) {
    return { isMatch: true, matchLevel: 'city' };
  }
  
  // Check state match (medium priority)
  if (imgState && poiStateNorm && imgState === poiStateNorm) {
    return { isMatch: true, matchLevel: 'state' };
  }
  
  // Check country match (minimum acceptable)
  if (imgCountry && poiCountryNorm && imgCountry === poiCountryNorm) {
    return { isMatch: true, matchLevel: 'country' };
  }
  
  return { isMatch: false, matchLevel: 'none' };
}

// Function to perform complete geographic validation
async function performGeographicValidation(
  metadata: any,
  poiCity: string,
  poiState: string,
  poiCountry: string
): Promise<{
  hasGPS: boolean;
  imageCoordinates?: { lat: number; lng: number };
  imageLocation?: { city?: string; state?: string; country?: string };
  isLocationMatch: boolean;
  matchLevel?: 'city' | 'state' | 'country' | 'none';
}> {
  
  // Extract GPS coordinates from image metadata
  const coordinates = extractGPSCoordinates(metadata);
  
  if (!coordinates) {
    return {
      hasGPS: false,
      isLocationMatch: false,
      matchLevel: 'none'
    };
  }
  
  // Perform reverse geocoding to get location
  const imageLocation = await reverseGeocode(coordinates.lat, coordinates.lng);
  
  if (!imageLocation) {
    return {
      hasGPS: true,
      imageCoordinates: coordinates,
      isLocationMatch: false,
      matchLevel: 'none'
    };
  }
  
  // Validate location match
  const validation = validateLocationMatch(imageLocation, poiCity, poiState, poiCountry);
  
  return {
    hasGPS: true,
    imageCoordinates: coordinates,
    imageLocation,
    isLocationMatch: validation.isMatch,
    matchLevel: validation.matchLevel
  };
}

// Function to generate optimized image URLs
function generateOptimizedUrls(originalUrl: string): {
  optimizedUrl: string;
  thumbnailUrl: string;
} {
  // For Wikimedia Commons, we can use their built-in thumbnail service
  if (originalUrl.includes('upload.wikimedia.org')) {
    // Extract the file path from the original URL
    const urlParts = originalUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    
    // Wikimedia Commons thumbnail format: add /thumb/ and size prefix
    // Original: https://upload.wikimedia.org/wikipedia/commons/4/4f/Christ_the_Redeemer_-_Cristo_Redentor.jpg
    // Optimized: https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Christ_the_Redeemer_-_Cristo_Redentor.jpg/800px-Christ_the_Redeemer_-_Cristo_Redentor.jpg
    const pathWithoutFilename = urlParts.slice(0, -1).join('/');
    const basePath = pathWithoutFilename.replace('/wikipedia/commons', '/wikipedia/commons/thumb');
    
    const optimizedUrl = `${basePath}/${filename}/800px-${filename}`;
    const thumbnailUrl = `${basePath}/${filename}/300px-${filename}`;
    
    return {
      optimizedUrl,
      thumbnailUrl
    };
  }
  
  // For other sources, return original (could be enhanced with Supabase Transform later)
  return {
    optimizedUrl: originalUrl,
    thumbnailUrl: originalUrl
  };
}

// Function to validate image quality and generate optimized versions
async function processImageWithOptimization(
  imageUrl: string,
  width: number,
  height: number,
  geoValidation: any
): Promise<{
  shouldAccept: boolean;
  optimizedUrl?: string;
  thumbnailUrl?: string;
}> {
  
  // Accept image based on validation criteria:
  // 1. If no GPS data, accept (fallback to quality criteria)
  // 2. If GPS data exists, only accept if location matches at least country level
  const shouldAccept = !geoValidation.hasGPS || 
                     (geoValidation.hasGPS && geoValidation.isLocationMatch);
  
  if (!shouldAccept) {
    return { shouldAccept: false };
  }
  
  // Generate optimized URLs
  const { optimizedUrl, thumbnailUrl } = generateOptimizedUrls(imageUrl);
  
  return {
    shouldAccept: true,
    optimizedUrl,
    thumbnailUrl
  };
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
    
    // Assume minimum 500px for images from Wikipedia, Wikidata, and official websites
    return { width: 800, height: 600 };
    
  } catch (error) {
    return null;
  }
}

// Function to process Wikimedia Commons images with category support and geographic validation
async function processWikimediaImages(
  attractionId: string,
  attractionName: string,
  city: string,
  state: string,
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
          // Try multiple results from the search, not just the first one
          for (const result of data.query.search.slice(0, 3)) { // Try up to 3 results
            const fileName = result.title.replace('File:', '');
            
            // Skip if it's clearly not an image format
            if (!isValidImageFormat('', fileName)) {
              console.log(`⏭️ Skipping non-image file: ${fileName}`);
              continue; // Continue to next result
            }
            
            // Get image info with extended metadata for GPS coordinates
            const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800&origin=*`;
            
            const imageResponse = await fetch(imageInfoUrl);
            if (!imageResponse.ok) continue;
            
            const imageData = await imageResponse.json();
            const pages = imageData.query?.pages;
            
            if (pages) {
              const pageId = Object.keys(pages)[0];
              const imageInfo = pages[pageId]?.imageinfo?.[0];
              
              if (imageInfo && imageInfo.url) {
                // Check image dimensions (minimum 500px)
                const width = imageInfo.width || 0;
                const height = imageInfo.height || 0;
                
                if (width >= 500 && height >= 500) {
                  // Perform geographic validation
                  const geoValidation = await performGeographicValidation(
                    imageInfo.extmetadata || {},
                    city,
                    state,
                    country
                  );
                  
                  // Log validation results
                  if (geoValidation.hasGPS) {
                    console.log(`📍 Image GPS: ${geoValidation.imageCoordinates?.lat}, ${geoValidation.imageCoordinates?.lng}`);
                    console.log(`📍 Image location: ${geoValidation.imageLocation?.city}, ${geoValidation.imageLocation?.state}, ${geoValidation.imageLocation?.country}`);
                    console.log(`📍 Location match: ${geoValidation.isLocationMatch} (${geoValidation.matchLevel})`);
                  } else {
                    console.log(`📍 No GPS data in image metadata`);
                  }
                  
                  // Process image with optimization
                  const optimization = await processImageWithOptimization(
                    imageInfo.url,
                    width,
                    height,
                    geoValidation
                  );
                  
                  if (optimization.shouldAccept) {
                    console.log(`✅ Found suitable Wikimedia image: ${imageInfo.url} (${width}x${height})`);
                    console.log(`🎯 Optimized URL: ${optimization.optimizedUrl}`);
                    console.log(`🖼️ Thumbnail URL: ${optimization.thumbnailUrl}`);
                    
                    return {
                      success: true,
                      imageUrl: imageInfo.url,
                      optimizedImageUrl: optimization.optimizedUrl,
                      thumbnailUrl: optimization.thumbnailUrl,
                      imageSource: 'wikimedia',
                      processingTime: Date.now() - startTime,
                      sourcesTried: ['Wikimedia Commons'],
                      imageDimensions: { width, height },
                      geoValidation
                    };
                  } else {
                    console.log(`❌ Image rejected due to location mismatch: ${geoValidation.imageLocation?.city}, ${geoValidation.imageLocation?.state} vs ${city}, ${state}`);
                    continue; // Continue to next result
                  }
                } else {
                  console.log(`❌ Image too small: ${width}x${height} (minimum 500x500)`);
                  continue; // Continue to next result
                }
              }
            }
            
            // Wait a bit between image checks
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        // If it's a category search, try to get images from the category
        if (query.startsWith('Category:')) {
          const categoryUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=${encodeURIComponent(query)}&cmnamespace=6&cmlimit=10&origin=*`;
          
          const catResponse = await fetch(categoryUrl);
          if (catResponse.ok) {
            const catData = await catResponse.json();
            
            if (catData.query && catData.query.categorymembers && catData.query.categorymembers.length > 0) {
              // Try multiple images from the category, not just the first one
              for (const categoryImage of catData.query.categorymembers.slice(0, 5)) { // Try up to 5 images
                const fileName = categoryImage.title.replace('File:', '');
                
                // Skip if it's clearly not an image format
                if (!isValidImageFormat('', fileName)) {
                  console.log(`⏭️ Skipping non-image file in category: ${fileName}`);
                  continue; // Continue to next image in category
                }
                
                const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:${encodeURIComponent(fileName)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800&origin=*`;
                
                const imageResponse = await fetch(imageInfoUrl);
                if (!imageResponse.ok) continue;
                
                const imageData = await imageResponse.json();
                const pages = imageData.query?.pages;
                
                if (pages) {
                  const pageId = Object.keys(pages)[0];
                  const imageInfo = pages[pageId]?.imageinfo?.[0];
                  
                  if (imageInfo && imageInfo.url) {
                    const width = imageInfo.width || 0;
                    const height = imageInfo.height || 0;
                    
                    if (width >= 500 && height >= 500) {
                      // Perform geographic validation for category images
                      const geoValidation = await performGeographicValidation(
                        imageInfo.extmetadata || {},
                        city,
                        state,
                        country
                      );
                      
                      // Log validation results
                      if (geoValidation.hasGPS) {
                        console.log(`📍 Category image GPS: ${geoValidation.imageCoordinates?.lat}, ${geoValidation.imageCoordinates?.lng}`);
                        console.log(`📍 Category image location: ${geoValidation.imageLocation?.city}, ${geoValidation.imageLocation?.state}, ${geoValidation.imageLocation?.country}`);
                        console.log(`📍 Category location match: ${geoValidation.isLocationMatch} (${geoValidation.matchLevel})`);
                      } else {
                        console.log(`📍 No GPS data in category image metadata`);
                      }
                      
                      // Process category image with optimization
                      const optimization = await processImageWithOptimization(
                        imageInfo.url,
                        width,
                        height,
                        geoValidation
                      );
                      
                      if (optimization.shouldAccept) {
                        console.log(`✅ Found suitable category image: ${imageInfo.url} (${width}x${height})`);
                        console.log(`🎯 Optimized URL: ${optimization.optimizedUrl}`);
                        console.log(`🖼️ Thumbnail URL: ${optimization.thumbnailUrl}`);
                        
                        return {
                          success: true,
                          imageUrl: imageInfo.url,
                          optimizedImageUrl: optimization.optimizedUrl,
                          thumbnailUrl: optimization.thumbnailUrl,
                          imageSource: 'wikimedia',
                          processingTime: Date.now() - startTime,
                          sourcesTried: ['Wikimedia Commons'],
                          imageDimensions: { width, height },
                          geoValidation
                        };
                      } else {
                        console.log(`❌ Category image rejected due to location mismatch: ${geoValidation.imageLocation?.city}, ${geoValidation.imageLocation?.state} vs ${city}, ${state}`);
                        continue; // Continue to next image in category
                      }
                    } else {
                      console.log(`❌ Category image too small: ${width}x${height} (minimum 500x500)`);
                      continue; // Continue to next image in category
                    }
                  }
                }
                
                // Wait a bit between category image checks
                await new Promise(resolve => setTimeout(resolve, 200));
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
      error: 'No suitable Wikimedia images found (minimum 500x500px)',
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
      processor: () => processWikimediaImages(attractionId, attractionName, city, state, country)
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
        optimizedImageUrl: result.optimizedImageUrl,
        thumbnailUrl: result.thumbnailUrl,
        imageSource: result.imageSource,
        processingTime: result.processingTime,
        sourcesTried: result.sourcesTried,
        error: result.error,
        geoValidation: result.geoValidation
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
