import { getSupabase } from '../lib/core/supabase-client'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function applyQuilomboCorrection() {
  console.log('🔧 Aplicando correção no Quilombo dos Palmares...\n')
  
  const supabase = getSupabase('server')
  
  // Buscar o POI específico
  const { data: poi, error: fetchError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, city_correction_audit')
    .ilike('name', '%Quilombo dos Palmares%')
    .single()
  
  if (fetchError) {
    console.error('❌ Erro buscando POI:', fetchError)
    return
  }
  
  console.log(`📍 POI: ${poi.name}`)
  console.log(`   Cidade atual: ${poi.city}`)
  
  if (!poi.city_correction_audit) {
    console.log('❌ POI não tem auditoria!')
    return
  }
  
  const audit = poi.city_correction_audit
  console.log(`   Cidade sugerida: ${audit.suggested_city}`)
  console.log(`   Confiança: ${audit.confidence}`)
  console.log(`   Precisa correção: ${audit.needs_correction}`)
  
  if (audit.needs_correction && audit.confidence >= 85 && audit.suggested_city) {
    console.log(`\n🔄 Aplicando correção: ${poi.city} → ${audit.suggested_city}`)
    
    const { error: updateError } = await supabase
      .schema('core')
      .from('attractions')
      .update({
        city: audit.suggested_city
      })
      .eq('id', poi.id)
    
    if (updateError) {
      console.error('❌ Erro aplicando correção:', updateError)
    } else {
      console.log('✅ Correção aplicada com sucesso!')
      
      // Verificar se foi aplicada
      const { data: updated, error: verifyError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city')
        .eq('id', poi.id)
        .single()
      
      if (verifyError) {
        console.error('❌ Erro verificando correção:', verifyError)
      } else {
        console.log(`✅ Verificação: cidade agora é "${updated.city}"`)
      }
    }
  } else {
    console.log('⚠️  Correção não atende aos critérios (confiança < 85% ou não precisa correção)')
  }
}

applyQuilomboCorrection().catch(console.error)
