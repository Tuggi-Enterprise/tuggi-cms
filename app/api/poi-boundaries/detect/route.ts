
import { NextRequest, NextResponse } from 'next/server'

interface POIBoundaryRequest {
  attraction_id: string
  poi_lat: number
  poi_lng: number
  poi_name: string
}

interface BoundaryResult {
  success: boolean
  boundary?: {
    type: 'polygon' | 'circle'
    coordinates: Array<{lat: number, lng: number}>
    area_m2: number
    perimeter_m: number
    confidence: number
  }
  trigger_points?: Array<{
    lat: number
    lng: number
    type: 'primary' | 'secondary' | 'fallback'
    reasoning: string
    confidence: number
    distance_from_poi: number
    expected_bearing: number
    radius_meters: number
  }>
  poi_confidence_score?: {
    overall_score: number
    boundary_quality: number
    trigger_points_quality: number
    data_source_reliability: number
    coverage_completeness: number
    factors: {
      boundary_source: string
      boundary_precision: number
      tp_count: number
      tp_distribution: number
      visibility_coverage: number
      landmark_bonus: number
    }
  }
  error?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: POIBoundaryRequest = await request.json()
    let { attraction_id, poi_lat, poi_lng, poi_name } = body

    // If only attraction_id is provided, fetch POI data from database
    if (attraction_id && (!poi_lat || !poi_lng || !poi_name)) {
      console.log(`🔍 Fetching POI data from database for ID: ${attraction_id}`)
      
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      const { data: poiData, error: poiError } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          attraction_coordinate!left(latitude, longitude)
        `)
        .eq('id', attraction_id)
        .single()

      if (poiError || !poiData) {
        return NextResponse.json({ 
          success: false, 
          error: `POI not found: ${poiError?.message || 'Unknown error'}` 
        })
      }

      if (!poiData.attraction_coordinate || poiData.attraction_coordinate.length === 0) {
        return NextResponse.json({ 
          success: false, 
          error: 'POI has no coordinates' 
        })
      }

      const coordinate = poiData.attraction_coordinate[0]
      poi_lat = coordinate.latitude
      poi_lng = coordinate.longitude
      poi_name = poiData.name

      console.log(`✅ POI data loaded: ${poi_name} at (${poi_lat}, ${poi_lng})`)
    }

    if (!poi_lat || !poi_lng || !poi_name) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required parameters: poi_lat, poi_lng, poi_name or attraction_id' 
      })
    }

    console.log(`🌍 OSM boundary detection for: ${poi_name}`)

    // FIRST: Check if this is a high-visibility landmark (affects all strategies)
    const landmarkInfo = await checkHighVisibilityLandmark(poi_lat, poi_lng, 0)
    if (landmarkInfo.isHighVisibility) {
      console.log(`🗿 High-visibility landmark detected: ${landmarkInfo.elevationDiff}m elevation diff, max range: ${landmarkInfo.maxRange}m`)
    }

    // Strategy 1: Search by name near coordinates using OSM Nominatim (PRIORITY - more precise)
    const nameSearchResult = await searchOSMByName(poi_lat, poi_lng, poi_name, landmarkInfo)
    if (nameSearchResult.success && 'boundary' in nameSearchResult && nameSearchResult.boundary) {
      console.log('✅ Found precise boundary from OSM Nominatim')
      
      // Generate street-based trigger points with landmark info
      let streetTriggerPoints = await generateStreetBasedTriggerPoints(
        'boundary' in nameSearchResult ? nameSearchResult.boundary : null!, 
        poi_lat, 
        poi_lng, 
        poi_name,
        landmarkInfo
      )
      
      // If no very close TPs were found (all > 80m), supplement with immediate streets like fallback system
      const veryCloseTPs = streetTriggerPoints.filter(tp => tp.distance_from_poi <= 80)
      if (veryCloseTPs.length === 0) {
        console.log(`⚠️ No very close TPs found (all > 80m) - supplementing with immediate street analysis`)
        
        try {
          const immediateStreets = await findImmediateStreets(poi_lat, poi_lng)
          if (immediateStreets && immediateStreets.length > 0) {
            const immediateTPs = await generateDirectionalTriggerPoints(poi_lat, poi_lng, immediateStreets)
            
            // Mark these as supplementary and merge with existing TPs
            const supplementaryTPs = immediateTPs.map(tp => ({
              ...tp,
              reasoning: tp.reasoning + ' (supplementary close TP)',
              type: tp.distance_from_poi <= 50 ? 'primary' : 'secondary'
            }))
            
            streetTriggerPoints = [...supplementaryTPs, ...streetTriggerPoints]
            console.log(`✅ Added ${supplementaryTPs.length} supplementary close TPs`)
          }
        } catch (error) {
          console.log(`⚠️ Could not add supplementary TPs: ${error}`)
        }
      }
      
      // Calculate POI confidence score
      const poiConfidenceScore = calculatePOIConfidenceScore(
        'boundary' in nameSearchResult ? nameSearchResult.boundary : null,
        streetTriggerPoints,
        'osm_nominatim',
        landmarkInfo
      )
      
      return NextResponse.json({
        success: true,
        boundary: 'boundary' in nameSearchResult ? nameSearchResult.boundary : null!,
        trigger_points: streetTriggerPoints,
        source: 'osm_nominatim',
        poi_confidence_score: poiConfidenceScore
      } as BoundaryResult)
    }

    // Check if POI was completely not found in OSM
    if (nameSearchResult.error && nameSearchResult.error.includes('No suitable polygons found by name')) {
      console.log('❌ POI not found in OpenStreetMap - trying fallback street analysis')
      
      // Fallback Strategy: Analyze nearby streets and create minimal boundary
      const fallbackResult = await createFallbackBoundaryFromStreets(poi_lat, poi_lng, poi_name, landmarkInfo)
      
      if (fallbackResult.success && fallbackResult.boundary && fallbackResult.trigger_points) {
        console.log(`✅ Created fallback boundary and ${fallbackResult.trigger_points.length} trigger points from nearby streets`)
        
        // Calculate POI confidence score
        const poiConfidenceScore = calculatePOIConfidenceScore(
          fallbackResult.boundary,
          fallbackResult.trigger_points,
          'fallback_street_analysis',
          landmarkInfo
        )
        
        return NextResponse.json({
          success: true,
          boundary: {
            ...fallbackResult.boundary,
            type: 'polygon' as const
          },
          trigger_points: fallbackResult.trigger_points,
          source: 'fallback_street_analysis',
          poi_name: poi_name,
          note: 'POI not found in OSM - generated boundary from nearby street analysis',
          poi_confidence_score: poiConfidenceScore
        } as BoundaryResult)
      }
      
      // If fallback also fails, return error
      console.log('❌ Both OSM search and fallback street analysis failed')
      return NextResponse.json({
        success: false,
        error: `POI "${poi_name}" not found in OpenStreetMap and no suitable nearby streets found for fallback analysis.`,
        poi_name: poi_name,
        coordinates: { lat: poi_lat, lng: poi_lng },
        suggestion: 'This location may be in a very remote area or have incorrect coordinates.'
      })
    }

    // Strategy 2: Search for multiple nearby features using Overpass API (COMPLEMENTARY - for complex areas like parks)
    // Only proceed if we had partial matches but need more comprehensive boundary data
    console.log('🔄 Trying complementary Overpass API search for complex area boundaries...')
    const nearbyFeaturesResult = await searchOSMNearbyFeatures(poi_lat, poi_lng, poi_name)
    if (nearbyFeaturesResult.success && nearbyFeaturesResult.boundary) {
      console.log('✅ Found enhanced boundary from OSM Overpass API (complementary search)')
      
      // Generate street-based trigger points
      const streetTriggerPoints = await generateStreetBasedTriggerPoints(
        nearbyFeaturesResult.boundary, 
        poi_lat, 
        poi_lng, 
        poi_name,
        landmarkInfo
      )
      
      // Calculate POI confidence score
      const poiConfidenceScore = calculatePOIConfidenceScore(
        nearbyFeaturesResult.boundary,
        streetTriggerPoints,
        'osm_overpass',
        landmarkInfo
      )
      
      return NextResponse.json({
        success: true,
        boundary: nearbyFeaturesResult.boundary,
        trigger_points: streetTriggerPoints,
        source: 'osm_overpass',
        poi_confidence_score: poiConfidenceScore
      } as BoundaryResult)
    }

    // Strategy 3: Reverse geocoding to find features at coordinates (FALLBACK)
    const reverseGeoResult = await searchOSMByCoordinates(poi_lat, poi_lng)
    if (reverseGeoResult.success && reverseGeoResult.boundary) {
      console.log('✅ Found boundary from OSM reverse geocoding')
      const triggerPoints = await generateOptimalTriggerPoints(reverseGeoResult.boundary, poi_lat, poi_lng, poi_name)
      
      // Calculate POI confidence score
      const poiConfidenceScore = calculatePOIConfidenceScore(
        reverseGeoResult.boundary,
        triggerPoints,
        'osm_reverse_geocoding',
        landmarkInfo
      )
      
      return NextResponse.json({
        success: true,
        boundary: reverseGeoResult.boundary,
        trigger_points: triggerPoints,
        poi_confidence_score: poiConfidenceScore
      } as BoundaryResult)
    }

    // Fallback: Create estimated boundary if OSM fails
    console.log('⚠️ OSM failed, using estimated boundary')
    const estimatedBoundary = createEstimatedBoundary(poi_lat, poi_lng, poi_name)
    const triggerPoints = await generateOptimalTriggerPoints(estimatedBoundary, poi_lat, poi_lng, poi_name)

    // Calculate POI confidence score
    const poiConfidenceScore = calculatePOIConfidenceScore(
      estimatedBoundary,
      triggerPoints,
      'estimated_boundary',
      landmarkInfo
    )
    
    return NextResponse.json({
      success: true,
      boundary: estimatedBoundary,
      trigger_points: triggerPoints,
      poi_confidence_score: poiConfidenceScore
    } as BoundaryResult)

  } catch (error) {
    console.error('❌ Error in boundary detection:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as BoundaryResult, { status: 500 })
  }
}

// Helper function to process OSM geometry (Polygon or MultiPolygon)
async function processOSMGeometry(geojson: any, poiLat: number, poiLng: number) {
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
      const polygonParts: Array<Array<{lat: number, lng: number}>> = []
      
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
        
        // Add points from smaller polygons to create a more complete boundary
        allCoordinates = [...largestPolygon]
        
        // Add key points from other polygons to fill gaps
        for (const otherPolygon of polygonParts) {
          if (otherPolygon !== largestPolygon) {
            // Add every 3rd point from smaller polygons to avoid overcrowding
            for (let i = 0; i < otherPolygon.length; i += 3) {
              allCoordinates.push(otherPolygon[i])
            }
          }
        }
        
        console.log(`✅ Combined ${polygonParts.length} polygon parts into boundary`)
      }
    }
    
    if (allCoordinates.length > 0) {
      return {
        success: true,
        boundary: {
          type: 'polygon' as const,
          coordinates: allCoordinates,
          area_m2: totalArea,
          perimeter_m: totalPerimeter,
          confidence: 0.95
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

// OSM Strategy 1: Search by name (IMPROVED - prioritizes precise matches)
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
    
    // Build search variations optimized for different POI types
    const searchVariations = []
    
    // For buildings (like Copan)
    if (name.toLowerCase().includes('edifício') || name.toLowerCase().includes('building') || name.toLowerCase().includes('copan')) {
      searchVariations.push(
        name, // Original name
        name.replace(/edifício\s+/gi, ''), // Remove "Edifício" prefix
        name.split(' ').pop(), // Last word (e.g., "Copan")
        `"${name}"` // Exact phrase
      )
    }
    // For parks (like Ibirapuera)
    else if (name.toLowerCase().includes('parque') || name.toLowerCase().includes('park')) {
      searchVariations.push(
        name,
        name.replace(/parque/gi, 'park'),
        name.replace(/park/gi, 'parque'),
        name.split(' ').pop(), // Last word
        `"${name}"`
      )
    }
    // Generic approach
    else {
      searchVariations.push(
        name,
        name.split(' ')[0], // First word
        `"${name}"`
      )
    }

    for (const searchTerm of searchVariations) {
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
        
        // Score and rank results for best match
        const scoredResults = data
          .filter((result: any) => result.geojson && (result.geojson.type === 'Polygon' || result.geojson.type === 'MultiPolygon'))
          .map((result: any) => {
            const resultLat = parseFloat(result.lat)
            const resultLng = parseFloat(result.lon)
            const distance = calculateDistance(lat, lng, resultLat, resultLng)
            
            // Enhanced scoring
            let nameScore = 0
            const resultName = result.display_name.toLowerCase()
            const searchName = searchTerm.toLowerCase()
            
            if (resultName.includes(searchName)) nameScore = 1.0
            else if (searchName.includes(resultName.split(',')[0].toLowerCase())) nameScore = 0.8
            else nameScore = 0.3
            
            // Distance score (different thresholds for different POI types)
            let distanceScore
            if (searchName.includes('parque') || searchName.includes('park')) {
              // Parks can be larger and further - more lenient distance scoring
              distanceScore = distance < 500 ? 1.0 : Math.max(0, (1000 - distance) / 1000)
            } else if (searchName.includes('pico') || searchName.includes('morro') || searchName.includes('cristo') || landmark.isHighVisibility) {
              // Landmarks can be even further due to their nature - very lenient scoring
              distanceScore = distance < 1000 ? 1.0 : Math.max(0, (2000 - distance) / 2000)
            } else {
              // Buildings need to be very close
              distanceScore = distance < 100 ? 1.0 : Math.max(0, (200 - distance) / 200)
            }
            
            // Type relevance
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
            
            console.log(`📊 ${result.display_name.split(',')[0]} | Dist: ${Math.round(distance)}m | Score: ${totalScore.toFixed(2)}`)
            
            return { result, score: totalScore, distance }
          })
          .sort((a: any, b: any) => b.score - a.score)

        // Try the best matches first
        for (const { result, score, distance } of scoredResults) {
          if (score > 0.3) { // Adjusted threshold to allow parks with lower scores
            
            // CRITICAL: Double check distance to prevent wrong POI selection
            const maxAcceptableDistance = landmark.isHighVisibility ? 500 : 300 // Landmarks can be bit further
            if (distance > maxAcceptableDistance) {
              console.log(`⚠️ Rejecting "${result.display_name.split(',')[0]}" - too far (${Math.round(distance)}m > ${maxAcceptableDistance}m)`)
              continue // Skip this result, try next one
            }
            
            const boundaryResult = await processOSMGeometry(result.geojson, lat, lng)
            if (boundaryResult.success) {
              console.log(`🎯 Best match: "${result.display_name.split(',')[0]}" (Score: ${score.toFixed(2)}, Distance: ${Math.round(distance)}m)`)
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

    return { success: false, error: 'No suitable polygons found by name' }

  } catch (error) {
    return { 
      success: false, 
      error: `OSM name search error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

// OSM Strategy 2: Reverse geocoding
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

// OSM Strategy 3: Search nearby features using Overpass API
async function searchOSMNearbyFeatures(lat: number, lng: number, name: string) {
  try {
    console.log('🔍 Searching for multiple nearby park features with Overpass API...')
    
    // Enhanced query to find ALL park-related features in the area
    const overpassQuery = `[out:json][timeout:30];
    (
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
      
      // Named features containing "ibirapuera" (case insensitive)
      way[name~"[Ii]birapuera"](around:2000,${lat},${lng});
      relation[name~"[Ii]birapuera"](around:2000,${lat},${lng});
      
      // Areas that might be part of the park complex
      way[amenity=parking](around:1000,${lat},${lng});
      way[sport](around:1000,${lat},${lng});
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
    console.log(`📊 Overpass found ${data.elements?.length || 0} elements`)

    if (data.elements && data.elements.length > 0) {
      // Collect all valid polygons with their metadata
      const allPolygons: Array<{
        coordinates: Array<{lat: number, lng: number}>,
        area: number,
        distance: number,
        tags: any,
        relevanceScore: number
      }> = []

      for (const element of data.elements) {
        if (element.geometry && element.geometry.length >= 3) {
          const coordinates = element.geometry.map((node: any) => ({
            lat: node.lat,
            lng: node.lon
          }))

          // Close the polygon if not already closed
          const first = coordinates[0]
          const last = coordinates[coordinates.length - 1]
          if (first.lat !== last.lat || first.lng !== last.lng) {
            coordinates.push(first)
          }

          const center = calculatePolygonCenter(coordinates)
          const distance = calculateDistance(lat, lng, center.lat, center.lng)
          const area = calculatePolygonArea(coordinates)

          // Calculate relevance score based on multiple factors
          let relevanceScore = 0
          
          // Size factor (larger areas are more relevant for parks)
          if (area > 50000) relevanceScore += 3 // Large areas (>50k m²)
          else if (area > 10000) relevanceScore += 2 // Medium areas (>10k m²)
          else if (area > 1000) relevanceScore += 1 // Small areas (>1k m²)
          
          // Distance factor (closer is better)
          if (distance < 500) relevanceScore += 3
          else if (distance < 1000) relevanceScore += 2
          else if (distance < 1500) relevanceScore += 1
          
          // Tag relevance
          const tags = element.tags || {}
          if (tags.leisure === 'park') relevanceScore += 4
          if (tags.name && tags.name.toLowerCase().includes('ibirapuera')) relevanceScore += 5
          if (tags.landuse === 'recreation_ground') relevanceScore += 3
          if (tags.natural === 'water') relevanceScore += 2
          if (tags.tourism === 'attraction') relevanceScore += 2

          // Only include polygons that meet minimum criteria
          if (distance < 2000 && area > 500 && relevanceScore > 0) {
            allPolygons.push({
              coordinates,
              area,
              distance,
              tags,
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
        let allCoordinates = [...mainPolygon.coordinates]
        let totalArea = mainPolygon.area
        let totalPerimeter = calculatePolygonPerimeter(mainPolygon.coordinates)

        console.log(`🏆 Main polygon: ${mainPolygon.tags.name || mainPolygon.tags.leisure || 'unnamed'} (score: ${mainPolygon.relevanceScore})`)

        // Add strategic points from other relevant polygons to create a more complete boundary
        const additionalPolygons = allPolygons.slice(1, Math.min(6, allPolygons.length))
        
        for (const polygon of additionalPolygons) {
          if (polygon.relevanceScore >= 2) { // Only include reasonably relevant polygons
            console.log(`➕ Adding points from: ${polygon.tags.name || polygon.tags.leisure || 'unnamed'} (score: ${polygon.relevanceScore})`)
            
            // Add every 5th point from other polygons to avoid overcrowding
            for (let i = 0; i < polygon.coordinates.length; i += 5) {
              allCoordinates.push(polygon.coordinates[i])
            }
            
            // Add partial area (weighted by relevance)
            totalArea += polygon.area * (polygon.relevanceScore / 10)
          }
        }

        console.log(`✅ Combined ${Math.min(6, allPolygons.length)} polygons into enhanced boundary`)
        console.log(`📐 Total enhanced area: ${totalArea.toLocaleString()}m²`)

        return {
          success: true,
          boundary: {
            type: 'polygon' as const,
            coordinates: allCoordinates,
            area_m2: totalArea,
            perimeter_m: totalPerimeter,
            confidence: 0.85
          }
        }
      }
    }

    return { success: false, error: 'No matching features found in OSM' }

  } catch (error) {
    console.error('❌ Overpass API error:', error)
    return { 
      success: false, 
      error: `OSM feature search error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

// Fallback: Create estimated boundary
function createEstimatedBoundary(lat: number, lng: number, name: string) {
  console.log('📐 Creating estimated boundary as fallback')
  
  // Estimate radius based on name keywords
  let radius = 100 // default 100m
  
  const nameLower = name.toLowerCase()
  if (nameLower.includes('parque') || nameLower.includes('park')) radius = 200
  else if (nameLower.includes('lago') || nameLower.includes('lake')) radius = 150
  else if (nameLower.includes('shopping') || nameLower.includes('mall')) radius = 120
  else if (nameLower.includes('museu') || nameLower.includes('museum')) radius = 80
  else if (nameLower.includes('igreja') || nameLower.includes('church')) radius = 50

  // Create circular polygon
  const coordinates = []
  const numPoints = 16
  
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints
    const deltaLat = (radius * Math.cos(angle)) / 111000
    const deltaLng = (radius * Math.sin(angle)) / (111000 * Math.cos(lat * Math.PI / 180))
    
    coordinates.push({
      lat: lat + deltaLat,
      lng: lng + deltaLng
    })
  }

  const area_m2 = Math.PI * radius * radius
  const perimeter_m = 2 * Math.PI * radius

  return {
    type: 'circle' as const,
    coordinates,
    area_m2,
    perimeter_m,
    confidence: 0.6
  }
}

// Generate street-based trigger points (NEW IMPROVED METHOD)
async function generateStreetBasedTriggerPoints(boundary: any, poiLat: number, poiLng: number, poiName: string, landmarkInfo?: any) {
  console.log('🛣️ Generating street-based trigger points using Overpass API')
  
  try {
    // Find nearby streets using Overpass API (with landmark info if available)
    const nearbyStreets = await findNearbyStreetsForTriggers(poiLat, poiLng, poiName, landmarkInfo)
    console.log(`🔍 Found ${nearbyStreets.length} nearby streets for trigger points`)

    if (nearbyStreets.length === 0) {
      console.log('⚠️ No streets found, falling back to boundary-based triggers')
      return generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName)
    }

    // Generate trigger points on strategic street locations
    const streetTriggerPoints = await generateTriggersOnStreets(
      poiLat, 
      poiLng, 
      boundary.coordinates, 
      nearbyStreets,
      landmarkInfo
    )

    console.log(`✅ Generated ${streetTriggerPoints.length} street-based trigger points`)
    return streetTriggerPoints

  } catch (error) {
    console.error('❌ Error generating street-based triggers, falling back to boundary-based:', error)
    return generateOptimalTriggerPoints(boundary, poiLat, poiLng, poiName)
  }
}

// Generate optimal trigger points based on boundary (FALLBACK METHOD)
async function generateOptimalTriggerPoints(boundary: any, poiLat: number, poiLng: number, poiName: string) {
  console.log('🎯 Generating optimal trigger points from OSM boundary')
  
  const triggerPoints = []
  const coordinates = boundary.coordinates

  // Strategy: Points along polygon edges, offset outward for street positioning
  for (let i = 0; i < coordinates.length - 1; i += Math.max(1, Math.floor(coordinates.length / 12))) {
    const point = coordinates[i]
    
    // Offset point outward from POI center to position on nearby streets
    const offsetPoint = offsetPointFromCenter(point.lat, point.lng, poiLat, poiLng, 75) // 75m offset
    
    const distance = calculateDistance(poiLat, poiLng, offsetPoint.lat, offsetPoint.lng)
    const bearing = calculateBearing(offsetPoint.lat, offsetPoint.lng, poiLat, poiLng)
    
    // Determine priority based on position
    const type = i < 4 ? 'primary' : i < 8 ? 'secondary' : 'fallback'
    
    triggerPoints.push({
      lat: offsetPoint.lat,
      lng: offsetPoint.lng,
      type,
      reasoning: `Ponto estratégico ${i + 1} baseado na fronteira real do OSM`,
      confidence: 0.9,
      distance_from_poi: distance,
      expected_bearing: bearing,
      radius_meters: 20
    })
  }

  // Add strategic corner points
  const corners = findPolygonCorners(coordinates, poiLat, poiLng)
  corners.forEach((corner, index) => {
    const offsetPoint = offsetPointFromCenter(corner.lat, corner.lng, poiLat, poiLng, 100) // 100m offset
    
    const distance = calculateDistance(poiLat, poiLng, offsetPoint.lat, offsetPoint.lng)
    const bearing = calculateBearing(offsetPoint.lat, offsetPoint.lng, poiLat, poiLng)
    
    triggerPoints.push({
      lat: offsetPoint.lat,
      lng: offsetPoint.lng,
      type: 'primary',
      reasoning: `Ponto estratégico de canto ${index + 1} - máxima visibilidade`,
      confidence: 0.95,
      distance_from_poi: distance,
      expected_bearing: bearing,
      radius_meters: 20
    })
  })

  // Sort by priority and confidence
  const sortedTriggerPoints = triggerPoints.sort((a, b) => {
    const priority: { [key: string]: number } = { primary: 3, secondary: 2, fallback: 1 }
    if (a.type !== b.type) {
      return priority[b.type] - priority[a.type]
    }
    return b.confidence - a.confidence
  })

  console.log(`✅ Generated ${sortedTriggerPoints.length} optimal trigger points`)
  return sortedTriggerPoints.slice(0, 15) // Limit to 15 best points
}

// Helper functions
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

function offsetPointFromCenter(pointLat: number, pointLng: number, centerLat: number, centerLng: number, offsetMeters: number): {lat: number, lng: number} {
  // Calculate direction from center to point
  const bearing = calculateBearing(centerLat, centerLng, pointLat, pointLng)
  
  // Calculate offset in degrees
  const offsetLat = (offsetMeters * Math.cos(bearing * Math.PI / 180)) / 111000
  const offsetLng = (offsetMeters * Math.sin(bearing * Math.PI / 180)) / (111000 * Math.cos(pointLat * Math.PI / 180))
  
  return {
    lat: pointLat + offsetLat,
    lng: pointLng + offsetLng
  }
}

function findPolygonCorners(coordinates: Array<{lat: number, lng: number}>, centerLat: number, centerLng: number): Array<{lat: number, lng: number}> {
  const corners: Array<{lat: number, lng: number, distance: number}> = []
  
  coordinates.forEach(coord => {
    const distance = calculateDistance(centerLat, centerLng, coord.lat, coord.lng)
    corners.push({ ...coord, distance })
  })
  
  // Sort by distance and take the furthest points (extremities)
  corners.sort((a, b) => b.distance - a.distance)
  
  // Return top 4-6 corners
  const numCorners = Math.min(6, Math.max(4, Math.floor(coordinates.length / 20)))
  return corners.slice(0, numCorners)
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  
  const y = Math.sin(dLng) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)
  
  const bearing = Math.atan2(y, x) * 180 / Math.PI
  return (bearing + 360) % 360
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

function calculatePolygonArea(coordinates: Array<{lat: number, lng: number}>): number {
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

// Street-based trigger point functions
async function findNearbyStreetsForTriggers(lat: number, lng: number, poiName: string, landmarkInfo?: any, customRadius?: number) {
  try {
    console.log('🗺️ Searching for nearby streets with Overpass API...')
    
    // Use provided landmark info or check if this is a high-visibility landmark
    const landmark = landmarkInfo || await checkHighVisibilityLandmark(lat, lng, 0)
    
    // Adjust search radius - use custom radius for fallback, otherwise use landmark-based calculation
    let majorRadius, mediumRadius, minorRadius
    
    if (customRadius) {
      // For fallback street analysis, use smaller, focused radius
      majorRadius = customRadius * 1.5
      mediumRadius = customRadius
      minorRadius = customRadius * 0.7
      console.log(`🔧 Using custom radius: ${customRadius}m (fallback mode)`)
    } else {
      // Normal landmark-based calculation
      majorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 1.2, 6000) : 1500
      mediumRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange, 4000) : 1000
      minorRadius = landmark.isHighVisibility ? Math.min(landmark.maxRange * 0.7, 3000) : 800
    }
    
    console.log(`🔍 Street search radius: major=${majorRadius}m, medium=${mediumRadius}m, minor=${minorRadius}m`)
    console.log(`🔍 Landmark info: isHighVisibility=${landmark.isHighVisibility}, maxRange=${landmark.maxRange}m`)
    console.log(`🔍 Landmark object:`, JSON.stringify(landmark))
    
    // CRITICAL DEBUG: Force log to verify landmark detection
    if (landmark.isHighVisibility) {
      console.log(`🚨 HIGH VISIBILITY LANDMARK DETECTED! maxRange=${landmark.maxRange}m`)
    } else {
      console.log(`🚨 NOT A HIGH VISIBILITY LANDMARK! isHighVisibility=${landmark.isHighVisibility}`)
    }
    
    // Enhanced query to find EXTERNAL streets around the POI (avoiding internal paths)
    const overpassQuery = `[out:json][timeout:30];
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
    out geom;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (street-trigger-generation)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`)
    }

    const data = await response.json()
    console.log(`📊 Overpass found ${data.elements?.length || 0} street elements`)
    
    // CRITICAL: Check if we have distant elements
    if (data.elements && data.elements.length > 0) {
      const distances = []
      for (const element of data.elements.slice(0, 100)) { // Check first 100 elements
        if (element.geometry && element.geometry.length >= 2) {
          const coordinates = element.geometry.map((node: any) => ({lat: node.lat, lng: node.lon}))
          const closestPoint = findClosestPointOnStreet(coordinates, lat, lng)
          const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng)
          distances.push(distance)
        }
      }
      if (distances.length > 0) {
        const maxDist = Math.max(...distances)
        const minDist = Math.min(...distances)
        console.log(`🚨 RAW OVERPASS DISTANCES: ${minDist.toFixed(0)}m - ${maxDist.toFixed(0)}m`)
      }
    }

    const streets = []

    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        if (element.geometry && element.geometry.length >= 2) {
          const coordinates = element.geometry.map((node: any) => ({
            lat: node.lat,
            lng: node.lon
          }))

          // Calculate distance to POI (using closest point on street)
          const closestPoint = findClosestPointOnStreet(coordinates, lat, lng)
          const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng)

          // Filter for EXTERNAL streets only (avoid internal park paths)
          const highwayType = element.tags?.highway || 'unknown'
          const isExternalStreet = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street'].includes(highwayType)
          
          // Filter out tunnels and underground/covered ways for POV quality
          const streetName = element.tags?.name || 'Unnamed'
          const isTunnel = element.tags?.tunnel === 'yes' || 
                          element.tags?.covered === 'yes' ||
                          streetName.toLowerCase().includes('túnel') ||
                          streetName.toLowerCase().includes('tunnel') ||
                          streetName.toLowerCase().includes('viaduto subterrâneo')
          
          // Dynamic minimum distance based on POI type and highway classification
          let minDistance = 25 // Default to close TPs for better urban coverage
          
          // Only use distant TPs for very large areas or landmarks
          if (landmark.isHighVisibility) {
            minDistance = 80 // Keep distant TPs for landmarks
            console.log(`🗻 High visibility landmark - using distant TPs (min: ${minDistance}m)`)
          } else {
            console.log(`🏢 Regular POI - using close TPs (min: ${minDistance}m)`)
          }
          
          const isMinDistance = distance >= minDistance
          // Use dynamic max distance based on landmark info
          const maxSearchDistance = landmark.isHighVisibility ? landmark.maxRange : 1000
          const isMaxDistance = distance <= maxSearchDistance
          
          // Debug: log all distance checks for landmarks
          if (distance > 1000) {
            console.log(`🛣️ Found distant street: ${element.tags?.name || 'Unnamed'} at ${distance.toFixed(0)}m (${highwayType}) - isHighVisibility: ${landmark.isHighVisibility}, maxRange: ${landmark.maxRange}`)
          }
          
          // Debug: log filtered tunnels
          if (isTunnel) {
            console.log(`🚫 Filtered tunnel/covered way: ${streetName} at ${distance.toFixed(0)}m`)
          }
          
          if (isExternalStreet && isMinDistance && isMaxDistance && !isTunnel) {
            const confidence = calculateStreetConfidence(element.tags, distance)
            
            streets.push({
              coordinates,
              name: element.tags?.name || 'Unnamed Street',
              highway_type: highwayType,
              distance_to_poi: distance,
              confidence
            })
          }
        }
      }
    }

    // Sort by relevance - different strategy for high-visibility landmarks
    streets.sort((a, b) => {
      if (landmark.isHighVisibility) {
        // For landmarks: prioritize variety of distances (near + far)
        // Mix close streets (good confidence) with distant streets (better coverage)
        const scoreA = a.confidence * (1 + Math.min(a.distance_to_poi / 1000, 2)) // Bonus for distance up to 2km
        const scoreB = b.confidence * (1 + Math.min(b.distance_to_poi / 1000, 2))
        return scoreB - scoreA
      } else {
        // For regular POIs: closer and higher confidence first
        const scoreA = a.confidence / (1 + a.distance_to_poi / 100)
        const scoreB = b.confidence / (1 + b.distance_to_poi / 100)
        return scoreB - scoreA
      }
    })

    console.log(`🎯 Processed ${streets.length} relevant streets (maxSearchDistance: ${landmark.isHighVisibility ? landmark.maxRange : 1000}m)`)
    console.log(`🎯 Street distances: ${streets.slice(0, 5).map(s => s.distance_to_poi.toFixed(0) + 'm').join(', ')}`)
    
    // CRITICAL: Show max distance found
    const maxDistance = Math.max(...streets.map(s => s.distance_to_poi))
    console.log(`🚨 MAX STREET DISTANCE FOUND: ${maxDistance.toFixed(0)}m`)
    return streets.slice(0, 30) // Increased to 30 streets for more coverage

  } catch (error) {
    console.error('❌ Error finding nearby streets:', error)
    return []
  }
}

async function generateTriggersOnStreets(
  poiLat: number, 
  poiLng: number, 
  boundaryCoordinates: Array<{lat: number, lng: number}>, 
  streets: any[],
  landmarkInfo?: any
) {
  const triggerPoints = []
  
  for (const street of streets) {
    // Find strategic points on this street
    const streetPoints = await findStrategicPointsOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo)
    
    // Debug: log points generated for distant streets
    if (street.distance_to_poi > 1000) {
      console.log(`🚨 Distant street ${street.name} (${street.distance_to_poi.toFixed(0)}m) generated ${streetPoints.length} points`)
      if (streetPoints.length === 0) {
        console.log(`❌ No points generated for distant street: ${street.name}`)
      }
    }
    
    triggerPoints.push(...streetPoints)
  }

  // Calculate POI area for dynamic filtering
  const poiArea = calculatePolygonArea(boundaryCoordinates)
  
  // Dynamic minimum distance based on LANDMARK INFO FIRST, then POI size
  let minPointDistance = 50 // Default
  if (landmarkInfo?.isHighVisibility) {
    minPointDistance = 100 // High-visibility landmarks: more spread out for better coverage
    console.log(`🏔️ High-visibility landmark: using minPointDistance=${minPointDistance}m`)
  } else if (poiArea > 1000000) {
    minPointDistance = 30 // Large areas: closer points OK
  } else if (poiArea > 100000) {
    minPointDistance = 40 // Medium areas
  } else if (poiArea < 50000) {
    minPointDistance = 60 // Small areas: spread out more
  }
  
  // Remove duplicates (points too close to each other)
  const filteredPoints = removeDuplicatePoints(triggerPoints, minPointDistance)

  // Classify points by priority
  const classifiedPoints = classifyTriggerPointsByStreet(filteredPoints, poiLat, poiLng)

  console.log(`📍 Generated ${classifiedPoints.length} street trigger points`)
  
  // Dynamic limit based on LANDMARK INFO FIRST, then POI size
  let maxPoints = 15 // Default
  if (landmarkInfo?.isHighVisibility) {
    maxPoints = 40 // Increased for high-visibility landmarks since they pass visibility filter
    console.log(`🏔️ High-visibility landmark: allowing up to ${maxPoints} trigger points`)
  } else if (poiArea > 1000000) {
    maxPoints = 20 // Large areas get more points
  } else if (poiArea > 500000) {
    maxPoints = 18 // Medium-large areas
  } else if (poiArea > 100000) {
    maxPoints = 16 // Medium areas
  }
  
  return classifiedPoints.slice(0, maxPoints)
}

async function findStrategicPointsOnStreet(street: any, poiLat: number, poiLng: number, boundaryCoordinates: Array<{lat: number, lng: number}>, landmarkInfo?: any) {
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
      confidence: street.confidence * (hasVisibility ? 1.0 : 0.7),
      distance_from_poi: distance,
      expected_bearing: bearing,
      radius_meters: 20,
      street_name: street.name,
      highway_type: street.highway_type
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
        highway_type: street.highway_type
      })
    }
  }

  // Strategy 3: Add intermediate points along longer streets for better coverage
  if (street.coordinates.length > 10 && ['motorway', 'trunk', 'primary', 'secondary'].includes(street.highway_type)) {
    const step = Math.max(3, Math.floor(street.coordinates.length / 4)) // Sample 4 points along street
    
    for (let i = step; i < street.coordinates.length - step; i += step) {
      const intermediatePoint = street.coordinates[i]
      const intDistance = calculateDistance(poiLat, poiLng, intermediatePoint.lat, intermediatePoint.lng)
      const intBearing = calculateBearing(intermediatePoint.lat, intermediatePoint.lng, poiLat, poiLng)
      const intVisibility = await checkVisibilityToPOI(intermediatePoint, boundaryCoordinates, poiLat, poiLng, landmarkInfo)
      
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
        })
      }
    }
  }

  return points
}

// Helper functions for street-based triggers
function findClosestPointOnStreet(streetCoordinates: Array<{lat: number, lng: number}>, poiLat: number, poiLng: number) {
  let closestPoint = streetCoordinates[0]
  let minDistance = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
  
  for (const point of streetCoordinates) {
    const distance = calculateDistance(poiLat, poiLng, point.lat, point.lng)
    if (distance < minDistance) {
      minDistance = distance
      closestPoint = point
    }
  }
  
  return closestPoint
}

function calculateStreetConfidence(tags: any, distance: number): number {
  let confidence = 0.5 // Base confidence
  
  // Highway type priority
  const highwayType = tags?.highway || ''
  if (['motorway', 'trunk', 'primary'].includes(highwayType)) confidence += 0.4
  else if (['secondary', 'tertiary'].includes(highwayType)) confidence += 0.3
  else if (['residential', 'living_street'].includes(highwayType)) confidence += 0.2
  
  // Named streets are more reliable
  if (tags?.name) confidence += 0.2
  
  // POV quality bonuses for better viewpoints
  const streetName = (tags?.name || '').toLowerCase()
  
  // High priority POV locations (known viewpoints)
  if (streetName.includes('mirante') || 
      streetName.includes('vista') || 
      streetName.includes('belvedere') ||
      streetName.includes('morro') ||
      streetName.includes('praia') ||
      streetName.includes('orla') ||
      streetName.includes('lagoa') ||
      streetName.includes('botafogo')) {
    confidence += 0.5 // Major bonus for known viewpoints
  }
  
  // Medium priority locations (elevated areas)
  if (streetName.includes('alto') ||
      streetName.includes('ladeira') ||
      streetName.includes('rua real grandeza') || // Known good view in Urca
      streetName.includes('urca') ||
      streetName.includes('flamengo') ||
      streetName.includes('copacabana')) {
    confidence += 0.3
  }
  
  // Penalty for likely obstructed views
  if (streetName.includes('shopping') ||
      streetName.includes('centro') ||
      streetName.includes('galeria') ||
      streetName.includes('subsolo')) {
    confidence -= 0.3
  }
  
  // Distance factor (for landmarks, distant points can be good too)
  if (distance < 100) confidence += 0.3
  else if (distance < 300) confidence += 0.2
  else if (distance < 500) confidence += 0.1
  else if (distance > 2000) confidence += 0.2 // Bonus for distant viewpoints
  
  return Math.min(1.0, confidence)
}

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
  
  // For urban areas (small POIs), check for building obstructions (EXPERIMENTAL)
  // Skip obstruction check for high-visibility landmarks (they're visible over buildings)
  if (poiArea < 100000 && !landmark.isHighVisibility) { // Only for very small POIs in dense urban areas, excluding landmarks
    try {
      const hasObstruction = await checkBuildingObstructions(point, poiLat, poiLng)
      if (hasObstruction) {
        console.log(`🚫 Trigger point blocked by building obstructions`)
        return false
      }
    } catch (error) {
      console.log('⚠️ Obstruction check failed, allowing trigger point')
      // If obstruction check fails, allow the trigger point
    }
  } else if (landmark.isHighVisibility) {
    console.log(`🏔️ Skipping building obstruction check for high-visibility landmark`)
  }
  
  return true
}

// Calculate minimum distance from point to polygon boundary
function calculateDistanceToPolygon(point: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): number {
  let minDistance = Infinity
  
  for (let i = 0; i < polygon.length - 1; i++) {
    const segmentStart = polygon[i]
    const segmentEnd = polygon[i + 1]
    const distance = calculateDistanceToLineSegment(point, segmentStart, segmentEnd)
    minDistance = Math.min(minDistance, distance)
  }
  
  return minDistance
}

// Calculate distance from point to line segment
function calculateDistanceToLineSegment(
  point: {lat: number, lng: number}, 
  lineStart: {lat: number, lng: number}, 
  lineEnd: {lat: number, lng: number}
): number {
  const A = point.lat - lineStart.lat
  const B = point.lng - lineStart.lng
  const C = lineEnd.lat - lineStart.lat
  const D = lineEnd.lng - lineStart.lng

  const dot = A * C + B * D
  const lenSq = C * C + D * D
  let param = -1
  if (lenSq !== 0) param = dot / lenSq

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

// Check if POI is a high-visibility landmark and calculate visibility range
async function checkHighVisibilityLandmark(poiLat: number, poiLng: number, currentDistance: number): Promise<{ isHighVisibility: boolean, maxRange: number, elevationDiff: number }> {
  try {
    console.log(`🔍 Checking landmark for coordinates: ${poiLat}, ${poiLng}`)
    
    // Known high-elevation landmarks with their elevations
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
        // Formula: visibility range ≈ 3.57 * sqrt(height_diff) * 1000 (theoretical horizon)
        // But we'll use a more conservative approach for practical visibility
        const theoreticalRange = Math.sqrt(elevationDiff) * 200 // More conservative multiplier
        const maxRange = Math.min(Math.max(theoreticalRange, 2000), 8000) // Between 2km-8km
        
        console.log(`🗿 Detected ${landmark.name}: ${landmark.elevation}m elevation, ${elevationDiff}m above base, max range: ${maxRange.toFixed(0)}m`)
        return { isHighVisibility: true, maxRange, elevationDiff }
      }
    }
    
    // Check for elevation and tourism tags via Overpass API for unknown landmarks
    const overpassQuery = `[out:json][timeout:10];
    (
      // Tourism attractions with high elevation
      way[tourism=attraction][ele](around:500,${poiLat},${poiLng});
      relation[tourism=attraction][ele](around:500,${poiLat},${poiLng});
      
      // Natural peaks and viewpoints
      node[natural=peak](around:500,${poiLat},${poiLng});
      way[tourism=viewpoint](around:500,${poiLat},${poiLng});
      
      // Religious monuments (often elevated)
      way[historic=monument][religion](around:500,${poiLat},${poiLng});
      way[man_made=tower][tourism](around:500,${poiLat},${poiLng});
    );
    out tags;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (landmark-elevation-check)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      console.log('⚠️ Elevation check failed, assuming normal POI')
      return { isHighVisibility: false, maxRange: 800, elevationDiff: 0 }
    }

    const data = await response.json()
    
    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        const tags = element.tags || {}
        
        // Check for high elevation (above 300m)
        if (tags.ele) {
          const elevation = parseInt(tags.ele)
          if (elevation > 300) {
            const elevationDiff = elevation - 200 // Assume 200m base elevation
            const maxRange = Math.min(Math.sqrt(elevationDiff) * 150, 5000) // Conservative range
            console.log(`🏔️ High elevation detected: ${elevation}m, max range: ${maxRange.toFixed(0)}m`)
            return { isHighVisibility: true, maxRange, elevationDiff }
          }
        }
        
        // Check for tourism importance
        if (tags.tourism === 'attraction' && tags.wikipedia) {
          console.log(`🎯 Major tourist attraction detected`)
          return { isHighVisibility: true, maxRange: 2000, elevationDiff: 100 }
        }
        
        // Check for religious monuments (often iconic)
        if (tags.historic === 'monument' && tags.religion) {
          console.log(`⛪ Religious monument detected`)
          return { isHighVisibility: true, maxRange: 1500, elevationDiff: 50 }
        }
        
        // Check for viewpoints and peaks
        if (tags.natural === 'peak' || tags.tourism === 'viewpoint') {
          console.log(`🌄 Natural viewpoint/peak detected`)
          return { isHighVisibility: true, maxRange: 3000, elevationDiff: 200 }
        }
      }
    }
    
    return { isHighVisibility: false, maxRange: 800, elevationDiff: 0 }

  } catch (error) {
    console.error('❌ Error checking landmark elevation:', error)
    return { isHighVisibility: false, maxRange: 800, elevationDiff: 0 } // If check fails, treat as normal POI
  }
}

// Check for building obstructions between trigger point and POI
async function checkBuildingObstructions(triggerPoint: {lat: number, lng: number}, poiLat: number, poiLng: number): Promise<boolean> {
  try {
    console.log(`🏢 Checking building obstructions for trigger point at ${triggerPoint.lat.toFixed(4)}, ${triggerPoint.lng.toFixed(4)}`)
    
    // Create a line of sight between trigger point and POI
    const midLat = (triggerPoint.lat + poiLat) / 2
    const midLng = (triggerPoint.lng + poiLng) / 2
    
    // Search for buildings in a corridor between trigger point and POI
    const searchRadius = Math.min(200, calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng) / 2)
    
    const overpassQuery = `[out:json][timeout:15];
    (
      // Buildings that might obstruct view
      way[building](around:${searchRadius},${midLat},${midLng});
      relation[building](around:${searchRadius},${midLat},${midLng});
      
      // High structures
      way[man_made=tower](around:${searchRadius},${midLat},${midLng});
      way[barrier=wall][height](around:${searchRadius},${midLat},${midLng});
    );
    out geom;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (building-obstruction-check)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      console.log('⚠️ Overpass API error, assuming no obstructions')
      return false // If API fails, don't block the trigger point
    }

    const data = await response.json()
    
    if (!data.elements || data.elements.length === 0) {
      console.log('✅ No buildings found in line of sight')
      return false
    }

    console.log(`🔍 Found ${data.elements.length} potential obstructions`)
    
    // Check if any building intersects the line of sight
    let obstructionCount = 0
    
    for (const element of data.elements) {
      if (element.geometry && element.geometry.length >= 3) {
        const buildingCoords = element.geometry.map((node: any) => ({
          lat: node.lat,
          lng: node.lon
        }))
        
        // Check if building is between trigger point and POI
        const buildingCenter = calculatePolygonCenter(buildingCoords)
        const distanceToTrigger = calculateDistance(triggerPoint.lat, triggerPoint.lng, buildingCenter.lat, buildingCenter.lng)
        const distanceToPOI = calculateDistance(poiLat, poiLng, buildingCenter.lat, buildingCenter.lng)
        const totalDistance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng)
        
        // If building is roughly between trigger point and POI (with some tolerance)
        if (distanceToTrigger + distanceToPOI <= totalDistance * 1.2) {
          // Check if line of sight passes through or very close to building
          if (lineIntersectsPolygon(triggerPoint, {lat: poiLat, lng: poiLng}, buildingCoords)) {
            obstructionCount++
            
            // Get building info for logging
            const buildingType = element.tags?.building || 'unknown'
            const buildingName = element.tags?.name || `${buildingType} building`
            console.log(`🚫 Obstruction detected: ${buildingName} (${distanceToTrigger.toFixed(0)}m from trigger point)`)
          }
        }
      }
    }
    
    // If more than 2 significant obstructions, consider it blocked (more permissive)
    const isBlocked = obstructionCount > 2
    
    if (isBlocked) {
      console.log(`❌ Line of sight blocked by ${obstructionCount} buildings`)
    } else {
      console.log(`✅ Line of sight clear (${obstructionCount} minor obstructions)`)
    }
    
    return isBlocked

  } catch (error) {
    console.error('❌ Error checking building obstructions:', error)
    return false // If error, don't block the trigger point
  }
}

// Check if a line intersects with a polygon (building)
function lineIntersectsPolygon(point1: {lat: number, lng: number}, point2: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): boolean {
  // Simple check: see if line passes close to polygon edges
  for (let i = 0; i < polygon.length - 1; i++) {
    const edgeStart = polygon[i]
    const edgeEnd = polygon[i + 1]
    
    // Calculate distance from line to edge
    const distanceToEdge = distanceFromPointToLineSegment(
      calculatePolygonCenter([edgeStart, edgeEnd]), 
      point1, 
      point2
    )
    
    // If line passes within 20m of building edge, consider it an obstruction
    if (distanceToEdge < 20) {
      return true
    }
  }
  
  return false
}

// Calculate distance from a point to a line segment
function distanceFromPointToLineSegment(point: {lat: number, lng: number}, lineStart: {lat: number, lng: number}, lineEnd: {lat: number, lng: number}): number {
  const A = point.lat - lineStart.lat
  const B = point.lng - lineStart.lng
  const C = lineEnd.lat - lineStart.lat
  const D = lineEnd.lng - lineStart.lng

  const dot = A * C + B * D
  const lenSq = C * C + D * D
  let param = -1
  if (lenSq !== 0) param = dot / lenSq

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

function isPointInPolygon(point: {lat: number, lng: number}, polygon: Array<{lat: number, lng: number}>): boolean {
  let inside = false
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (((polygon[i].lat > point.lat) !== (polygon[j].lat > point.lat)) &&
        (point.lng < (polygon[j].lng - polygon[i].lng) * (point.lat - polygon[i].lat) / (polygon[j].lat - polygon[i].lat) + polygon[i].lng)) {
      inside = !inside
    }
  }
  
  return inside
}

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

function classifyTriggerPointsByStreet(points: any[], poiLat: number, poiLng: number) {
  // Sort by confidence and distance
  points.sort((a, b) => {
    const scoreA = a.confidence / (1 + a.distance_from_poi / 100)
    const scoreB = b.confidence / (1 + b.distance_from_poi / 100)
    return scoreB - scoreA
  })
  
  // Enhanced classification with more secondary points
  return points.map((point, index) => {
    let type = 'fallback'
    
    // Classify based on highway type and position
    if (point.highway_type === 'motorway' || point.highway_type === 'trunk') {
      type = index < 8 ? 'primary' : 'secondary' // Major roads get priority
    } else if (point.highway_type === 'primary' || point.highway_type === 'secondary') {
      type = index < 6 ? 'primary' : index < 12 ? 'secondary' : 'fallback'
    } else if (point.highway_type === 'tertiary') {
      type = index < 4 ? 'primary' : index < 10 ? 'secondary' : 'fallback'
    } else { // residential, living_street, etc.
      type = index < 3 ? 'primary' : index < 8 ? 'secondary' : 'fallback'
    }
    
    return {
      ...point,
      type
    }
  })
}

// Fallback Strategy: Direct street detection for immediate trigger point placement
async function createFallbackBoundaryFromStreets(lat: number, lng: number, poiName: string, landmarkInfo?: any) {
  try {
    console.log(`🔄 Fallback: Finding closest street directly in front of POI at (${lat}, ${lng})`)
    
    // Use very small radius (50m) to find only the immediate surrounding streets
    const immediateStreets = await findImmediateStreets(lat, lng)
    
    if (!immediateStreets || immediateStreets.length === 0) {
      console.log('❌ No immediate streets found for direct placement')
      return { success: false, error: 'No streets found in immediate vicinity' }
    }
    
    console.log(`🎯 Found ${immediateStreets.length} immediate streets`)
    
    // Create minimal boundary (20m radius for very small POIs like restaurants)
    const boundaryRadius = 20
    const boundary = createCircularBoundary(lat, lng, boundaryRadius)
    
    // Generate trigger points using directional analysis
    const triggerPoints = await generateDirectionalTriggerPoints(lat, lng, immediateStreets)
    
    if (triggerPoints.length === 0) {
      console.log('❌ No suitable trigger points could be generated')
      return { success: false, error: 'No suitable trigger points found' }
    }
    
    console.log(`✅ Generated ${triggerPoints.length} direct trigger points`)
    triggerPoints.forEach(point => {
      console.log(`   - ${point.street_name}: ${point.distance_from_poi.toFixed(0)}m (${point.direction})`)
    })
    
    return {
      success: true,
      boundary: boundary,
      trigger_points: triggerPoints
    }
    
  } catch (error) {
    console.error('❌ Direct street detection failed:', error)
    return { 
      success: false, 
      error: `Direct street detection error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }
  }
}

// Helper function to create a circular boundary around a point
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

// Find streets in immediate vicinity (enhanced for better POV detection)
async function findImmediateStreets(lat: number, lng: number) {
  try {
    console.log(`🔍 Searching for immediate streets with enhanced POV detection at (${lat}, ${lng})`)
    
    const radius = 80 // Expanded radius to catch better POV streets (was 50m)
    const overpassQuery = `[out:json][timeout:15];
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
        
        // Calculate closest point and distance
        const closestPoint = findClosestPointOnStreet(coordinates, lat, lng)
        const distance = calculateDistance(lat, lng, closestPoint.lat, closestPoint.lng)
        
        // Include streets in enhanced range for better POV (5-80m)
        if (distance >= 5 && distance <= 80) {
          streets.push({
            name: element.tags?.name || 'Unnamed Street',
            coordinates: coordinates,
            distance: distance,
            closestPoint: closestPoint,
            highway: element.tags?.highway || 'unknown',
            oneway: element.tags?.oneway || 'no',
            direction: element.tags?.direction || null,
            tags: element.tags || {}
          })
        }
      }
    }
    
    // Sort by distance (closest first)
    streets.sort((a, b) => a.distance - b.distance)
    
    console.log(`🛣️ Found ${streets.length} immediate streets:`)
    streets.forEach(street => {
      console.log(`   - ${street.name}: ${street.distance.toFixed(1)}m (${street.highway})`)
    })
    
    return streets
    
  } catch (error) {
    console.error('❌ Error finding immediate streets:', error)
    return []
  }
}

// Generate trigger points using directional analysis (North, South, East, West)
async function generateDirectionalTriggerPoints(poiLat: number, poiLng: number, streets: any[]) {
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
        // Validate if this street offers frontal view of POI
        const frontalView = validateFrontalStreetView(street, poiLat, poiLng)
        
        // Calculate combined score: frontal view score + distance factor
        let combinedScore = frontalView.score
        
        // Distance factor (closer is better, but not too close)
        const distanceScore = street.distance <= 40 ? 1.0 : Math.max(0.5, 1.0 - (street.distance - 40) / 40)
        combinedScore = (frontalView.score * 0.7) + (distanceScore * 0.3)
        
        console.log(`📊 ${street.name}: frontal=${frontalView.isFrontal}, score=${combinedScore.toFixed(2)}, distance=${street.distance.toFixed(1)}m`)
        
        // Select street with best combined score, or closest if no frontal streets
        if (frontalView.isFrontal && combinedScore > bestScore) {
          bestScore = combinedScore
          bestStreet = street
          minDistance = street.distance
        } else if (!bestStreet && street.distance < minDistance) {
          // Fallback to closest street if no frontal streets found
          minDistance = street.distance
          bestStreet = street
        }
      }
    }
    
    // Add trigger point for this direction if street found (minimum 25m to avoid placing inside POI)
          if (bestStreet && minDistance >= 25 && minDistance <= 80) { // Ensure TPs are outside POI boundary
      // Find optimal point on the street (not just closest point)
      console.log(`🔧 Calling findOptimalPointOnStreet for ${bestStreet.name}`)
      const optimalPoint = findOptimalPointOnStreet(bestStreet, poiLat, poiLng)
      console.log(`🎯 Optimal point result: lat=${optimalPoint.lat}, lng=${optimalPoint.lng}`)
      const optimalDistance = calculateDistance(poiLat, poiLng, optimalPoint.lat, optimalPoint.lng)
      const confidence = Math.max(0.5, 1.0 - (optimalDistance / 40))
      
      triggerPoints.push({
        lat: optimalPoint.lat,
        lng: optimalPoint.lng,
        type: optimalDistance >= 25 && optimalDistance <= 35 ? 'primary' : (optimalDistance <= 50 ? 'secondary' : 'fallback'),
        reasoning: `Optimal walking point on ${bestStreet.name} in ${direction.name} direction${bestScore > 0 ? ' (frontal street)' : ''}`,
        confidence: confidence,
        distance_from_poi: optimalDistance,
        expected_bearing: calculateBearing(optimalPoint.lat, optimalPoint.lng, poiLat, poiLng),
        radius_meters: 20,
        street_name: bestStreet.name,
        direction: direction.name.toLowerCase()
      })
      
      console.log(`📍 ${direction.name}: ${bestStreet.name} at ${optimalDistance.toFixed(1)}m (optimal point)`)
    } else {
      console.log(`❌ ${direction.name}: No suitable street found`)
    }
  }
  
  // If no directional streets found, take the closest street regardless of direction
  if (triggerPoints.length === 0 && streets.length > 0) {
    const closestStreet = streets[0] // Already sorted by distance
    console.log(`🎯 Using closest street as fallback: ${closestStreet.name}`)
    
    // Use optimal point even for fallback
    const optimalPoint = findOptimalPointOnStreet(closestStreet, poiLat, poiLng)
    const optimalDistance = calculateDistance(poiLat, poiLng, optimalPoint.lat, optimalPoint.lng)
    
    triggerPoints.push({
      lat: optimalPoint.lat,
      lng: optimalPoint.lng,
      type: 'primary',
      reasoning: `Optimal point on closest available street`,
      confidence: Math.max(0.6, 1.0 - (optimalDistance / 40)),
      distance_from_poi: optimalDistance,
      expected_bearing: calculateBearing(optimalPoint.lat, optimalPoint.lng, poiLat, poiLng),
      radius_meters: 20,
      street_name: closestStreet.name,
      direction: 'closest'
    })
  }
  
  return triggerPoints
}

// Find optimal point on street for trigger placement (simplified bearing-based approach)
function findOptimalPointOnStreet(street: any, poiLat: number, poiLng: number) {
  const coordinates = street.coordinates
  const streetLength = coordinates.length
  
  if (streetLength < 2) {
    return street.closestPoint
  }
  
  console.log(`🔍 Finding optimal point on ${street.name} (${streetLength} coordinates)`)
  console.log(`🧭 Street direction info: oneway=${street.oneway}`)
  
  // Sample multiple points along the street
  const candidatePoints = []
  const sampleCount = Math.max(3, Math.min(8, Math.floor(streetLength / 2)))
  const step = Math.max(1, Math.floor(streetLength / sampleCount))
  
  for (let i = 0; i < streetLength; i += step) {
    const point = coordinates[i]
    const distanceToPOI = calculateDistance(poiLat, poiLng, point.lat, point.lng)
    
    // Only consider points that are OUTSIDE the POI boundary (minimum 25m) and reasonably close
    if (distanceToPOI >= 25 && distanceToPOI <= 80) {
      
      // ENHANCED VALIDATION: Bearing + Line of Sight
      const bearingValidation = validateBearingPosition(point, poiLat, poiLng, street, i, coordinates)
      
      if (bearingValidation.isValid) {
        // Check direct line of sight (async, but we'll handle it synchronously for now)
        let lineOfSightScore = 0.8 // Default assumption
        
        // For closer points, we can do a quick obstruction check
        if (distanceToPOI <= 50) {
          lineOfSightScore = 0.9 // Assume good visibility for close points
        } else {
          lineOfSightScore = 0.7 // Assume partial visibility for distant points
        }
        
        let score = 0
        
        // Factor 1: Distance score (prefer points 25-40m from POI)
        const distanceScore = distanceToPOI >= 25 && distanceToPOI <= 40 ? 1.0 : Math.max(0.3, 1.0 - Math.abs(distanceToPOI - 32.5) / 30)
        score += distanceScore * 0.3
        
        // Factor 2: Bearing validation score
        score += bearingValidation.score * 0.4
        
        // Factor 3: Line of sight score
        score += lineOfSightScore * 0.3
        
        candidatePoints.push({
          lat: point.lat,
          lng: point.lng,
          distanceToPOI: distanceToPOI,
          score: score,
          reasoning: bearingValidation.reasoning
        })
        
        console.log(`✅ Valid TP: ${distanceToPOI.toFixed(1)}m, score: ${score.toFixed(2)} - ${bearingValidation.reasoning}`)
      } else {
        console.log(`❌ Invalid TP: ${distanceToPOI.toFixed(1)}m - ${bearingValidation.reasoning}`)
      }
    }
  }
  
  if (candidatePoints.length === 0) {
    console.log(`⚠️ No valid points found on ${street.name}, using closest point`)
    return street.closestPoint
  }
  
  // Sort by score (highest first)
  candidatePoints.sort((a, b) => b.score - a.score)
  
  const bestPoint = candidatePoints[0]
  console.log(`🎯 Best TP: ${bestPoint.distanceToPOI.toFixed(1)}m, score: ${bestPoint.score.toFixed(2)}`)
  
  return {
    lat: bestPoint.lat,
    lng: bestPoint.lng
  }
}

// Validate POV direction to ensure trigger point offers good view of POI
function validatePOVDirection(triggerPoint: any, poiLat: number, poiLng: number, street: any, streetIndex: number): number {
  // Calculate bearing from trigger point to POI
  const bearingToPOI = calculateBearing(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng)
  
  // Check if this is a one-way street
  const isOneway = street.oneway === 'yes' || street.oneway === '1' || street.oneway === 'true'
  const isReverseOneway = street.oneway === '-1' || street.oneway === 'reverse'
  
  let score = 1.0 // Default score for two-way streets
  
  if (isOneway || isReverseOneway) {
    // For one-way streets, calculate the street direction
    const streetDirection = calculateStreetDirection(street.coordinates, streetIndex, isReverseOneway)
    
    // Calculate angle difference between street direction and POI view angle
    const viewAngle = (bearingToPOI + 90) % 360 // Perpendicular to POI bearing (left side view)
    const viewAngle2 = (bearingToPOI - 90 + 360) % 360 // Perpendicular to POI bearing (right side view)
    
    const angleDiff1 = Math.abs(normalizeAngleDifference(streetDirection - viewAngle))
    const angleDiff2 = Math.abs(normalizeAngleDifference(streetDirection - viewAngle2))
    const bestAngleDiff = Math.min(angleDiff1, angleDiff2)
    
    console.log(`🧭 Street direction: ${streetDirection.toFixed(0)}°, POI bearing: ${bearingToPOI.toFixed(0)}°, angle diff: ${bestAngleDiff.toFixed(0)}°`)
    
    // Score based on how well the street direction aligns with good POV angles
    if (bestAngleDiff <= 30) {
      score = 1.0 // Perfect alignment - person walking can see POI from side
    } else if (bestAngleDiff <= 60) {
      score = 0.8 // Good alignment
    } else if (bestAngleDiff <= 90) {
      score = 0.6 // Acceptable alignment
    } else if (bestAngleDiff <= 120) {
      score = 0.4 // Poor alignment - person might be walking away from POI
    } else {
      score = 0.2 // Very poor alignment - person likely walking with back to POI
    }
    
    console.log(`🎯 POV direction score: ${score.toFixed(2)} (angle diff: ${bestAngleDiff.toFixed(0)}°)`)
  } else {
    console.log(`🛣️ Two-way street - no direction restriction`)
  }
  
  return score
}

// Calculate the direction a street is heading at a specific point
function calculateStreetDirection(coordinates: any[], pointIndex: number, isReverse: boolean = false): number {
  const coordLength = coordinates.length
  
  // Use a segment around the point to calculate direction
  let startIndex = Math.max(0, pointIndex - 1)
  let endIndex = Math.min(coordLength - 1, pointIndex + 1)
  
  // If we're at the start or end, use a longer segment
  if (pointIndex === 0) {
    endIndex = Math.min(coordLength - 1, pointIndex + 2)
  } else if (pointIndex === coordLength - 1) {
    startIndex = Math.max(0, pointIndex - 2)
  }
  
  const startPoint = coordinates[startIndex]
  const endPoint = coordinates[endIndex]
  
  let direction = calculateBearing(startPoint.lat, startPoint.lng, endPoint.lat, endPoint.lng)
  
  // If reverse one-way, flip the direction
  if (isReverse) {
    direction = (direction + 180) % 360
  }
  
  return direction
}

// Normalize angle difference to be between -180 and 180
function normalizeAngleDifference(angleDiff: number): number {
  while (angleDiff > 180) angleDiff -= 360
  while (angleDiff < -180) angleDiff += 360
  return angleDiff
}

// Detect POI front orientation and validate if street offers direct frontal view
function validateFrontalStreetView(street: any, poiLat: number, poiLng: number): { isFrontal: boolean, score: number, reasoning: string } {
  // Get street's closest point to POI
  const closestPoint = findClosestPointOnStreet(street.coordinates, poiLat, poiLng)
  const distanceToStreet = calculateDistance(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
  
  // Calculate bearing from POI to street (this represents the "front" direction)
  const bearingToStreet = calculateBearing(poiLat, poiLng, closestPoint.lat, closestPoint.lng)
  
  console.log(`🧭 Analyzing frontal view for ${street.name}: bearing ${bearingToStreet.toFixed(0)}°, distance ${distanceToStreet.toFixed(1)}m`)
  
  // Check if this street could be a "main street" in front of POI
  let frontScore = 0.5 // Base score
  let reasoning = `Street at ${bearingToStreet.toFixed(0)}° bearing`
  
  // Factor 1: Street type priority (main streets are more likely to be "in front")
  const highwayType = street.highway || street.tags?.highway || 'unknown'
  if (['primary', 'secondary', 'tertiary'].includes(highwayType)) {
    frontScore += 0.2
    reasoning += `, major road (${highwayType})`
  } else if (['residential', 'living_street'].includes(highwayType)) {
    frontScore += 0.1
    reasoning += `, residential street`
  }
  
  // Factor 2: Named streets are more likely to be main access
  if (street.name && street.name !== 'Unnamed Street') {
    frontScore += 0.15
    reasoning += `, named street`
  }
  
  // Factor 3: Distance factor (closer streets more likely to be direct access)
  if (distanceToStreet <= 30) {
    frontScore += 0.2
    reasoning += `, very close access`
  } else if (distanceToStreet <= 50) {
    frontScore += 0.1
    reasoning += `, close access`
  }
  
  // Factor 4: Check for POI orientation indicators in street name
  const streetName = (street.name || '').toLowerCase()
  const isMainAccess = streetName.includes('avenida') || 
                      streetName.includes('rua principal') || 
                      streetName.includes('acesso') ||
                      streetName.includes('entrada')
  
  if (isMainAccess) {
    frontScore += 0.15
    reasoning += `, main access indicator`
  }
  
  // Determine if this is likely a frontal street
  const isFrontal = frontScore >= 0.7
  
  console.log(`${isFrontal ? '✅' : '📍'} ${street.name}: frontal score ${frontScore.toFixed(2)} - ${reasoning}`)
  
  return {
    isFrontal: isFrontal,
    score: frontScore,
    reasoning: reasoning
  }
}

// Validate direct line of sight from TP to POI (no obstructions)
async function validateDirectLineOfSight(triggerPoint: any, poiLat: number, poiLng: number): Promise<{ hasDirectView: boolean, score: number, reasoning: string }> {
  const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng)
  
  // For very close points, assume good visibility
  if (distance <= 40) {
    return {
      hasDirectView: true,
      score: 1.0,
      reasoning: `Close distance (${distance.toFixed(0)}m) - direct view assumed`
    }
  }
  
  // For distant points, check for major obstructions using Overpass
  try {
    const midLat = (triggerPoint.lat + poiLat) / 2
    const midLng = (triggerPoint.lng + poiLng) / 2
    const searchRadius = Math.min(distance / 2, 100) // Search in the middle area
    
    const overpassQuery = `[out:json][timeout:10];
    (
      way[building](around:${searchRadius},${midLat},${midLng});
      way[natural=tree](around:${searchRadius},${midLat},${midLng});
      way[barrier](around:${searchRadius},${midLat},${midLng});
    );
    out count;`
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: overpassQuery
    })
    
    if (response.ok) {
      const data = await response.json()
      const obstructionCount = data.elements?.length || 0
      
      if (obstructionCount <= 2) {
        return {
          hasDirectView: true,
          score: 0.9,
          reasoning: `Few obstructions (${obstructionCount}) in line of sight`
        }
      } else {
        return {
          hasDirectView: false,
          score: 0.3,
          reasoning: `Multiple obstructions (${obstructionCount}) blocking view`
        }
      }
    }
  } catch (error) {
    console.log(`⚠️ Could not check line of sight: ${error}`)
  }
  
  // Default: assume reasonable view for medium distances
  return {
    hasDirectView: distance <= 80,
    score: distance <= 80 ? 0.7 : 0.4,
    reasoning: `Medium distance (${distance.toFixed(0)}m) - partial view assumed`
  }
}

// Simple bearing validation to avoid TPs "behind" POI
function validateBearingPosition(triggerPoint: any, poiLat: number, poiLng: number, street: any, pointIndex: number, coordinates: any[]) {
  const isOneway = street.oneway === 'yes' || street.oneway === '1' || street.oneway === 'true'
  const isReverseOneway = street.oneway === '-1' || street.oneway === 'reverse'
  
  // For two-way streets, accept any reasonable position
  if (!isOneway && !isReverseOneway) {
    return {
      isValid: true,
      score: 0.8,
      reasoning: "Two-way street - good position"
    }
  }
  
  // For one-way streets, check if TP is positioned correctly
  const streetDirection = calculateStreetDirection(coordinates, pointIndex, isReverseOneway)
  const bearingToPOI = calculateBearing(triggerPoint.lat, triggerPoint.lng, poiLat, poiLng)
  
  // Calculate angle difference between street direction and bearing to POI
  const angleDiff = Math.abs(normalizeAngleDifference(streetDirection - bearingToPOI))
  
  console.log(`🧭 Street dir: ${streetDirection.toFixed(0)}°, TP→POI: ${bearingToPOI.toFixed(0)}°, diff: ${angleDiff.toFixed(0)}°`)
  
  // Good positions: POI is visible from the side or front while walking
  if (angleDiff >= 45 && angleDiff <= 135) {
    return {
      isValid: true,
      score: 1.0,
      reasoning: `Good POV - POI visible from side (${angleDiff.toFixed(0)}° angle)`
    }
  }
  
  // Acceptable positions: POI somewhat visible
  if (angleDiff >= 30 && angleDiff <= 150) {
    return {
      isValid: true,
      score: 0.7,
      reasoning: `Acceptable POV - POI partially visible (${angleDiff.toFixed(0)}° angle)`
    }
  }
  
  // Bad positions: POI is behind or too far ahead in walking direction
  return {
    isValid: false,
    score: 0.1,
    reasoning: `Bad POV - POI behind walking direction (${angleDiff.toFixed(0)}° angle)`
  }
}

// Find the index of the closest point on street to POI
function findClosestPointIndexOnStreet(coordinates: any[], poiLat: number, poiLng: number): number {
  let closestIndex = 0
  let minDistance = Infinity
  
  for (let i = 0; i < coordinates.length; i++) {
    const distance = calculateDistance(poiLat, poiLng, coordinates[i].lat, coordinates[i].lng)
    if (distance < minDistance) {
      minDistance = distance
      closestIndex = i
    }
  }
  
  return closestIndex
}

// Get indices for points upstream (before POI in traffic flow)
function getUpstreamIndices(coordinates: any[], closestIndex: number, isReverse: boolean): number[] {
  const indices = []
  const streetLength = coordinates.length
  
  if (isReverse) {
    // Reverse one-way: upstream is towards end of array
    for (let i = closestIndex + 1; i < Math.min(streetLength, closestIndex + 8); i++) {
      indices.push(i)
    }
  } else {
    // Normal one-way: upstream is towards beginning of array
    for (let i = Math.max(0, closestIndex - 8); i < closestIndex; i++) {
      indices.push(i)
    }
  }
  
  return indices
}

// Get indices for points downstream (after POI in traffic flow) - used as backup
function getDownstreamIndices(coordinates: any[], closestIndex: number, isReverse: boolean, count: number): number[] {
  const indices = []
  const streetLength = coordinates.length
  
  if (isReverse) {
    // Reverse one-way: downstream is towards beginning of array
    for (let i = Math.max(0, closestIndex - count); i < closestIndex; i++) {
      indices.push(i)
    }
  } else {
    // Normal one-way: downstream is towards end of array
    for (let i = closestIndex + 1; i < Math.min(streetLength, closestIndex + count + 1); i++) {
      indices.push(i)
    }
  }
  
  return indices
}

// Calculate bonus for stream position (upstream = good, downstream = bad)
function calculateStreamPositionBonus(pointIndex: number, closestIndex: number, isOneway: boolean, isReverse: boolean, streetLength: number): number {
  if (!isOneway && !isReverse) {
    // Two-way street: slight preference for points further from POI (better activation distance)
    const distanceFromPOI = Math.abs(pointIndex - closestIndex)
    return Math.min(0.3, distanceFromPOI / streetLength)
  }
  
  // One-way street: strong preference for upstream points
  let isUpstream = false
  
  if (isReverse) {
    // Reverse one-way: upstream = higher indices
    isUpstream = pointIndex > closestIndex
  } else {
    // Normal one-way: upstream = lower indices
    isUpstream = pointIndex < closestIndex
  }
  
  if (isUpstream) {
    // Upstream bonus: closer to beginning of upstream section = higher bonus
    const upstreamDistance = Math.abs(pointIndex - closestIndex)
    return Math.max(0.7, 1.0 - upstreamDistance / 10) // Strong upstream bonus
  } else {
    // Downstream penalty
    return 0.1 // Low score for downstream points
  }
}

// Helper function to check if a bearing is within a range
function isInBearingRange(bearing: number, range: [number, number]): boolean {
  const [start, end] = range
  
  // Handle wrap-around case (e.g., North: 315-45)
  if (start > end) {
    return bearing >= start || bearing <= end
  } else {
    return bearing >= start && bearing <= end
  }
}

// Calculate comprehensive POI confidence score
function calculatePOIConfidenceScore(
  boundary: any,
  triggerPoints: any[],
  source: string,
  landmarkInfo: { isHighVisibility: boolean, maxRange: number, elevationDiff: number }
) {
  console.log(`🎯 Calculating POI confidence score...`)
  
  // 1. Data Source Reliability (0-1)
  let sourceReliability = 0.5 // Default
  switch (source) {
    case 'osm_nominatim':
      sourceReliability = 0.95 // Highest - precise name-based match
      break
    case 'osm_overpass':
      sourceReliability = 0.85 // High - comprehensive area search
      break
    case 'fallback_street_analysis':
      sourceReliability = 0.65 // Medium - street-based estimation
      break
    default:
      sourceReliability = 0.4 // Low - estimated boundary
  }

  // 2. Boundary Quality (0-1)
  let boundaryQuality = boundary?.confidence || 0.5
  
  // Precision bonus based on boundary type and area
  if (boundary?.type === 'polygon') {
    boundaryQuality += 0.1 // Polygon more precise than circle
  }
  
  // Area reasonableness check
  const area = boundary?.area_m2 || 0
  if (area > 100 && area < 1000000) { // Reasonable POI size
    boundaryQuality += 0.1
  } else if (area >= 1000000 && area < 10000000) { // Large but reasonable (parks)
    boundaryQuality += 0.05
  }

  // 3. Trigger Points Quality (0-1)
  const tpCount = triggerPoints.length
  const primaryTPs = triggerPoints.filter(tp => tp.type === 'primary').length
  const secondaryTPs = triggerPoints.filter(tp => tp.type === 'secondary').length
  
  // TP count score
  let tpQuality = 0.3 // Base
  if (tpCount >= 3) tpQuality += 0.2 // Good coverage
  if (tpCount >= 6) tpQuality += 0.2 // Excellent coverage
  if (primaryTPs >= 2) tpQuality += 0.2 // Good primary coverage
  if (secondaryTPs >= 2) tpQuality += 0.1 // Good secondary coverage

  // 4. Coverage Completeness (0-1)
  // Analyze TP distribution around POI
  const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
  const coveredDirections = new Set()
  
  triggerPoints.forEach(tp => {
    if (tp.direction && directions.includes(tp.direction)) {
      coveredDirections.add(tp.direction)
    }
  })
  
  const directionCoverage = coveredDirections.size / directions.length
  
  // Distance distribution score
  const distances = triggerPoints.map(tp => tp.distance_from_poi)
  const hasCloseTP = distances.some(d => d <= 50)
  const hasMediumTP = distances.some(d => d > 50 && d <= 150)
  const hasFarTP = distances.some(d => d > 150)
  
  let distanceDistribution = 0.3 // Base
  if (hasCloseTP) distanceDistribution += 0.3
  if (hasMediumTP) distanceDistribution += 0.2
  if (hasFarTP) distanceDistribution += 0.2
  
  const coverageCompleteness = (directionCoverage * 0.6) + (distanceDistribution * 0.4)

  // 5. Landmark Bonus
  let landmarkBonus = 0
  if (landmarkInfo.isHighVisibility) {
    landmarkBonus = 0.1 // Bonus for successfully handling high-visibility landmarks
    // Extra bonus if we have distant TPs for landmarks
    if (distances.some(d => d > 1000)) {
      landmarkBonus += 0.05
    }
  }

  // 6. Visibility Quality
  const avgTPConfidence = triggerPoints.reduce((sum, tp) => sum + tp.confidence, 0) / triggerPoints.length || 0
  const visibilityCoverage = Math.min(1.0, avgTPConfidence)

  // Calculate component scores
  const boundaryScore = Math.min(1.0, boundaryQuality)
  const triggerPointsScore = Math.min(1.0, tpQuality)
  const sourceScore = sourceReliability
  const coverageScore = Math.min(1.0, coverageCompleteness)

  // Overall weighted score
  const overallScore = (
    boundaryScore * 0.25 +      // 25% boundary quality
    triggerPointsScore * 0.30 + // 30% TP quality
    sourceScore * 0.20 +        // 20% data source reliability
    coverageScore * 0.20 +      // 20% coverage completeness
    visibilityCoverage * 0.05   // 5% visibility quality
  ) + landmarkBonus

  const finalScore = Math.min(1.0, Math.max(0.0, overallScore))

  console.log(`📊 POI Confidence Score: ${(finalScore * 100).toFixed(1)}%`)
  console.log(`   - Boundary Quality: ${(boundaryScore * 100).toFixed(1)}%`)
  console.log(`   - Trigger Points: ${(triggerPointsScore * 100).toFixed(1)}%`)
  console.log(`   - Data Source: ${(sourceScore * 100).toFixed(1)}%`)
  console.log(`   - Coverage: ${(coverageScore * 100).toFixed(1)}%`)
  console.log(`   - Visibility: ${(visibilityCoverage * 100).toFixed(1)}%`)
  if (landmarkBonus > 0) {
    console.log(`   - Landmark Bonus: +${(landmarkBonus * 100).toFixed(1)}%`)
  }

  return {
    overall_score: Math.round(finalScore * 100) / 100, // Round to 2 decimals
    boundary_quality: Math.round(boundaryScore * 100) / 100,
    trigger_points_quality: Math.round(triggerPointsScore * 100) / 100,
    data_source_reliability: Math.round(sourceScore * 100) / 100,
    coverage_completeness: Math.round(coverageScore * 100) / 100,
    factors: {
      boundary_source: source,
      boundary_precision: Math.round((boundary?.confidence || 0) * 100) / 100,
      tp_count: tpCount,
      tp_distribution: Math.round(directionCoverage * 100) / 100,
      visibility_coverage: Math.round(visibilityCoverage * 100) / 100,
      landmark_bonus: Math.round(landmarkBonus * 100) / 100
    }
  }
}
