import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Get city base elevation by sampling nearby area
async function getCityBaseElevation(lat: number, lng: number): Promise<number> {
  try {
    console.log(`🏙️ Calculating city base elevation for ${lat}, ${lng}`)
    
    // Sample elevation points in a 2km radius around the POI to get city base
    const overpassQuery = `[out:json][timeout:30];
    (
      node[ele](around:2000,${lat},${lng});
      way[ele](around:2000,${lat},${lng});
    );
    out tags;`

    console.log('🔍 Querying OSM for elevation points in 2km radius...')

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (city-elevation-test)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      console.log('⚠️ City elevation check failed, using regional defaults')
      // Default elevations by region
      if (lat > -25 && lat < -22 && lng > -47 && lng < -43) {
        console.log('📍 São Paulo region detected - using 760m default')
        return 760 // São Paulo region
      } else if (lat > -23.5 && lat < -22 && lng > -44 && lng < -43) {
        console.log('📍 Rio de Janeiro region detected - using 10m default')
        return 10  // Rio de Janeiro region
      }
      console.log('📍 General region - using 200m default')
      return 200 // General default
    }

    const data = await response.json()
    const elevations: number[] = []

    console.log(`📊 Found ${data.elements?.length || 0} elements with elevation data`)

    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        const tags = element.tags || {}
        if (tags.ele) {
          const elevation = parseInt(tags.ele)
          if (elevation > 0 && elevation < 3000) { // Valid elevation range
            elevations.push(elevation)
            console.log(`📏 Sample elevation: ${elevation}m`)
          }
        }
      }
    }

    if (elevations.length > 0) {
      // Use median elevation as city base (more robust than average)
      elevations.sort((a, b) => a - b)
      const median = elevations[Math.floor(elevations.length / 2)]
      const min = Math.min(...elevations)
      const max = Math.max(...elevations)
      const avg = Math.round(elevations.reduce((a, b) => a + b, 0) / elevations.length)
      
      console.log(`🏙️ City base elevation calculated: ${median}m (median from ${elevations.length} samples)`)
      console.log(`📊 Range: ${min}m - ${max}m, Average: ${avg}m`)
      return median
    } else {
      console.log('❌ No elevation data found, using default 200m')
      return 200
    }
  } catch (error) {
    console.error('❌ Error getting city base elevation:', error)
    return 200
  }
}

// Check for POI elevation data
async function checkPOIElevation(lat: number, lng: number): Promise<number | null> {
  try {
    console.log(`🏔️ Checking POI elevation for ${lat}, ${lng}`)
    
    const overpassQuery = `[out:json][timeout:30];
    (
      // Only elements with elevation tags - no type filtering
      way[ele](around:500,${lat},${lng});
      node[ele](around:500,${lat},${lng});
      relation[ele](around:500,${lat},${lng});
    );
    out tags;`

    console.log('🔍 Querying OSM for POI elevation data in 500m radius...')

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (poi-elevation-test)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      console.log('⚠️ POI elevation check failed')
      return null
    }

    const data = await response.json()
    
    console.log(`📊 Found ${data.elements?.length || 0} elements with elevation data near POI`)

    if (data.elements && data.elements.length > 0) {
      for (const element of data.elements) {
        const tags = element.tags || {}
        
        if (tags.ele) {
          const elevation = parseInt(tags.ele)
          console.log(`📏 POI elevation found: ${elevation}m (element type: ${element.type}, tags: ${JSON.stringify(tags)})`)
          return elevation
        }
      }
    }

    console.log('❌ No POI elevation data found')
    return null
  } catch (error) {
    console.error('❌ Error checking POI elevation:', error)
    return null
  }
}

async function testElevationDetection(attractionId: string) {
  console.log('🔍 TESTING ELEVATION DETECTION')
  console.log('============================================================')

  try {
    // Get POI coordinates
    const { data: attraction, error } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
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
    console.log(`📍 Testing elevation for: ${attraction.name}`)
    console.log(`📍 Coordinates: ${coord.latitude}, ${coord.longitude}`)
    console.log('')

    // Test POI elevation detection
    const poiElevation = await checkPOIElevation(coord.latitude, coord.longitude)
    
    console.log('')
    console.log('🏙️ CITY BASE ELEVATION CALCULATION:')
    console.log('============================================================')
    
    // Test city base elevation
    const cityBaseElevation = await getCityBaseElevation(coord.latitude, coord.longitude)
    
    console.log('')
    console.log('🎯 FINAL ANALYSIS:')
    console.log('============================================================')
    
    if (poiElevation !== null) {
      const elevationDiff = poiElevation - cityBaseElevation
      console.log(`📏 POI Elevation: ${poiElevation}m (acima do nível do mar)`)
      console.log(`🏙️ City Base: ${cityBaseElevation}m (mediana da região de 2km)`)
      console.log(`📊 Difference: ${elevationDiff}m (POI - City Base)`)
      console.log('')
      console.log('📝 INTERPRETAÇÃO:')
      console.log(`   • ${poiElevation}m = Altitude do terreno onde está o POI (nível do mar)`)
      console.log(`   • ${cityBaseElevation}m = Altitude mediana da região de Belo Horizonte`)
      console.log(`   • ${elevationDiff}m = Quanto o POI está acima da altitude típica da cidade`)
      
      if (elevationDiff > 200) {
        console.log(`   ⚠️ ${elevationDiff}m > 200m = Classificado como HIGH VISIBILITY`)
        console.log(`   🎯 Isso explica por que foi tratado como landmark`)
      } else {
        console.log(`   ✅ ${elevationDiff}m <= 200m = Classificação normal`)
      }
    } else {
      console.log(`📏 POI Elevation: NÃO ENCONTRADA`)
      console.log(`🏙️ City Base: ${cityBaseElevation}m`)
      console.log(`📊 No elevation comparison possible`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

// Execute test
const attractionId = process.argv[2] || '14fdc746-840e-4465-8af5-3bce26519be6'
testElevationDetection(attractionId)
