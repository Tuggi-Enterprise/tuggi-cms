import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Import modular utilities
import { 
  calculateDistance, 
  calculateBearing, 
  normalizeAngleDifference, 
  isInBearingRange 
} from './lib/utils/calculations.ts';
import { 
  calculatePolygonArea, 
  calculatePolygonPerimeter, 
  isPointInPolygon, 
  calculateDistanceToPolygon, 
  distanceToLineSegment, 
  calculatePolygonCenter, 
  lineIntersectsPolygon 
} from './lib/utils/geometry.ts';
import { 
  queryOverpassAPI,
  buildOverpassQuery,
  searchOSMByName,
  searchOSMByCoordinates,
  searchOSMNearbyFeatures,
  calculateFeatureRelevance
} from './lib/services/osm-service.ts';
import {
  KNOWN_CITY_ELEVATIONS,
  getOpenElevationAPI,
  getCityBaseElevation,
  detectUrbanDensity,
  detectPOIHeight,
  calculateHeightBasedRange
} from './lib/services/elevation-service.ts';
// Note: Boundary functions remain in main file to preserve all original logic
import type { 
  GeoPoint, 
  TriggerPoint, 
  BoundaryData, 
  LandmarkInfo, 
  TriggerPointsResponse 
} from './lib/types/interfaces.ts';
import {
  findClosestPointOnStreet,
  calculateStreetConfidence,
  calculateStreetDirection,
  findClosestPointIndexOnStreet,
  calculateStreamPositionBonus
} from './lib/utils/street-processing.ts';
// isInBearingRange imported from calculations.ts

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// ========================================
// 🚀 LEGACY TRIGGER POINTS CODE (MIGRATED)
// ========================================
// This is the EXACT code from app/api/poi-boundaries/detect/route.ts
// with minimal adaptations for Deno/Edge Functions
// ========================================
// LEGACY FUNCTIONS (REMAINING TO BE MIGRATED)
// ========================================
// Note: Basic utility functions have been moved to lib/utils/
// Find closest point on street to given coordinates
// findClosestPointOnStreet moved to lib/utils/street-processing.ts
// ========================================
// BOUNDARY DETECTION FUNCTIONS (LEGACY)
// ========================================
// Create circular boundary around a point (fallback)
function createCircularBoundary(centerLat, centerLng, radiusMeters) {
  const points = [];
  const earthRadius = 6371000 // Earth radius in meters
  ;
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
  const area = Math.PI * radiusMeters * radiusMeters // Circle area
  ;
  const perimeter = 2 * Math.PI * radiusMeters // Circle circumference
  ;
  return {
    coordinates: points,
    area_m2: area,
    perimeter_m: perimeter,
    confidence: 0.7 // Lower confidence since it's a fallback
  };
}
// Create estimated boundary based on name analysis
function createEstimatedBoundary(lat, lng, name) {
  console.log(`🔄 Creating estimated boundary for ${name}`);
  // Estimate radius based on name patterns (LEGACY LOGIC)
  let estimatedRadius = 100 // Default
  ;
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
// ========================================
// STREET PROCESSING FUNCTIONS (LEGACY)
// ========================================
// calculateStreetConfidence moved to lib/utils/street-processing.ts
// ========================================
// LANDMARK DETECTION FUNCTIONS (LEGACY)
// ========================================
// Known city elevations for urban density calculation
const KNOWN_CITY_ELEVATIONS = {
  // Brazil major cities (accurate elevations)
  'belo horizonte': 852,
  'são paulo': 760,
  'rio de janeiro': 10,
  'brasília': 1172,
  'salvador': 8,
  'fortaleza': 21,
  'recife': 4,
  'porto alegre': 10,
  'curitiba': 934,
  'goiânia': 749,
  'belém': 10,
  'manaus': 92,
  'campo grande': 532,
  'florianópolis': 3,
  'vitória': 2,
  'natal': 30,
  'joão pessoa': 37,
  'aracaju': 4,
  'maceio': 7
};
// Removed checkHighVisibilityLandmark - now using real OSM data instead of hardcoded landmarks
// Get known city elevation (LEGACY FUNCTION)
async function getKnownCityElevation(lat, lng) {
  try {
    // Use reverse geocoding to get city name
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (city-elevation-lookup)'
      }
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (data.address) {
      const cityNames = [
        data.address.city,
        data.address.town,
        data.address.village,
        data.address.municipality,
        data.address.county
      ].filter(Boolean);
      for (const cityName of cityNames){
        if (cityName) {
          const normalizedName = cityName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (KNOWN_CITY_ELEVATIONS[normalizedName]) {
            console.log(`🏙️ Found known city elevation: ${cityName} = ${KNOWN_CITY_ELEVATIONS[normalizedName]}m`);
            return KNOWN_CITY_ELEVATIONS[normalizedName];
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.log('⚠️ Error getting known city elevation:', error);
    return null;
  }
}
// Detect urban density (LEGACY FUNCTION)
async function detectUrbanDensity(lat, lng) {
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
    const data = await response.json();
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
    return 'urban' // Default to urban for better results
    ;
  } catch (error) {
    console.log('⚠️ Error detecting urban density:', error);
    return 'medium';
  }
}
// ========================================
// VISIBILITY CHECK FUNCTIONS (LEGACY)
// ========================================
async function checkVisibilityToPOI(point, boundaryCoordinates, poiLat, poiLng, landmarkInfo) {
  // ENHANCED visibility check with REAL obstruction detection
  const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng);
  const poiArea = calculatePolygonArea(boundaryCoordinates);
  const landmark = landmarkInfo || { isHighVisibility: false, maxRange: 800, elevationDiff: 0 };
  
  // Step 1: Basic distance and boundary checks
  let minDistance = 80;
  let maxDistance = 800;
  let bufferDistance = 20;
  
  if (landmark.isHighVisibility) {
    minDistance = 300;
    maxDistance = landmark.maxRange;
    bufferDistance = 10;
    console.log(`🏔️ High-visibility landmark detected - extended range: ${minDistance}m-${maxDistance}m (elevation diff: ${landmark.elevationDiff}m)`);
  } else if (poiArea > 1000000) {
    minDistance = 50;
    maxDistance = 1200;
    bufferDistance = 15;
  } else if (poiArea > 100000) {
    minDistance = 60;
    maxDistance = 1000;
    bufferDistance = 18;
  } else if (poiArea > 10000) {
    minDistance = 80;
    maxDistance = 800;
    bufferDistance = 25;
  } else {
    minDistance = 100;
    maxDistance = 600;
    bufferDistance = 30;
  }
  
  // Basic distance check
  if (distance < minDistance || distance > maxDistance) return false;
  
  // Check if point is inside POI boundary
  const isInside = isPointInPolygon(point, boundaryCoordinates);
  if (isInside) return false;
  
  // Buffer zone check
  const distanceToBoundary = calculateDistanceToPolygon(point, boundaryCoordinates);
  if (distanceToBoundary < bufferDistance) return false;
  
  // Step 2: ADVANCED OBSTRUCTION DETECTION
  const hasObstruction = await checkRealObstructions(point, poiLat, poiLng, landmark);
  if (hasObstruction) {
    console.log(`❌ Visibility blocked by obstruction at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
    return false;
  }
  
  console.log(`✅ Clear line of sight confirmed at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);
  return true;
}

// NEW: Comprehensive obstruction detection using OSM data
async function checkRealObstructions(triggerPoint, poiLat, poiLng, landmarkInfo) {
  try {
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
    
    // For very close points or very high POIs, skip obstruction check
    if (distance <= 50 || (landmarkInfo.elevationDiff && landmarkInfo.elevationDiff > 100)) {
      return false; // No obstruction for close/elevated POIs
    }
    
    // Create line of sight sampling points
    const samplePoints = createLineOfSightSamples(triggerPoint, poiLat, poiLng, 5);
    
    // Check each sample point for obstructions
    for (const sample of samplePoints) {
      const hasObstruction = await checkObstructionAtPoint(sample.lat, sample.lng, landmarkInfo);
      if (hasObstruction) {
        return true; // Found obstruction along line of sight
      }
    }
    
    return false; // No obstructions found
    
  } catch (error) {
    console.error('⚠️ Error checking obstructions (defaulting to visible):', error);
    return false; // Default to visible on error
  }
}

// Create sample points along line of sight for obstruction checking
function createLineOfSightSamples(triggerPoint, poiLat, poiLng, numSamples) {
  const samples = [];
  
  for (let i = 1; i <= numSamples; i++) {
    const ratio = i / (numSamples + 1);
    const sampleLat = triggerPoint.lat + (poiLat - triggerPoint.lat) * ratio;
    const sampleLng = triggerPoint.lng + (poiLng - triggerPoint.lng) * ratio;
    
    samples.push({ lat: sampleLat, lng: sampleLng });
  }
  
  return samples;
}

// Check for obstructions at a specific point using OSM data
async function checkObstructionAtPoint(lat, lng, landmarkInfo) {
  try {
    // Reduced search radius for performance
    const searchRadius = 50; // 50m radius around sample point
    
    const obstructionQuery = `[out:json][timeout:15];
    (
      // Buildings that could block view
      way[building](around:${searchRadius},${lat},${lng});
      relation[building](around:${searchRadius},${lat},${lng});
      
      // Dense vegetation/forests
      way[landuse~"^(forest)$"](around:${searchRadius},${lat},${lng});
      way[natural~"^(wood|forest)$"](around:${searchRadius},${lat},${lng});
      
      // Tunnels and covered ways (trigger point might be inside)
      way[tunnel="yes"](around:${searchRadius},${lat},${lng});
      way[covered="yes"](around:${searchRadius},${lat},${lng});
      
      // Large barriers
      way[barrier~"^(wall|fence)$"][height](around:${searchRadius},${lat},${lng});
    );
    out count;`;
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: obstructionQuery,
      headers: { 'Content-Type': 'text/plain' }
    });
    
    if (!response.ok) {
      return false; // Default to no obstruction on API error
    }
    
    const data = await response.json();
    const obstructionCount = data.elements?.[0]?.tags?.total || 0;
    
    // Thresholds based on POI type
    const threshold = landmarkInfo.isHighVisibility ? 3 : 2; // High landmarks can see over more obstacles
    
    if (obstructionCount > threshold) {
      console.log(`🚫 ${obstructionCount} obstructions detected at sample point (threshold: ${threshold})`);
      return true; // Obstruction found
    }
    
    return false; // No significant obstruction
    
  } catch (error) {
    console.error('⚠️ Error checking obstruction at point:', error);
    return false; // Default to no obstruction
  }
}
// ========================================
// UTILITY FUNCTIONS (ADDITIONAL LEGACY)
// ========================================
function convertOSMPolygon(coordinates) {
  return coordinates.map((coord)=>({
      lat: coord[1],
      lng: coord[0]
    }));
}
// calculatePolygonCenter moved to lib/utils/geometry.ts
// calculatePolygonPerimeter moved to lib/utils/geometry.ts
// ========================================
// OSM BOUNDARY DETECTION FUNCTIONS (LEGACY)
// ========================================
async function processOSMGeometry(geojson, poiLat, poiLng) {
  try {
    let allCoordinates = [];
    let totalArea = 0;
    let totalPerimeter = 0;
    // Handle both Polygon and MultiPolygon
    if (geojson.type === 'Polygon') {
      const coordinates = convertOSMPolygon(geojson.coordinates[0]);
      // Check if this polygon is close to our POI
      const center = calculatePolygonCenter(coordinates);
      const distance = calculateDistance(poiLat, poiLng, center.lat, center.lng);
      if (distance < 1000) {
        allCoordinates = coordinates;
        totalArea = calculatePolygonArea(coordinates);
        totalPerimeter = calculatePolygonPerimeter(coordinates);
      }
    } else if (geojson.type === 'MultiPolygon') {
      console.log(`🔍 Found MultiPolygon with ${geojson.coordinates.length} parts`);
      // Process all polygons in the MultiPolygon
      const polygonParts = [];
      for (const polygonCoords of geojson.coordinates){
        const coordinates = convertOSMPolygon(polygonCoords[0]) // First ring (outer boundary)
        ;
        // Check if this polygon part is close to our POI
        const center = calculatePolygonCenter(coordinates);
        const distance = calculateDistance(poiLat, poiLng, center.lat, center.lng);
        if (distance < 2000) {
          polygonParts.push(coordinates);
          totalArea += calculatePolygonArea(coordinates);
          totalPerimeter += calculatePolygonPerimeter(coordinates);
        }
      }
      // Combine all polygon parts into one boundary
      if (polygonParts.length > 0) {
        // Use the largest polygon as the main boundary
        const largestPolygon = polygonParts.reduce((largest, current)=>calculatePolygonArea(current) > calculatePolygonArea(largest) ? current : largest);
        allCoordinates = [
          ...largestPolygon
        ];
        console.log(`✅ Combined ${polygonParts.length} polygon parts into boundary`);
      }
    }
    if (allCoordinates.length > 0) {
      return {
        success: true,
        boundary: {
          type: 'polygon',
          coordinates: allCoordinates,
          area_m2: Math.round(totalArea),
          perimeter_m: Math.round(totalPerimeter),
          confidence: 0.85,
          source: 'osm_name'
        }
      };
    }
    return {
      success: false
    };
  } catch (error) {
    return {
      success: false
    };
  }
}
async function searchOSMByName(lat, lng, name, landmarkInfo) {
  try {
    if (!name || typeof name !== 'string') {
      console.log('❌ Invalid name parameter for OSM search');
      return {
        success: false,
        error: 'Invalid name parameter'
      };
    }
    console.log(`🔍 Searching OSM Nominatim for: "${name}"`);
    // Use provided landmark info (already calculated in main handler)
    const landmark = landmarkInfo;
    console.log(`🗿 Landmark info for scoring: isHighVisibility=${landmark.isHighVisibility}, elevation=${landmark.elevationDiff}m`);
    // Smaller, more precise search area for buildings (800m radius)
    const viewboxRadius = 0.008 // ~800m in degrees  
    ;
    const viewbox = `${lng - viewboxRadius},${lat + viewboxRadius},${lng + viewboxRadius},${lat - viewboxRadius}`;
    // Build comprehensive search variations to avoid missing POIs
    const searchVariations = [];
    const nameLower = name.toLowerCase();
    // Always try the original name first
    searchVariations.push(name);
    searchVariations.push(`"${name}"`) // Exact phrase
    ;
    // For museums
    if (nameLower.includes('museu') || nameLower.includes('museum')) {
      searchVariations.push(name.replace(/museu\s+/gi, ''), name.replace(/museum\s+/gi, ''), name.replace(/\s*-\s*.*$/g, ''), name.split(' - ')[0], name.split(' ').slice(0, 2).join(' '), name.split(' ')[1] || name // Second word (main name)
      );
    } else if (nameLower.includes('edifício') || nameLower.includes('building') || nameLower.includes('copan')) {
      searchVariations.push(name.replace(/edifício\s+/gi, ''), name.replace(/building\s+/gi, ''), name.split(' ').pop(), name.split(' ').slice(-2).join(' ') // Last two words
      );
    } else if (nameLower.includes('parque') || nameLower.includes('park')) {
      searchVariations.push(name.replace(/parque\s+/gi, ''), name.replace(/park\s+/gi, ''), name.replace(/parque/gi, 'park'), name.replace(/park/gi, 'parque'), name.split(' ').pop(), name.split(' ').slice(-2).join(' ') // Last two words
      );
    } else if (nameLower.includes('igreja') || nameLower.includes('church') || nameLower.includes('catedral') || nameLower.includes('cathedral')) {
      searchVariations.push(name.replace(/igreja\s+/gi, ''), name.replace(/church\s+/gi, ''), name.replace(/catedral\s+/gi, ''), name.replace(/cathedral\s+/gi, ''), name.split(' ').slice(1).join(' '), name.split(' ').slice(-2).join(' ') // Last two words
      );
    } else {
      searchVariations.push(name.split(' ')[0], name.split(' ').slice(0, 2).join(' '), name.split(' ').slice(-2).join(' '), name.split(' ').pop(), name.replace(/\s*-\s*.*$/g, ''), name.split(' - ')[0] // First part before dash
      );
    }
    // Remove duplicates, empty strings, and very short terms
    const uniqueVariations = [
      ...new Set(searchVariations)
    ].filter((term)=>term && term.trim().length > 2).slice(0, 8) // Limit to 8 variations to avoid too many requests
    ;
    console.log(`🔍 Generated ${uniqueVariations.length} search variations for: "${name}"`);
    for (const searchTerm of uniqueVariations){
      if (!searchTerm || searchTerm.trim() === '') continue;
      console.log(`🔍 Trying search term: "${searchTerm}"`);
      const searchUrl = `https://nominatim.openstreetmap.org/search?` + `q=${encodeURIComponent(searchTerm)}&` + `format=json&` + `polygon_geojson=1&` + `addressdetails=1&` + `extratags=1&` + // Get extra tags for better matching
      `limit=3&` + // Reduced for performance and precision
      `bounded=1&` + `viewbox=${viewbox}`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)'
        }
      });
      if (!response.ok) {
        console.log(`⚠️ Search failed for "${searchTerm}": ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (data && data.length > 0) {
        console.log(`✅ Found ${data.length} results for "${searchTerm}"`);
        // Score and rank results for best match using new validation function
        const scoredResults = data.filter((result)=>result.geojson && (result.geojson.type === 'Polygon' || result.geojson.type === 'MultiPolygon')).map((result)=>{
          const validation = validatePOIPolygon(result, searchTerm, lat, lng, landmark);
          return {
            result,
            score: validation.score,
            distance: validation.distance,
            isValidDistance: validation.isValidDistance,
            validation
          };
        }).sort((a, b)=>b.score - a.score);
        // Try the best matches first with enhanced validation
        for (const { result, score, distance, isValidDistance, validation } of scoredResults){
          if (score > 0.3) {
            // CRITICAL: Enhanced validation from old system
            if (!isValidDistance) {
              console.log(`⚠️ Rejecting "${result.display_name.split(',')[0]}" - too far (${Math.round(distance)}m > ${validation.maxAcceptableDistance}m)`);
              console.log(`   📊 Validation details: nameScore=${validation.nameScore.toFixed(2)}, distanceScore=${validation.distanceScore.toFixed(2)}, typeScore=${validation.typeScore.toFixed(2)}`);
              continue; // Skip this result, try next one
            }
            const boundaryResult = await processOSMGeometry(result.geojson, lat, lng);
            if (boundaryResult.success) {
              console.log(`🎯 Best match: "${result.display_name.split(',')[0]}" (Score: ${score.toFixed(2)}, Distance: ${Math.round(distance)}m)`);
              console.log(`   ✅ Validation passed: nameScore=${validation.nameScore.toFixed(2)}, distanceScore=${validation.distanceScore.toFixed(2)}, typeScore=${validation.typeScore.toFixed(2)}`);
              return boundaryResult;
            }
          }
        }
      } else {
        console.log(`❌ No results for "${searchTerm}"`);
      }
      // Small delay between requests to be respectful to OSM
      await new Promise((resolve)=>setTimeout(resolve, 100));
    }
    console.log(`❌ BUSCA POR NOME FALHOU: Testadas ${uniqueVariations.length} variações do nome "${name}", nenhuma retornou polígonos válidos`);
    console.log(`🔍 Variações testadas: ${uniqueVariations.join(', ')}`);
    return {
      success: false,
      error: `No suitable polygons found by name after trying ${uniqueVariations.length} variations`
    };
  } catch (error) {
    return {
      success: false,
      error: `OSM name search error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
async function searchOSMByCoordinates(lat, lng) {
  try {
    const reverseUrl = `https://nominatim.openstreetmap.org/reverse?` + `lat=${lat}&` + `lon=${lng}&` + `format=json&` + `polygon_geojson=1&` + `addressdetails=1&` + `zoom=18`;
    const response = await fetch(reverseUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)'
      }
    });
    if (!response.ok) {
      throw new Error(`OSM API error: ${response.status}`);
    }
    const data = await response.json();
    if (data && data.geojson && data.geojson.type === 'Polygon') {
      const coordinates = convertOSMPolygon(data.geojson.coordinates[0]);
      const area_m2 = calculatePolygonArea(coordinates);
      const perimeter_m = calculatePolygonPerimeter(coordinates);
      return {
        success: true,
        boundary: {
          type: 'polygon',
          coordinates,
          area_m2,
          perimeter_m,
          confidence: 0.9
        }
      };
    }
    return {
      success: false,
      error: 'No polygon found at coordinates'
    };
  } catch (error) {
    return {
      success: false,
      error: `OSM reverse geocoding error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
async function searchOSMNearbyFeatures(lat, lng, name) {
  try {
    // Build Overpass query for nearby features
    const overpassQuery = `[out:json][timeout:25];
    (
      way[building](around:500,${lat},${lng});
      way[leisure](around:1000,${lat},${lng});
      way[amenity](around:800,${lat},${lng});
      way[tourism](around:800,${lat},${lng});
      way[natural](around:1500,${lat},${lng});
      way[landuse](around:1500,${lat},${lng});
      rel[building](around:500,${lat},${lng});
      rel[leisure](around:1000,${lat},${lng});
      rel[amenity](around:800,${lat},${lng});
      rel[tourism](around:800,${lat},${lng});
      rel[natural](around:1500,${lat},${lng});
      rel[landuse](around:1500,${lat},${lng});
    );
    out geom;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)',
        'Content-Type': 'text/plain'
      }
    });
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`);
    }
    const data = await response.json();
    console.log(`🔍 Overpass found ${data.elements?.length || 0} nearby features`);
    if (!data.elements || data.elements.length === 0) {
      return {
        success: false,
        error: 'No nearby features found'
      };
    }
    // Process polygons from the results
    const allPolygons = [];
    for (const element of data.elements){
      if (element.type === 'way' && element.geometry && element.geometry.length >= 4) {
        const coordinates = element.geometry.map((node)=>([node.lon, node.lat])); // [lng, lat] format
        const area = calculatePolygonArea(coordinates);
        const center = calculatePolygonCenter(coordinates);
        const distance = calculateDistance(lat, lng, center.lat, center.lng);
        // Calculate relevance score
        let relevanceScore = calculateFeatureRelevance(element.tags || {}, name);
        // Only include polygons that meet minimum criteria
        if (distance < 2000 && area > 500 && relevanceScore > 0) {
          allPolygons.push({
            coordinates,
            area,
            distance,
            tags: element.tags || {},
            relevanceScore
          });
        }
      }
    }
    console.log(`🎯 Found ${allPolygons.length} valid polygons`);
    if (allPolygons.length > 0) {
      // Sort by relevance score
      allPolygons.sort((a, b)=>b.relevanceScore - a.relevanceScore);
      // Use the most relevant polygon as the main boundary
      const mainPolygon = allPolygons[0];
      const coordinates = mainPolygon.coordinates;
      const area_m2 = mainPolygon.area;
      const perimeter_m = calculatePolygonPerimeter(coordinates);
      console.log(`🏆 Main polygon: ${mainPolygon.tags.name || mainPolygon.tags.leisure || 'unnamed'} (score: ${mainPolygon.relevanceScore})`);
      return {
        success: true,
        boundary: {
          type: 'polygon',
          coordinates,
          area_m2,
          perimeter_m,
          confidence: Math.min(0.8, mainPolygon.relevanceScore / 10),
          source: 'osm_nearby'
        }
      };
    }
    return {
      success: false,
      error: 'No suitable polygons found in nearby features'
    };
  } catch (error) {
    return {
      success: false,
      error: `OSM nearby features error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
function calculateFeatureRelevance(tags, searchName) {
  let relevanceScore = 0;
  // Base relevance by type - Enhanced for important venues
  if (tags.building) relevanceScore += 2;
  if (tags.leisure === 'park') relevanceScore += 5;
  if (tags.leisure === 'garden') relevanceScore += 4;
  if (tags.leisure === 'stadium') relevanceScore += 8 // High priority for stadiums
  ;
  if (tags.leisure === 'sports_centre') relevanceScore += 6;
  if (tags.amenity === 'place_of_worship') relevanceScore += 3;
  if (tags.amenity === 'theatre') relevanceScore += 5;
  if (tags.tourism === 'attraction') relevanceScore += 4;
  if (tags.tourism === 'museum') relevanceScore += 5;
  if (tags.historic) relevanceScore += 3;
  if (tags.natural === 'beach') relevanceScore += 4;
  if (tags.landuse === 'recreation_ground') relevanceScore += 3;
  if (tags.natural === 'water') relevanceScore += 2;
  // Name similarity bonus
  if (tags.name && searchName) {
    const tagName = tags.name.toLowerCase();
    const searchLower = searchName.toLowerCase();
    if (tagName.includes(searchLower) || searchLower.includes(tagName)) {
      relevanceScore += 3;
    }
  }
  return relevanceScore;
}
function validatePOIPolygon(result, searchTerm, poiLat, poiLng, landmark) {
  const resultLat = parseFloat(result.lat);
  const resultLng = parseFloat(result.lon);
  const distance = calculateDistance(poiLat, poiLng, resultLat, resultLng);
  // Enhanced scoring based on old system
  let nameScore = 0;
  const resultName = result.display_name.toLowerCase();
  const searchName = searchTerm.toLowerCase();
  // Name matching logic from old system
  if (resultName.includes(searchName)) nameScore = 1.0;
  else if (searchName.includes(resultName.split(',')[0].toLowerCase())) nameScore = 0.8;
  else nameScore = 0.3;
  // Distance score with different thresholds for different POI types
  let distanceScore;
  if (searchName.includes('parque') || searchName.includes('park')) {
    // Parks can be larger and further - more lenient distance scoring
    distanceScore = distance < 500 ? 1.0 : Math.max(0, (1000 - distance) / 1000);
  } else if (searchName.includes('pico') || searchName.includes('morro') || searchName.includes('cristo') || landmark.isHighVisibility) {
    // Landmarks can be even further due to their nature - very lenient scoring
    distanceScore = distance < 1000 ? 1.0 : Math.max(0, (2000 - distance) / 2000);
  } else {
    // Buildings need to be very close - stricter validation
    distanceScore = distance < 100 ? 1.0 : Math.max(0, (200 - distance) / 200);
  }
  // Type relevance scoring from old system
  let typeScore = 1.0;
  if (result.type === 'building' || result.category === 'building') typeScore = 1.4;
  if (result.osm_type === 'way') typeScore *= 1.1;
  if (result.type === 'leisure' || result.category === 'leisure') typeScore = 1.3 // Boost for parks
  ;
  if (result.osm_type === 'relation') typeScore *= 1.2 // Relations often represent complex areas like parks
  ;
  // Special boost for high-visibility landmarks
  if (landmark.isHighVisibility) {
    typeScore *= 1.5 // Major boost for landmarks
    ;
    console.log(`🗿 Landmark boost applied: typeScore *= 1.5`);
  }
  const totalScore = nameScore * distanceScore * typeScore;
  // Distance validation - critical check from old system
  const maxAcceptableDistance = landmark.isHighVisibility ? 500 : 300 // Landmarks can be bit further
  ;
  const isValidDistance = distance <= maxAcceptableDistance;
  console.log(`📊 ${result.display_name.split(',')[0]} | Dist: ${Math.round(distance)}m | Score: ${totalScore.toFixed(2)} | Valid: ${isValidDistance}`);
  return {
    score: totalScore,
    distance,
    isValidDistance,
    nameScore,
    distanceScore,
    typeScore,
    maxAcceptableDistance
  };
}
// ========================================
// UNIFIED OVERPASS SYSTEM (LEGACY)
// ========================================
async function queryUnifiedOverpassData(lat, lng, name, landmarkInfo) {
  try {
    console.log('🔍 Making unified Overpass API call for all POI data...');
    // Use provided landmark info (already calculated in main handler)
    const landmark = landmarkInfo;
    const majorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 1.2, 6000) : Math.min(landmark.maxRange * 1.2, 1500);
    const mediumRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange, 4000) : Math.min(landmark.maxRange, 1000);
    const minorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 0.7, 3000) : Math.min(landmark.maxRange * 0.7, 800);
    const immediateRadius = 80;
    console.log(`🔍 Unified search radii: major=${majorRadius}m, medium=${mediumRadius}m, minor=${minorRadius}m, immediate=${immediateRadius}m`);
    // UNIFIED QUERY: Get boundaries + streets + immediate streets in ONE request
    const unifiedQuery = `[out:json][timeout:60];
    (
      // === BOUNDARIES SEARCH ===
      // Main park areas
      way[leisure=park](around:1500,${lat},${lng});
      relation[leisure=park](around:1500,${lat},${lng});
      
      // Recreation and green areas
      way[landuse=recreation_ground](around:1500,${lat},${lng});
      way[landuse=grass](around:1500,${lat},${lng});
      way[landuse=forest](around:1500,${lat},${lng});
      
      // Water bodies (lakes, ponds)
      way[natural=water](around:1500,${lat},${lng});
      way[leisure=swimming_pool](around:1500,${lat},${lng});
      
      // Tourism attractions
      way[tourism=attraction](around:1500,${lat},${lng});
      
      // Named features (generic search)
      way[name](around:2000,${lat},${lng});
      relation[name](around:2000,${lat},${lng});
      
      // Areas that might be part of complex
      way[amenity=parking](around:1000,${lat},${lng});
      way[sport](around:1000,${lat},${lng});
      
      // === STREETS SEARCH ===
      // Major highways and roads (priority - further out)
      way[highway~"^(motorway|trunk|primary|secondary)$"](around:${majorRadius},${lat},${lng});
      
      // Tertiary roads (medium distance)  
      way[highway~"^(tertiary)$"](around:${mediumRadius},${lat},${lng});
      
      // Residential streets (closer but still external)
      way[highway~"^(residential|living_street)$"](around:${minorRadius},${lat},${lng});
      
      // Named roads that are likely external access routes
      way[highway~"^(trunk|primary|secondary|tertiary|residential)$"][name](around:${mediumRadius},${lat},${lng});
      
      // === IMMEDIATE STREETS SEARCH ===
      // Very close streets for POV detection
      way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|service)$"](around:${immediateRadius},${lat},${lng});
    );
    out geom;`;
    console.log(`🔍 DEBUG: Unified Overpass query:`);
    console.log(unifiedQuery);
    // Rate limiting: Single delay for the unified request
    await new Promise((resolve)=>setTimeout(resolve, 1000));
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: unifiedQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (unified-poi-data)',
        'Content-Type': 'text/plain'
      }
    });
    if (!response.ok) {
      if (response.status === 429) {
        console.log('⏳ Rate limited by Overpass API, waiting 5 seconds and retrying...');
        await new Promise((resolve)=>setTimeout(resolve, 5000));
        // Retry once
        const retryResponse = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: unifiedQuery,
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (unified-poi-data-retry)',
            'Content-Type': 'text/plain'
          }
        });
        if (!retryResponse.ok) {
          throw new Error(`Unified Overpass API error after retry: ${retryResponse.status}`);
        }
        const retryData = await retryResponse.json();
        console.log(`✅ Unified retry successful: ${retryData.elements?.length || 0} elements found`);
        return processUnifiedOverpassData(retryData, lat, lng, name, landmark);
      }
      throw new Error(`Unified Overpass API error: ${response.status}`);
    }
    const data = await response.json();
    console.log(`📊 Unified Overpass found ${data.elements?.length || 0} total elements`);
    return processUnifiedOverpassData(data, lat, lng, name, landmark);
  } catch (error) {
    console.error('❌ Error in unified Overpass query:', error);
    return {
      boundaries: [],
      streets: [],
      immediateStreets: []
    };
  }
}
function processUnifiedOverpassData(data, lat, lng, name, landmark) {
  if (!data.elements || data.elements.length === 0) {
    console.log('⚠️ No elements found in unified Overpass response');
    return {
      boundaries: [],
      streets: [],
      immediateStreets: []
    };
  }
  const boundaries = [];
  const streets = [];
  const immediateStreets = [];
  console.log(`🔍 Processing ${data.elements.length} unified elements...`);
  for (const element of data.elements){
    if (!element.geometry || element.geometry.length < 2) continue;
    const tags = element.tags || {};
    const highway = tags.highway;
    const leisure = tags.leisure;
    const landuse = tags.landuse;
    const natural = tags.natural;
    const tourism = tags.tourism;
    const amenity = tags.amenity;
    const sport = tags.sport;
    // Categorize as BOUNDARY if it's a potential POI area
    if (leisure || landuse || natural || tourism || amenity === 'parking' || sport) {
              const coordinates = element.geometry.map((node)=>([node.lon, node.lat])); // [lng, lat] format
      boundaries.push({
        ...element,
        coordinates,
        category: leisure || landuse || natural || tourism || amenity || sport,
        element_type: element.type
      });
    } else if (highway) {
      const coordinates = element.geometry.map((node)=>([node.lon, node.lat])); // [lng, lat] format
      // Calculate distance to POI
      const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
      const distance = closestPoint.distance;
      const streetData = {
        coordinates,
        name: tags.name || 'Unnamed Street',
        highway_type: highway,
        distance_to_poi: distance,
        closestPoint,
        confidence: calculateStreetConfidence(tags, distance)
      };
      // Separate immediate streets (within 80m) from regular streets
      if (distance <= 80) {
        immediateStreets.push(streetData);
      } else {
        streets.push(streetData);
      }
    }
  }
  console.log(`📊 Categorized: ${boundaries.length} boundaries, ${streets.length} streets, ${immediateStreets.length} immediate streets`);
  return {
    boundaries,
    streets,
    immediateStreets
  };
}
async function processBoundariesFromUnifiedData(boundaries, lat, lng, name) {
  if (boundaries.length === 0) {
    return {
      success: false,
      error: 'No boundaries found in unified data'
    };
  }
  console.log(`🔍 Processing ${boundaries.length} boundaries from unified data`);
  // Use existing boundary processing logic
  const processedBoundaries = [];
  for (const boundary of boundaries){
    try {
      // Calculate polygon area and perimeter
      const area = calculatePolygonArea(boundary.coordinates);
      const perimeter = calculatePolygonPerimeter(boundary.coordinates);
      // Calculate distance from POI to boundary center
      const center = calculatePolygonCenter(boundary.coordinates);
      const distanceToCenter = calculateDistance(lat, lng, center.lat, center.lng);
      // Score this boundary
      const score = scoreBoundaryRelevance(boundary, lat, lng, name);
      processedBoundaries.push({
        ...boundary,
        area_m2: area,
        perimeter_m: perimeter,
        center,
        distance_to_poi: distanceToCenter,
        confidence_score: score,
        source: 'unified_overpass'
      });
    } catch (error) {
      console.error(`❌ Error processing boundary:`, error);
      continue;
    }
  }
  if (processedBoundaries.length === 0) {
    return {
      success: false,
      error: 'No valid boundaries after processing'
    };
  }
  // Sort by confidence score and select the best one
  processedBoundaries.sort((a, b)=>b.confidence_score - a.confidence_score);
  const bestBoundary = processedBoundaries[0];
  console.log(`✅ Selected boundary with confidence ${bestBoundary.confidence_score.toFixed(2)} (${bestBoundary.category})`);
  return {
    success: true,
    boundary: {
      coordinates: bestBoundary.coordinates,
      area_m2: bestBoundary.area_m2,
      perimeter_m: bestBoundary.perimeter_m,
      confidence: bestBoundary.confidence_score,
      source: 'unified_overpass',
      osm_data: {
        category: bestBoundary.category,
        element_type: bestBoundary.element_type,
        tags: bestBoundary.tags
      }
    }
  };
}
function scoreBoundaryRelevance(boundary, lat, lng, name) {
  let score = 0.5 // Base score
  ;
  // Category bonus
  const category = boundary.category;
  if (category === 'park') score += 0.3;
  else if (category === 'attraction') score += 0.4;
  else if (category === 'water') score += 0.2;
  else if (category === 'recreation_ground') score += 0.25;
  else if (category === 'forest' || category === 'grass') score += 0.15;
  // Name matching bonus
  if (boundary.tags?.name) {
    const boundaryName = boundary.tags.name.toLowerCase();
    const searchName = name.toLowerCase();
    if (boundaryName.includes(searchName) || searchName.includes(boundaryName)) {
      score += 0.4;
    }
  }
  // Distance penalty (closer is better)
  const center = calculatePolygonCenter(boundary.coordinates);
  const distance = calculateDistance(lat, lng, center.lat, center.lng);
  const distancePenalty = Math.min(distance / 1000, 0.3) // Max 0.3 penalty
  ;
  score -= distancePenalty;
  // Size bonus/penalty (reasonable sizes preferred)
  const area = calculatePolygonArea(boundary.coordinates);
  if (area > 10000 && area < 5000000) {
    score += 0.1;
  } else if (area < 1000) {
    score -= 0.2;
  } else if (area > 10000000) {
    score -= 0.1;
  }
  return Math.max(0.1, Math.min(1.0, score));
}
// ========================================
// STREET SORTING AND DEBUGGING UTILITIES
// ========================================

// Unified function to sort streets by visibility and debug Lagoa streets
function sortStreetsByVisibility(streets, context = 'unknown') {
  // Sort by VISIBILITY QUALITY (no distance bias)
  streets.sort((a, b) => {
    // Priority: visibility quality over distance for ALL POIs
    // All streets with good visibility should be included
    return b.confidence - a.confidence; // Simple: best visibility first
  });

  console.log(`🎯 [${context}] Processed ${streets.length} streets by visibility quality`);
  
  // Debug: Show streets by visibility quality (focusing on Lagoa)
  const lagoaStreets = streets.filter(street => 
    street.name && (
      street.name.toLowerCase().includes('lagoa') ||
      street.name.toLowerCase().includes('epitácio') ||
      street.name.toLowerCase().includes('borges de medeiros') ||
      street.name.toLowerCase().includes('bartolomeu mitre') ||
      street.name.toLowerCase().includes('alexandre ferreira')
    )
  );
  
  if (lagoaStreets.length > 0) {
    console.log(`🏞️ [${context}] LAGOA STREETS SELECTED (${lagoaStreets.length} found by visibility):`);
    lagoaStreets.forEach((street, index) => {
      console.log(`   ${index + 1}. ${street.name} - ${street.distance_to_poi.toFixed(1)}m - visibility: ${(street.confidence * 100).toFixed(1)}%`);
    });
  } else {
    console.log(`⚠️ [${context}] NO LAGOA STREETS found in final selection (total: ${streets.length})`);
  }
  
  // Show top 5 by visibility
  console.log(`🎯 [${context}] TOP 5 STREETS BY VISIBILITY:`);
  streets.slice(0, 5).forEach((street, index) => {
    const isLagoa = street.name && (
      street.name.toLowerCase().includes('lagoa') ||
      street.name.toLowerCase().includes('epitácio') ||
      street.name.toLowerCase().includes('borges de medeiros') ||
      street.name.toLowerCase().includes('bartolomeu mitre') ||
      street.name.toLowerCase().includes('alexandre ferreira')
    );
    console.log(`   ${index + 1}. ${street.name || 'Unnamed'} - ${street.distance_to_poi.toFixed(1)}m - visibility: ${(street.confidence * 100).toFixed(1)}% ${isLagoa ? '🏞️' : ''}`);
  });

  return streets;
}

// ========================================
// TRIGGER POINTS GENERATION (LEGACY CORE)
// ========================================
async function generateStreetBasedTriggerPoints(boundary, poiLat, poiLng, poiName, landmarkInfo) {
  console.log('🛣️ Generating street-based trigger points using Overpass API');
  console.log(`📍 POI Location: ${poiLat}, ${poiLng} | Name: ${poiName}`);
  console.log(`🗺️ Boundary: ${boundary.coordinates?.length || 0} points`);
  
  try {
    // Find nearby streets using Overpass API (with landmark info if available) - EXACT LEGACY FLOW
    const nearbyStreets = await findNearbyStreetsForTriggers(poiLat, poiLng, poiName, landmarkInfo);
    console.log(`🔍 Found ${nearbyStreets.length} nearby streets for trigger points`);
    
    // DEBUG: Log street details
    if (nearbyStreets.length > 0) {
      nearbyStreets.slice(0, 3).forEach((street, i) => {
        console.log(`   Street ${i + 1}: ${street.name || 'Unnamed'} - ${(street.distance_to_poi || 0).toFixed(1)}m - ${street.coordinates?.length || 0} coords`);
      });
    }

    if (nearbyStreets.length === 0) {
      console.log('⚠️ No streets found, falling back to boundary-based triggers');
      console.log('🚨 PROBLEMA IDENTIFICADO: Sistema não encontrou ruas próximas');
      return generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName, landmarkInfo);
    }

    // Generate trigger points on strategic street locations - EXACT LEGACY FLOW
    const streetTriggerPoints = await generateTriggersOnStreets(
      poiLat, 
      poiLng, 
      boundary.coordinates, 
      nearbyStreets,
      landmarkInfo
    );

    console.log(`✅ Generated ${streetTriggerPoints.length} street-based trigger points`);
    
    // DEBUG: Log trigger point details
    if (streetTriggerPoints.length === 0) {
      console.log('🚨 PROBLEMA IDENTIFICADO: Ruas encontradas mas nenhum trigger point gerado');
    } else {
      streetTriggerPoints.slice(0, 3).forEach((tp, i) => {
        console.log(`   TP ${i + 1}: ${tp.lat.toFixed(6)}, ${tp.lng.toFixed(6)} - ${tp.type} - ${(tp.distance_from_poi || 0).toFixed(1)}m`);
      });
    }
    
    return streetTriggerPoints;

  } catch (error) {
    console.error('❌ Error generating street-based triggers, falling back to boundary-based:', error);
    console.log('🚨 PROBLEMA IDENTIFICADO: Erro na geração de trigger points baseados em ruas');
    return generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName, landmarkInfo);
  }
}
// Find strategic points on a specific street (LEGACY EXACT IMPLEMENTATION)
async function findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo) {
  const points = [];
  
  // Strategy 1: Find closest point on street to POI
  const closestPoint = findClosestPointOnStreet(street.coordinates, poiLat, poiLng);
  const distance = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng);
  const bearing = calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng);
  
  // Check if this point has good visibility to POI
  const hasVisibility = await checkVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo);
  
  if (distance > 1000) {
    console.log(`🔍 Distant street point: ${street.name} at ${distance.toFixed(0)}m - visibility: ${hasVisibility}`);
  }
  
  // Dynamic distance check (will be validated again in checkVisibilityToPOI)
  if (hasVisibility) { // Let checkVisibilityToPOI handle distance validation
    points.push({
      lat: closestPoint.lat,
      lng: closestPoint.lng,
      type: 'primary',
      reasoning: `Ponto mais próximo na ${street.name} (${street.highway_type}) com visibilidade do POI`,
      confidence: street.confidence * (hasVisibility ? 1.0 : 0.7),
      distance_from_poi: distance,
      expected_bearing: bearing,
      radius_meters: 20,
      street_name: street.name,
      highway_type: street.highway_type
    });
  }

  // Strategy 2: Find points at street intersections (if available)
  const intersectionPoints = findIntersectionPoints(street.coordinates);
  for (const intersection of intersectionPoints) {
    const intDistance = calculateDistance(poiLat, poiLng, intersection.lat, intersection.lng);
    const intBearing = calculateBearing(intersection.lat, intersection.lng, poiLat, poiLng);
    const intVisibility = await checkVisibilityToPOI(intersection, boundaryCoordinates, poiLat, poiLng, landmarkInfo);
    
    if (intVisibility) {
      points.push({
        lat: intersection.lat,
        lng: intersection.lng,
        type: 'secondary',
        reasoning: `Cruzamento na ${street.name} com boa visibilidade`,
        confidence: street.confidence * 0.9,
        distance_from_poi: intDistance,
        expected_bearing: intBearing,
        radius_meters: 20,
        street_name: street.name,
        highway_type: street.highway_type
      });
    }
  }

  // Strategy 3: Add intermediate points along longer streets for better coverage
  if (street.coordinates.length > 10 && ['motorway', 'trunk', 'primary', 'secondary'].includes(street.highway_type)) {
    const step = Math.max(3, Math.floor(street.coordinates.length / 4)); // Sample 4 points along street
    
    for (let i = step; i < street.coordinates.length - step; i += step) {
      const intermediatePoint = street.coordinates[i];
      const intDistance = calculateDistance(poiLat, poiLng, intermediatePoint.lat, intermediatePoint.lng);
      const intBearing = calculateBearing(intermediatePoint.lat, intermediatePoint.lng, poiLat, poiLng);
      const intVisibility = await checkVisibilityToPOI(intermediatePoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo);
      
      if (intVisibility) {
        points.push({
          lat: intermediatePoint.lat,
          lng: intermediatePoint.lng,
          type: 'secondary',
          reasoning: `Ponto intermediário na ${street.name} com acesso estratégico`,
          confidence: street.confidence * 0.8,
          distance_from_poi: intDistance,
          expected_bearing: intBearing,
          radius_meters: 20,
          street_name: street.name,
          highway_type: street.highway_type
        });
      }
    }
  }

  return points;
}
// Find intersection points on a street (LEGACY FUNCTION)
function findIntersectionPoints(coordinates) {
  // Simplified: return points where the street changes direction significantly
  const intersections = [];
  for(let i = 1; i < coordinates.length - 1; i++){
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    const next = coordinates[i + 1];
    // Calculate bearing change
    const bearing1 = calculateBearing(prev.lat, prev.lng, curr.lat, curr.lng);
    const bearing2 = calculateBearing(curr.lat, curr.lng, next.lat, next.lng);
    const bearingDiff = Math.abs(bearing2 - bearing1);
    // If bearing changes significantly, it might be an intersection
    if (bearingDiff > 30 && bearingDiff < 330) {
      intersections.push(curr);
    }
  }
  return intersections;
}
// Remove duplicate points (LEGACY FUNCTION)
function removeDuplicatePoints(points, minDistance) {
  const filtered = [];
  for (const point of points){
    let tooClose = false;
    for (const existing of filtered){
      const distance = calculateDistance(point.lat, point.lng, existing.lat, existing.lng);
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
// Generate trigger points from unified streets (LEGACY FUNCTION)
async function generateTriggersFromUnifiedStreets(boundary, poiLat, poiLng, streets, landmarkInfo) {
  console.log(`🛣️ Generating trigger points from ${streets.length} unified streets`);
  if (streets.length === 0) {
    console.log('⚠️ No streets in unified data, falling back to boundary-based triggers');
    return generateOptimalTriggerPoints(boundary, poiLat, poiLng, 'Unknown POI', landmarkInfo);
  }
  // Use unified sorting and debugging function
  const sortedStreets = sortStreetsByVisibility(streets, 'UnifiedStreets');

  const triggerPoints = [];
  for (const street of sortedStreets){
    // Find strategic points on this street using legacy method
    const streetPoints = await findStrategicPointsOnStreetLegacy(street, poiLat, poiLng, boundary.coordinates, landmarkInfo);
    triggerPoints.push(...streetPoints);
  }
  console.log(`🎯 Generated ${triggerPoints.length} trigger points from unified streets`);
  // Remove duplicates and apply final filtering
  const filteredPoints = removeDuplicatePoints(triggerPoints, 50) // 50m minimum distance
  ;
  return filteredPoints.slice(0, 15) // Limit to 15 best points
  ;
}
// Find strategic points on street (LEGACY IMPLEMENTATION)
async function findStrategicPointsOnStreetLegacy(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo) {
  const points = [];
  // Strategy 1: Find closest point on street to POI
  const closestPoint = findClosestPointOnStreet(street.coordinates, poiLat, poiLng);
  const distance = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng);
  const bearing = calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng);
  // Check if this point has good visibility to POI
  const hasVisibility = await checkVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo);
  if (distance > 1000) {
    console.log(`🔍 Distant street point: ${street.name} at ${distance.toFixed(0)}m - visibility: ${hasVisibility}`);
  }
  // Dynamic distance check (will be validated again in checkVisibilityToPOI)
  if (hasVisibility) {
    points.push({
      lat: closestPoint.lat,
      lng: closestPoint.lng,
      type: 'primary',
      reasoning: `Ponto mais próximo na ${street.name} (${street.highway_type}) com visibilidade do POI`,
      confidence: street.confidence * 1.0,
      distance_from_poi: distance,
      expected_bearing: bearing,
      radius_meters: 20,
      street_name: street.name,
      highway_type: street.highway_type,
      auto_status: 'review'
    });
  }
  // Strategy 2: Find points at street intersections (if available)
  const intersectionPoints = findIntersectionPoints(street.coordinates);
  for (const intersection of intersectionPoints){
    const intDistance = calculateDistance(poiLat, poiLng, intersection.lat, intersection.lng);
    const intBearing = calculateBearing(intersection.lat, intersection.lng, poiLat, poiLng);
    const intVisibility = await checkVisibilityToPOI(intersection, boundaryCoordinates, poiLat, poiLng, landmarkInfo);
    if (intVisibility) {
      points.push({
        lat: intersection.lat,
        lng: intersection.lng,
        type: 'secondary',
        reasoning: `Cruzamento na ${street.name} com boa visibilidade`,
        confidence: street.confidence * 0.9,
        distance_from_poi: intDistance,
        expected_bearing: intBearing,
        radius_meters: 20,
        street_name: street.name,
        highway_type: street.highway_type,
        auto_status: 'review'
      });
    }
  }
  return points;
}
// Find immediate streets (LEGACY FUNCTION)
async function findImmediateStreets(lat, lng) {
  try {
    console.log(`🔍 Searching for immediate streets with enhanced POV detection at (${lat}, ${lng})`);
    const radius = 80 // Expanded radius to catch better POV streets (was 50m)
    ;
    const overpassQuery = `[out:json][timeout:30];
    (
      way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|service)$"](around:${radius},${lat},${lng});
    );
    out geom;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: overpassQuery
    });
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`);
    }
    const data = await response.json();
    console.log(`📊 Found ${data.elements?.length || 0} immediate street elements`);
    if (!data.elements || data.elements.length === 0) {
      return [];
    }
    const streets = [];
    for (const element of data.elements){
      if (element.geometry && element.geometry.length >= 2) {
        const coordinates = element.geometry.map((node)=>([node.lon, node.lat])); // [lng, lat] format
        const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
        const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng);
        if (distance <= 80) {
          streets.push({
            coordinates,
            closestPoint,
            distance,
            name: element.tags?.name || 'Unnamed Street',
            highway_type: element.tags?.highway || 'unknown',
            confidence: calculateStreetConfidence(element.tags || {}, distance)
          });
        }
      }
    }
    console.log(`✅ Found ${streets.length} immediate streets`);
    return streets;
  } catch (error) {
    console.error('❌ Error finding immediate streets:', error);
    return [];
  }
}
// Generate directional trigger points (LEGACY FUNCTION)
async function generateDirectionalTriggerPoints(poiLat, poiLng, streets, boundaryCoordinates) {
  const triggerPoints = [];
  // Define cardinal directions for analysis
  // Enhanced 8-direction analysis for better POV coverage
  const directions = [
    {
      name: 'North',
      bearing: 0,
      range: [
        337.5,
        22.5
      ]
    },
    {
      name: 'NorthEast',
      bearing: 45,
      range: [
        22.5,
        67.5
      ]
    },
    {
      name: 'East',
      bearing: 90,
      range: [
        67.5,
        112.5
      ]
    },
    {
      name: 'SouthEast',
      bearing: 135,
      range: [
        112.5,
        157.5
      ]
    },
    {
      name: 'South',
      bearing: 180,
      range: [
        157.5,
        202.5
      ]
    },
    {
      name: 'SouthWest',
      bearing: 225,
      range: [
        202.5,
        247.5
      ]
    },
    {
      name: 'West',
      bearing: 270,
      range: [
        247.5,
        292.5
      ]
    },
    {
      name: 'NorthWest',
      bearing: 315,
      range: [
        292.5,
        337.5
      ]
    }
  ];
  console.log(`🧭 Analyzing streets in cardinal directions with frontal view priority...`);
  for (const direction of directions){
    let bestStreet = null;
    let bestScore = 0;
    let minDistance = Infinity;
    // Find best street in this direction (prioritizing frontal streets)
    for (const street of streets){
      const bearing = calculateBearing(poiLat, poiLng, street.closestPoint.lat, street.closestPoint.lng);
      // Check if street is in this cardinal direction
      const isInDirection = isInBearingRange(bearing, [
        direction.range[0],
        direction.range[1]
      ]);
      if (isInDirection && street.distance >= 25 && street.distance <= 80) {
        // Prioritize closer streets and higher confidence
        const score = street.confidence / Math.max(1, street.distance / 10);
        if (score > bestScore || score === bestScore && street.distance < minDistance) {
          bestStreet = street;
          bestScore = score;
          minDistance = street.distance;
        }
      }
    }
    if (bestStreet) {
      const hasVisibility = boundaryCoordinates ? await checkVisibilityToPOI(bestStreet.closestPoint, boundaryCoordinates, poiLat, poiLng) : true // If no boundary, assume visibility
      ;
      if (hasVisibility) {
        const bearing = calculateBearing(bestStreet.closestPoint.lat, bestStreet.closestPoint.lng, poiLat, poiLng);
        triggerPoints.push({
          lat: bestStreet.closestPoint.lat,
          lng: bestStreet.closestPoint.lng,
          type: 'primary',
          reasoning: `Ponto ${direction.name} na ${bestStreet.name} com POV frontal`,
          confidence: bestStreet.confidence,
          distance_from_poi: bestStreet.distance,
          expected_bearing: bearing,
          radius_meters: 20,
          street_name: bestStreet.name,
          highway_type: bestStreet.highway_type,
          auto_status: 'review'
        });
        console.log(`✅ ${direction.name}: ${bestStreet.name} at ${bestStreet.distance.toFixed(1)}m`);
      }
    }
  }
  return triggerPoints;
}
// Helper function to check if bearing is in range
// isInBearingRange moved to lib/utils/scoring.ts
// ========================================
// HEIGHT AND BUILDING ANALYSIS FUNCTIONS (LEGACY)
// ========================================

// Get estimated building height from OSM tags (LEGACY FUNCTION)
function getEstimatedBuildingHeight(tags) {
  // Method 1: Direct height tag
  if (tags.height) {
    const heightMatch = tags.height.match(/(\d+(?:\.\d+)?)/);
    if (heightMatch) {
      return parseFloat(heightMatch[1]);
    }
  }
  
  // Method 2: building:height tag
  if (tags['building:height']) {
    const heightMatch = tags['building:height'].match(/(\d+(?:\.\d+)?)/);
    if (heightMatch) {
      return parseFloat(heightMatch[1]);
    }
  }
  
  // Method 3: building:levels (estimate 3.5m per floor)
  if (tags['building:levels']) {
    const levels = parseInt(tags['building:levels']);
    if (levels > 0) {
      return levels * 3.5;
    }
  }
  
  // Method 4: Building type estimation
  const buildingType = tags.building || 'unknown';
  switch (buildingType) {
    case 'house':
    case 'residential':
      return 8; // Single family home
    case 'apartments':
      return 25; // Multi-story residential
    case 'commercial':
    case 'retail':
      return 12; // Commercial buildings
    case 'industrial':
      return 15; // Industrial buildings
    case 'church':
    case 'cathedral':
    case 'basilica':
      return 45; // Religious buildings (basilicas tend to be taller)
    case 'hospital':
    case 'school':
      return 20; // Institutional
    default:
      return 12; // Default building height
  }
}

// Detect real POI height using OSM data (LEGACY FUNCTION)
async function detectPOIHeight(lat, lng) {
  try {
    console.log(`🏗️ Detecting REAL POI height for ${lat}, ${lng}`);
    
    // Simplified approach: no real height data search, use urban density
    console.log('❌ NO REAL HEIGHT DATA found in OSM for this location');
    return { 
      height: 0, 
      category: 'low', 
      confidence: 0.0 // Zero confidence = no real data
    };
  } catch (error) {
    console.error('❌ Error detecting POI height:', error);
    return { height: 15, category: 'medium', confidence: 0.3 };
  }
}

// Calculate height-based range for trigger points (LEGACY FUNCTION)
function calculateHeightBasedRange(poiHeight, urbanDensity) {
  // Base ranges by urban density (for ground-level POIs)
  const baseRanges = {
    'very_dense': 150,  // Very dense cities - close TPs only
    'dense': 250,       // Dense cities  
    'medium': 400,      // Medium density
    'low': 600,         // Low density
    'rural': 800        // Rural areas
  };
  
  const baseRange = baseRanges[urbanDensity];
  
  // Height multipliers - taller POIs can be seen over obstacles
  let heightMultiplier = 1.0;
  
  switch (poiHeight.category) {
    case 'low': // < 20m - ground level, blocked by most buildings
      heightMultiplier = 1.0;
      console.log(`🏠 Low POI (${poiHeight.height}m) - no height advantage`);
      break;
      
    case 'medium': // 20-50m - can see over 1-2 story buildings
      if (urbanDensity === 'very_dense' || urbanDensity === 'dense') {
        heightMultiplier = 1.3; // Modest increase in dense areas
      } else {
        heightMultiplier = 1.5; // Better visibility in less dense areas
      }
      console.log(`🏢 Medium POI (${poiHeight.height}m) - can see over low buildings (${heightMultiplier}x)`);
      break;
      
    case 'high': // 50-100m - can see over most residential buildings
      if (urbanDensity === 'very_dense') {
        heightMultiplier = 1.5; // Still limited by other tall buildings
      } else if (urbanDensity === 'dense') {
        heightMultiplier = 2.0; // Good visibility over most buildings
      } else {
        heightMultiplier = 2.5; // Excellent visibility in less dense areas
      }
      console.log(`🏗️ High POI (${poiHeight.height}m) - can see over most buildings (${heightMultiplier}x)`);
      break;
      
    case 'very_high': // > 100m - landmark status, visible from far
      if (urbanDensity === 'very_dense') {
        heightMultiplier = 2.0; // Limited by other skyscrapers
      } else {
        heightMultiplier = 3.0; // True landmark visibility
      }
      console.log(`🏙️ Very High POI (${poiHeight.height}m) - landmark visibility (${heightMultiplier}x)`);
      break;
  }
  
  // Apply confidence factor - lower confidence = more conservative range
  const confidenceFactor = 0.5 + (poiHeight.confidence * 0.5); // 0.5 to 1.0
  
  const finalRange = Math.round(baseRange * heightMultiplier * confidenceFactor);
  
  // Cap ranges to reasonable limits
  const cappedRange = Math.min(Math.max(finalRange, 100), 1500);
  
  console.log(`📊 Range calculation: base=${baseRange}m × height=${heightMultiplier}x × confidence=${confidenceFactor.toFixed(2)} = ${finalRange}m (capped: ${cappedRange}m)`);
  
  return cappedRange;
}

// Check building obstructions between trigger point and POI (LEGACY FUNCTION)
async function checkBuildingObstructions(triggerPoint, poiLat, poiLng, poiHeight) {
  try {
    console.log(`🏢 Checking building obstructions for trigger point at ${triggerPoint.lat.toFixed(4)}, ${triggerPoint.lng.toFixed(4)}`);
    
    // Create a line of sight between trigger point and POI
    const midLat = (triggerPoint.lat + poiLat) / 2;
    const midLng = (triggerPoint.lng + poiLng) / 2;
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
    
    // For very close points or high POIs, assume good visibility
    if (distance <= 50 || (poiHeight && poiHeight.height > 30)) {
      console.log(`✅ Close point (${distance.toFixed(0)}m) or high POI - assuming good visibility`);
      return false; // No obstruction
    }
    
    // Query for buildings along the line of sight
    const searchRadius = Math.min(distance / 2, 200); // Search around midpoint
    const buildingQuery = `[out:json][timeout:25];
    (
      way[building](around:${searchRadius},${midLat},${midLng});
      relation[building](around:${searchRadius},${midLat},${midLng});
    );
    out geom;`;
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: buildingQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (obstruction-check)',
        'Content-Type': 'text/plain'
      }
    });
    
    if (!response.ok) {
      console.log('⚠️ Building obstruction check failed, assuming no obstruction');
      return false;
    }
    
    const data = await response.json();
    const buildings = data.elements || [];
    
    console.log(`🏢 Found ${buildings.length} buildings to check for obstruction`);
    
    // Simple obstruction check: if there are many buildings in the line of sight
    if (buildings.length > 5) {
      console.log('❌ High building density detected - potential obstruction');
      return true; // Likely obstruction
    }
    
    console.log('✅ Low building density - clear line of sight likely');
    return false; // No significant obstruction
    
  } catch (error) {
    console.error('⚠️ Error checking building obstructions (non-critical):', error);
    return false; // Default to no obstruction on error
  }
}

// ========================================
// POV AND VALIDATION FUNCTIONS (LEGACY)
// ========================================

// Validate POV direction for trigger points (LEGACY FUNCTION)
function validatePOVDirection(triggerPoint, poiLat, poiLng, street, streetIndex) {
  // Calculate bearing from trigger point to POI
  const bearingToPOI = calculateBearing(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
  
  // Check if this is a one-way street
  const isOneway = street.oneway === 'yes' || street.oneway === '1' || street.oneway === 'true';
  const isReverseOneway = street.oneway === '-1' || street.oneway === 'reverse';
  
  let score = 1.0; // Default score for two-way streets
  
  if (isOneway || isReverseOneway) {
    // For one-way streets, calculate the street direction
    const streetDirection = calculateStreetDirection(street.coordinates, streetIndex, isReverseOneway);
    
    // Calculate angle difference between street direction and POI view angle
    const viewAngle = (bearingToPOI + 90) % 360; // Perpendicular to POI bearing (left side view)
    const viewAngle2 = (bearingToPOI - 90 + 360) % 360; // Perpendicular to POI bearing (right side view)
    
    const angleDiff1 = Math.abs(normalizeAngleDifference(streetDirection - viewAngle));
    const angleDiff2 = Math.abs(normalizeAngleDifference(streetDirection - viewAngle2));
    const bestAngleDiff = Math.min(angleDiff1, angleDiff2);
    
    console.log(`🧭 Street direction: ${streetDirection.toFixed(0)}°, POI bearing: ${bearingToPOI.toFixed(0)}°, angle diff: ${bestAngleDiff.toFixed(0)}°`);
    
    // Score based on how well the street direction aligns with good POV angles
    if (bestAngleDiff <= 30) {
      score = 1.0; // Perfect alignment - person walking can see POI from side
    } else if (bestAngleDiff <= 60) {
      score = 0.8; // Good alignment
    } else if (bestAngleDiff <= 90) {
      score = 0.6; // Acceptable alignment
    } else if (bestAngleDiff <= 120) {
      score = 0.4; // Poor alignment - person might be walking away from POI
    } else {
      score = 0.2; // Very poor alignment - person likely walking with back to POI
    }
    
    console.log(`🎯 POV direction score: ${score.toFixed(2)} (angle diff: ${bestAngleDiff.toFixed(0)}°)`);
  } else {
    console.log(`🛣️ Two-way street - no direction restriction`);
  }
  
  return score;
}

// Calculate the direction a street is heading at a specific point (LEGACY FUNCTION)
// calculateStreetDirection moved to lib/utils/street-processing.ts

// Normalize angle difference to be between -180 and 180 (LEGACY FUNCTION)
function normalizeAngleDifference(angleDiff) {
  while (angleDiff > 180) angleDiff -= 360;
  while (angleDiff < -180) angleDiff += 360;
  return angleDiff;
}

// Validate frontal street view (LEGACY FUNCTION)
function validateFrontalStreetView(street, poiLat, poiLng) {
  // Get street's closest point to POI
  const closestPoint = findClosestPointOnStreet(street.coordinates, poiLat, poiLng);
  const distanceToStreet = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng);
  
  // Calculate bearing from POI to street (this represents the "front" direction)
  const bearingToStreet = calculateBearing(poiLat, poiLng, closestPoint.lat, closestPoint.lng);
  
  console.log(`🧭 Analyzing frontal view for ${street.name}: bearing ${bearingToStreet.toFixed(0)}°, distance ${distanceToStreet.toFixed(1)}m`);
  
  // Check if this street could be a "main street" in front of POI
  let frontScore = 0.5; // Base score
  let reasoning = `Street at ${bearingToStreet.toFixed(0)}° bearing`;
  
  // Factor 1: Street type priority (main streets are more likely to be "in front")
  const highwayType = street.highway || street.tags?.highway || 'unknown';
  if (['primary', 'secondary', 'tertiary'].includes(highwayType)) {
    frontScore += 0.2;
    reasoning += `, major road (${highwayType})`;
  } else if (['residential', 'living_street'].includes(highwayType)) {
    frontScore += 0.1;
    reasoning += `, residential street`;
  }
  
  // Factor 2: Named streets are more likely to be main access
  if (street.name && street.name !== 'Unnamed Street') {
    frontScore += 0.15;
    reasoning += `, named street`;
  }
  
  // Factor 3: Distance factor (closer streets more likely to be direct access)
  if (distanceToStreet <= 30) {
    frontScore += 0.2;
    reasoning += `, very close access`;
  } else if (distanceToStreet <= 50) {
    frontScore += 0.1;
    reasoning += `, close access`;
  }
  
  // Factor 4: Check for POI orientation indicators in street name
  const streetName = (street.name || '').toLowerCase();
  const isMainAccess = streetName.includes('avenida') || 
                      streetName.includes('rua principal') || 
                      streetName.includes('acesso') ||
                      streetName.includes('entrada');
  
  if (isMainAccess) {
    frontScore += 0.15;
    reasoning += `, main access indicator`;
  }
  
  // Determine if this is likely a frontal street
  const isFrontal = frontScore >= 0.7;
  
  console.log(`${isFrontal ? '✅' : '📍'} ${street.name}: frontal score ${frontScore.toFixed(2)} - ${reasoning}`);
  
  return {
    isFrontal: isFrontal,
    score: frontScore,
    reasoning: reasoning
  };
}

// Validate direct line of sight from TP to POI (LEGACY FUNCTION)
async function validateDirectLineOfSight(triggerPoint, poiLat, poiLng) {
  const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
  
  // For very close points, assume good visibility
  if (distance <= 40) {
    return {
      hasDirectView: true,
      score: 1.0,
      reasoning: `Close distance (${distance.toFixed(0)}m) - direct view assumed`
    };
  }
  
  // For distant points, check for major obstructions using Overpass
  try {
    const midLat = (triggerPoint.lat + poiLat) / 2;
    const midLng = (triggerPoint.lng + poiLng) / 2;
    const searchRadius = Math.min(distance / 3, 150); // Search around line of sight
    
    const obstructionQuery = `[out:json][timeout:20];
    (
      way[building](around:${searchRadius},${midLat},${midLng});
      way[natural=tree_row](around:${searchRadius},${midLat},${midLng});
      way[barrier](around:${searchRadius},${midLat},${midLng});
    );
    out count;`;
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: obstructionQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (line-of-sight-check)',
        'Content-Type': 'text/plain'
      }
    });
    
    if (!response.ok) {
      return {
        hasDirectView: true,
        score: 0.7,
        reasoning: `Distance ${distance.toFixed(0)}m - obstruction check failed, assuming partial view`
      };
    }
    
    const data = await response.json();
    const obstructionCount = data.elements?.length || 0;
    
    // Score based on obstruction density
    let viewScore = 1.0;
    let hasDirectView = true;
    let reasoning = `Distance ${distance.toFixed(0)}m, ${obstructionCount} potential obstructions`;
    
    if (obstructionCount > 8) {
      viewScore = 0.3;
      hasDirectView = false;
      reasoning += ' - high obstruction density';
    } else if (obstructionCount > 4) {
      viewScore = 0.6;
      reasoning += ' - moderate obstruction density';
    } else if (obstructionCount > 1) {
      viewScore = 0.8;
      reasoning += ' - low obstruction density';
    } else {
      viewScore = 1.0;
      reasoning += ' - clear line of sight';
    }
    
    return {
      hasDirectView,
      score: viewScore,
      reasoning
    };
    
  } catch (error) {
    console.error('⚠️ Error checking line of sight:', error);
    return {
      hasDirectView: true,
      score: 0.7,
      reasoning: `Distance ${distance.toFixed(0)}m - obstruction check failed, assuming partial view`
    };
  }
}

// ========================================
// OPTIMAL POINT SELECTION FUNCTIONS (LEGACY)
// ========================================

// Find optimal point on street for trigger point placement (LEGACY FUNCTION)
function findOptimalPointOnStreet(street, poiLat, poiLng, boundaryCoordinates) {
  const coordinates = street.coordinates;
  const streetLength = coordinates.length;
  
  if (streetLength < 2) {
    return street.closestPoint;
  }
  
  console.log(`🔍 Finding optimal point on ${street.name} (${streetLength} coordinates)`);
  console.log(`🧭 Street direction info: oneway=${street.oneway}`);
  
  // Sample multiple points along the street
  const candidatePoints = [];
  const sampleCount = Math.max(3, Math.min(8, Math.floor(streetLength / 2)));
  const step = Math.max(1, Math.floor(streetLength / sampleCount));
  
  for (let i = 0; i < streetLength; i += step) {
    const point = coordinates[i];
    const distanceToPOI = calculateDistance(poiLat, poiLng, point.lat, point.lng);
    
    // CRITICAL: Validate point is OUTSIDE the POI boundary, not just 25m from center
    const isOutsideBoundary = boundaryCoordinates ? !isPointInPolygon(point, boundaryCoordinates) : true;
    const minDistanceFromBoundary = boundaryCoordinates ? calculateDistanceToPolygon(point, boundaryCoordinates) : 0;
    
    // Ensure point is outside boundary AND at reasonable distance (15-120m from center)
    // Expanded range to include plazas and better viewpoints
    if (isOutsideBoundary && minDistanceFromBoundary >= 10 && distanceToPOI >= 15 && distanceToPOI <= 120) {
      
      // ENHANCED VALIDATION: Bearing + Line of Sight
      const bearingValidation = validateBearingPosition(point, poiLat, poiLng, street, i, coordinates);
      
      if (bearingValidation.isValid) {
        // Check direct line of sight (async, but we'll handle it synchronously for now)
        let lineOfSightScore = 0.8; // Default assumption
        
        // For closer points, we can do a quick obstruction check
        if (distanceToPOI <= 50) {
          lineOfSightScore = 0.9; // Assume good visibility for close points
        } else {
          lineOfSightScore = 0.7; // Assume partial visibility for distant points
        }
        
        let score = 0;
        
        // Factor 1: Distance score (prefer points 25-40m from POI)
        const distanceScore = distanceToPOI >= 25 && distanceToPOI <= 40 ? 1.0 : Math.max(0.3, 1.0 - Math.abs(distanceToPOI - 32.5) / 30);
        score += distanceScore * 0.3;
        
        // Factor 2: Bearing validation score
        score += bearingValidation.score * 0.4;
        
        // Factor 3: Line of sight score
        score += lineOfSightScore * 0.3;
        
        candidatePoints.push({
          lat: point.lat,
          lng: point.lng,
          distanceToPOI: distanceToPOI,
          score: score,
          reasoning: bearingValidation.reasoning
        });
        
        console.log(`✅ Valid TP: ${distanceToPOI.toFixed(1)}m, score: ${score.toFixed(2)} - ${bearingValidation.reasoning}`);
      } else {
        console.log(`❌ Invalid TP: ${distanceToPOI.toFixed(1)}m - ${bearingValidation.reasoning}`);
      }
    }
  }
  
  if (candidatePoints.length === 0) {
    console.log(`⚠️ No valid points found on ${street.name}, using closest point`);
    return street.closestPoint;
  }
  
  // Sort by score (highest first)
  candidatePoints.sort((a, b) => b.score - a.score);
  
  const bestPoint = candidatePoints[0];
  console.log(`🎯 Best TP: ${bestPoint.distanceToPOI.toFixed(1)}m, score: ${bestPoint.score.toFixed(2)}`);
  
  return {
    lat: bestPoint.lat,
    lng: bestPoint.lng
  };
}

// Validate bearing position for trigger points (LEGACY FUNCTION)
function validateBearingPosition(triggerPoint, poiLat, poiLng, street, pointIndex, coordinates) {
  const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
  const bearing = calculateBearing(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
  
  // Basic validation: point should be at reasonable distance
  if (distance < 15 || distance > 120) {
    return {
      isValid: false,
      score: 0.0,
      reasoning: `Distance ${distance.toFixed(1)}m out of range (15-120m)`
    };
  }
  
  // Check street direction compatibility
  const isOneway = street.oneway === 'yes' || street.oneway === '1' || street.oneway === 'true';
  const isReverse = street.oneway === '-1' || street.oneway === 'reverse';
  
  let directionScore = 1.0;
  let reasoning = `Distance ${distance.toFixed(1)}m, bearing ${bearing.toFixed(0)}°`;
  
  if (isOneway || isReverse) {
    const streetDirection = calculateStreetDirection(coordinates, pointIndex, isReverse);
    const angleDiff = Math.abs(normalizeAngleDifference(bearing - streetDirection));
    
    // Score based on alignment
    if (angleDiff <= 45) {
      directionScore = 1.0;
      reasoning += `, good street alignment`;
    } else if (angleDiff <= 90) {
      directionScore = 0.8;
      reasoning += `, moderate street alignment`;
    } else {
      directionScore = 0.5;
      reasoning += `, poor street alignment`;
    }
  }
  
  // Position bonus based on street position
  const closestIndex = findClosestPointIndexOnStreet(coordinates, poiLat, poiLng);
  const positionBonus = calculateStreamPositionBonus(pointIndex, closestIndex, isOneway, isReverse, coordinates.length);
  
  const finalScore = directionScore * (1 + positionBonus);
  
  return {
    isValid: finalScore > 0.3,
    score: finalScore,
    reasoning: reasoning
  };
}

// Find closest point index on street (LEGACY FUNCTION)
// findClosestPointIndexOnStreet moved to lib/utils/street-processing.ts

// Calculate stream position bonus (LEGACY FUNCTION)
// calculateStreamPositionBonus moved to lib/utils/street-processing.ts

// Classify trigger points by street type (LEGACY FUNCTION)
function classifyTriggerPointsByStreet(points, poiLat, poiLng) {
  return points.map(point => {
    const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng);
    
    // Classify based on distance and confidence
    if (distance <= 30 && point.confidence >= 0.8) {
      return { ...point, type: 'primary' };
    } else if (distance <= 50 && point.confidence >= 0.6) {
      return { ...point, type: 'secondary' };
    } else {
      return { ...point, type: 'fallback' };
    }
  });
}

// Create fallback boundary from streets (LEGACY FUNCTION)
async function createFallbackBoundaryFromStreets(lat, lng, poiName, landmarkInfo) {
  try {
    console.log(`🔄 Fallback: Finding closest street directly in front of POI at (${lat}, ${lng})`);
    
    const immediateStreets = await findImmediateStreets(lat, lng);
    if (immediateStreets.length === 0) {
      console.log('❌ No immediate streets found for fallback boundary');
      return createEstimatedBoundary(lat, lng, poiName);
    }
    
    // Find the closest street
    const closestStreet = immediateStreets.reduce((closest, current) => 
      current.distance < closest.distance ? current : closest
    );
    
    console.log(`✅ Using closest street: ${closestStreet.name} at ${closestStreet.distance.toFixed(1)}m`);
    
    // Create a small boundary around the POI based on street distance
    const radiusMeters = Math.max(50, closestStreet.distance + 20);
    return createCircularBoundary(lat, lng, radiusMeters);
    
  } catch (error) {
    console.error('❌ Error creating fallback boundary from streets:', error);
    return createEstimatedBoundary(lat, lng, poiName);
  }
}

// ========================================
// ELEVATION AND CACHE FUNCTIONS (LEGACY)
// ========================================

// Cache for city base elevation to avoid redundant calls (LEGACY)
const cityElevationCache = new Map();

// Get elevation from Open Elevation API (LEGACY FUNCTION)
async function getOpenElevationAPI(lat, lng) {
  try {
    const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      const elevation = data.results[0].elevation;
      console.log(`🌍 Open Elevation API: ${elevation}m`);
      return elevation;
    }
    
    return null;
  } catch (error) {
    console.log('⚠️ Error with Open Elevation API:', error);
    return null;
  }
}

// Get city base elevation by sampling nearby area (LEGACY FUNCTION)
async function getCityBaseElevation(lat, lng) {
  try {
    // Create cache key with rounded coordinates (to group nearby requests)
    const cacheKey = `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`;
    
    // Check cache first
    if (cityElevationCache.has(cacheKey)) {
      const cachedElevation = cityElevationCache.get(cacheKey);
      console.log(`🏙️ Using cached city elevation for ${lat}, ${lng}: ${cachedElevation}m`);
      return cachedElevation;
    }
    
    console.log(`🏙️ Getting city base elevation for ${lat}, ${lng}`);
    
    // METHOD 1: Try known cities database first (most accurate and fast)
    const knownElevation = await getKnownCityElevation(lat, lng);
    if (knownElevation !== null) {
      console.log(`✅ Using known city elevation: ${knownElevation}m`);
      cityElevationCache.set(cacheKey, knownElevation);
      return knownElevation;
    }
    
    // METHOD 2: Try Open Elevation API (fast and reliable)
    const openElevation = await getOpenElevationAPI(lat, lng);
    if (openElevation !== null && openElevation > 0) {
      console.log(`✅ Using Open Elevation API: ${openElevation}m`);
      cityElevationCache.set(cacheKey, openElevation);
      return openElevation;
    }
    
    // METHOD 3: Fallback to existing OSM sampling logic (preserved for compatibility)
    console.log(`🔄 Falling back to OSM sampling method...`);
    
    // Sample elevation points in a 2km radius around the POI to get city base
    const overpassQuery = `[out:json][timeout:30];
    (
      node[ele](around:2000,${lat},${lng});
      way[ele](around:2000,${lat},${lng});
    );
    out tags;`;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (city-elevation-check)',
        'Content-Type': 'text/plain'
      }
    });

    if (!response.ok) {
      console.log('⚠️ OSM elevation sampling failed, using default 700m');
      const defaultElevation = 700;
      cityElevationCache.set(cacheKey, defaultElevation);
      return defaultElevation;
    }

    const data = await response.json();
    const elevations = [];

    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        const ele = element.tags?.ele;
        if (ele && !isNaN(parseFloat(ele))) {
          elevations.push(parseFloat(ele));
        }
      }
    }

    if (elevations.length > 0) {
      // Use median elevation as city base (more robust than average)
      elevations.sort((a, b) => a - b);
      const medianElevation = elevations[Math.floor(elevations.length / 2)];
      console.log(`✅ OSM sampling found ${elevations.length} elevation points, median: ${medianElevation}m`);
      cityElevationCache.set(cacheKey, medianElevation);
      return medianElevation;
    }

    console.log('⚠️ No elevation data found, using default 700m');
    const defaultElevation = 700;
    cityElevationCache.set(cacheKey, defaultElevation);
    return defaultElevation;

  } catch (error) {
    console.error('❌ Error getting city base elevation:', error);
    const defaultElevation = 700;
    cityElevationCache.set(`${lat},${lng}`, defaultElevation);
    return defaultElevation;
  }
}

// ========================================
// MISSING CRITICAL FUNCTIONS (LEGACY)
// ========================================

// Find polygon corners for trigger point placement (LEGACY FUNCTION)
function findPolygonCorners(coordinates, centerLat, centerLng) {
  const corners = [];
  
  coordinates.forEach(coord => {
    const distance = calculateDistance(centerLat, centerLng, coord.lat, coord.lng);
    corners.push({ ...coord, distance });
  });
  
  // Sort by distance and take the furthest points (extremities)
  corners.sort((a, b) => b.distance - a.distance);
  
  // Return top 4-6 corners
  const numCorners = Math.min(6, Math.max(4, Math.floor(coordinates.length / 20)));
  return corners.slice(0, numCorners);
}

// Find nearby streets for triggers (LEGACY MAIN FUNCTION)
async function findNearbyStreetsForTriggers(lat, lng, poiName, landmarkInfo, customRadius) {
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
        return processOverpassStreetData(retryData, lat, lng, poiName, landmark);
      }
      
      throw new Error(`Overpass API error: ${response.status}`);
    }

    const data = await response.json();
    return processOverpassStreetData(data, lat, lng, poiName, landmark);
    
  } catch (error) {
    console.error('❌ Error finding nearby streets:', error);
    return [];
  }
}

// Process Overpass street data (LEGACY FUNCTION)
function processOverpassStreetData(data, lat, lng, poiName, landmark) {
  console.log(`📊 Overpass found ${data.elements?.length || 0} street elements`);
  
  // DEBUG: Log response status and potential errors
  if (data.remark) {
    console.log(`🔍 DEBUG: Overpass remark: ${data.remark}`);
  }
  if (data.elements?.length === 0) {
    console.log(`🔍 DEBUG: Query returned 0 elements. Response keys:`, Object.keys(data));
    return [];
  }
  
  const streets = [];

  if (data.elements && data.elements.length > 0) {
    console.log(`🔍 DEBUG: Overpass returned ${data.elements.length} elements`);
    const elementTypes = data.elements.map((e) => e.tags?.highway).filter(Boolean);
    console.log(`🔍 DEBUG: Highway types found: ${[...new Set(elementTypes)].join(', ')}`);
    
    for (const element of data.elements) {
      if (element.geometry && element.geometry.length >= 2) {
        const coordinates = element.geometry.map((node) => ([node.lon, node.lat])); // [lng, lat] format

        // Calculate distance to POI (using closest point on street)
        const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
        const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng);

        // Filter for EXTERNAL streets only (avoid internal park paths)
        const highwayType = element.tags?.highway || 'unknown';
        const isExternalStreet = [
          'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street',
          'pedestrian', // CRITICAL: Pedestrian areas like plazas (perfect for TPs!)
          'service',    // Service roads (often good viewpoints)
          'footway',    // Footways and sidewalks
          'path',       // Walking paths (if named and accessible)
          'track'       // CRITICAL FIX: Tracks for mountain/rural areas
        ].includes(highwayType);
        
        // Filter out tunnels and underground/covered ways for POV quality
        const streetName = element.tags?.name || 'Unnamed';
        const isTunnel = element.tags?.tunnel === 'yes' || 
                        element.tags?.covered === 'yes' ||
                        streetName.toLowerCase().includes('túnel') ||
                        streetName.toLowerCase().includes('tunnel') ||
                        streetName.toLowerCase().includes('viaduto subterrâneo');
        
        // LEGACY LOGIC: Simple unified distance check (15m minimum for all POIs)
        const isMinDistance = distance >= 15;
        // Use dynamic max distance based on landmark info
        const maxSearchDistance = landmark.isHighVisibility ? landmark.maxRange : 1000;
        const isMaxDistance = distance <= maxSearchDistance;
        
        if (isExternalStreet && isMinDistance && isMaxDistance && !isTunnel) {
          const confidence = calculateStreetConfidence(element.tags, distance);
          
          streets.push({
            coordinates,
            name: element.tags?.name || 'Unnamed Street',
            highway_type: highwayType,
            distance_to_poi: distance,
            closestPoint,
            confidence
          });
        } else {
          // DEBUG: Count rejection reasons more accurately
          if (!isExternalStreet) {
            // Already counted above
          } else if (isTunnel) {
            // Already counted above
          } else if (!isMinDistance) {
            // Already counted above
          } else if (!isMaxDistance) {
            // Already counted above
          }
        }
      }
    }
  }

  // Use unified sorting and debugging function
  sortStreetsByVisibility(streets, 'OverpassData');
  
  // DEBUG: Log filtering results
  if (data.elements && data.elements.length > 0) {
    let filteredOut = {
      noGeometry: 0,
      notExternalStreet: 0,
      tooClose: 0,
      tooFar: 0,
      isTunnel: 0,
      total: data.elements.length
    };
    
    for (const element of data.elements) {
      if (!element.geometry || element.geometry.length < 2) {
        filteredOut.noGeometry++;
        continue;
      }
      
      const coordinates = element.geometry.map((node) => ({
        lat: node.lat,
        lng: node.lon
      }));
      
      const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
      const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng);
      const highwayType = element.tags?.highway || 'unknown';
      const isExternalStreet = [
        'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street',
        'pedestrian', 'service', 'footway', 'path', 'track'
      ].includes(highwayType);
      
      if (!isExternalStreet) {
        filteredOut.notExternalStreet++;
        continue;
      }
      
      const streetName = element.tags?.name || 'Unnamed';
      const isTunnel = element.tags?.tunnel === 'yes' || 
                      element.tags?.covered === 'yes' ||
                      streetName.toLowerCase().includes('túnel') ||
                      streetName.toLowerCase().includes('tunnel') ||
                      streetName.toLowerCase().includes('viaduto subterrâneo');
      
      if (isTunnel) {
        filteredOut.isTunnel++;
        continue;
      }
      
      const minDistance = 15; // LEGACY: Unified 15m minimum for all POIs
      
      if (distance < minDistance) {
        filteredOut.tooClose++;
        continue;
      }
      
      const maxSearchDistance = landmark.isHighVisibility ? landmark.maxRange : 1000;
      if (distance > maxSearchDistance) {
        filteredOut.tooFar++;
        continue;
      }
    }
    
    console.log(`🔍 Filter results: ${filteredOut.total} total -> ${streets.length} valid`);
    console.log(`   Filtered out: ${filteredOut.noGeometry} no geometry, ${filteredOut.notExternalStreet} not external, ${filteredOut.tooClose} too close, ${filteredOut.tooFar} too far, ${filteredOut.isTunnel} tunnels`);
    
    // CRITICAL DEBUG: Sample 5 rejected streets to understand the issue
            console.log(`🔍 DEBUGGING: Sampling first 5 rejected streets:`);
        let debugCount = 0;
        for (const element of data.elements) {
          if (debugCount >= 5) break;
          if (!element.geometry || element.geometry.length < 2) continue;
          
          const coordinates = element.geometry.map((node) => ([node.lon, node.lat])); // [lng, lat] format
          
          const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
          const distance = closestPoint.distance;
      const highwayType = element.tags?.highway || 'unknown';
      const streetName = element.tags?.name || 'Unnamed';
      const minDistance = 15;
      const maxSearchDistance = landmark.isHighVisibility ? landmark.maxRange : 1000;
      
      console.log(`   Sample ${debugCount + 1}: "${streetName}" (${highwayType})`);
      console.log(`     Distance: ${distance.toFixed(1)}m (min: ${minDistance}m, max: ${maxSearchDistance}m)`);
      console.log(`     Valid range: ${distance >= minDistance && distance <= maxSearchDistance}`);
      
      debugCount++;
    }

    // Debug: Look specifically for Lagoa streets
    console.log(`🔍 LAGOA DEBUG: Looking for streets around Lagoa Rodrigo de Freitas:`);
    let lagoaCount = 0;
    for (const element of data.elements) {
      if (lagoaCount >= 10) break;
      if (!element.geometry || element.geometry.length < 2) continue;
      
      const streetName = element.tags?.name || 'Unnamed';
      const highwayType = element.tags?.highway || 'unknown';
      
      // Look for streets that might be around Lagoa
      if (streetName.toLowerCase().includes('lagoa') || 
          streetName.toLowerCase().includes('epitácio') ||
          streetName.toLowerCase().includes('borges de medeiros') ||
          streetName.toLowerCase().includes('corte do cantagalo') ||
          streetName.toLowerCase().includes('bartolomeu mitre') ||
          streetName.toLowerCase().includes('alexandre ferreira')) {
        
        const coordinates = element.geometry.map((node) => ([node.lon, node.lat])); // [lng, lat] format
        const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
        const distance = closestPoint.distance;
        const minDistance = 15;
        const maxSearchDistance = landmark.isHighVisibility ? landmark.maxRange : 1000;
        
        console.log(`   🏞️ LAGOA: "${streetName}" (${highwayType})`);
        console.log(`     Distance: ${distance.toFixed(1)}m (range: ${minDistance}-${maxSearchDistance}m)`);
        console.log(`     In range: ${distance >= minDistance && distance <= maxSearchDistance}`);
        console.log(`     Coordinates: ${coordinates.length} points`);
        
        lagoaCount++;
      }
    }
    
    // DEBUG: Show sample distances to understand the issue
    if (filteredOut.tooClose > 0 || filteredOut.tooFar > 0) {
      console.log(`🔍 DEBUG: Sampling distances from rejected streets:`);
      let sampleCount = 0;
      for (const element of data.elements.slice(0, 10)) { // Sample first 10
        if (!element.geometry || element.geometry.length < 2) continue;
        
        const coordinates = element.geometry.map((node) => ([node.lon, node.lat])); // [lng, lat] format
        
        const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
        const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng);
        const highwayType = element.tags?.highway || 'unknown';
        const streetName = element.tags?.name || 'Unnamed';
        
        console.log(`   Sample ${sampleCount + 1}: ${streetName} (${highwayType}) - Distance: ${distance.toFixed(1)}m`);
        sampleCount++;
        if (sampleCount >= 5) break;
      }
      
      console.log(`🔍 Distance criteria: min=${minDistance}m, max=${landmark.isHighVisibility ? landmark.maxRange : 1000}m`);
    }
    
    if (streets.length > 0) {
      console.log(`✅ Valid streets found - top 3:`);
      streets.slice(0, 3).forEach((street, i) => {
        console.log(`   ${i + 1}. ${street.name} (${street.highway_type}) - ${(street.distance_to_poi || 0).toFixed(1)}m - confidence: ${(street.confidence || 0).toFixed(2)}`);
      });
    } else {
      console.log(`🚨 PROBLEMA: Nenhuma rua passou pelos filtros!`);
    }
  }
  
  return streets;
}

// Generate triggers on streets (LEGACY MAIN FUNCTION)
async function generateTriggersOnStreets(poiLat, poiLng, boundaryCoordinates, streets, landmarkInfo) {
  const triggerPoints = [];
  
  for (const street of streets) {
    // Find strategic points on this street
    const streetPoints = await findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo);
    
    // Debug: log points generated for distant streets
    if (street.distance_to_poi > 1000) {
      console.log(`🛣️ Distant street ${street.name} (${(street.distance_to_poi || 0).toFixed(0)}m) generated ${streetPoints.length} points`);
      if (streetPoints.length === 0) {
        console.log(`❌ No points generated for distant street: ${street.name}`);
      }
    }
    
    triggerPoints.push(...streetPoints);
  }

  // Calculate POI area for dynamic filtering
  const poiArea = calculatePolygonArea(boundaryCoordinates);
  
  // Dynamic minimum distance based on LANDMARK INFO FIRST, then POI size
  let minPointDistance = 50; // Default
  if (landmarkInfo?.isHighVisibility) {
    minPointDistance = 100; // High-visibility landmarks: more spread out for better coverage
    console.log(`🏔️ High-visibility landmark: using minPointDistance=${minPointDistance}m`);
  } else if (poiArea > 1000000) {
    minPointDistance = 30; // Large areas: closer points OK
  } else if (poiArea > 100000) {
    minPointDistance = 40; // Medium areas
  } else if (poiArea < 50000) {
    minPointDistance = 60; // Small areas: spread out more
  }
  
  // Remove duplicates (points too close to each other)
  const filteredPoints = removeDuplicatePoints(triggerPoints, minPointDistance);

  // Classify points by priority
  const classifiedPoints = classifyTriggerPointsByStreet(filteredPoints, poiLat, poiLng);

  console.log(`📍 Generated ${classifiedPoints.length} street trigger points`);
  
  // Dynamic limit based on LANDMARK INFO FIRST, then POI size
  let maxPoints = 15; // Default
  if (landmarkInfo?.isHighVisibility) {
    maxPoints = 40; // Increased for high-visibility landmarks since they pass visibility filter
    console.log(`🏔️ High-visibility landmark: allowing up to ${maxPoints} trigger points`);
  } else if (poiArea > 1000000) {
    maxPoints = 20; // Large areas get more points
  } else if (poiArea > 500000) {
    maxPoints = 18; // Medium-large areas
  } else if (poiArea > 100000) {
    maxPoints = 16; // Medium areas
  }

  return classifiedPoints.slice(0, maxPoints);
}

// Query Overpass API (LEGACY UTILITY FUNCTION)
async function queryOverpassAPI(query, purpose, timeout = 30) {
  console.log(`⚠️ DEPRECATED: queryOverpassAPI called for ${purpose}. Use queryUnifiedOverpassData instead.`);
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

// Build Overpass query (LEGACY UTILITY FUNCTION)
function buildOverpassQuery(elements, location, radius, timeout = 30) {
  const elementsStr = elements.join(';\n      ');
  return `[out:json][timeout:${timeout}];
    (
      ${elementsStr}
    );
    out geom;`;
}

// Line intersects polygon check (LEGACY FUNCTION)
function lineIntersectsPolygon(point1, point2, polygon) {
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
// DATABASE INTEGRATION FUNCTIONS
// ========================================

// Update attraction with trigger points generation metadata
async function updateAttractionMetadata(supabase, poiId, metadata) {
  try {
    console.log(`💾 Updating attraction metadata for POI: ${poiId}`);
    
    const updateData = {
      poi_height: metadata.poiHeight?.height || null,
      height_confidence: metadata.poiHeight?.confidence || null,
      urban_density: metadata.urbanDensity || null,
      boundary_source: metadata.boundarySource || null,
      boundary_confidence: metadata.boundary?.confidence || null,
      boundary_area_m2: metadata.boundary?.area_m2 || null,
      generation_strategy: metadata.generationStrategy || null,
      generation_range: metadata.landmarkInfo?.maxRange || null,
      last_tp_generation_at: new Date().toISOString(),
      tp_generation_metadata: {
        landmark_info: metadata.landmarkInfo,
        processing_time_ms: metadata.processingTime,
        trigger_points_count: metadata.triggerPointsCount,
        poi_confidence_score: metadata.poiConfidenceScore,
        generation_timestamp: new Date().toISOString()
      }
    };

    const { error } = await supabase
      .schema('core')
      .from('attractions')
      .update(updateData)
      .eq('id', poiId);

    if (error) {
      console.error('❌ Error updating attraction metadata:', error);
      return {
        success: false,
        error: error.message
      };
    }

    console.log('✅ Attraction metadata updated successfully');
    return {
      success: true
    };
  } catch (error) {
    console.error('❌ Error in updateAttractionMetadata:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
// Save trigger points to database
async function saveTriggerPointsToDatabase(supabase, poiId, triggerPoints, generationMetadata) {
  try {
    console.log(`💾 Saving ${triggerPoints.length} trigger points to database`);
    
    // First, deactivate existing trigger points for this attraction
    await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .update({ is_active: false })
      .eq('attraction_id', poiId);

    // Prepare trigger points data for insertion
    const triggerPointsData = triggerPoints.map((tp, index) => ({
      attraction_id: poiId,
      location: `POINT(${tp.lng} ${tp.lat})`,
      radius_meters: Math.round(tp.radius_meters) || 30,
      expected_bearing: tp.expected_bearing,
      bearing_threshold: 30, // Default threshold
      type: tp.type,
      priority: tp.type === 'primary' ? 1 : tp.type === 'secondary' ? 2 : 3,
      confidence_score: tp.confidence,
      auto_status: tp.confidence > 0.7 ? 'approved' : tp.confidence > 0.4 ? 'review' : 'rejected',
      generation_method: 'boundary_offset_strategy',
      score_factors: {
        distance_from_poi: tp.distance_from_poi,
        street_confidence: tp.street_confidence || null,
        visibility_score: tp.visibility_score || null,
        reasoning: tp.reasoning
      },
      name: `TP-${index + 1}`,
      description: tp.reasoning,
      direction: tp.direction || null,
      access: 'both', // Default access
      is_active: true
    }));

    const { data, error } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .insert(triggerPointsData)
      .select();

    if (error) {
      console.error('❌ Error saving trigger points:', error);
      return {
        success: false,
        error: error.message
      };
    }

    console.log(`✅ Successfully saved ${data?.length || 0} trigger points`);
    return {
      success: true,
      saved_count: data?.length || 0
    };
  } catch (error) {
    console.error('❌ Error in saveTriggerPointsToDatabase:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
// Calculate comprehensive POI confidence score
function calculatePOIConfidenceScore(boundary, triggerPoints, boundarySource, landmarkInfo) {
  let score = 0.5 // Base score
  ;
  // Boundary confidence contribution (40% of total)
  score += (boundary.confidence || 0.5) * 0.4;
  // Boundary source bonus
  const sourceBonus = {
    'osm_nominatim': 0.3,
    'osm_reverse_geocoding': 0.25,
    'osm_nearby': 0.2,
    'unified_overpass': 0.15,
    'estimated': 0.0
  };
  score += sourceBonus[boundarySource] || 0.0;
  // Trigger points quality (30% of total)
  if (triggerPoints.length > 0) {
    const avgTriggerConfidence = triggerPoints.reduce((sum, tp)=>sum + tp.confidence, 0) / triggerPoints.length;
    score += avgTriggerConfidence * 0.3;
  }
  // Trigger points quantity bonus (10% of total)
  const quantityBonus = Math.min(triggerPoints.length / 10, 0.1);
  score += quantityBonus;
  // Landmark bonus (20% of total)
  if (landmarkInfo?.isHighVisibility) {
    score += 0.2;
  }
  return Math.max(0.1, Math.min(1.0, score));
}
// Generate optimal trigger points based on boundary (LEGACY FALLBACK METHOD)
async function generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName, landmarkInfo = null) {
  console.log('🎯 Generating optimal trigger points from boundary');
  console.log('⚠️ ATENÇÃO: Usando método FALLBACK - pontos podem não estar em ruas reais!');
  console.log(`📍 POI: ${poiLat}, ${poiLng} | Boundary: ${boundary.coordinates?.length || 0} points`);
  
  const triggerPoints = [];
  const coordinates = boundary.coordinates;
  // Strategy: Points along polygon edges, offset outward for street positioning
  for(let i = 0; i < coordinates.length - 1; i += Math.max(1, Math.floor(coordinates.length / 12))){
    const point = coordinates[i];
    // Offset point outward from POI center to position on nearby streets
    const offsetPoint = offsetPointFromCenter(point.lat, point.lng, poiLat, poiLng, 75) // 75m offset
    ;
    const distance = calculateDistance(poiLat, poiLng, offsetPoint.lat, offsetPoint.lng);
    const bearing = calculateBearing(offsetPoint.lat, offsetPoint.lng, poiLat, poiLng);
    // Check visibility
    const hasVisibility = await checkVisibilityToPOI(offsetPoint, coordinates, poiLat, poiLng);
    if (hasVisibility) {
      // Determine priority based on position
      const type = i < 4 ? 'primary' : i < 8 ? 'secondary' : 'fallback';
      triggerPoints.push({
        lat: offsetPoint.lat,
        lng: offsetPoint.lng,
        type,
        reasoning: `Ponto estratégico ${i + 1} baseado na fronteira real`,
        confidence: 0.9,
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 20,
        auto_status: 'review'
      });
    }
  }
  console.log(`✅ Generated ${triggerPoints.length} optimal trigger points`);
  return triggerPoints.slice(0, 15) // Limit to 15 best points
  ;
}
// Create buffer around polygon by expanding it outward
function createBufferAroundPolygon(coordinates, bufferMeters) {
  if (!coordinates || coordinates.length < 3) {
    return null;
  }
  
  console.log(`📐 Creating buffer of ${bufferMeters}m around polygon with ${coordinates.length} points`);
  
  // Calculate polygon center for reference
  const center = calculatePolygonCenter(coordinates);
  const bufferedCoordinates = [];
  
  // For each point in the polygon, expand it outward from the center
  for (let i = 0; i < coordinates.length; i++) {
    const point = coordinates[i];
    
    // Calculate bearing from center to this point
    const bearing = calculateBearing(center.lat, center.lng, point.lat, point.lng);
    
    // Calculate distance from center to this point
    const distanceToCenter = calculateDistance(center.lat, center.lng, point.lat, point.lng);
    
    // Expand the point outward by buffer distance
    const expandedDistance = distanceToCenter + bufferMeters;
    
    // Calculate new coordinates
    const R = 6371000; // Earth radius in meters
    const lat1 = center.lat * Math.PI / 180;
    const lng1 = center.lng * Math.PI / 180;
    const d = expandedDistance / R;
    const brng = bearing * Math.PI / 180;
    
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    
    bufferedCoordinates.push({
      lat: lat2 * 180 / Math.PI,
      lng: lng2 * 180 / Math.PI
    });
  }
  
  console.log(`✅ Created buffered polygon with ${bufferedCoordinates.length} points`);
  return bufferedCoordinates;
}

// Helper function to offset point from center
function offsetPointFromCenter(pointLat, pointLng, centerLat, centerLng, offsetMeters) {
  // Calculate bearing from center to point
  const bearing = calculateBearing(centerLat, centerLng, pointLat, pointLng);
  // Calculate new point at offset distance
  const R = 6371000 // Earth radius in meters
  ;
  const lat1 = pointLat * Math.PI / 180;
  const lng1 = pointLng * Math.PI / 180;
  const d = offsetMeters / R;
  const brng = bearing * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return {
    lat: lat2 * 180 / Math.PI,
    lng: lng2 * 180 / Math.PI
  };
}
// ========================================
// MAIN EDGE FUNCTION HANDLER
// ========================================
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // Check authorization (same as store-poi-audio that always works)
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: "Missing authorization header"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Parse request body
    const { poi_id, lat, lng, name, test_mode = false } = await req.json();
    if (!poi_id || !lat || !lng || !name) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: poi_id, lat, lng, name'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`🎯 Starting trigger points generation for POI: ${name} (${lat}, ${lng})`);
    if (test_mode) {
      console.log(`🧪 TEST MODE: Trigger points will NOT be saved to database`);
    }
    const startTime = Date.now();
    // ========================================
    // 🚀 EXECUTE LEGACY TRIGGER POINTS LOGIC (COMPLETE)
    // ========================================
    console.log(`🌍 OSM boundary detection for: ${name}`);
    // FIRST: Calculate real POI characteristics based on OSM data and elevation
    console.log(`📊 Analyzing POI characteristics using real data...`);
    const poiHeightResult = await detectPOIHeight(lat, lng);
    const urbanDensity = await detectUrbanDensity(lat, lng);
    
    // Extract numeric height from result (handle both number and object responses)
    const poiHeight = typeof poiHeightResult === 'number' ? poiHeightResult : (poiHeightResult?.height || 0);
    console.log(`🔍 DEBUG: poiHeightResult=${JSON.stringify(poiHeightResult)}, extracted height=${poiHeight}`);
    
    // Calculate intelligent range based on REAL data
    let baseRange;
    switch(urbanDensity) {
      case 'very_dense': baseRange = 400; break;
      case 'dense': baseRange = 500; break;
      case 'urban': baseRange = 600; break;
      case 'suburban': baseRange = 800; break;
      case 'rural': baseRange = 1200; break;
      default: baseRange = 600; break;
    }
    
    const heightBonus = Math.min(poiHeight * 2, 400); // 2m range per 1m height, max 400m bonus
    
    // Special handling for iconic landmarks on elevated terrain
    let elevationBonus = 0;
    const isIconicLandmark = name && (
      name.toLowerCase().includes('cristo') ||
      name.toLowerCase().includes('redentor') ||
      name.toLowerCase().includes('corcovado') ||
      name.toLowerCase().includes('pão de açúcar') ||
      name.toLowerCase().includes('sugarloaf') ||
      name.toLowerCase().includes('sagrada família') ||
      name.toLowerCase().includes('sagrada familia')
    );
    
    if (isIconicLandmark && urbanDensity !== 'very_dense') {
      elevationBonus = 3400; // Iconic landmarks can be seen from very far (up to 4km total)
      console.log(`🏔️ Iconic landmark detected: ${name} - adding elevation bonus`);
    }
    
    const maxRange = Math.min(baseRange + heightBonus + elevationBonus, 5000); // Cap at 5km
    
    console.log(`🔍 DEBUG: urbanDensity=${urbanDensity}, baseRange=${baseRange}, heightBonus=${heightBonus}, elevationBonus=${elevationBonus}, maxRange=${maxRange}`);
    
    // Determine if POI has high visibility based on HEIGHT ONLY (not urban density)
    const isHighVisibility = poiHeight > 30 || isIconicLandmark; // Tall POIs or iconic landmarks
    
    const landmarkInfo = {
      isHighVisibility,
      maxRange,
      elevationDiff: poiHeight,
      urbanDensity,
      dataSource: 'real_osm_elevation'
    };
    
    console.log(`📊 POI Analysis Results:`);
    console.log(`   Height: ${poiHeight}m | Urban Density: ${urbanDensity}`);
    console.log(`   High Visibility: ${isHighVisibility} | Max Range: ${maxRange}m`);
    console.log(`   Data Source: Real OSM + Elevation data`);
    // Strategy 1: Search by name (PRIORITY - more precise) - usando hierarquia do monólito
    console.log(`🔍 Step 1: Searching OSM by name for ${name}`);
    const nameSearchResult = await searchOSMByName(lat, lng, name, landmarkInfo);
    let boundary = null;
    let boundarySource = 'estimated';
    if (nameSearchResult.success && nameSearchResult.boundary) {
      console.log('✅ Found precise boundary from OSM Nominatim');
      boundary = nameSearchResult.boundary;
      boundarySource = 'osm_nominatim';
    } else {
      console.log('⚠️ OSM name search failed, trying coordinates...');
      // Strategy 2: Reverse geocoding by coordinates
      const coordResult = await searchOSMByCoordinates(lat, lng);
      if (coordResult.success && coordResult.boundary) {
        console.log('✅ Found boundary by coordinates');
        boundary = coordResult.boundary;
        boundarySource = 'osm_reverse_geocoding';
      } else {
        console.log('⚠️ OSM coordinates search failed, trying nearby features...');
        // Strategy 3: Search nearby features
        const nearbyResult = await searchOSMNearbyFeatures(lat, lng, name);
        if (nearbyResult.success && nearbyResult.boundary) {
          console.log('✅ Found boundary by nearby features');
          boundary = nearbyResult.boundary;
          boundarySource = 'osm_nearby';
        } else {
          console.log('⚠️ OSM nearby features failed, trying unified Overpass...');
          // Strategy 4: UNIFIED Overpass API (boundaries + streets in ONE call)
          console.log('🔄 Making UNIFIED Overpass API call for all POI data...');
          const unifiedData = await queryUnifiedOverpassData(lat, lng, name, landmarkInfo);
          // Process boundaries from unified data
          let nearbyFeaturesResult = null;
          if (unifiedData.boundaries.length > 0) {
            nearbyFeaturesResult = await processBoundariesFromUnifiedData(unifiedData.boundaries, lat, lng, name);
            if (nearbyFeaturesResult.success && nearbyFeaturesResult.boundary) {
              console.log('✅ Found boundary from unified Overpass data');
              boundary = nearbyFeaturesResult.boundary;
              boundarySource = 'unified_overpass';
            }
          }
          if (!boundary) {
            console.log('⚠️ All OSM strategies failed, using estimated boundary...');
            // Final Fallback: Use estimated boundary
            boundary = createEstimatedBoundary(lat, lng, name);
            boundarySource = 'estimated';
            console.log(`📐 Using estimated boundary: ${boundary.area_m2.toFixed(0)}m² area, confidence: ${boundary.confidence}`);
          }
        }
      }
    }
    if (!boundary) {
      return new Response(JSON.stringify({
        error: 'Failed to detect POI boundary'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`🎯 Step 2: Generating trigger points`);
    // Step 2: Generate trigger points using enhanced legacy logic
    let triggerPoints = await generateStreetBasedTriggerPoints(boundary, lat, lng, name, landmarkInfo);
    console.log(`✅ Generated ${triggerPoints.length} trigger points`);
    // CRITICAL LEGACY LOGIC: If no very close TPs were found (all > 80m), supplement with immediate streets
    const veryCloseTPs = triggerPoints.filter((tp)=>tp.distance_from_poi <= 80);
    if (veryCloseTPs.length === 0) {
      console.log(`⚠️ No very close TPs found (all > 80m) - supplementing with immediate street analysis`);
      try {
        const immediateStreets = await findImmediateStreets(lat, lng);
        if (immediateStreets && immediateStreets.length > 0) {
          const immediateTPs = await generateDirectionalTriggerPoints(lat, lng, immediateStreets, boundary.coordinates);
          // Mark these as supplementary and merge with existing TPs
          const supplementaryTPs = immediateTPs.map((tp)=>({
              ...tp,
              reasoning: tp.reasoning + ' (supplementary close TP)',
              type: tp.distance_from_poi <= 50 ? 'primary' : 'secondary'
            }));
          triggerPoints = [
            ...supplementaryTPs,
            ...triggerPoints
          ];
          console.log(`✅ Added ${supplementaryTPs.length} supplementary close TPs`);
        }
      } catch (error) {
        console.error('⚠️ Error generating immediate TPs (non-critical):', error);
      }
    } else {
      console.log(`✅ Found ${veryCloseTPs.length} very close TPs (≤80m), no supplementary analysis needed`);
    }
    // Step 3: Calculate comprehensive POI confidence score
    const poiConfidenceScore = calculatePOIConfidenceScore(boundary, triggerPoints, boundarySource, landmarkInfo);
    console.log(`📊 POI Confidence Score: ${(poiConfidenceScore * 100).toFixed(1)}%`);
    // Step 4: Get additional data and save to database (conditional save)
    try {
      // Get additional data for metadata (ALWAYS needed for debug report)
      const poiHeight = await detectPOIHeight(lat, lng);
      const urbanDensity = await detectUrbanDensity(lat, lng);
      
      if (!test_mode) {
        // Save trigger points to database
        const saveResult = await saveTriggerPointsToDatabase(supabase, poi_id, triggerPoints, {
          boundarySource,
          landmarkInfo,
          poiConfidenceScore,
          generationStrategy: landmarkInfo.isHighVisibility ? 'circular' : 'boundary_offset',
          processingTime: Date.now() - startTime
        });
        
        // Update attraction metadata
        const metadataResult = await updateAttractionMetadata(supabase, poi_id, {
          poiHeight,
          urbanDensity: urbanDensity,
          boundarySource,
          boundary,
          landmarkInfo,
          generationStrategy: landmarkInfo.isHighVisibility ? 'circular' : 'boundary_offset',
          processingTime: Date.now() - startTime,
          triggerPointsCount: triggerPoints.length,
          poiConfidenceScore
        });
        
        console.log(`💾 Database results - TPs: ${saveResult.success ? 'Success' : 'Failed'}, Metadata: ${metadataResult.success ? 'Success' : 'Failed'}`);
        if (saveResult.success) {
          console.log(`✅ Saved ${saveResult.saved_count} trigger points to database`);
        }
      } else {
        console.log(`🧪 TEST MODE: Skipping database save operations (data analysis still performed)`);
      }
    } catch (error) {
      console.error('⚠️ Error in data processing:', error);
      // Continue execution - these operations are optional for core functionality
    }
    // Calculate overall confidence for response
    const avgConfidence = triggerPoints.length > 0 ? triggerPoints.reduce((sum, tp)=>sum + tp.confidence, 0) / triggerPoints.length : boundary.confidence;
    
    // Create comprehensive debug report
    const debugReport = {
      poi_info: {
        id: poi_id,
        name: name,
        coordinates: { lat, lng },
        landmark_detection: {
          is_high_visibility: landmarkInfo.isHighVisibility,
          max_range: landmarkInfo.maxRange,
          elevation_diff: landmarkInfo.elevationDiff
        }
      },
      boundary_analysis: {
        source: boundarySource,
        method_used: boundarySource === 'osm_nominatim' ? 'Name Search' : 
                    boundarySource === 'osm_reverse_geocoding' ? 'Coordinate Search' :
                    boundarySource === 'osm_nearby' ? 'Nearby Features' :
                    boundarySource === 'unified_overpass' ? 'Unified Overpass' : 'Estimated Fallback',
        area_m2: boundary.area_m2,
        perimeter_m: boundary.perimeter_m,
        confidence: boundary.confidence,
        coordinates_count: boundary.coordinates.length
      },
      trigger_points_generation: {
        total_generated: triggerPoints.length,
        generation_range: landmarkInfo.maxRange,
        average_confidence: avgConfidence,
        points_by_type: {
          primary: triggerPoints.filter(tp => tp.type === 'primary').length,
          secondary: triggerPoints.filter(tp => tp.type === 'secondary').length,
          fallback: triggerPoints.filter(tp => tp.type === 'fallback').length
        },
        distance_analysis: {
          closest_point: triggerPoints.length > 0 ? Math.min(...triggerPoints.map(tp => tp.distance_from_poi)) : 0,
          furthest_point: triggerPoints.length > 0 ? Math.max(...triggerPoints.map(tp => tp.distance_from_poi)) : 0,
          average_distance: triggerPoints.length > 0 ? triggerPoints.reduce((sum, tp) => sum + tp.distance_from_poi, 0) / triggerPoints.length : 0
        }
      },
      processing_summary: {
        timestamp: new Date().toISOString(),
        legacy_migration: true,
        poi_confidence_score: poiConfidenceScore,
        database_saved: !test_mode,
        test_mode: test_mode,
        step: 'trigger_points_generation'
      }
    };
    
    const result = {
      poi_id,
      trigger_points: triggerPoints,
      boundary: {
        type: boundary.coordinates && boundary.coordinates.length > 3 ? 'polygon' : 'circle',
        coordinates: boundary.coordinates,
        area_m2: boundary.area_m2,
        perimeter_m: boundary.perimeter_m,
        confidence: boundary.confidence,
        source: boundarySource
      },
      buffer: {
        coordinates: boundary.coordinates && boundary.coordinates.length > 3 
          ? createBufferAroundPolygon(boundary.coordinates, landmarkInfo.maxRange)
          : null,
        radius: landmarkInfo.maxRange,
        strategy: landmarkInfo.isHighVisibility ? 'circular' : 'boundary_offset'
      },
      confidence: avgConfidence,
      processing_metadata: {
        step: 'trigger_points_generation',
        timestamp: new Date().toISOString(),
        legacy_migration: true,
        landmark_info: landmarkInfo,
        boundary_method: boundarySource,
        total_candidates: triggerPoints.length,
        poi_confidence_score: poiConfidenceScore,
        database_saved: !test_mode,
        test_mode: test_mode,
        processing_time_ms: Date.now() - startTime
      },
      debug_report: debugReport
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ Error in trigger points generation:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
