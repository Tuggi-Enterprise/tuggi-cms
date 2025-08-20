import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface TriggerPointData {
  id: string
  attraction_id: string
  location: string
  radius_meters: number
  expected_bearing?: number
  type: string
  priority: number
  access?: string
  name?: string
  description?: string
  created_at: string
}

interface AttractionData {
  id: string
  name: string
  city: string
  country: string
  google_types?: string[]
}

interface CoordinateData {
  attraction_id: string
  latitude: number
  longitude: number
}

/**
 * Script para migrar trigger points existentes para o sistema de aprendizado
 */
async function migrateExistingTriggerPoints() {
  console.log('🚀 MIGRATION: Existing Trigger Points to Learning System')
  console.log('============================================================')
  
  try {
    // 0. Verificar conectividade com Supabase
    console.log('🔌 Step 0: Verifying Supabase connection...')
    const { data: testConnection, error: connectionError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .limit(1)
    
    if (connectionError) {
      console.error('❌ Supabase connection failed:', connectionError)
      throw new Error(`Cannot connect to Supabase: ${connectionError.message}`)
    }
    
    console.log(`✅ Supabase connection successful (${testConnection?.length || 0} attractions accessible)`)
    
    // 1. Buscar todos os trigger points existentes
    console.log('📊 Step 1: Fetching existing trigger points...')
    const { data: triggerPoints, error: tpError } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('*')
      .order('created_at', { ascending: true })
    
    if (tpError) {
      throw new Error(`Failed to fetch trigger points: ${tpError.message}`)
    }
    
    console.log(`✅ Found ${triggerPoints?.length || 0} existing trigger points`)
    
    if (!triggerPoints || triggerPoints.length === 0) {
      console.log('ℹ️  No trigger points found. Migration completed.')
      return
    }
    
    // 2. Buscar dados das atrações
    console.log('🏛️  Step 2: Fetching attraction data...')
    const attractionIds = [...new Set(triggerPoints.map(tp => tp.attraction_id))]
    console.log(`📊 Found ${attractionIds.length} unique attractions to fetch`)
    
    const { data: attractions, error: attractionsError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country, google_types')
      .in('id', attractionIds)
    
    if (attractionsError) {
      console.error('❌ Attractions fetch error details:', attractionsError)
      throw new Error(`Failed to fetch attractions: ${attractionsError.message}`)
    }
    
    console.log(`✅ Fetched ${attractions?.length || 0} attractions`)
    
    // 3. Buscar coordenadas das atrações
    console.log('📍 Step 3: Fetching attraction coordinates...')
    const { data: coordinates, error: coordsError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id, latitude, longitude')
      .in('attraction_id', attractionIds)
    
    if (coordsError) {
      console.error('❌ Coordinates fetch error details:', coordsError)
      throw new Error(`Failed to fetch coordinates: ${coordsError.message}`)
    }
    
    console.log(`✅ Fetched ${coordinates?.length || 0} coordinate sets`)
    
    // 4. Criar mapas para lookup rápido
    const attractionMap = new Map<string, AttractionData>()
    attractions?.forEach(attr => attractionMap.set(attr.id, attr))
    
    const coordinateMap = new Map<string, CoordinateData>()
    coordinates?.forEach(coord => coordinateMap.set(coord.attraction_id, coord))
    
    console.log(`✅ Found data for ${attractionMap.size} attractions with ${coordinateMap.size} coordinate sets`)
    
    // 5. Processar cada trigger point
    console.log('⚙️  Step 4: Processing trigger points for migration...')
    
    let successCount = 0
    let errorCount = 0
    const errors: string[] = []
    
    for (const [index, tp] of triggerPoints.entries()) {
      try {
        console.log(`\n📍 Processing ${index + 1}/${triggerPoints.length}: ${tp.id}`)
        
        const attraction = attractionMap.get(tp.attraction_id)
        const coords = coordinateMap.get(tp.attraction_id)
        
        if (!attraction) {
          throw new Error(`Attraction not found: ${tp.attraction_id}`)
        }
        
        if (!coords) {
          console.log(`⚠️  Warning: No coordinates for attraction ${attraction.name}, skipping...`)
          continue
        }
        
        // Extrair coordenadas do trigger point
        const locationMatch = tp.location.match(/POINT\(([^)]+)\)/)
        if (!locationMatch) {
          throw new Error(`Invalid location format: ${tp.location}`)
        }
        
        const [lng, lat] = locationMatch[1].split(' ').map(Number)
        
        // Calcular distância e bearing
        const distance = calculateDistance(
          { lat, lng },
          { lat: coords.latitude, lng: coords.longitude }
        )
        
        const bearing = calculateBearing(
          { lat, lng },
          { lat: coords.latitude, lng: coords.longitude }
        )
        
        // Detectar densidade urbana
        const urbanDensity = detectUrbanDensity(lat, lng)
        
        // Classificar categoria do POI
        const poiCategory = classifyPOICategory(attraction.google_types, attraction.name)
        
        // Gerar texto de contexto
        const contextText = `POI: ${attraction.name} (${poiCategory}) in ${urbanDensity} area, Distance: ${Math.round(distance)}m, Access: ${tp.access || 'both'}, Type: ${tp.type}, Priority: ${tp.priority}`
        
        // Inserir no sistema de aprendizado
        const { error: insertError } = await supabase
          .schema('core')
          .from('pov_training_examples')
          .insert({
            trigger_point_id: tp.id,
            attraction_id: tp.attraction_id,
            poi_name: attraction.name,
            poi_lat: coords.latitude,
            poi_lng: coords.longitude,
            poi_types: attraction.google_types,
            poi_category: poiCategory,
            urban_density: urbanDensity,
            trigger_lat: lat,
            trigger_lng: lng,
            distance_m: Math.round(distance),
            bearing_deg: Math.round(bearing),
            access_type: tp.access || 'both',
            trigger_type: tp.type,
            priority: tp.priority,
            radius_meters: tp.radius_meters,
            context_text: contextText,
            human_created: true,
            quality_score: 85.0, // Score inicial para dados existentes
            is_positive_example: true,
            estimated_visibility: 'good' // Assumir boa visibilidade para dados existentes
          })
        
        if (insertError) {
          throw new Error(`Failed to insert training example: ${insertError.message}`)
        }
        
        console.log(`✅ Migrated: ${attraction.name} (${distance.toFixed(0)}m, ${bearing.toFixed(0)}°)`)
        successCount++
        
        // Pequena pausa para não sobrecarregar o banco
        if (index % 10 === 9) {
          console.log(`⏳ Processed ${index + 1} items, pausing...`)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        
      } catch (error) {
        console.error(`❌ Error processing trigger point ${tp.id}:`, error)
        errors.push(`${tp.id}: ${error instanceof Error ? error.message : String(error)}`)
        errorCount++
      }
    }
    
    // 6. Atualizar padrões de aprendizado
    console.log('\n🧠 Step 5: Updating learning patterns...')
    const { error: patternsError } = await supabase
      .rpc('update_learning_patterns', {}, { schema: 'core' })
    
    if (patternsError) {
      console.warn(`⚠️  Warning: Failed to update patterns: ${patternsError.message}`)
    } else {
      console.log('✅ Learning patterns updated successfully')
    }
    
    // 7. Verificar resultados
    console.log('\n📊 Step 6: Verification...')
    
    const { data: examplesCount } = await supabase
      .schema('core')
      .from('pov_training_examples')
      .select('id', { count: 'exact', head: true })
    
    const { data: patternsCount } = await supabase
      .schema('core')
      .from('pov_learning_patterns')
      .select('id', { count: 'exact', head: true })
    
    // 8. Relatório final
    console.log('\n🎯 MIGRATION COMPLETED')
    console.log('============================================================')
    console.log(`✅ Successfully migrated: ${successCount} trigger points`)
    console.log(`❌ Errors encountered: ${errorCount} trigger points`)
    console.log(`📊 Total training examples: ${examplesCount?.count || 0}`)
    console.log(`🧠 Learning patterns created: ${patternsCount?.count || 0}`)
    
    if (errors.length > 0) {
      console.log('\n❌ ERRORS SUMMARY:')
      errors.slice(0, 10).forEach(error => console.log(`   - ${error}`))
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`)
      }
    }
    
    console.log('\n🚀 Next steps:')
    console.log('   1. Review migration results')
    console.log('   2. Test pattern extraction')
    console.log('   3. Implement embedding service')
    console.log('   4. Create consultation API')
    
  } catch (error) {
    console.error('💥 MIGRATION FAILED:', error)
    process.exit(1)
  }
}

/**
 * Calcula distância entre dois pontos usando fórmula Haversine
 */
function calculateDistance(from: {lat: number, lng: number}, to: {lat: number, lng: number}): number {
  const R = 6371000 // Earth radius in meters
  const lat1 = from.lat * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  const dLat = (to.lat - from.lat) * Math.PI / 180
  const dLng = (to.lng - from.lng) * Math.PI / 180
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  
  return R * c
}

/**
 * Calcula bearing entre dois pontos
 */
function calculateBearing(from: {lat: number, lng: number}, to: {lat: number, lng: number}): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180
  const lat1 = from.lat * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  
  const bearing = Math.atan2(y, x) * 180 / Math.PI
  return (bearing + 360) % 360
}

/**
 * Detecta densidade urbana baseada em coordenadas
 */
function detectUrbanDensity(lat: number, lng: number): string {
  // São Paulo centro: very_dense
  if (lat >= -23.57 && lat <= -23.52 && lng >= -46.66 && lng <= -46.62) {
    return 'very_dense'
  }
  // São Paulo periferia: dense
  if (lat >= -23.75 && lat <= -23.40 && lng >= -46.80 && lng <= -46.40) {
    return 'dense'
  }
  // Outras áreas metropolitanas: mixed
  if (lat >= -23.85 && lat <= -23.30 && lng >= -46.90 && lng <= -46.30) {
    return 'mixed'
  }
  // Áreas rurais: open
  return 'open'
}

/**
 * Classifica categoria do POI
 */
function classifyPOICategory(googleTypes?: string[], name?: string): string {
  // Classificação baseada em google_types
  if (googleTypes && googleTypes.length > 0) {
    if (googleTypes.includes('park') || googleTypes.includes('natural_feature')) {
      return 'park'
    }
    if (googleTypes.includes('tourist_attraction') || googleTypes.includes('museum')) {
      return 'landmark'
    }
    if (googleTypes.includes('establishment') || googleTypes.includes('point_of_interest')) {
      return 'building'
    }
  }
  
  // Classificação baseada no nome
  if (name) {
    const nameLower = name.toLowerCase()
    if (nameLower.includes('park') || nameLower.includes('jardim')) {
      return 'park'
    }
    if (nameLower.includes('museu') || nameLower.includes('memorial') || nameLower.includes('monumento')) {
      return 'landmark'
    }
    if (nameLower.includes('ponte') || nameLower.includes('bridge')) {
      return 'infrastructure'
    }
  }
  
  return 'building' // Default
}

// Executar migração se script for chamado diretamente
if (require.main === module) {
  migrateExistingTriggerPoints()
    .then(() => {
      console.log('\n🎉 Migration script completed successfully!')
      process.exit(0)
    })
    .catch(error => {
      console.error('\n💥 Migration script failed:', error)
      process.exit(1)
    })
}
