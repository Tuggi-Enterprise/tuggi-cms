// ========================================
// BOUNDARY DETECTION SERVICE
// ========================================
// Handles POI boundary detection using multiple strategies

import type { GeoPoint, BoundaryData, LandmarkInfo } from '../types/interfaces';
import { 
  calculatePolygonArea, 
  calculatePolygonPerimeter, 
  calculatePolygonCenter, 
  calculateDistance 
} from '../utils/calculations';
import { 
  searchOSMByName, 
  searchOSMByCoordinates, 
  searchOSMNearbyFeatures, 
  queryOverpassAPI 
} from './osm-service';

/**
 * Main boundary detection orchestrator
 * Uses hierarchical strategy: name search -> coordinates -> nearby features -> unified -> fallback
 */
export async function detectPOIBoundary(
  lat: number, 
  lng: number, 
  name: string, 
  landmarkInfo: LandmarkInfo
): Promise<{ boundary: BoundaryData; source: string }> {
  console.log(`🎯 Starting boundary detection for: ${name} at ${lat}, ${lng}`);
  
  // Strategy 1: Search by name (PRIORITY - more precise)
  console.log('🔍 Strategy 1: Searching by name...');
  const nameSearchResult = await searchOSMByName(lat, lng, name, landmarkInfo);
  if (nameSearchResult.success && nameSearchResult.boundary) {
    console.log('✅ Found precise boundary from OSM Nominatim');
    return {
      boundary: enhanceBoundaryData(nameSearchResult.boundary, 'osm_nominatim'),
      source: 'osm_nominatim'
    };
  }

  // Strategy 2: Search by coordinates (reverse geocoding)
  console.log('🔍 Strategy 2: Searching by coordinates...');
  const coordSearchResult = await searchOSMByCoordinates(lat, lng);
  if (coordSearchResult.success && coordSearchResult.boundary) {
    console.log('✅ Found boundary from reverse geocoding');
    return {
      boundary: enhanceBoundaryData(coordSearchResult.boundary, 'osm_reverse_geocoding'),
      source: 'osm_reverse_geocoding'
    };
  }

  // Strategy 3: Search nearby features
  console.log('🔍 Strategy 3: Searching nearby features...');
  const nearbySearchResult = await searchOSMNearbyFeatures(lat, lng, name);
  if (nearbySearchResult.success && nearbySearchResult.boundary) {
    console.log('✅ Found boundary from nearby features');
    return {
      boundary: enhanceBoundaryData(nearbySearchResult.boundary, 'osm_nearby_features'),
      source: 'osm_nearby_features'
    };
  }

  // Strategy 4: Unified Overpass search
  console.log('🔍 Strategy 4: Unified Overpass search...');
  const unifiedResult = await queryUnifiedOverpassData(lat, lng, name, landmarkInfo);
  if (unifiedResult.success && unifiedResult.boundary) {
    console.log('✅ Found boundary from unified Overpass search');
    return {
      boundary: enhanceBoundaryData(unifiedResult.boundary, 'unified_overpass'),
      source: 'unified_overpass'
    };
  }

  // Strategy 5: Fallback - create estimated boundary
  console.log('🔍 Strategy 5: Creating estimated boundary...');
  const estimatedBoundary = createEstimatedBoundary(lat, lng, name);
  return {
    boundary: enhanceBoundaryData(estimatedBoundary, 'estimated_boundary'),
    source: 'estimated_boundary'
  };
}

/**
 * Unified Overpass query that combines multiple search strategies
 */
export async function queryUnifiedOverpassData(
  lat: number, 
  lng: number, 
  name: string, 
  landmarkInfo?: LandmarkInfo
): Promise<{ success: boolean; boundary?: BoundaryData; error?: string }> {
  try {
    console.log(`🔍 Unified Overpass search for: ${name}`);
    
    // Calculate search radii based on landmark info
    const landmark = landmarkInfo || { isHighVisibility: false, maxRange: 1000, elevationDiff: 0 };
    const majorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 1.2, 6000) : Math.min(landmark.maxRange * 1.2, 1500);
    const mediumRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange, 4000) : Math.min(landmark.maxRange, 1000);
    const minorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 0.7, 3000) : Math.min(landmark.maxRange * 0.7, 800);
    const immediateRadius = 80;
    
    console.log(`🔍 Unified search radii: major=${majorRadius}m, medium=${mediumRadius}m, minor=${minorRadius}m, immediate=${immediateRadius}m`);
    
    const query = `[out:json][timeout:45];
      (
        // Immediate area - highest priority
        way[name~"${name}",i](around:${immediateRadius},${lat},${lng});
        relation[name~"${name}",i](around:${immediateRadius},${lat},${lng});
        
        // Minor radius - specific features
        way[leisure](around:${minorRadius},${lat},${lng});
        way[tourism](around:${minorRadius},${lat},${lng});
        way[amenity](around:${minorRadius},${lat},${lng});
        way[landuse](around:${minorRadius},${lat},${lng});
        relation[leisure](around:${minorRadius},${lat},${lng});
        relation[tourism](around:${minorRadius},${lat},${lng});
        relation[amenity](around:${minorRadius},${lat},${lng});
        relation[landuse](around:${minorRadius},${lat},${lng});
        
        // Medium radius - broader search
        way[name~"${name}",i](around:${mediumRadius},${lat},${lng});
        relation[name~"${name}",i](around:${mediumRadius},${lat},${lng});
        
        // Major radius - for landmarks only
        ${landmark.isHighVisibility ? `
        way[name~"${name}",i](around:${majorRadius},${lat},${lng});
        relation[name~"${name}",i](around:${majorRadius},${lat},${lng});
        ` : ''}
      );
      out tags geom;`;

    const data = await queryOverpassAPI(query, `unified search for ${name}`, 45);
    
    if (!data || !data.elements || data.elements.length === 0) {
      return { success: false, error: 'No elements found in unified search' };
    }

    console.log(`📊 Unified search found ${data.elements.length} elements`);
    
    // Process and score boundaries
    const processedData = processUnifiedOverpassData(data, lat, lng, name, landmark);
    
    if (processedData.boundaries.length === 0) {
      return { success: false, error: 'No valid boundaries found' };
    }

    // Select best boundary
    const bestBoundary = await processBoundariesFromUnifiedData(processedData.boundaries, lat, lng, name);
    
    if (bestBoundary) {
      return {
        success: true,
        boundary: bestBoundary
      };
    }

    return { success: false, error: 'No suitable boundary found after processing' };

  } catch (error) {
    console.error('❌ Error in queryUnifiedOverpassData:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Process unified Overpass data and extract boundaries
 */
export function processUnifiedOverpassData(
  data: any, 
  lat: number, 
  lng: number, 
  name: string, 
  landmark: LandmarkInfo
): { boundaries: any[]; streets: any[] } {
  const boundaries: any[] = [];
  const streets: any[] = [];
  
  console.log(`🔄 Processing ${data.elements.length} elements from unified search`);
  
  for (const element of data.elements) {
    try {
      // Skip elements without proper geometry
      if (!element.geometry || element.geometry.length < 3) continue;
      
      const tags = element.tags || {};
      const elementName = tags.name || '';
      
      // Calculate distance to POI
      const firstPoint = element.geometry[0];
      const distance = calculateDistance({ lat, lng }, { lat: firstPoint.lat, lng: firstPoint.lon });
      
      // Classify element
      if (tags.highway) {
        // Street element
        streets.push({
          id: element.id,
          name: elementName,
          highway_type: tags.highway,
          geometry: element.geometry,
          distance,
          tags
        });
      } else if (isValidBoundaryElement(tags)) {
        // Potential boundary element
        const coordinates = element.geometry.map((point: any) => ({
          lat: point.lat,
          lng: point.lon
        }));
        
        if (coordinates.length >= 3) {
          const area = calculatePolygonArea(coordinates);
          const perimeter = calculatePolygonPerimeter(coordinates);
          const relevanceScore = scoreBoundaryRelevance({ tags, coordinates, area }, lat, lng, name);
          
          boundaries.push({
            id: element.id,
            type: 'polygon',
            coordinates,
            area_m2: area,
            perimeter_m: perimeter,
            distance,
            relevance_score: relevanceScore,
            tags,
            source: 'unified_overpass'
          });
        }
      }
    } catch (error) {
      console.warn(`⚠️ Error processing element ${element.id}:`, error);
      continue;
    }
  }
  
  // Sort boundaries by relevance
  boundaries.sort((a, b) => b.relevance_score - a.relevance_score);
  
  console.log(`📊 Processed: ${boundaries.length} boundaries, ${streets.length} streets`);
  
  return { boundaries, streets };
}

/**
 * Process boundaries from unified data and select the best one
 */
export async function processBoundariesFromUnifiedData(
  boundaries: any[], 
  lat: number, 
  lng: number, 
  name: string
): Promise<BoundaryData | null> {
  if (boundaries.length === 0) {
    return null;
  }
  
  console.log(`🎯 Processing ${boundaries.length} candidate boundaries`);
  
  // Take the highest scoring boundary
  const bestBoundary = boundaries[0];
  
  console.log(`✅ Selected boundary: ID ${bestBoundary.id}, score ${bestBoundary.relevance_score}, area ${bestBoundary.area_m2}m²`);
  
  return {
    type: 'polygon',
    coordinates: bestBoundary.coordinates,
    center: calculatePolygonCenter(bestBoundary.coordinates),
    area_m2: bestBoundary.area_m2,
    perimeter_m: bestBoundary.perimeter_m,
    confidence: Math.min(bestBoundary.relevance_score / 10, 0.9), // Normalize to 0-0.9
    source: 'unified_overpass'
  };
}

/**
 * Score boundary relevance based on various factors
 */
export function scoreBoundaryRelevance(boundary: any, lat: number, lng: number, name: string): number {
  let score = 0;
  const tags = boundary.tags;
  const lowerName = name.toLowerCase();
  
  // Name matching (highest priority)
  if (tags.name) {
    const tagName = tags.name.toLowerCase();
    if (tagName.includes(lowerName) || lowerName.includes(tagName)) {
      score += 10;
    }
  }
  
  // Tag-based scoring
  if (tags.leisure) score += 5;
  if (tags.tourism) score += 4;
  if (tags.amenity) score += 3;
  if (tags.landuse) score += 2;
  if (tags.natural) score += 2;
  if (tags.historic) score += 3;
  
  // Specific valuable tags
  if (tags.leisure === 'park') score += 3;
  if (tags.tourism === 'attraction') score += 4;
  if (tags.landuse === 'recreation_ground') score += 3;
  
  // Area-based scoring (prefer reasonable sizes)
  const area = boundary.area_m2;
  if (area > 1000 && area < 10000000) { // 1000m² to 10km²
    score += 2;
  }
  if (area > 10000 && area < 1000000) { // 1ha to 1km² - sweet spot
    score += 3;
  }
  
  return score;
}

/**
 * Check if an OSM element is valid for boundary detection
 */
function isValidBoundaryElement(tags: Record<string, string>): boolean {
  const validTags = ['leisure', 'tourism', 'amenity', 'landuse', 'natural', 'historic', 'building'];
  return validTags.some(tag => tags[tag]);
}

/**
 * Create estimated boundary when OSM data is not available
 */
export function createEstimatedBoundary(lat: number, lng: number, name: string): BoundaryData {
  console.log(`🔧 Creating estimated boundary for: ${name}`);
  
  // Estimate radius based on name patterns
  let radiusMeters = 100; // Default
  
  const lowerName = name.toLowerCase();
  
  // Size estimation based on common patterns
  if (lowerName.includes('parque') || lowerName.includes('park')) {
    radiusMeters = 300;
  } else if (lowerName.includes('shopping') || lowerName.includes('mall')) {
    radiusMeters = 200;
  } else if (lowerName.includes('igreja') || lowerName.includes('church')) {
    radiusMeters = 50;
  } else if (lowerName.includes('museu') || lowerName.includes('museum')) {
    radiusMeters = 80;
  } else if (lowerName.includes('estádio') || lowerName.includes('stadium')) {
    radiusMeters = 250;
  } else if (lowerName.includes('universidade') || lowerName.includes('university')) {
    radiusMeters = 400;
  } else if (lowerName.includes('hospital')) {
    radiusMeters = 150;
  }
  
  // Create circular boundary
  const coordinates: GeoPoint[] = [];
  const numPoints = 16; // 16-sided polygon approximation
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints;
    const deltaLat = (radiusMeters * Math.cos(angle)) / 111000; // ~111km per degree
    const deltaLng = (radiusMeters * Math.sin(angle)) / (111000 * Math.cos(lat * Math.PI / 180));
    
    coordinates.push({
      lat: lat + deltaLat,
      lng: lng + deltaLng
    });
  }
  
  const area = Math.PI * radiusMeters * radiusMeters;
  const perimeter = 2 * Math.PI * radiusMeters;
  
  console.log(`🔧 Created estimated circular boundary: radius=${radiusMeters}m, area=${area.toFixed(0)}m²`);
  
  return {
    type: 'circle',
    coordinates,
    center: { lat, lng },
    area_m2: area,
    perimeter_m: perimeter,
    confidence: 0.3, // Low confidence for estimated boundaries
    source: 'estimated_boundary'
  };
}

/**
 * Validate POI polygon for basic quality checks
 */
export function validatePOIPolygon(
  result: any, 
  searchTerm: string, 
  poiLat: number, 
  poiLng: number, 
  landmark: any
): boolean {
  if (!result.geojson || !result.geojson.coordinates) {
    return false;
  }
  
  try {
    let coordinates: GeoPoint[] = [];
    
    if (result.geojson.type === 'Polygon') {
      coordinates = result.geojson.coordinates[0].map((coord: number[]) => ({
        lat: coord[1],
        lng: coord[0]
      }));
    } else if (result.geojson.type === 'MultiPolygon') {
      coordinates = result.geojson.coordinates[0][0].map((coord: number[]) => ({
        lat: coord[1],
        lng: coord[0]
      }));
    }
    
    if (coordinates.length < 3) return false;
    
    const area = calculatePolygonArea(coordinates);
    const maxAllowedArea = landmark.isHighVisibility ? 50000000 : 10000000; // 50km² for landmarks, 10km² for regular
    
    return area > 100 && area < maxAllowedArea; // Between 100m² and max allowed
    
  } catch (error) {
    console.warn('⚠️ Error validating polygon:', error);
    return false;
  }
}

/**
 * Enhance boundary data with calculated metrics
 */
function enhanceBoundaryData(boundary: any, source: string): BoundaryData {
  const coordinates = boundary.coordinates || [];
  
  return {
    type: boundary.type || 'polygon',
    coordinates,
    center: calculatePolygonCenter(coordinates),
    area_m2: coordinates.length > 0 ? calculatePolygonArea(coordinates) : 0,
    perimeter_m: coordinates.length > 0 ? calculatePolygonPerimeter(coordinates) : 0,
    confidence: boundary.confidence || 0.8,
    source: source as any
  };
}
