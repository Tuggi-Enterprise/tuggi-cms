/**
 * Boundary Detection Service
 * 
 * Modular service for detecting POI boundaries from OpenStreetMap data
 * Extracted from the monolithic route for reusability
 */

// Types
export interface BoundaryCoordinate {
  lat: number
  lng: number
}

export interface BoundaryResult {
  success: boolean
  boundary?: {
    type: 'polygon' | 'circle'
    coordinates: BoundaryCoordinate[]
    area_m2: number
    perimeter_m: number
    confidence: number
    center?: BoundaryCoordinate
    source: 'osm_name' | 'osm_coordinates' | 'osm_nearby' | 'estimated'
  }
  trigger_points?: any[]
  processing_notes?: string
  error?: string
}

export interface SearchResult {
  success: boolean
  boundary?: BoundaryResult['boundary']
  error?: string
}

// Utility Functions
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

export function calculatePolygonArea(coordinates: BoundaryCoordinate[]): number {
  let area = 0
  const n = coordinates.length - 1
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += coordinates[i].lat * coordinates[j].lng
    area -= coordinates[j].lat * coordinates[i].lng
  }
  
  area = Math.abs(area) / 2
  
  // Convert to meters²
  const metersPerDegree = 111000
  return Math.round(area * metersPerDegree * metersPerDegree)
}

export function calculatePolygonPerimeter(coordinates: BoundaryCoordinate[]): number {
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

export function calculatePolygonCenter(coordinates: BoundaryCoordinate[]): BoundaryCoordinate {
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

export function convertOSMPolygon(coordinates: number[][]): BoundaryCoordinate[] {
  return coordinates.map(coord => ({
    lat: coord[1], // OSM uses [lng, lat] format
    lng: coord[0]
  }))
}

// Core Boundary Detection Functions
export class BoundaryDetectionService {
  
  /**
   * Main boundary detection method
   * Tries multiple strategies to find POI boundaries
   */
  static async detectBoundary(
    lat: number, 
    lng: number, 
    name: string,
    landmarkInfo?: any
  ): Promise<BoundaryResult> {
    console.log(`🌍 OSM boundary detection for: ${name}`)

    try {
      // Strategy 1: Search by name
      const nameResult = await this.searchOSMByName(lat, lng, name, landmarkInfo)
      if (nameResult.success && nameResult.boundary) {
        console.log(`✅ Found boundary by name search`)
        return {
          success: true,
          boundary: { ...nameResult.boundary, source: 'osm_name' }
        }
      }

      // Strategy 2: Reverse geocoding by coordinates
      const coordResult = await this.searchOSMByCoordinates(lat, lng)
      if (coordResult.success && coordResult.boundary) {
        console.log(`✅ Found boundary by coordinates`)
        return {
          success: true,
          boundary: { ...coordResult.boundary, source: 'osm_coordinates' }
        }
      }

      // Strategy 3: Search nearby features
      const nearbyResult = await this.searchOSMNearbyFeatures(lat, lng, name)
      if (nearbyResult.success && nearbyResult.boundary) {
        console.log(`✅ Found boundary by nearby features`)
        return {
          success: true,
          boundary: { ...nearbyResult.boundary, source: 'osm_nearby' }
        }
      }

      // No OSM boundaries found - let the main route handle fallback
      console.log(`⚠️ No OSM boundaries found`)
      
      return {
        success: false,
        error: 'No OSM boundaries found',
        processing_notes: 'All OSM strategies failed'
      }

    } catch (error) {
      console.error('❌ Boundary detection error:', error)
      return {
        success: false,
        error: `Boundary detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Strategy 1: Search OSM by POI name
   */
  static async searchOSMByName(
    lat: number, 
    lng: number, 
    name: string, 
    landmarkInfo?: any
  ): Promise<SearchResult> {
    try {
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
      console.log(`🔍 Variations: ${uniqueVariations.join(', ')}`)

      // Try each variation until we find results
      for (const searchTerm of uniqueVariations) {
        console.log(`🔍 Trying search term: "${searchTerm}"`)
        
        const searchUrl = `https://nominatim.openstreetmap.org/search?` +
          `q=${encodeURIComponent(searchTerm)}&` +
          `format=json&` +
          `polygon_geojson=1&` +
          `addressdetails=1&` +
          `limit=5&` +
          `bounded=1&` +
          `viewbox=${lng-0.01},${lat+0.01},${lng+0.01},${lat-0.01}`

        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'TuggiCMS/1.0 (poi-boundary-detection)'
          }
        })

        if (!response.ok) {
          console.log(`⚠️ Search failed for "${searchTerm}": ${response.status}`)
          continue
        }

        const results = await response.json()
        console.log(`🔍 Nominatim found ${results.length} results for "${searchTerm}"`)

        if (results && results.length > 0) {
          // Score and filter results for this search term
          const scoredResults = results
            .filter(result => result.geojson && (result.geojson.type === 'Polygon' || result.geojson.type === 'MultiPolygon'))
            .map(result => {
              const resultLat = parseFloat(result.lat)
              const resultLng = parseFloat(result.lon)
              const distance = calculateDistance(lat, lng, resultLat, resultLng)
              
              // Enhanced scoring for landmarks
              let score = this.calculateRelevanceScore(result, distance, name, landmarkInfo)
              
              return { ...result, distance, score }
            })
            .filter(result => result.score > 0.3) // Lowered threshold
            .sort((a, b) => b.score - a.score)

          if (scoredResults.length > 0) {
            // Process the best result from this search term
            const bestResult = scoredResults[0]
            console.log(`🏆 Best result for "${searchTerm}": ${bestResult.display_name} (score: ${bestResult.score.toFixed(2)}, distance: ${bestResult.distance.toFixed(0)}m)`)

            const processedGeometry = await this.processOSMGeometry(bestResult.geojson, lat, lng)
            if (processedGeometry.success && processedGeometry.boundary) {
              console.log(`✅ Successfully found POI boundary using search term: "${searchTerm}"`)
              return {
                success: true,
                boundary: processedGeometry.boundary
              }
            }
          }
        }
        
        // Add delay between requests to be respectful to OSM
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // If we get here, no search term found suitable results
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

  /**
   * Strategy 2: Reverse geocoding by coordinates
   */
  static async searchOSMByCoordinates(lat: number, lng: number): Promise<SearchResult> {
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

        // SEM SUPOSIÇÕES: Aceitar qualquer polígono válido encontrado nas coordenadas
        console.log(`📍 BOUNDARY ENCONTRADO POR COORDENADAS:`)
        console.log(`   📐 Área: ${area_m2}m² | Perímetro: ${perimeter_m}m`)
        console.log(`   🏷️ OSM Type: ${data.type} | Category: ${data.category}`)
        console.log(`   📍 Display: ${data.display_name}`)
        
        // Apenas validação mínima para evitar polígonos inválidos (< 10m²)
        if (area_m2 < 10) {
          console.log(`⚠️ REJEITANDO: Polígono inválido (${area_m2}m²) - muito pequeno para ser real`)
          return { success: false, error: 'Invalid polygon geometry' }
        }
        
        // Confiança moderada para reverse geocoding (sem suposições sobre tamanho)
        const confidence = 0.7 // Confiança razoável - é o que está realmente nas coordenadas
        
        console.log(`✅ BOUNDARY ACEITO: Área ${area_m2}m² | Confiança: ${confidence}`)

        return {
          success: true,
          boundary: {
            type: 'polygon' as const,
            coordinates,
            area_m2,
            perimeter_m,
            confidence
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

  /**
   * Strategy 3: Search nearby features using Overpass API
   */
  static async searchOSMNearbyFeatures(lat: number, lng: number, name: string): Promise<SearchResult> {
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
          const coordinates: BoundaryCoordinate[] = element.geometry.map((node: any) => ({
            lat: node.lat,
            lng: node.lon
          }))

          const area = calculatePolygonArea(coordinates)
          const center = calculatePolygonCenter(coordinates)
          const distance = calculateDistance(lat, lng, center.lat, center.lng)

          // Calculate relevance score
          let relevanceScore = this.calculateFeatureRelevance(element.tags || {}, name)

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
            confidence: Math.min(0.8, mainPolygon.relevanceScore / 10)
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

  /**
   * Strategy 4: Create estimated boundary as fallback
   */
  static createEstimatedBoundary(lat: number, lng: number, name: string) {
    console.log('📐 Creating estimated boundary as fallback')
    
    // Create a circular boundary based on POI type
    let radius = 50 // Default radius in meters
    
    // Adjust radius based on name patterns
    const lowerName = name.toLowerCase()
    if (lowerName.includes('parque') || lowerName.includes('park')) {
      radius = 200
    } else if (lowerName.includes('praia') || lowerName.includes('beach')) {
      radius = 300
    } else if (lowerName.includes('museu') || lowerName.includes('museum')) {
      radius = 80
    } else if (lowerName.includes('igreja') || lowerName.includes('church') || lowerName.includes('cathedral')) {
      radius = 60
    }

    const coordinates = this.createCircularBoundary(lat, lng, radius)
    const area_m2 = Math.PI * radius * radius
    const perimeter_m = 2 * Math.PI * radius

    return {
      type: 'circle' as const,
      coordinates,
      area_m2: Math.round(area_m2),
      perimeter_m: Math.round(perimeter_m),
      confidence: 0.3,
      center: { lat, lng }
    }
  }

  // Helper Methods
  static createCircularBoundary(centerLat: number, centerLng: number, radiusMeters: number): BoundaryCoordinate[] {
    const points: BoundaryCoordinate[] = []
    const numPoints = 16 // Circle with 16 points
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i * 2 * Math.PI) / numPoints
      
      // Convert radius to degrees (approximate)
      const radiusLat = radiusMeters / 111000 // 1 degree ≈ 111km
      const radiusLng = radiusMeters / (111000 * Math.cos(centerLat * Math.PI / 180))
      
      const lat = centerLat + radiusLat * Math.cos(angle)
      const lng = centerLng + radiusLng * Math.sin(angle)
      
      points.push({ lat, lng })
    }
    
    // Close the polygon
    points.push(points[0])
    
    return points
  }

  static async processOSMGeometry(geojson: any, poiLat: number, poiLng: number): Promise<SearchResult> {
    try {
      let allCoordinates: BoundaryCoordinate[] = []
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
        const polygonParts: BoundaryCoordinate[][] = []
        
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
            confidence: 0.85
          }
        }
      }
      
      return { success: false, error: 'No valid geometry found' }
      
    } catch (error) {
      return { 
        success: false, 
        error: `Geometry processing error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }
    }
  }

  static calculateRelevanceScore(result: any, distance: number, searchName: string, landmarkInfo?: any): number {
    let score = 0
    
    // Distance scoring (closer = better)
    if (distance <= 100) score += 2.0
    else if (distance <= 300) score += 1.5
    else if (distance <= 500) score += 1.0
    else if (distance <= 1000) score += 0.5
    else score -= 0.5
    
    // Name similarity
    if (result.display_name && result.display_name.toLowerCase().includes(searchName.toLowerCase())) {
      score += 1.5
    }
    
    // Type scoring
    if (result.type === 'relation') score += 0.3
    if (result.class === 'leisure') score += 0.2
    if (result.class === 'tourism') score += 0.2
    if (result.class === 'amenity') score += 0.1
    
    // Landmark boost
    if (landmarkInfo?.isHighVisibility) {
      score *= 1.5
      // More lenient distance for landmarks
      if (distance <= landmarkInfo.maxRange) {
        score += 1.0
      }
    }
    
    return score
  }

  static calculateFeatureRelevance(tags: any, searchName: string): number {
    let relevanceScore = 0
    
    // Base relevance by type
    if (tags.building) relevanceScore += 2
    if (tags.leisure === 'park') relevanceScore += 5
    if (tags.leisure === 'garden') relevanceScore += 4
    if (tags.amenity === 'place_of_worship') relevanceScore += 3
    if (tags.tourism === 'attraction') relevanceScore += 4
    if (tags.tourism === 'museum') relevanceScore += 3
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
}
