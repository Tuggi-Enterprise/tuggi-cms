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
    const extractedData = await extractOSMData(osmData, name, city, country);
    
    // Step 3: Calculate quality score using OSM's native importance
    const osmImportance = osmData.nominatim?.importance || osmData.reverse?.importance;
    const qualityScore = calculateQualityScore(extractedData, osmImportance);
    
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
    console.log(`🔍 Fetching OSM data for: ${name} in ${city}, ${country}`);
    
    // Strategy 1: Try multiple search variations
    const searchTerms = [];
    
    // Add original name
    searchTerms.push(`${name}, ${city}, ${country}`);
    
    // Add specific variations for known POIs
    if (name.includes('Estádio Cícero Pompeu de Toledo - Morumbis')) {
      searchTerms.push('MorumBIS, São Paulo, Brazil');
      searchTerms.push('Estádio do Morumbi, São Paulo, Brazil');
      searchTerms.push('Arena Morumbi, São Paulo, Brazil');
    }
    
    // Add multiple language variations for international cities
    if (city.toLowerCase() === 'barcelona') {
      // Spanish → Catalan translations
      const spanishToCatalan = [
        { es: /Plaza de/gi, ca: 'Plaça de' },
        { es: /Plaza/gi, ca: 'Plaça' },
        { es: /Iglesia de/gi, ca: 'Església de' },
        { es: /Iglesia/gi, ca: 'Església' },
        { es: /Antiguo monasterio de/gi, ca: 'Monestir de' },
        { es: /Monasterio de/gi, ca: 'Monestir de' },
        { es: /San /gi, ca: 'Sant ' },
        { es: /Santa /gi, ca: 'Santa ' },
        { es: /del Campo/gi, ca: 'del Camp' },
        { es: /Museo/gi, ca: 'Museu' },
        { es: /Olímpico/gi, ca: 'Olímpic' },
        { es: /y del/gi, ca: 'i de l\'' },
        { es: /Deporte/gi, ca: 'Esport' }
      ];
      
      let catalanName = name;
      spanishToCatalan.forEach(({ es, ca }) => {
        catalanName = catalanName.replace(es, ca);
      });
      
      if (catalanName !== name) {
        searchTerms.push(`${catalanName}, ${city}, ${country}`);
      }
      
      // Add English variations
      let englishName = name;
      englishName = englishName.replace(/Plaza de/gi, 'Square of');
      englishName = englishName.replace(/Plaza/gi, 'Square');
      englishName = englishName.replace(/Iglesia de/gi, 'Church of');
      englishName = englishName.replace(/Iglesia/gi, 'Church');
      englishName = englishName.replace(/Museo/gi, 'Museum');
      englishName = englishName.replace(/Antiguo/gi, 'Old');
      englishName = englishName.replace(/monasterio/gi, 'monastery');
      
      if (englishName !== name) {
        searchTerms.push(`${englishName}, ${city}, ${country}`);
      }
      
      // Specific known translations and variations
      if (name.includes('Plaza de Gaudí') || name.includes('Gaudí')) {
        searchTerms.push('Plaça de Gaudí, Barcelona, Spain');
        searchTerms.push('Gaudí Square, Barcelona, Spain');
        searchTerms.push('Casa Museu Gaudí, Barcelona, Spain');
        searchTerms.push('Gaudí House Museum, Barcelona, Spain');
        searchTerms.push('Park Güell Gaudí, Barcelona, Spain');
      }
      
      if (name.includes('San Pau del Campo') || name.includes('Sant Pau')) {
        searchTerms.push('Sant Pau del Camp, Barcelona, Spain');
        searchTerms.push('Església de Sant Pau del Camp, Barcelona, Spain');
        searchTerms.push('Church of Sant Pau del Camp, Barcelona, Spain');
        searchTerms.push('Saint Paul of the Fields, Barcelona, Spain');
      }
      
      if (name.includes('San Medir') || name.includes('Sant Medir')) {
        searchTerms.push('Sant Medir, Barcelona, Spain');
        searchTerms.push('Església de Sant Medir, Barcelona, Spain');
        searchTerms.push('Church of Sant Medir, Barcelona, Spain');
        searchTerms.push('Saint Medir, Barcelona, Spain');
      }
      
      if (name.includes('Olímpico') || name.includes('Olympic')) {
        searchTerms.push('Museu Olímpic, Barcelona, Spain');
        searchTerms.push('Olympic Museum, Barcelona, Spain');
        searchTerms.push('Joan Antoni Samaranch, Barcelona, Spain');
      }
    }
    
    // Add generic multi-language variations for any location
    const commonTranslations = [
      // Portuguese variations
      { from: /Igreja de/gi, to: 'Church of' },
      { from: /Museu de/gi, to: 'Museum of' },
      { from: /Estádio/gi, to: 'Stadium' },
      { from: /Parque/gi, to: 'Park' },
      { from: /Centro/gi, to: 'Center' },
      
      // Spanish variations
      { from: /Catedral de/gi, to: 'Cathedral of' },
      { from: /Basílica de/gi, to: 'Basilica of' },
      { from: /Torre de/gi, to: 'Tower of' },
      { from: /Palacio de/gi, to: 'Palace of' },
      
      // French variations (for international POIs)
      { from: /Église de/gi, to: 'Church of' },
      { from: /Musée de/gi, to: 'Museum of' },
      { from: /Cathédrale de/gi, to: 'Cathedral of' }
    ];
    
    // Apply generic translations
    let translatedName = name;
    commonTranslations.forEach(({ from, to }) => {
      const newName = translatedName.replace(from, to);
      if (newName !== translatedName) {
        searchTerms.push(`${newName}, ${city}, ${country}`);
        translatedName = newName;
      }
    });
    
    // Add simplified variations (keep most important words)
    const words = name.split(' ').filter(word => word.length > 3);
    if (words.length > 1) {
      searchTerms.push(`${words[0]} ${words[words.length - 1]}, ${city}, ${country}`);
    }
    
    // Add variations without common prefixes
    const withoutPrefixes = name
      .replace(/^(Antiguo|Old|Igreja de|Church of|Museu de|Museum of|Catedral de|Cathedral of)\s+/gi, '')
      .trim();
    
    if (withoutPrefixes !== name && withoutPrefixes.length > 3) {
      searchTerms.push(`${withoutPrefixes}, ${city}, ${country}`);
    }
    
    // Try each search term
    for (const searchTerm of searchTerms) {
      console.log(`🔍 Trying: "${searchTerm}"`);
      
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchTerm)}&format=json&limit=3&addressdetails=1&extratags=1`;
      
      const response = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.com)'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          // Find the best match
          let bestMatch = null;
          let bestScore = 0;
          
          for (const result of data) {
            const resultName = (result.display_name || '').toLowerCase();
            const searchName = searchTerm.toLowerCase();
            
            // Calculate score
            let score = 0;
            if (resultName.includes(searchName.split(',')[0].toLowerCase())) score += 1;
            if (result.class === 'leisure' && result.type === 'stadium') score += 2;
            if (result.class === 'tourism') score += 1;
            
            if (score > bestScore) {
              bestScore = score;
              bestMatch = result;
            }
          }
          
          if (bestMatch && bestScore > 0) {
            osmData.nominatim = bestMatch;
            console.log(`✅ Found match: "${bestMatch.display_name}" (Score: ${bestScore})`);
            break;
          }
        }
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
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
          node["leisure"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
          way["leisure"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
          node["sport"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
          way["sport"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
          node["highway"="bus_stop"](around:500,${osmData.nominatim.lat},${osmData.nominatim.lon});
          node["railway"="station"](around:1000,${osmData.nominatim.lat},${osmData.nominatim.lon});
          node["amenity"="subway_entrance"](around:500,${osmData.nominatim.lat},${osmData.nominatim.lon});
          node["amenity"="parking"](around:300,${osmData.nominatim.lat},${osmData.nominatim.lon});
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

async function extractOSMData(osmData: OSMData, name: string, city: string, country: string) {
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
      address: nominatim?.address || reverse?.address,
      type: nominatim?.type || reverse?.type
    },
    osm_geometry: nominatim?.geojson || null, // Only use proper polygon data from OSM
    osm_last_updated: new Date().toISOString(),

    // Geographic data
    elevation_m: await extractElevation(nominatim, reverse),
    estimated_height_m: extractHeight(nominatim, reverse),
    osm_area_m2: extractArea(nominatim, reverse),

    // Heritage and cultural data
    heritage_status: determineHeritageStatus(nominatim, reverse),
    unesco_status: determineUNESCOStatus(nominatim, reverse),
    landmark_level: determineLandmarkLevel(nominatim, reverse),
    importance_level: determineImportanceLevel(nominatim, reverse),
    architect: extractArchitect(nominatim, reverse),
    architectural_style: determineArchitecturalStyle(nominatim, reverse),
    historical_period: determineHistoricalPeriod(nominatim, reverse),
    completion_estimated_year: extractCompletionYear(nominatim, reverse),
    landmark_type: determineLandmarkType(nominatim, reverse),

    // Accessibility data
    wheelchair_accessible: determineWheelchairAccess(nominatim, reverse),
    wheelchair_toilets: nominatim?.extratags?.['toilets:wheelchair'] === 'yes',
    parking_capacity: determineParkingCapacity(nominatim, reverse, overpass),
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
    building_colour: extractBuildingColour(nominatim, reverse),
    roof_colour: extractRoofColour(nominatim, reverse),
    building_material: extractBuildingMaterial(nominatim, reverse),

    // OSM Links e referências
    osm_wikidata_id: extractWikidataId(nominatim, reverse),
    osm_wikipedia_url: extractWikipediaUrl(nominatim, reverse),
    contact_phone: extractContactPhone(nominatim, reverse),
    contact_email: extractContactEmail(nominatim, reverse),
    operator_name: extractOperatorName(nominatim, reverse),
    
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

function calculateQualityScore(data: any, osmImportance?: number): number {
  // Use OSM's native importance score as the primary base (0.0 to 1.0 scale)
  // Convert to 0-100 scale and use as base score
  let score = osmImportance ? Math.round(osmImportance * 100) : 30; // Default to 30 if no importance

  console.log(`🎯 Using OSM importance: ${osmImportance} -> Base score: ${score}/100`);

  // Add points for data richness (complement the OSM importance)
  if (data.osm_tags) {
    const tagCount = Object.keys(data.osm_tags).length;
    if (tagCount > 5) score += 5; // Bonus for rich data
    if (tagCount > 10) score += 5; // Extra bonus for very rich data
  }

  // Bonus for heritage status (these are objectively important)
  if (data.heritage_status === 'unesco_world_heritage') score += 15;
  else if (data.heritage_status === 'national_heritage') score += 10;
  else if (data.heritage_status === 'regional_heritage') score += 5;

  // Bonus for UNESCO status
  if (data.unesco_status === 'world_heritage_site') score += 10;

  // Bonus for having accessibility information (data quality indicator)
  if (data.wheelchair_accessible !== null) score += 2;
  if (data.parking_capacity) score += 2;
  if (data.public_transport?.length > 0) score += 3;

  // Bonus for having detailed metadata (indicates well-maintained entry)
  if (data.architect) score += 3;
  if (data.building_material) score += 2;
  if (data.cultural_significance) score += 3;

  // Ensure score is within valid range for numeric(5,2) field (0-100)
  return Math.min(Math.max(score, 0), 100);
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
  // Base POV scores on quality score and available data - more realistic starting points
  let povQualityScore = qualityScore * 0.8; // POV quality correlates with data quality but is slightly lower
  let visibilityScore = 50; // Start neutral
  let accessibilityScore = 40; // Start lower as most places aren't fully accessible
  let photogenicScore = 60; // Start slightly above average

  // Adjust based on heritage status
  if (data.heritage_status === 'unesco_world_heritage') {
    povQualityScore += 20;
    visibilityScore += 25;
    photogenicScore += 25;
  } else if (data.heritage_status === 'national_heritage') {
    povQualityScore += 15;
    visibilityScore += 20;
    photogenicScore += 20;
  } else if (data.heritage_status === 'regional_heritage') {
    povQualityScore += 10;
    visibilityScore += 15;
    photogenicScore += 15;
  } else if (data.heritage_status === 'local_heritage') {
    povQualityScore += 5;
    visibilityScore += 10;
    photogenicScore += 10;
  }

  // Adjust based on accessibility features
  if (data.wheelchair_accessible === 'yes') {
    accessibilityScore += 30;
  } else if (data.wheelchair_accessible === 'limited') {
    accessibilityScore += 15;
  } else if (data.wheelchair_accessible === 'no') {
    accessibilityScore += 5; // At least we know
  }

  if (data.public_transport?.length > 0) accessibilityScore += 15;
  if (data.parking_capacity && data.parking_capacity > 0) accessibilityScore += 10;

  // Adjust based on cultural significance
  if (data.cultural_significance === 'very_high') {
    povQualityScore += 15;
    photogenicScore += 20;
  } else if (data.cultural_significance === 'high') {
    povQualityScore += 10;
    photogenicScore += 15;
  } else if (data.cultural_significance === 'medium') {
    povQualityScore += 5;
    photogenicScore += 10;
  }

  // Adjust based on urban density and environment
  if (data.urban_density === 'very_dense') {
    visibilityScore += 15; // Easy to find
    accessibilityScore += 10; // Better infrastructure
  } else if (data.urban_density === 'dense') {
    visibilityScore += 10;
    accessibilityScore += 5;
  } else if (data.urban_density === 'sparse') {
    visibilityScore -= 10; // Harder to find
    accessibilityScore -= 5;
  }

  // Adjust based on type-specific factors
  if (data.museum_type) {
    photogenicScore += 10; // Museums are usually photogenic
    accessibilityScore += 5; // Usually have good access
  }
  
  if (data.park_type) {
    photogenicScore += 15; // Parks are very photogenic
    visibilityScore += 10; // Usually visible
  }

  if (data.monument_type) {
    photogenicScore += 20; // Monuments are made to be photogenic
    visibilityScore += 15; // Usually prominent
  }

  // Ensure all scores are within valid range for numeric(5,2) field (0-100)
  return {
    pov_quality_score: Math.min(Math.max(povQualityScore, 0), 100),
    visibility_score: Math.min(Math.max(visibilityScore, 0), 100),
    accessibility_score: Math.min(Math.max(accessibilityScore, 0), 100),
    photogenic_score: Math.min(Math.max(photogenicScore, 0), 100)
  };
}

// Helper functions for extracting physical characteristics
function extractBuildingColour(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags['building:colour'] || tags['building:color'] || tags.colour || tags.color || null;
}

function extractRoofColour(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags['roof:colour'] || tags['roof:color'] || null;
}

function extractBuildingMaterial(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags['building:material'] || tags.material || null;
}

function extractArchitect(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags.architect || tags['architect:name'] || tags['architect:full_name'] || null;
}

// Helper functions for extracting OSM reference data
function extractWikidataId(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags.wikidata || tags['subject:wikidata'] || null;
}

function extractWikipediaUrl(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.wikipedia) {
    // Convert "pt:Cristo Redentor" to full URL
    const [lang, title] = tags.wikipedia.split(':');
    if (lang && title) {
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(' ', '_'))}`;
    }
  }
  
  if (tags['wikipedia:en']) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(tags['wikipedia:en'].replace(' ', '_'))}`;
  }
  
  return null;
}

function extractContactPhone(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags.phone || tags['contact:phone'] || tags['phone:mobile'] || null;
}

function extractContactEmail(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags.email || tags['contact:email'] || null;
}

function extractOperatorName(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  return tags.operator || tags['operator:name'] || tags.owner || tags.ownership || null;
}

function extractCompletionYear(nominatim: any, reverse: any): number | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  // Try different date formats
  if (tags.start_date) {
    const year = parseInt(tags.start_date.split('-')[0]);
    if (year && year > 1000 && year < 3000) return year;
  }
  
  if (tags.built) {
    const year = parseInt(tags.built.split('-')[0]);
    if (year && year > 1000 && year < 3000) return year;
  }
  
  if (tags.construction_date) {
    const year = parseInt(tags.construction_date.split('-')[0]);
    if (year && year > 1000 && year < 3000) return year;
  }
  
  if (tags['building:start_date']) {
    const year = parseInt(tags['building:start_date'].split('-')[0]);
    if (year && year > 1000 && year < 3000) return year;
  }
  
  return null;
}

// Helper functions for extracting geographic data
async function extractElevation(nominatim: any, reverse: any): Promise<number | null> {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  // Try OSM tags first
  if (tags.ele) return parseInt(tags.ele);
  if (tags.elevation) return parseInt(tags.elevation);
  if (tags['ele:m']) return parseInt(tags['ele:m']);
  
  // If no elevation in OSM, try to get from coordinates using a free elevation API
  const lat = nominatim?.lat || reverse?.lat;
  const lon = nominatim?.lon || reverse?.lon;
  
  if (lat && lon) {
    try {
      // Using Open-Elevation API (free)
      const elevationUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
      const elevationResponse = await fetch(elevationUrl);
      
      if (elevationResponse.ok) {
        const elevationData = await elevationResponse.json();
        if (elevationData.results && elevationData.results[0]) {
          const elevation = Math.round(elevationData.results[0].elevation);
          console.log(`🏔️ Got elevation from API: ${elevation}m for ${lat},${lon}`);
          return elevation;
        }
      }
    } catch (error) {
      console.warn('⚠️ Elevation API error (non-critical):', error);
    }
  }
  
  return null;
}

function extractHeight(nominatim: any, reverse: any): number | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.height) return parseFloat(tags.height);
  if (tags['height:m']) return parseFloat(tags['height:m']);
  if (tags['building:height']) return parseFloat(tags['building:height']);
  if (tags.min_height) {
    // Convert from string like "10,63" to number
    const height = parseFloat(tags.min_height.replace(',', '.'));
    if (!isNaN(height)) return height;
  }
  if (tags.max_height) {
    const height = parseFloat(tags.max_height.replace(',', '.'));
    if (!isNaN(height)) return height;
  }
  
  return null;
}

function extractArea(nominatim: any, reverse: any): number | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.area) return parseInt(tags.area);
  if (tags['area:m2']) return parseInt(tags['area:m2']);
  
  return null;
}

// Helper functions for determining various characteristics
function determineHeritageStatus(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  // UNESCO World Heritage
  if (tags['whc:inscription_date'] || tags['ref:whc']) return 'unesco_world_heritage';
  
  // Heritage levels
  if (tags.heritage === '1') return 'national_heritage';
  if (tags.heritage === '2') return 'regional_heritage';
  if (tags.heritage === '3') return 'local_heritage';
  
  // Check for heritage indicators
  if (tags.historic) {
    // Important historic landmarks likely have some heritage status
    if (tags.landmark === '1' || tags.tourism === 'attraction') {
      return 'local_heritage'; // Default to local heritage for historic attractions
    }
  }
  
  // Religious/cultural monuments often have heritage value
  if (tags.man_made === 'monument' && tags.landmark === '1') {
    return 'local_heritage';
  }
  
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
  const category = nominatim?.class || reverse?.class;
  
  // Check specific tags first
  if (tags.man_made === 'monument') return 'monument';
  if (tags.historic === 'monument') return 'monument';
  if (tags.tourism === 'museum') return 'museum';
  if (tags.leisure === 'park') return 'park';
  if (tags.leisure === 'stadium') return 'stadium';
  if (tags.amenity === 'place_of_worship') return 'religious';
  if (tags.building === 'cathedral' || tags.building === 'church') return 'religious';
  
  // Check by category
  if (category === 'tourism') return 'tourism';
  if (category === 'leisure') return 'leisure';
  if (category === 'historic') return 'historic';
  if (category === 'amenity') return 'amenity';
  
  return null;
}

function determineWheelchairAccess(nominatim: any, reverse: any): boolean | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  if (tags.wheelchair === 'yes') return true;
  if (tags.wheelchair === 'no') return false;
  
  return null;
}

function determineParkingCapacity(nominatim: any, reverse: any, overpass?: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  // Check specific capacity numbers
  if (tags['parking:capacity']) {
    const capacity = parseInt(tags['parking:capacity']);
    if (capacity > 100) return 'very_large';
    if (capacity > 50) return 'large';
    if (capacity > 20) return 'medium';
    if (capacity > 5) return 'small';
    return 'small';
  }
  
  // Check for parking availability indicators
  if (tags.parking === 'yes' || tags.amenity === 'parking') return 'medium';
  if (tags.parking === 'no') return 'none';
  
  // Check for parking-related tags
  if (tags['parking:fee'] || tags['parking:maxstay']) return 'small';
  
  // Check Overpass data for nearby parking
  if (overpass?.elements) {
    const parkingSpots = overpass.elements.filter((element: any) => 
      element.tags?.amenity === 'parking'
    );
    
    if (parkingSpots.length > 0) {
      // If we found multiple parking areas, assume medium to large capacity
      if (parkingSpots.length > 2) return 'large';
      if (parkingSpots.length > 1) return 'medium';
      return 'small';
    }
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
  const category = nominatim?.class || reverse?.class;
  
  // Check direct museum tag first
  if (tags.museum) {
    if (tags.museum === 'art') return 'art';
    if (tags.museum === 'history') return 'history';
    if (tags.museum === 'science') return 'science';
    if (tags.museum === 'natural_history') return 'natural_history';
    return 'general';
  }
  
  // Check museum:type
  if (tags['museum:type']) {
    if (tags['museum:type'] === 'art') return 'art';
    if (tags['museum:type'] === 'history') return 'history';
    if (tags['museum:type'] === 'science') return 'science';
    if (tags['museum:type'] === 'natural_history') return 'natural_history';
    return 'specialized';
  }
  
  // Check if it's a tourism museum
  if (tags.tourism === 'museum' || category === 'tourism') {
    return 'general';
  }
  
  return null;
}

function determineParkType(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  const category = nominatim?.class || reverse?.class;
  
  if (tags.leisure === 'park' || category === 'leisure') {
    // Check explicit park type
    if (tags['park:type'] === 'national') return 'national';
    if (tags['park:type'] === 'state') return 'state';
    if (tags['park:type'] === 'municipal') return 'municipal';
    
    // Check ownership
    if (tags.ownership === 'municipal') return 'municipal';
    if (tags.ownership === 'state') return 'state';
    if (tags.ownership === 'national') return 'national';
    if (tags.ownership === 'private') return 'recreational';
    
    // Check operator
    if (tags.operator && tags.operator.toLowerCase().includes('municipal')) return 'municipal';
    if (tags.operator && tags.operator.toLowerCase().includes('estado')) return 'state';
    if (tags.operator && tags.operator.toLowerCase().includes('nacional')) return 'national';
    
    // Default to urban for city parks
    return 'urban';
  }
  
  return null;
}

function determineMonumentType(nominatim: any, reverse: any): string | null {
  const tags = { ...nominatim?.extratags, ...reverse?.extratags };
  
  // Check for specific monument types first
  if (tags['monument:type']) {
    return tags['monument:type']; // Use exact OSM value
  }
  
  // Check for monument indicators
  if (tags.historic === 'monument' || tags.man_made === 'monument') {
    // Check by name for specific types
    const name = (tags.name || '').toLowerCase();
    if (name.includes('arc') || name.includes('arco')) return 'arch';
    if (name.includes('obelisk') || name.includes('obelisco')) return 'obelisk';
    if (name.includes('memorial')) return 'memorial';
    if (name.includes('statue') || name.includes('estátua')) return 'statue';
    if (name.includes('tower') || name.includes('torre')) return 'tower';
    if (name.includes('fountain') || name.includes('fonte')) return 'fountain';
    
    // Return generic monument if no specific type found
    return 'monument';
  }
  
  // Check for religious monuments
  if (tags.building === 'cathedral') return 'cathedral';
  if (tags.building === 'church') return 'church';
  if (tags.building === 'basilica') return 'basilica';
  
  // Check for specific structures
  if (tags.man_made === 'tower') return 'tower';
  if (tags.historic === 'memorial') return 'memorial';
  if (tags.historic === 'arch' || tags.man_made === 'arch') return 'arch';
  
  return null;
}
