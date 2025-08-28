import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface EnrichmentRequest {
  poi_id: string;
  name: string;
  city: string;
  country: string;
  google_place_id?: string;
}

interface OSMData {
  nominatim?: any;
  reverse?: any;
  overpass?: any;
}

export async function POST(request: NextRequest) {
  try {
    const body: EnrichmentRequest = await request.json();
    const { poi_id, name, city, country, google_place_id } = body;

    console.log(`🔄 Starting OSM enrichment for POI: ${name} (${city}, ${country})`);

    // Step 1: Fetch OSM data using multiple APIs
    const osmData = await fetchOSMData(name, city, country);
    
    if (!osmData.nominatim && !osmData.reverse) {
      return NextResponse.json({
        success: false,
        message: 'No OSM data found for this POI',
        poi_id,
        errors: ['No data found in Nominatim or Reverse Geocoding']
      });
    }

    // Step 2: Process and extract relevant information
    const extractedData = extractOSMData(osmData, name, city, country);
    
    // Step 3: Calculate quality score
    const qualityScore = calculateQualityScore(extractedData);
    
    // Step 4: Update database
    const updateResult = await updatePOIWithOSMData(poi_id, extractedData, qualityScore);

    if (!updateResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Failed to update database',
        poi_id,
        errors: [updateResult.error]
      });
    }

    console.log(`✅ Successfully enriched POI: ${name} (Quality: ${qualityScore}%)`);

    return NextResponse.json({
      success: true,
      message: 'POI enriched successfully',
      poi_id,
      data_quality_score: qualityScore,
      fields_updated: updateResult.fields_updated,
      osm_data: {
        has_nominatim: !!osmData.nominatim,
        has_reverse: !!osmData.reverse,
        has_overpass: !!osmData.overpass
      }
    });

  } catch (error) {
    console.error('❌ Error in OSM enrichment:', error);
    return NextResponse.json({
      success: false,
      message: 'Internal server error',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    }, { status: 500 });
  }
}

async function fetchOSMData(name: string, city: string, country: string): Promise<OSMData> {
  const osmData: OSMData = {};
  
  try {
    // 1. Nominatim search (by name)
    console.log(`🔍 Searching Nominatim for: ${name}, ${city}, ${country}`);
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${name}, ${city}, ${country}`)}&format=json&limit=1&addressdetails=1&extratags=1`;
    
    const nominatimResponse = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.com)'
      }
    });
    
    if (nominatimResponse.ok) {
      const nominatimData = await nominatimResponse.json();
      if (nominatimData && nominatimData.length > 0) {
        osmData.nominatim = nominatimData[0];
        console.log(`✅ Found Nominatim data for: ${name}`);
      }
    }

    // Add delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Reverse geocoding (if we have coordinates from Nominatim)
    if (osmData.nominatim?.lat && osmData.nominatim?.lon) {
      console.log(`🔍 Reverse geocoding for coordinates: ${osmData.nominatim.lat}, ${osmData.nominatim.lon}`);
      const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${osmData.nominatim.lat}&lon=${osmData.nominatim.lon}&format=json&addressdetails=1&extratags=1`;
      
      const reverseResponse = await fetch(reverseUrl, {
        headers: {
          'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.com)'
        }
      });
      
      if (reverseResponse.ok) {
        const reverseData = await reverseResponse.json();
        osmData.reverse = reverseData;
        console.log(`✅ Found reverse geocoding data`);
      }
    }

    // Add delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Overpass API (for additional details)
    if (osmData.nominatim?.lat && osmData.nominatim?.lon) {
      console.log(`🔍 Querying Overpass API for nearby features`);
      const overpassQuery = `
        [out:json][timeout:25];
        (
          node["tourism"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
          way["tourism"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
          relation["tourism"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
        );
        out body;
        >;
        out skel qt;
      `;
      
      const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
      
      try {
        const overpassResponse = await fetch(overpassUrl);
        if (overpassResponse.ok) {
          const overpassData = await overpassResponse.json();
          osmData.overpass = overpassData;
          console.log(`✅ Found ${overpassData.elements?.length || 0} Overpass elements`);
        }
      } catch (overpassError) {
        console.warn(`⚠️ Overpass API error (non-critical):`, overpassError);
      }
    }

  } catch (error) {
    console.error('❌ Error fetching OSM data:', error);
  }

  return osmData;
}

function extractOSMData(osmData: OSMData, name: string, city: string, country: string) {
  const nominatim = osmData.nominatim;
  const reverse = osmData.reverse;
  const overpass = osmData.overpass;

  const extractedData: any = {
    // Basic OSM data
    osm_category: nominatim?.class || reverse?.class,
    osm_tags: {
      ...nominatim?.extratags,
      ...reverse?.extratags,
      name: nominatim?.name || reverse?.name,
      address: nominatim?.address || reverse?.address
    },
    osm_geometry: nominatim?.geojson || null,
    osm_last_updated: new Date().toISOString(),

    // Geographic data
    elevation_m: nominatim?.extratags?.ele ? parseInt(nominatim.extratags.ele) : null,
    estimated_height_m: nominatim?.extratags?.height ? parseFloat(nominatim.extratags.height) : null,
    osm_area_m2: nominatim?.extratags?.area ? parseInt(nominatim.extratags.area) : null,

    // Heritage and cultural data
    heritage_status: determineHeritageStatus(nominatim, reverse),
    unesco_status: determineUNESCOStatus(nominatim, reverse),
    landmark_level: determineLandmarkLevel(nominatim, reverse),
    importance_level: determineImportanceLevel(nominatim, reverse),
    architect: nominatim?.extratags?.architect || reverse?.extratags?.architect,
    architectural_style: determineArchitecturalStyle(nominatim, reverse),
    historical_period: determineHistoricalPeriod(nominatim, reverse),
    landmark_type: determineLandmarkType(nominatim, reverse),

    // Accessibility data
    wheelchair_accessible: determineWheelchairAccess(nominatim, reverse),
    wheelchair_toilets: nominatim?.extratags?.['toilets:wheelchair'] === 'yes',
    parking_capacity: determineParkingCapacity(nominatim, reverse),
    public_transport: determinePublicTransport(nominatim, reverse, overpass),
    access_points: determineAccessPoints(nominatim, reverse),

    // Environmental data
    urban_density: determineUrbanDensity(nominatim, reverse),
    noise_level: determineNoiseLevel(nominatim, reverse),
    air_quality: determineAirQuality(nominatim, reverse),
    shade_availability: determineShadeAvailability(nominatim, reverse),

    // Cultural data
    cultural_significance: determineCulturalSignificance(nominatim, reverse),
    local_traditions: determineLocalTraditions(nominatim, reverse),
    seasonal_attractions: determineSeasonalAttractions(nominatim, reverse),

    // Type-specific data
    museum_type: determineMuseumType(nominatim, reverse),
    park_type: determineParkType(nominatim, reverse),
    monument_type: determineMonumentType(nominatim, reverse),

    // Physical characteristics
    building_colour: nominatim?.extratags?.['building:colour'],
    roof_colour: nominatim?.extratags?.['roof:colour'],
    building_material: nominatim?.extratags?.['building:material'],

    // Metadados
    verification_status: 'pending',
    data_sources: ['osm_nominatim', 'osm_reverse'],
    osm_import_date: new Date().toISOString()
  };

  // Add Overpass data if available
  if (overpass?.elements) {
    extractedData.data_sources.push('osm_overpass');
  }

  return extractedData;
}

function calculateQualityScore(data: any): number {
  let score = 50; // Base score

  // Points for OSM tags
  if (data.osm_tags) {
    const tagCount = Object.keys(data.osm_tags).length;
    score += Math.min(tagCount * 2, 20); // Max 20 points for tags
  }

  // Points for heritage status
  if (data.heritage_status === 'unesco_world_heritage') score += 15;
  else if (data.heritage_status === 'national_heritage') score += 10;
  else if (data.heritage_status === 'local_heritage') score += 5;

  // Points for UNESCO status
  if (data.unesco_status === 'world_heritage_site') score += 10;

  // Points for landmark level
  if (data.landmark_level) score += Math.min(data.landmark_level, 10);

  // Points for architect information
  if (data.architect) score += 5;

  // Points for accessibility data
  if (data.wheelchair_accessible !== null) score += 3;
  if (data.parking_capacity) score += 2;
  if (data.public_transport?.length > 0) score += 3;

  // Points for cultural data
  if (data.cultural_significance) score += 3;
  if (data.local_traditions?.length > 0) score += 2;

  // Points for type-specific data
  if (data.museum_type || data.park_type || data.monument_type) score += 3;

  // Ensure score is within valid range for numeric(3,2) field (0-9.99)
  return Math.min(Math.max(score, 0), 9.99);
}

async function updatePOIWithOSMData(poi_id: string, data: any, qualityScore: number) {
  try {
    // Calculate POV scores based on available data
    const povScores = calculatePOVScores(data, qualityScore);

    const updateData = {
      ...data,
      osm_data_quality_score: qualityScore,
      ...povScores
    };

    const { error } = await supabase
      .schema('core')
      .from('attractions')
      .update(updateData)
      .eq('id', poi_id);

    if (error) {
      console.error('❌ Database update error:', error);
      return { success: false, error: error.message };
    }

    const fields_updated = Object.keys(updateData).filter(key => 
      updateData[key] !== null && updateData[key] !== undefined
    );

    return { success: true, fields_updated };

  } catch (error) {
    console.error('❌ Error updating POI:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function calculatePOVScores(data: any, qualityScore: number) {
  // Base POV scores on quality score and available data
  let povQualityScore = qualityScore;
  let visibilityScore = 70;
  let accessibilityScore = 70;
  let photogenicScore = 70;

  // Adjust based on heritage status
  if (data.heritage_status === 'unesco_world_heritage') {
    povQualityScore += 10;
    visibilityScore += 15;
    photogenicScore += 15;
  } else if (data.heritage_status === 'national_heritage') {
    povQualityScore += 5;
    visibilityScore += 10;
    photogenicScore += 10;
  }

  // Adjust based on accessibility
  if (data.wheelchair_accessible) accessibilityScore += 10;
  if (data.public_transport?.length > 0) accessibilityScore += 5;

  // Adjust based on cultural significance
  if (data.cultural_significance === 'very_high') {
    povQualityScore += 10;
    photogenicScore += 10;
  }

  // Adjust based on urban density
  if (data.urban_density === 'dense' || data.urban_density === 'very_dense') {
    visibilityScore += 5;
  }

  // Ensure all scores are within valid range for numeric(3,2) field (0-9.99)
  return {
    pov_quality_score: Math.min(Math.max(povQualityScore, 0), 9.99),
    visibility_score: Math.min(Math.max(visibilityScore, 0), 9.99),
    accessibility_score: Math.min(Math.max(accessibilityScore, 0), 9.99),
    photogenic_score: Math.min(Math.max(photogenicScore, 0), 9.99)
  };
}

// Helper functions for determining various characteristics
function determineHeritageStatus(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags['whc:inscription_date']) return 'unesco_world_heritage';
  if (tags.heritage === '1') return 'national_heritage';
  if (tags.heritage === '2') return 'regional_heritage';
  if (tags.heritage === '3') return 'local_heritage';
  
  return null;
}

function determineUNESCOStatus(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags['whc:inscription_date']) return 'world_heritage_site';
  if (tags['ref:whc']) return 'tentative_list';
  
  return 'none';
}

function determineLandmarkLevel(nominatim: any, reverse: any): number | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.landmark) return parseInt(tags.landmark);
  if (tags.importance) {
    const importance = tags.importance;
    if (importance === 'international') return 10;
    if (importance === 'national') return 8;
    if (importance === 'regional') return 6;
    if (importance === 'local') return 4;
  }
  
  return null;
}

function determineImportanceLevel(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags['whc:inscription_date']) return 'global';
  if (tags.importance) return tags.importance;
  if (tags.heritage === '1') return 'national';
  if (tags.heritage === '2') return 'regional';
  if (tags.heritage === '3') return 'local';
  
  return 'local';
}

function determineArchitecturalStyle(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags.architectural_style || tags.style || null;
}

function determineHistoricalPeriod(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags.start_date || tags.built || tags.construction_date || null;
}

function determineLandmarkType(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.tourism === 'museum') return 'museum';
  if (tags.leisure === 'park') return 'park';
  if (tags.historic === 'monument') return 'monument';
  if (tags.amenity === 'place_of_worship') return 'religious';
  
  return tags.tourism || tags.leisure || tags.historic || tags.amenity || null;
}

function determineWheelchairAccess(nominatim: any, reverse: any): boolean | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.wheelchair === 'yes') return true;
  if (tags.wheelchair === 'no') return false;
  
  return null;
}

function determineParkingCapacity(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags['parking:capacity']) {
    const capacity = parseInt(tags['parking:capacity']);
    if (capacity > 100) return 'very_large';
    if (capacity > 50) return 'large';
    if (capacity > 20) return 'medium';
    if (capacity > 5) return 'small';
    return 'none';
  }
  
  return null;
}

function determinePublicTransport(nominatim: any, reverse: any, overpass: any): string[] | null {
  const transport: string[] = [];
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  // Check for nearby transport in tags
  if (tags['public_transport']) transport.push('public_transport');
  if (tags['railway']) transport.push('train');
  if (tags['highway'] === 'bus_stop') transport.push('bus');
  if (tags['highway'] === 'station') transport.push('train');
  
  // Check Overpass data for nearby transport
  if (overpass?.elements) {
    overpass.elements.forEach((element: any) => {
      if (element.tags) {
        if (element.tags.railway === 'station') transport.push('train');
        if (element.tags.highway === 'bus_stop') transport.push('bus');
        if (element.tags.amenity === 'subway_entrance') transport.push('metro');
      }
    });
  }
  
  return transport.length > 0 ? [...new Set(transport)] : null;
}

function determineAccessPoints(nominatim: any, reverse: any): string[] | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  const accessPoints: string[] = [];
  if (tags.entrance) accessPoints.push('main_entrance');
  if (tags['entrance:secondary']) accessPoints.push('secondary_entrance');
  
  return accessPoints.length > 0 ? accessPoints : null;
}

function determineUrbanDensity(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.landuse === 'residential') return 'dense';
  if (tags.landuse === 'commercial') return 'very_dense';
  if (tags.landuse === 'rural') return 'rural';
  
  return 'medium';
}

function determineNoiseLevel(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags['highway']) return 'high';
  if (tags.landuse === 'residential') return 'low';
  if (tags.landuse === 'commercial') return 'moderate';
  
  return 'moderate';
}

function determineAirQuality(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.landuse === 'park') return 'excellent';
  if (tags.landuse === 'residential') return 'good';
  if (tags.landuse === 'commercial') return 'moderate';
  
  return 'good';
}

function determineShadeAvailability(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.leisure === 'park') return 'full';
  if (tags.landuse === 'forest') return 'full';
  if (tags.building) return 'partial';
  
  return 'partial';
}

function determineCulturalSignificance(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags['whc:inscription_date']) return 'very_high';
  if (tags.heritage === '1') return 'high';
  if (tags.heritage === '2') return 'medium';
  if (tags.heritage === '3') return 'low';
  
  return 'medium';
}

function determineLocalTraditions(nominatim: any, reverse: any): string[] | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  const traditions: string[] = [];
  if (tags.tourism === 'museum') traditions.push('cultural_education');
  if (tags.amenity === 'place_of_worship') traditions.push('religious_practices');
  if (tags.leisure === 'park') traditions.push('recreational_activities');
  
  return traditions.length > 0 ? traditions : null;
}

function determineSeasonalAttractions(nominatim: any, reverse: any): string[] | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  const attractions: string[] = [];
  if (tags.tourism === 'museum') attractions.push('year_round');
  if (tags.leisure === 'park') attractions.push('seasonal_events');
  
  return attractions.length > 0 ? attractions : null;
}

function determineMuseumType(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.tourism === 'museum') {
    if (tags['museum:type'] === 'art') return 'art';
    if (tags['museum:type'] === 'history') return 'history';
    if (tags['museum:type'] === 'science') return 'science';
    return 'general';
  }
  
  return null;
}

function determineParkType(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.leisure === 'park') {
    if (tags['park:type'] === 'national') return 'national';
    if (tags['park:type'] === 'state') return 'state';
    if (tags['park:type'] === 'municipal') return 'municipal';
    return 'urban';
  }
  
  return null;
}

function determineMonumentType(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.historic === 'monument') {
    if (tags['monument:type'] === 'statue') return 'statue';
    if (tags['monument:type'] === 'memorial') return 'memorial';
    return 'monument';
  }
  
  return null;
}
