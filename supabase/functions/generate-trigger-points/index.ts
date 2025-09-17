import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Helper function to safely format numbers (prevents undefined.toFixed() errors)
function safeToFixed(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) {
    return '0';
  }
  return Number(value).toFixed(decimals);
}
// Note: Intelligent clustering is handled directly in generateTriggersFromMegaStreets()
// No separate clustering function needed - system already optimized
// Import legacy functions (for fallback only)
import { detectRelativeElevation, findNearbyStreetsForTriggers, generateTriggersOnStreets, lineIntersectsPolygon, getKnownCityElevation, createLineOfSightSamples, convertOSMPolygon, removeDuplicatePoints } from './legacy-functions.ts';
// Import modular utilities
import { calculateDistance, calculateBearing, normalizeAngleDifference, isInBearingRange } from './lib/utils/calculations.ts';
import { calculatePolygonArea, calculatePolygonPerimeter, isPointInPolygon, calculateDistanceToPolygon, calculatePolygonCenter } from './lib/utils/geometry.ts';
import { findClosestPointOnStreet, calculateStreetConfidence, calculateStreetDirection, findClosestPointIndexOnStreet, calculateStreamPositionBonus } from './lib/utils/street-processing.ts';
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
// MOVED TO legacy-functions.ts - createCircularBoundary()
// This function was replaced by boundary detection in mega-unified system
// MOVED TO legacy-functions.ts - createEstimatedBoundary()
// This function was replaced by boundary detection in mega-unified system
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
// MOVED TO legacy-functions.ts - getKnownCityElevation()
// This function was replaced by elevation data in mega-unified system
// MOVED TO legacy-functions.ts - detectUrbanDensity()
// This function was replaced by calculateUrbanDensityMega() in mega-unified system
// ========================================
// VISIBILITY CHECK FUNCTIONS (LEGACY)
// ========================================
async function checkVisibilityToPOI(point, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight1 = null, megaBuildings1 = null, poiHeight1 = null) {
  // SMART visibility check with regional height analysis
  const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng);
  // Calculate POI area with fallback for invalid boundaries - ALWAYS try real calculation first
  let poiArea;
  if (boundaryCoordinates && Array.isArray(boundaryCoordinates) && boundaryCoordinates.length > 2) {
    try {
      poiArea = calculatePolygonArea(boundaryCoordinates);
      if (!poiArea || isNaN(poiArea) || poiArea <= 0) {
        poiArea = 100000; // Fallback only if calculation is invalid
      }
    } catch (error) {
      console.warn('⚠️ Error calculating POI area in checkVisibilityToPOI, using fallback:', error.message);
      poiArea = 100000; // Fallback only on error
    }
  } else {
    poiArea = 100000; // Fallback only if no valid boundaries
  }
  const landmark = landmarkInfo || {
    isHighVisibility: false,
    maxRange: 800,
    elevationDiff: 0
  };
  // Step 1: OPTIMIZED distance and boundary checks for better trigger point acceptance
  let minDistance = 50; // REDUCED from 80 to accept closer points
  let maxDistance = 1200; // INCREASED from 800 for better coverage
  let bufferDistance = 15; // REDUCED from 20 for more flexibility
  if (landmark.isHighVisibility) {
    minDistance = 10; // REDUCED from 15 for even closer high-visibility points
    maxDistance = landmark.maxRange * 1.2; // EXTENDED by 20% for landmarks
    bufferDistance = 8; // REDUCED for landmarks
    console.log(`🏔️ High-visibility landmark detected - OPTIMIZED range: ${minDistance}m-${maxDistance}m (elevation diff: ${landmark.elevationDiff || 0}m)`);
  } else if (poiArea > 1000000) {
    minDistance = 30; // REDUCED from 50 for large POIs
    maxDistance = 1500; // INCREASED from 1200
    bufferDistance = 12; // REDUCED from 15
  } else if (poiArea > 100000) {
    minDistance = 40; // REDUCED from 60
    maxDistance = 1300; // INCREASED from 1000
    bufferDistance = 15; // REDUCED from 18
  } else if (poiArea > 10000) {
    minDistance = 50; // REDUCED from 80
    maxDistance = 1100; // INCREASED from 800
    bufferDistance = 18; // REDUCED from 25
  } else {
    minDistance = 60; // REDUCED from 100 for small POIs
    maxDistance = 900; // INCREASED from 600
    bufferDistance = 20; // REDUCED from 30
  }
  // Basic distance check
  if (distance < minDistance || distance > maxDistance) return false;
  // Check if point is inside POI boundary
  const isInside = isPointInPolygon(point, boundaryCoordinates);
  if (isInside) return false;
  // Buffer zone check
  const distanceToBoundary = calculateDistanceToPolygon(point, boundaryCoordinates);
  if (distanceToBoundary < bufferDistance) return false;
  // Step 2: ADVANCED OBSTRUCTION DETECTION - TEMPORARILY DISABLED FOR PERFORMANCE
  // Defensive check for valid coordinates
  if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number') {
    console.log(`❌ Invalid point coordinates: ${JSON.stringify(point)}`);
    return false;
  }
  // Step 2: LEGACY PERFORMANCE MODE - Smart selective obstruction check
  // ⚡ PERFORMANCE: Only check obstructions for small POIs in dense urban areas
  // Skip obstruction check for high-visibility landmarks (like Cristo Redentor)
  if (poiArea < 100000 && !landmark.isHighVisibility) {
    // Checking building obstructions for small urban POI
    try {
      const hasObstruction = await checkLegacyBuildingObstructions(point, poiLat, poiLng, megaBuildings1, poiHeight1);
      if (hasObstruction) {
        console.log(`🚫 Point filtered out due to building obstruction`);
        return false;
      }
    } catch (error) {
      console.log('⚠️ Obstruction check failed, allowing trigger point (conservative approach)');
    // If obstruction check fails, allow the trigger point
    }
  } else if (landmark.isHighVisibility) {
    console.log(`🏔️ High-visibility landmark - skipping building obstruction check for performance`);
  } else {
  // Large POI - skipping obstruction check for performance
  }
  // Point accepted
  return true;
}
// OPTIMIZED: Building obstruction check using mega-unified data (NO API CALLS)
async function checkLegacyBuildingObstructions(triggerPoint, poiLat, poiLng, megaBuildings1 = null, poiHeight1 = null) {
  try {
    // Use cached POI height if available (from mega-unified data)
    let poiHeightValue = 0;
    if (poiHeight1 && poiHeight1.height) {
      poiHeightValue = poiHeight1.height;
      console.log(`🎯 Using cached POI height: ${poiHeightValue}m (${poiHeight1.category})`);
    } else {
      // Fallback to cache lookup
      const cachedHeight = poiHeightCache.get(`${safeToFixed(poiLat, 6)},${safeToFixed(poiLng, 6)}`);
      if (cachedHeight) {
        poiHeightValue = cachedHeight.height;
        console.log(`🎯 Using cached POI height: ${poiHeightValue}m (${cachedHeight.category})`);
      }
    }
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
    // For very close points, assume good visibility
    if (distance <= 50) {
      return false; // No obstruction
    }
    // For truly high POIs (relative to urban context), assume good visibility
    if (poiHeightValue > 150) {
      return false; // No obstruction
    }
    // Use mega-unified building data if available (NO API CALLS!)
    let nearbyBuildings = [];
    if (megaBuildings1 && megaBuildings1.length > 0) {
      // Filter buildings from mega-unified data along line of sight
      const searchRadius = Math.min(distance / 2, 200);
      const midLat = (triggerPoint.lat + poiLat) / 2;
      const midLng = (triggerPoint.lng + poiLng) / 2;
      nearbyBuildings = megaBuildings1.filter((building)=>{
        const buildingCenter = calculateBuildingCenterMega(building);
        const distanceToMidpoint = calculateDistance(midLat, midLng, buildingCenter.lat, buildingCenter.lng);
        return distanceToMidpoint <= searchRadius;
      });
      console.log(`🏢 Using ${nearbyBuildings.length} buildings from mega-unified data (no API call)`);
    } else {
      // If no mega-unified data available, use fast approximation
      console.log(`⚡ No mega-unified building data available, using fast approximation`);
      return false; // Assume no obstruction to avoid API calls
    }
    if (nearbyBuildings.length === 0) {
      console.log(`✅ No buildings found in line of sight`);
      return false;
    }
    console.log(`🔍 Found ${nearbyBuildings.length} potential obstructions`);
    // Check if any building intersects the line of sight using mega-unified data
    let obstructionCount = 0;
    for (const building of nearbyBuildings){
      if (building.geometry && building.geometry.length >= 3) {
        const buildingCoords = building.geometry.map((node)=>({
            lat: node.lat,
            lng: node.lon
          }));
        // Check if building is between trigger point and POI
        const buildingCenter = calculatePolygonCenter(buildingCoords);
        const distanceToTrigger = calculateDistance(triggerPoint.lat, triggerPoint.lng, buildingCenter.lat, buildingCenter.lng);
        const distanceToPOI = calculateDistance(poiLat, poiLng, buildingCenter.lat, buildingCenter.lng);
        const totalDistance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
        // If building is roughly between trigger point and POI (with tolerance)
        if (distanceToTrigger + distanceToPOI <= totalDistance * 1.2) {
          // Check if line of sight passes through or very close to building
          if (lineIntersectsPolygon(triggerPoint, {
            lat: poiLat,
            lng: poiLng
          }, buildingCoords)) {
            // HEIGHT-AWARE OBSTRUCTION CHECK (using mega-unified building data)
            const obstacleHeight = extractBuildingHeightMega(building.tags || {});
            const canSeeOver = poiHeightValue > obstacleHeight + 15; // POI must be 15m+ higher to see over (safety margin)
            if (canSeeOver) {
              console.log(`👁️ POI (${poiHeightValue}m) can see over obstacle (${obstacleHeight}m) - not blocking`);
            } else {
              obstructionCount++;
              // Get building info for logging
              const buildingType = building.tags?.building || 'unknown';
              const buildingName = building.tags?.name || `${buildingType} building`;
              console.log(`🚫 Obstruction detected: ${buildingName} (${obstacleHeight}m high, ${safeToFixed(distanceToTrigger, 0)}m from trigger point)`);
            }
          }
        }
      }
    }
    // If more than 2 significant obstructions, consider it blocked
    const isBlocked = obstructionCount > 2;
    if (isBlocked) {
      console.log(`❌ Line of sight blocked by ${obstructionCount} buildings`);
    } else {
      console.log(`✅ Line of sight clear (${obstructionCount} minor obstructions)`);
    }
    return isBlocked;
  } catch (error) {
    console.error('❌ Error checking legacy building obstructions:', error);
    return false; // If error, assume no obstructions for safety
  }
}
// Get real building height from OSM data (enhanced version)
async function getRealBuildingHeight(tags, buildingCoords) {
  try {
    let height = 0;
    let confidence = 0.0;
    // Try direct height first (highest priority)
    if (tags.height) {
      height = parseFloat(tags.height.replace(/[^\d.]/g, ''));
      if (!isNaN(height) && height > 0) {
        confidence = 1.0;
        console.log(`🏗️ Real building height from OSM: ${height}m (direct height tag)`);
        return height;
      }
    }
    // Try building:height
    if (tags['building:height']) {
      height = parseFloat(tags['building:height'].replace(/[^\d.]/g, ''));
      if (!isNaN(height) && height > 0) {
        confidence = 0.9;
        console.log(`🏗️ Real building height from OSM: ${height}m (building:height tag)`);
        return height;
      }
    }
    // Try levels (estimate height)
    if (tags['building:levels']) {
      const levels = parseInt(tags['building:levels']);
      if (!isNaN(levels) && levels > 0) {
        height = levels * 3.5; // Average 3.5m per level
        confidence = 0.7;
        console.log(`🏗️ Estimated building height: ${levels} levels = ${height}m`);
        return height;
      }
    }
    // If no direct height data, search nearby for similar buildings with height data
    if (buildingCoords && buildingCoords.length > 0) {
      const buildingCenter = calculatePolygonCenter(buildingCoords);
      const nearbyHeight = await searchNearbyBuildingHeights(buildingCenter.lat, buildingCenter.lng, tags.building);
      if (nearbyHeight > 0) {
        console.log(`🔍 Using nearby building height estimate: ${nearbyHeight}m`);
        return nearbyHeight;
      }
    }
    // Fallback to estimated height by building type
    const estimatedHeight = getEstimatedBuildingHeight(tags);
    console.log(`📏 Using estimated height by type: ${estimatedHeight}m (${tags.building || 'unknown'})`);
    return estimatedHeight;
  } catch (error) {
    console.error('❌ Error getting real building height:', error);
    return getEstimatedBuildingHeight(tags); // Fallback
  }
}
// Search for nearby buildings with height data to estimate current building
async function searchNearbyBuildingHeights(lat, lng, buildingType) {
  try {
    const searchRadius = 200; // Search within 200m for similar buildings
    const heightQuery = `[out:json][timeout:15];
    (
      way[building="${buildingType || 'apartments'}"][height](around:${searchRadius},${lat},${lng});
      way[building="${buildingType || 'apartments'}"]["building:height"](around:${searchRadius},${lat},${lng});
      way[building="${buildingType || 'apartments'}"]["building:levels"](around:${searchRadius},${lat},${lng});
    );
    out tags;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: heightQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (nearby-height-estimation)',
        'Content-Type': 'text/plain'
      }
    });
    if (!response.ok) {
      return 0; // No data found
    }
    const data = await response.json();
    if (!data.elements || data.elements.length === 0) {
      return 0; // No similar buildings found
    }
    // Calculate average height of similar buildings
    const heights = [];
    for (const element of data.elements){
      if (element.tags) {
        let height = 0;
        if (element.tags.height) {
          height = parseFloat(element.tags.height.replace(/[^\d.]/g, ''));
        } else if (element.tags['building:height']) {
          height = parseFloat(element.tags['building:height'].replace(/[^\d.]/g, ''));
        } else if (element.tags['building:levels']) {
          const levels = parseInt(element.tags['building:levels']);
          height = levels * 3.5;
        }
        if (!isNaN(height) && height > 0 && height < 500) {
          heights.push(height);
        }
      }
    }
    if (heights.length > 0) {
      const averageHeight = heights.reduce((sum, h)=>sum + h, 0) / heights.length;
      console.log(`🔍 Found ${heights.length} similar buildings nearby, average height: ${averageHeight.toFixed(1)}m`);
      return Math.round(averageHeight);
    }
    return 0; // No valid height data found
  } catch (error) {
    console.error('❌ Error searching nearby building heights:', error);
    return 0;
  }
}
// LEGACY: Basic building obstruction check (no height awareness needed)
async function checkBasicBuildingObstructions(triggerPoint, poiLat, poiLng) {
  try {
    console.log(`🏢 Basic building obstruction check (no height data needed)`);
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
    // For very close points, assume good visibility
    if (distance <= 50) {
      console.log(`✅ Close point (${distance.toFixed(0)}m) - assuming good visibility`);
      return false; // No obstruction
    }
    // Search for buildings along the line of sight (smaller radius for basic check)
    const searchRadius = Math.min(distance / 3, 100); // Smaller search area
    const midLat = (triggerPoint.lat + poiLat) / 2;
    const midLng = (triggerPoint.lng + poiLng) / 2;
    const buildingQuery = `[out:json][timeout:15];
    (
      way[building](around:${searchRadius},${midLat},${midLng});
      relation[building](around:${searchRadius},${midLat},${midLng});
    );
    out count;`; // Only count, not full geometry for speed
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: buildingQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (basic-obstruction-check)',
        'Content-Type': 'text/plain'
      }
    });
    if (!response.ok) {
      console.log(`⚠️ Basic obstruction check failed: ${response.status}`);
      return false; // If can't check, assume no obstruction
    }
    const data = await response.json();
    const buildingCount = data.elements?.[0]?.tags?.total || 0;
    console.log(`🏢 Found ${buildingCount} buildings in line of sight (radius: ${searchRadius}m)`);
    // Simple density-based obstruction check
    // More than 8 buildings in a small area likely means obstruction
    const isBlocked = buildingCount > 8;
    if (isBlocked) {
      console.log(`❌ High building density detected (${buildingCount} buildings) - likely obstruction`);
    } else {
      console.log(`✅ Low building density (${buildingCount} buildings) - clear line of sight`);
    }
    return isBlocked;
  } catch (error) {
    console.error('❌ Error in basic building obstruction check:', error);
    return false; // If error, assume no obstructions for safety
  }
}
// NEW: Comprehensive obstruction detection using OSM data (DISABLED FOR PERFORMANCE)
async function checkRealObstructions(triggerPoint, poiLat, poiLng, landmarkInfo) {
  try {
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
    // For very close points or very high POIs, skip obstruction check
    if (distance <= 50 || landmarkInfo.elevationDiff && landmarkInfo.elevationDiff > 100) {
      return false; // No obstruction for close/elevated POIs
    }
    // Create line of sight sampling points
    const samplePoints = createLineOfSightSamples(triggerPoint, poiLat, poiLng, 5);
    // Check each sample point for obstructions
    for (const sample of samplePoints){
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
// MOVED TO legacy-functions.ts - createLineOfSightSamples()
// This function was replaced by optimized visibility calculations in mega-unified system
// Check for obstructions at a specific point using OSM data
async function checkObstructionAtPoint(lat, lng, landmarkInfo, fastMode = false) {
  try {
    // Reduced search radius for performance
    const searchRadius = fastMode ? 30 : 50; // Even smaller radius for fast mode
    const obstructionQuery = `[out:json][timeout:${fastMode ? 8 : 15}];
    (
      // Buildings that could block view
      way[building](around:${searchRadius},${lat},${lng});
      relation[building](around:${searchRadius},${lat},${lng});
      
      // Tunnels and covered ways (trigger point might be inside)
      way[tunnel="yes"](around:${searchRadius},${lat},${lng});
      way[covered="yes"](around:${searchRadius},${lat},${lng});
      
      // Large barriers (only very high ones)
      way[barrier~"^(wall)$"][height~"^[3-9]|[1-9][0-9]"](around:${searchRadius},${lat},${lng});
    );
    out count;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: obstructionQuery,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    if (!response.ok) {
      return false; // Default to no obstruction on API error
    }
    const data = await response.json();
    const obstructionCount = data.elements?.[0]?.tags?.total || 0;
    // Thresholds based on POI type and mode
    let threshold;
    if (fastMode) {
      // More tolerant thresholds for fast mode (single point check)
      threshold = landmarkInfo.isHighVisibility ? 25 : 15;
    } else {
      // Original thresholds for comprehensive mode
      threshold = landmarkInfo.isHighVisibility ? 15 : 8;
    }
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
// MOVED TO legacy-functions.ts - convertOSMPolygon()
// This function was replaced by optimized polygon processing in mega-unified system
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
        const coordinates = element.geometry.map((node)=>[
            node.lon,
            node.lat
          ]); // [lng, lat] format
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
      const coordinates = element.geometry.map((node)=>[
          node.lon,
          node.lat
        ]); // [lng, lat] format
      boundaries.push({
        ...element,
        coordinates,
        category: leisure || landuse || natural || tourism || amenity || sport,
        element_type: element.type
      });
    } else if (highway) {
      const coordinates = element.geometry.map((node)=>[
          node.lon,
          node.lat
        ]); // [lng, lat] format
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
  streets.sort((a, b)=>{
    // Priority: visibility quality over distance for ALL POIs
    // All streets with good visibility should be included
    return b.confidence - a.confidence; // Simple: best visibility first
  });
  console.log(`🎯 [${context}] Processed ${streets.length} streets by visibility quality`);
  // Debug: Show streets by visibility quality (focusing on Lagoa)
  const lagoaStreets = streets.filter((street)=>street.name && (street.name.toLowerCase().includes('lagoa') || street.name.toLowerCase().includes('epitácio') || street.name.toLowerCase().includes('borges de medeiros') || street.name.toLowerCase().includes('bartolomeu mitre') || street.name.toLowerCase().includes('alexandre ferreira')));
  if (lagoaStreets.length > 0) {
    console.log(`🏞️ [${context}] LAGOA STREETS SELECTED (${lagoaStreets.length} found by visibility):`);
    lagoaStreets.forEach((street, index)=>{
      console.log(`   ${index + 1}. ${street.name} - ${safeToFixed(street.distance_to_poi, 1)}m - visibility: ${safeToFixed(street.confidence * 100, 1)}%`);
    });
  } else {
    console.log(`⚠️ [${context}] NO LAGOA STREETS found in final selection (total: ${streets.length})`);
  }
  // Show top 5 by visibility
  console.log(`🎯 [${context}] TOP 5 STREETS BY VISIBILITY:`);
  streets.slice(0, 5).forEach((street, index)=>{
    const isLagoa = street.name && (street.name.toLowerCase().includes('lagoa') || street.name.toLowerCase().includes('epitácio') || street.name.toLowerCase().includes('borges de medeiros') || street.name.toLowerCase().includes('bartolomeu mitre') || street.name.toLowerCase().includes('alexandre ferreira'));
    console.log(`   ${index + 1}. ${street.name || 'Unnamed'} - ${safeToFixed(street.distance_to_poi, 1)}m - visibility: ${safeToFixed(street.confidence * 100, 1)}% ${isLagoa ? '🏞️' : ''}`);
  });
  return streets;
}
// ========================================
// TRIGGER POINTS GENERATION (LEGACY CORE)
// ========================================
async function generateStreetBasedTriggerPoints(boundary, poiLat, poiLng, poiName, landmarkInfo, regionalHeight1 = null) {
  console.log('🛣️ Generating street-based trigger points using Overpass API');
  console.log(`📍 POI Location: ${poiLat}, ${poiLng} | Name: ${poiName}`);
  console.log(`🗺️ Boundary: ${boundary.coordinates?.length || 0} points`);
  try {
    // Find nearby streets using Overpass API (with landmark info if available) - EXACT LEGACY FLOW
    const nearbyStreets = await findNearbyStreetsForTriggers(poiLat, poiLng, poiName, landmarkInfo);
    console.log(`🔍 Legacy: Found ${nearbyStreets.length} streets`);
    // DEBUG: Log street details
    if (nearbyStreets.length > 0) {
      nearbyStreets.slice(0, 3).forEach((street, i)=>{
        console.log(`   Street ${i + 1}: ${street.name || 'Unnamed'} - ${(street.distance_to_poi || 0).toFixed(1)}m - ${street.coordinates?.length || 0} coords`);
      });
    }
    if (nearbyStreets.length === 0) {
      console.log('⚠️ No streets found, falling back to boundary-based triggers');
      console.log('🚨 PROBLEMA IDENTIFICADO: Sistema não encontrou ruas próximas');
      return generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName, landmarkInfo);
    }
    // Generate trigger points on strategic street locations - OPTIMIZED WITH SAMPLING
    const streetTriggerPoints = await generateTriggersOnStreets(poiLat, poiLng, boundary.coordinates, nearbyStreets, landmarkInfo, regionalHeight1);
    console.log(`✅ Generated ${streetTriggerPoints.length} street-based trigger points`);
    // DEBUG: Log trigger point details
    if (streetTriggerPoints.length === 0) {
      console.log('🚨 PROBLEMA IDENTIFICADO: Ruas encontradas mas nenhum trigger point gerado');
    } else {
      streetTriggerPoints.slice(0, 3).forEach((tp, i)=>{
        console.log(`   TP ${i + 1}: ${safeToFixed(tp.lat, 6)}, ${safeToFixed(tp.lng, 6)} - ${tp.type} - ${safeToFixed(tp.distance_from_poi, 1)}m`);
      });
    }
    return streetTriggerPoints;
  } catch (error) {
    console.error('❌ Error generating street-based triggers, falling back to boundary-based:', error);
    console.log('🚨 PROBLEMA IDENTIFICADO: Erro na geração de trigger points baseados em ruas');
    return generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName, landmarkInfo);
  }
}
// Find strategic points on a specific street (OPTIMIZED WITH REGIONAL ANALYSIS)
async function findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo, regionalHeight1 = null, isFullCheck = false, megaBuildings1 = null, poiHeight1 = null) {
  const points = [];
  // Strategy 1: Find closest point on street to POI
  // Normalize coordinates to [lng, lat] format expected by findClosestPointOnStreet
  const normalizedCoords = street.coordinates.map((coord)=>{
    if (Array.isArray(coord)) {
      return coord; // Already [lng, lat] or [lat, lng] - assume [lng, lat] for OSM
    } else if (coord.lon !== undefined) {
      return [
        coord.lon,
        coord.lat
      ]; // {lat, lon} -> [lng, lat]
    } else {
      return [
        coord.lng,
        coord.lat
      ]; // {lat, lng} -> [lng, lat]
    }
  });
  const closestPoint = findClosestPointOnStreet(normalizedCoords, poiLat, poiLng);
  const distance = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng);
  const bearing = calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng);
  // SMART visibility check - use full check only for closest points or when explicitly requested
  let hasVisibility = false;
  if (isFullCheck || distance <= 300) {
    // Full visibility check for close points or explicitly requested
    hasVisibility = await checkVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight1, megaBuildings1, poiHeight1);
    console.log(`🔍 Full visibility check for ${street.name || 'Unnamed'} at ${distance || 0}m: ${hasVisibility ? 'visible' : 'blocked'}`);
  } else {
    // Fast approximation for distant points using regional height analysis
    if (regionalHeight1 && regionalHeight1.confidence > 0.5 && poiHeight1 && poiHeight1.height) {
      // Use POI height from mega-unified data (NO API CALL!)
      const heightAdvantage = poiHeight1.height - regionalHeight1.average;
      // Simple heuristic: good visibility if POI has height advantage or is high visibility landmark
      hasVisibility = heightAdvantage > 20 || landmarkInfo.isHighVisibility || distance <= 500;
      console.log(`⚡ Fast visibility estimate for ${street.name || 'Unnamed'}: ${hasVisibility ? 'likely visible' : 'likely blocked'} (height advantage: ${heightAdvantage || 0}m)`);
    } else {
      // Conservative fallback - assume visible for performance (no API calls)
      hasVisibility = true;
      console.log(`⚡ Conservative visibility assumption for ${street.name} (no height data)`);
    }
  }
  if (distance > 1000) {
    console.log(`🔍 Distant street point: ${street.name || 'Unnamed'} at ${distance || 0}m - visibility: ${hasVisibility}`);
  }
  // Dynamic distance check (will be validated again in checkVisibilityToPOI)
  if (hasVisibility) {
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
  // MEGA-UNIFIED: Use strategic sampling instead of legacy intersection detection
  console.log('🚀 Using MEGA-UNIFIED strategic sampling');
  const intersectionPoints = [];
  const coordinateCount = street.coordinates.length;
  if (coordinateCount >= 5) {
    // Sample strategic points from street coordinates
    const strategicIndices = [
      Math.floor(coordinateCount * 0.25),
      Math.floor(coordinateCount * 0.5),
      Math.floor(coordinateCount * 0.75)
    ];
    for (const index of strategicIndices){
      if (index >= 0 && index < coordinateCount) {
        const coord = street.coordinates[index];
        // Normalize coordinate format to ensure {lat, lng}
        let normalizedCoord;
        if (Array.isArray(coord)) {
          // Handle [lng, lat] format from OSM
          normalizedCoord = {
            lat: coord[1],
            lng: coord[0]
          };
        } else if (coord.lon !== undefined) {
          // Handle {lat, lon} format
          normalizedCoord = {
            lat: coord.lat,
            lng: coord.lon
          };
        } else {
          // Already in {lat, lng} format
          normalizedCoord = coord;
        }
        // Validate normalized coordinates
        if (typeof normalizedCoord.lat === 'number' && typeof normalizedCoord.lng === 'number') {
          intersectionPoints.push(normalizedCoord);
        } else {
          console.log(`⚠️ Skipping invalid coordinate: ${JSON.stringify(coord)} -> ${JSON.stringify(normalizedCoord)}`);
        }
      }
    }
  }
  for (const intersection of intersectionPoints){
    const intDistance = calculateDistance(poiLat, poiLng, intersection.lat, intersection.lng);
    const intBearing = calculateBearing(intersection.lat, intersection.lng, poiLat, poiLng);
    const intVisibility = await checkVisibilityToPOI(intersection, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight1, megaBuildings1, poiHeight1);
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
  if (street.coordinates.length > 10 && [
    'motorway',
    'trunk',
    'primary',
    'secondary'
  ].includes(street.highway_type)) {
    const step = Math.max(3, Math.floor(street.coordinates.length / 4)); // Sample 4 points along street
    for(let i = step; i < street.coordinates.length - step; i += step){
      const rawPoint = street.coordinates[i];
      // Normalize coordinate format to ensure {lat, lng}
      let intermediatePoint;
      if (Array.isArray(rawPoint)) {
        // Handle [lng, lat] format from OSM
        intermediatePoint = {
          lat: rawPoint[1],
          lng: rawPoint[0]
        };
      } else if (rawPoint.lon !== undefined) {
        // Handle {lat, lon} format
        intermediatePoint = {
          lat: rawPoint.lat,
          lng: rawPoint.lon
        };
      } else {
        // Already in {lat, lng} format
        intermediatePoint = rawPoint;
      }
      // Validate normalized coordinates
      if (typeof intermediatePoint.lat !== 'number' || typeof intermediatePoint.lng !== 'number') {
        console.log(`⚠️ Skipping invalid intermediate coordinate: ${JSON.stringify(rawPoint)} -> ${JSON.stringify(intermediatePoint)}`);
        continue;
      }
      const intDistance = calculateDistance(poiLat, poiLng, intermediatePoint.lat, intermediatePoint.lng);
      const intBearing = calculateBearing(intermediatePoint.lat, intermediatePoint.lng, poiLat, poiLng);
      const intVisibility = await checkVisibilityToPOI(intermediatePoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight1, megaBuildings1, poiHeight1);
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
// MOVED TO legacy-functions.ts - findIntersectionPoints()
// This function was replaced by optimized intersection detection in mega-unified system
// Remove duplicate points (LEGACY FUNCTION)
// MOVED TO legacy-functions.ts - removeDuplicatePoints()
// This function was replaced by optimized point filtering in mega-unified system
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
  // Normalize coordinates to [lng, lat] format expected by findClosestPointOnStreet
  const normalizedCoords = street.coordinates.map((coord)=>{
    if (Array.isArray(coord)) {
      return coord; // Already [lng, lat] or [lat, lng] - assume [lng, lat] for OSM
    } else if (coord.lon !== undefined) {
      return [
        coord.lon,
        coord.lat
      ]; // {lat, lon} -> [lng, lat]
    } else {
      return [
        coord.lng,
        coord.lat
      ]; // {lat, lng} -> [lng, lat]
    }
  });
  const closestPoint = findClosestPointOnStreet(normalizedCoords, poiLat, poiLng);
  const distance = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng);
  const bearing = calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng);
  // Check if this point has good visibility to POI
  const hasVisibility = await checkVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight, megaBuildings, poiHeight);
  if (distance > 1000) {
    console.log(`🔍 Distant street point: ${street.name || 'Unnamed'} at ${distance || 0}m - visibility: ${hasVisibility}`);
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
  // MEGA-UNIFIED: Use strategic sampling instead of legacy intersection detection
  console.log('🚀 Using MEGA-UNIFIED strategic sampling');
  const intersectionPoints = [];
  const coordinateCount = street.coordinates.length;
  if (coordinateCount >= 5) {
    // Sample strategic points from street coordinates
    const strategicIndices = [
      Math.floor(coordinateCount * 0.25),
      Math.floor(coordinateCount * 0.5),
      Math.floor(coordinateCount * 0.75)
    ];
    for (const index of strategicIndices){
      if (index >= 0 && index < coordinateCount) {
        const coord = street.coordinates[index];
        // Normalize coordinate format to ensure {lat, lng}
        let normalizedCoord;
        if (Array.isArray(coord)) {
          // Handle [lng, lat] format from OSM
          normalizedCoord = {
            lat: coord[1],
            lng: coord[0]
          };
        } else if (coord.lon !== undefined) {
          // Handle {lat, lon} format
          normalizedCoord = {
            lat: coord.lat,
            lng: coord.lon
          };
        } else {
          // Already in {lat, lng} format
          normalizedCoord = coord;
        }
        // Validate normalized coordinates
        if (typeof normalizedCoord.lat === 'number' && typeof normalizedCoord.lng === 'number') {
          intersectionPoints.push(normalizedCoord);
        } else {
          console.log(`⚠️ Skipping invalid coordinate: ${JSON.stringify(coord)} -> ${JSON.stringify(normalizedCoord)}`);
        }
      }
    }
  }
  for (const intersection of intersectionPoints){
    const intDistance = calculateDistance(poiLat, poiLng, intersection.lat, intersection.lng);
    const intBearing = calculateBearing(intersection.lat, intersection.lng, poiLat, poiLng);
    const intVisibility = await checkVisibilityToPOI(intersection, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight, megaBuildings, poiHeight);
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
        const coordinates = element.geometry.map((node)=>[
            node.lon,
            node.lat
          ]); // [lng, lat] format
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
  switch(buildingType){
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
// Cache for POI height detection (avoid repeated API calls)
const poiHeightCache = new Map();
// Cache for regional height analysis (avoid repeated sampling)
const regionalHeightCache = new Map();
// ===================================================================
// MEGA-UNIFIED SYSTEM - SUBSTITUI 19 CHAMADAS API POR 1
// ===================================================================
// Cache for mega-unified data (grid-based for maximum reuse)
const megaUnifiedCache = new Map();
/**
 * Build the mega-unified Overpass query
 * Substitui 19 chamadas API por 1 única query otimizada
 */ function buildMegaUnifiedQuery(lat, lng, name, landmarkInfo = null) {
  // Escape name for regex safety
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Dynamic radius based on landmark info
  const majorRadius = landmarkInfo?.isHighVisibility ? 3000 : 2000;
  const mediumRadius = landmarkInfo?.maxRange || 1000;
  const buildingRadius = 500;
  const elevationRadius = 2000;
  const megaQuery = `[out:json][timeout:120];
(
  // ===================================================================
  // SECTION 1: BOUNDARIES (substitui searchOSMByName, searchOSMNearbyFeatures, etc)
  // ===================================================================
  
  // Strategy 1: Exact name match
  rel[name~"${escapedName}",i](around:500,${lat},${lng});
  way[name~"${escapedName}",i][area=yes](around:500,${lat},${lng});
  
  // Strategy 2: Fuzzy name match (partial)
  rel[name~"${escapedName.split(' ')[0]}",i](around:300,${lat},${lng});
  way[name~"${escapedName.split(' ')[0]}",i][area=yes](around:300,${lat},${lng});
  
  // Strategy 3: Nearby amenities and leisure
  rel[amenity](around:500,${lat},${lng});
  rel[leisure](around:500,${lat},${lng});
  rel[building](around:300,${lat},${lng});
  way[amenity](around:500,${lat},${lng});
  way[leisure](around:500,${lat},${lng});
  way[building][area=yes](around:300,${lat},${lng});
  
  // Strategy 4: Administrative boundaries (for context)
  rel[admin_level~"^[4-8]$"][name](around:1000,${lat},${lng});
  
  // ===================================================================
  // SECTION 2: BUILDINGS (substitui detectPOIHeight, getRegionalHeightAverage, etc)
  // ===================================================================
  
  // All buildings with height data (raio unificado de 500m)
  way[building][height](around:${buildingRadius},${lat},${lng});
  way[building]["building:height"](around:${buildingRadius},${lat},${lng});
  way[building]["building:levels"](around:${buildingRadius},${lat},${lng});
  relation[building][height](around:${buildingRadius},${lat},${lng});
  relation[building]["building:height"](around:${buildingRadius},${lat},${lng});
  relation[building]["building:levels"](around:${buildingRadius},${lat},${lng});
  
  // All buildings for density and obstruction analysis
  way[building](around:${buildingRadius},${lat},${lng});
  relation[building](around:${buildingRadius},${lat},${lng});
  
  // TOWERS AND SPIRES (for accurate POI height detection)
  way[man_made=tower](around:${buildingRadius},${lat},${lng});
  way[building=tower](around:${buildingRadius},${lat},${lng});
  way["tower:type"](around:${buildingRadius},${lat},${lng});
  way[building=spire](around:${buildingRadius},${lat},${lng});
  relation[man_made=tower](around:${buildingRadius},${lat},${lng});
  relation[building=tower](around:${buildingRadius},${lat},${lng});
  relation["tower:type"](around:${buildingRadius},${lat},${lng});
  relation[building=spire](around:${buildingRadius},${lat},${lng});
  
  // ===================================================================
  // SECTION 3: STREETS (substitui findNearbyStreetsForTriggers, detectUrbanDensity, etc)
  // ===================================================================
  
  // Major highways (long range for landmarks)
  way[highway~"^(motorway|trunk|primary|secondary)$"](around:${majorRadius},${lat},${lng});
  
  // Medium roads (medium range)
  way[highway~"^(tertiary|residential|living_street)$"](around:${mediumRadius},${lat},${lng});
  
  // Local access roads (short range)
  way[highway~"^(pedestrian|service|footway|path|track)$"](around:${buildingRadius},${lat},${lng});
  
  // Named roads (priority for trigger points)
  way[highway][name](around:${mediumRadius},${lat},${lng});
  
  // ===================================================================
  // SECTION 4: ELEVATION (substitui getCityBaseElevation, detectRelativeElevation, etc)
  // ===================================================================
  
  // Elevation points and ways
  node[ele](around:${elevationRadius},${lat},${lng});
  way[ele](around:${elevationRadius},${lat},${lng});
  relation[ele](around:${elevationRadius},${lat},${lng});
  
  // Natural elevation features
  way[natural~"^(peak|hill|ridge|valley|cliff)$"](around:${elevationRadius},${lat},${lng});
  relation[natural~"^(peak|hill|ridge|valley|cliff)$"](around:${elevationRadius},${lat},${lng});
);
out geom tags;`;
  return megaQuery;
}
/**
 * Execute mega-unified query with fallback strategy
 * SUBSTITUI TODAS AS 19 CHAMADAS API POR 1 SÓ!
 */ async function getMegaUnifiedPOIData(lat, lng, name = '', landmarkInfo = null) {
  const startTime = Date.now();
  // Check grid-based cache first
  const gridKey = `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;
  if (megaUnifiedCache.has(gridKey)) {
    const cached = megaUnifiedCache.get(gridKey);
    console.log(`🎯 MEGA-UNIFIED: Using cached data for grid ${gridKey} (age: ${((Date.now() - cached.timestamp) / 1000).toFixed(0)}s)`);
    return recalculateForNewPOI(cached, lat, lng, name);
  }
  console.log(`🚀 MEGA-UNIFIED: Collecting data for ${name || 'POI'}`);
  try {
    // Build and execute full query
    const fullQuery = buildMegaUnifiedQuery(lat, lng, name, landmarkInfo);
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: fullQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (mega-unified-poi-analysis)',
        'Content-Type': 'text/plain'
      }
    });
    if (!response.ok) {
      throw new Error(`Mega query failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const queryTime = (Date.now() - startTime) / 1000;
    console.log(`✅ MEGA-UNIFIED: Completed in ${queryTime.toFixed(1)}s - ${data.elements?.length || 0} elements`);
    // Process and validate results
    const processedData = await processMegaUnifiedResults(data, lat, lng, name, landmarkInfo);
    processedData.metadata.queryTime = queryTime;
    // Cache results for reuse
    megaUnifiedCache.set(gridKey, {
      ...processedData,
      timestamp: Date.now()
    });
    return processedData;
  } catch (error) {
    const queryTime = (Date.now() - startTime) / 1000;
    if (error.message.includes('timeout') || queryTime > 110) {
      console.warn(`⚠️ MEGA-UNIFIED: Timeout after ${queryTime.toFixed(2)}s, falling back to legacy methods...`);
      // Fallback to existing legacy methods
      return null; // Will trigger legacy fallback in caller
    }
    console.error(`❌ MEGA-UNIFIED: Query failed after ${queryTime.toFixed(2)}s:`, error.message);
    throw error;
  }
}
/**
 * Process mega-unified results into structured data
 * Compatible with existing code structure
 */ async function processMegaUnifiedResults(data, lat, lng, name, landmarkInfo) {
  const elements = data.elements || [];
  // Separate elements by type and purpose
  const separated = separateElementsByType(elements, lat, lng, name);
  console.log(`📊 Data: ${separated.boundaries.length} boundaries, ${separated.buildings.length} buildings, ${separated.streets.length} streets, ${separated.elevation.length} elevation`);
  // DEBUG: Check if towers/tall structures exist in raw elements before filtering
  const allTowerLikeElements = elements.filter((element)=>{
    const tags = element.tags || {};
    return tags.man_made === 'tower' || tags.building === 'tower' || tags['tower:type'] || tags.tower_type || tags.building === 'spire' || tags.building === 'church' || tags.building === 'cathedral' || tags.man_made === 'lighthouse' || tags.man_made === 'mast' || tags.amenity === 'place_of_worship' || tags.height && parseFloat(tags.height.toString().match(/(\d+\.?\d*)/)?.[1] || '0') > 30;
  });
  console.log(`🗼 DEBUG: Found ${allTowerLikeElements.length} tower/tall structure elements in RAW data:`);
  allTowerLikeElements.slice(0, 5).forEach((tower, index)=>{
    const tags = tower.tags || {};
    const name = tags.name || `${tags.building || tags.man_made || tags.amenity || 'unnamed'}`;
    const type = tags.building || tags.man_made || tags.amenity || 'unknown';
    console.log(`  ${index + 1}. ${name} (${type}): height=${tags.height}, building:height=${tags['building:height']}, levels=${tags['building:levels']}`);
  });
  // Process each data type to match existing format
  const [boundaryResult, buildingAnalysis, streetAnalysis, elevationAnalysis] = await Promise.all([
    processBoundaryDataMega(separated.boundaries, lat, lng, name),
    processBuildingDataMega(separated.buildings, separated.buildingsWithHeight, lat, lng),
    processStreetDataMega(separated.streets, lat, lng, landmarkInfo),
    processElevationDataMega(separated.elevation, lat, lng)
  ]);
  // Calculate landmark info if not provided
  console.log(`🔍 DEBUG: buildingAnalysis.poiHeight =`, buildingAnalysis.poiHeight);
  console.log(`🔍 DEBUG: buildingAnalysis.urbanDensity =`, buildingAnalysis.urbanDensity);
  const calculatedLandmark = landmarkInfo || calculateLandmarkInfo(buildingAnalysis.poiHeight, buildingAnalysis.urbanDensity, elevationAnalysis);
  console.log(`🔍 DEBUG: calculatedLandmark =`, calculatedLandmark);
  return {
    // Core data sections (compatible with existing code)
    boundary: boundaryResult,
    buildings: buildingAnalysis,
    streets: streetAnalysis,
    elevation: elevationAnalysis,
    landmark: calculatedLandmark,
    // Raw data for advanced features (like building detection)
    rawBuildings: separated.buildings,
    rawStreets: separated.streets,
    // Metadata
    metadata: {
      timestamp: Date.now(),
      mode: 'mega-unified',
      location: {
        lat,
        lng
      },
      poiName: name,
      totalElements: elements.length
    }
  };
}
/**
 * Separate OSM elements by type and purpose
 */ function separateElementsByType(elements, lat, lng, name) {
  const boundaries = [];
  const buildings = [];
  const buildingsWithHeight = [];
  const streets = [];
  const elevation = [];
  for (const element of elements){
    const tags = element.tags || {};
    // Boundaries: relations with admin/amenity/leisure, ways with area=yes
    if (element.type === 'relation' && (tags.admin_level || tags.amenity || tags.leisure || tags.name) || element.type === 'way' && tags.area === 'yes' && tags.name || element.type === 'way' && tags.building && tags.area === 'yes') {
      boundaries.push(element);
    }
    // Buildings: any element with building tag OR towers/tall structures
    const isTowerOrSpire = tags.man_made === 'tower' || tags.building === 'tower' || tags['tower:type'] || tags.tower_type || tags.building === 'spire' || tags.building === 'church' || tags.building === 'cathedral' || tags.man_made === 'lighthouse' || tags.man_made === 'mast' || tags.amenity === 'place_of_worship';
    if (tags.building || isTowerOrSpire) {
      buildings.push(element);
      // Debug: Log structure of first few buildings
      if (buildings.length <= 3) {
        console.log(`🔍 OSM Building ${buildings.length}: type=${element.type}, lat=${element.lat}, lon=${element.lon}, center=${element.center ? 'YES' : 'NO'}, nodes=${element.nodes?.length || 0}`);
      }
      // Buildings with height: have height, building:height, building:levels, OR are towers/tall structures
      // FORCE INCLUSION: Always include towers, even without explicit height data
      const hasHeightData = tags.height || tags['building:height'] || tags['building:levels'];
      if (hasHeightData || isTowerOrSpire) {
        buildingsWithHeight.push(element);
        // DEBUG: Log ALL tower inclusions (with or without height)
        if (isTowerOrSpire) {
          const heightInfo = hasHeightData ? `height: ${tags.height || tags['building:height'] || tags['building:levels']}` : 'no explicit height but tower type';
          console.log(`🗼 TOWER INCLUDED: ${tags.name || tags.building || tags.man_made} (${tags.man_made || tags.building}) - ${heightInfo}`);
        }
        // DEBUG: Log buildings with significant height
        if (hasHeightData) {
          const height = parseFloat((tags.height || tags['building:height'] || '0').toString().replace(/[^\d.]/g, ''));
          if (height > 50) {
            console.log(`🏢 HIGH BUILDING: ${tags.name || tags.building || tags.man_made} - ${height}m`);
          }
        }
      }
    }
    // Streets: ways with highway tag
    if (element.type === 'way' && tags.highway) {
      streets.push(element);
    }
    // Elevation: elements with ele tag or natural elevation features
    if (tags.ele || tags.natural && [
      'peak',
      'hill',
      'ridge',
      'valley',
      'cliff'
    ].includes(tags.natural)) {
      elevation.push(element);
    }
  }
  return {
    boundaries,
    buildings,
    buildingsWithHeight,
    streets,
    elevation
  };
}
/**
 * Recalculate cached data for a new POI location
 */ function recalculateForNewPOI(cachedData, newLat, newLng, newName) {
  // Recalculate distances and relevance for the new POI location
  // This allows reusing the same OSM data for nearby POIs
  const recalculated = JSON.parse(JSON.stringify(cachedData)); // Deep clone
  // Update metadata
  recalculated.metadata.location = {
    lat: newLat,
    lng: newLng
  };
  recalculated.metadata.poiName = newName;
  recalculated.metadata.fromCache = true;
  // Recalculate building distances and POI height
  if (recalculated.buildings?.obstructionMap) {
    recalculated.buildings.obstructionMap.forEach((building)=>{
      building.distance = calculateDistance(newLat, newLng, building.lat, building.lng);
    });
    recalculated.buildings.obstructionMap.sort((a, b)=>a.distance - b.distance);
  }
  // Recalculate street distances
  [
    'major',
    'medium',
    'local',
    'immediate'
  ].forEach((category)=>{
    if (recalculated.streets?.[category]) {
      recalculated.streets[category].forEach((street)=>{
        if (street.coordinates) {
          const closestPoint = findClosestPointOnStreet(street.coordinates, newLat, newLng);
          street.distance_to_poi = calculateDistance(newLat, newLng, closestPoint.lat, closestPoint.lng);
          street.closestPoint = closestPoint;
        }
      });
      recalculated.streets[category].sort((a, b)=>a.distance_to_poi - b.distance_to_poi);
    }
  });
  return recalculated;
}
/**
 * Process boundary data from mega-unified results (compatible with existing code)
 */ async function processBoundaryDataMega(boundaryElements, lat, lng, name) {
  if (boundaryElements.length === 0) {
    console.log('⚠️ No boundaries found, using estimated');
    // Use MEGA-UNIFIED fallback: create simple boundary from available data
    console.log('🔄 Creating optimized boundary from MEGA data');
    const radiusMeters = 300; // Default radius
    const points = [];
    for(let i = 0; i < 8; i++){
      const angle = i * 45 * Math.PI / 180;
      const latOffset = radiusMeters / 111000 * Math.cos(angle);
      const lngOffset = radiusMeters / (111000 * Math.cos(lat * Math.PI / 180)) * Math.sin(angle);
      points.push({
        lat: lat + latOffset,
        lng: lng + lngOffset
      });
    }
    return {
      coordinates: points,
      area: Math.PI * radiusMeters * radiusMeters,
      source: 'mega-optimized-fallback'
    };
  }
  // Strategy 1: Find exact name matches first
  const exactMatches = boundaryElements.filter((element)=>{
    const elementName = element.tags?.name || '';
    return elementName.toLowerCase().includes(name.toLowerCase());
  });
  if (exactMatches.length > 0) {
    console.log(`✅ Boundary: exact match found`);
    return await processBoundaryElement(exactMatches[0], lat, lng);
  }
  // Strategy 2: Find closest named feature
  const namedFeatures = boundaryElements.filter((e)=>e.tags?.name);
  if (namedFeatures.length > 0) {
    const closest = findClosestElementMega(namedFeatures, lat, lng);
    return await processBoundaryElement(closest, lat, lng);
  }
  // Fallback: Create estimated boundary
  console.log('⚠️ Using estimated boundary');
  // Use MEGA-UNIFIED fallback: create simple boundary from available data
  console.log('🔄 Creating optimized boundary from MEGA data');
  const radiusMeters = 300; // Default radius
  const points = [];
  for(let i = 0; i < 8; i++){
    const angle = i * 45 * Math.PI / 180;
    const latOffset = radiusMeters / 111000 * Math.cos(angle);
    const lngOffset = radiusMeters / (111000 * Math.cos(lat * Math.PI / 180)) * Math.sin(angle);
    points.push({
      lat: lat + latOffset,
      lng: lng + lngOffset
    });
  }
  return {
    coordinates: points,
    area: Math.PI * radiusMeters * radiusMeters,
    source: 'mega-optimized-fallback'
  };
}
/**
 * Process building data from mega-unified results (compatible with existing code)
 */ async function processBuildingDataMega(allBuildings, buildingsWithHeight, lat, lng) {
  console.log(`🏗️ DEBUG: processBuildingDataMega called with ${allBuildings.length} buildings, ${buildingsWithHeight.length} with height`);
  // Process POI-specific height (replaces detectPOIHeight)
  const poiHeight1 = await processPOIHeightMega(buildingsWithHeight, lat, lng);
  console.log(`🏗️ DEBUG: processPOIHeightMega returned:`, poiHeight1);
  // Process regional height analysis (replaces getRegionalHeightAverage)
  const regionalAnalysis = await processRegionalHeightsMega(buildingsWithHeight, lat, lng);
  // Process urban density (replaces detectUrbanDensity)
  const urbanDensity = calculateUrbanDensityMega(allBuildings, lat, lng);
  console.log(`🏗️ DEBUG: urbanDensity calculated:`, urbanDensity);
  const result = {
    poiHeight: poiHeight1,
    regionalAnalysis: regionalAnalysis,
    urbanDensity: urbanDensity,
    totalBuildings: allBuildings.length,
    buildingsWithHeight: buildingsWithHeight.length
  };
  console.log(`🏗️ DEBUG: processBuildingDataMega returning:`, result);
  return result;
}
/**
 * Process street data from mega-unified results (compatible with existing code)
 */ async function processStreetDataMega(streetElements, lat, lng, landmarkInfo) {
  if (streetElements.length === 0) {
    console.log('⚠️ No streets found');
    return [];
  }
  // Process each street and calculate distance/confidence
  const processedStreets = streetElements.filter((street)=>street.geometry && street.geometry.length >= 2) // Valid geometry
  .map((street)=>processStreetElementMega(street, lat, lng)).filter((street)=>street !== null) // Remove invalid streets
  .sort((a, b)=>b.confidence - a.confidence); // Sort by confidence
  console.log(`🛣️ Streets: ${processedStreets.length} valid from ${streetElements.length} found`);
  return processedStreets;
}
/**
 * Process elevation data using existing legacy elevation functions
 */ async function processElevationDataMega(elevationElements, lat, lng) {
  console.log(`🏔️ DEBUG: processElevationDataMega - using CORRECT landmark detection logic`);
  try {
    // CORRECT LOGIC: Use known landmarks like in detect/route.ts
    const knownLandmarks = [
      {
        name: 'cristo redentor',
        lat: -22.9519,
        lng: -43.2105,
        radius: 1000,
        elevation: 710,
        baseElevation: 10
      },
      {
        name: 'pão de açúcar',
        lat: -22.9487,
        lng: -43.1566,
        radius: 1000,
        elevation: 396,
        baseElevation: 10
      },
      {
        name: 'corcovado',
        lat: -22.9519,
        lng: -43.2105,
        radius: 1000,
        elevation: 710,
        baseElevation: 10
      },
      {
        name: 'pico do jaraguá',
        lat: -23.4561,
        lng: -46.7677,
        radius: 1000,
        elevation: 1135,
        baseElevation: 760
      },
      {
        name: 'jaraguá',
        lat: -23.4561,
        lng: -46.7677,
        radius: 1000,
        elevation: 1135,
        baseElevation: 760
      }
    ];
    // Check if current POI matches known landmarks
    for (const landmark of knownLandmarks){
      const distance = calculateDistance(lat, lng, landmark.lat, landmark.lng);
      console.log(`🔍 Checking ${landmark.name}: distance = ${distance.toFixed(2)}m (radius: ${landmark.radius}m)`);
      if (distance < landmark.radius) {
        const elevationDiff = landmark.elevation - landmark.baseElevation;
        // CORRECT RANGE CALCULATION: Same as detect/route.ts
        const theoreticalRange = Math.sqrt(elevationDiff) * 200; // Conservative multiplier
        const maxRange = Math.min(Math.max(theoreticalRange, 2000), 8000); // Between 2km-8km
        console.log(`🗿 LANDMARK DETECTED: ${landmark.name}`);
        console.log(`  📍 POI elevation: ${landmark.elevation}m`);
        console.log(`  🏞️ Base elevation: ${landmark.baseElevation}m`);
        console.log(`  📈 Relative difference: ${elevationDiff}m`);
        console.log(`  📏 Theoretical range: ${theoreticalRange.toFixed(0)}m`);
        console.log(`  🎯 Max range: ${maxRange.toFixed(0)}m`);
        return {
          poiElevation: landmark.elevation,
          baseElevation: landmark.baseElevation,
          elevationDiff: elevationDiff,
          relativeDiff: elevationDiff,
          maxRange: maxRange,
          confidence: 1.0 // High confidence for known landmarks
        };
      }
    }
    // Not a known landmark - fall back to legacy elevation detection
    console.log(`📍 Not a known landmark - using legacy elevation detection`);
    const elevationData = await detectRelativeElevation(lat, lng);
    const fixedData = {
      poiElevation: elevationData.poiElevation || 0,
      baseElevation: elevationData.averageElevation || 760,
      elevationDiff: elevationData.elevationDiff || 0,
      relativeDiff: elevationData.elevationDiff || 0,
      confidence: elevationData.confidence || 0.5
    };
    console.log(`🔧 Legacy elevation data:`, fixedData);
    return fixedData;
  } catch (error) {
    console.error('❌ Error in elevation detection:', error);
    return {
      poiElevation: 0,
      baseElevation: 760,
      elevationDiff: 0,
      relativeDiff: 0,
      confidence: 0.0
    };
  }
}
/**
 * Helper functions for mega-unified processing
 */ async function processPOIHeightMega(buildingsWithHeight, lat, lng) {
  console.log(`🔍 DEBUG: processPOIHeightMega called with ${buildingsWithHeight.length} buildings`);
  if (buildingsWithHeight.length === 0) {
    console.log(`❌ No buildings with height data provided`);
    return {
      height: 0,
      category: 'low',
      confidence: 0.0
    };
  }
  // COMPLEX STRATEGY: Search for tallest structures within the same architectural complex
  // For complexes like Sagrada Família, towers/spires have the real height while base building is low
  // 1. First, check if we have any tall structures (towers, spires) in the complex
  const tallStructures = buildingsWithHeight.filter((building)=>{
    const tags = building.tags || {};
    const height = extractBuildingHeightMega(tags);
    // Consider it a tall structure if it's a tower/spire/religious building OR has significant height
    const isTallStructureType = tags.man_made === 'tower' || tags.building === 'tower' || tags['tower:type'] || tags.tower_type || tags.building === 'spire' || tags.building === 'church' || tags.building === 'cathedral' || tags.man_made === 'lighthouse' || tags.man_made === 'mast' || tags.amenity === 'place_of_worship';
    const hasSignificantHeight = height > 30; // Above typical building height
    return isTallStructureType || hasSignificantHeight;
  });
  console.log(`🏗️ Found ${tallStructures.length} tall structures in complex of ${buildingsWithHeight.length} buildings`);
  // DEBUG: Log all tall structures found
  console.log(`🔍 DEBUG: All tall structures found in processPOIHeightMega:`);
  tallStructures.slice(0, 10).forEach((structure, index)=>{
    const height = extractBuildingHeightMega(structure.tags || {});
    const name = structure.tags?.name || `${structure.tags?.building || structure.tags?.man_made || structure.tags?.amenity || 'unnamed'}`;
    const type = structure.tags?.building || structure.tags?.man_made || structure.tags?.amenity || 'unknown';
    console.log(`  ${index + 1}. ${name} (${type}): ${height}m [raw: ${structure.tags?.height}]`);
  });
  // DEBUG: Also log a few regular buildings to compare
  console.log(`🏗️ DEBUG: Sample of all buildings passed to processPOIHeightMega:`);
  buildingsWithHeight.slice(0, 5).forEach((building, index)=>{
    const height = extractBuildingHeightMega(building.tags || {});
    const name = building.tags?.name || `${building.tags?.building || building.tags?.man_made || building.tags?.amenity || 'unnamed'}`;
    const type = building.tags?.building || building.tags?.man_made || building.tags?.amenity || 'unknown';
    console.log(`  ${index + 1}. ${name} (${type}): ${height}m [raw: ${building.tags?.height}]`);
  });
  // DEBUG: Log details of tall structures found
  if (tallStructures.length > 0) {
    console.log(`🔍 DEBUG: Top 5 tall structures:`);
    tallStructures.slice(0, 5).forEach((building, index)=>{
      const height = extractBuildingHeightMega(building.tags || {});
      const buildingType = building.tags?.building || building.tags?.man_made || 'unknown';
      const buildingName = building.tags?.name || `${buildingType}`;
      const rawHeight = building.tags?.height || building.tags?.['building:height'] || 'no_height';
      console.log(`  ${index + 1}. ${buildingName}: ${height}m (${buildingType}) [raw: ${rawHeight}]`);
    });
  }
  // DEBUG: Check if we have tall structures in buildingsWithHeight
  const tallStructureElements = buildingsWithHeight.filter((b)=>{
    const tags = b.tags || {};
    return tags.man_made === 'tower' || tags.building === 'tower' || tags['tower:type'] || tags.tower_type || tags.building === 'spire' || tags.building === 'church' || tags.building === 'cathedral' || tags.man_made === 'lighthouse' || tags.man_made === 'mast' || tags.amenity === 'place_of_worship';
  });
  if (tallStructureElements.length > 0) {
    console.log(`🎯 FOUND ${tallStructureElements.length} tall structures in buildingsWithHeight:`);
    tallStructureElements.slice(0, 3).forEach((structure, index)=>{
      const height = extractBuildingHeightMega(structure.tags || {});
      const name = structure.tags?.name || `${structure.tags?.building || structure.tags?.man_made || structure.tags?.amenity || 'unnamed'}`;
      const type = structure.tags?.building || structure.tags?.man_made || structure.tags?.amenity || 'unknown';
      console.log(`  ${index + 1}. ${name} (${type}): ${height}m [raw: ${structure.tags?.height}]`);
    });
  } else {
    console.log(`❌ NO tall structures found in buildingsWithHeight array`);
    // DEBUG: Check if towers exist in raw elements but weren't filtered
    console.log(`🔍 DEBUG: Searching for towers in ALL buildings (${buildingsWithHeight.length} with height):`);
    const towerElements = buildingsWithHeight.filter((b)=>{
      const tags = b.tags || {};
      return tags.man_made === 'tower' || tags.building === 'tower' || tags['tower:type'] || tags.tower_type || tags.building === 'spire' || tags.building === 'church' || tags.building === 'cathedral' || tags.man_made === 'lighthouse' || tags.man_made === 'mast' || tags.amenity === 'place_of_worship';
    });
    console.log(`🗼 Found ${towerElements.length} tower-like elements in buildingsWithHeight:`);
    towerElements.slice(0, 3).forEach((tower, index)=>{
      const height = extractBuildingHeightMega(tower.tags || {});
      console.log(`  ${index + 1}. ${tower.tags?.name || tower.tags?.building || tower.tags?.man_made}: ${height}m [raw: ${tower.tags?.height}]`);
    });
  }
  // 2. If we have tall structures, prioritize the tallest one
  let buildingsToSearch = buildingsWithHeight;
  if (tallStructures.length > 0) {
    // Sort by height (tallest first)
    buildingsToSearch = tallStructures.sort((a, b)=>{
      const heightA = extractBuildingHeightMega(a.tags || {});
      const heightB = extractBuildingHeightMega(b.tags || {});
      return heightB - heightA;
    });
    console.log(`🎯 Prioritizing tall structures - tallest has ${extractBuildingHeightMega(buildingsToSearch[0].tags || {})}m`);
  }
  // DEBUG: Check height extraction for tall structures
  console.log(`🔍 DEBUG: Checking height extraction for ${tallStructures.length} tall structures:`);
  tallStructures.slice(0, 5).forEach((structure, i)=>{
    const tags = structure.tags || {};
    const extractedHeight = extractBuildingHeightMega(tags);
    console.log(`  ${i + 1}. ${tags.name || 'unnamed'} (${tags.man_made || tags.building}): extracted=${extractedHeight}m [raw: height=${tags.height}, building:height=${tags['building:height']}, levels=${tags['building:levels']}]`);
  });
  // Count structures >50m for complex detection
  const over50mCount = tallStructures.filter((s)=>extractBuildingHeightMega(s.tags) > 50).length;
  console.log(`🏗️ Structures over 50m: ${over50mCount} out of ${tallStructures.length} tall structures`);
  // Detect if this is an architectural complex (multiple tall structures close together)
  const isArchitecturalComplex = tallStructures.length >= 3 && over50mCount >= 2;
  console.log(`🏛️ Architectural complex detected: ${isArchitecturalComplex} (${tallStructures.length} tall structures)`);
  // Find best building: different logic for complexes vs individual buildings
  let bestBuilding = null;
  let bestScore = -Infinity;
  for (const building of buildingsToSearch){
    const center = calculateBuildingCenterMega(building);
    const distance = calculateDistance(lat, lng, center.lat, center.lng);
    const height = extractBuildingHeightMega(building.tags);
    let score;
    if (isArchitecturalComplex) {
      // COMPLEX MODE: Prioritize height over distance (Sagrada Família case)
      if (height > 50) {
        score = height * 10 - distance * 1000; // Height dominates for tall structures
      } else {
        score = height - distance * 2000; // Distance dominates for regular buildings
      }
      console.log(`🏛️ COMPLEX SCORING: ${building.tags?.name || 'unnamed'} - height: ${height}m, distance: ${distance.toFixed(0)}m, score: ${score.toFixed(0)}`);
    } else {
      // INDIVIDUAL MODE: Prioritize proximity (avoid choosing neighbor buildings)
      score = -distance * 10000 + height; // Distance strongly dominates
      console.log(`🏢 INDIVIDUAL SCORING: ${building.tags?.name || 'unnamed'} - height: ${height}m, distance: ${distance.toFixed(0)}m, score: ${score.toFixed(0)}`);
    }
    if (score > bestScore) {
      bestScore = score;
      bestBuilding = building;
    }
  }
  if (!bestBuilding) {
    return {
      height: 0,
      category: 'low',
      confidence: 0.0
    };
  }
  const finalCenter = calculateBuildingCenterMega(bestBuilding);
  const finalDistance = calculateDistance(lat, lng, finalCenter.lat, finalCenter.lng);
  const height = extractBuildingHeightMega(bestBuilding.tags);
  const category = categorizeHeightMega(height);
  let confidence = finalDistance < 50 ? 1.0 : finalDistance < 100 ? 0.9 : 0.7;
  confidence = Math.min(1.0, confidence);
  const buildingType = bestBuilding.tags?.building || bestBuilding.tags?.man_made || 'building';
  const buildingName = bestBuilding.tags?.name || buildingType;
  console.log(`🏗️ POI height: ${height}m (${category}) from ${buildingName} at ${finalDistance.toFixed(0)}m away`);
  return {
    height,
    category,
    confidence
  };
}
async function processRegionalHeightsMega(buildingsWithHeight, lat, lng) {
  const regionalBuildings = buildingsWithHeight.filter((building)=>{
    const center = calculateBuildingCenterMega(building);
    const distance = calculateDistance(lat, lng, center.lat, center.lng);
    return distance <= 300;
  });
  if (regionalBuildings.length === 0) {
    return {
      average: 25,
      samples: 0,
      confidence: 0.0
    };
  }
  const heights = regionalBuildings.map((building)=>extractBuildingHeightMega(building.tags)).filter((height)=>height > 0 && height <= 300);
  if (heights.length === 0) {
    return {
      average: 25,
      samples: 0,
      confidence: 0.0
    };
  }
  const average = heights.reduce((sum, h)=>sum + h, 0) / heights.length;
  const confidence = Math.min(1.0, heights.length / 5);
  return {
    average,
    samples: heights.length,
    confidence
  };
}
function calculateUrbanDensityMega(allBuildings, lat, lng) {
  const buildingsIn200m = allBuildings.filter((building)=>{
    const center = calculateBuildingCenterMega(building);
    const distance = calculateDistance(lat, lng, center.lat, center.lng);
    return distance <= 200;
  }).length;
  const area = Math.PI * 0.2 ** 2; // km²
  const density = buildingsIn200m / area;
  let classification;
  if (density >= 400) classification = 'very_dense';
  else if (density >= 200) classification = 'dense';
  else if (density >= 100) classification = 'medium';
  else if (density >= 30) classification = 'low';
  else classification = 'rural';
  console.log(`🏙️ Urban density: ${classification} (${buildingsIn200m} buildings in 200m)`);
  return classification;
}
function processStreetElementMega(streetElement, lat, lng) {
  try {
    const tags = streetElement.tags || {};
    const highway_type = tags.highway;
    const name = tags.name || 'Unnamed';
    const coordinates = streetElement.geometry.map((node)=>[
        node.lon,
        node.lat
      ]);
    const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
    const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng);
    let confidence = 0.5;
    const typeScores = {
      'primary': 1.0,
      'secondary': 0.95,
      'tertiary': 0.9,
      'residential': 0.8,
      'living_street': 0.75,
      'pedestrian': 0.85,
      'footway': 0.7,
      'service': 0.6
    };
    confidence *= typeScores[highway_type] || 0.3;
    if (distance < 150) confidence *= 1.0;
    else if (distance < 300) confidence *= 0.9;
    else confidence *= 0.7;
    if (name !== 'Unnamed') confidence += 0.1;
    confidence = Math.min(1.0, confidence);
    return {
      name,
      highway_type,
      coordinates,
      distance_to_poi: distance,
      confidence,
      osm_id: streetElement.id.toString(),
      tags
    };
  } catch (error) {
    return null;
  }
}
function calculateBuildingCenterMega(building) {
  if (building.lat && building.lon) {
    return {
      lat: building.lat,
      lng: building.lon
    };
  }
  if (building.geometry && building.geometry.length > 0) {
    const coords = building.geometry;
    const lat = coords.reduce((sum, c)=>sum + c.lat, 0) / coords.length;
    const lng = coords.reduce((sum, c)=>sum + c.lon, 0) / coords.length;
    return {
      lat,
      lng
    };
  }
  return {
    lat: 0,
    lng: 0
  };
}
function extractBuildingHeightMega(tags) {
  // DEBUG: For towers, log the raw tags to understand the data structure
  const isTower = tags.man_made === 'tower' || tags.building === 'tower' || tags['tower:type'];
  if (isTower && tags.name && (tags.name.includes('Torre') || tags.name.includes('Jesus'))) {
    console.log(`🔍 DEBUG HEIGHT EXTRACTION for ${tags.name}:`, {
      height: tags.height,
      'building:height': tags['building:height'],
      'building:levels': tags['building:levels'],
      heightType: typeof tags.height,
      heightValue: tags.height
    });
  }
  if (tags.height) {
    // Handle both string and number formats
    const heightStr = tags.height.toString();
    const height = parseFloat(heightStr.replace(/[^\d.]/g, ''));
    if (isTower && tags.name && tags.name.includes('Torre')) {
      console.log(`🔍 HEIGHT PARSING: ${tags.name} - input: "${heightStr}" -> parsed: ${height}`);
    }
    if (height > 0 && height <= 300) return height;
  }
  if (tags['building:height']) {
    const heightStr = tags['building:height'].toString();
    const height = parseFloat(heightStr.replace(/[^\d.]/g, ''));
    if (height > 0 && height <= 300) return height;
  }
  if (tags['building:levels']) {
    const levels = parseInt(tags['building:levels']);
    if (levels > 0 && levels <= 100) return levels * 3.5;
  }
  return 0;
}
function categorizeHeightMega(height) {
  if (height >= 100) return 'very_high';
  if (height >= 50) return 'high';
  if (height >= 20) return 'medium';
  if (height > 0) return 'low';
  return 'unknown';
}
function findClosestElementMega(elements, lat, lng) {
  let closest = null;
  let closestDistance = Infinity;
  for (const element of elements){
    const center = calculateBuildingCenterMega(element);
    const distance = calculateDistance(lat, lng, center.lat, center.lng);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = element;
    }
  }
  return closest;
}
/**
 * Process a single boundary element into standardized format
 */ async function processBoundaryElement(element, poiLat, poiLng) {
  try {
    let coordinates = [];
    let area = 0;
    if (element.type === 'way' && element.geometry) {
      // Way with geometry
      coordinates = element.geometry.map((node)=>[
          node.lat,
          node.lon
        ]);
      area = calculatePolygonArea(coordinates);
    } else if (element.type === 'relation') {
      // Relation - need to process members
      // MEGA-UNIFIED: Create optimized estimated boundary
      console.log('🔄 Relation boundary detected, using MEGA-UNIFIED estimated polygon...');
      const radius = 300; // Fixed radius for consistency
      const boundaryPoints = [];
      const numPoints = 16;
      for(let i = 0; i < numPoints; i++){
        const angle = i * 2 * Math.PI / numPoints;
        const latOffset = radius / 111320 * Math.cos(angle);
        const lngOffset = radius / (111320 * Math.cos(poiLat * Math.PI / 180)) * Math.sin(angle);
        boundaryPoints.push([
          poiLng + lngOffset,
          poiLat + latOffset
        ]);
      }
      boundaryPoints.push(boundaryPoints[0]); // Close the polygon
      return {
        coordinates: [
          boundaryPoints
        ],
        area_m2: Math.PI * radius * radius,
        confidence: 0.7,
        source: 'mega_unified_estimated'
      };
    }
    // Validate coordinates
    if (coordinates.length < 3) {
      console.log('⚠️ Insufficient coordinates, using MEGA-UNIFIED estimated boundary');
      const radius = 300;
      const boundaryPoints = [];
      const numPoints = 16;
      for(let i = 0; i < numPoints; i++){
        const angle = i * 2 * Math.PI / numPoints;
        const latOffset = radius / 111320 * Math.cos(angle);
        const lngOffset = radius / (111320 * Math.cos(poiLat * Math.PI / 180)) * Math.sin(angle);
        boundaryPoints.push([
          poiLng + lngOffset,
          poiLat + latOffset
        ]);
      }
      boundaryPoints.push(boundaryPoints[0]);
      return {
        coordinates: [
          boundaryPoints
        ],
        area_m2: Math.PI * radius * radius,
        confidence: 0.6,
        source: 'mega_unified_estimated'
      };
    }
    // Calculate confidence based on area and proximity
    const centerDistance = calculateDistanceToPolygon({
      lat: poiLat,
      lng: poiLng
    }, coordinates);
    let confidence = 0.8;
    if (centerDistance < 50) confidence += 0.15; // POI inside or very close
    if (area > 1000 && area < 100000) confidence += 0.05; // Reasonable size
    if (element.tags?.name) confidence += 0.1; // Has name
    confidence = Math.min(0.95, confidence);
    return {
      coordinates: coordinates,
      area_m2: area,
      confidence: confidence,
      source: 'osm_processed',
      osmId: element.id,
      tags: element.tags || {}
    };
  } catch (error) {
    console.error('❌ Error processing boundary element:', error);
    // MEGA-UNIFIED: Error fallback boundary
    const radius = 300;
    const boundaryPoints = [];
    const numPoints = 16;
    for(let i = 0; i < numPoints; i++){
      const angle = i * 2 * Math.PI / numPoints;
      const latOffset = radius / 111320 * Math.cos(angle);
      const lngOffset = radius / (111320 * Math.cos(poiLat * Math.PI / 180)) * Math.sin(angle);
      boundaryPoints.push([
        poiLng + lngOffset,
        poiLat + latOffset
      ]);
    }
    boundaryPoints.push(boundaryPoints[0]);
    return {
      coordinates: [
        boundaryPoints
      ],
      area_m2: Math.PI * radius * radius,
      confidence: 0.5,
      source: 'mega_unified_error_fallback'
    };
  }
}
function calculateLandmarkInfo(poiHeight1, urbanDensity, elevationAnalysis) {
  const heightThresholds = {
    'very_dense': 200,
    'dense': 120,
    'medium': 60,
    'low': 30,
    'rural': 15
  };
  const threshold = heightThresholds[urbanDensity] || 30;
  const heightCondition = poiHeight1.height > threshold;
  const elevationCondition = elevationAnalysis.relativeDiff > 50;
  const isHighVisibility = heightCondition || elevationCondition;
  console.log(`🗿 DEBUG: Landmark calculation:`);
  console.log(`  🏗️ Height: ${poiHeight1.height}m vs threshold ${threshold}m = ${heightCondition}`);
  console.log(`  🏔️ Elevation diff: ${elevationAnalysis.relativeDiff}m vs 50m = ${elevationCondition}`);
  console.log(`  👁️ High visibility: ${isHighVisibility} (height: ${heightCondition}, elevation: ${elevationCondition})`);
  // PRIORITY: Use maxRange from landmark detection if available
  let maxRange;
  if (elevationAnalysis.maxRange) {
    maxRange = elevationAnalysis.maxRange;
    console.log(`  📏 Using landmark-calculated max range: ${maxRange}m`);
  } else {
    maxRange = isHighVisibility ? Math.min(4000, poiHeight1.height * 20 + elevationAnalysis.relativeDiff * 50) : 400;
    console.log(`  📏 Using height-based max range: ${maxRange}m`);
  }
  return {
    isHighVisibility,
    maxRange,
    elevationDiff: elevationAnalysis.relativeDiff,
    buildingHeight: poiHeight1.height,
    landmarkType: isHighVisibility ? 'landmark' : 'urban_building'
  };
}
/**
 * Generate trigger points using mega-unified data
 * Uses all data collected in one API call for optimal performance
 * HIGH LANDMARKS: Use circular strategy instead of buffer strategy
 */ async function generateTriggerPointsFromMegaData(megaData, boundary, lat, lng, name) {
  // Validate megaData is not null
  if (!megaData) {
    console.error(`❌ generateTriggerPointsFromMegaData called with null megaData`);
    return [];
  }
  // Extract data from mega-unified result
  const { streets, buildings, elevation, landmark } = megaData;
  // Use the processed streets data (already sorted by confidence)
  const processedStreets = streets || [];
  // 🏔️ HIGH LANDMARK STRATEGY: Use legacy circular radius logic (up to 4km)
  if (landmark && landmark.isHighVisibility && landmark.landmarkType === 'landmark') {
    console.log(`🏔️ HIGH LANDMARK DETECTED: Using legacy circular strategy`);
    console.log(`  🎯 Landmark type: ${landmark.landmarkType}`);
    console.log(`  📏 Max range: ${landmark.maxRange}m`);
    console.log(`  🏗️ Building height: ${landmark.buildingHeight}m`);
    console.log(`  🏔️ Elevation diff: ${landmark.elevationDiff}m`);
    // For high landmarks, use the existing legacy logic with expanded radius
    // Legacy logic: majorRadius up to 6km, mediumRadius up to 4km, minorRadius up to 3km
    const streetTriggerPoints = await generateTriggersFromMegaStreets(lat, lng, boundary.coordinates, processedStreets, landmark, buildings.regionalAnalysis, megaData.buildings.allBuildings, buildings.poiHeight // Pass POI height from mega-data
    );
    console.log(`🏔️ LEGACY CIRCULAR STRATEGY: Generated ${streetTriggerPoints.length} trigger points for high landmark`);
    return streetTriggerPoints;
  }
  // 🏘️ STANDARD STRATEGY: Use buffer-based approach for urban buildings
  console.log(`🏘️ STANDARD POI: Using buffer strategy`);
  if (processedStreets.length === 0) {
    console.log('⚠️ No streets, using boundary-based triggers');
    return generateOptimalTriggerPoints(boundary, lat, lng, name, landmark);
  }
  // Generate trigger points using the same logic as legacy but with mega-data
  const streetTriggerPoints = await generateTriggersFromMegaStreets(lat, lng, boundary.coordinates, processedStreets, landmark, buildings.regionalAnalysis, megaData.buildings.allBuildings, buildings.poiHeight // Pass POI height from mega-data
  );
  console.log(`✅ BUFFER STRATEGY: Generated ${streetTriggerPoints.length} trigger points`);
  return streetTriggerPoints;
}
/**
 * Generate triggers from mega-unified street data
 * Optimized version using pre-processed data
 */ async function generateTriggersFromMegaStreets(poiLat, poiLng, boundaryCoordinates, streets, landmarkInfo, regionalHeight1, megaBuildings1 = null, poiHeight1 = null) {
  // Calculate POI area for internal logic - ALWAYS try to calculate real area first
  let poiArea;
  if (boundaryCoordinates && Array.isArray(boundaryCoordinates) && boundaryCoordinates.length > 2) {
    try {
      poiArea = calculatePolygonArea(boundaryCoordinates);
      if (!poiArea || isNaN(poiArea) || poiArea <= 0) {
        console.warn('⚠️ Invalid calculated POI area, using fallback');
        poiArea = 100000; // Fallback only if calculation is invalid
      } else {
      // POI area calculated successfully
      }
    } catch (error) {
      console.warn('⚠️ Error calculating POI area in generateTriggersFromMegaStreets, using fallback:', error.message);
      poiArea = 100000; // Fallback only on error
    }
  } else {
    console.warn('⚠️ No valid boundary coordinates, using fallback POI area');
    poiArea = 100000; // Fallback only if no valid boundaries
  }
  const triggerPoints = [];
  // Sort streets by confidence (already done in mega-processing, but ensure)
  const sortedStreets = streets.sort((a, b)=>b.confidence - a.confidence);
  for(let i = 0; i < sortedStreets.length; i++){
    const street = sortedStreets[i];
    const isFullCheck = i < SAMPLING_CONFIG.MAX_FULL_CHECKS; // Full check for closest streets only
    // Find strategic points on this street with smart sampling
    const streetPoints = await findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo, regionalHeight1, isFullCheck, megaBuildings1, poiHeight1);
    triggerPoints.push(...streetPoints);
  }
  // POI area already calculated at function start with fallback validation
  // Dynamic minimum distance based on LANDMARK INFO FIRST, then POI size
  let minPointDistance = 50; // Default
  if (landmarkInfo?.isHighVisibility) {
    minPointDistance = 100; // High-visibility landmarks: more spread out for better coverage
  } else if (poiArea > 1000000) {
    minPointDistance = 30; // Large areas: closer points OK
  } else if (poiArea > 100000) {
    minPointDistance = 40; // Medium areas
  } else if (poiArea > 10000) {
    minPointDistance = 50; // Small areas: need some spacing
  } else {
    minPointDistance = 60; // Very small areas: more spacing
  }
  // Remove points that are too close to each other (avoid clustering)
  const filteredPoints = [];
  for (const point of triggerPoints){
    const tooClose = filteredPoints.some((existing)=>calculateDistance(point.lat, point.lng, existing.lat, existing.lng) < minPointDistance);
    if (!tooClose) {
      filteredPoints.push(point);
    }
  }
  // Sort by confidence and distance for final selection
  const sortedPoints = filteredPoints.sort((a, b)=>{
    // Primary: confidence (higher is better)
    if (Math.abs(a.confidence - b.confidence) > 0.1) {
      return b.confidence - a.confidence;
    }
    // Secondary: distance (closer is better for same confidence)
    return a.distance_from_poi - b.distance_from_poi;
  });
  // Return top points (limit based on POI type)
  const maxPoints = landmarkInfo?.isHighVisibility ? 25 : 15;
  const finalPoints = sortedPoints.slice(0, maxPoints);
  return finalPoints;
}
// Intelligent sampling configuration
const SAMPLING_CONFIG = {
  SAMPLE_SIZE: 5,
  MAX_FULL_CHECKS: 10,
  CACHE_RADIUS: 500,
  HEIGHT_THRESHOLD: 50 // If regional avg > 50m, assume high density
};
// Get regional building height average using intelligent sampling
// MOVED TO legacy-functions.ts - getRegionalHeightAverage() 
// This function was replaced by processRegionalHeightsMega() in mega-unified system
// MOVED TO legacy-functions.ts - detectPOIHeight()
// This function was replaced by processPOIHeightMega() in mega-unified system
// MOVED TO legacy-functions.ts - detectRelativeElevation() and getElevation()
// These functions were replaced by processElevationDataMega() in mega-unified system
// Calculate height-based range for trigger points (LEGACY FUNCTION)
function calculateHeightBasedRange(poiHeight1, urbanDensity) {
  // Base ranges by urban density (for ground-level POIs)
  const baseRanges = {
    'very_dense': 150,
    'dense': 250,
    'medium': 400,
    'low': 600,
    'rural': 800 // Rural areas
  };
  const baseRange = baseRanges[urbanDensity];
  // Height multipliers - taller POIs can be seen over obstacles
  let heightMultiplier = 1.0;
  switch(poiHeight1.category){
    case 'low':
      heightMultiplier = 1.0;
      console.log(`🏠 Low POI (${poiHeight1.height}m) - no height advantage`);
      break;
    case 'medium':
      if (urbanDensity === 'very_dense' || urbanDensity === 'dense') {
        heightMultiplier = 1.3; // Modest increase in dense areas
      } else {
        heightMultiplier = 1.5; // Better visibility in less dense areas
      }
      console.log(`🏢 Medium POI (${poiHeight1.height}m) - can see over low buildings (${heightMultiplier}x)`);
      break;
    case 'high':
      if (urbanDensity === 'very_dense') {
        heightMultiplier = 1.5; // Still limited by other tall buildings
      } else if (urbanDensity === 'dense') {
        heightMultiplier = 2.0; // Good visibility over most buildings
      } else {
        heightMultiplier = 2.5; // Excellent visibility in less dense areas
      }
      console.log(`🏗️ High POI (${poiHeight1.height}m) - can see over most buildings (${heightMultiplier}x)`);
      break;
    case 'very_high':
      if (urbanDensity === 'very_dense') {
        heightMultiplier = 2.0; // Limited by other skyscrapers
      } else {
        heightMultiplier = 3.0; // True landmark visibility
      }
      console.log(`🏙️ Very High POI (${poiHeight1.height}m) - landmark visibility (${heightMultiplier}x)`);
      break;
  }
  // Apply confidence factor - lower confidence = more conservative range
  const confidenceFactor = 0.5 + poiHeight1.confidence * 0.5; // 0.5 to 1.0
  const finalRange = Math.round(baseRange * heightMultiplier * confidenceFactor);
  // Cap ranges to reasonable limits
  const cappedRange = Math.min(Math.max(finalRange, 100), 1500);
  console.log(`📊 Range calculation: base=${baseRange}m × height=${heightMultiplier}x × confidence=${confidenceFactor.toFixed(2)} = ${finalRange}m (capped: ${cappedRange}m)`);
  return cappedRange;
}
// Check building obstructions between trigger point and POI (LEGACY FUNCTION)
async function checkBuildingObstructions(triggerPoint, poiLat, poiLng, poiHeight1) {
  try {
    console.log(`🏢 Checking building obstructions for trigger point at ${triggerPoint.lat.toFixed(4)}, ${triggerPoint.lng.toFixed(4)}`);
    // Create a line of sight between trigger point and POI
    const midLat = (triggerPoint.lat + poiLat) / 2;
    const midLng = (triggerPoint.lng + poiLng) / 2;
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
    // For very close points or high POIs, assume good visibility
    if (distance <= 50 || poiHeight1 && poiHeight1.height > 30) {
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
// MOVED TO legacy-functions.ts - normalizeAngleDifference()
// This function was replaced by optimized angle calculations in mega-unified system
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
  if ([
    'primary',
    'secondary',
    'tertiary'
  ].includes(highwayType)) {
    frontScore += 0.2;
    reasoning += `, major road (${highwayType})`;
  } else if ([
    'residential',
    'living_street'
  ].includes(highwayType)) {
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
  const isMainAccess = streetName.includes('avenida') || streetName.includes('rua principal') || streetName.includes('acesso') || streetName.includes('entrada');
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
  for(let i = 0; i < streetLength; i += step){
    const point = coordinates[i];
    const distanceToPOI = calculateDistance(poiLat, poiLng, point.lat, point.lng);
    // CRITICAL: Validate point is OUTSIDE the POI boundary, not just 25m from center
    const isOutsideBoundary = boundaryCoordinates ? !isPointInPolygon(point, boundaryCoordinates) : true;
    const minDistanceFromBoundary = boundaryCoordinates ? calculateDistanceToPolygon(point, boundaryCoordinates) : 0;
    // OPTIMIZED: Ensure point is outside boundary with expanded distance range for better coverage
    // Extended range to capture more strategic viewpoints and plazas
    if (isOutsideBoundary && minDistanceFromBoundary >= 8 && distanceToPOI >= 10 && distanceToPOI <= 200) {
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
  candidatePoints.sort((a, b)=>b.score - a.score);
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
  return points.map((point)=>{
    const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng);
    // Classify based on distance and confidence
    if (distance <= 30 && point.confidence >= 0.8) {
      return {
        ...point,
        type: 'primary'
      };
    } else if (distance <= 50 && point.confidence >= 0.6) {
      return {
        ...point,
        type: 'secondary'
      };
    } else {
      return {
        ...point,
        type: 'fallback'
      };
    }
  });
}
// Create fallback boundary from streets (LEGACY FUNCTION)
async function createFallbackBoundaryFromStreets(lat, lng, poiName, landmarkInfo) {
  try {
    console.log(`🔄 Fallback: Finding closest street directly in front of POI at (${lat}, ${lng})`);
    const immediateStreets = await findImmediateStreets(lat, lng);
    if (immediateStreets.length === 0) {
      console.log('❌ No immediate streets found, using MEGA-UNIFIED fallback boundary');
      const radius = 300;
      const boundaryPoints = [];
      const numPoints = 16;
      for(let i = 0; i < numPoints; i++){
        const angle = i * 2 * Math.PI / numPoints;
        const latOffset = radius / 111320 * Math.cos(angle);
        const lngOffset = radius / (111320 * Math.cos(lat * Math.PI / 180)) * Math.sin(angle);
        boundaryPoints.push([
          lng + lngOffset,
          lat + latOffset
        ]);
      }
      boundaryPoints.push(boundaryPoints[0]);
      return {
        coordinates: [
          boundaryPoints
        ],
        area_m2: Math.PI * radius * radius,
        confidence: 0.4,
        source: 'mega_unified_no_streets'
      };
    }
    // Find the closest street
    const closestStreet = immediateStreets.reduce((closest, current)=>current.distance < closest.distance ? current : closest);
    console.log(`✅ Using closest street: ${closestStreet.name} at ${closestStreet.distance.toFixed(1)}m`);
    // MEGA-UNIFIED: Create optimized boundary based on street distance
    const radiusMeters = Math.max(50, closestStreet.distance + 20);
    const boundaryPoints = [];
    const numPoints = 16;
    for(let i = 0; i < numPoints; i++){
      const angle = i * 2 * Math.PI / numPoints;
      const latOffset = radiusMeters / 111320 * Math.cos(angle);
      const lngOffset = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180)) * Math.sin(angle);
      boundaryPoints.push([
        lng + lngOffset,
        lat + latOffset
      ]);
    }
    boundaryPoints.push(boundaryPoints[0]);
    return {
      coordinates: [
        boundaryPoints
      ],
      area_m2: Math.PI * radiusMeters * radiusMeters,
      confidence: 0.6,
      source: 'mega_unified_street_based'
    };
  } catch (error) {
    console.error('❌ Error creating fallback boundary from streets:', error);
    // MEGA-UNIFIED: Final error fallback
    const radius = 300;
    const boundaryPoints = [];
    const numPoints = 16;
    for(let i = 0; i < numPoints; i++){
      const angle = i * 2 * Math.PI / numPoints;
      const latOffset = radius / 111320 * Math.cos(angle);
      const lngOffset = radius / (111320 * Math.cos(lat * Math.PI / 180)) * Math.sin(angle);
      boundaryPoints.push([
        lng + lngOffset,
        lat + latOffset
      ]);
    }
    boundaryPoints.push(boundaryPoints[0]);
    return {
      coordinates: [
        boundaryPoints
      ],
      area_m2: Math.PI * radius * radius,
      confidence: 0.3,
      source: 'mega_unified_final_fallback'
    };
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
      for (const element of data.elements){
        const ele = element.tags?.ele;
        if (ele && !isNaN(parseFloat(ele))) {
          elevations.push(parseFloat(ele));
        }
      }
    }
    if (elevations.length > 0) {
      // Use median elevation as city base (more robust than average)
      elevations.sort((a, b)=>a - b);
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
  coordinates.forEach((coord)=>{
    const distance = calculateDistance(centerLat, centerLng, coord.lat, coord.lng);
    corners.push({
      ...coord,
      distance
    });
  });
  // Sort by distance and take the furthest points (extremities)
  corners.sort((a, b)=>b.distance - a.distance);
  // Return top 4-6 corners
  const numCorners = Math.min(6, Math.max(4, Math.floor(coordinates.length / 20)));
  return corners.slice(0, numCorners);
}
// MOVED TO legacy-functions.ts - findNearbyStreetsForTriggers()
// This function was replaced by processStreetDataMega() in mega-unified system
// MOVED TO legacy-functions.ts - processOverpassStreetData()
// This function was replaced by processStreetDataMega() in mega-unified system
// MOVED TO legacy-functions.ts - generateTriggersOnStreets()
// This function was replaced by generateTriggersFromMegaStreets() in mega-unified system
async function generateTriggersOnStreetsRemoved(poiLat, poiLng, boundaryCoordinates, streets, landmarkInfo, regionalHeight1 = null) {
  // Calculate POI area for internal logic - ALWAYS try to calculate real area first
  let poiArea;
  if (boundaryCoordinates && Array.isArray(boundaryCoordinates) && boundaryCoordinates.length > 2) {
    try {
      poiArea = calculatePolygonArea(boundaryCoordinates);
      if (!poiArea || isNaN(poiArea) || poiArea <= 0) {
        console.warn('⚠️ Invalid calculated POI area in generateTriggersOnStreetsRemoved, using fallback');
        poiArea = 100000; // Fallback only if calculation is invalid
      } else {
      // POI area calculated successfully
      }
    } catch (error) {
      console.warn('⚠️ Error calculating POI area in generateTriggersOnStreetsRemoved, using fallback:', error.message);
      poiArea = 100000; // Fallback only on error
    }
  } else {
    console.warn('⚠️ No valid boundary coordinates in generateTriggersOnStreetsRemoved, using fallback POI area');
    poiArea = 100000; // Fallback only if no valid boundaries
  }
  const triggerPoints = [];
  // INTELLIGENT SAMPLING: Sort streets by distance and process smartly
  const sortedStreets = streets.sort((a, b)=>(a.distance_to_poi || 0) - (b.distance_to_poi || 0));
  console.log(`📊 Processing ${sortedStreets.length} streets with intelligent sampling:`);
  console.log(`   - Full checks: ${Math.min(SAMPLING_CONFIG.MAX_FULL_CHECKS, sortedStreets.length)} closest streets`);
  console.log(`   - Fast estimates: ${Math.max(0, sortedStreets.length - SAMPLING_CONFIG.MAX_FULL_CHECKS)} distant streets`);
  for(let i = 0; i < sortedStreets.length; i++){
    const street = sortedStreets[i];
    const isFullCheck = i < SAMPLING_CONFIG.MAX_FULL_CHECKS; // Full check for closest streets only
    // Find strategic points on this street with smart sampling
    const streetPoints = await findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo, regionalHeight1, isFullCheck);
    // Debug: log points generated for distant streets
    if (street.distance_to_poi && street.distance_to_poi > 1000) {
      const distance = typeof street.distance_to_poi === 'number' ? street.distance_to_poi : 0;
      const streetName = street.name || 'Unnamed street';
      console.log(`🛣️ Distant street ${streetName} (${distance}m) generated ${streetPoints.length} points`);
      if (streetPoints.length === 0) {
        console.log(`❌ No points generated for distant street: ${streetName}`);
      }
    }
    triggerPoints.push(...streetPoints);
  }
  // POI area already calculated at function start with fallback validation
  // Dynamic minimum distance based on LANDMARK INFO FIRST, then POI size
  let minPointDistance = 50; // Default
  if (landmarkInfo?.isHighVisibility) {
    minPointDistance = 100; // High-visibility landmarks: more spread out for better coverage
    console.log(`🏔️ High-visibility landmark: using minPointDistance=${minPointDistance}m`);
  } else if (poiArea && poiArea > 1000000) {
    minPointDistance = 30; // Large areas: closer points OK
  } else if (poiArea && poiArea > 100000) {
    minPointDistance = 40; // Medium areas
  } else if (poiArea && poiArea < 50000) {
    minPointDistance = 60; // Small areas: spread out more
  }
  // Remove duplicates (points too close to each other)
  const filteredPoints = removeDuplicatePoints(triggerPoints, minPointDistance);
  // Classify points by priority
  const classifiedPoints = classifyTriggerPointsByStreet(filteredPoints, poiLat, poiLng);
  console.log(`📍 Generated ${classifiedPoints.length} street trigger points`);
  // Dynamic limit based on LANDMARK INFO FIRST, then POI size
  let maxPoints = 15; // Default
  // Check poiArea value before using it
  if (landmarkInfo?.isHighVisibility) {
    maxPoints = 40; // Increased for high-visibility landmarks since they pass visibility filter
    console.log(`🏔️ High-visibility landmark: allowing up to ${maxPoints} trigger points`);
  } else if (poiArea && poiArea > 1000000) {
    maxPoints = 20; // Large areas get more points
  } else if (poiArea && poiArea > 500000) {
    maxPoints = 18; // Medium-large areas
  } else if (poiArea && poiArea > 100000) {
    maxPoints = 16; // Medium areas
  }
  // Function body removed - moved to legacy-functions.ts
  return [];
}
// MOVED TO legacy-functions.ts - queryOverpassAPI() and buildOverpassQuery()
// These functions were replaced by getMegaUnifiedPOIData() and buildMegaUnifiedQuery() in mega-unified system
// MOVED TO legacy-functions.ts - lineIntersectsPolygon()
// This function was replaced by optimized geometry functions in mega-unified system
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
    const { error } = await supabase.schema('core').from('attractions').update(updateData).eq('id', poiId);
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
    await supabase.schema('core').from('attraction_trigger_points').update({
      is_active: false
    }).eq('attraction_id', poiId);
    // Prepare trigger points data for insertion
    const triggerPointsData = triggerPoints.map((tp, index)=>({
        attraction_id: poiId,
        location: `POINT(${tp.lng} ${tp.lat})`,
        radius_meters: Math.round(tp.radius_meters) || 30,
        expected_bearing: tp.expected_bearing,
        bearing_threshold: 30,
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
        access: 'both',
        is_active: true
      }));
    const { data, error } = await supabase.schema('core').from('attraction_trigger_points').insert(triggerPointsData).select();
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
/**
 * Generate intelligent trigger points using street analysis in buffer zone
 * Analyzes streets between boundary and buffer to position trigger points strategically
 */ async function generateIntelligentTriggerPoints(boundary, poiLat, poiLng, poiName, megaData, bufferCoords) {
  console.log(`🎯 Starting intelligent trigger points generation`);
  console.log(`📍 POI: ${poiLat}, ${poiLng} | Boundary: ${boundary?.coordinates?.length || 0} points | Buffer: ${bufferCoords?.length || 0} points`);
  if (!megaData || !megaData.streets || megaData.streets.length === 0) {
    console.log(`⚠️ No street data available, using fallback method`);
    return await generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName);
  }
  const triggerPoints = [];
  const streets = megaData.streets;
  console.log(`🛣️ Analyzing ${streets.length} streets in buffer zone`);
  // Filter streets that are in the buffer zone (between boundary and buffer)
  const bufferZoneStreets = filterStreetsInBufferZone(streets, boundary, bufferCoords, poiLat, poiLng);
  console.log(`🎯 Found ${bufferZoneStreets.length} streets in buffer zone`);
  // Sort streets by strategic importance
  const strategicStreets = prioritizeStreetsForTriggers(bufferZoneStreets, poiLat, poiLng);
  // PRIORITY 1: Generate trigger points on IMMEDIATE streets (closest to POI)
  const immediateStreets = strategicStreets.filter((street)=>street.distance_to_poi <= 80);
  console.log(`🎯 Found ${immediateStreets.length} immediate streets (≤80m from POI)`);
  for(let i = 0; i < Math.min(immediateStreets.length, 4); i++){
    const street = immediateStreets[i];
    const streetTriggerPoints = await generateTriggerPointsOnStreet(street, poiLat, poiLng, boundary?.coordinates, megaData, true // isImmediate = true for higher priority
    );
    triggerPoints.push(...streetTriggerPoints);
    console.log(`🎯 IMMEDIATE Street ${i + 1}: ${street.name} (${street.distance_to_poi.toFixed(1)}m) - Generated ${streetTriggerPoints.length} trigger points`);
  }
  // PRIORITY 2: Generate trigger points on other strategic streets
  const otherStreets = strategicStreets.filter((street)=>street.distance_to_poi > 80);
  for(let i = 0; i < Math.min(otherStreets.length, 6); i++){
    const street = otherStreets[i];
    const streetTriggerPoints = await generateTriggerPointsOnStreet(street, poiLat, poiLng, boundary?.coordinates, megaData, false // isImmediate = false for normal priority
    );
    triggerPoints.push(...streetTriggerPoints);
    console.log(`✅ Street ${i + 1}: ${street.name} (${street.distance_to_poi.toFixed(1)}m) - Generated ${streetTriggerPoints.length} trigger points`);
  }
  // Remove duplicates and sort by confidence
  const uniqueTriggerPoints = removeDuplicateTriggerPoints(triggerPoints);
  const sortedTriggerPoints = uniqueTriggerPoints.sort((a, b)=>b.confidence - a.confidence);
  console.log(`🎯 Generated ${sortedTriggerPoints.length} intelligent trigger points`);
  // Debug: Log each trigger point
  sortedTriggerPoints.forEach((tp, index)=>{
    console.log(`  TP ${index + 1}: ${tp.street_name} - ${tp.distance_from_poi.toFixed(1)}m - ${(tp.confidence * 100).toFixed(0)}%`);
  });
  const finalTriggerPoints = sortedTriggerPoints.slice(0, 15); // Limit to 15 best points
  console.log(`✅ Returning ${finalTriggerPoints.length} trigger points to main function`);
  return finalTriggerPoints;
}
/**
 * Filter streets that are in the buffer zone (between boundary and buffer)
 */ function filterStreetsInBufferZone(streets, boundary, bufferCoords, poiLat, poiLng) {
  const bufferZoneStreets = [];
  for (const street of streets){
    // Check if street has points in the buffer zone
    const streetInBufferZone = street.coordinates.some((coord)=>{
      const distance = calculateDistance(poiLat, poiLng, coord[1], coord[0]); // coord is [lng, lat]
      // Street is in buffer zone if it's between boundary and buffer (30-200m from POI)
      return distance >= 30 && distance <= 200;
    });
    if (streetInBufferZone) {
      bufferZoneStreets.push(street);
    }
  }
  return bufferZoneStreets;
}
/**
 * Prioritize streets for trigger point placement
 */ function prioritizeStreetsForTriggers(streets, poiLat, poiLng) {
  return streets.map((street)=>{
    // Calculate strategic score
    let score = 0;
    // Factor 1: Highway type importance
    const typeScores = {
      'primary': 1.0,
      'secondary': 0.9,
      'tertiary': 0.8,
      'residential': 0.7,
      'living_street': 0.6,
      'pedestrian': 0.8,
      'footway': 0.5,
      'service': 0.4
    };
    score += typeScores[street.highway_type] || 0.3;
    // Factor 2: Distance from POI (prefer 50-150m range)
    const distance = street.distance_to_poi;
    if (distance >= 50 && distance <= 150) {
      score += 1.0;
    } else if (distance >= 30 && distance <= 200) {
      score += 0.8;
    } else {
      score += 0.5;
    }
    // Factor 3: Named streets are more important
    if (street.name && street.name !== 'Unnamed') {
      score += 0.2;
    }
    // Factor 4: Existing confidence
    score += street.confidence * 0.5;
    return {
      ...street,
      strategicScore: score
    };
  }).sort((a, b)=>b.strategicScore - a.strategicScore);
}
/**
 * Generate trigger points on a specific street
 */ async function generateTriggerPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, megaData, isImmediate = false) {
  const triggerPoints = [];
  // Find optimal points on the street (more points for immediate streets)
  const maxPoints = isImmediate ? 5 : 3; // More points for immediate streets
  const optimalPoints = findOptimalPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, maxPoints);
  for (const point of optimalPoints){
    // CRITICAL: Check if point is OUTSIDE the POI boundary (same rule as existing code)
    const isOutsideBoundary = boundaryCoordinates ? !isPointInPolygon(point, boundaryCoordinates) : true;
    const minDistanceFromBoundary = boundaryCoordinates ? calculateDistanceToPolygon(point, boundaryCoordinates) : 0;
    // Ensure point is outside boundary with minimum distance (RELAXED for more TPs)
    if (!isOutsideBoundary || minDistanceFromBoundary < 5) {
      console.log(`❌ Point rejected - inside boundary or too close (${minDistanceFromBoundary.toFixed(1)}m from boundary)`);
      continue;
    }
    // SMART building obstruction check - stricter for secondary points
    const hasObstruction = await checkForBuildingsInPath(poiLat, poiLng, point.lat, point.lng, megaData, isImmediate // Pass priority info for different thresholds
    );
    if (!hasObstruction) {
      const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng);
      const bearing = calculateBearing(point.lat, point.lng, poiLat, poiLng);
      console.log(`✅ Point accepted - ${distance.toFixed(1)}m from POI, ${minDistanceFromBoundary.toFixed(1)}m from boundary`);
      // Boost confidence for immediate streets (better visibility)
      const finalConfidence = isImmediate ? Math.min(1.0, point.score * 1.3) : point.score;
      triggerPoints.push({
        lat: point.lat,
        lng: point.lng,
        type: isImmediate ? 'primary' : distance <= 80 ? 'primary' : 'secondary',
        reasoning: isImmediate ? `Ponto prioritário na ${street.name} com excelente visibilidade do POI` : `Ponto estratégico na ${street.name} com visibilidade do POI`,
        confidence: finalConfidence,
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: isImmediate ? 25 : 20,
        street_name: street.name,
        highway_type: street.highway_type,
        auto_status: 'review'
      });
    } else {
      console.log(`❌ Point rejected - obstructed by buildings`);
    }
  }
  return triggerPoints;
}
/**
 * Find optimal points on a street for trigger point placement
 */ function findOptimalPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, maxPoints = 3) {
  const optimalPoints = [];
  const coordinates = street.coordinates;
  // Sample points along the street
  const step = Math.max(1, Math.floor(coordinates.length / 10)); // Sample ~10 points
  for(let i = 0; i < coordinates.length; i += step){
    const coord = coordinates[i];
    const point = {
      lat: coord[1],
      lng: coord[0]
    }; // Convert [lng, lat] to {lat, lng}
    const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng);
    // Only consider points in the buffer zone AND outside the boundary (EXPANDED RANGE)
    if (distance >= 30 && distance <= 200) {
      // CRITICAL: Verify point is outside POI boundary
      const isOutsideBoundary = boundaryCoordinates ? !isPointInPolygon(point, boundaryCoordinates) : true;
      const distanceFromBoundary = boundaryCoordinates ? calculateDistanceToPolygon(point, boundaryCoordinates) : distance;
      // Only include points that are outside boundary with minimum distance (RELAXED)
      if (isOutsideBoundary && distanceFromBoundary >= 5) {
        let score = 0;
        // Distance score (prefer 50-120m range, more flexible)
        if (distance >= 50 && distance <= 120) {
          score += 1.0;
        } else if (distance >= 30 && distance <= 150) {
          score += 0.8;
        } else {
          score += 0.6;
        }
        // Street type score
        const typeScores = {
          'primary': 1.0,
          'secondary': 0.9,
          'tertiary': 0.8,
          'residential': 0.7,
          'living_street': 0.6,
          'pedestrian': 0.8,
          'footway': 0.5
        };
        score += typeScores[street.highway_type] || 0.3;
        // Bonus for being further from boundary (safer placement)
        if (distanceFromBoundary >= 20) {
          score += 0.2;
        } else if (distanceFromBoundary >= 10) {
          score += 0.1;
        }
        optimalPoints.push({
          ...point,
          score: score,
          distance: distance,
          distanceFromBoundary: distanceFromBoundary
        });
      }
    }
  }
  // Sort by score and return top points
  return optimalPoints.sort((a, b)=>b.score - a.score).slice(0, maxPoints); // Return top N points per street
}
/**
 * Remove duplicate trigger points that are too close to each other
 */ function removeDuplicateTriggerPoints(triggerPoints) {
  const uniquePoints = [];
  const minDistance = 30; // Minimum 30m between trigger points
  for (const point of triggerPoints){
    const isDuplicate = uniquePoints.some((existing)=>{
      const distance = calculateDistance(point.lat, point.lng, existing.lat, existing.lng);
      return distance < minDistance;
    });
    if (!isDuplicate) {
      uniquePoints.push(point);
    }
  }
  return uniquePoints;
}
// Calculate dynamic buffer size based on POI height and urban density
function calculateDynamicBufferSize(poiHeight1, urbanDensity, regionalHeights) {
  console.log(`🏗️ Calculating dynamic buffer size for POI height: ${poiHeight1?.height || 0}m (${poiHeight1?.category || 'unknown'})`);
  // Base buffer sizes for urban contexts (ground-level POIs like Copacabana, Ibirapuera)
  const baseBufferSizes = {
    'very_dense': 100,
    'dense': 120,
    'medium': 150,
    'low': 180,
    'rural': 200 // Rural areas
  };
  const baseBuffer = baseBufferSizes[urbanDensity] || 150;
  // If no height data, use base buffer (for POIs like Copacabana, Ibirapuera)
  if (!poiHeight1 || !poiHeight1.height || poiHeight1.height <= 0) {
    console.log(`📍 Ground-level POI - using base buffer: ${baseBuffer}m`);
    return baseBuffer;
  }
  // Calculate height advantage relative to nearby buildings
  let heightMultiplier = 1.0;
  const poiHeightValue = poiHeight1.height;
  // Compare with regional building heights
  const averageNearbyHeight = regionalHeights?.averageHeight || 15; // Default urban building height
  const heightAdvantage = poiHeightValue - averageNearbyHeight;
  console.log(`📊 POI: ${poiHeightValue}m vs Nearby buildings: ${averageNearbyHeight}m (advantage: ${heightAdvantage.toFixed(1)}m)`);
  if (heightAdvantage <= 0) {
    // POI is same height or lower than surroundings - use base buffer
    heightMultiplier = 1.0;
    console.log(`🏠 POI at/below surrounding height - base buffer (${heightMultiplier}x)`);
  } else if (heightAdvantage <= 20) {
    // Slightly higher than surroundings
    heightMultiplier = urbanDensity === 'very_dense' ? 1.2 : 1.4;
    console.log(`🏢 POI slightly higher (+${heightAdvantage.toFixed(1)}m) - modest increase (${heightMultiplier}x)`);
  } else if (heightAdvantage <= 50) {
    // Significantly higher
    heightMultiplier = urbanDensity === 'very_dense' ? 1.5 : 2.0;
    console.log(`🏗️ POI significantly higher (+${heightAdvantage.toFixed(1)}m) - good visibility (${heightMultiplier}x)`);
  } else if (heightAdvantage <= 100) {
    // Much higher - good urban landmark
    heightMultiplier = urbanDensity === 'very_dense' ? 1.8 : 2.2;
    console.log(`🏙️ POI much higher (+${heightAdvantage.toFixed(1)}m) - urban landmark visibility (${heightMultiplier}x)`);
  } else {
    // Very high - will use separate strategy later (Cristo Redentor, etc.)
    // For now, cap at moderate increase for urban context
    heightMultiplier = urbanDensity === 'very_dense' ? 2.0 : 2.5;
    console.log(`🗼 POI very high (+${heightAdvantage.toFixed(1)}m) - capped for urban strategy (${heightMultiplier}x)`);
    console.log(`💡 Note: High landmarks like Cristo Redentor will use separate strategy with 5km+ range`);
  }
  // Apply confidence factor
  const confidenceFactor = 0.7 + poiHeight1.confidence * 0.3; // 0.7 to 1.0
  const finalBuffer = Math.round(baseBuffer * heightMultiplier * confidenceFactor);
  // Cap to reasonable limits for urban POIs (high landmarks will use separate strategy)
  const cappedBuffer = Math.min(Math.max(finalBuffer, 80), 400);
  console.log(`🎯 Dynamic buffer: ${baseBuffer}m × ${heightMultiplier} × ${confidenceFactor.toFixed(2)} = ${cappedBuffer}m`);
  return cappedBuffer;
}
// Create buffer around polygon by expanding it outward - IMPROVED VERSION
function createBufferAroundPolygon(coordinates, bufferMeters, megaUnifiedData = null) {
  if (!coordinates || coordinates.length < 3) {
    return null;
  }
  console.log(`📍 Creating INDIVIDUAL buffer points of ${bufferMeters}m for ${coordinates.length} boundary points`);
  // Calculate polygon center once
  let centerLat = 0, centerLng = 0;
  for (const coord of coordinates){
    centerLat += coord.lat;
    centerLng += coord.lng;
  }
  centerLat /= coordinates.length;
  centerLng /= coordinates.length;
  console.log(`📊 Polygon center: ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)}`);
  const bufferPoints = [];
  // INTELLIGENT METHOD: For each boundary point, check for buildings before creating buffer point
  let buildingBlocked = 0;
  let bufferCreated = 0;
  for(let i = 0; i < coordinates.length; i++){
    const point = coordinates[i];
    // Calculate direction from center to boundary point (this is "outward")
    const outwardBearing = calculateBearing(centerLat, centerLng, point.lat, point.lng);
    // Calculate potential buffer point location
    const potentialBufferPoint = calculateDestinationPoint(point.lat, point.lng, outwardBearing, bufferMeters / 1000 // Convert to km
    );
    // CHECK FOR BUILDINGS: Use MEGA-UNIFIED data to check for buildings in the expansion path
    const hasBuildingInPath = checkForBuildingsInPath(point.lat, point.lng, potentialBufferPoint.lat, potentialBufferPoint.lng, megaUnifiedData);
    if (hasBuildingInPath) {
      // Skip this buffer point - there's a building blocking
      buildingBlocked++;
      if (i < 5 || outwardBearing >= 90 && outwardBearing <= 180) {
        const quadrant = outwardBearing >= 0 && outwardBearing < 90 ? 'NE' : outwardBearing >= 90 && outwardBearing < 180 ? 'SE' : outwardBearing >= 180 && outwardBearing < 270 ? 'SW' : 'NW';
        console.log(`🏢 Point ${i} (${quadrant}, ${outwardBearing.toFixed(1)}°): BLOCKED by building - no buffer point created`);
      }
    } else {
      // Safe to create buffer point - no buildings detected
      bufferPoints.push({
        lat: potentialBufferPoint.lat,
        lng: potentialBufferPoint.lng
      });
      bufferCreated++;
      // Debug log for first few points and southeast quadrant
      if (i < 5 || outwardBearing >= 90 && outwardBearing <= 180) {
        const distance = calculateDistance(point.lat, point.lng, potentialBufferPoint.lat, potentialBufferPoint.lng) * 1000;
        const quadrant = outwardBearing >= 0 && outwardBearing < 90 ? 'NE' : outwardBearing >= 90 && outwardBearing < 180 ? 'SE' : outwardBearing >= 180 && outwardBearing < 270 ? 'SW' : 'NW';
        console.log(`✅ Point ${i} (${quadrant}, ${outwardBearing.toFixed(1)}°): ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)} → ${potentialBufferPoint.lat.toFixed(6)}, ${potentialBufferPoint.lng.toFixed(6)} (${distance.toFixed(1)}m)`);
      }
    }
  }
  console.log(`✅ Created ${bufferCreated} intelligent buffer points (exact ${bufferMeters}m from boundary)`);
  console.log(`🏢 Blocked by buildings: ${buildingBlocked} points`);
  console.log(`📊 Total boundary points: ${coordinates.length} → Buffer points: ${bufferCreated} (${(bufferCreated / coordinates.length * 100).toFixed(1)}% success rate)`);
  return bufferPoints;
}
// Helper function to check for buildings in the expansion path using MEGA-UNIFIED data
function checkForBuildingsInPath(startLat, startLng, endLat, endLng, megaUnifiedData, isImmediate = false) {
  try {
    // If no MEGA-UNIFIED data available, be conservative (assume no buildings)
    if (!megaUnifiedData || !megaUnifiedData.rawBuildings) {
      console.log(`⚠️ No MEGA-UNIFIED rawBuildings data - allowing buffer creation`);
      return false;
    }
    // Check if any buildings from MEGA-UNIFIED data intersect with the expansion path
    const pathBounds = {
      minLat: Math.min(startLat, endLat) - 0.0001,
      maxLat: Math.max(startLat, endLat) + 0.0001,
      minLng: Math.min(startLng, endLng) - 0.0001,
      maxLng: Math.max(startLng, endLng) + 0.0001
    };
    console.log(`🔍 DEBUG: Checking path from (${startLat.toFixed(6)}, ${startLng.toFixed(6)}) to (${endLat.toFixed(6)}, ${endLng.toFixed(6)})`);
    console.log(`🔍 DEBUG: Path bounds: lat[${pathBounds.minLat.toFixed(6)} to ${pathBounds.maxLat.toFixed(6)}], lng[${pathBounds.minLng.toFixed(6)} to ${pathBounds.maxLng.toFixed(6)}]`);
    // Count buildings that intersect with the expansion path
    let buildingsInPath = 0;
    let buildingsChecked = 0;
    for (const building of megaUnifiedData.rawBuildings){
      buildingsChecked++;
      // Extract coordinates from OSM building element
      let buildingLat, buildingLng;
      if (building.lat && building.lon) {
        // Node building
        buildingLat = building.lat;
        buildingLng = building.lon;
      } else if (building.center) {
        // Way/relation with center
        buildingLat = building.center.lat;
        buildingLng = building.center.lon;
      } else if (building.geometry && building.geometry.length > 0) {
        // Way building - use first geometry point (OSM format)
        const firstGeometry = building.geometry[0];
        if (firstGeometry.lat && firstGeometry.lon) {
          buildingLat = firstGeometry.lat;
          buildingLng = firstGeometry.lon;
        }
      } else if (building.nodes && building.nodes.length > 0) {
        // Fallback: Way building - use first node as approximation
        const firstNode = building.nodes[0];
        if (firstNode.lat && firstNode.lon) {
          buildingLat = firstNode.lat;
          buildingLng = firstNode.lon;
        }
      }
      if (buildingLat && buildingLng) {
        if (buildingLat >= pathBounds.minLat && buildingLat <= pathBounds.maxLat && buildingLng >= pathBounds.minLng && buildingLng <= pathBounds.maxLng) {
          buildingsInPath++;
          if (buildingsInPath <= 3) {
            console.log(`🏢 Building ${buildingsInPath} in path: (${buildingLat.toFixed(6)}, ${buildingLng.toFixed(6)})`);
          }
        }
      }
      // Log progress for first few buildings
      if (buildingsChecked <= 5) {
        console.log(`🔍 Building ${buildingsChecked}: lat=${building.lat ? 'YES' : 'NO'}, center=${building.center ? 'YES' : 'NO'}, geometry=${building.geometry?.length || 0}, nodes=${building.nodes?.length || 0}`);
      }
    }
    // SMART BUILDING DETECTION: Different thresholds for immediate vs secondary points
    let buildingThreshold;
    let blockingLogic;
    // Get POI height for smart thresholding
    const poiHeightValue = megaUnifiedData?.poiHeight?.height || 0;
    const isHighLandmark = poiHeightValue > 50; // High landmarks like Sagrada Família
    if (isImmediate) {
      // IMMEDIATE/PRIMARY points: More tolerant (allow some buildings)
      buildingThreshold = isHighLandmark ? 5 : 2; // Higher threshold for tall landmarks
      blockingLogic = buildingsInPath > buildingThreshold;
      console.log(`🎯 PRIMARY point check: ${buildingsInPath} buildings (threshold: ${buildingThreshold}${isHighLandmark ? ' - HIGH LANDMARK' : ''}) - ${blockingLogic ? 'BLOCKED' : 'ALLOWED'}`);
    } else {
      // SECONDARY points: Adaptive threshold based on POI height
      if (isHighLandmark) {
        buildingThreshold = 3; // Allow some buildings for high landmarks
        console.log(`🗼 HIGH LANDMARK (${poiHeightValue}m) - relaxed threshold for secondary points`);
      } else {
        buildingThreshold = 0; // Strict for regular POIs
      }
      blockingLogic = buildingsInPath > buildingThreshold;
      console.log(`⚠️ SECONDARY point check: ${buildingsInPath} buildings (threshold: ${buildingThreshold}${isHighLandmark ? ' - HIGH LANDMARK' : ''}) - ${blockingLogic ? 'BLOCKED' : 'ALLOWED'}`);
    }
    console.log(`🔍 DEBUG: Checked ${buildingsChecked} buildings, found ${buildingsInPath} in path`);
    if (blockingLogic) {
      console.log(`🏢 Found ${buildingsInPath} buildings in expansion path - ${isImmediate ? 'PRIMARY' : 'SECONDARY'} point blocked`);
    }
    return blockingLogic;
  } catch (error) {
    console.log(`⚠️ Error checking MEGA-UNIFIED buildings: ${error.message}`);
    return false; // If error, assume no buildings (safer to create buffer)
  }
}
// Helper function to calculate destination point given bearing and distance
function calculateDestinationPoint(lat, lng, bearing, distanceKm) {
  const R = 6371; // Earth radius in km
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const d = distanceKm / R;
  const brng = bearing * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return {
    lat: lat2 * 180 / Math.PI,
    lng: lng2 * 180 / Math.PI
  };
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
    console.log(`🌍 Starting POI analysis for: ${name}`);
    // ========================================
    // STEP 1: GET MEGA-UNIFIED DATA FIRST (CRITICAL FOR CORRECT STRATEGY DECISION)
    // ========================================
    console.log(`🚀 STEP 1: Loading MEGA-UNIFIED data for strategy decision...`);
    let megaData = null;
    let poiHeightResult = {
      height: 10,
      confidence: 0.5,
      source: 'fallback_default'
    };
    let urbanDensity = 'rural';
    let elevationData = {
      elevation: 0,
      elevationDiff: 0,
      confidence: 0.7,
      source: 'fallback_elevation'
    };
    // Try mega-unified system first - CRITICAL for correct strategy decision
    try {
      // Use minimal landmarkInfo for initial query
      const initialLandmarkInfo = {
        isHighVisibility: false,
        maxRange: 1000,
        elevationDiff: 0
      };
      megaData = await getMegaUnifiedPOIData(lat, lng, name, initialLandmarkInfo);
      if (megaData) {
        console.log('✅ MEGA-UNIFIED data loaded successfully');
        poiHeightResult = megaData.poiHeight || poiHeightResult;
        urbanDensity = megaData.urbanDensity || urbanDensity;
        elevationData = megaData.elevation || elevationData;
        console.log(`🔄 Real data loaded: height=${JSON.stringify(poiHeightResult)}, density=${urbanDensity}, elevation=${elevationData.elevationDiff || 0}m`);
      }
    } catch (error) {
      console.warn(`⚠️ MEGA-UNIFIED failed, using fallback data:`, error.message);
    }
    // ========================================
    // STEP 2: CALCULATE POI CHARACTERISTICS WITH REAL DATA
    // ========================================
    console.log(`📊 STEP 2: Calculating POI characteristics with real data...`);
    // Extract numeric height from result (handle both number and object responses)
    const poiHeight1 = typeof poiHeightResult === 'number' ? poiHeightResult : poiHeightResult?.height || 0;
    console.log(`🔍 DEBUG: poiHeightResult=${JSON.stringify(poiHeightResult)}, extracted height=${poiHeight1}`);
    // Calculate intelligent range based on REAL data
    let baseRange;
    switch(urbanDensity){
      case 'very_dense':
        baseRange = 400;
        break;
      case 'dense':
        baseRange = 500;
        break;
      case 'urban':
        baseRange = 600;
        break;
      case 'suburban':
        baseRange = 800;
        break;
      case 'rural':
        baseRange = 1200;
        break;
      default:
        baseRange = 600;
        break;
    }
    const heightBonus = Math.min(poiHeight1 * 2, 400); // 2m range per 1m height, max 400m bonus
    // Special handling for iconic landmarks on elevated terrain
    let elevationBonus = 0;
    const isIconicLandmark = name && (name.toLowerCase().includes('cristo') || name.toLowerCase().includes('redentor') || name.toLowerCase().includes('corcovado') || name.toLowerCase().includes('pão de açúcar') || name.toLowerCase().includes('sugarloaf') || name.toLowerCase().includes('sagrada família') || name.toLowerCase().includes('sagrada familia'));
    if (isIconicLandmark && urbanDensity !== 'very_dense') {
      elevationBonus = 3400; // Iconic landmarks can be seen from very far (up to 4km total)
      console.log(`🏔️ Iconic landmark detected: ${name} - adding elevation bonus`);
    }
    // PRIORITY: Use landmark-calculated maxRange if available from elevation analysis
    let maxRange;
    if (elevationData.maxRange) {
      maxRange = elevationData.maxRange;
      console.log(`🏔️ Using landmark-calculated maxRange: ${maxRange}m`);
    } else {
      maxRange = Math.min(baseRange + heightBonus + elevationBonus, 5000); // Cap at 5km
      console.log(`🔍 DEBUG: urbanDensity=${urbanDensity}, baseRange=${baseRange}, heightBonus=${heightBonus}, elevationBonus=${elevationBonus}, maxRange=${maxRange}`);
    }
    // Determine if POI has high visibility based on ELEVATION + HEIGHT RELATIVE TO SURROUNDINGS
    let isHighVisibility = false;
    if (isIconicLandmark) {
      // Iconic landmarks are always high visibility
      isHighVisibility = true;
      console.log(`🗿 Iconic landmark detected - high visibility confirmed`);
    } else {
      // Check elevation advantage first (terrain height difference)
      const hasElevationAdvantage = (elevationData.elevationDiff || 0) > 100; // 100m+ higher than surroundings
      if (hasElevationAdvantage) {
        isHighVisibility = true;
        console.log(`🏔️ Elevation advantage: ${(elevationData.elevationDiff || 0).toFixed(1)}m above surroundings → High visibility`);
      } else {
        // For regular buildings, height visibility depends on urban context
        const heightThresholds = {
          'very_dense': 200,
          'dense': 120,
          'medium': 60,
          'low': 30,
          'rural': 15 // Rural - even small buildings are visible
        };
        const threshold = heightThresholds[urbanDensity] || 40;
        isHighVisibility = poiHeight1 > threshold;
        console.log(`🏙️ No elevation advantage (${(elevationData.elevationDiff || 0).toFixed(1)}m)`);
        console.log(`🏙️ Urban context check: ${urbanDensity} area needs >${threshold}m building height for high visibility`);
        console.log(`🏗️ POI height: ${poiHeight1}m → High visibility: ${isHighVisibility ? 'YES' : 'NO'}`);
      }
    }
    const landmarkInfo = {
      isHighVisibility,
      maxRange,
      elevationDiff: elevationData.elevationDiff || 0,
      buildingHeight: poiHeight1,
      urbanDensity,
      landmarkType: isHighVisibility ? 'landmark' : 'urban_building',
      dataSource: 'real_osm_elevation_and_height'
    };
    // ========================================
    // STEP 3: STRATEGY DECISION BASED ON REAL DATA
    // ========================================
    console.log(`🎯 STEP 3: Strategy decision based on elevation and height...`);
    console.log(`📊 POI Analysis Results:`);
    console.log(`   Height: ${poiHeight1}m | Urban Density: ${urbanDensity}`);
    console.log(`   High Visibility: ${isHighVisibility} | Max Range: ${maxRange}m`);
    console.log(`   Elevation Diff: ${landmarkInfo.elevationDiff}m | Landmark Type: ${landmarkInfo.landmarkType}`);
    console.log(`   Data Source: Real OSM + Elevation data`);
    // CRITICAL: Strategy decision
    const useCircularStrategy = landmarkInfo.isHighVisibility && landmarkInfo.landmarkType === 'landmark';
    console.log(`🏔️ Strategy Decision: ${useCircularStrategy ? 'CIRCULAR (High Landmark)' : 'BUFFER (Standard POI)'}`);
    if (useCircularStrategy) {
      console.log(`   📏 Circular range: up to ${landmarkInfo.maxRange}m`);
    } else {
      console.log(`   📐 Buffer strategy with dynamic sizing`);
    }
    // ========================================
    // STEP 4: GET BOUNDARY DATA (using MEGA-UNIFIED if available)
    // ========================================
    console.log(`🔍 STEP 4: Getting boundary data...`);
    let boundary = null;
    let boundarySource = 'estimated';
    // Try to use boundary from MEGA-UNIFIED data first
    if (megaData && megaData.boundary) {
      console.log('✅ Using boundary from MEGA-UNIFIED data');
      boundary = megaData.boundary;
      boundarySource = 'mega_unified';
    } else {
      // Fallback to legacy boundary search
      console.log('⚠️ No boundary in MEGA-UNIFIED, trying legacy search...');
      const nameSearchResult = await searchOSMByName(lat, lng, name, landmarkInfo);
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
              console.log('⚠️ All OSM strategies failed, using MEGA-UNIFIED estimated boundary...');
              // MEGA-UNIFIED: Final Fallback boundary
              const radius = 300;
              const boundaryPoints = [];
              const numPoints = 16;
              for(let i = 0; i < numPoints; i++){
                const angle = i * 2 * Math.PI / numPoints;
                const latOffset = radius / 111320 * Math.cos(angle);
                const lngOffset = radius / (111320 * Math.cos(lat * Math.PI / 180)) * Math.sin(angle);
                boundaryPoints.push([
                  lng + lngOffset,
                  lat + latOffset
                ]);
              }
              boundaryPoints.push(boundaryPoints[0]);
              boundary = {
                coordinates: [
                  boundaryPoints
                ],
                area_m2: Math.PI * radius * radius,
                confidence: 0.4,
                source: 'mega_unified_final_estimated'
              };
              boundarySource = 'mega_unified_estimated';
              console.log(`📐 Using MEGA-UNIFIED estimated boundary: ${boundary.area_m2.toFixed(0)}m² area, confidence: ${boundary.confidence}`);
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
    } // Close the boundary search else block
    // ========================================
    // STEP 5: GENERATE TRIGGER POINTS WITH CORRECT STRATEGY
    // ========================================
    console.log(`🎯 STEP 5: Generating trigger points with ${useCircularStrategy ? 'CIRCULAR' : 'BUFFER'} strategy...`);
    let bufferCoords = null;
    // Only create buffer for STANDARD POIs (not high landmarks)
    if (!useCircularStrategy && boundary?.coordinates && boundary.coordinates.length > 3) {
      console.log(`📐 BUFFER STRATEGY: Creating dynamic buffer for standard POI`);
      // Calculate dynamic buffer size based on POI height and urban context
      const dynamicBufferSize = calculateDynamicBufferSize(megaData?.poiHeight, megaData?.urbanDensity || 'medium', megaData?.regionalHeights);
      console.log(`🔧 Creating ${dynamicBufferSize}m DYNAMIC buffer coordinates for trigger points analysis`);
      bufferCoords = createBufferAroundPolygon(boundary.coordinates, dynamicBufferSize, megaData);
      console.log(`🔍 Buffer coordinates created: ${bufferCoords ? bufferCoords.length : 'NO'} points`);
      // DEBUG: Check buffer coverage in southeast area (for Sagrada Família analysis)
      if (bufferCoords && bufferCoords.length > 0) {
        const southeastPoints = bufferCoords.filter((point)=>point.lat < lat && point.lng > lng // Southeast quadrant
        );
        console.log(`🧭 Southeast buffer points: ${southeastPoints.length} (should cover plaza area)`);
        if (southeastPoints.length > 0) {
          console.log(`📍 Southeast sample: lat=${southeastPoints[0].lat.toFixed(6)}, lng=${southeastPoints[0].lng.toFixed(6)}`);
        }
      }
    } else if (useCircularStrategy) {
      console.log(`🏔️ CIRCULAR STRATEGY: Skipping buffer creation for high landmark`);
      console.log(`   📏 Will use circular range: ${landmarkInfo.maxRange}m`);
    } else {
      console.log(`⚠️ No valid boundary for buffer creation`);
    }
    let triggerPoints = [];
    // Only call generateTriggerPointsFromMegaData if megaData is valid
    if (megaData) {
      triggerPoints = await generateTriggerPointsFromMegaData(megaData, boundary, lat, lng, name);
    } else {
      console.log(`⚠️ FALLBACK: megaData is null, using legacy trigger point generation`);
      // Use legacy fallback logic here if needed
      triggerPoints = [];
    }
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
    // Step 2.5: Trigger points already optimized by generateTriggersFromMegaStreets clustering system
    const clusteredTriggerPoints = triggerPoints; // No additional clustering needed - already handled in generation
    // Step 3: Calculate comprehensive POI confidence score
    const poiConfidenceScore = calculatePOIConfidenceScore(boundary, clusteredTriggerPoints, boundarySource, landmarkInfo);
    console.log(`📊 POI Confidence Score: ${(poiConfidenceScore * 100).toFixed(1)}%`);
    // Step 4: Get additional data and save to database (conditional save)
    try {
      // Get additional data for metadata from MEGA-UNIFIED system
      const poiHeight1 = megaData?.poiHeight?.height || 10; // Use mega-unified POI height
      // Use MEGA-UNIFIED urban density if available
      const urbanDensity = megaData?.urbanDensity || 'rural';
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
          poiHeight: poiHeight1,
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
        coordinates: {
          lat,
          lng
        },
        landmark_detection: {
          is_high_visibility: landmarkInfo.isHighVisibility,
          max_range: landmarkInfo.maxRange,
          elevation_diff: landmarkInfo.elevationDiff
        }
      },
      boundary_analysis: {
        source: boundarySource,
        method_used: boundarySource === 'osm_nominatim' ? 'Name Search' : boundarySource === 'osm_reverse_geocoding' ? 'Coordinate Search' : boundarySource === 'osm_nearby' ? 'Nearby Features' : boundarySource === 'unified_overpass' ? 'Unified Overpass' : 'Estimated Fallback',
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
          primary: triggerPoints.filter((tp)=>tp.type === 'primary').length,
          secondary: triggerPoints.filter((tp)=>tp.type === 'secondary').length,
          fallback: triggerPoints.filter((tp)=>tp.type === 'fallback').length
        },
        distance_analysis: {
          closest_point: triggerPoints.length > 0 ? Math.min(...triggerPoints.map((tp)=>tp.distance_from_poi)) : 0,
          furthest_point: triggerPoints.length > 0 ? Math.max(...triggerPoints.map((tp)=>tp.distance_from_poi)) : 0,
          average_distance: triggerPoints.length > 0 ? triggerPoints.reduce((sum, tp)=>sum + tp.distance_from_poi, 0) / triggerPoints.length : 0
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
        coordinates: (()=>{
          // Only create buffer for STANDARD POIs (not high landmarks)
          const useCircularStrategy = landmarkInfo.isHighVisibility && landmarkInfo.landmarkType === 'landmark';
          if (useCircularStrategy) {
            console.log(`🏔️ HIGH LANDMARK: No buffer created - using circular strategy with ${landmarkInfo.maxRange}m range`);
            return null;
          }
          console.log(`🔍 DEBUG: Creating buffer for standard POI...`);
          console.log(`🔍 DEBUG: boundary exists: ${boundary ? 'YES' : 'NO'}`);
          console.log(`🔍 DEBUG: boundary.coordinates.length: ${boundary?.coordinates?.length || 'undefined'}`);
          if (boundary?.coordinates && boundary.coordinates.length > 3) {
            const dynamicBufferSize = calculateDynamicBufferSize(megaData?.poiHeight, megaData?.urbanDensity || 'medium', megaData?.regionalHeights);
            console.log(`🔧 BUFFER STRATEGY: Creating ${dynamicBufferSize}m buffer for standard POI`);
            const bufferCoords = createBufferAroundPolygon(boundary.coordinates, dynamicBufferSize, megaData);
            console.log(`✅ Buffer created with ${bufferCoords?.length || 0} points`);
            return bufferCoords;
          } else {
            console.log(`❌ Buffer NOT created - no valid boundary`);
            return null;
          }
        })(),
        radius: (()=>{
          const useCircularStrategy = landmarkInfo.isHighVisibility && landmarkInfo.landmarkType === 'landmark';
          if (useCircularStrategy) {
            return landmarkInfo.maxRange; // Return circular range for high landmarks
          }
          const dynamicBufferSize = calculateDynamicBufferSize(megaData?.poiHeight, megaData?.urbanDensity || 'medium', megaData?.regionalHeights);
          return dynamicBufferSize;
        })(),
        strategy: (()=>{
          const useCircularStrategy = landmarkInfo.isHighVisibility && landmarkInfo.landmarkType === 'landmark';
          return useCircularStrategy ? 'circular_high_landmark' : 'dynamic_height_based_buffer';
        })(),
        description: (()=>{
          const useCircularStrategy = landmarkInfo.isHighVisibility && landmarkInfo.landmarkType === 'landmark';
          return useCircularStrategy ? `Circular strategy for high landmark with ${landmarkInfo.maxRange}m range` : 'Dynamic buffer zone based on POI height vs nearby buildings for optimal trigger point coverage';
        })()
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
