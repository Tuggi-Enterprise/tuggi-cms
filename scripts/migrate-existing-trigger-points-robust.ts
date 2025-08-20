import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:')
  console.error('   - NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl)
  console.error('   - SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface TriggerPointData {
  id: string
  attraction_id: string
  location: string | { type: string; coordinates: [number, number] }
  location_text?: string // Campo adicional com coordenadas em texto
  radius_meters: number
  expected_bearing?: number
  type: string
  priority: number
  access?: string
  name?: string
  description?: string
  created_at: string
}

/**
 * Versão robusta do script de migração com processamento em lotes
 */
async function migrateExistingTriggerPointsRobust(dryRun: boolean = false) {
  console.log('🚀 ROBUST MIGRATION: Existing Trigger Points to Learning System')
  console.log('============================================================')
  
  if (dryRun) {
    console.log('🧪 DRY RUN MODE: No data will be inserted, only analysis')
    console.log('============================================================')
  }
  
  try {
    // 1. Verificar conectividade básica
    console.log('🔧 Step 1: Verifying database connectivity...')
    
    try {
      // Teste simples de conectividade
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select('id')
        .limit(1)
      
      if (error) {
        console.error('❌ Database connection failed:', error.message)
        throw new Error(`Cannot connect to database: ${error.message}`)
      }
      
      console.log('✅ Database connectivity verified')
    } catch (error) {
      console.error('❌ Database verification failed:', error)
      throw error
    }
    
    // 2. Verificar trigger points já migrados
    console.log('🔍 Step 2: Checking already migrated trigger points...')
    
    let migratedIds = new Set<string>()
    
    try {
      const { data: alreadyMigrated, error: migratedError } = await supabase
        .schema('core')
        .from('pov_training_examples')
        .select('trigger_point_id')
      
      if (migratedError) {
        if (migratedError.message.includes('relation') && migratedError.message.includes('does not exist')) {
          console.log('ℹ️  Training examples table does not exist yet - this is the first migration')
        } else {
          console.error('❌ Error checking migrated trigger points:', migratedError)
          throw new Error(`Cannot check migrated data: ${migratedError.message}`)
        }
      } else {
        migratedIds = new Set(alreadyMigrated?.map(item => item.trigger_point_id) || [])
      }
    } catch (error) {
      console.warn('⚠️  Could not check for existing migrations - assuming first run')
    }
    
    console.log(`✅ Found ${migratedIds.size} already migrated trigger points`)
    
    // 3. Buscar trigger points em lotes (respeitando limite de 1000)
    console.log('📊 Step 3: Fetching trigger points in batches...')
    
    let allTriggerPoints: TriggerPointData[] = []
    let offset = 0
    const batchSize = 1000 // Máximo permitido pelo Supabase
    let totalFetched = 0
    
    while (true) {
      console.log(`📦 Fetching batch starting at offset ${offset}...`)
      
      const { data: batch, error } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .select(`
          id,
          attraction_id,
          radius_meters,
          expected_bearing,
          type,
          priority,
          access,
          name,
          description,
          created_at
        `)
        .range(offset, offset + batchSize - 1)
        .order('created_at', { ascending: true })
      
      if (error) {
        console.error(`❌ Error fetching trigger points batch at offset ${offset}:`, error)
        break
      }
      
      if (!batch || batch.length === 0) {
        console.log(`✅ No more trigger points to fetch (fetched ${batch?.length || 0} in this batch)`)
        break
      }
      
      // Filtrar trigger points já migrados
      const newTriggerPoints = batch.filter(tp => !migratedIds.has(tp.id))
      allTriggerPoints.push(...newTriggerPoints)
      totalFetched += batch.length
      
      console.log(`📦 Batch ${Math.floor(offset / batchSize) + 1}: ${batch.length} fetched, ${newTriggerPoints.length} new (total new: ${allTriggerPoints.length}, total fetched: ${totalFetched})`)
      
      // Se recebemos menos que o batch size, chegamos ao fim
      if (batch.length < batchSize) {
        console.log(`✅ Reached end of data (batch size ${batch.length} < ${batchSize})`)
        break
      }
      
      // Proteção contra loop infinito
      if (batch.length === 0) {
        console.log(`✅ No more data available`)
        break
      }
      
      offset += batchSize
      
      // Pausa entre lotes para não sobrecarregar
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    console.log(`✅ Total trigger points found: ${totalFetched}`)
    console.log(`✅ New trigger points to migrate: ${allTriggerPoints.length}`)
    console.log(`✅ Already migrated (skipped): ${migratedIds.size}`)
    
    if (allTriggerPoints.length === 0) {
      console.log('ℹ️  No trigger points found. Migration completed.')
      return
    }
    
    // 4. Processar em lotes pequenos
    console.log('⚙️  Step 4: Processing trigger points in small batches...')
    
    const processingBatchSize = 10
    let successCount = 0
    let errorCount = 0
    const errors: string[] = []
    
    for (let i = 0; i < allTriggerPoints.length; i += processingBatchSize) {
      const batch = allTriggerPoints.slice(i, i + processingBatchSize)
      
      console.log(`\n📦 Processing batch ${Math.floor(i / processingBatchSize) + 1}/${Math.ceil(allTriggerPoints.length / processingBatchSize)} (${batch.length} items)`)
      
      for (const tp of batch) {
        try {
          await processSingleTriggerPoint(tp, dryRun)
          successCount++
          if (dryRun) {
            console.log(`🧪 ${successCount}: Analyzed ${tp.id}`)
          } else {
            console.log(`✅ ${successCount}: Processed ${tp.id}`)
          }
        } catch (error) {
          errorCount++
          const errorMsg = `${tp.id}: ${error instanceof Error ? error.message : String(error)}`
          errors.push(errorMsg)
          
          // Handle different types of errors more gracefully
          if (error instanceof Error && error.message.includes('already exists')) {
            console.log(`⏭️  ${tp.id}: Already migrated (skipping)`)
            errorCount-- // Don't count this as a real error
          } else if (error instanceof Error && error.message.includes('not found')) {
            console.warn(`⚠️  ${tp.id}: Missing data (${error.message})`)
          } else {
            console.error(`❌ ${errorCount}: Failed ${tp.id} - ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      
      // Pausa entre lotes
      console.log(`⏳ Batch completed. Pausing 2s...`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    
    // 5. Atualizar padrões de aprendizado (será implementado em Phase 2)
    console.log('\n🧠 Step 5: Learning patterns update...')
    console.log('ℹ️  Learning patterns analysis will be implemented in Phase 2 - skipping for now')
    
    // 6. Relatório final
    console.log('\n🎯 MIGRATION COMPLETED')
    console.log('============================================================')
    console.log(`✅ Successfully processed: ${successCount} trigger points`)
    console.log(`❌ Errors encountered: ${errorCount} trigger points`)
    console.log(`📊 Success rate: ${((successCount / allTriggerPoints.length) * 100).toFixed(1)}%`)
    
    if (errors.length > 0) {
      console.log('\n❌ ERRORS SUMMARY (first 10):')
      errors.slice(0, 10).forEach(error => console.log(`   - ${error}`))
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`)
      }
    }
    
    // 7. Verificação final
    const { data: examplesCount } = await supabase
      .schema('core')
      .from('pov_training_examples')
      .select('id', { count: 'exact', head: true })
    
    const { data: patternsCount } = await supabase
      .schema('core')
      .from('pov_learning_patterns')
      .select('id', { count: 'exact', head: true })
    
    console.log(`\n📈 FINAL RESULTS:`)
    console.log(`   📊 Training examples: ${examplesCount?.length || 0}`)
    console.log(`   🧠 Learning patterns: ${patternsCount?.length || 0}`)
    
    if ((examplesCount?.length || 0) > 0) {
      console.log('\n🚀 Next steps:')
      console.log('   1. Run: npm run test:learning-system')
      console.log('   2. Proceed to Phase 2: API Implementation')
    }
    
  } catch (error) {
    console.error('💥 MIGRATION FAILED:', error)
    process.exit(1)
  }
}

/**
 * Processa um único trigger point
 */
async function processSingleTriggerPoint(tp: TriggerPointData, dryRun: boolean = false): Promise<void> {
  // 1. Buscar dados da atração
  const { data: attraction, error: attrError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, country, google_types')
    .eq('id', tp.attraction_id)
    .single()
  
  if (attrError || !attraction) {
    throw new Error(`Attraction not found: ${tp.attraction_id}`)
  }
  
  // 2. Buscar coordenadas da atração
  const { data: coords, error: coordsError } = await supabase
    .schema('core')
    .from('attraction_coordinate')
    .select('latitude, longitude')
    .eq('attraction_id', tp.attraction_id)
    .single()
  
  if (coordsError || !coords) {
    throw new Error(`Coordinates not found for attraction: ${attraction.name}`)
  }
  
  // 3. Buscar coordenadas do trigger point usando SQL
  let lat: number, lng: number
  
  try {
    // Buscar o trigger point com location para usar as funções RPC existentes
    const { data: triggerPointData, error: tpError } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('location')
      .eq('id', tp.id)
      .single()
    
    if (tpError || !triggerPointData) {
      throw new Error(`Cannot fetch trigger point location: ${tpError?.message || 'not found'}`)
    }
    
    // Usar as funções RPC existentes para extrair lat/lng
    const { data: latData, error: latError } = await supabase
      .schema('core')
      .rpc('get_trigger_point_lat', { point: triggerPointData.location })
    
    const { data: lngData, error: lngError } = await supabase
      .schema('core')
      .rpc('get_trigger_point_lng', { point: triggerPointData.location })
    
    if (latError || lngError) {
      throw new Error(`RPC error: ${latError?.message || lngError?.message}`)
    }
    
    lat = latData
    lng = lngData
    
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error(`Invalid coordinates returned: lat=${lat}, lng=${lng}`)
    }
    
    console.log(`🔍 Extracted coordinates for ${tp.id}: ${lat}, ${lng}`)
  } catch (error) {
    throw new Error(`Failed to get trigger point coordinates: ${error instanceof Error ? error.message : String(error)}`)
  }
  
  // 4. Calcular distância e bearing
  const distance = calculateDistance(
    { lat, lng },
    { lat: coords.latitude, lng: coords.longitude }
  )
  
  const bearing = calculateBearing(
    { lat, lng },
    { lat: coords.latitude, lng: coords.longitude }
  )
  
  // 5. Detectar contexto
  const urbanDensity = detectUrbanDensity(lat, lng)
  const poiCategory = classifyPOICategory(attraction.google_types, attraction.name)
  
  // 6. Gerar contexto
  const contextText = `POI: ${attraction.name} (${poiCategory}) in ${urbanDensity} area, Distance: ${Math.round(distance)}m, Access: ${tp.access || 'both'}, Type: ${tp.type}, Priority: ${tp.priority}`
  
  // 7. Verificar se já existe (dupla verificação)
  const { data: existing, error: existingError } = await supabase
    .schema('core')
    .from('pov_training_examples')
    .select('id')
    .eq('trigger_point_id', tp.id)
    .maybeSingle() // Use maybeSingle instead of single to avoid error when not found
  
  if (existingError) {
    throw new Error(`Error checking existing training example: ${existingError.message}`)
  }
  
  if (existing) {
    throw new Error(`Training example already exists for trigger point ${tp.id} (skipping)`)
  }
  
  // 8. Inserir exemplo de treinamento (ou simular em dry run)
  if (dryRun) {
    // Em modo dry run, apenas validamos os dados sem inserir
    console.log(`🧪 DRY RUN: Would insert training example for ${tp.id} - ${attraction.name} (${Math.round(distance)}m, ${tp.access || 'both'} access)`)
    return
  }
  
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
      quality_score: 85.0,
      is_positive_example: true,
      estimated_visibility: 'good'
    })
  
  if (insertError) {
    throw new Error(`Failed to insert training example: ${insertError.message}`)
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
  // Verificar argumentos da linha de comando
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run') || args.includes('--test')
  
  if (dryRun) {
    console.log('🧪 Starting migration in DRY RUN mode...\n')
  }
  
  migrateExistingTriggerPointsRobust(dryRun)
    .then(() => {
      if (dryRun) {
        console.log('\n🧪 Dry run completed successfully!')
        console.log('💡 To run the actual migration, use: npm run migrate:trigger-points-robust')
      } else {
        console.log('\n🎉 Robust migration completed successfully!')
      }
      process.exit(0)
    })
    .catch(error => {
      console.error('\n💥 Robust migration failed:', error)
      process.exit(1)
    })
}
