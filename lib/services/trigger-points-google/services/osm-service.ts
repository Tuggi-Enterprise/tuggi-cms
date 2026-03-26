// ========================================
// OSM/OVERPASS API SERVICE
// ========================================
// Handles all interactions with OpenStreetMap and Overpass API

import type { GeoPoint, OverpassResponse, OSMElement } from '../types/interfaces';
import { calculatePolygonArea, calculatePolygonCenter, calculatePolygonPerimeter } from '../utils/calculations';

/**
 * Query Overpass API with rate limiting and retry logic
 * Agora usa MÚLTIPLOS MIRRORS para evitar rate limiting (429/504)
 */
export async function queryOverpassAPI(query: string, purpose: string, timeout: number = 30): Promise<OverpassResponse | null> {
  const maxRetries = 3;
  const baseDelay = 1000;
  
  // Lista de mirrors do Overpass API para resiliência
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
    'https://overpass.be/api/interpreter',
    'https://overpass-api.enit.it/api/interpreter'
  ];
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Rotacionar mirror a cada tentativa
    const mirror = mirrors[(attempt - 1) % mirrors.length];
    
    try {
      console.log(`🔍 Querying Overpass API (attempt ${attempt}/${maxRetries}) (mirror: ${new URL(mirror).hostname}) for: ${purpose}`);
      
      const response = await fetch(mirror, {
        method: 'POST',
        body: query,
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)',
          'Content-Type': 'text/plain'
        },
        signal: AbortSignal.timeout(timeout * 1000)
      });

      if (response.status === 429 || response.status === 504) {
        // Backoff exponencial + jitter
        const jitter = Math.random() * 1000;
        const delay = (baseDelay * Math.pow(2, attempt - 1)) + jitter;
        console.log(`⏳ Rate limited or timeout (${response.status}), waiting ${delay.toFixed(0)}ms before retry ${attempt}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        console.error(`❌ Overpass API error: ${response.status} - ${response.statusText}`);
        if (attempt === maxRetries) return null;
        continue;
      }

      const data = await response.json();
      console.log(`✅ Overpass API success: ${data.elements?.length || 0} elements found`);
      return data;

    } catch (error) {
      console.error(`❌ Overpass API request failed (attempt ${attempt}):`, error);
      if (attempt === maxRetries) {
        console.error(`❌ All ${maxRetries} attempts failed for: ${purpose}`);
        return null;
      }
      
      // Wait before retry with jitter
      const jitter = Math.random() * 1000;
      const delay = (baseDelay * Math.pow(2, attempt - 1)) + jitter;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
}

/**
 * Build standardized Overpass query
 */
export function buildOverpassQuery(
  elements: string[], 
  location: GeoPoint, 
  radius: number, 
  timeout: number = 30
): string {
  const elementQueries = elements.map(element => 
    `${element}(around:${radius},${location.lat},${location.lng});`
  ).join('\n      ');
  
  return `[out:json][timeout:${timeout}];
    (
      ${elementQueries}
    );
    out tags geom;`;
}

/**
 * Search OSM by name using Nominatim API
 */
export async function searchOSMByName(lat: number, lng: number, name: string, landmarkInfo?: any): Promise<any> {
  try {
    console.log(`🔍 Searching OSM by name: "${name}" near ${lat}, ${lng}`);
    
    const searchRadius = landmarkInfo?.isHighVisibility ? 
      Math.min(landmarkInfo.maxRange * 0.8, 3000) : 1000;
    
    const encodedName = encodeURIComponent(name);
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodedName}&` +
      `lat=${lat}&lon=${lng}&` +
      `bounded=1&viewbox=${lng-0.01},${lat+0.01},${lng+0.01},${lat-0.01}&` +
      `format=json&polygon_geojson=1&addressdetails=1&limit=5`;

    console.log(`🌐 Nominatim URL: ${nominatimUrl}`);
    
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (boundary-detection)'
      }
    });

    if (!response.ok) {
      console.error(`❌ Nominatim API error: ${response.status}`);
      return { success: false, error: `Nominatim API error: ${response.status}` };
    }

    const results = await response.json();
    console.log(`📍 Nominatim found ${results.length} results`);

    if (results.length === 0) {
      return { success: false, error: 'No results found in Nominatim' };
    }

    // Process and validate results
    for (const result of results) {
      if (result.geojson && result.geojson.coordinates) {
        const processed = await processOSMGeometry(result.geojson, lat, lng);
        if (processed.success) {
          return {
            success: true,
            boundary: processed.boundary,
            source: 'osm_nominatim',
            raw_data: result
          };
        }
      }
    }

    return { success: false, error: 'No valid boundaries found in Nominatim results' };

  } catch (error) {
    console.error('❌ Error in searchOSMByName:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Search OSM by coordinates using reverse geocoding
 */
export async function searchOSMByCoordinates(lat: number, lng: number): Promise<any> {
  try {
    console.log(`🔍 Reverse geocoding coordinates: ${lat}, ${lng}`);
    
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?` +
      `lat=${lat}&lon=${lng}&` +
      `format=json&polygon_geojson=1&addressdetails=1&zoom=18`;

    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (reverse-geocoding)'
      }
    });

    if (!response.ok) {
      console.error(`❌ Reverse geocoding error: ${response.status}`);
      return { success: false, error: `Reverse geocoding error: ${response.status}` };
    }

    const result = await response.json();
    
    if (result.geojson && result.geojson.coordinates) {
      const processed = await processOSMGeometry(result.geojson, lat, lng);
      if (processed.success) {
        return {
          success: true,
          boundary: processed.boundary,
          source: 'osm_reverse_geocoding',
          raw_data: result
        };
      }
    }

    return { success: false, error: 'No valid boundary found in reverse geocoding' };

  } catch (error) {
    console.error('❌ Error in searchOSMByCoordinates:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Search nearby OSM features
 */
export async function searchOSMNearbyFeatures(lat: number, lng: number, name: string): Promise<any> {
  try {
    console.log(`🔍 Searching nearby OSM features for: ${name}`);
    
    const query = `[out:json][timeout:30];
      (
        way[name~"${name}",i](around:1000,${lat},${lng});
        relation[name~"${name}",i](around:1000,${lat},${lng});
        way[leisure](around:500,${lat},${lng});
        way[tourism](around:500,${lat},${lng});
        way[amenity](around:500,${lat},${lng});
        relation[leisure](around:500,${lat},${lng});
        relation[tourism](around:500,${lat},${lng});
        relation[amenity](around:500,${lat},${lng});
      );
      out tags geom;`;

    const data = await queryOverpassAPI(query, `nearby features for ${name}`);
    
    if (!data || !data.elements || data.elements.length === 0) {
      return { success: false, error: 'No nearby features found' };
    }

    // Process and find the best matching feature
    const relevantFeatures = data.elements
      .filter((element: OSMElement) => element.tags && Object.keys(element.tags).length > 0)
      .map((element: OSMElement) => ({
        ...element,
        relevance: calculateFeatureRelevance(element.tags!, name)
      }))
      .filter((element: any) => element.relevance > 0)
      .sort((a: any, b: any) => b.relevance - a.relevance);

    if (relevantFeatures.length === 0) {
      return { success: false, error: 'No relevant features found' };
    }

    const bestFeature = relevantFeatures[0];
    console.log(`🎯 Best feature: ${bestFeature.tags?.name || 'unnamed'} (relevance: ${bestFeature.relevance})`);

    // Convert to boundary format
    if (bestFeature.type === 'way' && bestFeature.nodes) {
      // Process way geometry
      const coordinates = bestFeature.nodes.map((node: any) => ({
        lat: node.lat,
        lng: node.lon
      }));

      return {
        success: true,
        boundary: {
          type: 'polygon',
          coordinates,
          center: calculatePolygonCenter(coordinates),
          area_m2: calculatePolygonArea(coordinates),
          perimeter_m: calculatePolygonPerimeter(coordinates),
          confidence: 0.8,
          source: 'osm_nearby_features'
        },
        source: 'osm_nearby_features',
        raw_data: bestFeature
      };
    }

    return { success: false, error: 'Feature geometry not suitable for boundary' };

  } catch (error) {
    console.error('❌ Error in searchOSMNearbyFeatures:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Calculate feature relevance based on tags and name matching
 */
export function calculateFeatureRelevance(tags: Record<string, string>, searchName: string): number {
  let relevance = 0;
  const lowerSearchName = searchName.toLowerCase();
  
  // Name matching (highest priority)
  if (tags.name) {
    const lowerTagName = tags.name.toLowerCase();
    if (lowerTagName.includes(lowerSearchName) || lowerSearchName.includes(lowerTagName)) {
      relevance += 10;
    }
  }
  
  // Tag-based relevance
  const relevantTags = ['leisure', 'tourism', 'amenity', 'landuse', 'natural', 'historic'];
  for (const tag of relevantTags) {
    if (tags[tag]) {
      relevance += 2;
    }
  }
  
  // Specific high-value tags
  if (tags.leisure === 'park') relevance += 5;
  if (tags.tourism) relevance += 3;
  if (tags.historic) relevance += 3;
  if (tags.amenity) relevance += 2;
  
  return relevance;
}

/**
 * Process OSM geometry data
 */
async function processOSMGeometry(geojson: any, poiLat: number, poiLng: number): Promise<any> {
  try {
    if (!geojson || !geojson.coordinates) {
      return { success: false, error: 'No coordinates in geometry' };
    }

    let coordinates: GeoPoint[] = [];

    if (geojson.type === 'Polygon') {
      coordinates = geojson.coordinates[0].map((coord: number[]) => ({
        lat: coord[1],
        lng: coord[0]
      }));
    } else if (geojson.type === 'MultiPolygon') {
      // Use the largest polygon
      let largestPolygon = geojson.coordinates[0][0];
      for (const polygon of geojson.coordinates) {
        if (polygon[0].length > largestPolygon.length) {
          largestPolygon = polygon[0];
        }
      }
      coordinates = largestPolygon.map((coord: number[]) => ({
        lat: coord[1],
        lng: coord[0]
      }));
    } else {
      return { success: false, error: `Unsupported geometry type: ${geojson.type}` };
    }

    if (coordinates.length < 3) {
      return { success: false, error: 'Insufficient coordinates for boundary' };
    }

    // Calculate area and validate
    const area = calculatePolygonArea(coordinates);
    if (area < 100) { // Minimum 100 m²
      return { success: false, error: 'Boundary too small' };
    }

    return {
      success: true,
      boundary: {
        type: 'polygon',
        coordinates,
        center: calculatePolygonCenter(coordinates),
        area_m2: area,
        perimeter_m: calculatePolygonPerimeter(coordinates),
        confidence: 0.9,
        source: 'osm'
      }
    };

  } catch (error) {
    console.error('❌ Error processing OSM geometry:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Import calculatePolygonArea from geometry utils
// Import moved to top
