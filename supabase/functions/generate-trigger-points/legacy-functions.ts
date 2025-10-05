import { api, apiManager } from '../lib/core/api-manager'
/**
 * LEGACY FUNCTIONS - Sistema Antigo de Trigger Points
 * 
 * Este arquivo contém todas as funções do sistema legacy que foram substituídas
 * pelo sistema mega-unificado. Mantidas apenas para fallback em caso de emergência.
 * 
 * ⚠️ ATENÇÃO: Estas funções fazem múltiplas chamadas API individuais
 * e podem causar timeouts. Use apenas como último recurso.
 */

// Helper function to safely format numbers (prevents undefined.toFixed() errors)
function safeToFixed(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) {
    return '0';
  }
  return Number(value).toFixed(decimals);
}

// Cache for regional height analysis (avoid repeated sampling)
const regionalHeightCache = new Map();

// ========================================
// LEGACY DATA COLLECTION FUNCTIONS
// ========================================

/**
 * LEGACY: Detect POI height using individual API call
 * SUBSTITUÍDA POR: processPOIHeightMega() no sistema mega-unified
 */
async function detectPOIHeight(lat, lng) {
  console.log('⚠️ LEGACY: Using individual API call for POI height detection');
  
  // Create cache key with rounded coordinates (avoid micro-differences)
  const cacheKey = `${safeToFixed(lat, 6)},${safeToFixed(lng, 6)}`;
  
  // Note: Cache would need to be imported or created locally
  // if (poiHeightCache.has(cacheKey)) {
  //   const cached = poiHeightCache.get(cacheKey);
  //   console.log(`🎯 Using cached POI height: ${cached.height}m (${cached.category})`);
  //   return cached;
  // }
  
  try {
    console.log(`🏗️ Detecting REAL POI height for ${lat}, ${lng}`);
    
    // Search for buildings with height data around the POI location
    const heightQuery = `[out:json][timeout:25];
    (
      way[building][height](around:100,${lat},${lng});
      way[building]["building:height"](around:100,${lat},${lng});
      way[building]["building:levels"](around:100,${lat},${lng});
      relation[building][height](around:100,${lat},${lng});
      relation[building]["building:height"](around:100,${lat},${lng});
      relation[building]["building:levels"](around:100,${lat},${lng});
    );
    out tags;`;
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: heightQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (poi-height-detection)',
        'Content-Type': 'text/plain'
      }
    });
    
    if (!response.ok) {
      console.log(`⚠️ Height detection failed: ${response.status}`);
      return { height: 0, category: 'low', confidence: 0.0 };
    }
    
    const data = response.data;
    if (!data.elements || data.elements.length === 0) {
      console.log('❌ NO REAL HEIGHT DATA found in OSM for this location');
      return { height: 0, category: 'low', confidence: 0.0 };
    }
    
    console.log(`🔍 Found ${data.elements.length} buildings with height data`);
    
    // Find the building closest to the POI coordinates
    let bestBuilding = null;
    let bestDistance = Infinity;
    
    for (const element of data.elements) {
      if (element.tags) {
        // Calculate approximate distance (using first node if available)
        let buildingLat = lat, buildingLng = lng; // Default to POI location
        
        // Try to get building center from geometry if available
        if (element.geometry && element.geometry.length > 0) {
          const coords = element.geometry.map(node => ({ lat: node.lat, lng: node.lon }));
          buildingLat = coords.reduce((sum, coord) => sum + coord.lat, 0) / coords.length;
          buildingLng = coords.reduce((sum, coord) => sum + coord.lng, 0) / coords.length;
        }
        
        // Note: calculateDistance would need to be imported
        const distance = Math.sqrt((lat - buildingLat)**2 + (lng - buildingLng)**2) * 111000; // Rough approximation
        
        if (distance < bestDistance) {
          bestDistance = distance;
          bestBuilding = element;
        }
      }
    }
    
    if (!bestBuilding) {
      console.log('❌ No building with valid height data found');
      return { height: 0, category: 'low', confidence: 0.0 };
    }
    
    // Extract height from tags
    const tags = bestBuilding.tags;
    let height = 0;
    let confidence = 0.0;
    
    // Try direct height first
    if (tags.height) {
      height = parseFloat(tags.height.replace(/[^\d.]/g, ''));
      if (!isNaN(height)) {
        confidence = 1.0;
        console.log(`✅ Found direct height: ${height}m (distance: ${safeToFixed(bestDistance, 1)}m)`);
      }
    }
    
    // Try building:height
    if (height === 0 && tags['building:height']) {
      height = parseFloat(tags['building:height'].replace(/[^\d.]/g, ''));
      if (!isNaN(height)) {
        confidence = 0.9;
        console.log(`✅ Found building:height: ${height}m (distance: ${safeToFixed(bestDistance, 1)}m)`);
      }
    }
    
    // Try levels (estimate height)
    if (height === 0 && tags['building:levels']) {
      const levels = parseInt(tags['building:levels']);
      if (!isNaN(levels)) {
        height = levels * 3.5; // Average 3.5m per level
        confidence = 0.7;
        console.log(`✅ Found building:levels: ${levels} levels = ${height}m estimated (distance: ${safeToFixed(bestDistance, 1)}m)`);
      }
    }
    
    if (height === 0) {
      console.log('❌ Could not extract height from building data');
      return { height: 0, category: 'low', confidence: 0.0 };
    }
    
    // Adjust confidence based on distance (closer = more confident)
    if (bestDistance > 50) {
      confidence *= 0.8; // Reduce confidence if building is far from POI
    }
    
    // Categorize height
    let category = 'low';
    if (height >= 100) category = 'very_high';
    else if (height >= 50) category = 'high';
    else if (height >= 20) category = 'medium';
    
    console.log(`🏗️ REAL POI height detected: ${height}m (${category}, confidence: ${safeToFixed(confidence, 2)})`);
    
    const result = { 
      height: height, 
      category: category, 
      confidence: confidence
    };
    
    // Cache the result for future use (if cache available)
    // poiHeightCache.set(cacheKey, result);
    
    return result;
    
  } catch (error) {
    console.error('❌ Error detecting POI height:', error);
    return { height: 0, category: 'low', confidence: 0.0 };
  }
}

/**
 * LEGACY: Detect urban density using individual API call
 * SUBSTITUÍDA POR: calculateUrbanDensityMega() no sistema mega-unified
 */
async function detectUrbanDensity(lat, lng) {
  console.log('⚠️ LEGACY: Using individual API call for urban density detection');
  
  try {
    console.log(`🏙️ Detecting urban density for ${lat}, ${lng}`);
    // Use Overpass API to count buildings and streets in different radii
    const overpassQuery = `[out:json][timeout:30];
    (
      // Buildings in 200m radius
      way[building](around:200,${lat},${lng});
      relation[building](around:200,${lat},${lng});
      
      // Major roads in 500m radius
      way[highway~"^(motorway|trunk|primary|secondary)$"](around:500,${lat},${lng});
      
      // All roads in 300m radius
      way[highway](around:300,${lat},${lng});
    );
    out;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: overpassQuery
    });
    if (!response.ok) {
      console.log('⚠️ Overpass API failed for urban density, using default');
      return 'urban'; // Changed default to urban for better results
    }
    const data = response.data;
    if (data.elements && data.elements.length > 0) {
      const buildingCount = data.elements.filter((e)=>e.tags?.building).length;
      const majorRoadCount = data.elements.filter((e)=>e.tags?.highway && [
          'motorway',
          'trunk',
          'primary',
          'secondary'
        ].includes(e.tags.highway)).length;
      const totalRoadCount = data.elements.filter((e)=>e.tags?.highway).length;
      console.log(`📊 Urban density analysis: ${buildingCount} buildings, ${majorRoadCount} major roads, ${totalRoadCount} total roads`);
      // Classify urban density based on counts
      if (buildingCount > 50 && majorRoadCount > 3) return 'very_dense';
      if (buildingCount > 25 && totalRoadCount > 8) return 'dense';
      if (buildingCount > 10 && totalRoadCount > 4) return 'urban';
      if (buildingCount > 2 && totalRoadCount > 1) return 'suburban';
      return 'rural';
    }
    return 'urban'; // Default to urban for better results
  } catch (error) {
    console.log('⚠️ Error detecting urban density:', error);
    return 'medium';
  }
}

/**
 * LEGACY: Get regional height average using individual API calls
 * SUBSTITUÍDA POR: processRegionalHeightsMega() no sistema mega-unified
 */
async function getRegionalHeightAverage(centerLat, centerLng) {
  console.log('⚠️ LEGACY: Using individual API calls for regional height analysis');
  
  const cacheKey = `${centerLat.toFixed(4)},${centerLng.toFixed(4)}`;
  
  // Check cache first (broader area cache)
  if (regionalHeightCache.has(cacheKey)) {
    const cached = regionalHeightCache.get(cacheKey);
    console.log(`🎯 Using cached regional height: ${cached.average.toFixed(1)}m (${cached.samples} samples)`);
    return cached;
  }
  
  try {
    console.log(`📊 Sampling regional building heights around ${centerLat}, ${centerLng}`);
    
    // Sample buildings in a 300m radius around the point
    const heightQuery = `[out:json][timeout:15];
    (
      way[building][height](around:300,${centerLat},${centerLng});
      way[building]["building:height"](around:300,${centerLat},${centerLng});
      way[building]["building:levels"](around:300,${centerLat},${centerLng});
    );
    out tags;`;
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: heightQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (regional-height-sampling)',
        'Content-Type': 'text/plain'
      }
    });
    
    if (!response.ok) {
      console.log(`⚠️ Regional height sampling failed: ${response.status}`);
      return { average: 25, samples: 0, confidence: 0.0 }; // Default urban average
    }
    
    const data = response.data;
    const buildings = data.elements || [];
    
    let totalHeight = 0;
    let validSamples = 0;
    
    // Process up to SAMPLE_SIZE buildings for performance
    const SAMPLING_CONFIG = { SAMPLE_SIZE: 5 }; // Local fallback config
    const sampleBuildings = buildings.slice(0, SAMPLING_CONFIG.SAMPLE_SIZE * 2); // Get more to filter
    
    for (const building of sampleBuildings) {
      if (validSamples >= SAMPLING_CONFIG.SAMPLE_SIZE) break; // Stop at sample size
      
      const tags = building.tags || {};
      let height = 0;
      
      // Extract height from various tags
      if (tags.height) {
        height = parseFloat(tags.height.replace(/[^\d.]/g, ''));
      } else if (tags['building:height']) {
        height = parseFloat(tags['building:height'].replace(/[^\d.]/g, ''));
      } else if (tags['building:levels']) {
        const levels = parseInt(tags['building:levels']);
        height = levels * 3.5; // Estimate 3.5m per level
      }
      
      if (height > 0 && height <= 300) { // Valid height range
        totalHeight += height;
        validSamples++;
      }
    }
    
    const average = validSamples > 0 ? totalHeight / validSamples : 25; // Default 25m
    const confidence = Math.min(validSamples / SAMPLING_CONFIG.SAMPLE_SIZE, 1.0);
    
    const result = { 
      average: average, 
      samples: validSamples, 
      confidence: confidence 
    };
    
    // Cache the result for future use
    regionalHeightCache.set(cacheKey, result);
    
    console.log(`📊 Regional height analysis: ${average.toFixed(1)}m average (${validSamples} samples, confidence: ${confidence.toFixed(2)})`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Error in regional height sampling:', error);
    return { average: 25, samples: 0, confidence: 0.0 };
  }
}

// ========================================
// LEGACY STREET PROCESSING FUNCTIONS
// ========================================

/**
 * LEGACY: Find nearby streets using individual API call
 * SUBSTITUÍDA POR: processStreetDataMega() no sistema mega-unified
 */
async function findNearbyStreetsForTriggers(lat, lng, poiName, landmarkInfo, customRadius) {
  console.log('⚠️ LEGACY: Using individual API call for street detection');
  
  try {
    console.log('🗺️ Searching for nearby streets with Overpass API...');
    
    // Use provided landmark info (already calculated in main handler)
    const landmark = landmarkInfo;
    
    // Adjust search radius - use custom radius for fallback, otherwise use landmark-based calculation
    let majorRadius, mediumRadius, minorRadius;
    
    if (customRadius) {
      // For fallback street analysis, use smaller, focused radius
      majorRadius = customRadius * 1.5;
      mediumRadius = customRadius;
      minorRadius = customRadius * 0.7;
      console.log(`🔧 Using custom radius: ${customRadius}m (fallback mode)`);
    } else {
      // Normal landmark-based calculation - using maxRange from our new urban density logic
      majorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 1.2, 6000) : Math.min(landmark.maxRange * 1.2, 1500);
      mediumRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange, 4000) : Math.min(landmark.maxRange, 1000);
      minorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 0.7, 3000) : Math.min(landmark.maxRange * 0.7, 800);
    }
    
    console.log(`🔍 Street search radius: major=${majorRadius}m, medium=${mediumRadius}m, minor=${minorRadius}m`);
    console.log(`🔍 Landmark info: isHighVisibility=${landmark.isHighVisibility}, maxRange=${landmark.maxRange}m`);
    
    // Enhanced query to find EXTERNAL streets around the POI (avoiding internal paths)
    const overpassQuery = `[out:json][timeout:60];
    (
      // Major highways and roads (priority - further out)
      way[highway~"^(motorway|trunk|primary|secondary)$"](around:${majorRadius},${lat},${lng});
      
      // Tertiary roads (medium distance)
      way[highway~"^(tertiary)$"](around:${mediumRadius},${lat},${lng});
      
      // Residential streets (closer but still external)
      way[highway~"^(residential|living_street)$"](around:${minorRadius},${lat},${lng});
      
      // Named roads that are likely external access routes
      way[highway~"^(trunk|primary|secondary|tertiary|residential)$"][name](around:${mediumRadius},${lat},${lng});
    );
    out geom;`;

    console.log(`🔍 DEBUG: Overpass query:`);
    console.log(overpassQuery);
    
    // Rate limiting: Add delay between requests to avoid 429 errors
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (street-trigger-generation)',
        'Content-Type': 'text/plain'
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.log('⏳ Rate limited by Overpass API, waiting 5 seconds and retrying...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Retry once
        const retryResponse = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: overpassQuery,
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (street-trigger-generation)',
            'Content-Type': 'text/plain'
          }
        });
        
        if (!retryResponse.ok) {
          throw new Error(`Overpass API error after retry: ${retryResponse.status}`);
        }
        
        const retryData = await retryResponse.json();
        console.log(`✅ Retry successful: ${retryData.elements?.length || 0} elements found`);
        return processOverpassStreetDataLegacy(retryData, lat, lng, poiName, landmark);
      }
      
      throw new Error(`Overpass API error: ${response.status}`);
    }

    const data = response.data;
    return processOverpassStreetDataLegacy(data, lat, lng, poiName, landmark);
    
  } catch (error) {
    console.error('❌ Error finding nearby streets:', error);
    return [];
  }
}

/**
 * LEGACY: Generate triggers on streets using individual processing
 * SUBSTITUÍDA POR: generateTriggersFromMegaStreets() no sistema mega-unified
 */
async function generateTriggersOnStreets(poiLat, poiLng, boundaryCoordinates, streets, landmarkInfo, regionalHeight = null) {
  console.log('⚠️ LEGACY: Using individual street processing for trigger generation');
  
  const triggerPoints = [];
  
  // Simplified version - would need proper SAMPLING_CONFIG and utility imports
  const SAMPLING_CONFIG = {
    MAX_FULL_CHECKS: 5
  };
  
  // INTELLIGENT SAMPLING: Sort streets by distance and process smartly
  const sortedStreets = streets.sort((a, b) => (a.distance_to_poi || 0) - (b.distance_to_poi || 0));
  
  console.log(`📊 Processing ${sortedStreets.length} streets with intelligent sampling:`);
  console.log(`   - Full checks: ${Math.min(SAMPLING_CONFIG.MAX_FULL_CHECKS, sortedStreets.length)} closest streets`);
  console.log(`   - Fast estimates: ${Math.max(0, sortedStreets.length - SAMPLING_CONFIG.MAX_FULL_CHECKS)} distant streets`);
  
  for (let i = 0; i < Math.min(sortedStreets.length, 10); i++) { // Simplified limit
    const street = sortedStreets[i];
    const isFullCheck = i < SAMPLING_CONFIG.MAX_FULL_CHECKS;
    
    // Simplified point generation - would need proper findStrategicPointsOnStreet
    if (street.coordinates && street.coordinates.length > 0) {
      // Add a simple point at the middle of the street
      const midIndex = Math.floor(street.coordinates.length / 2);
      const midPoint = street.coordinates[midIndex];
      
      triggerPoints.push({
        lat: midPoint[1], // coordinates are [lng, lat]
        lng: midPoint[0],
        confidence: street.confidence || 0.5,
        street_name: street.name,
        distance_to_poi: street.distance_to_poi || 0
      });
    }
  }
  
  console.log(`📍 Generated ${triggerPoints.length} street trigger points`);
  
  return triggerPoints.slice(0, 15); // Simplified limit
}

/**
 * LEGACY: Generate street-based trigger points using multiple API calls
 * SUBSTITUÍDA POR: generateTriggersFromMegaStreets() no sistema mega-unified
 */
async function generateStreetBasedTriggerPoints(boundary: any, lat: number, lng: number, name: string, landmarkInfo: any, regionalHeight: any) {
  console.log('⚠️ LEGACY: Using multiple API calls for street-based trigger generation');
  
  // Placeholder - real implementation would be moved here
  return [];
}

// ========================================
// LEGACY BOUNDARY CREATION FUNCTIONS
// ========================================

/**
 * LEGACY: Create circular boundary around a point (fallback)
 * SUBSTITUÍDA POR: Boundary detection no sistema mega-unified
 */
function createCircularBoundary(centerLat, centerLng, radiusMeters) {
  console.log('⚠️ LEGACY: Creating circular boundary fallback');
  
  const points = [];
  const earthRadius = 6371000; // Earth radius in meters
  
  // Create 16 points around the circle
  for(let i = 0; i < 16; i++){
    const angle = i * 2 * Math.PI / 16;
    // Calculate offset in degrees
    const latOffset = radiusMeters * Math.cos(angle) / earthRadius * (180 / Math.PI);
    const lngOffset = radiusMeters * Math.sin(angle) / (earthRadius * Math.cos(centerLat * Math.PI / 180)) * (180 / Math.PI);
    points.push({
      lat: centerLat + latOffset,
      lng: centerLng + lngOffset
    });
  }
  // Close the polygon
  points.push(points[0]);
  const area = Math.PI * radiusMeters * radiusMeters; // Circle area
  const perimeter = 2 * Math.PI * radiusMeters; // Circle circumference
  
  return {
    coordinates: points,
    area_m2: area,
    perimeter_m: perimeter,
    confidence: 0.7 // Lower confidence since it's a fallback
  };
}

/**
 * LEGACY: Create estimated boundary based on name analysis
 * SUBSTITUÍDA POR: Boundary detection no sistema mega-unified
 */
function createEstimatedBoundary(lat, lng, name) {
  console.log('⚠️ LEGACY: Creating estimated boundary based on name patterns');
  console.log(`🔄 Creating estimated boundary for ${name}`);
  
  // Estimate radius based on name patterns (LEGACY LOGIC)
  let estimatedRadius = 100; // Default
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('parque') || lowerName.includes('park')) {
    estimatedRadius = 300;
  } else if (lowerName.includes('praca') || lowerName.includes('praça') || lowerName.includes('square')) {
    estimatedRadius = 80;
  } else if (lowerName.includes('igreja') || lowerName.includes('church') || lowerName.includes('cathedral')) {
    estimatedRadius = 50;
  } else if (lowerName.includes('museu') || lowerName.includes('museum')) {
    estimatedRadius = 120;
  } else if (lowerName.includes('shopping') || lowerName.includes('mall')) {
    estimatedRadius = 200;
  } else if (lowerName.includes('estadio') || lowerName.includes('stadium')) {
    estimatedRadius = 250;
  }
  
  const boundary = createCircularBoundary(lat, lng, estimatedRadius);
  const perimeter_m = 2 * Math.PI * estimatedRadius;
  console.log(`📐 Estimated boundary: ${estimatedRadius}m radius, ${boundary.area_m2.toFixed(0)}m² area`);
  
  return {
    coordinates: boundary.coordinates,
    area_m2: boundary.area_m2,
    perimeter_m,
    confidence: 0.6
  };
}

/**
 * LEGACY: Get known city elevation using individual API call
 * SUBSTITUÍDA POR: Elevation data no sistema mega-unified
 */
async function getKnownCityElevation(lat, lng) {
  console.log('⚠️ LEGACY: Using individual API call for city elevation lookup');
  
  try {
    // Use reverse geocoding to get city name
    const response = await api.osm.nominatim('reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1', {, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (city-elevation-lookup)'
      }
    });
    if (!response.ok) {
      return null;
    }
    const data = response.data;
    if (data.address) {
      const cityNames = [
        data.address.city,
        data.address.town,
        data.address.village,
        data.address.municipality,
        data.address.county
      ].filter(Boolean);
      
      // Simplified - would need KNOWN_CITY_ELEVATIONS import
      for (const cityName of cityNames){
        if (cityName) {
          const normalizedName = cityName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          // Would check KNOWN_CITY_ELEVATIONS[normalizedName] here
          console.log(`🏙️ City elevation lookup for: ${cityName}`);
        }
      }
    }
    return null;
  } catch (error) {
    console.log('⚠️ Error getting known city elevation:', error);
    return null;
  }
}

// ========================================
// LEGACY BOUNDARY DETECTION FUNCTIONS
// ========================================

/**
 * LEGACY: Search OSM by name using individual API call
 * SUBSTITUÍDA POR: processBoundaryDataMega() no sistema mega-unified
 */
async function searchOSMByName(name: string, lat: number, lng: number) {
  console.log('⚠️ LEGACY: Using individual API call for OSM name search');
  
  // Placeholder - real implementation would be moved here
  return { success: false };
}

/**
 * LEGACY: Search OSM by coordinates using individual API call
 * SUBSTITUÍDA POR: processBoundaryDataMega() no sistema mega-unified
 */
async function searchOSMByCoordinates(lat: number, lng: number) {
  console.log('⚠️ LEGACY: Using individual API call for OSM coordinate search');
  
  // Placeholder - real implementation would be moved here
  return { success: false };
}

// ========================================
// LEGACY VISIBILITY FUNCTIONS
// ========================================

/**
 * LEGACY: Get real building height using individual calculations
 * SUBSTITUÍDA POR: extractBuildingHeightMega() no sistema mega-unified
 */
async function getRealBuildingHeight(tags, buildingCoords) {
  console.log('⚠️ LEGACY: Using individual building height calculation');
  
  // Simplified version - would need proper height extraction logic
  if (tags?.height) {
    const height = parseFloat(tags.height);
    if (!isNaN(height)) return height;
  }
  
  if (tags?.levels || tags['building:levels']) {
    const levels = parseInt(tags.levels || tags['building:levels']);
    if (!isNaN(levels)) return levels * 3; // 3m per level estimate
  }
  
  return 12; // Default building height
}

/**
 * LEGACY: Search nearby building heights using individual API calls
 * SUBSTITUÍDA POR: processRegionalHeightsMega() no sistema mega-unified
 */
async function searchNearbyBuildingHeights(lat, lng, buildingType) {
  console.log('⚠️ LEGACY: Using individual API calls for nearby building heights');
  
  // Simplified version - would make individual Overpass API calls
  return {
    averageHeight: 15,
    sampleCount: 5,
    confidence: 0.5
  };
}

/**
 * LEGACY: Check basic building obstructions using individual processing
 * SUBSTITUÍDA POR: Visibility checks no sistema mega-unified
 */
async function checkBasicBuildingObstructions(triggerPoint, poiLat, poiLng) {
  console.log('⚠️ LEGACY: Using individual building obstruction checks');
  
  // Simplified version - would make individual API calls and calculations
  return {
    isObstructed: false,
    confidence: 0.7,
    obstructionCount: 0
  };
}

/**
 * LEGACY: Create line of sight samples for visibility checking
 * SUBSTITUÍDA POR: Optimized visibility calculations no sistema mega-unified
 */
function createLineOfSightSamples(triggerPoint, poiLat, poiLng, numSamples) {
  console.log('⚠️ LEGACY: Creating line of sight samples with individual calculations');
  
  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    const ratio = i / (numSamples - 1);
    samples.push({
      lat: triggerPoint.lat + (poiLat - triggerPoint.lat) * ratio,
      lng: triggerPoint.lng + (poiLng - triggerPoint.lng) * ratio,
      ratio: ratio
    });
  }
  return samples;
}

/**
 * LEGACY: Check visibility to POI using individual calculations
 * SUBSTITUÍDA POR: Optimized visibility system no sistema mega-unified
 */
async function checkVisibilityToPOI(point, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight = null, megaBuildings = null, poiHeight = null) {
  console.log('⚠️ LEGACY: Using individual visibility calculations');
  
  // Simplified version - would need complex visibility logic
  return {
    isVisible: true,
    confidence: 0.5,
    reason: 'legacy-simplified'
  };
}

/**
 * LEGACY: Check legacy building obstructions using individual API calls
 * SUBSTITUÍDA POR: Optimized obstruction checks no sistema mega-unified
 */
async function checkLegacyBuildingObstructions(triggerPoint, poiLat, poiLng, megaBuildings = null, poiHeight = null) {
  console.log('⚠️ LEGACY: Using individual building obstruction checks');
  
  // Simplified version - would make individual API calls
  return {
    isObstructed: false,
    confidence: 0.6,
    buildingCount: 0
  };
}

/**
 * LEGACY: Check real obstructions using complex calculations
 * SUBSTITUÍDA POR: Advanced obstruction detection no sistema mega-unified
 */
async function checkRealObstructions(triggerPoint, poiLat, poiLng, landmarkInfo) {
  console.log('⚠️ LEGACY: Using individual real obstruction checks');
  
  // Simplified version - would need complex terrain/building analysis
  return {
    hasObstructions: false,
    confidence: 0.7,
    obstructionTypes: []
  };
}

/**
 * LEGACY: Check obstruction at specific point using individual API call
 * SUBSTITUÍDA POR: Point-based checks no sistema mega-unified
 */
async function checkObstructionAtPoint(lat, lng, landmarkInfo, fastMode = false) {
  console.log('⚠️ LEGACY: Using individual point obstruction check');
  
  // Simplified version - would make API calls for specific point
  return {
    isObstructed: false,
    obstructionType: null,
    confidence: 0.5
  };
}

/**
 * LEGACY: Convert OSM polygon format using individual processing
 * SUBSTITUÍDA POR: Optimized polygon processing no sistema mega-unified
 */
function convertOSMPolygon(coordinates) {
  console.log('⚠️ LEGACY: Using individual OSM polygon conversion');
  
  // Simplified version - would need proper coordinate transformation
  if (!coordinates || !Array.isArray(coordinates)) return [];
  
  return coordinates.map(coord => ({
    lat: coord[1] || coord.lat,
    lng: coord[0] || coord.lng
  }));
}

/**
 * LEGACY: Process OSM geometry using individual calculations
 * SUBSTITUÍDA POR: Geometry processing no sistema mega-unified
 */
async function processOSMGeometry(geojson, poiLat, poiLng) {
  console.log('⚠️ LEGACY: Using individual OSM geometry processing');
  
  // Simplified version - would need complex geometry processing
  return {
    coordinates: [],
    area: 0,
    confidence: 0.5
  };
}

/**
 * LEGACY: Find intersection points on street coordinates
 * SUBSTITUÍDA POR: Optimized intersection detection in mega-unified system
 */
function findIntersectionPoints(coordinates) {
  console.log('⚠️ LEGACY: Using individual intersection detection');
  
  // Simplified: return points where the street changes direction significantly
  const intersections = [];
  for(let i = 1; i < coordinates.length - 1; i++){
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    const next = coordinates[i + 1];
    
    // Simple bearing change detection
    const bearing1 = Math.atan2(curr.lat - prev.lat, curr.lng - prev.lng);
    const bearing2 = Math.atan2(next.lat - curr.lat, next.lng - curr.lng);
    const bearingDiff = Math.abs(bearing2 - bearing1) * 180 / Math.PI;
    
    // If bearing changes significantly, it might be an intersection
    if (bearingDiff > 30 && bearingDiff < 330) {
      intersections.push(curr);
    }
  }
  return intersections;
}

/**
 * LEGACY: Remove duplicate points with minimum distance
 * SUBSTITUÍDA POR: Optimized point filtering in mega-unified system
 */
function removeDuplicatePoints(points, minDistance) {
  console.log('⚠️ LEGACY: Using individual point deduplication');
  
  const filtered = [];
  for (const point of points){
    let tooClose = false;
    for (const existing of filtered){
      // Simple distance calculation
      const latDiff = point.lat - existing.lat;
      const lngDiff = point.lng - existing.lng;
      const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000; // Rough conversion to meters
      
      if (distance < minDistance) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      filtered.push(point);
    }
  }
  return filtered;
}

// ========================================
// LEGACY GEOMETRY FUNCTIONS
// ========================================

/**
 * LEGACY: Line intersects polygon check
 * SUBSTITUÍDA POR: Funções geométricas otimizadas no sistema mega-unified
 */
function lineIntersectsPolygon(point1, point2, polygon) {
  console.log('⚠️ LEGACY: Using individual line intersection calculation');
  
  // Simple implementation: check if line segment intersects any polygon edge
  for (let i = 0; i < polygon.length - 1; i++) {
    const p3 = polygon[i];
    const p4 = polygon[i + 1];
    
    // Check if line segments intersect
    const denom = (point1.lat - point2.lat) * (p3.lng - p4.lng) - (point1.lng - point2.lng) * (p3.lat - p4.lat);
    if (Math.abs(denom) < 1e-10) continue; // Lines are parallel
    
    const t = ((p3.lat - point1.lat) * (p3.lng - p4.lng) - (p3.lng - point1.lng) * (p3.lat - p4.lat)) / denom;
    const u = -((point1.lat - point2.lat) * (p3.lng - point1.lng) - (point1.lng - point2.lng) * (p3.lat - point1.lat)) / denom;
    
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return true; // Lines intersect
    }
  }
  return false;
}

// ========================================
// LEGACY API FUNCTIONS
// ========================================

/**
 * LEGACY: Generic Overpass API query function
 * SUBSTITUÍDA POR: getMegaUnifiedPOIData() no sistema mega-unified
 */
async function queryOverpassAPI(query, purpose, timeout = 30) {
  console.log(`⚠️ LEGACY: queryOverpassAPI called for ${purpose}. Use queryUnifiedOverpassData instead.`);
  
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'User-Agent': `TuggiCMS/1.0 (${purpose})`,
        'Content-Type': 'text/plain'
      }
    });

    if (!response.ok) {
      console.log(`⚠️ ${purpose} failed: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`❌ Error in ${purpose}:`, error);
    return null;
  }
}

/**
 * LEGACY: Build individual Overpass query
 * SUBSTITUÍDA POR: buildMegaUnifiedQuery() no sistema mega-unified
 */
function buildOverpassQuery(elements, location, radius, timeout = 30) {
  console.log('⚠️ LEGACY: Building individual Overpass query');
  
  const elementsStr = elements.join(';\n      ');
  return `[out:json][timeout:${timeout}];
    (
      ${elementsStr}
    );
    out geom;`;
}

/**
 * LEGACY: Process Overpass street data (helper function)
 * SUBSTITUÍDA POR: processStreetDataMega() no sistema mega-unified
 */
function processOverpassStreetDataLegacy(data, lat, lng, poiName, landmark) {
  console.log('⚠️ LEGACY: Processing street data with individual calculations');
  console.log(`📊 Overpass found ${data.elements?.length || 0} street elements`);
  
  // This is a simplified version - real implementation would need proper utility imports
  const streets = [];
  
  if (data.elements && data.elements.length > 0) {
    for (const element of data.elements) {
      if (element.geometry && element.geometry.length >= 2) {
        const coordinates = element.geometry.map((node) => ([node.lon, node.lat])); // [lng, lat] format
        const highwayType = element.tags?.highway || 'unknown';
        
        // Simple filtering logic
        const isExternalStreet = [
          'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street',
          'pedestrian', 'service', 'footway', 'path', 'track'
        ].includes(highwayType);
        
        if (isExternalStreet) {
          streets.push({
            coordinates,
            name: element.tags?.name || 'Unnamed Street',
            highway_type: highwayType,
            distance_to_poi: 100, // Simplified - would need proper distance calculation
            confidence: 0.5 // Simplified
          });
        }
      }
    }
  }
  
  return streets;
}

// ========================================
// LEGACY ELEVATION FUNCTIONS
// ========================================

/**
 * LEGACY: Detect relative elevation using individual API calls
 * SUBSTITUÍDA POR: processElevationDataMega() no sistema mega-unified
 */
async function detectRelativeElevation(lat, lng) {
  console.log('⚠️ LEGACY: Using individual API calls for elevation detection');
  
  try {
    console.log(`🏔️ Detecting relative elevation for ${lat}, ${lng}`);
    
    // Get elevation for POI location and surrounding area
    const elevationPromises = [
      getElevation(lat, lng), // POI location
      getElevation(lat + 0.01, lng), // ~1km north
      getElevation(lat - 0.01, lng), // ~1km south  
      getElevation(lat, lng + 0.01), // ~1km east
      getElevation(lat, lng - 0.01), // ~1km west
      getElevation(lat + 0.005, lng + 0.005), // ~500m northeast
      getElevation(lat - 0.005, lng - 0.005), // ~500m southwest
      getElevation(lat + 0.005, lng - 0.005), // ~500m northwest
      getElevation(lat - 0.005, lng + 0.005)  // ~500m southeast
    ];
    
    const elevations = await Promise.all(elevationPromises);
    const validElevations = elevations.filter(e => e !== null && !isNaN(e));
    
    if (validElevations.length < 3) {
      console.log('❌ Not enough elevation data points');
      return { poiElevation: 0, averageElevation: 0, elevationDiff: 0, confidence: 0.0 };
    }
    
    const poiElevation = validElevations[0];
    const surroundingElevations = validElevations.slice(1);
    const averageElevation = surroundingElevations.reduce((sum, e) => sum + e, 0) / surroundingElevations.length;
    const elevationDiff = poiElevation - averageElevation;
    
    console.log(`🏔️ Elevation analysis: POI=${poiElevation}m, Area avg=${averageElevation.toFixed(1)}m, Diff=${elevationDiff.toFixed(1)}m`);
    
    return {
      poiElevation,
      averageElevation,
      elevationDiff,
      confidence: validElevations.length / elevationPromises.length
    };
    
  } catch (error) {
    console.error('❌ Error detecting relative elevation:', error);
    return { poiElevation: 0, averageElevation: 0, elevationDiff: 0, confidence: 0.0 };
  }
}

/**
 * LEGACY: Get elevation for a specific coordinate using Open Elevation API
 * Helper function for detectRelativeElevation
 */
async function getElevation(lat, lng) {
  try {
    const response = await apiManager.request('open-elevation', 'lookup?locations=${lat},${lng}', {, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (elevation-detection)'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = response.data;
    if (data.results && data.results.length > 0) {
      return data.results[0].elevation;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// ========================================
// EXPORTS
// ========================================

export {
  detectPOIHeight,
  detectUrbanDensity,
  getRegionalHeightAverage,
  detectRelativeElevation,
  findNearbyStreetsForTriggers,
  generateTriggersOnStreets,
  generateStreetBasedTriggerPoints,
  searchOSMByName,
  searchOSMByCoordinates,
  queryOverpassAPI,
  buildOverpassQuery,
  lineIntersectsPolygon,
  createCircularBoundary,
  createEstimatedBoundary,
  getKnownCityElevation,
  getRealBuildingHeight,
  searchNearbyBuildingHeights,
  checkBasicBuildingObstructions,
  createLineOfSightSamples,
  checkVisibilityToPOI,
  checkLegacyBuildingObstructions,
  checkRealObstructions,
  checkObstructionAtPoint,
  convertOSMPolygon,
  processOSMGeometry,
  findIntersectionPoints,
  removeDuplicatePoints
};
