import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function debugCoordinatesQuery() {
  console.log('🔍 Debugando queries de coordenadas...\n')
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  try {
    // 1. Verificar tabela attraction_coordinate diretamente
    console.log('1️⃣ Verificando tabela attraction_coordinate...')
    const { count: coordCount } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('id', { count: 'exact', head: true })
    
    console.log(`   Total registros em attraction_coordinate: ${coordCount?.toLocaleString() || 0}`)
    
    // 2. Amostra de attraction_coordinate
    const { data: coordSample } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id, latitude, longitude')
      .limit(5)
    
    console.log('   Amostra de coordenadas:')
    coordSample?.forEach((coord: any, i: number) => {
      console.log(`   ${i+1}. attraction_id: ${coord.attraction_id}, lat: ${coord.latitude}, lng: ${coord.longitude}`)
    })
    
    // 3. Verificar JOIN correto
    console.log('\n2️⃣ Testando JOIN correto...')
    const { data: joinTest } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, 
        name, 
        city,
        attraction_coordinate(latitude, longitude)
      `)
      .limit(5)
    
    console.log('   Teste de JOIN:')
    joinTest?.forEach((poi: any, i: number) => {
      const hasCoord = poi.attraction_coordinate && poi.attraction_coordinate.length > 0
      console.log(`   ${i+1}. ${poi.name} - Tem coordenadas: ${hasCoord}`)
      if (hasCoord) {
        console.log(`       Lat: ${poi.attraction_coordinate[0].latitude}, Lng: ${poi.attraction_coordinate[0].longitude}`)
      }
    })
    
    // 4. Contar POIs que TÊM coordenadas (método correto)
    console.log('\n3️⃣ Contando POIs com coordenadas (método correto)...')
    
    // Método 1: EXISTS
    const { count: methodExists } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('id', 'is', null) // dummy condition
    
    // Buscar alguns POIs e verificar manualmente
    const { data: samplePOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, 
        name, 
        attraction_coordinate(latitude, longitude)
      `)
      .limit(10)
    
    let poisWithCoords = 0
    samplePOIs?.forEach(poi => {
      if (poi.attraction_coordinate && poi.attraction_coordinate.length > 0) {
        poisWithCoords++
      }
    })
    
    console.log(`   Amostra de 10 POIs: ${poisWithCoords} têm coordenadas`)
    
    // 5. Query direta para contar coordenadas únicas
    console.log('\n4️⃣ Contando attraction_ids únicos em attraction_coordinate...')
    const { data: uniqueAttractionIds } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id')
    
    const uniqueIds = new Set(uniqueAttractionIds?.map(c => c.attraction_id))
    console.log(`   POIs únicos com coordenadas: ${uniqueIds.size.toLocaleString()}`)
    
  } catch (error) {
    console.error('❌ Erro:', error)
  }
}

debugCoordinatesQuery().catch(console.error)
