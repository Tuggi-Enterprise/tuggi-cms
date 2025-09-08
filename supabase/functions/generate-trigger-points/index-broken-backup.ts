import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Import services
import { getMegaUnifiedPOIData } from './lib/services/mega-unified-service.ts'
import { generateTriggerPointsFromMegaData, calculatePOIConfidenceScore } from './lib/services/trigger-point-service.ts'
import { saveTriggerPointsToDatabase, updateAttractionMetadata } from './lib/services/database-service.ts'
import { calculatePolygonArea } from './lib/utils/calculations.ts'

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ========================================
// CONSTANTS AND CONFIGURATION
// ========================================

// ========================================
// SIMPLE HEIGHT AND DENSITY DETECTION (for compatibility)
// ========================================

const heightCache = new Map();

async function detectPOIHeight(lat, lng) {
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
  
  if (heightCache.has(cacheKey)) {
    const cached = heightCache.get(cacheKey);
    console.log(`🎯 Using cached POI height: ${cached.height}m (${cached.category})`);
    return cached;
  }

  // Query database for cached height
  try {
    const { data: cachedHeight, error } = await supabase
      .from('poi_height_cache')
      .select('height, confidence, category')
      .eq('lat', parseFloat(lat.toFixed(4)))
      .eq('lng', parseFloat(lng.toFixed(4)))
      .single();

    if (!error && cachedHeight) {
      const result = {
        height: cachedHeight.height,
        confidence: cachedHeight.confidence,
        category: cachedHeight.category
      };
      heightCache.set(cacheKey, result);
      console.log(`🎯 Using cached POI height: ${result.height}m (${result.category})`);
      return result;
    }
  } catch (error) {
    console.log('⚠️ Height cache query failed, proceeding without cached data');
  }

  // If no cache, return default
  const defaultResult = { height: 20, confidence: 0.3, category: 'estimated' };
  heightCache.set(cacheKey, defaultResult);
  return defaultResult;
}

async function detectUrbanDensity(lat, lng) {
  try {
    const buildingQuery = `[out:json][timeout:15];
    (
      way[building](around:200,${lat},${lng});
      relation[building](around:200,${lat},${lng});
    );
    out center tags;`;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: buildingQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (urban-density-check)',
        'Content-Type': 'text/plain'
      }
    });

    if (!response.ok) {
      console.log(`⚠️ Urban density check failed: ${response.status}`);
      return 'medium';
    }

    const data = await response.json();
    const buildingCount = data.elements ? data.elements.length : 0;
    
    const category = buildingCount > 150 ? 'very_dense' : 
                    buildingCount > 80 ? 'dense' : 
                    buildingCount > 30 ? 'medium' : 
                    buildingCount > 10 ? 'sparse' : 'very_sparse';
    
    console.log(`🏙️ Urban density: ${category} (${buildingCount} buildings in 200m)`);
    return category;
  } catch (error) {
    console.error('❌ Error detecting urban density:', error);
    return 'medium';
  }
}

// ========================================
// MAIN HANDLER
// ========================================

serve(async (req) => {
  const searchRadius = landmarkInfo?.maxRange || 1500;
  const boundaryRadius = Math.min(searchRadius * 1.2, 2000);
  const streetRadius = Math.min(searchRadius, 1500);
  const buildingRadius = Math.min(searchRadius * 0.8, 1200);
  const elevationRadius = Math.min(searchRadius * 0.6, 800);

  const sanitizedName = name.replace(/['"]/g, '').trim();
  
  return `[out:json][timeout:45];
  (
    // BOUNDARIES: Search by name and coordinates
    ${sanitizedName ? `
    way[name~"${sanitizedName}",i](around:${boundaryRadius},${lat},${lng});
    relation[name~"${sanitizedName}",i](around:${boundaryRadius},${lat},${lng});
    ` : ''}
    way[building][name~"${sanitizedName}",i](around:${boundaryRadius},${lat},${lng});
    relation[building][name~"${sanitizedName}",i](around:${boundaryRadius},${lat},${lng});
    
    // STREETS: All types for trigger point generation
    way[highway~"^(primary|secondary|tertiary|residential|pedestrian|footway|path|cycleway|service|unclassified|trunk|motorway)$"](around:${streetRadius},${lat},${lng});
    
    // BUILDINGS: For obstruction analysis
    way[building](around:${buildingRadius},${lat},${lng});
    relation[building](around:${buildingRadius},${lat},${lng});
    
    // ELEVATION: Natural features for height analysis
    way[natural~"^(peak|hill|volcano|ridge)$"](around:${elevationRadius},${lat},${lng});
    node[natural~"^(peak|hill|volcano|ridge)$"](around:${elevationRadius},${lat},${lng});
    node["ele"](around:${elevationRadius},${lat},${lng});
  );
  out geom tags;`;
}

/**
 * Execute mega-unified query with error handling
 */
async function getMegaUnifiedPOIData(lat, lng, name = '', landmarkInfo = null) {
  const startTime = Date.now();
  console.log(`🚀 MEGA-UNIFIED: Starting data collection for ${name || 'coordinates'}`);

  try {
    const query = buildMegaUnifiedQuery(lat, lng, name, landmarkInfo);
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (mega-unified-query)',
        'Content-Type': 'text/plain'
      }
    });

    if (!response.ok) {
      const queryTime = (Date.now() - startTime) / 1000;
      console.warn(`⚠️ MEGA-UNIFIED: HTTP ${response.status} after ${queryTime.toFixed(2)}s`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const queryTime = (Date.now() - startTime) / 1000;
    
    if (!data.elements || data.elements.length === 0) {
      console.warn(`⚠️ MEGA-UNIFIED: No data returned after ${queryTime.toFixed(2)}s`);
      return null;
    }

    console.log(`🚀 MEGA-UNIFIED: Collecting data for ${name || 'coordinates'}`);
    console.log(`✅ MEGA-UNIFIED: Completed in ${queryTime.toFixed(1)}s - ${data.elements.length} elements`);

    // Process the unified results
    const processedData = await processMegaUnifiedResults(data, lat, lng, name, landmarkInfo);
    
    return processedData;

  } catch (error) {
    const queryTime = (Date.now() - startTime) / 1000;
    console.error(`❌ MEGA-UNIFIED: Failed after ${queryTime.toFixed(2)}s:`, error.message);
    throw error;
  }
}

/**
 * Process mega-unified results into structured data
 */
async function processMegaUnifiedResults(data, lat, lng, name, landmarkInfo) {
  console.log(`🔄 MEGA-UNIFIED: Processing ${data.elements.length} elements`);
  
  // Separate elements by type
  const separated = separateElementsByType(data.elements, lat, lng, name);
  
  // Process each type
  const boundaries = await processBoundaryDataMega(separated.boundaries, lat, lng, name);
  const streets = processStreetDataMega(separated.streets, lat, lng, landmarkInfo);
  const buildings = await processBuildingDataMega(separated.buildings, separated.buildingsWithHeight, lat, lng);
  const elevation = processElevationDataMega(separated.elevation, lat, lng);
  const landmark = landmarkInfo || { isHighVisibility: false, maxRange: 800 };

  // Log summary
  const summary = `📊 Data: ${boundaries.length} boundaries, ${buildings.elements.length} buildings, ${streets.length} streets, ${elevation.length} elevation`;
  console.log(summary);

  return {
    boundaries,
    streets,
    buildings,
    elevation,
    landmark,
    metadata: {
      totalElements: data.elements.length,
      processingTime: Date.now()
    }
  };
}

/**
 * Separate OSM elements by type for processing
 */
function separateElementsByType(elements, lat, lng, name) {
  const boundaries = [];
  const streets = [];
  const buildings = [];
  const buildingsWithHeight = [];
  const elevation = [];

  for (const element of elements) {
    const tags = element.tags || {};
    
    // Boundaries: Named features or buildings matching POI name
    if (name && tags.name && tags.name.toLowerCase().includes(name.toLowerCase())) {
      boundaries.push(element);
    }
    // Streets: Highway elements
    else if (tags.highway) {
      streets.push(element);
    }
    // Buildings: Building elements
    else if (tags.building) {
      buildings.push(element);
      if (tags.height || tags.levels || tags['building:levels']) {
        buildingsWithHeight.push(element);
      }
    }
    // Elevation: Natural features with elevation data
    else if (tags.natural && ['peak', 'hill', 'volcano', 'ridge'].includes(tags.natural)) {
      elevation.push(element);
    }
    else if (tags.ele) {
      elevation.push(element);
    }
  }

  return { boundaries, streets, buildings, buildingsWithHeight, elevation };
}

/**
 * Process boundary data from mega-unified results
 */
async function processBoundaryDataMega(boundaryElements, lat, lng, name) {
  const boundaries = [];
  
  for (const element of boundaryElements) {
    if (element.geometry && element.geometry.length >= 3) {
      const coordinates = element.geometry.map(node => ({
        lat: node.lat,
        lng: node.lon
      }));
      
      boundaries.push({
        coordinates,
        tags: element.tags || {},
        source: 'mega_unified',
        confidence: calculateBoundaryConfidence(element, lat, lng, name)
      });
    }
  }
  
  // Sort by confidence
  boundaries.sort((a, b) => b.confidence - a.confidence);
  
  return boundaries;
}

function calculateBoundaryConfidence(element, lat, lng, name) {
  const tags = element.tags || {};
  let confidence = 0.5; // Base confidence
  
  // Name match bonus
  if (name && tags.name && tags.name.toLowerCase().includes(name.toLowerCase())) {
    confidence += 0.4;
  }
  
  // Building bonus
  if (tags.building) {
    confidence += 0.2;
  }
  
  // Distance penalty
  if (element.geometry && element.geometry.length > 0) {
    const center = calculatePolygonCenter(element.geometry.map(n => ({ lat: n.lat, lng: n.lon })));
    const distance = calculateDistance(lat, lng, center.lat, center.lng);
    if (distance > 500) {
      confidence -= (distance - 500) / 2000; // Reduce confidence for distant boundaries
    }
  }
  
  return Math.max(0.1, Math.min(1.0, confidence));
}

/**
 * Process street data from mega-unified results
 */
function processStreetDataMega(streetElements, lat, lng, landmarkInfo) {
  const streets = [];
  
  for (const element of streetElements) {
    if (element.geometry && element.geometry.length >= 2) {
      const coordinates = element.geometry.map(node => ({
        lat: node.lat,
        lng: node.lon
      }));
      
      const closestPoint = findClosestPointOnStreet(coordinates, lat, lng);
      const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng);
      
      streets.push({
        name: element.tags?.name || `${element.tags?.highway || 'Unknown'} road`,
        coordinates,
        tags: element.tags || {},
        distance,
        closestPoint,
        confidence: calculateStreetConfidence(element, distance, landmarkInfo)
      });
    }
  }
  
  // Sort by confidence (distance + road importance)
  streets.sort((a, b) => b.confidence - a.confidence);
  
  return streets;
}

function calculateStreetConfidence(element, distance, landmarkInfo) {
  const tags = element.tags || {};
  let confidence = 0.5;
  
  // Road type importance
  const roadImportance = {
    'primary': 1.0,
    'secondary': 0.9,
    'tertiary': 0.8,
    'residential': 0.7,
    'pedestrian': 0.6,
    'footway': 0.5,
    'path': 0.4,
    'cycleway': 0.4,
    'service': 0.3,
    'unclassified': 0.6
  };
  
  confidence *= (roadImportance[tags.highway] || 0.5);
  
  // Distance penalty
  const maxDistance = landmarkInfo?.maxRange || 800;
  confidence *= Math.max(0.1, 1 - (distance / maxDistance));
  
  // Name bonus
  if (tags.name) {
    confidence += 0.1;
  }
  
  return Math.max(0.1, Math.min(1.0, confidence));
}

/**
 * Process building data from mega-unified results
 */
async function processBuildingDataMega(allBuildings, buildingsWithHeight, lat, lng) {
  // Calculate regional height analysis
  const regionalAnalysis = await calculateRegionalHeightAnalysis(buildingsWithHeight, lat, lng);
  
  return {
    elements: allBuildings, // All buildings for obstruction analysis
    withHeight: buildingsWithHeight, // Buildings with height data
    regionalAnalysis, // Regional height statistics
    count: allBuildings.length
  };
}

async function calculateRegionalHeightAnalysis(buildingsWithHeight, lat, lng) {
  if (buildingsWithHeight.length === 0) {
    return { averageHeight: 15, confidence: 0.2, category: 'estimated' };
  }
  
  let totalHeight = 0;
  let validHeights = 0;
  
  for (const building of buildingsWithHeight) {
    const tags = building.tags || {};
    let height = 0;
    
    if (tags.height) {
      height = parseFloat(tags.height.replace(/[^\d.]/g, ''));
    } else if (tags.levels || tags['building:levels']) {
      const levels = parseInt(tags.levels || tags['building:levels']);
      height = levels * 3.5; // Estimate 3.5m per level
    }
    
    if (height > 0 && height < 300) { // Sanity check
      totalHeight += height;
      validHeights++;
    }
  }
  
  if (validHeights === 0) {
    return { averageHeight: 15, confidence: 0.2, category: 'estimated' };
  }
  
  const averageHeight = totalHeight / validHeights;
  const confidence = Math.min(1.0, validHeights / 10); // More buildings = higher confidence
  
  return {
    averageHeight: Math.round(averageHeight * 10) / 10,
    confidence,
    category: confidence > 0.7 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
    buildingsAnalyzed: validHeights
  };
}

/**
 * Process elevation data from mega-unified results
 */
function processElevationDataMega(elevationElements, lat, lng) {
  const elevationPoints = [];
  
  for (const element of elevationElements) {
    const tags = element.tags || {};
    let elevation = null;
    let elementLat = lat;
    let elementLng = lng;
    
    // Get coordinates
    if (element.lat && element.lon) {
      elementLat = element.lat;
      elementLng = element.lon;
    } else if (element.center) {
      elementLat = element.center.lat;
      elementLng = element.center.lon;
    } else if (element.geometry && element.geometry.length > 0) {
      const center = calculatePolygonCenter(element.geometry.map(n => ({ lat: n.lat, lng: n.lon })));
      elementLat = center.lat;
      elementLng = center.lng;
    }
    
    // Get elevation
    if (tags.ele) {
      elevation = parseFloat(tags.ele.replace(/[^\d.]/g, ''));
    }
    
    if (elevation !== null && elevation > -100 && elevation < 9000) { // Sanity check
      const distance = calculateDistance(lat, lng, elementLat, elementLng);
      elevationPoints.push({
        lat: elementLat,
        lng: elementLng,
        elevation,
        distance,
        type: tags.natural || 'elevation_point',
        name: tags.name || null
      });
    }
  }
  
  // Sort by distance
  elevationPoints.sort((a, b) => a.distance - b.distance);
  
  return elevationPoints;
}

// ========================================
// VISIBILITY AND OBSTRUCTION CHECKS
// ========================================

async function checkVisibilityToPOI(point, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight = null, buildings = null) {
  const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng);
  const poiArea = calculatePolygonArea(boundaryCoordinates);
  const landmark = landmarkInfo || { isHighVisibility: false, maxRange: 800, elevationDiff: 0 };
  
  // Basic distance and boundary checks
  let minDistance = 80;
  let maxDistance = 800;
  let bufferDistance = 20;
  
  if (landmark.isHighVisibility) {
    minDistance = 15;
    maxDistance = landmark.maxRange;
    bufferDistance = 10;
    console.log(`🏔️ High-visibility landmark detected - extended range: ${minDistance}m-${maxDistance}m (elevation diff: ${landmark.elevationDiff || 0}m)`);
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
  
  // Defensive check for valid coordinates
  if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number') {
    console.log(`❌ Invalid point coordinates: ${JSON.stringify(point)}`);
    return false;
  }
  
  // Smart selective obstruction check
  if (poiArea < 100000 && !landmark.isHighVisibility) {
    console.log(`🏢 Small urban POI (${(poiArea/1000).toFixed(1)}k m²) - checking building obstructions`);
    try {
      const hasObstruction = await checkBuildingObstructions(point, poiLat, poiLng, buildings);
      if (hasObstruction) {
        console.log(`🚫 Point filtered out due to building obstruction`);
        return false;
      }
    } catch (error) {
      console.log('⚠️ Obstruction check failed, allowing trigger point (conservative approach)');
    }
  } else if (landmark.isHighVisibility) {
    console.log(`🏔️ High-visibility landmark - skipping building obstruction check for performance`);
  } else {
    console.log(`🏞️ Large POI (${(poiArea/1000).toFixed(1)}k m²) - skipping obstruction check for performance`);
  }
  
  console.log(`✅ Point accepted at ${distance.toFixed(0)}m`);
  return true;
}

/**
 * Check building obstructions using mega-unified building data
 */
async function checkBuildingObstructions(triggerPoint, poiLat, poiLng, buildings = null) {
  try {
    console.log(`🔍 Building obstruction check for point at ${triggerPoint.lat.toFixed(4)}, ${triggerPoint.lng.toFixed(4)}`);
    
    // Get POI height for height-aware obstruction calculations
    const poiHeight = await detectPOIHeight(poiLat, poiLng);
    const poiHeightValue = poiHeight.height;
    console.log(`🏗️ POI height: ${poiHeightValue}m (confidence: ${poiHeight.confidence}) - checking obstacles`);
    
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
    
    // For very close points, assume good visibility
    if (distance <= 50) {
      console.log(`✅ Close point (${distance.toFixed(0)}m) - assuming good visibility`);
      return false;
    }
    
    // For truly high POIs, assume good visibility
    if (poiHeightValue > 150) {
      console.log(`✅ Very high POI (${poiHeightValue}m) - can see over most obstructions`);
      return false;
    }
    
    // Use pre-loaded building data from mega-unified system
    let buildingElements = [];
    
    if (buildings && buildings.length > 0) {
      // Filter buildings in the line of sight area
      const searchRadius = Math.min(distance / 2, 200);
      const midLat = (triggerPoint.lat + poiLat) / 2;
      const midLng = (triggerPoint.lng + poiLng) / 2;
      
      buildingElements = buildings.filter(building => {
        if (!building.geometry || building.geometry.length < 3) return false;
        
        const buildingCenter = calculatePolygonCenter(building.geometry.map(node => ({
          lat: node.lat,
          lng: node.lon
        })));
        const distanceToMid = calculateDistance(midLat, midLng, buildingCenter.lat, buildingCenter.lng);
        return distanceToMid <= searchRadius;
      });
      
      console.log(`🚀 MEGA-UNIFIED: Using pre-loaded building data - found ${buildingElements.length} potential obstructions`);
    } else {
      console.log(`⚠️ No pre-loaded building data available`);
      return false; // Conservative: assume no obstruction if no data
    }
    
    if (buildingElements.length === 0) {
      console.log(`✅ No buildings found in line of sight`);
      return false;
    }
    
    // Check if any building intersects the line of sight
    let obstructionCount = 0;
    
    for (const element of buildingElements) {
      if (element.geometry && element.geometry.length >= 3) {
        const buildingCoords = element.geometry.map(node => ({
          lat: node.lat,
          lng: node.lon
        }));
        
        // Check if building is between trigger point and POI
        const buildingCenter = calculatePolygonCenter(buildingCoords);
        const distanceToTrigger = calculateDistance(triggerPoint.lat, triggerPoint.lng, buildingCenter.lat, buildingCenter.lng);
        const distanceToPOI = calculateDistance(poiLat, poiLng, buildingCenter.lat, buildingCenter.lng);
        const totalDistance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng);
        
        // If building is roughly between trigger point and POI
        if (distanceToTrigger + distanceToPOI <= totalDistance * 1.2) {
          // Check if line of sight passes through building
          if (lineIntersectsPolygon(triggerPoint, {lat: poiLat, lng: poiLng}, buildingCoords)) {
            
            // Height-aware obstruction check
            const obstacleHeight = getBuildingHeight(element.tags || {});
            const canSeeOver = poiHeightValue > obstacleHeight + 15; // POI must be 15m+ higher
            
            if (canSeeOver) {
              console.log(`👁️ POI (${poiHeightValue}m) can see over obstacle (${obstacleHeight}m) - not blocking`);
            } else {
              obstructionCount++;
              const buildingType = element.tags?.building || 'unknown';
              const buildingName = element.tags?.name || `${buildingType} building`;
              console.log(`🚫 Obstruction detected: ${buildingName} (${obstacleHeight}m high, ${distanceToTrigger.toFixed(0)}m from trigger point)`);
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
    console.error('❌ Error checking building obstructions:', error);
    return false; // If error, assume no obstructions for safety
  }
}

function getBuildingHeight(tags) {
  let height = 15; // Default height
  
  if (tags.height) {
    const parsedHeight = parseFloat(tags.height.replace(/[^\d.]/g, ''));
    if (parsedHeight > 0 && parsedHeight < 300) {
      height = parsedHeight;
    }
  } else if (tags.levels || tags['building:levels']) {
    const levels = parseInt(tags.levels || tags['building:levels']);
    if (levels > 0 && levels < 100) {
      height = levels * 3.5; // 3.5m per level
    }
  }
  
  return height;
}

// ========================================
// TRIGGER POINT GENERATION
// ========================================

/**
 * Generate trigger points from mega-unified data
 */
async function generateTriggerPointsFromMegaData(megaData, boundary, lat, lng, name) {
  // Extract data from mega-unified result
  const { streets, buildings, elevation, landmark } = megaData;
  
  // Use the processed streets data (already sorted by confidence)
  const processedStreets = streets || [];
  
  if (processedStreets.length === 0) {
    console.log('⚠️ No streets found in mega-unified data');
    return [];
  }
  
  // Generate trigger points using mega-unified data
  const streetTriggerPoints = await generateTriggersFromMegaStreets(
    lat, 
    lng, 
    boundary.coordinates, 
    processedStreets,
    landmark,
    buildings.regionalAnalysis,
    buildings.elements
  );
  
  console.log(`✅ MEGA-UNIFIED: Generated ${streetTriggerPoints.length} trigger points`);
  
  return streetTriggerPoints;
}

/**
 * Generate triggers from mega-unified street data
 */
async function generateTriggersFromMegaStreets(poiLat, poiLng, boundaryCoordinates, streets, landmarkInfo, regionalHeight, buildings = null) {
  const triggerPoints = [];
  
  // Sort streets by confidence (already done in mega-processing, but ensure)
  const sortedStreets = streets.sort((a, b) => b.confidence - a.confidence);
  
  for (let i = 0; i < sortedStreets.length; i++) {
    const street = sortedStreets[i];
    const isFullCheck = i < SAMPLING_CONFIG.MAX_FULL_CHECKS; // Full check for closest streets only
    
    // Find strategic points on this street with smart sampling
    const streetPoints = await findStrategicPointsOnStreet(
      street, 
      poiLat, 
      poiLng, 
      boundaryCoordinates, 
      landmarkInfo, 
      regionalHeight, 
      isFullCheck,
      buildings
    );
    
    triggerPoints.push(...streetPoints);
  }

  // Calculate POI area for dynamic filtering
  const poiArea = calculatePolygonArea(boundaryCoordinates);
  
  // Dynamic minimum distance based on landmark info
  let minPointDistance = 50;
  if (landmarkInfo?.isHighVisibility) {
    minPointDistance = 100;
  } else if (poiArea > 1000000) {
    minPointDistance = 30;
  } else if (poiArea > 100000) {
    minPointDistance = 40;
  } else if (poiArea > 10000) {
    minPointDistance = 50;
  } else {
    minPointDistance = 60;
  }

  // Remove points that are too close to each other
  const filteredPoints = [];
  for (const point of triggerPoints) {
    const tooClose = filteredPoints.some(existing => 
      calculateDistance(point.lat, point.lng, existing.lat, existing.lng) < minPointDistance
    );
    if (!tooClose) {
      filteredPoints.push(point);
    }
  }

  // Sort by distance and limit results
  filteredPoints.sort((a, b) => (a.distance_from_poi || 0) - (b.distance_from_poi || 0));
  
  return filteredPoints.slice(0, 15); // Limit to 15 best points
}

/**
 * Find strategic points on a specific street using mega-unified data
 */
async function findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo, regionalHeight = null, isFullCheck = false, buildings = null) {
  const points = [];
  
  // Strategy 1: Find closest point on street to POI
  const closestPoint = findClosestPointOnStreet(street.coordinates, poiLat, poiLng);
  const distance = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng);
  const bearing = calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng);
  
  // Smart visibility check - use full check only for closest points
  let hasVisibility = false;
  if (isFullCheck || distance <= 300) {
    hasVisibility = await checkVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight, buildings);
    console.log(`🔍 Full visibility check for ${street.name} at ${distance.toFixed(0)}m: ${hasVisibility ? 'visible' : 'blocked'}`);
  } else {
    // Fast approximation for distant points
    hasVisibility = true; // Assume visibility for performance
    console.log(`⚡ Fast approximation for ${street.name} at ${distance.toFixed(0)}m: assumed visible`);
  }

  if (hasVisibility) {
    points.push({
      lat: closestPoint.lat,
      lng: closestPoint.lng,
      distance_from_poi: distance,
      bearing_to_poi: bearing,
      street_name: street.name,
      type: distance <= 200 ? 'primary' : distance <= 500 ? 'secondary' : 'tertiary',
      confidence: street.confidence,
      source: 'mega_unified_closest'
    });
  }

  // Strategy 2: Find intersection points (for important streets only)
  if (isFullCheck && street.coordinates.length > 10) {
    const intersections = findIntersectionPoints(street.coordinates);
    for (const intersection of intersections.slice(0, 2)) { // Limit to 2 intersections
      const intDistance = calculateDistance(poiLat, poiLng, intersection.lat, intersection.lng);
      const intBearing = calculateBearing(intersection.lat, intersection.lng, poiLat, poiLng);
      const intVisibility = await checkVisibilityToPOI(intersection, boundaryCoordinates, poiLat, poiLng, landmarkInfo, regionalHeight, buildings);
      
      if (intVisibility) {
        points.push({
          lat: intersection.lat,
          lng: intersection.lng,
          distance_from_poi: intDistance,
          bearing_to_poi: intBearing,
          street_name: street.name,
          type: intDistance <= 200 ? 'primary' : 'secondary',
          confidence: street.confidence * 0.9,
          source: 'mega_unified_intersection'
        });
      }
    }
  }

  return points;
}

function findIntersectionPoints(coordinates) {
  const intersections = [];
  const step = Math.max(1, Math.floor(coordinates.length / 8)); // Sample points
  
  for (let i = step; i < coordinates.length - step; i += step) {
    intersections.push(coordinates[i]);
  }
  
  return intersections;
}

function removeDuplicatePoints(points, minDistance) {
  const filtered = [];
  for (const point of points) {
    const isDuplicate = filtered.some(existing => 
      calculateDistance(point.lat, point.lng, existing.lat, existing.lng) < minDistance
    );
    if (!isDuplicate) {
      filtered.push(point);
    }
  }
  return filtered;
}

// ========================================
// DATABASE OPERATIONS
// ========================================

/**
 * Save trigger points to database
 */
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
      expected_bearing: tp.bearing_to_poi,
      bearing_threshold: 30,
      type: tp.type,
      priority: tp.type === 'primary' ? 1 : tp.type === 'secondary' ? 2 : 3,
      confidence_score: tp.confidence,
      auto_status: tp.confidence > 0.7 ? 'approved' : tp.confidence > 0.4 ? 'review' : 'rejected',
      generation_method: 'mega_unified_strategy',
      score_factors: {
        distance_from_poi: tp.distance_from_poi,
        street_confidence: tp.confidence || null,
        visibility_score: tp.confidence || null,
        source: tp.source
      },
      name: `TP-${index + 1}`,
      description: `${tp.street_name} - ${tp.distance_from_poi?.toFixed(0)}m from POI`,
      direction: null,
      access: 'both',
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

/**
 * Update attraction metadata
 */
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
      generation_strategy: 'mega_unified',
      generation_range: metadata.landmarkInfo?.maxRange || null,
      last_tp_generation_at: new Date().toISOString(),
      tp_generation_metadata: {
        landmark_info: metadata.landmarkInfo,
        processing_time_ms: metadata.processingTime,
        trigger_points_count: metadata.triggerPointsCount,
        poi_confidence_score: metadata.poiConfidenceScore,
        generation_timestamp: new Date().toISOString(),
        system: 'mega_unified_only'
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

/**
 * Calculate comprehensive POI confidence score
 */
function calculatePOIConfidenceScore(boundary, triggerPoints, boundarySource, landmarkInfo) {
  let score = 0.5; // Base score
  
  // Boundary confidence contribution (40% of total)
  score += (boundary.confidence || 0.5) * 0.4;
  
  // Boundary source bonus
  const sourceBonus = {
    'mega_unified': 0.3,
    'osm_nominatim': 0.25,
    'osm_reverse_geocoding': 0.2,
    'estimated': 0.0
  };
  score += sourceBonus[boundarySource] || 0.0;
  
  // Trigger points quality (30% of total)
  if (triggerPoints.length > 0) {
    const avgTriggerConfidence = triggerPoints.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPoints.length;
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

// ========================================
// MAIN HANDLER
// ========================================

serve(async (req) => {
  const startTime = Date.now();
  
  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const { poi_id, lat, lng, name, test_mode = false } = await req.json();
    
    if (!lat || !lng) {
      return new Response('Missing required parameters: lat, lng', { status: 400 });
    }
    
    if (!test_mode && !poi_id) {
      return new Response('Missing required parameter: poi_id (required for database operations)', { status: 400 });
    }

    console.log(`🎯 Step 1: Boundary detection for ${name || 'coordinates'}`);
    
    // Get mega-unified POI data
    const megaData = await getMegaUnifiedPOIData(lat, lng, name);
    
    if (!megaData || !megaData.boundaries || megaData.boundaries.length === 0) {
      console.error(`❌ MEGA-UNIFIED failed to find boundaries`);
      return new Response('No boundaries found', { status: 404 });
    }

    // Use the best boundary
    const boundary = megaData.boundaries[0];
    console.log(`✅ Using boundary: ${boundary.tags?.name || 'unnamed'} (confidence: ${boundary.confidence.toFixed(2)})`);

    console.log(`🎯 Step 2: Generating trigger points`);
    
    // Generate trigger points using mega-unified data
    const triggerPoints = await generateTriggerPointsFromMegaData(megaData, boundary, lat, lng, name);
    
    if (triggerPoints.length === 0) {
      console.warn(`⚠️ No trigger points generated`);
      return new Response('No trigger points found', { status: 404 });
    }

    console.log(`✅ Generated ${triggerPoints.length} trigger points`);

    // Calculate processing time and metrics
    const processingTime = Date.now() - startTime;
    const poiHeight = await detectPOIHeight(lat, lng);
    const urbanDensity = await detectUrbanDensity(lat, lng);
    const boundarySource = 'mega_unified';
    const poiConfidenceScore = calculatePOIConfidenceScore(boundary, triggerPoints, boundarySource, megaData.landmark);

    // Save to database if not in test mode
    let saveResult = null;
    let metadataResult = null;
    
    if (!test_mode && poi_id) {
      // Save trigger points to database
      saveResult = await saveTriggerPointsToDatabase(supabase, poi_id, triggerPoints, {
        boundarySource,
        landmarkInfo: megaData.landmark,
        poiConfidenceScore,
        processingTime
      });
      
      // Update attraction metadata
      metadataResult = await updateAttractionMetadata(supabase, poi_id, {
        poiHeight,
        urbanDensity,
        boundarySource,
        boundary: {
          confidence: boundary.confidence,
          area_m2: calculatePolygonArea(boundary.coordinates)
        },
        landmarkInfo: megaData.landmark,
        processingTime,
        triggerPointsCount: triggerPoints.length,
        poiConfidenceScore
      });
    }

    // Prepare response
    const response = {
      success: true,
      poi_id: poi_id || null,
      boundary: {
        coordinates: boundary.coordinates,
        source: boundary.source,
        confidence: boundary.confidence,
        tags: boundary.tags,
        area_m2: calculatePolygonArea(boundary.coordinates)
      },
      trigger_points: triggerPoints,
      metadata: {
        totalElements: megaData.metadata.totalElements,
        streetsAnalyzed: megaData.streets.length,
        buildingsAnalyzed: megaData.buildings.count,
        system: 'mega_unified_only',
        processing_time_ms: processingTime,
        poi_height: poiHeight,
        urban_density: urbanDensity,
        poi_confidence_score: poiConfidenceScore
      },
      stats: {
        primary: triggerPoints.filter(tp => tp.type === 'primary').length,
        secondary: triggerPoints.filter(tp => tp.type === 'secondary').length,
        tertiary: triggerPoints.filter(tp => tp.type === 'tertiary').length
      },
      database_operations: {
        save_result: saveResult,
        metadata_result: metadataResult,
        test_mode: test_mode
      }
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('❌ Error in generate-trigger-points:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message,
      system: 'mega_unified_only'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
