import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Option 1: Use Open Elevation API (free)
async function getElevationFromOpenElevation(lat: number, lng: number): Promise<number | null> {
  try {
    console.log(`🌍 Testing Open Elevation API for ${lat}, ${lng}`)
    
    const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`)
    
    if (!response.ok) {
      console.log(`❌ Open Elevation API failed: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    if (data.results && data.results.length > 0) {
      const elevation = data.results[0].elevation
      console.log(`✅ Open Elevation: ${elevation}m`)
      return elevation
    }
    
    return null
  } catch (error) {
    console.error('❌ Error with Open Elevation API:', error)
    return null
  }
}

// Option 2: Sample multiple points around the city center to get average
async function getCityAverageElevation(cityLat: number, cityLng: number, radiusKm: number = 5): Promise<number | null> {
  try {
    console.log(`🏙️ Sampling city elevation in ${radiusKm}km radius around ${cityLat}, ${cityLng}`)
    
    const samplePoints = []
    const numSamples = 8 // 8 points around the city
    
    for (let i = 0; i < numSamples; i++) {
      const angle = (i * 360) / numSamples
      const radians = (angle * Math.PI) / 180
      
      // Calculate offset (approximate, good enough for elevation sampling)
      const latOffset = (radiusKm / 111) * Math.cos(radians) // 1 degree lat ≈ 111km
      const lngOffset = (radiusKm / (111 * Math.cos(cityLat * Math.PI / 180))) * Math.sin(radians)
      
      samplePoints.push({
        lat: cityLat + latOffset,
        lng: cityLng + lngOffset,
        angle: angle
      })
    }
    
    // Add city center
    samplePoints.push({ lat: cityLat, lng: cityLng, angle: 0 })
    
    console.log(`📍 Testing ${samplePoints.length} sample points...`)
    
    const elevations: number[] = []
    
    for (const point of samplePoints) {
      const elevation = await getElevationFromOpenElevation(point.lat, point.lng)
      if (elevation !== null) {
        elevations.push(elevation)
        console.log(`   📏 ${point.angle}° direction: ${elevation}m`)
        
        // Add delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
    
    if (elevations.length > 0) {
      elevations.sort((a, b) => a - b)
      const median = elevations[Math.floor(elevations.length / 2)]
      const average = Math.round(elevations.reduce((a, b) => a + b, 0) / elevations.length)
      const min = Math.min(...elevations)
      const max = Math.max(...elevations)
      
      console.log(`📊 City elevation analysis:`)
      console.log(`   • Samples: ${elevations.length}`)
      console.log(`   • Range: ${min}m - ${max}m`)
      console.log(`   • Average: ${average}m`)
      console.log(`   • Median: ${median}m (recommended)`)
      
      return median // Use median as it's more robust
    }
    
    return null
  } catch (error) {
    console.error('❌ Error sampling city elevation:', error)
    return null
  }
}

// Option 3: Use known city elevations database
const KNOWN_CITY_ELEVATIONS: { [key: string]: number } = {
  // Brazil major cities
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
  'maceió': 7,
  'teresina': 72,
  'são luís': 24,
  'macapá': 16,
  'boa vista': 90,
  'rio branco': 153,
  'porto velho': 90,
  'cuiabá': 165,
  'palmas': 280
}

function getKnownCityElevation(cityName: string): number | null {
  const normalizedName = cityName.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .trim()
  
  return KNOWN_CITY_ELEVATIONS[normalizedName] || null
}

// Option 4: Improved OSM sampling with better query
async function getImprovedOSMElevation(lat: number, lng: number, radiusKm: number = 10): Promise<number | null> {
  try {
    console.log(`🗺️ Improved OSM elevation sampling in ${radiusKm}km radius`)
    
    // Better query targeting more diverse elevation sources
    const overpassQuery = `[out:json][timeout:30];
    (
      // Natural peaks and hills
      node[natural=peak][ele](around:${radiusKm * 1000},${lat},${lng});
      
      // Survey points and benchmarks
      node[man_made=survey_point][ele](around:${radiusKm * 1000},${lat},${lng});
      
      // Places with elevation
      node[place][ele](around:${radiusKm * 1000},${lat},${lng});
      
      // Infrastructure with elevation
      node[aeroway][ele](around:${radiusKm * 1000},${lat},${lng});
      way[aeroway][ele](around:${radiusKm * 1000},${lat},${lng});
      relation[aeroway][ele](around:${radiusKm * 1000},${lat},${lng});
      
      // Buildings with elevation (sample)
      node[building][ele](around:${radiusKm * 1000},${lat},${lng});
    );
    out tags;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (improved-city-elevation)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      console.log(`❌ OSM query failed: ${response.status}`)
      return null
    }

    const data = await response.json()
    const elevations: number[] = []

    console.log(`📊 Found ${data.elements?.length || 0} OSM elements with elevation`)

    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        const tags = element.tags || {}
        if (tags.ele) {
          const elevation = parseInt(tags.ele)
          if (elevation > 0 && elevation < 3000) {
            elevations.push(elevation)
          }
        }
      }
    }

    if (elevations.length > 0) {
      elevations.sort((a, b) => a - b)
      const median = elevations[Math.floor(elevations.length / 2)]
      const average = Math.round(elevations.reduce((a, b) => a + b, 0) / elevations.length)
      const min = Math.min(...elevations)
      const max = Math.max(...elevations)
      
      console.log(`📊 OSM elevation analysis:`)
      console.log(`   • Samples: ${elevations.length}`)
      console.log(`   • Range: ${min}m - ${max}m`)
      console.log(`   • Average: ${average}m`)
      console.log(`   • Median: ${median}m`)
      
      return median
    }

    return null
  } catch (error) {
    console.error('❌ Error with improved OSM elevation:', error)
    return null
  }
}

async function testCityElevationMethods(attractionId: string) {
  console.log('🔍 TESTING CITY ELEVATION DETECTION METHODS')
  console.log('============================================================')

  try {
    // Get POI data
    const { data: attraction, error } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        country,
        coordinates:attraction_coordinate!inner(
          latitude,
          longitude
        )
      `)
      .eq('id', attractionId)
      .single()

    if (error || !attraction) {
      console.error('❌ Error fetching attraction:', error)
      return
    }

    const coord = attraction.coordinates[0]
    console.log(`📍 Testing for: ${attraction.name}`)
    console.log(`🏙️ City: ${attraction.city}, ${attraction.country}`)
    console.log(`📍 Coordinates: ${coord.latitude}, ${coord.longitude}`)
    console.log('')

    // Method 1: Known cities database
    console.log('METHOD 1: KNOWN CITIES DATABASE')
    console.log('============================================================')
    const knownElevation = getKnownCityElevation(attraction.city)
    if (knownElevation) {
      console.log(`✅ Found ${attraction.city}: ${knownElevation}m`)
    } else {
      console.log(`❌ ${attraction.city} not in database`)
    }
    console.log('')

    // Method 2: Open Elevation API (single point)
    console.log('METHOD 2: OPEN ELEVATION API (POI LOCATION)')
    console.log('============================================================')
    const openElevation = await getElevationFromOpenElevation(coord.latitude, coord.longitude)
    console.log('')

    // Method 3: City average elevation sampling
    console.log('METHOD 3: CITY AVERAGE ELEVATION SAMPLING')
    console.log('============================================================')
    const cityAverage = await getCityAverageElevation(coord.latitude, coord.longitude, 5)
    console.log('')

    // Method 4: Improved OSM sampling
    console.log('METHOD 4: IMPROVED OSM SAMPLING')
    console.log('============================================================')
    const osmElevation = await getImprovedOSMElevation(coord.latitude, coord.longitude, 10)
    console.log('')

    // Summary
    console.log('🎯 SUMMARY OF ALL METHODS')
    console.log('============================================================')
    console.log(`Known Database: ${knownElevation ? knownElevation + 'm' : 'N/A'}`)
    console.log(`Open Elevation: ${openElevation ? openElevation + 'm' : 'N/A'}`)
    console.log(`City Average: ${cityAverage ? cityAverage + 'm' : 'N/A'}`)
    console.log(`OSM Improved: ${osmElevation ? osmElevation + 'm' : 'N/A'}`)
    
    // Recommendation
    const methods = [
      { name: 'Known Database', value: knownElevation, priority: 1 },
      { name: 'City Average', value: cityAverage, priority: 2 },
      { name: 'OSM Improved', value: osmElevation, priority: 3 },
      { name: 'Open Elevation', value: openElevation, priority: 4 }
    ]
    
    const validMethods = methods.filter(m => m.value !== null).sort((a, b) => a.priority - b.priority)
    
    if (validMethods.length > 0) {
      const recommended = validMethods[0]
      console.log('')
      console.log(`🏆 RECOMMENDED: ${recommended.name} = ${recommended.value}m`)
      console.log(`📊 This should replace the current default of 200m`)
    } else {
      console.log('')
      console.log(`⚠️ No methods succeeded - would fall back to 200m default`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

// Execute test
const attractionId = process.argv[2] || '14fdc746-840e-4465-8af5-3bce26519be6'
testCityElevationMethods(attractionId)
