import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function checkMorroAlmeida() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log('🔍 Procurando por "Morro do Almeida"...')

  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, city_correction_audit')
    .ilike('name', '%Morro do Almeida%')
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
}

checkMorroAlmeida().catch(console.error)
