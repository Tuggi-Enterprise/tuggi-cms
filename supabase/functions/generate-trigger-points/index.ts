import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ========================================
// 🚀 LEGACY TRIGGER POINTS CODE (MIGRATED)
// ========================================
// This is the EXACT code from app/api/poi-boundaries/detect/route.ts
// with minimal adaptations for Deno/Edge Functions

// ========================================
// UTILITY FUNCTIONS (LEGACY)
// ========================================

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  
  const y = Math.sin(dLng) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)
  
  let bearing = Math.atan2(y, x) * 180 / Math.PI
  return (bearing + 360) % 360
}

function calculatePolygonArea(coordinates: Array<{lat: number, lng: number}>): number {
  let area = 0
  const n = coordinates.length
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const xi = coordinates[i].lng * Math.PI / 180
    const yi = coordinates[i].lat * Math.PI / 180
    const xj = coordinates[j].lng * Math.PI / 180
    const yj = coordinates[j].lat * Math.PI / 180
    
    area += xi * yj - xj * yi
  }
  
  area = Math.abs(area) / 2
  const R = 6371000 // Earth's radius in meters
  return area * R * R
}

function isPointInPolygon(point: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): boolean {
  let inside = false
  const n = polygon.length
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (((polygon[i].lat > point.lat) !== (polygon[j].lat > point.lat)) &&
        (point.lng < (polygon[j].lng - polygon[i].lng) * (point.lat - polygon[i].lat) / (polygon[j].lat - polygon[i].lat) + polygon[i].lng)) {
      inside = !inside
    }
  }
  
  return inside
}

// Calculate minimum distance from point to polygon boundary
function calculateDistanceToPolygon(point: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): number {
  let minDistance = Infinity
  
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    const distance = distanceToLineSegment(point, polygon[i], polygon[j])
    minDistance = Math.min(minDistance, distance)
  }
  
  return minDistance
}

// Distance from point to line segment
function distanceToLineSegment(point: {lat: number, lng: number}, lineStart: {lat: number, lng: number}, lineEnd: {lat: number, lng: number}): number {
  const A = point.lat - lineStart.lat
  const B = point.lng - lineStart.lng
  const C = lineEnd.lat - lineStart.lat
  const D = lineEnd.lng - lineStart.lng
  
  const dot = A * C + B * D
  const lenSq = C * C + D * D
  let param = -1
  
  if (lenSq !== 0) {
    param = dot / lenSq
  }
  
  let xx, yy
  
  if (param < 0) {
    xx = lineStart.lat
    yy = lineStart.lng
  } else if (param > 1) {
    xx = lineEnd.lat
    yy = lineEnd.lng
  } else {
    xx = lineStart.lat + param * C
    yy = lineStart.lng + param * D
  }
  
  return calculateDistance(point.lat, point.lng, xx, yy)
}

// Find closest point on street to given coordinates
function findClosestPointOnStreet(streetCoordinates: Array<{lat: number, lng: number}>, targetLat: number, targetLng: number): {lat: number, lng: number} {
  let closestPoint = streetCoordinates[0]
  let minDistance = calculateDistance(targetLat, targetLng, closestPoint.lat, closestPoint.lng)
  
  for (const coord of streetCoordinates) {
    const distance = calculateDistance(targetLat, targetLng, coord.lat, coord.lng)
    if (distance < minDistance) {
      minDistance = distance
      closestPoint = coord
    }
  }
  
  return closestPoint
}

// ========================================
// BOUNDARY DETECTION FUNCTIONS (LEGACY)
// ========================================

// Create circular boundary around a point (fallback)
function createCircularBoundary(centerLat: number, centerLng: number, radiusMeters: number) {
  const points = []
  const earthRadius = 6371000 // Earth radius in meters
  
  // Create 16 points around the circle
  for (let i = 0; i < 16; i++) {
    const angle = (i * 2 * Math.PI) / 16
    
    // Calculate offset in degrees
    const latOffset = (radiusMeters * Math.cos(angle)) / earthRadius * (180 / Math.PI)
    const lngOffset = (radiusMeters * Math.sin(angle)) / (earthRadius * Math.cos(centerLat * Math.PI / 180)) * (180 / Math.PI)
    
    points.push({
      lat: centerLat + latOffset,
      lng: centerLng + lngOffset
    })
  }
  
  // Close the polygon
  points.push(points[0])
  
  const area = Math.PI * radiusMeters * radiusMeters // Circle area
  const perimeter = 2 * Math.PI * radiusMeters // Circle circumference
  
  return {
    coordinates: points,
    area_m2: area,
    perimeter_m: perimeter,
    confidence: 0.7 // Lower confidence since it's a fallback
  }
}

// Create estimated boundary based on name analysis
function createEstimatedBoundary(lat: number, lng: number, name: string) {
  console.log(`🔄 Creating estimated boundary for ${name}`)
  
  // Estimate radius based on name patterns (LEGACY LOGIC)
  let estimatedRadius = 100 // Default
  
  const lowerName = name.toLowerCase()
  if (lowerName.includes('parque') || lowerName.includes('park')) {
    estimatedRadius = 300
  } else if (lowerName.includes('praca') || lowerName.includes('praça') || lowerName.includes('square')) {
    estimatedRadius = 80
  } else if (lowerName.includes('igreja') || lowerName.includes('church') || lowerName.includes('cathedral')) {
    estimatedRadius = 50
  } else if (lowerName.includes('museu') || lowerName.includes('museum')) {
    estimatedRadius = 120
  } else if (lowerName.includes('shopping') || lowerName.includes('mall')) {
    estimatedRadius = 200
  } else if (lowerName.includes('estadio') || lowerName.includes('stadium')) {
    estimatedRadius = 250
  }
  
  const boundary = createCircularBoundary(lat, lng, estimatedRadius)
  const perimeter_m = 2 * Math.PI * estimatedRadius
  
  console.log(`📐 Estimated boundary: ${estimatedRadius}m radius, ${boundary.area_m2.toFixed(0)}m² area`)
  
  return {
    coordinates: boundary.coordinates,
    area_m2: boundary.area_m2,
    perimeter_m,
    confidence: 0.6
  }
}

// ========================================
// STREET PROCESSING FUNCTIONS (LEGACY)
// ========================================

function calculateStreetConfidence(tags: any, distance: number): number {
  let confidence = 0.5 // Base confidence
  
  // Highway type bonus
  const highwayBonusMap: Record<string, number> = {
    motorway: 0.1,
    trunk: 0.15,
    primary: 0.2,
    secondary: 0.25,
    tertiary: 0.3,
    residential: 0.35,
    living_street: 0.4
  }
  
  const highway = tags.highway
  if (highway && highwayBonusMap[highway]) {
    confidence += highwayBonusMap[highway]
  }
  
  // Name bonus
  if (tags.name && tags.name.length > 0) {
    confidence += 0.1
  }
  
  // Distance penalty (closer is better)
  const distancePenalty = Math.min(distance / 1000, 0.3) // Max 0.3 penalty
  confidence -= distancePenalty
  
  return Math.min(1.0, confidence)
}

// ========================================
// LANDMARK DETECTION FUNCTIONS (LEGACY)
// ========================================

// Known city elevations for urban density calculation
const KNOWN_CITY_ELEVATIONS: { [key: string]: number } = {
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
}

// Check if POI is a high-visibility landmark and calculate visibility range
async function checkHighVisibilityLandmark(poiLat: number, poiLng: number, currentDistance: number): Promise<{ isHighVisibility: boolean, maxRange: number, elevationDiff: number }> {
  console.log(`🔍 Checking landmark for coordinates: ${poiLat}, ${poiLng}`)
  
  // Known high-elevation landmarks with their elevations (only truly high landmarks)
  const knownLandmarks = [
    { name: 'cristo redentor', lat: -22.9519, lng: -43.2105, radius: 1000, elevation: 710, baseElevation: 10 }, // Rio sea level
    { name: 'pão de açúcar', lat: -22.9487, lng: -43.1566, radius: 1000, elevation: 396, baseElevation: 10 },
    { name: 'corcovado', lat: -22.9519, lng: -43.2105, radius: 1000, elevation: 710, baseElevation: 10 },
    { name: 'pico do jaraguá', lat: -23.4561, lng: -46.7677, radius: 1000, elevation: 1135, baseElevation: 760 }, // SP elevation
    { name: 'jaraguá', lat: -23.4561, lng: -46.7677, radius: 1000, elevation: 1135, baseElevation: 760 },
  ]
  
  // Check if current POI matches known landmarks
  for (const landmark of knownLandmarks) {
    const distance = calculateDistance(poiLat, poiLng, landmark.lat, landmark.lng)
    console.log(`🔍 Checking ${landmark.name}: distance = ${distance.toFixed(2)}m (radius: ${landmark.radius}m)`)
    if (distance < landmark.radius) {
      const elevationDiff = landmark.elevation - landmark.baseElevation
      const theoreticalRange = Math.sqrt(elevationDiff) * 200 // Conservative multiplier
      const maxRange = Math.min(Math.max(theoreticalRange, 2000), 8000) // Between 2km-8km
      
      console.log(`🗿 Detected ${landmark.name}: ${landmark.elevation}m elevation, ${elevationDiff}m above base, max range: ${maxRange.toFixed(0)}m`)
      return { isHighVisibility: true, maxRange, elevationDiff }
    }
  }
  
  // For now, use enhanced approach with urban density detection (LEGACY LOGIC)
  console.log(`📍 No significant elevation found - calculating urban density-based range`)
  
  try {
    // Use urban density detection for dynamic range calculation
    const urbanDensity = await detectUrbanDensity(poiLat, poiLng)
    const maxRange = urbanDensity === 'very_dense' ? 200 : urbanDensity === 'dense' ? 400 : 800
    console.log(`🏙️ Urban density: ${urbanDensity}, maxRange: ${maxRange}m`)
    return { isHighVisibility: false, maxRange, elevationDiff: 0 }
  } catch (error) {
    console.log(`⚠️ Urban density detection failed, using default range`)
    const maxRange = 1000 // Default range
    return { isHighVisibility: false, maxRange, elevationDiff: 0 }
  }
}

// Get known city elevation (LEGACY FUNCTION)
async function getKnownCityElevation(lat: number, lng: number): Promise<number | null> {
  try {
    // Use reverse geocoding to get city name
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (city-elevation-lookup)'
      }
    })
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    
    if (data.address) {
      const cityNames = [
        data.address.city,
        data.address.town,
        data.address.village,
        data.address.municipality,
        data.address.county
      ].filter(Boolean)
      
      for (const cityName of cityNames) {
        if (cityName) {
          const normalizedName = cityName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          
          if (KNOWN_CITY_ELEVATIONS[normalizedName]) {
            console.log(`🏙️ Found known city elevation: ${cityName} = ${KNOWN_CITY_ELEVATIONS[normalizedName]}m`)
            return KNOWN_CITY_ELEVATIONS[normalizedName]
          }
        }
      }
    }
    
    return null
  } catch (error) {
    console.log('⚠️ Error getting known city elevation:', error)
    return null
  }
}

// Detect urban density (LEGACY FUNCTION)
async function detectUrbanDensity(lat: number, lng: number): Promise<'very_dense' | 'dense' | 'medium' | 'low' | 'rural'> {
  try {
    console.log(`🏙️ Detecting urban density for ${lat}, ${lng}`)
    
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
    out count;`
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: overpassQuery
    })
    
    if (!response.ok) {
      console.log('⚠️ Overpass API failed for urban density, using default')
      return 'medium'
    }
    
    const data = await response.json()
    
    if (data.elements && data.elements.length > 0) {
      const buildingCount = data.elements.filter((e: any) => e.tags?.building).length
      const majorRoadCount = data.elements.filter((e: any) => 
        e.tags?.highway && ['motorway', 'trunk', 'primary', 'secondary'].includes(e.tags.highway)
      ).length
      const totalRoadCount = data.elements.filter((e: any) => e.tags?.highway).length
      
      console.log(`📊 Urban density analysis: ${buildingCount} buildings, ${majorRoadCount} major roads, ${totalRoadCount} total roads`)
      
      // Classify urban density based on counts
      if (buildingCount > 50 && majorRoadCount > 3) return 'very_dense'
      if (buildingCount > 25 && totalRoadCount > 8) return 'dense'
      if (buildingCount > 10 && totalRoadCount > 4) return 'medium'
      if (buildingCount > 2 && totalRoadCount > 1) return 'low'
      return 'rural'
    }
    
    return 'medium' // Default
    
  } catch (error) {
    console.log('⚠️ Error detecting urban density:', error)
    return 'medium'
  }
}

// ========================================
// VISIBILITY CHECK FUNCTIONS (LEGACY)
// ========================================

async function checkVisibilityToPOI(point: {lat: number, lng: number}, boundaryCoordinates: Array<{lat: number, lng: number}>, poiLat: number, poiLng: number, landmarkInfo?: any): Promise<boolean> {
  // Enhanced visibility check for street-based trigger points
  const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng)
  
  // Calculate POI area to adjust criteria dynamically
  const poiArea = calculatePolygonArea(boundaryCoordinates)
  
  // Use provided landmark info or check if this is a high-visibility landmark (fallback)
  const landmark = landmarkInfo || await checkHighVisibilityLandmark(poiLat, poiLng, distance)
  
  // Dynamic distance limits based on POI size and elevation
  let minDistance = 80
  let maxDistance = 800
  let bufferDistance = 20
  
  if (landmark.isHighVisibility) { // High elevation landmarks
    minDistance = 300  // Much further minimum distance for elevated POIs
    maxDistance = landmark.maxRange // Dynamic range based on elevation
    bufferDistance = 10
    console.log(`🏔️ High-visibility landmark detected - extended range: ${minDistance}m-${maxDistance}m (elevation diff: ${landmark.elevationDiff}m)`)
  } else if (poiArea > 1000000) { // Large areas like Ibirapuera (>1M m²)
    minDistance = 50
    maxDistance = 1200
    bufferDistance = 15
  } else if (poiArea > 100000) { // Medium areas (>100k m²)
    minDistance = 60
    maxDistance = 1000
    bufferDistance = 18
  } else if (poiArea > 10000) { // Small areas (>10k m²)
    minDistance = 80
    maxDistance = 800
    bufferDistance = 25
  } else { // Very small areas (buildings)
    minDistance = 100
    maxDistance = 600
    bufferDistance = 30
  }
  
  // Must be at proper distance for street positioning  
  if (distance < minDistance || distance > maxDistance) return false
  
  // Check if point is inside POI boundary (would mean no external visibility)
  const isInside = isPointInPolygon(point, boundaryCoordinates)
  if (isInside) return false
  
  // Additional check: ensure point is not too close to boundary (buffer zone)
  const distanceToBoundary = calculateDistanceToPolygon(point, boundaryCoordinates)
  if (distanceToBoundary < bufferDistance) return false
  
  return true
}

// ========================================
// UTILITY FUNCTIONS (ADDITIONAL LEGACY)
// ========================================

function convertOSMPolygon(coordinates: number[][]): Array<{lat: number, lng: number}> {
  return coordinates.map(coord => ({
    lat: coord[1], // OSM uses [lng, lat] format
    lng: coord[0]
  }))
}

function calculatePolygonCenter(coordinates: Array<{lat: number, lng: number}>): {lat: number, lng: number} {
  const n = coordinates.length
  let lat = 0, lng = 0
  
  coordinates.forEach(coord => {
    lat += coord.lat
    lng += coord.lng
  })
  
  return {
    lat: lat / n,
    lng: lng / n
  }
}

function calculatePolygonPerimeter(coordinates: Array<{lat: number, lng: number}>): number {
  let perimeter = 0
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const distance = calculateDistance(
      coordinates[i].lat, coordinates[i].lng,
      coordinates[i + 1].lat, coordinates[i + 1].lng
    )
    perimeter += distance
  }
  
  return Math.round(perimeter)
}

// ========================================
// OSM BOUNDARY DETECTION FUNCTIONS (LEGACY)
// ========================================

async function processOSMGeometry(geojson: any, poiLat: number, poiLng: number): Promise<{success: boolean, boundary?: any}> {
  try {
    let allCoordinates: Array<{lat: number, lng: number}> = []
    let totalArea = 0
    let totalPerimeter = 0
    
    // Handle both Polygon and MultiPolygon
    if (geojson.type === 'Polygon') {
      const coordinates = convertOSMPolygon(geojson.coordinates[0])
      
      // Check if this polygon is close to our POI
      const center = calculatePolygonCenter(coordinates)
      const distance = calculateDistance(poiLat, poiLng, center.lat, center.lng)
      
      if (distance < 1000) { // Within 1km
        allCoordinates = coordinates
        totalArea = calculatePolygonArea(coordinates)
        totalPerimeter = calculatePolygonPerimeter(coordinates)
      }
    } else if (geojson.type === 'MultiPolygon') {
      console.log(`🔍 Found MultiPolygon with ${geojson.coordinates.length} parts`)
      
      // Process all polygons in the MultiPolygon
      const polygonParts: Array<{lat: number, lng: number}>[][] = []
      
      for (const polygonCoords of geojson.coordinates) {
        const coordinates = convertOSMPolygon(polygonCoords[0]) // First ring (outer boundary)
        
        // Check if this polygon part is close to our POI
        const center = calculatePolygonCenter(coordinates)
        const distance = calculateDistance(poiLat, poiLng, center.lat, center.lng)
        
        if (distance < 2000) { // Increased radius for MultiPolygon parts
          polygonParts.push(coordinates)
          totalArea += calculatePolygonArea(coordinates)
          totalPerimeter += calculatePolygonPerimeter(coordinates)
        }
      }
      
      // Combine all polygon parts into one boundary
      if (polygonParts.length > 0) {
        // Use the largest polygon as the main boundary
        const largestPolygon = polygonParts.reduce((largest, current) => 
          calculatePolygonArea(current) > calculatePolygonArea(largest) ? current : largest
        )
        
        allCoordinates = [...largestPolygon]
        console.log(`✅ Combined ${polygonParts.length} polygon parts into boundary`)
      }
    }
    
    if (allCoordinates.length > 0) {
      return {
        success: true,
        boundary: {
          type: 'polygon' as const,
          coordinates: allCoordinates,
          area_m2: Math.round(totalArea),
          perimeter_m: Math.round(totalPerimeter),
          confidence: 0.85,
          source: 'osm_name'
        }
      }
    }
    
    return { success: false }
    
  } catch (error) {
    return { 
      success: false
    }
  }


async function searchOSMByName(lat: number, lng: number, name: string, landmarkInfo?: any) {
  try {
    if (!name || typeof name !== 'string') {
      console.log('❌ Invalid name parameter for OSM search')
      return { success: false, error: 'Invalid name parameter' }
    }

    console.log(`🔍 Searching OSM Nominatim for: "${name}"`)
    
    // Check if this is a high-visibility landmark
    const landmark = landmarkInfo || await checkHighVisibilityLandmark(lat, lng, 0)
    console.log(`🗿 Landmark info for scoring: isHighVisibility=${landmark.isHighVisibility}, elevation=${landmark.elevationDiff}m`)
    
    // Smaller, more precise search area for buildings (800m radius)
    const viewboxRadius = 0.008 // ~800m in degrees  
    const viewbox = `${lng-viewboxRadius},${lat+viewboxRadius},${lng+viewboxRadius},${lat-viewboxRadius}`
    
    // Build comprehensive search variations to avoid missing POIs
    const searchVariations = []
    const nameLower = name.toLowerCase()
    
    // Always try the original name first
    searchVariations.push(name)
    searchVariations.push(`"${name}"`) // Exact phrase
    
    // For museums
    if (nameLower.includes('museu') || nameLower.includes('museum')) {
      searchVariations.push(
        name.replace(/museu\s+/gi, ''), // Remove "Museu" prefix
        name.replace(/museum\s+/gi, ''), // Remove "Museum" prefix
        name.replace(/\s*-\s*.*$/g, ''), // Remove everything after first dash
        name.split(' - ')[0], // First part before dash
        name.split(' ').slice(0, 2).join(' '), // First two words
        name.split(' ')[1] || name // Second word (main name)
      )
    }
    // For buildings (like Copan)
    else if (nameLower.includes('edifício') || nameLower.includes('building') || nameLower.includes('copan')) {
      searchVariations.push(
        name.replace(/edifício\s+/gi, ''), // Remove "Edifício" prefix
        name.replace(/building\s+/gi, ''), // Remove "Building" prefix
        name.split(' ').pop(), // Last word (e.g., "Copan")
        name.split(' ').slice(-2).join(' ') // Last two words
      )
    }
    // For parks (like Ibirapuera)
    else if (nameLower.includes('parque') || nameLower.includes('park')) {
      searchVariations.push(
        name.replace(/parque\s+/gi, ''), // Remove "Parque" prefix
        name.replace(/park\s+/gi, ''), // Remove "Park" prefix
        name.replace(/parque/gi, 'park'),
        name.replace(/park/gi, 'parque'),
        name.split(' ').pop(), // Last word
        name.split(' ').slice(-2).join(' ') // Last two words
      )
    }
    // For churches and religious sites
    else if (nameLower.includes('igreja') || nameLower.includes('church') || nameLower.includes('catedral') || nameLower.includes('cathedral')) {
      searchVariations.push(
        name.replace(/igreja\s+/gi, ''),
        name.replace(/church\s+/gi, ''),
        name.replace(/catedral\s+/gi, ''),
        name.replace(/cathedral\s+/gi, ''),
        name.split(' ').slice(1).join(' '), // Remove first word
        name.split(' ').slice(-2).join(' ') // Last two words
      )
    }
    // Generic comprehensive approach for any POI
    else {
      searchVariations.push(
        name.split(' ')[0], // First word
        name.split(' ').slice(0, 2).join(' '), // First two words
        name.split(' ').slice(-2).join(' '), // Last two words
        name.split(' ').pop(), // Last word
        name.replace(/\s*-\s*.*$/g, ''), // Remove everything after first dash
        name.split(' - ')[0] // First part before dash
      )
    }
    
    // Remove duplicates, empty strings, and very short terms
    const uniqueVariations = [...new Set(searchVariations)]
      .filter(term => term && term.trim().length > 2)
      .slice(0, 8) // Limit to 8 variations to avoid too many requests
    
    console.log(`🔍 Generated ${uniqueVariations.length} search variations for: "${name}"`)

    for (const searchTerm of uniqueVariations) {
      if (!searchTerm || searchTerm.trim() === '') continue;
      
      console.log(`🔍 Trying search term: "${searchTerm}"`)
      
      const searchUrl = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(searchTerm)}&` +
        `format=json&` +
        `polygon_geojson=1&` +
        `addressdetails=1&` +
        `extratags=1&` + // Get extra tags for better matching
        `limit=3&` + // Reduced for performance and precision
        `bounded=1&` +
        `viewbox=${viewbox}`

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)'
        }
      })

      if (!response.ok) {
        console.log(`⚠️ Search failed for "${searchTerm}": ${response.status}`)
        continue
      }

      const data = await response.json()

      if (data && data.length > 0) {
        console.log(`✅ Found ${data.length} results for "${searchTerm}"`)
        
        // Score and rank results for best match using new validation function
        const scoredResults = data
          .filter((result: any) => result.geojson && (result.geojson.type === 'Polygon' || result.geojson.type === 'MultiPolygon'))
          .map((result: any) => {
            const validation = validatePOIPolygon(result, searchTerm, lat, lng, landmark)
            return { 
              result, 
              score: validation.score, 
              distance: validation.distance,
              isValidDistance: validation.isValidDistance,
              validation
            }
          })
          .sort((a: any, b: any) => b.score - a.score)

        // Try the best matches first with enhanced validation
        for (const { result, score, distance, isValidDistance, validation } of scoredResults) {
          if (score > 0.3) { // Adjusted threshold to allow parks with lower scores
            
            // CRITICAL: Enhanced validation from old system
            if (!isValidDistance) {
              console.log(`⚠️ Rejecting "${result.display_name.split(',')[0]}" - too far (${Math.round(distance)}m > ${validation.maxAcceptableDistance}m)`)
              console.log(`   📊 Validation details: nameScore=${validation.nameScore.toFixed(2)}, distanceScore=${validation.distanceScore.toFixed(2)}, typeScore=${validation.typeScore.toFixed(2)}`)
              continue // Skip this result, try next one
            }
            
            const boundaryResult = await processOSMGeometry(result.geojson, lat, lng)
            if (boundaryResult.success) {
              console.log(`🎯 Best match: "${result.display_name.split(',')[0]}" (Score: ${score.toFixed(2)}, Distance: ${Math.round(distance)}m)`)
              console.log(`   ✅ Validation passed: nameScore=${validation.nameScore.toFixed(2)}, distanceScore=${validation.distanceScore.toFixed(2)}, typeScore=${validation.typeScore.toFixed(2)}`)
              return boundaryResult
            }
          }
        }
      } else {
        console.log(`❌ No results for "${searchTerm}"`)
      }
      
      // Small delay between requests to be respectful to OSM
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.log(`❌ BUSCA POR NOME FALHOU: Testadas ${uniqueVariations.length} variações do nome "${name}", nenhuma retornou polígonos válidos`)
    console.log(`🔍 Variações testadas: ${uniqueVariations.join(', ')}`)
    return { success: false, error: `No suitable polygons found by name after trying ${uniqueVariations.length} variations` }

  } catch (error) {
    return { 
      success: false, 
      error: `OSM name search error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

async function searchOSMByCoordinates(lat: number, lng: number) {
  try {
    const reverseUrl = `https://nominatim.openstreetmap.org/reverse?` +
      `lat=${lat}&` +
      `lon=${lng}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `zoom=18`

    const response = await fetch(reverseUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)'
      }
    })

    if (!response.ok) {
      throw new Error(`OSM API error: ${response.status}`)
    }

    const data = await response.json()

    if (data && data.geojson && data.geojson.type === 'Polygon') {
      const coordinates = convertOSMPolygon(data.geojson.coordinates[0])
      const area_m2 = calculatePolygonArea(coordinates)
      const perimeter_m = calculatePolygonPerimeter(coordinates)

      return {
        success: true,
        boundary: {
          type: 'polygon' as const,
          coordinates,
          area_m2,
          perimeter_m,
          confidence: 0.9
        }
      }
    }

    return { success: false, error: 'No polygon found at coordinates' }

  } catch (error) {
    return { 
      success: false, 
      error: `OSM reverse geocoding error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

async function searchOSMNearbyFeatures(lat: number, lng: number, name: string) {
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
    out geom;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`)
    }

    const data = await response.json()
    console.log(`🔍 Overpass found ${data.elements?.length || 0} nearby features`)

    if (!data.elements || data.elements.length === 0) {
      return { success: false, error: 'No nearby features found' }
    }

    // Process polygons from the results
    const allPolygons: any[] = []

    for (const element of data.elements) {
      if (element.type === 'way' && element.geometry && element.geometry.length >= 4) {
        const coordinates: Array<{lat: number, lng: number}> = element.geometry.map((node: any) => ({
          lat: node.lat,
          lng: node.lon
        }))

        const area = calculatePolygonArea(coordinates)
        const center = calculatePolygonCenter(coordinates)
        const distance = calculateDistance(lat, lng, center.lat, center.lng)

        // Calculate relevance score
        let relevanceScore = calculateFeatureRelevance(element.tags || {}, name)

        // Only include polygons that meet minimum criteria
        if (distance < 2000 && area > 500 && relevanceScore > 0) {
          allPolygons.push({
            coordinates,
            area,
            distance,
            tags: element.tags || {},
            relevanceScore
          })
        }
      }
    }

    console.log(`🎯 Found ${allPolygons.length} valid polygons`)

    if (allPolygons.length > 0) {
      // Sort by relevance score
      allPolygons.sort((a, b) => b.relevanceScore - a.relevanceScore)

      // Use the most relevant polygon as the main boundary
      const mainPolygon = allPolygons[0]
      const coordinates = mainPolygon.coordinates
      const area_m2 = mainPolygon.area
      const perimeter_m = calculatePolygonPerimeter(coordinates)

      console.log(`🏆 Main polygon: ${mainPolygon.tags.name || mainPolygon.tags.leisure || 'unnamed'} (score: ${mainPolygon.relevanceScore})`)

      return {
        success: true,
        boundary: {
          type: 'polygon' as const,
          coordinates,
          area_m2,
          perimeter_m,
          confidence: Math.min(0.8, mainPolygon.relevanceScore / 10),
          source: 'osm_nearby'
        }
      }
    }

    return { success: false, error: 'No suitable polygons found in nearby features' }

  } catch (error) {
    return { 
      success: false, 
      error: `OSM nearby features error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

function calculateFeatureRelevance(tags: any, searchName: string): number {
  let relevanceScore = 0
  
  // Base relevance by type - Enhanced for important venues
  if (tags.building) relevanceScore += 2
  if (tags.leisure === 'park') relevanceScore += 5
  if (tags.leisure === 'garden') relevanceScore += 4
  if (tags.leisure === 'stadium') relevanceScore += 8 // High priority for stadiums
  if (tags.leisure === 'sports_centre') relevanceScore += 6
  if (tags.amenity === 'place_of_worship') relevanceScore += 3
  if (tags.amenity === 'theatre') relevanceScore += 5
  if (tags.tourism === 'attraction') relevanceScore += 4
  if (tags.tourism === 'museum') relevanceScore += 5
  if (tags.historic) relevanceScore += 3
  if (tags.natural === 'beach') relevanceScore += 4
  if (tags.landuse === 'recreation_ground') relevanceScore += 3
  if (tags.natural === 'water') relevanceScore += 2
  
  // Name similarity bonus
  if (tags.name && searchName) {
    const tagName = tags.name.toLowerCase()
    const searchLower = searchName.toLowerCase()
    if (tagName.includes(searchLower) || searchLower.includes(tagName)) {
      relevanceScore += 3
    }
  }
  
  return relevanceScore
}

function validatePOIPolygon(result: any, searchTerm: string, poiLat: number, poiLng: number, landmark: any) {
  const resultLat = parseFloat(result.lat)
  const resultLng = parseFloat(result.lon)
  const distance = calculateDistance(poiLat, poiLng, resultLat, resultLng)
  
  // Enhanced scoring based on old system
  let nameScore = 0
  const resultName = result.display_name.toLowerCase()
  const searchName = searchTerm.toLowerCase()
  
  // Name matching logic from old system
  if (resultName.includes(searchName)) nameScore = 1.0
  else if (searchName.includes(resultName.split(',')[0].toLowerCase())) nameScore = 0.8
  else nameScore = 0.3
  
  // Distance score with different thresholds for different POI types
  let distanceScore
  if (searchName.includes('parque') || searchName.includes('park')) {
    // Parks can be larger and further - more lenient distance scoring
    distanceScore = distance < 500 ? 1.0 : Math.max(0, (1000 - distance) / 1000)
  } else if (searchName.includes('pico') || searchName.includes('morro') || searchName.includes('cristo') || landmark.isHighVisibility) {
    // Landmarks can be even further due to their nature - very lenient scoring
    distanceScore = distance < 1000 ? 1.0 : Math.max(0, (2000 - distance) / 2000)
  } else {
    // Buildings need to be very close - stricter validation
    distanceScore = distance < 100 ? 1.0 : Math.max(0, (200 - distance) / 200)
  }
  
  // Type relevance scoring from old system
  let typeScore = 1.0
  if (result.type === 'building' || result.category === 'building') typeScore = 1.4
  if (result.osm_type === 'way') typeScore *= 1.1
  if (result.type === 'leisure' || result.category === 'leisure') typeScore = 1.3 // Boost for parks
  if (result.osm_type === 'relation') typeScore *= 1.2 // Relations often represent complex areas like parks
  
  // Special boost for high-visibility landmarks
  if (landmark.isHighVisibility) {
    typeScore *= 1.5 // Major boost for landmarks
    console.log(`🗿 Landmark boost applied: typeScore *= 1.5`)
  }
  
  const totalScore = nameScore * distanceScore * typeScore
  
  // Distance validation - critical check from old system
  const maxAcceptableDistance = landmark.isHighVisibility ? 500 : 300 // Landmarks can be bit further
  const isValidDistance = distance <= maxAcceptableDistance
  
  console.log(`📊 ${result.display_name.split(',')[0]} | Dist: ${Math.round(distance)}m | Score: ${totalScore.toFixed(2)} | Valid: ${isValidDistance}`)
  
  return {
    score: totalScore,
    distance,
    isValidDistance,
    nameScore,
    distanceScore,
    typeScore,
    maxAcceptableDistance
  }
}

// ========================================
// UNIFIED OVERPASS SYSTEM (LEGACY)
// ========================================

async function queryUnifiedOverpassData(lat: number, lng: number, name: string, landmarkInfo?: any): Promise<{
  boundaries: any[],
  streets: any[],
  immediateStreets: any[]
}> {
  try {
    console.log('🔍 Making unified Overpass API call for all POI data...')
    
    // Calculate search radii based on landmark info
    const landmark = landmarkInfo || await checkHighVisibilityLandmark(lat, lng, 0)
    const majorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 1.2, 6000) : Math.min(landmark.maxRange * 1.2, 1500)
    const mediumRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange, 4000) : Math.min(landmark.maxRange, 1000)
    const minorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 0.7, 3000) : Math.min(landmark.maxRange * 0.7, 800)
    const immediateRadius = 80
    
    console.log(`🔍 Unified search radii: major=${majorRadius}m, medium=${mediumRadius}m, minor=${minorRadius}m, immediate=${immediateRadius}m`)
    
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
    out geom;`

    console.log(`🔍 DEBUG: Unified Overpass query:`)
    console.log(unifiedQuery)
    
    // Rate limiting: Single delay for the unified request
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: unifiedQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (unified-poi-data)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      if (response.status === 429) {
        console.log('⏳ Rate limited by Overpass API, waiting 5 seconds and retrying...')
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        // Retry once
        const retryResponse = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: unifiedQuery,
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (unified-poi-data-retry)',
            'Content-Type': 'text/plain'
          }
        })
        
        if (!retryResponse.ok) {
          throw new Error(`Unified Overpass API error after retry: ${retryResponse.status}`)
        }
        
        const retryData = await retryResponse.json()
        console.log(`✅ Unified retry successful: ${retryData.elements?.length || 0} elements found`)
        return processUnifiedOverpassData(retryData, lat, lng, name, landmark)
      }
      
      throw new Error(`Unified Overpass API error: ${response.status}`)
    }

    const data = await response.json()
    console.log(`📊 Unified Overpass found ${data.elements?.length || 0} total elements`)
    
    return processUnifiedOverpassData(data, lat, lng, name, landmark)
    
  } catch (error) {
    console.error('❌ Error in unified Overpass query:', error)
    return { boundaries: [], streets: [], immediateStreets: [] }
  }
}

function processUnifiedOverpassData(data: any, lat: number, lng: number, name: string, landmark: any): {
  boundaries: any[],
  streets: any[],
  immediateStreets: any[]
} {
  if (!data.elements || data.elements.length === 0) {
    console.log('⚠️ No elements found in unified Overpass response')
    return { boundaries: [], streets: [], immediateStreets: [] }
  }

  const boundaries: any[] = []
  const streets: any[] = []
  const immediateStreets: any[] = []

  console.log(`🔍 Processing ${data.elements.length} unified elements...`)

  for (const element of data.elements) {
    if (!element.geometry || element.geometry.length < 2) continue

    const tags = element.tags || {}
    const highway = tags.highway
    const leisure = tags.leisure
    const landuse = tags.landuse
    const natural = tags.natural
    const tourism = tags.tourism
    const amenity = tags.amenity
    const sport = tags.sport

    // Categorize as BOUNDARY if it's a potential POI area
    if (leisure || landuse || natural || tourism || amenity === 'parking' || sport) {
      const coordinates = element.geometry.map((node: any) => ({
        lat: node.lat,
        lng: node.lon
      }))

      boundaries.push({
        ...element,
        coordinates,
        category: leisure || landuse || natural || tourism || amenity || sport,
        element_type: element.type
      })
    }
    
    // Categorize as STREET if it has highway tag
    else if (highway) {
      const coordinates = element.geometry.map((node: any) => ({
        lat: node.lat,
        lng: node.lon
      }))

      // Calculate distance to POI
      const closestPoint = findClosestPointOnStreet(coordinates, lat, lng)
      const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng)

      const streetData = {
        coordinates,
        name: tags.name || 'Unnamed Street',
        highway_type: highway,
        distance_to_poi: distance,
        closestPoint,
        confidence: calculateStreetConfidence(tags, distance)
      }

      // Separate immediate streets (within 80m) from regular streets
      if (distance <= 80) {
        immediateStreets.push(streetData)
      } else {
        streets.push(streetData)
      }
    }
  }

  console.log(`📊 Categorized: ${boundaries.length} boundaries, ${streets.length} streets, ${immediateStreets.length} immediate streets`)
  
  return { boundaries, streets, immediateStreets }
}

async function processBoundariesFromUnifiedData(boundaries: any[], lat: number, lng: number, name: string): Promise<any> {
  if (boundaries.length === 0) {
    return { success: false, error: 'No boundaries found in unified data' }
  }

  console.log(`🔍 Processing ${boundaries.length} boundaries from unified data`)

  // Use existing boundary processing logic
  const processedBoundaries = []
  
  for (const boundary of boundaries) {
    try {
      // Calculate polygon area and perimeter
      const area = calculatePolygonArea(boundary.coordinates)
      const perimeter = calculatePolygonPerimeter(boundary.coordinates)
      
      // Calculate distance from POI to boundary center
      const center = calculatePolygonCenter(boundary.coordinates)
      const distanceToCenter = calculateDistance(lat, lng, center.lat, center.lng)
      
      // Score this boundary
      const score = scoreBoundaryRelevance(boundary, lat, lng, name)
      
      processedBoundaries.push({
        ...boundary,
        area_m2: area,
        perimeter_m: perimeter,
        center,
        distance_to_poi: distanceToCenter,
        confidence_score: score,
        source: 'unified_overpass'
      })
      
    } catch (error) {
      console.error(`❌ Error processing boundary:`, error)
      continue
    }
  }

  if (processedBoundaries.length === 0) {
    return { success: false, error: 'No valid boundaries after processing' }
  }

  // Sort by confidence score and select the best one
  processedBoundaries.sort((a, b) => b.confidence_score - a.confidence_score)
  const bestBoundary = processedBoundaries[0]
  
  console.log(`✅ Selected boundary with confidence ${bestBoundary.confidence_score.toFixed(2)} (${bestBoundary.category})`)

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
  }
}

function scoreBoundaryRelevance(boundary: any, lat: number, lng: number, name: string): number {
  let score = 0.5 // Base score

  // Category bonus
  const category = boundary.category
  if (category === 'park') score += 0.3
  else if (category === 'attraction') score += 0.4
  else if (category === 'water') score += 0.2
  else if (category === 'recreation_ground') score += 0.25
  else if (category === 'forest' || category === 'grass') score += 0.15

  // Name matching bonus
  if (boundary.tags?.name) {
    const boundaryName = boundary.tags.name.toLowerCase()
    const searchName = name.toLowerCase()
    
    if (boundaryName.includes(searchName) || searchName.includes(boundaryName)) {
      score += 0.4
    }
  }

  // Distance penalty (closer is better)
  const center = calculatePolygonCenter(boundary.coordinates)
  const distance = calculateDistance(lat, lng, center.lat, center.lng)
  const distancePenalty = Math.min(distance / 1000, 0.3) // Max 0.3 penalty
  score -= distancePenalty

  // Size bonus/penalty (reasonable sizes preferred)
  const area = calculatePolygonArea(boundary.coordinates)
  if (area > 10000 && area < 5000000) { // 1 hectare to 500 hectares
    score += 0.1
  } else if (area < 1000) { // Very small
    score -= 0.2
  } else if (area > 10000000) { // Very large
    score -= 0.1
  }

  return Math.max(0.1, Math.min(1.0, score))
}

// ========================================
// TRIGGER POINTS GENERATION (LEGACY CORE)
// ========================================

async function generateStreetBasedTriggerPoints(boundary: any, poiLat: number, poiLng: number, poiName: string, landmarkInfo?: any) {
  console.log('🛣️ Generating street-based trigger points using enhanced legacy approach')
  
  try {
    // Use the unified system data that was already called in the main flow
    // This avoids duplicate API calls and follows the legacy pattern exactly
    const unifiedData = await queryUnifiedOverpassData(poiLat, poiLng, poiName, landmarkInfo)
    
    if (unifiedData.streets.length > 0) {
      console.log(`🛣️ Found ${unifiedData.streets.length} streets, generating street-based triggers`)
      return await generateTriggersFromUnifiedStreets(boundary, poiLat, poiLng, unifiedData.streets, landmarkInfo)
    } else {
      console.log('⚠️ No streets found, falling back to boundary-based triggers')
      return await generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName)
    }
    
  } catch (error) {
    console.error('❌ Error generating street-based triggers, falling back to boundary-based:', error)
    return await generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName)
  }
}

// Generate trigger points from street data
async function generateTriggersFromStreets(boundary: any, poiLat: number, poiLng: number, poiName: string, streets: any[], landmarkInfo?: any) {
  console.log(`🛣️ Processing ${streets.length} streets for trigger point generation`)
  
  const triggerPoints = []
  const processedStreets = []
  
  // Sort streets by distance and confidence
  const sortedStreets = streets
    .filter(street => street.distance_to_poi >= 15) // Minimum distance from POI
    .sort((a, b) => (b.confidence * 10) - a.distance_to_poi - ((a.confidence * 10) - b.distance_to_poi))
    .slice(0, 8) // Limit to 8 best streets
  
  console.log(`🎯 Selected ${sortedStreets.length} streets for trigger point generation`)
  
  for (const street of sortedStreets) {
    try {
      // Find strategic points on this street
      const streetTriggers = await findStrategicPointsOnStreet(
        street.coordinates, 
        poiLat, 
        poiLng, 
        boundary.coordinates,
        street.highway_type,
        landmarkInfo
      )
      
      // Add street context to trigger points
      for (const trigger of streetTriggers) {
        triggerPoints.push({
          ...trigger,
          street_name: street.name,
          highway_type: street.highway_type,
          street_confidence: street.confidence
        })
      }
      
      processedStreets.push({
        name: street.name,
        highway_type: street.highway_type,
        distance: street.distance_to_poi,
        triggers_generated: streetTriggers.length
      })
      
    } catch (error) {
      console.error(`❌ Error processing street ${street.name}:`, error)
    }
  }
  
  console.log(`✅ Generated ${triggerPoints.length} street-based trigger points from ${processedStreets.length} streets`)
  
  // If no street triggers, fallback to boundary-based
  if (triggerPoints.length === 0) {
    console.log('⚠️ No street triggers generated, falling back to boundary-based')
    return await generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName)
  }
  
  return triggerPoints.slice(0, 15) // Limit to 15 best points
}

// Find strategic points on a specific street
async function findStrategicPointsOnStreet(
  streetCoordinates: Array<{lat: number, lng: number}>, 
  poiLat: number, 
  poiLng: number, 
  boundaryCoordinates: Array<{lat: number, lng: number}>,
  highwayType: string,
  landmarkInfo?: any
) {
  const strategicPoints = []
  
  // Find multiple strategic points along the street
  const numPoints = Math.min(3, Math.max(1, Math.floor(streetCoordinates.length / 5)))
  
  for (let i = 0; i < numPoints; i++) {
    const segmentIndex = Math.floor((streetCoordinates.length - 1) * (i + 1) / (numPoints + 1))
    const point = streetCoordinates[segmentIndex]
    
    // Check if this point has good visibility to POI
    const hasVisibility = await checkVisibilityToPOI(point, boundaryCoordinates, poiLat, poiLng, landmarkInfo)
    
    if (hasVisibility) {
      const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng)
      const bearing = calculateBearing(point.lat, point.lng, poiLat, poiLng)
      
      // Calculate confidence based on street type and position
      let confidence = 0.8
      if (highwayType === 'primary' || highwayType === 'secondary') confidence += 0.1
      if (highwayType === 'residential') confidence += 0.05
      if (i === 0) confidence += 0.05 // First point bonus
      
      strategicPoints.push({
        lat: point.lat,
        lng: point.lng,
        type: i === 0 ? 'primary' : 'secondary',
        reasoning: `Ponto estratégico na ${highwayType} (${i + 1}/${numPoints})`,
        confidence,
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 25,
        auto_status: 'review'
      })
    }
  }
  
  return strategicPoints
}

// Find intersection points on a street (LEGACY FUNCTION)
function findIntersectionPoints(coordinates: Array<{lat: number, lng: number}>): Array<{lat: number, lng: number}> {
  // Simplified: return points where the street changes direction significantly
  const intersections: Array<{lat: number, lng: number}> = []
  
  for (let i = 1; i < coordinates.length - 1; i++) {
    const prev = coordinates[i - 1]
    const curr = coordinates[i]
    const next = coordinates[i + 1]
    
    // Calculate bearing change
    const bearing1 = calculateBearing(prev.lat, prev.lng, curr.lat, curr.lng)
    const bearing2 = calculateBearing(curr.lat, curr.lng, next.lat, next.lng)
    const bearingDiff = Math.abs(bearing2 - bearing1)
    
    // If bearing changes significantly, it might be an intersection
    if (bearingDiff > 30 && bearingDiff < 330) {
      intersections.push(curr)
    }
  }
  
  return intersections
}

// Remove duplicate points (LEGACY FUNCTION)
function removeDuplicatePoints(points: any[], minDistance: number) {
  const filtered = []
  
  for (const point of points) {
    let tooClose = false
    
    for (const existing of filtered) {
      const distance = calculateDistance(point.lat, point.lng, existing.lat, existing.lng)
      if (distance < minDistance) {
        tooClose = true
        break
      }
    }
    
    if (!tooClose) {
      filtered.push(point)
    }
  }
  
  return filtered
}

// Generate trigger points from unified streets (LEGACY FUNCTION)
async function generateTriggersFromUnifiedStreets(
  boundary: any,
  poiLat: number,
  poiLng: number,
  streets: any[],
  landmarkInfo?: any
): Promise<any[]> {
  console.log(`🛣️ Generating trigger points from ${streets.length} unified streets`)

  if (streets.length === 0) {
    console.log('⚠️ No streets in unified data, falling back to boundary-based triggers')
    return generateOptimalTriggerPoints(boundary, poiLat, poiLng, 'Unknown POI')
  }

  // Sort streets by relevance (distance and confidence)
  const sortedStreets = streets.sort((a, b) => {
    if (landmarkInfo?.isHighVisibility) {
      // For landmarks: prioritize variety of distances
      const scoreA = a.confidence * (1 + Math.min(a.distance_to_poi / 1000, 2))
      const scoreB = b.confidence * (1 + Math.min(b.distance_to_poi / 1000, 2))
      return scoreB - scoreA
    } else {
      // For regular POIs: prioritize closer streets
      const scoreA = a.confidence / Math.max(1, a.distance_to_poi / 100)
      const scoreB = b.confidence / Math.max(1, b.distance_to_poi / 100)
      return scoreB - scoreA
    }
  }).slice(0, 12) // Limit to 12 best streets

  const triggerPoints = []
  
  for (const street of sortedStreets) {
    // Find strategic points on this street using legacy method
    const streetPoints = await findStrategicPointsOnStreetLegacy(street, poiLat, poiLng, boundary.coordinates, landmarkInfo)
    triggerPoints.push(...streetPoints)
  }

  console.log(`🎯 Generated ${triggerPoints.length} trigger points from unified streets`)
  
  // Remove duplicates and apply final filtering
  const filteredPoints = removeDuplicatePoints(triggerPoints, 50) // 50m minimum distance
  
  return filteredPoints.slice(0, 15) // Limit to 15 best points
}

// Find strategic points on street (LEGACY IMPLEMENTATION)
async function findStrategicPointsOnStreetLegacy(street: any, poiLat: number, poiLng: number, boundaryCoordinates: Array<{lat: number, lng: number}>, landmarkInfo?: any) {
  const points = []
  
  // Strategy 1: Find closest point on street to POI
  const closestPoint = findClosestPointOnStreet(street.coordinates, poiLat, poiLng)
  const distance = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
  const bearing = calculateBearing(closestPoint.lat, closestPoint.lng, poiLat, poiLng)
  
  // Check if this point has good visibility to POI
  const hasVisibility = await checkVisibilityToPOI(closestPoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo)
  
  if (distance > 1000) {
    console.log(`🔍 Distant street point: ${street.name} at ${distance.toFixed(0)}m - visibility: ${hasVisibility}`)
  }
  
  // Dynamic distance check (will be validated again in checkVisibilityToPOI)
  if (hasVisibility) { // Let checkVisibilityToPOI handle distance validation
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
    })
  }

  // Strategy 2: Find points at street intersections (if available)
  const intersectionPoints = findIntersectionPoints(street.coordinates)
  for (const intersection of intersectionPoints) {
    const intDistance = calculateDistance(poiLat, poiLng, intersection.lat, intersection.lng)
    const intBearing = calculateBearing(intersection.lat, intersection.lng, poiLat, poiLng)
    const intVisibility = await checkVisibilityToPOI(intersection, boundaryCoordinates, poiLat, poiLng, landmarkInfo)
    
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
      })
    }
  }

  return points
}

// Find immediate streets (LEGACY FUNCTION)
async function findImmediateStreets(lat: number, lng: number) {
  try {
    console.log(`🔍 Searching for immediate streets with enhanced POV detection at (${lat}, ${lng})`)
    
    const radius = 80 // Expanded radius to catch better POV streets (was 50m)
    const overpassQuery = `[out:json][timeout:30];
    (
      way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|service)$"](around:${radius},${lat},${lng});
    );
    out geom;`
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: overpassQuery
    })
    
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`)
    }
    
    const data = await response.json()
    console.log(`📊 Found ${data.elements?.length || 0} immediate street elements`)
    
    if (!data.elements || data.elements.length === 0) {
      return []
    }
    
    const streets = []
    for (const element of data.elements) {
      if (element.geometry && element.geometry.length >= 2) {
        const coordinates = element.geometry.map((node: any) => ({
          lat: node.lat,
          lng: node.lon
        }))
        
        const closestPoint = findClosestPointOnStreet(coordinates, lat, lng)
        const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng)
        
        if (distance <= 80) {
          streets.push({
            coordinates,
            closestPoint,
            distance,
            name: element.tags?.name || 'Unnamed Street',
            highway_type: element.tags?.highway || 'unknown',
            confidence: calculateStreetConfidence(element.tags || {}, distance)
          })
        }
      }
    }
    
    console.log(`✅ Found ${streets.length} immediate streets`)
    return streets
    
  } catch (error) {
    console.error('❌ Error finding immediate streets:', error)
    return []
  }
}

// Generate directional trigger points (LEGACY FUNCTION)
async function generateDirectionalTriggerPoints(poiLat: number, poiLng: number, streets: any[], boundaryCoordinates?: Array<{lat: number, lng: number}>) {
  const triggerPoints = []
  
  // Define cardinal directions for analysis
  // Enhanced 8-direction analysis for better POV coverage
  const directions = [
    { name: 'North', bearing: 0, range: [337.5, 22.5] },
    { name: 'NorthEast', bearing: 45, range: [22.5, 67.5] },
    { name: 'East', bearing: 90, range: [67.5, 112.5] },
    { name: 'SouthEast', bearing: 135, range: [112.5, 157.5] },
    { name: 'South', bearing: 180, range: [157.5, 202.5] },
    { name: 'SouthWest', bearing: 225, range: [202.5, 247.5] },
    { name: 'West', bearing: 270, range: [247.5, 292.5] },
    { name: 'NorthWest', bearing: 315, range: [292.5, 337.5] }
  ]
  
  console.log(`🧭 Analyzing streets in cardinal directions with frontal view priority...`)
  
  for (const direction of directions) {
    let bestStreet = null
    let bestScore = 0
    let minDistance = Infinity
    
    // Find best street in this direction (prioritizing frontal streets)
    for (const street of streets) {
      const bearing = calculateBearing(poiLat, poiLng, street.closestPoint.lat, street.closestPoint.lng)
      
      // Check if street is in this cardinal direction
      const isInDirection = isInBearingRange(bearing, [direction.range[0], direction.range[1]])
      
      if (isInDirection && street.distance >= 25 && street.distance <= 80) {
        // Prioritize closer streets and higher confidence
        const score = street.confidence / Math.max(1, street.distance / 10)
        
        if (score > bestScore || (score === bestScore && street.distance < minDistance)) {
          bestStreet = street
          bestScore = score
          minDistance = street.distance
        }
      }
    }
    
    if (bestStreet) {
      const hasVisibility = boundaryCoordinates 
        ? await checkVisibilityToPOI(bestStreet.closestPoint, boundaryCoordinates, poiLat, poiLng)
        : true // If no boundary, assume visibility
        
      if (hasVisibility) {
        const bearing = calculateBearing(bestStreet.closestPoint.lat, bestStreet.closestPoint.lng, poiLat, poiLng)
        
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
        })
        
        console.log(`✅ ${direction.name}: ${bestStreet.name} at ${bestStreet.distance.toFixed(1)}m`)
      }
    }
  }
  
  return triggerPoints
}

// Helper function to check if bearing is in range
function isInBearingRange(bearing: number, range: [number, number]): boolean {
  const [start, end] = range
  if (start <= end) {
    return bearing >= start && bearing <= end
  } else {
    // Handle wrap-around (e.g., North: 337.5 to 22.5)
    return bearing >= start || bearing <= end
  }
}

// ========================================
// DATABASE INTEGRATION FUNCTIONS
// ========================================

// Save POI confidence score to database
async function savePOIConfidenceScore(supabase: any, poiId: string, confidenceScore: number, boundarySource: string) {
  try {
    console.log(`💾 Saving POI confidence score: ${confidenceScore} (source: ${boundarySource})`)
    
    const { error } = await supabase
      .from('description_scores')
      .upsert({
        attraction_id: poiId,
        confidence_score: confidenceScore,
        boundary_source: boundarySource,
        updated_at: new Date().toISOString()
      })
    
    if (error) {
      console.error('❌ Error saving POI confidence score:', error)
      return { success: false, error: error.message }
    }
    
    console.log('✅ POI confidence score saved successfully')
    return { success: true }
    
  } catch (error) {
    console.error('❌ Error in savePOIConfidenceScore:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Enrich attraction with OSM data
async function enrichAttractionWithOSMData(supabase: any, poiId: string, boundary: any, osmData?: any) {
  try {
    console.log(`💾 Enriching attraction ${poiId} with OSM data`)
    
    const enrichmentData = {
      osm_boundary: boundary,
      osm_data: osmData || {},
      osm_enriched_at: new Date().toISOString(),
      boundary_confidence: boundary.confidence,
      boundary_source: boundary.source
    }
    
    const { error } = await supabase
      .from('attractions')
      .update(enrichmentData)
      .eq('id', poiId)
    
    if (error) {
      console.error('❌ Error enriching attraction with OSM data:', error)
      return { success: false, error: error.message }
    }
    
    console.log('✅ Attraction enriched with OSM data successfully')
    return { success: true }
    
  } catch (error) {
    console.error('❌ Error in enrichAttractionWithOSMData:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Calculate comprehensive POI confidence score
function calculatePOIConfidenceScore(boundary: any, triggerPoints: any[], boundarySource: string, landmarkInfo?: any): number {
  let score = 0.5 // Base score
  
  // Boundary confidence contribution (40% of total)
  score += (boundary.confidence || 0.5) * 0.4
  
  // Boundary source bonus
  const sourceBonus = {
    'osm_nominatim': 0.3,
    'osm_reverse_geocoding': 0.25,
    'osm_nearby': 0.2,
    'unified_overpass': 0.15,
    'estimated': 0.0
  }
  score += sourceBonus[boundarySource] || 0.0
  
  // Trigger points quality (30% of total)
  if (triggerPoints.length > 0) {
    const avgTriggerConfidence = triggerPoints.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPoints.length
    score += avgTriggerConfidence * 0.3
  }
  
  // Trigger points quantity bonus (10% of total)
  const quantityBonus = Math.min(triggerPoints.length / 10, 0.1)
  score += quantityBonus
  
  // Landmark bonus (20% of total)
  if (landmarkInfo?.isHighVisibility) {
    score += 0.2
  }
  
  return Math.max(0.1, Math.min(1.0, score))
}

// Generate optimal trigger points based on boundary (LEGACY FALLBACK METHOD)
async function generateOptimalTriggerPoints(boundary: any, poiLat: number, poiLng: number, poiName: string) {
  console.log('🎯 Generating optimal trigger points from boundary')
  
  const triggerPoints = []
  const coordinates = boundary.coordinates

  // Strategy: Points along polygon edges, offset outward for street positioning
  for (let i = 0; i < coordinates.length - 1; i += Math.max(1, Math.floor(coordinates.length / 12))) {
    const point = coordinates[i]
    
    // Offset point outward from POI center to position on nearby streets
    const offsetPoint = offsetPointFromCenter(point.lat, point.lng, poiLat, poiLng, 75) // 75m offset
    
    const distance = calculateDistance(poiLat, poiLng, offsetPoint.lat, offsetPoint.lng)
    const bearing = calculateBearing(offsetPoint.lat, offsetPoint.lng, poiLat, poiLng)
    
    // Check visibility
    const hasVisibility = await checkVisibilityToPOI(offsetPoint, coordinates, poiLat, poiLng)
    
    if (hasVisibility) {
      // Determine priority based on position
      const type = i < 4 ? 'primary' : i < 8 ? 'secondary' : 'fallback'
      
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
      })
    }
  }

  console.log(`✅ Generated ${triggerPoints.length} optimal trigger points`)
  return triggerPoints.slice(0, 15) // Limit to 15 best points
}

// Helper function to offset point from center
function offsetPointFromCenter(pointLat: number, pointLng: number, centerLat: number, centerLng: number, offsetMeters: number) {
  // Calculate bearing from center to point
  const bearing = calculateBearing(centerLat, centerLng, pointLat, pointLng)
  
  // Calculate new point at offset distance
  const R = 6371000 // Earth radius in meters
  const lat1 = pointLat * Math.PI / 180
  const lng1 = pointLng * Math.PI / 180
  const d = offsetMeters / R
  const brng = bearing * Math.PI / 180
  
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng))
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  
  return {
    lat: lat2 * 180 / Math.PI,
    lng: lng2 * 180 / Math.PI
  }
}

// ========================================
// MAIN EDGE FUNCTION HANDLER
// ========================================

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Check authorization (same as store-poi-audio that always works)
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { 
          status: 401, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Parse request body
    const { poi_id, lat, lng, name } = await req.json()

    if (!poi_id || !lat || !lng || !name) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: poi_id, lat, lng, name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🎯 Starting trigger points generation for POI: ${name} (${lat}, ${lng})`)

    // ========================================
    // 🚀 EXECUTE LEGACY TRIGGER POINTS LOGIC (COMPLETE)
    // ========================================
    
    console.log(`🌍 OSM boundary detection for: ${name}`)

    // FIRST: Check if this is a high-visibility landmark (affects all strategies)
    const landmarkInfo = await checkHighVisibilityLandmark(lat, lng, 0)
    console.log(`🔍 Landmark detection result: isHighVisibility=${landmarkInfo.isHighVisibility}`)
    if (landmarkInfo.isHighVisibility) {
      console.log(`🗿 High-visibility landmark detected: ${landmarkInfo.elevationDiff}m elevation diff, max range: ${landmarkInfo.maxRange}m`)
    } else {
      console.log(`🏙️ Regular POI with urban density-based range: ${landmarkInfo.maxRange}m`)
    }

    // Strategy 1: Search by name (PRIORITY - more precise) - usando hierarquia do monólito
    console.log(`🔍 Step 1: Searching OSM by name for ${name}`)
    const nameSearchResult = await searchOSMByName(lat, lng, name, landmarkInfo)
    let boundary = null
    let boundarySource = 'estimated'
    
    if (nameSearchResult.success && nameSearchResult.boundary) {
      console.log('✅ Found precise boundary from OSM Nominatim')
      boundary = nameSearchResult.boundary
      boundarySource = 'osm_nominatim'
    } else {
      console.log('⚠️ OSM name search failed, trying coordinates...')
      
      // Strategy 2: Reverse geocoding by coordinates
      const coordResult = await searchOSMByCoordinates(lat, lng)
      if (coordResult.success && coordResult.boundary) {
        console.log('✅ Found boundary by coordinates')
        boundary = coordResult.boundary
        boundarySource = 'osm_reverse_geocoding'
      } else {
        console.log('⚠️ OSM coordinates search failed, trying nearby features...')
        
        // Strategy 3: Search nearby features
        const nearbyResult = await searchOSMNearbyFeatures(lat, lng, name)
        if (nearbyResult.success && nearbyResult.boundary) {
          console.log('✅ Found boundary by nearby features')
          boundary = nearbyResult.boundary
          boundarySource = 'osm_nearby'
        } else {
          console.log('⚠️ OSM nearby features failed, trying unified Overpass...')
          
          // Strategy 4: UNIFIED Overpass API (boundaries + streets in ONE call)
          console.log('🔄 Making UNIFIED Overpass API call for all POI data...')
          const unifiedData = await queryUnifiedOverpassData(lat, lng, name, landmarkInfo)
          
          // Process boundaries from unified data
          let nearbyFeaturesResult: any = null
          if (unifiedData.boundaries.length > 0) {
            nearbyFeaturesResult = await processBoundariesFromUnifiedData(unifiedData.boundaries, lat, lng, name)
            
            if (nearbyFeaturesResult.success && nearbyFeaturesResult.boundary) {
              console.log('✅ Found boundary from unified Overpass data')
              boundary = nearbyFeaturesResult.boundary
              boundarySource = 'unified_overpass'
            }
          }
          
          if (!boundary) {
            console.log('⚠️ All OSM strategies failed, using estimated boundary...')
            
            // Final Fallback: Use estimated boundary
            boundary = createEstimatedBoundary(lat, lng, name)
            boundarySource = 'estimated'
            console.log(`📐 Using estimated boundary: ${boundary.area_m2.toFixed(0)}m² area, confidence: ${boundary.confidence}`)
          }
        }
      }
    }
    
    if (!boundary) {
      return new Response(
        JSON.stringify({ error: 'Failed to detect POI boundary' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`🎯 Step 2: Generating trigger points`)
    
    // Step 2: Generate trigger points using enhanced legacy logic
    let triggerPoints = await generateStreetBasedTriggerPoints(boundary, lat, lng, name, landmarkInfo)
    
    console.log(`✅ Generated ${triggerPoints.length} trigger points`)
    
    // CRITICAL LEGACY LOGIC: If no very close TPs were found (all > 80m), supplement with immediate streets
    const veryCloseTPs = triggerPoints.filter(tp => tp.distance_from_poi <= 80)
    if (veryCloseTPs.length === 0) {
      console.log(`⚠️ No very close TPs found (all > 80m) - supplementing with immediate street analysis`)
      
      try {
        const immediateStreets = await findImmediateStreets(lat, lng)
        if (immediateStreets && immediateStreets.length > 0) {
          const immediateTPs = await generateDirectionalTriggerPoints(lat, lng, immediateStreets, boundary.coordinates)
          
          // Mark these as supplementary and merge with existing TPs
          const supplementaryTPs = immediateTPs.map(tp => ({
            ...tp,
            reasoning: tp.reasoning + ' (supplementary close TP)',
            type: (tp.distance_from_poi <= 50 ? 'primary' : 'secondary') as 'primary' | 'secondary'
          }))
          
          triggerPoints = [...supplementaryTPs, ...triggerPoints]
          console.log(`✅ Added ${supplementaryTPs.length} supplementary close TPs`)
        }
      } catch (error) {
        console.error('⚠️ Error generating immediate TPs (non-critical):', error)
      }
    } else {
      console.log(`✅ Found ${veryCloseTPs.length} very close TPs (≤80m), no supplementary analysis needed`)
    }
    
    // Step 3: Calculate comprehensive POI confidence score
    const poiConfidenceScore = calculatePOIConfidenceScore(boundary, triggerPoints, boundarySource, landmarkInfo)
    console.log(`📊 POI Confidence Score: ${(poiConfidenceScore * 100).toFixed(1)}%`)
    
    // Step 4: Save to database (optional - for data persistence)
    try {
      await savePOIConfidenceScore(supabase, poi_id, poiConfidenceScore, boundarySource)
      await enrichAttractionWithOSMData(supabase, poi_id, boundary, { landmarkInfo, boundarySource })
      console.log('💾 Database updates completed successfully')
    } catch (dbError) {
      console.error('⚠️ Database save failed (non-critical):', dbError)
      // Continue execution - database save is optional
    }
    
    // Calculate overall confidence for response
    const avgConfidence = triggerPoints.length > 0 
      ? triggerPoints.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPoints.length
      : boundary.confidence
    
    const result = {
      poi_id,
      trigger_points: triggerPoints,
      boundary: {
        coordinates: boundary.coordinates,
        area_m2: boundary.area_m2,
        perimeter_m: boundary.perimeter_m,
        confidence: boundary.confidence,
        source: boundarySource
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
        database_saved: true,
        processing_time_ms: Date.now() - Date.now() // Will be calculated properly
      }
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('❌ Error in trigger points generation:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
