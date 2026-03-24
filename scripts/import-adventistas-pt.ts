import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Generates a deterministic UUID based on the same logic as the database function
 * homolog.generate_poi_uuid_simple
 */
function generatePoiUuid(osmId: number, osmType: string, name: string): string {
  const namespaceUuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const inputString = `osm:${osmId || 0}:${osmType || 'unknown'}:${name || 'Unnamed POI'}`;
  const combinedString = `${namespaceUuid}:${inputString}`;
  
  // Create MD5 hash
  const hash = crypto.createHash('md5').update(combinedString).digest('hex');
  
  // Format as UUID v3 (as per the SQL logic)
  // md5_hash is 32 chars
  // result_uuid := substring(md5_hash, 1, 8) || '-' || substring(md5_hash, 9, 4) || '-' || '3' || substring(md5_hash, 14, 3) || '-' || variant_char || substring(md5_hash, 18, 3) || '-' || substring(md5_hash, 21, 12);
  
  const part1 = hash.substring(0, 8);
  const part2 = hash.substring(8, 12);
  const part3 = '3' + hash.substring(13, 16);
  
  let variantChar = hash.substring(16, 17);
  if (!['8', '9', 'a', 'b'].includes(variantChar.toLowerCase())) {
    if (['0', '1', '2', '3'].includes(variantChar)) variantChar = '8';
    else if (['4', '5', '6', '7'].includes(variantChar)) variantChar = '9';
    else if (['c', 'd'].includes(variantChar.toLowerCase())) variantChar = 'a';
    else variantChar = 'b';
  }
  
  const part4 = variantChar + hash.substring(17, 20);
  const part5 = hash.substring(20, 32);
  
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

async function importData() {
  console.log('🚀 Starting import of Adventist Churches to homolog.pois...');
  
  try {
    // 1. Fetch data from API
    console.log('📡 Fetching latest data from api.adventistas.pt...');
    const response = await fetch('https://api.adventistas.pt/igrejas');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const churches = await response.json();
    console.log(`✅ Found ${churches.length} churches.`);

    let successCount = 0;
    let errorCount = 0;

    for (const church of churches) {
      const osmId = null; // Set to null to let system find real OSM equivalent or avoid ID mismatches
      const osmType = 'node'; // Use standard 'node' to satisfy core.attractions constraint
      const name = church.name.toLowerCase().includes('adventista') 
        ? church.name 
        : `Igreja Adventista do Sétimo Dia - ${church.name}`;
      
      const uuidId = generatePoiUuid(church.id, 'adventista_pt', name); // Keep identifying with API ID for UUID consistency
      
      console.log(`Processing [${church.id}] ${church.name} -> ${uuidId}`);

      // Prepare POI data exactly as per the provided schema
      const poiData = {
        uuid_id: uuidId,
        name: name,
        city: church.city,
        state: church.region?.name || 'Portugal',
        country: church.country || 'Portugal',
        category: 'amenity=place_of_worship',
        lat: church.lat,
        lon: church.lng,
        osm_id: osmId,
        osm_type: osmType,
        formatted_address: church.address ? `${church.address}, ${church.zipcode || ''} ${church.city || ''}` : null,
        source_file: 'api.adventistas.pt',
        source_type: 'api',
        is_complete: !!(name && church.city),
        processing_status: 'completed',
        approved: true, 
        description: church.schedule || church.name,
        website: church.website,
        postal_code: church.zipcode,
        primary_category: 'place_of_worship',
        categories: JSON.stringify(['place_of_worship', 'church']), // Ensure it's JSONB compatible
        denomination: 'seventh_day_adventist',
        osm_properties: {
          ...church,
          import_source: 'adventistas_pt_scraper'
        }
      };

      // 2. Insert into homolog.pois
      const { error: poiError } = await supabase
        .schema('homolog')
        .from('pois')
        .upsert(poiData, { onConflict: 'uuid_id' });

      if (poiError) {
        console.error(`❌ Error inserting POI ${church.name}:`, poiError.message);
        errorCount++;
        continue;
      }

      // 3. Insert into homolog.coordinates
      const coordinateData = {
        poi_uuid_id: uuidId,
        latitude: church.lat,
        longitude: church.lng,
        boundary_type: 'point',
        boundary_source: 'manual',
        show_in_map: true
      };

      const { error: coordError } = await supabase
        .schema('homolog')
        .from('coordinates')
        .upsert(coordinateData, { onConflict: 'poi_uuid_id' });

      if (coordError) {
        console.error(`❌ Error inserting coordinates for ${church.name}:`, coordError.message);
        errorCount++;
      } else {
        successCount++;
      }
    }

    console.log(`\n✨ Import completed!`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    
  } catch (error) {
    console.error('💥 Critical error during import:', error);
  }
}

importData();
