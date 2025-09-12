import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function debugTimeoutIssue() {
  console.log('🔍 Investigando fonte do problema de timeout...\n')
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  try {
    // 1. Testar query simples sem JOIN
    console.log('1️⃣ Testando query simples (sem JOIN)...')
    const startTime1 = Date.now()
    
    const { data: simpleData, error: simpleError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city')
      .order('id')
      .range(1700, 1799) // Offset problemático
    
    const duration1 = Date.now() - startTime1
    
    if (simpleError) {
      console.log(`   ❌ Erro: ${simpleError.message}`)
    } else {
      console.log(`   ✅ Sucesso: ${simpleData?.length || 0} POIs em ${duration1}ms`)
    }
    
    // 2. Testar query com JOIN (problemática)
    console.log('\n2️⃣ Testando query com JOIN (problemática)...')
    const startTime2 = Date.now()
    
    const { data: joinData, error: joinError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        attraction_coordinate!inner(latitude, longitude)
      `)
      .order('id')
      .range(1700, 1799) // Mesmo offset
    
    const duration2 = Date.now() - startTime2
    
    if (joinError) {
      console.log(`   ❌ Erro: ${joinError.message}`)
    } else {
      console.log(`   ✅ Sucesso: ${joinData?.length || 0} POIs em ${duration2}ms`)
    }
    
    // 3. Testar abordagem alternativa (buscar coordenadas separadamente)
    console.log('\n3️⃣ Testando abordagem alternativa...')
    const startTime3 = Date.now()
    
    // Primeiro buscar POIs
    const { data: attractions } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city')
      .order('id')
      .range(1700, 1799)
    
    if (attractions && attractions.length > 0) {
      // Depois buscar coordenadas
      const attractionIds = attractions.map(a => a.id)
      const { data: coordinates } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id, latitude, longitude')
        .in('attraction_id', attractionIds)
      
      const duration3 = Date.now() - startTime3
      console.log(`   ✅ Abordagem alternativa: ${attractions.length} POIs + ${coordinates?.length || 0} coordenadas em ${duration3}ms`)
      
      // Comparar performance
      console.log('\n📊 COMPARAÇÃO DE PERFORMANCE:')
      console.log(`   Query simples: ${duration1}ms`)
      console.log(`   Query JOIN: ${duration2}ms`)
      console.log(`   Abordagem alternativa: ${duration3}ms`)
    }
    
    // 4. Testar diferentes offsets para identificar quando começa o problema
    console.log('\n4️⃣ Testando diferentes offsets...')
    const testOffsets = [0, 500, 1000, 1500, 1700, 2000, 2500]
    
    for (const offset of testOffsets) {
      const startTime = Date.now()
      
      const { data, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          id,
          name,
          city,
          attraction_coordinate!inner(latitude, longitude)
        `)
        .order('id')
        .range(offset, offset + 99)
      
      const duration = Date.now() - startTime
      
      if (error) {
        console.log(`   Offset ${offset}: ❌ ERRO - ${error.message}`)
        break
      } else {
        console.log(`   Offset ${offset}: ✅ ${data?.length || 0} POIs em ${duration}ms`)
      }
      
      // Se demorar mais que 5 segundos, parar
      if (duration > 5000) {
        console.log(`   ⚠️  Timeout detectado no offset ${offset}`)
        break
      }
    }
    
  } catch (error) {
    console.error('❌ Erro geral:', error)
  }
}

debugTimeoutIssue().catch(console.error)
