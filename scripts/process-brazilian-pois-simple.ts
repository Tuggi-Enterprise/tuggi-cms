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

async function loadBrazilianPOIs(limit: number = 10): Promise<BrazilianPOI[]> {
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

async function processPOIWithUnifiedSystem(poi: BrazilianPOI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Processing with unified system: ${poi.name} (${poi.city}, ${poi.state})`);
    
    // Use the unified image processing Edge Function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/unified-image-processing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        city: poi.city,
        state: poi.state,
        country: poi.country
      })
    });

    if (!response.ok) {
      throw new Error(`Unified system error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      return {
        success: true,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        newImageSource: data.imageSource,
        newImageUrl: data.imageUrl,
        processingTime: Date.now() - startTime
      };
    } else {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source || undefined,
        error: data.error || 'No images found',
        processingTime: Date.now() - startTime
      };
    }
    
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source || undefined,
      error: `Unified system error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processingTime: Date.now() - startTime
    };
  }
}

async function main() {
  console.log('🇧🇷 Processing Brazilian POIs with Unified System');
  console.log('===============================================\n');
  console.log('📋 Priority: Website > Wikipedia > Wikidata > Other sources\n');

  try {
    // Load Brazilian POIs
    const pois = await loadBrazilianPOIs(8);
    
    if (pois.length === 0) {
      console.log('❌ No Brazilian POIs found in database');
      return;
    }

    console.log(`\n🎯 Processing ${pois.length} Brazilian POIs:\n`);
    
    const results: ProcessingResult[] = [];
    
    for (const poi of pois) {
      console.log(`📍 POI: ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'none'})`);
      if (poi.website) console.log(`   Website: ${poi.website}`);
      if (poi.osm_tags?.wikidata) console.log(`   Wikidata: ${poi.osm_tags.wikidata}`);
      if (poi.osm_tags?.wikipedia) console.log(`   Wikipedia: ${poi.osm_tags.wikipedia}`);
      
      const result = await processPOIWithUnifiedSystem(poi);
      results.push(result);
      
      if (result.success) {
        console.log(`   ✅ Success: ${result.newImageSource} - ${result.newImageUrl}`);
        console.log(`   ⏱️  Processing time: ${result.processingTime}ms`);
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
      }
      
      console.log('');
      
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
