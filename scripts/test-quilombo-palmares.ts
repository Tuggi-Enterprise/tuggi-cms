import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function testQuilomboPalmares() {
  console.log('🔍 Testando "Parque Memorial Quilombo dos Palmares"...\n')
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  // Buscar o POI específico
  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, city_correction_audit')
    .ilike('name', '%Quilombo dos Palmares%')
  
  if (error) {
    console.error('❌ Erro buscando POI:', error)
    return
  }
  
  if (!data || data.length === 0) {
    console.log('❌ POI não encontrado!')
    return
  }
  
  console.log(`✅ POI encontrado: ${data.length} resultado(s)`)
  
  data.forEach((poi: any, index: number) => {
    console.log(`\n${index + 1}. ${poi.name}`)
    console.log(`   ID: ${poi.id}`)
    console.log(`   Cidade atual: ${poi.city}`)
    console.log(`   Auditoria:`, poi.city_correction_audit || 'NULL')
    
    if (poi.city_correction_audit) {
      const audit = poi.city_correction_audit
      console.log(`   ✅ FOI PROCESSADO:`)
      console.log(`      - Processado em: ${audit.processed_at}`)
      console.log(`      - Precisa correção: ${audit.needs_correction}`)
      console.log(`      - Cidade sugerida: ${audit.suggested_city}`)
      console.log(`      - Confiança: ${audit.confidence}`)
      console.log(`      - Fonte: ${audit.source}`)
      console.log(`      - Método: ${audit.processing_method}`)
    } else {
      console.log(`   ❌ NÃO FOI PROCESSADO (audit é NULL)`)
    }
  })
}

testQuilomboPalmares().catch(console.error)
