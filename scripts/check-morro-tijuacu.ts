import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function checkMorroTijuacu() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log('🔍 Procurando por "Morro Tijuaçu"...')

  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, city_correction_audit')
    .ilike('name', '%Tijuaçu%')
    .limit(5)

  if (error) {
    console.error('❌ Erro:', error)
    return
  }

  console.log(`✅ Encontrados ${data?.length || 0} POIs:`)
  
  data?.forEach((poi, i) => {
    console.log(`\n  POI ${i + 1}:`)
    console.log(`    ID: ${poi.id}`)
    console.log(`    Nome: ${poi.name}`)
    console.log(`    Cidade: ${poi.city}`)
    console.log(`    Audit: ${poi.city_correction_audit ? JSON.stringify(poi.city_correction_audit, null, 2) : 'null'}`)
  })

  // Marcar como processado também
  if (data && data.length > 0) {
    const poiId = data[0].id
    console.log(`\n🔧 Marcando ${data[0].name} como processado...`)
    
    const audit = {
      processed: true,
      processed_at: new Date().toISOString(),
      needs_correction: false,
      needs_manual_review: false,
      manual_fix: true
    }

    const { error: updateError } = await supabase
      .schema('core')
      .from('attractions')
      .update({
        city_correction_audit: audit
      })
      .eq('id', poiId)

    if (updateError) {
      console.error('❌ Erro ao marcar como processado:', updateError)
    } else {
      console.log('✅ Marcado como processado com sucesso!')
    }
  }
}

checkMorroTijuacu().catch(console.error)
