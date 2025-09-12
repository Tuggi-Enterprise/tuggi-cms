import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function testUpdateMorro() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const poiId = '3f0e62d2-ba51-46dc-aa2d-37277a461647'
  
  console.log('🧪 Testando atualização direta do Morro do Almeida...')

  const audit = {
    processed: true,
    processed_at: new Date().toISOString(),
    needs_correction: false,
    needs_manual_review: false,
    test: true
  }

  console.log('📝 Tentando atualizar com audit:', JSON.stringify(audit, null, 2))

  const { data, error } = await supabase
    .schema('core')
    .from('attractions')
    .update({
      city_correction_audit: audit
    })
    .eq('id', poiId)
    .select()

  if (error) {
    console.error('❌ Erro na atualização:', error)
  } else {
    console.log('✅ Atualização bem-sucedida:', data)
  }

  // Verificar se foi atualizado
  console.log('\n🔍 Verificando se foi atualizado...')
  
  const { data: checkData, error: checkError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city_correction_audit')
    .eq('id', poiId)
    .single()

  if (checkError) {
    console.error('❌ Erro na verificação:', checkError)
  } else {
    console.log('📋 Resultado da verificação:')
    console.log(`   Nome: ${checkData.name}`)
    console.log(`   Audit: ${checkData.city_correction_audit ? JSON.stringify(checkData.city_correction_audit, null, 2) : 'null'}`)
  }
}

testUpdateMorro().catch(console.error)
