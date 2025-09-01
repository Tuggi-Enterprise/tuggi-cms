import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Detect POI height from OSM building data
async function detectPOIHeight(lat: number, lng: number): Promise<{ height: number, category: 'low' | 'medium' | 'high' | 'very_high', confidence: number }> {
  try {
    console.log(`🏗️ Detecting REAL POI height for ${lat}, ${lng}`)
    
    // PRIORITY 1: Search for buildings AND TOWERS with REAL height data
    const realHeightQuery = `[out:json][timeout:60];
(
  // Search for buildings with direct height data
  way[building][height](around:50,${lat},${lng});
  relation[building][height](around:50,${lat},${lng});
  
  // Search for buildings with building:height
  way[building]["building:height"](around:50,${lat},${lng});
  relation[building]["building:height"](around:50,${lat},${lng});
  
  // Search for buildings with building:levels (most common)
  way[building]["building:levels"](around:50,${lat},${lng});
  relation[building]["building:levels"](around:50,${lat},${lng});
  
  // EXPANDED: Search for towers and building parts with height (like Sagrada Família towers)
  way[man_made=tower][height](around:200,${lat},${lng});
  relation[man_made=tower][height](around:200,${lat},${lng});
  way["building:part"=tower][height](around:200,${lat},${lng});
  relation["building:part"=tower][height](around:200,${lat},${lng});
  
  // Search for any building parts with height data
  way["building:part"][height](around:100,${lat},${lng});
  relation["building:part"][height](around:100,${lat},${lng});
);
out tags;`

    console.log(`🔍 Searching for REAL height data in OSM...`)
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: realHeightQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (height-detection-test)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      console.log(`❌ Overpass API error: ${response.status}`)
      return { height: 0, category: 'low', confidence: 0.0 }
    }

    const data = await response.json()
    
    if (!data || !data.elements || data.elements.length === 0) {
      console.log('❌ NO REAL HEIGHT DATA found in OSM for this location')
      return { 
        height: 0, 
        category: 'low', 
        confidence: 0.0 // Zero confidence = no real data
      }
    }
    
    // Process REAL height data found
    console.log(`✅ Found ${data.elements.length} buildings/towers with height data`)
    
    let bestHeight = 0
    let bestConfidence = 0
    let bestSource = 'none'
    let bestStructure = 'building'
    
    for (const element of data.elements) {
      const tags = element.tags || {}
      let realHeight = 0
      let confidence = 0
      let source = 'none'
      let structureType = 'building'
      
      // Determine structure type for better logging
      if (tags.man_made === 'tower' || tags['building:part'] === 'tower') {
        structureType = 'tower'
      } else if (tags['building:part']) {
        structureType = 'building_part'
      }
      
      // PRIORITY 1: Direct height tag (most reliable)
      if (tags.height) {
        const heightMatch = tags.height.match(/(\d+(?:\.\d+)?)/);
        if (heightMatch) {
          realHeight = parseFloat(heightMatch[1])
          confidence = 0.95
          source = 'direct_height'
          const structureName = tags.name || `${structureType}`
          console.log(`🎯 REAL HEIGHT found: ${realHeight}m from ${structureName} (${structureType})`)
        }
      }
      
      // PRIORITY 2: building:height tag
      else if (tags['building:height']) {
        const heightMatch = tags['building:height'].match(/(\d+(?:\.\d+)?)/);
        if (heightMatch) {
          realHeight = parseFloat(heightMatch[1])
          confidence = 0.9
          source = 'building_height'
          console.log(`🎯 REAL HEIGHT found: ${realHeight}m from building:height tag`)
        }
      }
      
      // PRIORITY 3: building:levels (calculate from floors)
      else if (tags['building:levels']) {
        const levels = parseInt(tags['building:levels'])
        if (levels > 0) {
          realHeight = levels * 3.5 // Standard floor height
          confidence = 0.8
          source = 'building_levels'
          console.log(`🏢 REAL HEIGHT calculated: ${realHeight}m from ${levels} levels`)
        }
      }
      
      // Store the best result
      if (realHeight > 0 && confidence > bestConfidence) {
        bestHeight = realHeight
        bestConfidence = confidence
        bestSource = source
        bestStructure = structureType
      }
    }
    
    if (bestHeight === 0) {
      console.log('❌ No valid height data found in any building')
      return { height: 0, category: 'low', confidence: 0.0 }
    }
    
    // Categorize height
    let category: 'low' | 'medium' | 'high' | 'very_high'
    if (bestHeight < 20) {
      category = 'low'
    } else if (bestHeight < 50) {
      category = 'medium'
    } else if (bestHeight < 100) {
      category = 'high'
    } else {
      category = 'very_high'
    }
    
    console.log(`✅ FINAL HEIGHT RESULT: ${bestHeight}m (${category}, confidence: ${bestConfidence}, source: ${bestSource}, structure: ${bestStructure})`)
    
    return {
      height: bestHeight,
      category,
      confidence: bestConfidence
    }
    
  } catch (error) {
    console.error('❌ Error detecting POI height:', error)
    return { height: 0, category: 'low', confidence: 0.0 }
  }
}

async function testPOIHeightDetection(attractionId: string) {
  console.log('🔍 TESTING POI HEIGHT DETECTION')
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
    console.log(`📍 Testing height detection for: ${attraction.name}`)
    console.log(`📍 Coordinates: ${coord.latitude}, ${coord.longitude}`)
    console.log('')

    // Test height detection
    const heightResult = await detectPOIHeight(coord.latitude, coord.longitude)
    
    console.log('')
    console.log('🎯 FINAL RESULT:')
    console.log('============================================================')
    console.log(`Height: ${heightResult.height}m`)
    console.log(`Category: ${heightResult.category}`)
    console.log(`Confidence: ${heightResult.confidence}`)
    
    // Show what this means for landmark classification
    if (heightResult.confidence > 0) {
      console.log('')
      console.log('📊 LANDMARK CLASSIFICATION IMPACT:')
      console.log('============================================================')
      
      if (heightResult.category === 'very_high') {
        console.log('🏙️ Would be classified as LANDMARK (very_high > 100m)')
        console.log('🎯 This explains why minPointDistance=100m was used')
      } else if (heightResult.category === 'high') {
        console.log('🏗️ Would get HIGH visibility treatment (50-100m)')
        console.log('🎯 This explains increased trigger point spacing')
      } else {
        console.log('🏠 Would use standard visibility treatment')
      }
    } else {
      console.log('📍 No height data available - would use default treatment')
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

// Execute test
const attractionId = process.argv[2] || '14fdc746-840e-4465-8af5-3bce26519be6'
testPOIHeightDetection(attractionId)
