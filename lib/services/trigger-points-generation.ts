/**
 * Trigger Points Generation Service
 * 
 * Modular service for generating, validating and scoring trigger points
 * Extracted from the monolithic route for reusability across the CMS
 */

// Types
export interface TriggerPoint {
  lat: number
  lng: number
  type: 'primary' | 'secondary' | 'fallback'
  reasoning: string
  confidence: number
  distance_from_poi: number
  expected_bearing: number
  radius_meters: number
  street_name?: string
  highway_type?: string
  direction?: string
  individual_confidence_score?: number
  auto_status?: string
  final_status?: string
  score_factors?: {
    base_confidence: number
    distance_score: number
    type_bonus: string
    street_quality: string
    frontal_bonus: boolean
  }
  generation_method?: string
}

export interface Street {
  name: string
  highway_type: string
  coordinates: Array<{lat: number, lng: number}>
  distance_to_poi: number
  closestPoint: {lat: number, lng: number}
  oneway?: string
  tags?: any
}

export interface LandmarkInfo {
  isHighVisibility: boolean
  maxRange: number
  elevationDiff: number
}

export interface BoundaryCoordinates extends Array<{lat: number, lng: number}> {}

export interface GenerationResult {
  success: boolean
  trigger_points: TriggerPoint[]
  generation_method: string
  processing_notes?: string
  error?: string
}

export interface POIConfidenceScore {
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

export function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180

  const y = Math.sin(dLng) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)

  const bearing = Math.atan2(y, x) * 180 / Math.PI
  return (bearing + 360) % 360
}

/**
 * Find the closest point on a boundary polygon to a given trigger point
 * This enables accurate bearing calculation to the visible edge of the POI
 */
export function findClosestPointOnBoundary(
  triggerPoint: {lat: number, lng: number},
  boundaryCoordinates: BoundaryCoordinates
): {lat: number, lng: number, distance: number} {
  let closestPoint = boundaryCoordinates[0]
  let minDistance = calculateDistance(triggerPoint.lat, triggerPoint.lng, closestPoint.lat, closestPoint.lng)
  
  // Check all boundary points
  for (const point of boundaryCoordinates) {
    const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, point.lat, point.lng)
    if (distance < minDistance) {
      minDistance = distance
      closestPoint = point
    }
  }
  
  // Also check points along boundary edges for better precision
  for (let i = 0; i < boundaryCoordinates.length - 1; i++) {
    const edgeStart = boundaryCoordinates[i]
    const edgeEnd = boundaryCoordinates[i + 1]
    
    // Find closest point on this edge
    const closestOnEdge = findClosestPointOnLineSegment(triggerPoint, edgeStart, edgeEnd)
    const distanceToEdge = calculateDistance(triggerPoint.lat, triggerPoint.lng, closestOnEdge.lat, closestOnEdge.lng)
    
    if (distanceToEdge < minDistance) {
      minDistance = distanceToEdge
      closestPoint = closestOnEdge
    }
  }
  
  return {
    lat: closestPoint.lat,
    lng: closestPoint.lng,
    distance: minDistance
  }
}

/**
 * Find the closest point on a line segment to a given point
 */
function findClosestPointOnLineSegment(
  point: {lat: number, lng: number},
  lineStart: {lat: number, lng: number},
  lineEnd: {lat: number, lng: number}
): {lat: number, lng: number} {
  const dx = lineEnd.lng - lineStart.lng
  const dy = lineEnd.lat - lineStart.lat
  
  if (dx === 0 && dy === 0) {
    // Line segment is a point
    return lineStart
  }
  
  const t = Math.max(0, Math.min(1, 
    ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (dx * dx + dy * dy)
  ))
  
  return {
    lat: lineStart.lat + t * dy,
    lng: lineStart.lng + t * dx
  }
}

/**
 * Calculate bearing from trigger point to the closest point on POI boundary
 * This provides more accurate directional guidance than pointing to POI center
 */
export function calculateBearingToBoundary(
  triggerPoint: {lat: number, lng: number},
  boundaryCoordinates: BoundaryCoordinates,
  fallbackLat?: number,
  fallbackLng?: number
): {bearing: number, distance: number, targetPoint: {lat: number, lng: number}} {
  // If no boundary available, fallback to center point
  if (!boundaryCoordinates || boundaryCoordinates.length === 0) {
    if (fallbackLat !== undefined && fallbackLng !== undefined) {
      const bearing = calculateBearing(triggerPoint.lat, triggerPoint.lng, fallbackLat, fallbackLng)
      const distance = calculateDistance(triggerPoint.lat, triggerPoint.lng, fallbackLat, fallbackLng)
      return {
        bearing,
        distance,
        targetPoint: {lat: fallbackLat, lng: fallbackLng}
      }
    }
    return {bearing: 0, distance: 0, targetPoint: triggerPoint}
  }
  
  const closestPoint = findClosestPointOnBoundary(triggerPoint, boundaryCoordinates)
  const bearing = calculateBearing(triggerPoint.lat, triggerPoint.lng, closestPoint.lat, closestPoint.lng)
  
  return {
    bearing,
    distance: closestPoint.distance,
    targetPoint: {lat: closestPoint.lat, lng: closestPoint.lng}
  }
}

export function calculatePolygonArea(coordinates: BoundaryCoordinates): number {
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

export function isPointInPolygon(point: {lat: number, lng: number}, polygon: BoundaryCoordinates): boolean {
  let inside = false
  const x = point.lng, y = point.lat
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat
    const xj = polygon[j].lng, yj = polygon[j].lat
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  
  return inside
}

export function calculateDistanceToPolygon(point: {lat: number, lng: number}, polygon: BoundaryCoordinates): number {
  let minDistance = Infinity
  
  for (let i = 0; i < polygon.length - 1; i++) {
    const distance = calculateDistanceToLineSegment(point, polygon[i], polygon[i + 1])
    minDistance = Math.min(minDistance, distance)
  }
  
  return minDistance
}

export function calculateDistanceToLineSegment(
  point: {lat: number, lng: number},
  lineStart: {lat: number, lng: number},
  lineEnd: {lat: number, lng: number}
): number {
  // Convert to simple distance calculation for line segment
  const A = point.lng - lineStart.lng
  const B = point.lat - lineStart.lat
  const C = lineEnd.lng - lineStart.lng
  const D = lineEnd.lat - lineStart.lat

  const dot = A * C + B * D
  const lenSq = C * C + D * D
  let param = -1
  if (lenSq !== 0) {
    param = dot / lenSq
  }

  let xx, yy

  if (param < 0) {
    xx = lineStart.lng
    yy = lineStart.lat
  } else if (param > 1) {
    xx = lineEnd.lng
    yy = lineEnd.lat
  } else {
    xx = lineStart.lng + param * C
    yy = lineStart.lat + param * D
  }

  const dx = point.lng - xx
  const dy = point.lat - yy
  return Math.sqrt(dx * dx + dy * dy) * 111000 // Convert to meters
}

// Core Trigger Points Generation Service
export class TriggerPointsService {

  /**
   * Main trigger points generation method
   * Tries street-based generation first, falls back to boundary-based
   */
  static async generateTriggerPoints(
    boundary: any,
    poiLat: number,
    poiLng: number,
    poiName: string,
    streets: Street[],
    landmarkInfo?: LandmarkInfo
  ): Promise<GenerationResult> {
    console.log('🛣️ Generating trigger points using TriggerPointsService')

    try {
      // Strategy 1: Street-based generation (preferred)
      if (streets && streets.length > 0) {
        console.log(`🔍 Using street-based generation with ${streets.length} streets`)
        
        const streetTriggerPoints = await this.generateStreetBasedTriggerPoints(
          poiLat,
          poiLng,
          boundary.coordinates,
          streets,
          landmarkInfo
        )

        if (streetTriggerPoints.length > 0) {
          return {
            success: true,
            trigger_points: streetTriggerPoints,
            generation_method: 'street_based',
            processing_notes: `Generated ${streetTriggerPoints.length} street-based trigger points`
          }
        }
      }

      // Strategy 2: Boundary-based generation (fallback)
      console.log('⚠️ Falling back to boundary-based trigger points')
      const boundaryTriggerPoints = await this.generateBoundaryBasedTriggerPoints(
        boundary,
        poiLat,
        poiLng,
        poiName
      )

      return {
        success: true,
        trigger_points: boundaryTriggerPoints,
        generation_method: 'boundary_based',
        processing_notes: `Generated ${boundaryTriggerPoints.length} boundary-based trigger points (fallback)`
      }

    } catch (error) {
      console.error('❌ Error generating trigger points:', error)
      return {
        success: false,
        trigger_points: [],
        generation_method: 'failed',
        error: `Trigger points generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Generate trigger points based on street analysis
   */
  static async generateStreetBasedTriggerPoints(
    poiLat: number,
    poiLng: number,
    boundaryCoordinates: BoundaryCoordinates,
    streets: Street[],
    landmarkInfo?: LandmarkInfo
  ): Promise<TriggerPoint[]> {
    const triggerPoints: TriggerPoint[] = []
    
    for (const street of streets) {
      // Find strategic points on this street
      const streetPoints = await this.findStrategicPointsOnStreet(
        street,
        poiLat,
        poiLng,
        boundaryCoordinates,
        landmarkInfo
      )
      
      // Debug logging for distant streets
      if (street.distance_to_poi > 1000) {
        console.log(`🛣️ Distant street ${street.name} (${street.distance_to_poi.toFixed(0)}m) generated ${streetPoints.length} points`)
      }
      
      triggerPoints.push(...streetPoints)
    }

    // Calculate POI area for dynamic filtering
    const poiArea = calculatePolygonArea(boundaryCoordinates)
    
    // Dynamic minimum distance based on landmark info and POI size
    let minPointDistance = 50 // Default
    if (landmarkInfo?.isHighVisibility) {
      minPointDistance = 100 // High-visibility landmarks: more spread out
      console.log(`🏔️ High-visibility landmark: using minPointDistance=${minPointDistance}m`)
    } else if (poiArea > 1000000) {
      minPointDistance = 30 // Large areas: closer points OK
    } else if (poiArea > 100000) {
      minPointDistance = 40 // Medium areas
    } else if (poiArea < 50000) {
      minPointDistance = 60 // Small areas: spread out more
    }
    
    // Remove duplicates and classify
    const filteredPoints = this.removeDuplicatePoints(triggerPoints, minPointDistance)
    const classifiedPoints = this.classifyTriggerPointsByStreet(filteredPoints, poiLat, poiLng)

    // Dynamic limit based on landmark info and POI size
    let maxPoints = 15 // Default
    if (landmarkInfo?.isHighVisibility) {
      maxPoints = 25 // High-visibility landmarks need more coverage
    } else if (poiArea > 1000000) {
      maxPoints = 20 // Large POIs need more points
    } else if (poiArea < 50000) {
      maxPoints = 10 // Small POIs need fewer points
    }

    const limitedPoints = classifiedPoints.slice(0, maxPoints)
    
    // Apply spacing filter to prevent overlapping trigger points
    const finalPoints = this.filterTriggerPointsBySpacing(limitedPoints, minPointDistance)
    
    console.log(`📍 Generated ${finalPoints.length} street-based trigger points (after spacing filter)`)
    
    return finalPoints
  }

  /**
   * Filter trigger points to maintain minimum spacing between them
   * This prevents overlapping trigger points in fallback scenarios
   */
  static filterTriggerPointsBySpacing(
    triggerPoints: TriggerPoint[],
    minSpacingMeters: number = 60 // Minimum 60m between trigger points
  ): TriggerPoint[] {
    if (triggerPoints.length <= 1) return triggerPoints

    const filtered: TriggerPoint[] = []
    const sortedByPriority = [...triggerPoints].sort((a, b) => {
      // Sort by priority: primary > secondary > fallback
      const priorityOrder = { primary: 3, secondary: 2, fallback: 1 }
      const priorityDiff = (priorityOrder[a.type] || 0) - (priorityOrder[b.type] || 0)
      if (priorityDiff !== 0) return priorityDiff
      
      // If same priority, sort by confidence (higher first)
      return (b.confidence || 0) - (a.confidence || 0)
    })

    for (const tp of sortedByPriority) {
      // Check if this trigger point is too close to any already accepted one
      const isTooClose = filtered.some(existingTp => {
        const distance = calculateDistance(tp.lat, tp.lng, existingTp.lat, existingTp.lng)
        return distance < minSpacingMeters
      })

      if (!isTooClose) {
        filtered.push(tp)
      }
    }

    console.log(`🔍 Spacing filter: ${triggerPoints.length} → ${filtered.length} trigger points (min spacing: ${minSpacingMeters}m)`)
    return filtered
  }

  /**
   * Generate trigger points based on boundary geometry (fallback)
   */
  static async generateBoundaryBasedTriggerPoints(
    boundary: any,
    poiLat: number,
    poiLng: number,
    poiName: string
  ): Promise<TriggerPoint[]> {
    console.log('🎯 Generating boundary-based trigger points')
    
    const triggerPoints: TriggerPoint[] = []
    const coordinates = boundary.coordinates

    // Calculate POI area to determine appropriate offset distances
    const poiArea = calculatePolygonArea(coordinates)
    const poiRadius = Math.sqrt(poiArea / Math.PI) // Approximate radius
    
    // Adaptive offset based on POI size (much more conservative)
    let edgeOffset = Math.min(30, Math.max(15, poiRadius * 0.3)) // 15-30m based on size
    let cornerOffset = Math.min(40, Math.max(20, poiRadius * 0.4)) // 20-40m based on size
    
    console.log(`📐 POI area: ${Math.round(poiArea)}m², radius: ${Math.round(poiRadius)}m, offsets: edge=${Math.round(edgeOffset)}m, corner=${Math.round(cornerOffset)}m`)

    // Strategy: Points along polygon edges, offset outward for street positioning
    for (let i = 0; i < coordinates.length - 1; i += Math.max(1, Math.floor(coordinates.length / 12))) {
      const point = coordinates[i]
      
      // Use adaptive offset instead of fixed 75m
      const offsetPoint = this.offsetPointFromCenter(point.lat, point.lng, poiLat, poiLng, edgeOffset)
      
      // Use boundary-aware bearing and distance calculation
      const boundaryResult = calculateBearingToBoundary(offsetPoint, coordinates, poiLat, poiLng)
      const distance = boundaryResult.distance
      const bearing = boundaryResult.bearing
      
      // Determine priority based on position
      const type = i < 4 ? 'primary' : i < 8 ? 'secondary' : 'fallback'
      
      // Calculate auto_status based on confidence and type
      const auto_status = type === 'primary' ? 'approved' : type === 'secondary' ? 'approved' : 'review'
      
      triggerPoints.push({
        lat: offsetPoint.lat,
        lng: offsetPoint.lng,
        type,
        reasoning: `Strategic point ${i + 1} based on boundary geometry (${Math.round(edgeOffset)}m offset)`,
        confidence: 0.7,
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 20,
        auto_status,
        final_status: auto_status,
        individual_confidence_score: 0.7
      })
    }

    // Add strategic corner points
    const corners = this.findPolygonCorners(coordinates, poiLat, poiLng)
    corners.forEach((corner, index) => {
      // Use adaptive offset instead of fixed 100m
      const offsetCorner = this.offsetPointFromCenter(corner.lat, corner.lng, poiLat, poiLng, cornerOffset)
      
      // Use boundary-aware bearing and distance calculation
      const boundaryResult = calculateBearingToBoundary(offsetCorner, coordinates, poiLat, poiLng)
      const distance = boundaryResult.distance
      const bearing = boundaryResult.bearing
      
      const type = index < 2 ? 'primary' : 'secondary'
      const auto_status = 'approved' // Corner points are strategic and approved
      
      triggerPoints.push({
        lat: offsetCorner.lat,
        lng: offsetCorner.lng,
        type,
        reasoning: `Strategic corner point with optimal POI visibility (${Math.round(cornerOffset)}m offset)`,
        confidence: 0.8,
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 25,
        auto_status,
        final_status: auto_status,
        individual_confidence_score: 0.8
      })
    })

    // Apply spacing filter to prevent overlapping trigger points
    const filteredTriggerPoints = this.filterTriggerPointsBySpacing(triggerPoints, 60)
    
    console.log(`✅ Generated ${filteredTriggerPoints.length} boundary-based trigger points (after spacing filter)`)
    return filteredTriggerPoints
  }

  /**
   * Find strategic points on a specific street
   */
  static async findStrategicPointsOnStreet(
    street: Street,
    poiLat: number,
    poiLng: number,
    boundaryCoordinates: BoundaryCoordinates,
    landmarkInfo?: LandmarkInfo
  ): Promise<TriggerPoint[]> {
    const points: TriggerPoint[] = []
    
    // Find optimal point on this street
    const optimalPoint = this.findOptimalPointOnStreet(street, poiLat, poiLng, boundaryCoordinates, landmarkInfo)
    
    if (optimalPoint) {
      // Use boundary-aware bearing and distance calculation
      const boundaryResult = calculateBearingToBoundary(
        {lat: optimalPoint.lat, lng: optimalPoint.lng}, 
        boundaryCoordinates, 
        poiLat, 
        poiLng
      )
      const distance = boundaryResult.distance
      const bearing = boundaryResult.bearing
      
      // Determine type based on distance and street quality
      let type: 'primary' | 'secondary' | 'fallback' = 'secondary'
      if (distance <= 50 && street.highway_type && ['primary', 'secondary', 'tertiary'].includes(street.highway_type)) {
        type = 'primary'
      } else if (distance > 200) {
        type = 'fallback'
      }
      
      // Calculate confidence based on multiple factors
      let confidence = 0.6 // Base confidence
      confidence += this.calculateStreetConfidence(street.tags || {}, distance)
      
      // Calculate auto_status based on confidence and type
      let auto_status = 'review'
      if (confidence >= 0.75 || type === 'primary') {
        auto_status = 'approved'
      } else if (confidence < 0.5) {
        auto_status = 'rejected'
      }
      
      points.push({
        lat: optimalPoint.lat,
        lng: optimalPoint.lng,
        type,
        reasoning: optimalPoint.reasoning || `Optimal point on ${street.name}`,
        confidence: Math.min(0.95, confidence),
        distance_from_poi: distance,
        expected_bearing: bearing,
        radius_meters: 20,
        street_name: street.name,
        highway_type: street.highway_type,
        auto_status,
        final_status: auto_status,
        individual_confidence_score: Math.min(0.95, confidence)
      })
    }
    
    return points
  }

  /**
   * Find optimal point on street with validation
   */
  static findOptimalPointOnStreet(
    street: Street,
    poiLat: number,
    poiLng: number,
    boundaryCoordinates?: BoundaryCoordinates,
    landmarkInfo?: LandmarkInfo
  ): {lat: number, lng: number, reasoning: string} | null {
    const coordinates = street.coordinates
    const streetLength = coordinates.length
    const step = Math.max(1, Math.floor(streetLength / 20)) // Sample ~20 points max
    const candidatePoints: Array<{lat: number, lng: number, score: number, reasoning: string}> = []
    
    for (let i = 0; i < streetLength; i += step) {
      const point = coordinates[i]
      const distanceToPOI = calculateDistance(poiLat, poiLng, point.lat, point.lng)
      
      // Check if point is outside boundary (if provided)
      const isOutsideBoundary = boundaryCoordinates ? !isPointInPolygon(point, boundaryCoordinates) : true
      const minDistanceFromBoundary = boundaryCoordinates ? calculateDistanceToPolygon(point, boundaryCoordinates) : 0
      
      // Dynamic distance limits based on landmark info
      let minDistance = 10
      let maxDistance = 200 // Increased from 120m to 800m for better urban coverage
      
      if (landmarkInfo?.isHighVisibility) {
        // For high-visibility landmarks: much larger range
        minDistance = 80
        maxDistance = landmarkInfo.maxRange || 4000 // Use landmark's max range
      }
      
      // Ensure point is outside boundary AND at appropriate distance for landmark type
      if (isOutsideBoundary && minDistanceFromBoundary >= 10 && distanceToPOI >= minDistance && distanceToPOI <= maxDistance) {
        
        // Enhanced validation: Bearing position (with boundary awareness)
        const bearingValidation = this.validateBearingPosition(point, poiLat, poiLng, street, i, coordinates, boundaryCoordinates)
        
        if (bearingValidation.isValid) {
          let score = 0
          
          // Factor 1: Distance score (adaptive based on landmark type)
          let distanceScore = 0.5 // Base score
          
          if (landmarkInfo?.isHighVisibility) {
            // For landmarks: variety of distances is good, distant points get bonus
            if (distanceToPOI >= 1000 && distanceToPOI <= 3000) {
              distanceScore = 1.0 // Sweet spot for landmarks
            } else if (distanceToPOI >= 500 && distanceToPOI < 1000) {
              distanceScore = 0.8 // Good medium distance
            } else if (distanceToPOI >= 100 && distanceToPOI < 500) {
              distanceScore = 0.7 // Acceptable close distance
            } else {
              distanceScore = 0.4 // Very close or very far
            }
          } else {
            // For regular POIs: closer is better
            distanceScore = distanceToPOI >= 25 && distanceToPOI <= 40 ? 1.0 : 
              Math.max(0.3, 1.0 - Math.abs(distanceToPOI - 32.5) / 30)
          }
          
          score += distanceScore * 0.4
          
          // Factor 2: Bearing validation score
          score += bearingValidation.score * 0.4
          
          // Factor 3: Line of sight score (simplified)
          const lineOfSightScore = distanceToPOI <= 50 ? 0.9 : 0.7
          score += lineOfSightScore * 0.2
          
          candidatePoints.push({
            lat: point.lat,
            lng: point.lng,
            score: score,
            reasoning: bearingValidation.reasoning
          })
        }
      }
    }
    
    if (candidatePoints.length === 0) {
      return null
    }
    
    // Return the highest scoring point
    candidatePoints.sort((a, b) => b.score - a.score)
    return candidatePoints[0]
  }

  /**
   * Validate bearing position for trigger point
   */
  static validateBearingPosition(
    triggerPoint: {lat: number, lng: number},
    poiLat: number,
    poiLng: number,
    street: Street,
    pointIndex: number,
    coordinates: Array<{lat: number, lng: number}>,
    boundaryCoordinates?: BoundaryCoordinates
  ): {isValid: boolean, score: number, reasoning: string} {
    // Calculate bearing from trigger point to closest boundary point (or POI center as fallback)
    const boundaryResult = calculateBearingToBoundary(triggerPoint, boundaryCoordinates || [], poiLat, poiLng)
    const bearing = boundaryResult.bearing
    
    // Check if this is a one-way street
    const isOneway = street.oneway === 'yes' || street.oneway === '1' || street.oneway === 'true'
    const isReverse = street.oneway === '-1' || street.oneway === 'reverse'
    
    let score = 0.5 // Base score
    let reasoning = `Bearing ${bearing.toFixed(0)}°`
    
    if (isOneway) {
      // For one-way streets, prefer points upstream (before POI in traffic flow)
      const closestIndex = this.findClosestPointIndexOnStreet(coordinates, poiLat, poiLng)
      const isUpstream = isReverse ? pointIndex > closestIndex : pointIndex < closestIndex
      
      if (isUpstream) {
        score += 0.3
        reasoning += ` (upstream on one-way)`
      } else {
        score += 0.1
        reasoning += ` (downstream on one-way)`
      }
    } else {
      // For two-way streets, slight preference for points further from POI
      const distanceFromClosest = Math.abs(pointIndex - this.findClosestPointIndexOnStreet(coordinates, poiLat, poiLng))
      score += Math.min(0.2, distanceFromClosest / coordinates.length)
      reasoning += ` (two-way street)`
    }
    
    // Street direction validation
    if (coordinates.length > pointIndex + 1) {
      const streetDirection = this.calculateStreetDirection(coordinates, pointIndex)
      const angleDiff = this.normalizeAngleDifference(Math.abs(bearing - streetDirection))
      
      if (angleDiff < 45) {
        score += 0.2
        reasoning += ` (good alignment)`
      } else if (angleDiff > 135) {
        score += 0.1
        reasoning += ` (opposite direction)`
      }
    }
    
    return {
      isValid: score > 0.3,
      score: Math.min(1.0, score),
      reasoning
    }
  }

  /**
   * Calculate street confidence based on tags and distance
   */
  static calculateStreetConfidence(tags: any, distance: number): number {
    let confidence = 0
    
    // Highway type scoring
    const highway = tags.highway
    if (highway) {
      switch (highway) {
        case 'motorway':
        case 'trunk':
          confidence += 0.1
          break
        case 'primary':
        case 'secondary':
          confidence += 0.15
          break
        case 'tertiary':
        case 'residential':
          confidence += 0.1
          break
        case 'service':
        case 'pedestrian':
          confidence += 0.05
          break
      }
    }
    
    // Distance scoring
    if (distance <= 50) confidence += 0.2
    else if (distance <= 100) confidence += 0.15
    else if (distance <= 200) confidence += 0.1
    else confidence += 0.05
    
    // Named street bonus
    if (tags.name) confidence += 0.05
    
    return confidence
  }

  /**
   * Remove duplicate points that are too close to each other
   */
  static removeDuplicatePoints(points: TriggerPoint[], minDistance: number): TriggerPoint[] {
    const filtered: TriggerPoint[] = []
    
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

  /**
   * Classify trigger points by priority and street quality
   */
  static classifyTriggerPointsByStreet(points: TriggerPoint[], poiLat: number, poiLng: number): TriggerPoint[] {
    // Sort by confidence and distance
    points.sort((a, b) => {
      // Primary sort by confidence
      if (Math.abs(a.confidence - b.confidence) > 0.1) {
        return b.confidence - a.confidence
      }
      // Secondary sort by distance (closer is better for most cases)
      return a.distance_from_poi - b.distance_from_poi
    })
    
    // Assign types based on sorted order
    points.forEach((point, index) => {
      if (index < 3) {
        point.type = 'primary'
      } else if (index < 8) {
        point.type = 'secondary'
      } else {
        point.type = 'fallback'
      }
    })
    
    return points
  }

  // Helper Methods
  static offsetPointFromCenter(
    pointLat: number,
    pointLng: number,
    centerLat: number,
    centerLng: number,
    offsetMeters: number
  ): {lat: number, lng: number} {
    // Calculate direction from center to point
    const bearing = calculateBearing(centerLat, centerLng, pointLat, pointLng)
    const bearingRad = bearing * Math.PI / 180
    
    // Calculate offset in degrees
    const offsetLat = offsetMeters / 111000 // ~111km per degree
    const offsetLng = offsetMeters / (111000 * Math.cos(pointLat * Math.PI / 180))
    
    return {
      lat: pointLat + offsetLat * Math.cos(bearingRad),
      lng: pointLng + offsetLng * Math.sin(bearingRad)
    }
  }

  static findPolygonCorners(
    coordinates: BoundaryCoordinates,
    centerLat: number,
    centerLng: number
  ): Array<{lat: number, lng: number}> {
    const corners: Array<{lat: number, lng: number, distance: number}> = []
    
    // Find points that are furthest from center (likely corners)
    coordinates.forEach(coord => {
      const distance = calculateDistance(centerLat, centerLng, coord.lat, coord.lng)
      corners.push({...coord, distance})
    })
    
    // Sort by distance and return top 4 corners
    corners.sort((a, b) => b.distance - a.distance)
    return corners.slice(0, 4).map(({lat, lng}) => ({lat, lng}))
  }

  static findClosestPointIndexOnStreet(coordinates: Array<{lat: number, lng: number}>, poiLat: number, poiLng: number): number {
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

  static calculateStreetDirection(coordinates: Array<{lat: number, lng: number}>, pointIndex: number): number {
    const coordLength = coordinates.length
    
    // Get direction vector from this point to next (or previous if at end)
    let nextIndex = pointIndex + 1
    if (nextIndex >= coordLength) {
      nextIndex = pointIndex - 1
    }
    
    if (nextIndex < 0 || nextIndex >= coordLength) {
      return 0 // Fallback
    }
    
    return calculateBearing(
      coordinates[pointIndex].lat,
      coordinates[pointIndex].lng,
      coordinates[nextIndex].lat,
      coordinates[nextIndex].lng
    )
  }

  static normalizeAngleDifference(angleDiff: number): number {
    while (angleDiff > 180) angleDiff -= 360
    while (angleDiff < -180) angleDiff += 360
    return Math.abs(angleDiff)
  }

  /**
   * Calculate individual trigger point confidence score
   */
  static calculateTriggerPointScore(
    tp: TriggerPoint,
    boundary: any,
    landmarkInfo: LandmarkInfo
  ): number {
    let score = tp.confidence || 0.5 // Base TP confidence
    
    // Distance quality (closer is generally better, but depends on POI type)
    const distance = tp.distance_from_poi
    if (landmarkInfo.isHighVisibility) {
      // For landmarks: variety of distances is good
      if (distance <= 100) score += 0.2      // Close viewpoints
      else if (distance <= 500) score += 0.25 // Medium viewpoints  
      else if (distance <= 2000) score += 0.3 // Distant viewpoints (best for landmarks)
      else score += 0.1                       // Very distant
    } else {
      // For regular POIs: closer is better
      if (distance <= 50) score += 0.3       // Excellent proximity
      else if (distance <= 100) score += 0.25 // Good proximity
      else if (distance <= 200) score += 0.15 // Acceptable
      else score += 0.05                      // Too far
    }
    
    // Type quality
    if (tp.type === 'primary') score += 0.15
    else if (tp.type === 'secondary') score += 0.1
    else score += 0.05 // fallback
    
    // Street quality (if available)
    if (tp.highway_type) {
      if (['motorway', 'trunk', 'primary'].includes(tp.highway_type)) score += 0.1
      else if (['secondary', 'tertiary'].includes(tp.highway_type)) score += 0.05
    }
    
    // Named street bonus
    if (tp.street_name && tp.street_name !== 'Unnamed Street') score += 0.05
    
    // Frontal street bonus (if reasoning indicates frontal)
    if (tp.reasoning && tp.reasoning.includes('frontal street')) score += 0.1
    
    return Math.min(1.0, Math.max(0.0, score))
  }

  /**
   * Calculate status based on confidence score
   */
  static calculateTriggerPointStatus(score: number): string {
    if (score >= 0.75) return 'approved'
    if (score >= 0.50) return 'review'
    else return 'rejected'
  }

  /**
   * Enhance trigger points with scoring and status
   */
  static enhanceTriggerPoints(
    triggerPoints: TriggerPoint[],
    boundary: any,
    landmarkInfo: LandmarkInfo,
    generationMethod: string
  ): TriggerPoint[] {
    return triggerPoints.map(tp => {
      const individualScore = this.calculateTriggerPointScore(tp, boundary, landmarkInfo)
      const autoStatus = this.calculateTriggerPointStatus(individualScore)
      
      return {
        ...tp,
        individual_confidence_score: Math.round(individualScore * 100) / 100,
        auto_status: autoStatus,
        final_status: autoStatus, // No manual override yet
        score_factors: {
          base_confidence: tp.confidence,
          distance_score: tp.distance_from_poi,
          type_bonus: tp.type,
          street_quality: tp.highway_type || 'unknown',
          frontal_bonus: tp.reasoning?.includes('frontal street') || false
        },
        generation_method: generationMethod
      }
    })
  }

  /**
   * Calculate comprehensive POI confidence score
   */
  static calculatePOIConfidenceScore(
    boundary: any,
    triggerPoints: TriggerPoint[],
    source: string,
    landmarkInfo: LandmarkInfo
  ): POIConfidenceScore {
    console.log(`🎯 Calculating POI confidence score...`)
    
    // 1. Data Source Reliability (0-1)
    let sourceReliability = 0.5 // Default
    switch (source) {
      case 'osm_name':
        sourceReliability = 0.95 // Highest - precise name-based match
        break
      case 'osm_coordinates':
        sourceReliability = 0.9 // High - coordinate-based match
        break
      case 'osm_nearby':
        sourceReliability = 0.85 // High - comprehensive area search
        break
      case 'street_based':
        sourceReliability = 0.75 // Good - street analysis
        break
      case 'boundary_based':
        sourceReliability = 0.6 // Medium - boundary estimation
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

    return {
      overall_score: Math.round(finalScore * 100) / 100,
      boundary_quality: Math.round(boundaryScore * 100) / 100,
      trigger_points_quality: Math.round(triggerPointsScore * 100) / 100,
      data_source_reliability: Math.round(sourceScore * 100) / 100,
      coverage_completeness: Math.round(coverageScore * 100) / 100,
      factors: {
        boundary_source: source,
        boundary_precision: boundary?.confidence || 0,
        tp_count: tpCount,
        tp_distribution: Math.round(directionCoverage * 100) / 100,
        visibility_coverage: Math.round(visibilityCoverage * 100) / 100,
        landmark_bonus: Math.round(landmarkBonus * 100) / 100
      }
    }
  }
}
