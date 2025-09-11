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
}

async function loadBrazilianPOIs(limit: number = 20): Promise<BrazilianPOI[]> {
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

async function processWikipediaImages(poi: BrazilianPOI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`📚 Processing Wikipedia images for: ${poi.name} (${poi.city}, ${poi.state})`);
    
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
      throw new Error(`Wikipedia API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      return {
        success: true,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        newImageSource: 'wikipedia',
        newImageUrl: data.imageUrl,
        processingTime: Date.now() - startTime
      };
    } else {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        error: data.message || 'No Wikipedia images found',
        processingTime: Date.now() - startTime
      };
    }
    
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source || undefined,
      error: `Wikipedia error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingTime: Date.now() - startTime
    };
  }
}

async function processWikidataImages(poi: BrazilianPOI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🔗 Processing Wikidata images for: ${poi.name}`);
    
    // Check if POI has Wikidata ID
    const wikidataId = poi.osm_tags?.wikidata;
    if (!wikidataId) {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        error: 'No Wikidata ID available',
        processingTime: Date.now() - startTime
      };
    }
    
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikidata-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        wikidataId: wikidataId
      })
    });

    if (!response.ok) {
      throw new Error(`Wikidata API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      return {
        success: true,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        newImageSource: 'wikidata',
        newImageUrl: data.imageUrl,
        processingTime: Date.now() - startTime
      };
    } else {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        error: data.message || 'No Wikidata images found',
        processingTime: Date.now() - startTime
      };
    }
    
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source || undefined,
      error: `Wikidata error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingTime: Date.now() - startTime
    };
  }
}

async function processWebsiteImages(poi: BrazilianPOI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🌐 Processing website images for: ${poi.name}`);
    
    if (!poi.website) {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        error: 'No website available',
        processingTime: Date.now() - startTime
      };
    }
    
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
      throw new Error(`Website API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      return {
        success: true,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        newImageSource: 'website',
        newImageUrl: data.imageUrl,
        processingTime: Date.now() - startTime
      };
    } else {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        error: data.message || 'No website images found',
        processingTime: Date.now() - startTime
      };
    }
    
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source || undefined,
      error: `Website error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingTime: Date.now() - startTime
    };
  }
}

async function processPOIWithPriority(poi: BrazilianPOI): Promise<ProcessingResult> {
  console.log(`\n📍 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
  console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'none'})`);
  
  // Priority order: Wikipedia > Wikidata > Website
  const processors = [
    { name: 'Wikipedia', processor: () => processWikipediaImages(poi) },
    { name: 'Wikidata', processor: () => processWikidataImages(poi) },
    { name: 'Website', processor: () => processWebsiteImages(poi) }
  ];
  
  for (const { name, processor } of processors) {
    try {
      console.log(`   🔄 Trying ${name}...`);
      const result = await processor();
      
      if (result.success) {
        console.log(`   ✅ Success with ${name}: ${result.newImageUrl}`);
        console.log(`   ⏱️  Processing time: ${result.processingTime}ms`);
        return result;
      } else {
        console.log(`   ❌ Failed with ${name}: ${result.error}`);
      }
      
      // Wait between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.log(`   💥 Error with ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  return {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    oldImageSource: poi.image_source || undefined,
    error: 'All sources failed',
    processingTime: 0
  };
}

async function main() {
  console.log('🇧🇷 Processing Brazilian POIs with Wikipedia & Wikimedia');
  console.log('=====================================================\n');

  try {
    // Load Brazilian POIs
    const pois = await loadBrazilianPOIs(15);
    
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
      await new Promise(resolve => setTimeout(resolve, 2000));
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
