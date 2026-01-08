import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

interface POIAreaAnalysis {
  areaType: 'lake' | 'park' | 'building' | 'monument' | 'shopping_center' | 'museum' | 'natural_area' | 'urban_area'
  estimatedSize: number // em metros quadrados
  perimeter: number // em metros
  boundingBox: {
    north: number
    south: number
    east: number
    west: number
  }
  accessPoints: Array<{
    lat: number
    lng: number
    type: 'road' | 'path' | 'entrance'
    roadName?: string
  }>
  surroundingRoads: Array<{
    lat: number
    lng: number
    roadName: string
    roadType: string
    distance: number
  }>
  visibilityPoints: Array<{
    lat: number
    lng: number
    elevation?: number
    viewQuality: 'excellent' | 'good' | 'fair'
  }>
}

interface LocationAnalysis {
  poiData: {
    lat: number
    lng: number
    name: string
    types: string[]
  }
  poiArea: POIAreaAnalysis
  nearbyRoads: RoadSegment[]
  transportInfrastructure: TransportPoint[]
  touristHotspots: TouristPoint[]
  parkingAreas: ParkingArea[]
  recommendedTriggerPoints: RecommendedTriggerPoint[]
  analysisTimestamp: string
}

interface RoadSegment {
  location: { lat: number, lng: number }
  roadType: 'highway' | 'primary' | 'secondary' | 'residential'
  trafficVolume: 'high' | 'medium' | 'low'
  speedLimit: number
  hasPOIView: boolean
  distanceToPOI: number
  bearingToPOI: number
  confidence: number
}

interface TransportPoint {
  type: 'bus_stop' | 'train_station' | 'parking' | 'rest_area' | 'gas_station'
  location: { lat: number, lng: number }
  name: string
  distanceToPOI: number
  passengerVolume: 'high' | 'medium' | 'low'
  hasPOIView: boolean
  confidence: number
}

interface TouristPoint {
  type: 'tourist_attraction' | 'park' | 'museum' | 'landmark' | 'viewpoint'
  location: { lat: number, lng: number }
  name: string
  rating: number
  distanceToPOI: number
  hasPOIView: boolean
  confidence: number
}

interface ParkingArea {
  type: 'parking' | 'rest_area' | 'scenic_pullout'
  location: { lat: number, lng: number }
  name: string
  capacity: 'large' | 'medium' | 'small'
  distanceToPOI: number
  hasPOIView: boolean
  confidence: number
}

interface RecommendedTriggerPoint {
  location: { lat: number, lng: number }
  type: 'primary' | 'secondary' | 'fallback'
  priority: number
  radius_meters: number
  expected_bearing: number
  access_type: 'car' | 'walk' | 'both'
  reasoning: string
  confidence: number
  source: 'road_analysis' | 'transport' | 'tourist' | 'parking' | 'area_analysis'
}

export async function POST(request: NextRequest) {
  // TEMPORARILY DISABLED - AI trigger points functionality
  console.log('🚫 Location analysis API temporarily disabled')
  
  // Require admin for analysis endpoints
  const cookieStore = await cookies()
  const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
  const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
  if (authError || !session) {
    return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
  }
  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single()
  if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 403 })
  }

  return NextResponse.json(
    { 
      error: 'Location analysis API is temporarily disabled',
      details: 'AI trigger points functionality has been temporarily disabled'
    },
    { status: 503 }
  )
}

async function analyzePOIArea(poiLat: number, poiLng: number, apiKey: string): Promise<POIAreaAnalysis> {
  console.log('🔍 Analyzing POI area intelligently...')
  
  try {
    // 1. Buscar dados mais abrangentes para entender o contexto real
    const placesResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${poiLat},${poiLng}&radius=500&key=${apiKey}`
    )
    const placesData = await placesResponse.json()
    
    // 2. Buscar especificamente por características naturais (água, parques)
    const naturalResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${poiLat},${poiLng}&radius=300&type=natural_feature&key=${apiKey}`
    )
    const naturalData = await naturalResponse.json()
    
    // 3. Buscar por parques e áreas recreativas
    const parkResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${poiLat},${poiLng}&radius=300&type=park&key=${apiKey}`
    )
    const parkData = await parkResponse.json()
    
    // 4. Usar Google Geocoding API para informações geográficas detalhadas
    const geocodeResponse = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${poiLat},${poiLng}&key=${apiKey}`
    )
    const geocodeData = await geocodeResponse.json()
    
         // 5. Buscar vias de todos os tipos ao redor da área real
     const mainRoadKeywords = ['highway', 'road', 'street', 'avenue', 'bridge', 'marginal', 'rodovia', 'avenida']
     const smallRoadKeywords = ['rua', 'alameda', 'travessa', 'viela', 'estrada', 'caminho']
     const roadResults = []
     
     // Buscar vias principais (radius maior)
     for (const keyword of mainRoadKeywords) {
       const roadResponse = await fetch(
         `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${poiLat},${poiLng}&radius=800&type=establishment&keyword=${keyword}&key=${apiKey}`
       )
       const roadData = await roadResponse.json()
       if (roadData.results) {
         roadResults.push(...roadData.results)
       }
     }
     
     // NOVO: Buscar vias menores (radius menor, mais próximas ao lago)
     for (const keyword of smallRoadKeywords) {
       const smallRoadResponse = await fetch(
         `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${poiLat},${poiLng}&radius=400&type=establishment&keyword=${keyword}&key=${apiKey}`
       )
       const smallRoadData = await smallRoadResponse.json()
       if (smallRoadData.results) {
         roadResults.push(...smallRoadData.results)
         console.log(`🔍 Found ${smallRoadData.results.length} small roads for keyword: ${keyword}`)
       }
     }
     
     // NOVO: Buscar também por tipos específicos de vias
     const roadTypes = ['route', 'sublocality', 'neighborhood']
     for (const type of roadTypes) {
       const typeResponse = await fetch(
         `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${poiLat},${poiLng}&radius=500&type=${type}&key=${apiKey}`
       )
       const typeData = await typeResponse.json()
       if (typeData.results) {
         roadResults.push(...typeData.results)
         console.log(`🔍 Found ${typeData.results.length} roads of type: ${type}`)
       }
     }
    
    // 6. Determinar tipo de área baseado em evidências reais
    const areaType = determineAreaTypeIntelligently(placesData, naturalData, parkData, geocodeData, poiLat, poiLng)
    
    // 7. Calcular tamanho real baseado nos dados coletados
    const estimatedSize = calculateRealAreaSize(placesData, naturalData, parkData, roadResults, areaType, poiLat, poiLng)
    
    // 8. Identificar pontos de acesso reais
    const accessPoints = identifyRealAccessPoints(roadResults, placesData, poiLat, poiLng, areaType)
    
    // 9. Mapear vias ao redor baseado em dados reais
    const surroundingRoads = mapRealSurroundingRoads(roadResults, geocodeData, poiLat, poiLng, areaType)
    
    // 10. Identificar pontos de visibilidade estratégicos
    const visibilityPoints = identifyStrategicVisibilityPoints(placesData, naturalData, parkData, poiLat, poiLng, areaType, estimatedSize)
    
    // 11. Calcular bounding box real
    const boundingBox = calculateRealBoundingBox(placesData, naturalData, parkData, poiLat, poiLng, estimatedSize)
    
    // 12. Calcular perímetro real
    const perimeter = calculateRealPerimeter(estimatedSize, areaType, boundingBox)
    
    const analysis: POIAreaAnalysis = {
      areaType,
      estimatedSize,
      perimeter,
      boundingBox,
      accessPoints,
      surroundingRoads,
      visibilityPoints
    }
    
    console.log(`✅ Intelligent POI Area Analysis complete: ${areaType} - ${estimatedSize}m²`)
    return analysis
    
  } catch (error) {
    console.error('❌ Error analyzing POI area:', error)
    return {
      areaType: 'urban_area',
      estimatedSize: 10000,
      perimeter: 400,
      boundingBox: {
        north: poiLat + 0.001,
        south: poiLat - 0.001,
        east: poiLng + 0.001,
        west: poiLng - 0.001
      },
      accessPoints: [],
      surroundingRoads: [],
      visibilityPoints: []
    }
  }
}

async function analyzeNearbyRoadsWithArea(poiLat: number, poiLng: number, poiArea: POIAreaAnalysis, radius: number, apiKey: string): Promise<RoadSegment[]> {
  console.log('🛣️ Analyzing nearby roads with area context...')
  
  try {
    const roadSegments: RoadSegment[] = []
    
    // Usar as vias já identificadas na análise da área
    poiArea.surroundingRoads.forEach((road, index) => {
      roadSegments.push({
        location: { lat: road.lat, lng: road.lng },
        roadType: road.roadType as any,
        trafficVolume: road.roadType === 'primary' ? 'high' : 'medium',
        speedLimit: road.roadType === 'primary' ? 60 : 40,
        hasPOIView: true,
        distanceToPOI: road.distance,
        bearingToPOI: calculateBearing(road.lat, road.lng, poiLat, poiLng),
        confidence: 0.8
      })
    })
    
    // Buscar vias adicionais usando Places API
    const roadKeywords = [
      'highway', 'rodovia', 'expressway', 'avenue', 'avenida', 'street', 'rua',
      'bridge', 'ponte', 'overpass', 'viaduto', 'marginal', 'estrada'
    ]
    
    for (const keyword of roadKeywords) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type: 'establishment',
        keyword,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          const bearing = calculateBearing(place.geometry.location.lat, place.geometry.location.lng, poiLat, poiLng)
          
          // Filtrar apenas vias que realmente têm vista para o POI
          if (distance <= 800 && hasGoodPOIView(place.name, place.types, distance)) {
            const roadType = classifyRoadType(place.name, place.types)
            const trafficVolume = estimateTrafficVolume(roadType, place.rating, place.user_ratings_total)
            const speedLimit = estimateSpeedLimit(roadType)
            
            roadSegments.push({
              location: place.geometry.location,
              roadType,
              trafficVolume,
              speedLimit,
              hasPOIView: true,
              distanceToPOI: distance,
              bearingToPOI: bearing,
              confidence: calculateConfidence(place.rating, place.user_ratings_total)
            })
          }
        }
      }
    }
    
    return roadSegments
    
  } catch (error) {
    console.error('❌ Error analyzing nearby roads:', error)
    return []
  }
}

async function analyzeTransportInfrastructureWithArea(poiLat: number, poiLng: number, poiArea: POIAreaAnalysis, radius: number, apiKey: string): Promise<TransportPoint[]> {
  console.log('🚌 Analyzing transport infrastructure with area context...')
  
  const transportTypes = ['transit_station', 'gas_station', 'rest_area', 'parking']
  const transportPoints: TransportPoint[] = []
  
  try {
    for (const type of transportTypes) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          const passengerVolume = estimatePassengerVolume(type, place.rating, place.user_ratings_total)
          
          // Filtrar baseado na área do POI
          const maxDistance = poiArea.areaType === 'lake' ? 600 : 400
          if (distance <= maxDistance) {
            transportPoints.push({
              type: type as any,
              location: place.geometry.location,
              name: place.name,
              distanceToPOI: distance,
              passengerVolume,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total)
            })
          }
        }
      }
    }
    
    return transportPoints
    
  } catch (error) {
    console.error('❌ Error analyzing transport infrastructure:', error)
    return []
  }
}

async function analyzeTouristHotspotsWithArea(poiLat: number, poiLng: number, poiArea: POIAreaAnalysis, radius: number, apiKey: string): Promise<TouristPoint[]> {
  console.log('🏛️ Analyzing tourist hotspots with area context...')
  
  const touristTypes = ['tourist_attraction', 'park', 'museum', 'landmark']
  const touristPoints: TouristPoint[] = []
  
  try {
    for (const type of touristTypes) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          // Filtrar baseado na área do POI
          const maxDistance = poiArea.areaType === 'lake' ? 700 : 500
          if (distance <= maxDistance && hasGoodPOIView(place.name, place.types, distance)) {
            touristPoints.push({
              type: type as any,
              location: place.geometry.location,
              name: place.name,
              rating: place.rating || 0,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total)
            })
          }
        }
      }
    }
    
    // Buscar também por keywords específicos para pontos com vista
    const viewKeywords = ['viewpoint', 'mirante', 'overlook', 'vista', 'scenic', 'observation']
    
    for (const keyword of viewKeywords) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type: 'establishment',
        keyword,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          const maxDistance = poiArea.areaType === 'lake' ? 800 : 600
          if (distance <= maxDistance) {
            touristPoints.push({
              type: 'viewpoint',
              location: place.geometry.location,
              name: place.name,
              rating: place.rating || 0,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total) * 1.2 // Boost para viewpoints
            })
          }
        }
      }
    }
    
    return touristPoints
    
  } catch (error) {
    console.error('❌ Error analyzing tourist hotspots:', error)
    return []
  }
}

async function analyzeParkingAreasWithArea(poiLat: number, poiLng: number, poiArea: POIAreaAnalysis, radius: number, apiKey: string): Promise<ParkingArea[]> {
  console.log('🅿️ Analyzing parking areas with area context...')
  
  const parkingTypes = ['parking']
  const parkingKeywords = [
    'parking', 'estacionamento', 'garagem', 'rest area', 'scenic pullout',
    'parque', 'park', 'lago', 'lake', 'vista', 'view', 'mirante'
  ]
  const parkingAreas: ParkingArea[] = []
  
  try {
    // Buscar por tipo específico
    for (const type of parkingTypes) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          // Filtrar baseado na área do POI
          const maxDistance = poiArea.areaType === 'lake' ? 600 : 400
          if (distance <= maxDistance && hasGoodPOIView(place.name, place.types, distance)) {
            const capacity = estimateParkingCapacity(place.name, place.rating, place.user_ratings_total)
            
            parkingAreas.push({
              type: 'parking',
              location: place.geometry.location,
              name: place.name,
              capacity,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total)
            })
          }
        }
      }
    }
    
    // Buscar por keywords específicas para pontos com vista
    for (const keyword of parkingKeywords) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type: 'establishment',
        keyword,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          const maxDistance = poiArea.areaType === 'lake' ? 700 : 500
          if (distance <= maxDistance && hasGoodPOIView(place.name, place.types, distance)) {
            const capacity = estimateParkingCapacity(place.name, place.rating, place.user_ratings_total)
            
            parkingAreas.push({
              type: keyword.includes('rest') ? 'rest_area' : 
                    keyword.includes('scenic') || keyword.includes('vista') || keyword.includes('mirante') ? 'scenic_pullout' : 
                    'parking',
              location: place.geometry.location,
              name: place.name,
              capacity,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total) * 1.1 // Boost para pontos com vista
            })
          }
        }
      }
    }
    
    return parkingAreas
    
  } catch (error) {
    console.error('❌ Error analyzing parking areas:', error)
    return []
  }
}

async function analyzeTransportInfrastructure(poiLat: number, poiLng: number, radius: number, apiKey: string): Promise<TransportPoint[]> {
  console.log('🚌 Analyzing transport infrastructure...')
  
  const transportTypes = ['transit_station', 'gas_station', 'rest_area', 'parking']
  const transportPoints: TransportPoint[] = []
  
  try {
    for (const type of transportTypes) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          const passengerVolume = estimatePassengerVolume(type, place.rating, place.user_ratings_total)
          
          transportPoints.push({
            type: type as any,
            location: place.geometry.location,
            name: place.name,
            distanceToPOI: distance,
            passengerVolume,
            hasPOIView: true,
            confidence: calculateConfidence(place.rating, place.user_ratings_total)
          })
        }
      }
    }
    
    return transportPoints
    
  } catch (error) {
    console.error('❌ Error analyzing transport infrastructure:', error)
    return []
  }
}

async function analyzeTouristHotspots(poiLat: number, poiLng: number, radius: number, apiKey: string): Promise<TouristPoint[]> {
  console.log('🏛️ Analyzing tourist hotspots...')
  
  const touristTypes = ['tourist_attraction', 'park', 'museum', 'landmark']
  const touristPoints: TouristPoint[] = []
  
  try {
    for (const type of touristTypes) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          // Filtrar apenas pontos turísticos com boa vista para o lago
          if (distance <= 700 && hasGoodPOIView(place.name, place.types, distance)) {
            touristPoints.push({
              type: type as any,
              location: place.geometry.location,
              name: place.name,
              rating: place.rating || 0,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total)
            })
          }
        }
      }
    }
    
    // Buscar também por keywords específicos para pontos com vista
    const viewKeywords = ['viewpoint', 'mirante', 'overlook', 'vista', 'scenic', 'observation']
    
    for (const keyword of viewKeywords) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type: 'establishment',
        keyword,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          if (distance <= 800) {
            touristPoints.push({
              type: 'viewpoint',
              location: place.geometry.location,
              name: place.name,
              rating: place.rating || 0,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total) * 1.2 // Boost para viewpoints
            })
          }
        }
      }
    }
    
    return touristPoints
    
  } catch (error) {
    console.error('❌ Error analyzing tourist hotspots:', error)
    return []
  }
}

async function analyzeParkingAreas(poiLat: number, poiLng: number, radius: number, apiKey: string): Promise<ParkingArea[]> {
  console.log('🅿️ Analyzing parking areas...')
  
  const parkingTypes = ['parking']
  const parkingKeywords = [
    'parking', 'estacionamento', 'garagem', 'rest area', 'scenic pullout',
    'parque', 'park', 'lago', 'lake', 'vista', 'view', 'mirante'
  ]
  const parkingAreas: ParkingArea[] = []
  
  try {
    // Buscar por tipo específico
    for (const type of parkingTypes) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          // Filtrar apenas estacionamentos estratégicos ao redor do lago
          if (distance <= 600 && hasGoodPOIView(place.name, place.types, distance)) {
            const capacity = estimateParkingCapacity(place.name, place.rating, place.user_ratings_total)
            
            parkingAreas.push({
              type: 'parking',
              location: place.geometry.location,
              name: place.name,
              capacity,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total)
            })
          }
        }
      }
    }
    
    // Buscar por keywords específicas para pontos com vista
    for (const keyword of parkingKeywords) {
      const params = new URLSearchParams({
        location: `${poiLat},${poiLng}`,
        radius: radius.toString(),
        type: 'establishment',
        keyword,
        key: apiKey
      })
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.status === 'OK' && data.results) {
        for (const place of data.results) {
          const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
          
          // Filtrar apenas pontos estratégicos
          if (distance <= 700 && hasGoodPOIView(place.name, place.types, distance)) {
            const capacity = estimateParkingCapacity(place.name, place.rating, place.user_ratings_total)
            
            parkingAreas.push({
              type: keyword.includes('rest') ? 'rest_area' : 
                    keyword.includes('scenic') || keyword.includes('vista') || keyword.includes('mirante') ? 'scenic_pullout' : 
                    'parking',
              location: place.geometry.location,
              name: place.name,
              capacity,
              distanceToPOI: distance,
              hasPOIView: true,
              confidence: calculateConfidence(place.rating, place.user_ratings_total) * 1.1 // Boost para pontos com vista
            })
          }
        }
      }
    }
    
    return parkingAreas
    
  } catch (error) {
    console.error('❌ Error analyzing parking areas:', error)
    return []
  }
}

function generateTriggerPointRecommendationsWithArea(data: {
  poiLocation: { lat: number, lng: number }
  poiArea: POIAreaAnalysis
  nearbyRoads: RoadSegment[]
  transportInfrastructure: TransportPoint[]
  touristHotspots: TouristPoint[]
  parkingAreas: ParkingArea[]
}): RecommendedTriggerPoint[] {
  console.log('🎯 Generating trigger point recommendations with area context...')
  
  const recommendations: RecommendedTriggerPoint[] = []
  const { poiArea } = data
  
  // 1. Pontos de visibilidade identificados na análise da área (prioridade máxima)
  poiArea.visibilityPoints.forEach((point, index) => {
    recommendations.push({
      location: { lat: point.lat, lng: point.lng },
      type: 'primary',
      priority: index + 1,
      radius_meters: 60,
      expected_bearing: calculateBearing(point.lat, point.lng, data.poiLocation.lat, data.poiLocation.lng),
      access_type: 'both',
      reasoning: `${point.viewQuality} visibility point with ${poiArea.areaType} view, perfect for audio experience`,
      confidence: point.viewQuality === 'excellent' ? 0.9 : point.viewQuality === 'good' ? 0.8 : 0.7,
      source: 'area_analysis'
    })
  })
  
  // 2. Pontos de acesso identificados na análise da área (prioridade alta)
  poiArea.accessPoints.forEach((point, index) => {
    recommendations.push({
      location: { lat: point.lat, lng: point.lng },
      type: 'primary',
      priority: recommendations.length + 1,
      radius_meters: 50,
      expected_bearing: calculateBearing(point.lat, point.lng, data.poiLocation.lat, data.poiLocation.lng),
      access_type: point.type === 'road' ? 'car' : 'both',
      reasoning: `${point.type} access point to ${poiArea.areaType}, high traffic area`,
      confidence: 0.85,
      source: 'area_analysis'
    })
  })
  
  // 3. Vias principais ao redor da área (prioridade alta)
  const areaAccessRoads = data.nearbyRoads.filter(road => 
    road.distanceToPOI <= poiArea.perimeter / 2 &&
    ['highway', 'primary', 'secondary'].includes(road.roadType) &&
    road.trafficVolume !== 'low'
  )
  
  areaAccessRoads.forEach((road, index) => {
    recommendations.push({
      location: road.location,
      type: 'primary',
      priority: recommendations.length + 1,
      radius_meters: 50,
      expected_bearing: road.bearingToPOI,
      access_type: 'car',
      reasoning: `${road.roadType} road with ${road.trafficVolume} traffic, excellent ${poiArea.areaType} access point`,
      confidence: road.confidence,
      source: 'road_analysis'
    })
  })
  
  // 4. Pontos de transporte próximos à área (prioridade alta)
  const areaTransportPoints = data.transportInfrastructure.filter(point => 
    point.distanceToPOI <= poiArea.perimeter / 2 &&
    point.passengerVolume === 'high'
  )
  
  areaTransportPoints.forEach((point, index) => {
    recommendations.push({
      location: point.location,
      type: 'secondary',
      priority: recommendations.length + 1,
      radius_meters: 45,
      expected_bearing: calculateBearing(point.location.lat, point.location.lng, data.poiLocation.lat, data.poiLocation.lng),
      access_type: 'both',
      reasoning: `${point.type} with high passenger volume, ideal for ${poiArea.areaType} visitors`,
      confidence: point.confidence,
      source: 'transport'
    })
  })
  
  // 5. Estacionamentos estratégicos (prioridade média)
  const strategicParking = data.parkingAreas.filter(parking => 
    parking.distanceToPOI <= poiArea.perimeter / 2 &&
    (parking.capacity === 'large' || parking.type === 'scenic_pullout')
  )
  
  strategicParking.forEach((parking, index) => {
    recommendations.push({
      location: parking.location,
      type: 'secondary',
      priority: recommendations.length + 1,
      radius_meters: 55,
      expected_bearing: calculateBearing(parking.location.lat, parking.location.lng, data.poiLocation.lat, data.poiLocation.lng),
      access_type: 'both',
      reasoning: `${parking.type} area where visitors stop to enjoy ${poiArea.areaType} views`,
      confidence: parking.confidence,
      source: 'parking'
    })
  })
  
  // 6. Pontos turísticos com boa avaliação (prioridade média)
  const goodTouristSpots = data.touristHotspots.filter(spot => 
    spot.rating >= 3.5 && 
    spot.distanceToPOI <= poiArea.perimeter / 2 &&
    spot.type !== 'viewpoint'
  )
  
  goodTouristSpots.forEach((spot, index) => {
    recommendations.push({
      location: spot.location,
      type: 'secondary',
      priority: recommendations.length + 1,
      radius_meters: 40,
      expected_bearing: calculateBearing(spot.location.lat, spot.location.lng, data.poiLocation.lat, data.poiLocation.lng),
      access_type: 'both',
      reasoning: `${spot.type} (${spot.rating}⭐) where tourists gather near the ${poiArea.areaType}`,
      confidence: spot.confidence,
      source: 'tourist'
    })
  })
  
  // 7. Vias secundárias como fallback
  const fallbackRoads = data.nearbyRoads.filter(road => 
    road.distanceToPOI <= poiArea.perimeter &&
    !recommendations.some(rec => 
      Math.abs(rec.location.lat - road.location.lat) < 0.001 && 
      Math.abs(rec.location.lng - road.location.lng) < 0.001
    )
  )
  
  fallbackRoads.slice(0, 2).forEach((road, index) => {
    recommendations.push({
      location: road.location,
      type: 'fallback',
      priority: recommendations.length + 1,
      radius_meters: 35,
      expected_bearing: road.bearingToPOI,
      access_type: 'car',
      reasoning: `${road.roadType} road as backup access to ${poiArea.areaType} area`,
      confidence: road.confidence * 0.7,
      source: 'road_analysis'
    })
  })
  
  // Ordenar por prioridade e confiança
  return recommendations
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return b.confidence - a.confidence
    })
    .slice(0, 10) // Limitar a 10 recomendações
}

// Funções auxiliares
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3 // Raio da Terra em metros
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

  return R * c
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) -
          Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function classifyRoadType(name: string, types: string[]): 'highway' | 'primary' | 'secondary' | 'residential' {
  const lowerName = name.toLowerCase()
  
  // Vias principais (highway)
  if (lowerName.includes('highway') || lowerName.includes('rodovia') || lowerName.includes('expressway') || lowerName.includes('br-') || lowerName.includes('sp-')) {
    return 'highway'
  }
  
  // Vias primárias (primary)
  if (lowerName.includes('avenue') || lowerName.includes('avenida') || lowerName.includes('main') || lowerName.includes('marginal') || lowerName.includes('bridge') || lowerName.includes('ponte')) {
    return 'primary'
  }
  
  // Vias secundárias (secondary) - incluindo ruas estratégicas
  if (lowerName.includes('street') || lowerName.includes('rua') || lowerName.includes('road') || lowerName.includes('estrada')) {
    // MELHORIA: Ruas próximas a lagos são mais importantes
    if (lowerName.includes('lago') || lowerName.includes('lake') || lowerName.includes('margem') || lowerName.includes('beira') || lowerName.includes('vista')) {
      return 'secondary' // Upgrade se relacionada ao lago
    }
    return 'secondary'
  }
  
  // NOVO: Vias menores mas estratégicas para lagos
  if (lowerName.includes('alameda') || lowerName.includes('travessa') || lowerName.includes('viela') || lowerName.includes('caminho')) {
    // Se próxima a lago, upgrade para secondary
    if (lowerName.includes('lago') || lowerName.includes('lake') || lowerName.includes('vista') || lowerName.includes('view')) {
      return 'secondary'
    }
    return 'residential'
  }
  
  // Verificar tipos do Google Places para classificação adicional
  if (types.includes('route')) {
    return 'secondary' // Rotas são pelo menos secundárias
  }
  
  return 'residential'
}

function estimateTrafficVolume(roadType: string, rating?: number, userCount?: number): 'high' | 'medium' | 'low' {
  if (roadType === 'highway' || roadType === 'primary') return 'high'
  if (roadType === 'secondary') return 'medium'
  if (rating && rating > 4.0 && userCount && userCount > 100) return 'high'
  return 'low'
}

function estimateSpeedLimit(roadType: string): number {
  switch (roadType) {
    case 'highway': return 80
    case 'primary': return 60
    case 'secondary': return 40
    default: return 30
  }
}

function estimatePassengerVolume(type: string, rating?: number, userCount?: number): 'high' | 'medium' | 'low' {
  if (type === 'transit_station') return 'high'
  if (rating && rating > 4.0 && userCount && userCount > 50) return 'high'
  if (type === 'parking' || type === 'rest_area') return 'medium'
  return 'low'
}

function estimateParkingCapacity(name: string, rating?: number, userCount?: number): 'large' | 'medium' | 'small' {
  const lowerName = name.toLowerCase()
  if (lowerName.includes('mall') || lowerName.includes('shopping') || lowerName.includes('center')) return 'large'
  if (rating && rating > 4.0 && userCount && userCount > 100) return 'large'
  if (lowerName.includes('parking') || lowerName.includes('garagem')) return 'medium'
  return 'small'
}

// Funções inteligentes para análise da área do POI
function determineAreaTypeIntelligently(placesData: any, naturalData: any, parkData: any, geocodeData: any, poiLat: number, poiLng: number): POIAreaAnalysis['areaType'] {
  console.log('🧠 Determining area type intelligently...')
  
  // Evidências de lago/água
  const waterEvidence = []
  if (naturalData.results) {
    waterEvidence.push(...naturalData.results.filter((place: any) => 
      place.types.includes('natural_feature') && 
      (place.name.toLowerCase().includes('lago') || 
       place.name.toLowerCase().includes('lake') ||
       place.name.toLowerCase().includes('água') ||
       place.name.toLowerCase().includes('water'))
    ))
  }
  
  // Evidências de parque
  const parkEvidence = []
  if (parkData.results) {
    parkEvidence.push(...parkData.results.filter((place: any) => 
      place.types.includes('park') || 
      place.name.toLowerCase().includes('parque') ||
      place.name.toLowerCase().includes('park')
    ))
  }
  
  // Evidências de estabelecimentos comerciais
  const commercialEvidence = []
  if (placesData.results) {
    commercialEvidence.push(...placesData.results.filter((place: any) => 
      place.types.includes('shopping_mall') || 
      place.types.includes('store') ||
      place.types.includes('restaurant') ||
      place.types.includes('establishment')
    ))
  }
  
  // Análise de geocoding para contexto
  let geocodeContext = ''
  if (geocodeData.results && geocodeData.results[0]) {
    const addressComponents = geocodeData.results[0].address_components
    geocodeContext = addressComponents.map((comp: any) => comp.long_name).join(' ').toLowerCase()
  }
  
  // Lógica de decisão baseada em evidências
  if (waterEvidence.length > 0) {
    console.log(`✅ Water evidence found: ${waterEvidence.length} water features`)
    return 'lake'
  }
  
  if (parkEvidence.length > 0) {
    console.log(`✅ Park evidence found: ${parkEvidence.length} park features`)
    return 'park'
  }
  
  if (commercialEvidence.length > 5) {
    console.log(`✅ Commercial evidence found: ${commercialEvidence.length} commercial establishments`)
    return 'shopping_center'
  }
  
  if (geocodeContext.includes('shopping') || geocodeContext.includes('mall')) {
    return 'shopping_center'
  }
  
  if (geocodeContext.includes('park') || geocodeContext.includes('parque')) {
    return 'park'
  }
  
  console.log('📍 Defaulting to urban_area')
  return 'urban_area'
}

function calculateRealAreaSize(placesData: any, naturalData: any, parkData: any, roadResults: any[], areaType: string, poiLat: number, poiLng: number): number {
  console.log('📏 Calculating real area size with improved logic...')
  
  // Para lagos, usar uma abordagem mais conservadora
  if (areaType === 'lake') {
    const nearbyPoints: any[] = []
    
    // Coletar apenas pontos muito próximos (dentro de 500m)
    if (naturalData.results) {
      naturalData.results.forEach((point: any) => {
        const distance = calculateDistance(poiLat, poiLng, point.geometry.location.lat, point.geometry.location.lng)
        if (distance <= 500) {
          nearbyPoints.push({ ...point, distance })
        }
      })
    }
    
    if (parkData.results) {
      parkData.results.forEach((point: any) => {
        const distance = calculateDistance(poiLat, poiLng, point.geometry.location.lat, point.geometry.location.lng)
        if (distance <= 500) {
          nearbyPoints.push({ ...point, distance })
        }
      })
    }
    
    // Usar apenas vias muito próximas
    roadResults.forEach((road: any) => {
      const distance = calculateDistance(poiLat, poiLng, road.geometry.location.lat, road.geometry.location.lng)
      if (distance <= 300) {
        nearbyPoints.push({ ...road, distance })
      }
    })
    
    if (nearbyPoints.length > 0) {
      // Usar apenas os pontos mais próximos para estimar o tamanho
      const sortedPoints = nearbyPoints.sort((a, b) => a.distance - b.distance)
      const closestPoints = sortedPoints.slice(0, Math.min(5, sortedPoints.length))
      
      const avgDistance = closestPoints.reduce((sum, point) => sum + point.distance, 0) / closestPoints.length
      
      // Usar uma estimativa muito mais conservadora
      const radius = Math.min(avgDistance * 0.5, 150) // Máximo 150m de raio
      const area = Math.PI * radius * radius
      
      console.log(`🌊 Conservative lake size: ${Math.round(area)}m² (radius: ${Math.round(radius)}m, based on ${closestPoints.length} closest points)`)
      return Math.round(area)
    }
    
    // Fallback para lagos: área pequena padrão
    console.log('🌊 Using default small lake size')
    return 50000 // 5 hectares - tamanho razoável para um lago urbano
  }
  
  // Para outros tipos, usar estimativas mais conservadoras
  if (areaType === 'park') {
    return 20000 // 2 hectares
  }
  
  if (areaType === 'shopping_center') {
    return 15000 // 1.5 hectares
  }
  
  if (areaType === 'building') {
    return 2000 // 0.2 hectares
  }
  
  // Padrão muito menor
  return 10000 // 1 hectare
}

function identifyRealAccessPoints(roadResults: any[], placesData: any, poiLat: number, poiLng: number, areaType: string): POIAreaAnalysis['accessPoints'] {
  console.log('🚪 Identifying real access points...')
  
  const accessPoints: POIAreaAnalysis['accessPoints'] = []
  
  // Identificar vias principais como pontos de acesso
  roadResults.forEach((road: any) => {
    const distance = calculateDistance(poiLat, poiLng, road.geometry.location.lat, road.geometry.location.lng)
    
    if (distance <= 300) { // Apenas vias próximas
      accessPoints.push({
        lat: road.geometry.location.lat,
        lng: road.geometry.location.lng,
        type: 'road',
        roadName: road.name
      })
    }
  })
  
  // Identificar entradas de estabelecimentos próximos
  if (placesData.results) {
    placesData.results.forEach((place: any) => {
      const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
      
      if (distance <= 200 && place.types.includes('establishment')) {
        accessPoints.push({
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
          type: 'entrance',
          roadName: place.name
        })
      }
    })
  }
  
  console.log(`✅ Found ${accessPoints.length} real access points`)
  return accessPoints
}

function mapRealSurroundingRoads(roadResults: any[], geocodeData: any, poiLat: number, poiLng: number, areaType: string): POIAreaAnalysis['surroundingRoads'] {
  console.log('🛣️ Mapping real surrounding roads...')
  
  const surroundingRoads: POIAreaAnalysis['surroundingRoads'] = []
  
  roadResults.forEach((road: any) => {
    const distance = calculateDistance(poiLat, poiLng, road.geometry.location.lat, road.geometry.location.lng)
    
    if (distance <= 500) { // Vias dentro de 500m
      surroundingRoads.push({
        lat: road.geometry.location.lat,
        lng: road.geometry.location.lng,
        roadName: road.name || 'Unknown Road',
        roadType: classifyRoadType(road.name, road.types),
        distance: distance
      })
    }
  })
  
  console.log(`✅ Mapped ${surroundingRoads.length} surrounding roads`)
  return surroundingRoads
}

function identifyStrategicVisibilityPoints(placesData: any, naturalData: any, parkData: any, poiLat: number, poiLng: number, areaType: string, estimatedSize: number): POIAreaAnalysis['visibilityPoints'] {
  console.log('👁️ Identifying strategic visibility points...')
  
  const visibilityPoints: POIAreaAnalysis['visibilityPoints'] = []
  
  // Para lagos, criar pontos estratégicos considerando a forma real
  if (areaType === 'lake') {
    const radius = Math.sqrt(estimatedSize / Math.PI)
    
    // 1. Pontos circulares básicos (mantidos)
    const basicAngles = [0, 45, 90, 135, 180, 225, 270, 315] // 8 pontos ao redor
    
    basicAngles.forEach((angle, index) => {
      const radian = (angle * Math.PI) / 180
      const lat = poiLat + (radius * Math.cos(radian) / 111000)
      const lng = poiLng + (radius * Math.sin(radian) / (111000 * Math.cos(poiLat * Math.PI / 180)))
      
      visibilityPoints.push({
        lat: lat,
        lng: lng,
        viewQuality: index < 4 ? 'excellent' : 'good'
      })
    })
    
    // 2. NOVO: Detectar extremidades do lago (pontos de início/fim)
    // Para lagos alongados, adicionar pontos nas extremidades
    const lakeEndpoints = identifyLakeEndpoints(placesData, naturalData, parkData, poiLat, poiLng, radius)
    lakeEndpoints.forEach(endpoint => {
      visibilityPoints.push({
        lat: endpoint.lat,
        lng: endpoint.lng,
        viewQuality: 'excellent' // Extremidades são pontos excelentes
      })
    })
    
    // 3. NOVO: Detectar pontos onde vias pequenas tocam o lago
    const lakeAccessPoints = identifyLakeDirectAccessPoints(placesData, poiLat, poiLng, radius)
    lakeAccessPoints.forEach(accessPoint => {
      visibilityPoints.push({
        lat: accessPoint.lat,
        lng: accessPoint.lng,
        viewQuality: 'good'
      })
    })
  }
  
  // Adicionar pontos de estabelecimentos com boa vista
  if (placesData.results) {
    placesData.results.forEach((place: any) => {
      const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
      
      if (distance <= 400 && hasGoodPOIView(place.name, place.types, distance)) {
        visibilityPoints.push({
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
          viewQuality: place.rating >= 4.0 ? 'excellent' : 'good'
        })
      }
    })
  }
  
  console.log(`✅ Identified ${visibilityPoints.length} strategic visibility points`)
  return visibilityPoints
}

// NOVA FUNÇÃO: Identificar extremidades do lago
function identifyLakeEndpoints(placesData: any, naturalData: any, parkData: any, poiLat: number, poiLng: number, radius: number): Array<{lat: number, lng: number}> {
  console.log('🏞️ Identifying lake endpoints...')
  
  const endpoints = []
  const allPoints = []
  
  // Coletar todos os pontos ao redor do lago
  if (placesData.results) allPoints.push(...placesData.results)
  if (naturalData.results) allPoints.push(...naturalData.results)
  if (parkData.results) allPoints.push(...parkData.results)
  
  if (allPoints.length > 4) {
    // Calcular os pontos mais distantes em direções opostas
    let maxNorthEast = { lat: -90, lng: -180, distance: 0 }
    let maxSouthWest = { lat: 90, lng: 180, distance: 0 }
    
    allPoints.forEach((point: any) => {
      const lat = point.geometry.location.lat
      const lng = point.geometry.location.lng
      const distance = calculateDistance(poiLat, poiLng, lat, lng)
      
      // Identificar extremidade nordeste
      if (lat > poiLat && lng > poiLng && distance > maxNorthEast.distance && distance <= radius * 1.5) {
        maxNorthEast = { lat, lng, distance }
      }
      
      // Identificar extremidade sudoeste  
      if (lat < poiLat && lng < poiLng && distance > maxSouthWest.distance && distance <= radius * 1.5) {
        maxSouthWest = { lat, lng, distance }
      }
    })
    
    // Adicionar extremidades se encontradas
    if (maxNorthEast.distance > 0) {
      endpoints.push({ lat: maxNorthEast.lat, lng: maxNorthEast.lng })
      console.log(`🔍 Found NorthEast endpoint at distance: ${maxNorthEast.distance}m`)
    }
    
    if (maxSouthWest.distance > 0) {
      endpoints.push({ lat: maxSouthWest.lat, lng: maxSouthWest.lng })
      console.log(`🔍 Found SouthWest endpoint at distance: ${maxSouthWest.distance}m`)
    }
  }
  
  console.log(`✅ Identified ${endpoints.length} lake endpoints`)
  return endpoints
}

// NOVA FUNÇÃO: Identificar pontos de acesso direto ao lago
function identifyLakeDirectAccessPoints(placesData: any, poiLat: number, poiLng: number, radius: number): Array<{lat: number, lng: number}> {
  console.log('🛣️ Identifying direct lake access points...')
  
  const accessPoints: Array<{lat: number, lng: number}> = []
  
  if (placesData.results) {
    placesData.results.forEach((place: any) => {
      const distance = calculateDistance(poiLat, poiLng, place.geometry.location.lat, place.geometry.location.lng)
      const name = place.name?.toLowerCase() || ''
      
      // Detectar ruas pequenas que podem dar acesso direto
      const isSmallRoad = name.includes('rua') || 
                         name.includes('street') || 
                         name.includes('alameda') ||
                         name.includes('travessa') ||
                         name.includes('viela') ||
                         place.types.includes('route') ||
                         place.types.includes('sublocality')
      
      // Detectar pontos muito próximos ao lago (possível acesso direto)
      const isVeryClose = distance <= radius * 0.8 // 80% do raio
      
      if (isSmallRoad && isVeryClose) {
        accessPoints.push({
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng
        })
        console.log(`🔍 Found direct access: ${place.name} at ${Math.round(distance)}m`)
      }
    })
  }
  
  console.log(`✅ Identified ${accessPoints.length} direct access points`)
  return accessPoints
}

function calculateRealBoundingBox(placesData: any, naturalData: any, parkData: any, poiLat: number, poiLng: number, estimatedSize: number): POIAreaAnalysis['boundingBox'] {
  console.log('📦 Calculating conservative bounding box...')
  
  const nearbyPoints: any[] = []
  
  // Coletar apenas pontos muito próximos para um bounding box mais preciso
  if (placesData.results) {
    placesData.results.forEach((point: any) => {
      const distance = calculateDistance(poiLat, poiLng, point.geometry.location.lat, point.geometry.location.lng)
      if (distance <= 200) { // Apenas pontos dentro de 200m
        nearbyPoints.push(point)
      }
    })
  }
  
  if (naturalData.results) {
    naturalData.results.forEach((point: any) => {
      const distance = calculateDistance(poiLat, poiLng, point.geometry.location.lat, point.geometry.location.lng)
      if (distance <= 200) {
        nearbyPoints.push(point)
      }
    })
  }
  
  if (parkData.results) {
    parkData.results.forEach((point: any) => {
      const distance = calculateDistance(poiLat, poiLng, point.geometry.location.lat, point.geometry.location.lng)
      if (distance <= 200) {
        nearbyPoints.push(point)
      }
    })
  }
  
  if (nearbyPoints.length > 0) {
    const lats = nearbyPoints.map((point: any) => point.geometry.location.lat)
    const lngs = nearbyPoints.map((point: any) => point.geometry.location.lng)
    
    // Adicionar o próprio POI às coordenadas
    lats.push(poiLat)
    lngs.push(poiLng)
    
    const north = Math.max(...lats)
    const south = Math.min(...lats)
    const east = Math.max(...lngs)
    const west = Math.min(...lngs)
    
    // Adicionar uma margem pequena (50m aproximadamente)
    const margin = 0.0005 // ~50 metros
    
    return {
      north: north + margin,
      south: south - margin,
      east: east + margin,
      west: west - margin
    }
  }
  
  // Fallback: usar apenas o tamanho estimado com margem conservadora
  const radius = Math.sqrt(estimatedSize / Math.PI) / 111000 // Converter para graus
  const maxRadius = 0.002 // Máximo ~200m
  const boundingRadius = Math.min(radius, maxRadius)
  
  console.log(`📦 Using fallback bounding box with radius: ${Math.round(boundingRadius * 111000)}m`)
  
  return {
    north: poiLat + boundingRadius,
    south: poiLat - boundingRadius,
    east: poiLng + boundingRadius,
    west: poiLng - boundingRadius
  }
}

function calculateRealPerimeter(estimatedSize: number, areaType: string, boundingBox: any): number {
  console.log('📐 Calculating real perimeter...')
  
  if (areaType === 'lake') {
    // Para lagos, usar fórmula mais precisa
    const radius = Math.sqrt(estimatedSize / Math.PI)
    const perimeter = 2 * Math.PI * radius
    console.log(`🌊 Lake perimeter: ${Math.round(perimeter)}m`)
    return Math.round(perimeter)
  }
  
  // Para outras formas, usar bounding box
  const width = (boundingBox.east - boundingBox.west) * 111000 // metros
  const height = (boundingBox.north - boundingBox.south) * 111000 // metros
  const perimeter = 2 * (width + height)
  
  console.log(`📐 Perimeter calculated: ${Math.round(perimeter)}m`)
  return Math.round(perimeter)
}

// Funções para análise da área do POI (mantidas para compatibilidade)
function determineAreaType(placesData: any, geocodeData: any, poiLat: number, poiLng: number): POIAreaAnalysis['areaType'] {
  const lowerName = placesData.results?.[0]?.name?.toLowerCase() || ''
  const types = placesData.results?.[0]?.types || []
  const addressComponents = geocodeData.results?.[0]?.address_components || []
  
  // Verificar se é um lago
  if (lowerName.includes('lago') || lowerName.includes('lake') || 
      types.includes('natural_feature') || types.includes('body_of_water')) {
    return 'lake'
  }
  
  // Verificar se é um parque
  if (lowerName.includes('parque') || lowerName.includes('park') || 
      types.includes('park') || types.includes('natural_feature')) {
    return 'park'
  }
  
  // Verificar se é um shopping
  if (lowerName.includes('shopping') || lowerName.includes('mall') || 
      types.includes('shopping_mall')) {
    return 'shopping_center'
  }
  
  // Verificar se é um museu
  if (lowerName.includes('museu') || lowerName.includes('museum') || 
      types.includes('museum')) {
    return 'museum'
  }
  
  // Verificar se é um monumento
  if (lowerName.includes('monumento') || lowerName.includes('monument') || 
      types.includes('monument') || types.includes('landmark')) {
    return 'monument'
  }
  
  // Verificar se é uma área natural
  if (types.includes('natural_feature') || types.includes('establishment')) {
    return 'natural_area'
  }
  
  // Verificar se é um prédio
  if (types.includes('establishment') || types.includes('point_of_interest')) {
    return 'building'
  }
  
  return 'urban_area'
}

function estimateAreaSize(areaType: POIAreaAnalysis['areaType'], placesData: any, geocodeData: any): number {
  switch (areaType) {
    case 'lake':
      return 50000 // 50.000 m² para lago médio
    case 'park':
      return 20000 // 20.000 m² para parque
    case 'shopping_center':
      return 15000 // 15.000 m² para shopping
    case 'museum':
      return 5000 // 5.000 m² para museu
    case 'monument':
      return 1000 // 1.000 m² para monumento
    case 'natural_area':
      return 30000 // 30.000 m² para área natural
    case 'building':
      return 2000 // 2.000 m² para prédio
    default:
      return 10000 // 10.000 m² para área urbana
  }
}

function identifyAccessPoints(roadsData: any, placesData: any, poiLat: number, poiLng: number): POIAreaAnalysis['accessPoints'] {
  const accessPoints: POIAreaAnalysis['accessPoints'] = []
  
  // Adicionar pontos de acesso baseados nas vias próximas
  if (roadsData.snappedPoints) {
    roadsData.snappedPoints.forEach((point: any) => {
      accessPoints.push({
        lat: point.location.latitude,
        lng: point.location.longitude,
        type: 'road',
        roadName: `Road ${point.originalIndex}`
      })
    })
  }
  
  // Adicionar pontos de acesso baseados nos lugares próximos
  if (placesData.results) {
    placesData.results.forEach((place: any) => {
      accessPoints.push({
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        type: 'entrance',
        roadName: place.name
      })
    })
  }
  
  return accessPoints
}

function mapSurroundingRoads(roadsData: any, geocodeData: any, poiLat: number, poiLng: number): POIAreaAnalysis['surroundingRoads'] {
  const surroundingRoads: POIAreaAnalysis['surroundingRoads'] = []
  
  // Mapear vias baseadas nos dados do Roads API
  if (roadsData.snappedPoints) {
    roadsData.snappedPoints.forEach((point: any) => {
      const distance = calculateDistance(poiLat, poiLng, point.location.latitude, point.location.longitude)
      surroundingRoads.push({
        lat: point.location.latitude,
        lng: point.location.longitude,
        roadName: `Road ${point.originalIndex}`,
        roadType: 'primary',
        distance
      })
    })
  }
  
  // Mapear vias baseadas nos dados do Geocoding API
  if (geocodeData.results) {
    geocodeData.results.forEach((result: any) => {
      result.address_components.forEach((component: any) => {
        if (component.types.includes('route')) {
          surroundingRoads.push({
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng,
            roadName: component.long_name,
            roadType: 'secondary',
            distance: calculateDistance(poiLat, poiLng, result.geometry.location.lat, result.geometry.location.lng)
          })
        }
      })
    })
  }
  
  return surroundingRoads
}

function identifyVisibilityPoints(poiLat: number, poiLng: number, areaType: POIAreaAnalysis['areaType'], estimatedSize: number): POIAreaAnalysis['visibilityPoints'] {
  const visibilityPoints: POIAreaAnalysis['visibilityPoints'] = []
  const radius = Math.sqrt(estimatedSize / Math.PI) // Raio baseado no tamanho estimado
  
  // Gerar pontos de visibilidade ao redor da área
  const angles = [0, 45, 90, 135, 180, 225, 270, 315] // 8 direções
  
  angles.forEach((angle, index) => {
    const radian = (angle * Math.PI) / 180
    const distance = radius + 100 // Um pouco além do perímetro
    
    const lat = poiLat + (distance / 111320) * Math.cos(radian)
    const lng = poiLng + (distance / (111320 * Math.cos(poiLat * Math.PI / 180))) * Math.sin(radian)
    
    visibilityPoints.push({
      lat,
      lng,
      elevation: 0, // Seria calculado com API de elevação
      viewQuality: index % 3 === 0 ? 'excellent' : index % 3 === 1 ? 'good' : 'fair'
    })
  })
  
  return visibilityPoints
}

function calculateBoundingBox(poiLat: number, poiLng: number, estimatedSize: number): POIAreaAnalysis['boundingBox'] {
  const radius = Math.sqrt(estimatedSize / Math.PI) / 111320 // Converter para graus
  
  return {
    north: poiLat + radius,
    south: poiLat - radius,
    east: poiLng + radius,
    west: poiLng - radius
  }
}

function calculatePerimeter(estimatedSize: number, areaType: POIAreaAnalysis['areaType']): number {
  // Calcular perímetro baseado no tipo de área
  const radius = Math.sqrt(estimatedSize / Math.PI)
  const perimeter = 2 * Math.PI * radius
  
  // Ajustar baseado no tipo (áreas irregulares têm perímetro maior)
  switch (areaType) {
    case 'lake':
      return perimeter * 1.2 // Lagos são irregulares
    case 'park':
      return perimeter * 1.1 // Parques são um pouco irregulares
    case 'shopping_center':
      return perimeter * 0.9 // Shoppings são mais retangulares
    default:
      return perimeter
  }
}

function hasGoodPOIView(name: string, types: string[], distance: number): boolean {
  const lowerName = name.toLowerCase()
  
  // Keywords que indicam boa vista
  const viewKeywords = ['view', 'vista', 'mirante', 'overlook', 'scenic', 'panoramic', 'observation', 'deck']
  const hasViewKeyword = viewKeywords.some(keyword => lowerName.includes(keyword))
  
  // Tipos que geralmente têm boa vista
  const viewTypes = ['tourist_attraction', 'park', 'landmark', 'establishment']
  const hasViewType = types.some(type => viewTypes.includes(type))
  
  // Distância ideal para vista (não muito perto, não muito longe)
  const goodDistance = distance >= 100 && distance <= 800
  
  // Pontos elevados ou com características especiais
  const elevatedKeywords = ['hill', 'mountain', 'peak', 'bridge', 'overpass', 'viaduto', 'ponte']
  const isElevated = elevatedKeywords.some(keyword => lowerName.includes(keyword))
  
  return hasViewKeyword || hasViewType || isElevated || goodDistance
}

function calculateConfidence(rating?: number, userCount?: number): number {
  let confidence = 0.5 // Base confidence
  
  if (rating) {
    confidence += (rating - 2.5) * 0.1 // Rating contribution
  }
  
  if (userCount) {
    confidence += Math.min(userCount / 1000, 0.3) // User count contribution
  }
  
  return Math.min(Math.max(confidence, 0.1), 1.0) // Clamp between 0.1 and 1.0
}
