import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function debugCurrentSituation() {
  console.log('🔍 Verificando situação atual do banco de dados...\n')
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  try {
    // 1. Total de POIs
    console.log('1️⃣ Contando POIs totais...')
    const { count: totalPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
    
    console.log(`   Total de POIs: ${totalPOIs?.toLocaleString() || 0}`)
    
    // 2. POIs com coordenadas
    console.log('\n2️⃣ Contando POIs com coordenadas...')
    const { count: poisWithCoords } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('attraction_coordinate', 'is', null)
    
    console.log(`   POIs com coordenadas: ${poisWithCoords?.toLocaleString() || 0}`)
    
    // 3. POIs já processados (com audit)
    console.log('\n3️⃣ Contando POIs já processados...')
    const { count: processedPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('city_correction_audit', 'is', null)
    
    console.log(`   POIs já processados: ${processedPOIs?.toLocaleString() || 0}`)
    
    // 4. POIs com coordenadas MAS sem audit (pendentes)
    console.log('\n4️⃣ Contando POIs pendentes...')
    const { count: pendingPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .not('attraction_coordinate', 'is', null)
      .is('city_correction_audit', null)
    
    console.log(`   POIs pendentes: ${pendingPOIs?.toLocaleString() || 0}`)
    
    // 5. POIs que precisam correção
    console.log('\n5️⃣ Contando POIs que precisam correção...')
    const { data: needsCorrectionData } = await supabase
      .schema('core')
      .from('attractions')
      .select('city_correction_audit')
      .not('city_correction_audit', 'is', null)
    
    const needsCorrection = needsCorrectionData?.filter((poi: any) => 
      poi.city_correction_audit?.needs_correction === true
    ).length || 0
    
    console.log(`   POIs que precisam correção: ${needsCorrection.toLocaleString()}`)
    
    // 6. Verificar alguns POIs que estavam em loop
    console.log('\n6️⃣ Verificando POIs problemáticos...')
    const { data: problematicPOIs } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, city_correction_audit')
      .in('name', [
        'Pedra do Quita',
        'Pedra dos Monges',
        'Monumento a João Batista das Neves et al.',
        'Pedra Hime',
        'Pedra do Calhariz'
      ])
      .limit(10)
    
    console.log(`   POIs problemáticos encontrados: ${problematicPOIs?.length || 0}`)
    problematicPOIs?.forEach((poi: any, i: number) => {
      console.log(`   ${i+1}. ${poi.name} (${poi.city}) - Processado: ${!!poi.city_correction_audit}`)
    })
    
    // 7. Resumo
    console.log('\n📊 RESUMO:')
    console.log(`   Total POIs: ${totalPOIs?.toLocaleString() || 0}`)
    console.log(`   Com coordenadas: ${poisWithCoords?.toLocaleString() || 0}`)
    console.log(`   Já processados: ${processedPOIs?.toLocaleString() || 0}`)
    console.log(`   Pendentes: ${pendingPOIs?.toLocaleString() || 0}`)
    console.log(`   Precisam correção: ${needsCorrection.toLocaleString()}`)
    
    const progressPercentage = poisWithCoords ? ((processedPOIs || 0) / poisWithCoords * 100).toFixed(2) : '0.00'
    console.log(`   Progresso: ${progressPercentage}%`)
    
  } catch (error) {
    console.error('❌ Erro:', error)
  }
}

debugCurrentSituation().catch(console.error)
