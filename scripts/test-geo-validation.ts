import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TestPOI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
}

// Test POIs with known Wikimedia images
const testPOIs: TestPOI[] = [
  {
    id: "test-1",
    name: "Cristo Redentor",
    city: "Rio de Janeiro",
    state: "RJ",
    country: "BR"
  },
  {
    id: "test-2", 
    name: "Museu do Ipiranga",
    city: "São Paulo",
    state: "SP",
    country: "BR"
  },
  {
    id: "test-3",
    name: "Pelourinho",
    city: "Salvador",
    state: "BA", 
    country: "BR"
  }
];

async function testGeographicValidation() {
  console.log('🧪 Testing Geographic Validation Implementation');
  console.log('=' .repeat(60));
  
  for (const poi of testPOIs) {
    console.log(`\n📍 Testing: ${poi.name} (${poi.city}, ${poi.state})`);
    console.log('-'.repeat(50));
    
    try {
      // Call the unified-image-processing Edge Function
      const { data, error } = await supabase.functions.invoke('unified-image-processing', {
        body: {
          attractionId: poi.id,
          attractionName: poi.name,
          city: poi.city,
          state: poi.state,
          country: poi.country
        }
      });
      
      if (error) {
        console.error(`❌ Error: ${error.message}`);
        continue;
      }
      
      if (data.success) {
        console.log(`✅ Success: ${data.imageUrl}`);
        console.log(`📊 Processing time: ${data.processingTime}ms`);
        console.log(`📐 Dimensions: ${data.imageDimensions?.width}x${data.imageDimensions?.height}`);
        
        if (data.geoValidation) {
          const geo = data.geoValidation;
          console.log(`📍 Geographic Validation:`);
          console.log(`   - Has GPS: ${geo.hasGPS}`);
          
          if (geo.hasGPS) {
            console.log(`   - Image coordinates: ${geo.imageCoordinates?.lat}, ${geo.imageCoordinates?.lng}`);
            console.log(`   - Image location: ${geo.imageLocation?.city}, ${geo.imageLocation?.state}, ${geo.imageLocation?.country}`);
            console.log(`   - Location match: ${geo.isLocationMatch} (${geo.matchLevel})`);
          }
        }
      } else {
        console.log(`❌ Failed: ${data.error}`);
        console.log(`📊 Sources tried: ${data.sourcesTried?.join(', ')}`);
      }
      
      // Wait between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`💥 Exception: ${error.message}`);
    }
  }
  
  console.log('\n🏁 Geographic validation testing completed!');
}

// Run the test
testGeographicValidation().catch(console.error);

