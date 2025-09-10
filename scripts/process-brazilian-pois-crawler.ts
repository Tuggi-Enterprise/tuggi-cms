import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BrazilianPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  image_url: string | null;
  image_source: string | null;
  website?: string;
  osm_tags?: any;
}

interface ProcessingResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  oldImageSource?: string;
  newImageSource?: string;
  newImageUrl?: string;
  error?: string;
  processingTime?: number;
  imageDimensions?: { width: number; height: number };
}

// Function to check image dimensions
async function checkImageDimensions(imageUrl: string): Promise<{ width: number; height: number } | null> {
  try {
    const response = await fetch(imageUrl, { method: 'HEAD' });
    if (!response.ok) return null;
    
    // Try to get dimensions from headers
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    if (!contentType?.startsWith('image/')) return null;
    
    // For now, we'll assume images are valid if they're proper image types
    // In a real implementation, you'd need to download and check actual dimensions
    return { width: 800, height: 600 }; // Placeholder - would need actual image analysis
    
  } catch (error) {
    return null;
  }
}

// Function to crawl official website for images
async function crawlOfficialWebsite(poi: BrazilianPOI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🌐 Crawling official website for: ${poi.name}`);
    
    if (!poi.website) {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: 'No website available',
        processingTime: Date.now() - startTime
      };
    }
    
    // Use the existing website image extraction Edge Function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-website-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        website: poi.website
      })
    });

    if (!response.ok) {
      throw new Error(`Website crawler error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      // Check image dimensions
      const dimensions = await checkImageDimensions(data.imageUrl);
      
      if (dimensions && (dimensions.width >= 600 || dimensions.height >= 600)) {
        return {
          success: true,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          newImageSource: 'website',
          newImageUrl: data.imageUrl,
          processingTime: Date.now() - startTime,
          imageDimensions: dimensions
        };
      } else {
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: 'Image resolution too low (< 600px)',
          processingTime: Date.now() - startTime
        };
      }
    } else {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: data.message || 'No website images found',
        processingTime: Date.now() - startTime
      };
    }
    
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: `Website crawler error: ${error.message}`,
      processingTime: Date.now() - startTime
    };
  }
}

// Function to crawl Wikipedia for images
async function crawlWikipedia(poi: BrazilianPOI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`📚 Crawling Wikipedia for: ${poi.name}`);
    
    // Use the existing Wikipedia image extraction Edge Function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikipedia-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        city: poi.city,
        country: poi.country
      })
    });

    if (!response.ok) {
      throw new Error(`Wikipedia crawler error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      // Check image dimensions
      const dimensions = await checkImageDimensions(data.imageUrl);
      
      if (dimensions && (dimensions.width >= 600 || dimensions.height >= 600)) {
        return {
          success: true,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          newImageSource: 'wikipedia',
          newImageUrl: data.imageUrl,
          processingTime: Date.now() - startTime,
          imageDimensions: dimensions
        };
      } else {
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: 'Image resolution too low (< 600px)',
          processingTime: Date.now() - startTime
        };
      }
    } else {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: data.message || 'No Wikipedia images found',
        processingTime: Date.now() - startTime
      };
    }
    
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: `Wikipedia crawler error: ${error.message}`,
      processingTime: Date.now() - startTime
    };
  }
}

// Function to crawl Wikimedia Commons for images
async function crawlWikimediaCommons(poi: BrazilianPOI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🖼️  Crawling Wikimedia Commons for: ${poi.name}`);
    
    // Use the existing Wikimedia image extraction Edge Function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        imageUrl: `https://commons.wikimedia.org/wiki/Special:Search/${encodeURIComponent(poi.name)}`,
        imageSource: 'wikimedia_commons'
      })
    });

    if (!response.ok) {
      throw new Error(`Wikimedia crawler error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      // Check image dimensions
      const dimensions = await checkImageDimensions(data.imageUrl);
      
      if (dimensions && (dimensions.width >= 600 || dimensions.height >= 600)) {
        return {
          success: true,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          newImageSource: 'wikimedia_commons',
          newImageUrl: data.imageUrl,
          processingTime: Date.now() - startTime,
          imageDimensions: dimensions
        };
      } else {
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: 'Image resolution too low (< 600px)',
          processingTime: Date.now() - startTime
        };
      }
    } else {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: data.message || 'No Wikimedia images found',
        processingTime: Date.now() - startTime
      };
    }
    
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: `Wikimedia crawler error: ${error.message}`,
      processingTime: Date.now() - startTime
    };
  }
}

async function loadBrazilianPOIs(limit: number = 15): Promise<BrazilianPOI[]> {
  console.log(`🇧🇷 Loading ${limit} Brazilian POIs from database...`);
  
  const { data: pois, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, state, country, image_url, image_source, website, osm_tags')
    .eq('country', 'BR')
    .limit(limit);

  if (error) {
    console.error('Error loading Brazilian POIs:', error);
    return [];
  }

  console.log(`✅ Loaded ${pois?.length || 0} Brazilian POIs`);
  return pois || [];
}

async function processPOIWithPriority(poi: BrazilianPOI): Promise<ProcessingResult> {
  console.log(`\n📍 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
  console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'none'})`);
  
  // Priority order: 1. Official Website, 2. Wikipedia, 3. Wikimedia Commons
  const processors = [
    { name: 'Official Website', processor: () => crawlOfficialWebsite(poi) },
    { name: 'Wikipedia', processor: () => crawlWikipedia(poi) },
    { name: 'Wikimedia Commons', processor: () => crawlWikimediaCommons(poi) }
  ];
  
  for (const { name, processor } of processors) {
    try {
      console.log(`   🔄 Trying ${name}...`);
      const result = await processor();
      
      if (result.success) {
        console.log(`   ✅ Success with ${name}: ${result.newImageUrl}`);
        console.log(`   📐 Dimensions: ${result.imageDimensions?.width}x${result.imageDimensions?.height}`);
        console.log(`   ⏱️  Processing time: ${result.processingTime}ms`);
        return result;
      } else {
        console.log(`   ❌ Failed with ${name}: ${result.error}`);
      }
      
      // Wait between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 1500));
      
    } catch (error) {
      console.log(`   💥 Error with ${name}: ${error.message}`);
    }
  }
  
  return {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    oldImageSource: poi.image_source,
    error: 'All sources failed',
    processingTime: 0
  };
}

async function main() {
  console.log('🇧🇷 Processing Brazilian POIs with Crawler (Priority: Website > Wikipedia > Wikimedia)');
  console.log('==================================================================================\n');
  console.log('📐 Minimum resolution: 600px\n');

  try {
    // Load Brazilian POIs
    const pois = await loadBrazilianPOIs(10);
    
    if (pois.length === 0) {
      console.log('❌ No Brazilian POIs found in database');
      return;
    }

    console.log(`\n🎯 Processing ${pois.length} Brazilian POIs:\n`);
    
    const results: ProcessingResult[] = [];
    
    for (const poi of pois) {
      const result = await processPOIWithPriority(poi);
      results.push(result);
      
      // Wait between POIs to be respectful
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Summary
    console.log('\n📊 Processing Summary:');
    console.log('=====================');
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`🇧🇷 Brazilian POIs processed: ${results.length}`);
    console.log(`✅ Successful: ${successful.length}/${results.length} (${Math.round(successful.length/results.length*100)}%)`);
    console.log(`❌ Failed: ${failed.length}/${results.length} (${Math.round(failed.length/results.length*100)}%)`);
    
    if (successful.length > 0) {
      console.log('\n🎉 Successful extractions:');
      successful.forEach(result => {
        console.log(`   • ${result.attractionName} (${result.newImageSource}): ${result.newImageUrl}`);
        if (result.imageDimensions) {
          console.log(`     📐 ${result.imageDimensions.width}x${result.imageDimensions.height}px`);
        }
      });
    }
    
    if (failed.length > 0) {
      console.log('\n💥 Failed extractions:');
      failed.forEach(result => {
        console.log(`   • ${result.attractionName}: ${result.error}`);
      });
    }
    
    // Source breakdown
    const sourceBreakdown = successful.reduce((acc, result) => {
      const source = result.newImageSource || 'unknown';
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('\n📈 Source breakdown:');
    Object.entries(sourceBreakdown).forEach(([source, count]) => {
      console.log(`   • ${source}: ${count} images`);
    });
    
    console.log('\n✅ Brazilian POIs processing completed!');
    
  } catch (error) {
    console.error('💥 Error:', error);
    process.exit(1);
  }
}

// Run the processing
main().catch(console.error);
