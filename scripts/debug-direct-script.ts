import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function debugDirectScript() {
  console.log('🔍 Debugando Direct Script...\n')
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  // 1. Verificar total de POIs
  console.log('1️⃣ Verificando total de POIs...')
  const { count: totalPOIs, error: totalError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id', { count: 'exact', head: true })
    .not('attraction_coordinate', 'is', null)
  
  if (totalError) {
    console.error('❌ Erro contando POIs:', totalError)
  } else {
    console.log(`✅ Total POIs com coordenadas: ${totalPOIs}`)
  }
  
  // 2. Verificar POIs já processados
  console.log('\n2️⃣ Verificando POIs já processados...')
  const { count: processedPOIs, error: processedError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id', { count: 'exact', head: true })
    .not('city_correction_audit', 'is', null)
  
  if (processedError) {
    console.error('❌ Erro contando processados:', processedError)
  } else {
    console.log(`✅ POIs já processados: ${processedPOIs}`)
  }
  
  // 3. Verificar POIs pendentes (mesma query do script)
  console.log('\n3️⃣ Verificando POIs pendentes (query do script)...')
  const { data: pendingPOIs, error: pendingError } = await supabase
    .schema('core')
    .from('attractions')
    .select(`
      id, 
      name, 
      city, 
      state, 
      country,
      attraction_coordinate!inner(latitude, longitude)
    `)
    .is('city_correction_audit', null)
    .limit(5)
  
  if (pendingError) {
    console.error('❌ Erro buscando pendentes:', pendingError)
  } else {
    console.log(`✅ POIs pendentes encontrados: ${pendingPOIs?.length || 0}`)
    if (pendingPOIs && pendingPOIs.length > 0) {
      console.log('   Primeiros 3:')
      pendingPOIs.slice(0, 3).forEach((poi: any, i: number) => {
        console.log(`   ${i+1}. ${poi.name} (${poi.city}) - Coord: ${poi.attraction_coordinate?.[0]?.latitude}, ${poi.attraction_coordinate?.[0]?.longitude}`)
      })
    }
  }
  
  // 4. Testar salvamento
  console.log('\n4️⃣ Testando salvamento...')
  if (pendingPOIs && pendingPOIs.length > 0) {
    const testPOI = pendingPOIs[0]
    const testAudit = {
      processed: true,
      processed_at: new Date().toISOString(),
      needs_correction: false,
      needs_manual_review: false,
      suggested_city: null,
      confidence: 0,
      source: 'test',
      processing_method: 'debug_test'
    }
    
    console.log(`   Testando com POI: ${testPOI.name}`)
    
    const { error: saveError } = await supabase
      .schema('core')
      .from('attractions')
      .update({
        city_correction_audit: testAudit
      })
      .eq('id', testPOI.id)
    
    if (saveError) {
      console.error('❌ Erro salvando teste:', saveError)
    } else {
      console.log('✅ Salvamento funcionou!')
      
      // Verificar se foi salvo
      const { data: verifyData, error: verifyError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city_correction_audit')
        .eq('id', testPOI.id)
        .single()
      
      if (verifyError) {
        console.error('❌ Erro verificando salvamento:', verifyError)
      } else {
        console.log('✅ Verificação OK:', verifyData?.city_correction_audit)
      }
    }
  }
  
  // 5. Verificar estrutura da tabela
  console.log('\n5️⃣ Verificando estrutura da tabela...')
  const { data: sampleData, error: sampleError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, city_correction_audit')
    .limit(1)
    .single()
  
  if (sampleError) {
    console.error('❌ Erro verificando estrutura:', sampleError)
  } else {
    console.log('✅ Estrutura OK:', {
      id: sampleData?.id,
      name: sampleData?.name,
      city: sampleData?.city,
      has_audit: !!sampleData?.city_correction_audit
    })
  }
}

debugDirectScript().catch(console.error)
