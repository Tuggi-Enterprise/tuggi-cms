import { api, apiManager } from '../../_shared/api-manager.ts'
// ========================================
// ELEVATION ANALYSIS SERVICE
// ========================================
// Handles POI height detection, urban density analysis, and elevation calculations

import type { GeoPoint, POIHeight, LandmarkInfo } from '../types/interfaces.ts';
import { queryOverpassAPI } from './osm-service.ts';
import { calculateDistance } from '../utils/calculations.ts';

// Known city elevations for quick lookup
export const KNOWN_CITY_ELEVATIONS: { [key: string]: number } = {
  'São Paulo': 760,
  'Rio de Janeiro': 31,
  'Belo Horizonte': 852,
  'Salvador': 8,
  'Brasília': 1172,
  'Fortaleza': 16,
  'Manaus': 92,
  'Curitiba': 934,
  'Recife': 4,
  'Goiânia': 749,
  'Belém': 10,
  'Porto Alegre': 10,
  'Guarulhos': 759,
  'Campinas': 854,
  'Nova Iguaçu': 26,
  'Maceió': 7,
  'São Luís': 24,
  'Duque de Caxias': 31,
  'Natal': 30,
  'Teresina': 72,
  'Campo Grande': 532,
  'São Bernardo do Campo': 802,
  'João Pessoa': 40,
  'Santo André': 760,
  'Osasco': 792,
  'Jaboatão dos Guararapes': 9,
  'São José dos Campos': 629,
  'Ribeirão Preto': 518,
  'Uberlândia': 842,
  'Sorocaba': 601,
  'Contagem': 872,
  'Aracaju': 4,
  'Feira de Santana': 234,
  'Cuiabá': 165,
  'Joinville': 4,
  'Aparecida de Goiânia': 749,
  'Londrina': 610,
  'Juiz de Fora': 678,
  'Ananindeua': 15,
  'Niterói': 6,
  'Belford Roxo': 31,
  'Caxias do Sul': 760,
  'Campos dos Goytacazes': 11,
  'Macapá': 16,
  'Vila Velha': 34,
  'São João de Meriti': 31,
  'Florianópolis': 3,
  'Santos': 2,
  'Mauá': 803,
  'Carapicuíba': 802,
  'Olinda': 16,
  'Diadema': 802,
  'Jundiaí': 761,
  'Piracicaba': 554,
  'Cariacica': 74,
  'Bauru': 526,
  'São Vicente': 3,
  'Pelotas': 7,
  'Montes Claros': 646,
  'Caruaru': 554,
  'Anápolis': 1017,
  'Taubaté': 577
};

// Cache for city base elevation to avoid redundant calls
const cityElevationCache = new Map<string, number>();

/**
 * Get elevation from Open Elevation API
 */
export async function getOpenElevationAPI(lat: number, lng: number): Promise<number | null> {
  try {
    const response = await apiManager.request('open-elevation', `lookup?locations=${lat},${lng}`, {});
    
    if (!response.ok) {
      return null;
    }
    
    const data = response.data;
    
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

/**
 * Get known city elevation based on coordinates
 */
export async function getKnownCityElevation(lat: number, lng: number): Promise<number | null> {
  try {
    // Query nearby cities using Nominatim
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (elevation-lookup)'
        }
      }
    );

    if (!response.ok) return null;

    const data = response.data;
    const address = data.address;

    if (!address) return null;

    // Check various address components
    const cityNames = [
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.county,
      address.state_district
    ].filter(Boolean);

    for (const cityName of cityNames) {
      if (KNOWN_CITY_ELEVATIONS[cityName]) {
        console.log(`🏙️ Found known city elevation: ${cityName} = ${KNOWN_CITY_ELEVATIONS[cityName]}m`);
        return KNOWN_CITY_ELEVATIONS[cityName];
      }
    }

    return null;
  } catch (error) {
    console.log('⚠️ Error getting known city elevation:', error);
    return null;
  }
}

/**
 * Get city base elevation by sampling nearby area
 */
export async function getCityBaseElevation(lat: number, lng: number): Promise<number> {
  try {
    // Create cache key with rounded coordinates (to group nearby requests)
    const cacheKey = `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`;
    
    // Check cache first
    if (cityElevationCache.has(cacheKey)) {
      const cachedElevation = cityElevationCache.get(cacheKey)!;
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

    const data = await queryOverpassAPI(overpassQuery, 'city elevation sampling');

    if (!data || !data.elements || data.elements.length === 0) {
      console.log('⚠️ OSM elevation sampling failed, using default 700m');
      const defaultElevation = 700;
      cityElevationCache.set(cacheKey, defaultElevation);
      return defaultElevation;
    }

    const elevations: number[] = [];
    for (const element of data.elements) {
      const ele = element.tags?.ele;
      if (ele && !isNaN(parseFloat(ele))) {
        elevations.push(parseFloat(ele));
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

/**
 * Detect urban density around a location
 */
export async function detectUrbanDensity(lat: number, lng: number): Promise<'very_dense' | 'dense' | 'medium' | 'low' | 'rural'> {
  try {
    console.log(`🏙️ Analyzing urban density at ${lat}, ${lng}`);
    
    const query = `[out:json][timeout:30];
      (
        way[building](around:500,${lat},${lng});
        way[highway~"^(motorway|trunk|primary|secondary)$"](around:1000,${lat},${lng});
        way[railway](around:1000,${lat},${lng});
        node[amenity](around:500,${lat},${lng});
        way[landuse~"^(commercial|industrial|retail)$"](around:500,${lat},${lng});
      );
      out count;`;

    const data = await queryOverpassAPI(query, 'urban density analysis');
    
    if (!data || !data.elements) {
      console.log('⚠️ Could not analyze urban density, defaulting to medium');
      return 'medium';
    }

    const buildingCount = data.elements.filter((el: any) => 
      el.tags?.building && el.type === 'way'
    ).length;

    const majorRoadCount = data.elements.filter((el: any) => 
      el.tags?.highway && ['motorway', 'trunk', 'primary', 'secondary'].includes(el.tags.highway)
    ).length;

    const amenityCount = data.elements.filter((el: any) => 
      el.tags?.amenity
    ).length;

    const commercialCount = data.elements.filter((el: any) => 
      el.tags?.landuse && ['commercial', 'industrial', 'retail'].includes(el.tags.landuse)
    ).length;

    const totalDensityScore = buildingCount + (majorRoadCount * 2) + amenityCount + (commercialCount * 1.5);

    console.log(`🏙️ Density analysis: buildings=${buildingCount}, major_roads=${majorRoadCount}, amenities=${amenityCount}, commercial=${commercialCount}, score=${totalDensityScore}`);

    if (totalDensityScore > 100) return 'very_dense';
    if (totalDensityScore > 50) return 'dense';
    if (totalDensityScore > 20) return 'medium';
    if (totalDensityScore > 5) return 'low';
    return 'rural';

  } catch (error) {
    console.error('❌ Error detecting urban density:', error);
    return 'medium'; // Safe default
  }
}

/**
 * Get estimated building height from OSM tags
 */
export function getEstimatedBuildingHeight(tags: Record<string, string>): number {
  // Direct height tag
  if (tags.height) {
    const height = parseFloat(tags.height.replace(/[^\d.]/g, ''));
    if (!isNaN(height) && height > 0) {
      return height;
    }
  }

  // Building levels
  if (tags['building:levels']) {
    const levels = parseInt(tags['building:levels']);
    if (!isNaN(levels) && levels > 0) {
      return levels * 3.5; // Assume 3.5m per level
    }
  }

  // Building type estimates
  const buildingType = tags.building;
  const buildingHeights: { [key: string]: number } = {
    'house': 6,
    'residential': 8,
    'apartments': 15,
    'commercial': 4,
    'retail': 4,
    'office': 12,
    'industrial': 8,
    'warehouse': 6,
    'hospital': 12,
    'school': 4,
    'church': 15,
    'tower': 50,
    'skyscraper': 100
  };

  return buildingHeights[buildingType] || 8; // Default 8m
}

/**
 * Detect POI height using OSM data
 */
export async function detectPOIHeight(lat: number, lng: number): Promise<POIHeight> {
  try {
    console.log(`📐 Detecting POI height at ${lat}, ${lng}`);
    
    const query = `[out:json][timeout:30];
      (
        way[building](around:50,${lat},${lng});
        way[man_made](around:50,${lat},${lng});
        node[natural=peak](around:100,${lat},${lng});
        way[amenity](around:50,${lat},${lng});
      );
      out tags;`;

    const data = await queryOverpassAPI(query, 'POI height detection');
    
    if (!data || !data.elements || data.elements.length === 0) {
      console.log('📐 No height data found, using default');
      return {
        height: 0,
        category: 'low',
        confidence: 0.0
      };
    }

    let maxHeight = 0;
    let confidence = 0.0;

    for (const element of data.elements) {
      if (element.tags) {
        const estimatedHeight = getEstimatedBuildingHeight(element.tags);
        if (estimatedHeight > maxHeight) {
          maxHeight = estimatedHeight;
          
          // Confidence based on data quality
          if (element.tags.height) confidence = 0.9;
          else if (element.tags['building:levels']) confidence = 0.7;
          else if (element.tags.building) confidence = 0.5;
          else confidence = 0.3;
        }
      }
    }

    let category: POIHeight['category'] = 'low';
    if (maxHeight > 50) category = 'very_high';
    else if (maxHeight > 20) category = 'high';
    else if (maxHeight > 8) category = 'medium';

    console.log(`📐 POI height detected: ${maxHeight}m (${category}, confidence: ${confidence})`);

    return {
      height: maxHeight,
      category,
      confidence
    };

  } catch (error) {
    console.error('❌ Error detecting POI height:', error);
    return {
      height: 0,
      category: 'low',
      confidence: 0.0
    };
  }
}

/**
 * Calculate height-based range for trigger points
 */
export function calculateHeightBasedRange(
  poiHeight: POIHeight,
  urbanDensity: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural'
): number {
  const baseRange = Math.max(poiHeight.height * 8, 200); // Minimum 200m
  
  const densityMultipliers = {
    'very_dense': 0.6,
    'dense': 0.8,
    'medium': 1.0,
    'low': 1.3,
    'rural': 1.8
  };
  
  const adjustedRange = baseRange * densityMultipliers[urbanDensity];
  
  // Apply confidence factor
  const confidenceAdjustedRange = adjustedRange * (0.5 + poiHeight.confidence * 0.5);
  
  return Math.round(Math.min(confidenceAdjustedRange, 2000)); // Cap at 2km
}

/**
 * Check if POI is a high-visibility landmark
 */
export async function checkHighVisibilityLandmark(
  poiLat: number, 
  poiLng: number, 
  currentDistance: number
): Promise<LandmarkInfo> {
  try {
    console.log(`🔍 Checking landmark for coordinates: ${poiLat}, ${poiLng}`);
    
    // Famous landmarks with known coordinates and elevations
    const famousLandmarks = [
      { name: 'Cristo Redentor', lat: -22.9519, lng: -43.2105, elevation: 710, baseElevation: 31, radius: 100 },
      { name: 'Pão de Açúcar', lat: -22.9487, lng: -43.1566, elevation: 396, baseElevation: 31, radius: 200 },
      { name: 'Pico do Jaraguá', lat: -23.4563, lng: -46.7668, elevation: 1135, baseElevation: 760, radius: 500 },
      { name: 'Pedra da Gávea', lat: -23.0117, lng: -43.2844, elevation: 842, baseElevation: 31, radius: 300 }
    ];

    // Check if coordinates match any famous landmark
    for (const landmark of famousLandmarks) {
      const distance = calculateDistance(poiLat, poiLng, landmark.lat, landmark.lng);
      if (distance < landmark.radius) {
        const elevationDiff = landmark.elevation - landmark.baseElevation;
        const theoreticalRange = Math.sqrt(elevationDiff) * 200; // Conservative multiplier
        const maxRange = Math.min(Math.max(theoreticalRange, 2000), 8000); // Between 2km-8km
        
        console.log(`🗿 Detected ${landmark.name}: ${landmark.elevation}m elevation, ${elevationDiff}m above base, max range: ${maxRange.toFixed(0)}m`);
        return { isHighVisibility: true, maxRange, elevationDiff };
      }
    }
    
    // Get city base elevation for comparison
    const cityBaseElevation = await getCityBaseElevation(poiLat, poiLng);
    console.log(`🏙️ City base elevation: ${cityBaseElevation}m`);
    
    // Try to get actual POI elevation
    const poiElevation = await getOpenElevationAPI(poiLat, poiLng);
    
    if (poiElevation !== null) {
      const elevationDiff = poiElevation - cityBaseElevation;
      console.log(`🏔️ POI elevation: ${poiElevation}m, city base: ${cityBaseElevation}m, diff: ${elevationDiff}m`);
      
      // Only consider high visibility if significantly elevated above city base (>200m difference)
      if (elevationDiff > 200) {
        const maxRange = Math.min(Math.sqrt(elevationDiff) * 150, 5000); // Conservative range
        console.log(`🏔️ Significant elevation above city detected: ${elevationDiff}m above base, max range: ${maxRange.toFixed(0)}m`);
        return { isHighVisibility: true, maxRange, elevationDiff };
      } else {
        console.log(`📍 Elevation within city range: ${elevationDiff}m above base - using urban density logic`);
      }
    }
    
    // Fallback: Use urban density-based logic for regular POIs
    console.log(`📍 Regular POI detected, using urban density-based range calculation`);
    
    const poiHeight = await detectPOIHeight(poiLat, poiLng);
    const urbanDensity = await detectUrbanDensity(poiLat, poiLng);
    
    console.log(`📐 POI height: ${poiHeight.height}m (confidence: ${poiHeight.confidence})`);
    console.log(`🏙️ Urban density: ${urbanDensity}`);
    
    // Only use height-based range if we have REAL data (confidence > 0)
    let maxRange = 1000; // Default range
    if (poiHeight.confidence > 0) {
      maxRange = calculateHeightBasedRange(poiHeight, urbanDensity);
      console.log(`📐 Using height-based range: ${maxRange}m (based on REAL data)`);
    } else {
      console.log(`📐 Using default range: ${maxRange}m (no real height data available)`);
    }
    
    return { isHighVisibility: false, maxRange, elevationDiff: 0 };

  } catch (error) {
    console.error('❌ Error checking landmark elevation:', error);
    // Fallback to urban density
    const urbanDensity = await detectUrbanDensity(poiLat, poiLng);
    const maxRange = urbanDensity === 'very_dense' ? 200 : urbanDensity === 'dense' ? 400 : 800;
    return { isHighVisibility: false, maxRange, elevationDiff: 0 };
  }
}
