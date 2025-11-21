/**
 * Script para testar se a view trail_users_from_trips está acessível
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Variáveis de ambiente não configuradas!')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function testView() {
  console.log('🔍 Testando acesso à view trail_users_from_trips...\n')

  // Test 1: Verificar se a view existe
  console.log('1️⃣ Verificando se a view existe...')
  try {
    const { data: testData, error: testError } = await supabase
      .schema('drive')
      .from('trail_users_from_trips')
      .select('user_id')
      .limit(1)

    if (testError) {
      console.error('❌ Erro ao acessar view:')
      console.error('   Code:', testError.code)
      console.error('   Message:', testError.message)
      console.error('   Details:', testError.details)
      console.error('   Hint:', testError.hint)
      return
    }

    console.log('✅ View existe e é acessível!')
    console.log('   Test data:', testData)
  } catch (error) {
    console.error('❌ Erro inesperado:', error)
    return
  }

  // Test 2: Buscar todos os dados
  console.log('\n2️⃣ Buscando todos os dados da view...')
  try {
    const { data, error } = await supabase
      .schema('drive')
      .from('trail_users_from_trips')
      .select('*')
      .order('last_trip', { ascending: false })

    if (error) {
      console.error('❌ Erro ao buscar dados:')
      console.error('   Code:', error.code)
      console.error('   Message:', error.message)
      console.error('   Details:', error.details)
      console.error('   Hint:', error.hint)
      return
    }

    console.log(`✅ Dados encontrados: ${data?.length || 0} usuários`)
    if (data && data.length > 0) {
      console.log('\n📊 Primeiros 5 usuários:')
      data.slice(0, 5).forEach((user, index) => {
        console.log(`   ${index + 1}. User ID: ${user.user_id}`)
        console.log(`      Trips: ${user.trip_count}`)
        console.log(`      Points: ${user.total_points}`)
        console.log(`      Last trip: ${user.last_trip}`)
      })
    }
  } catch (error) {
    console.error('❌ Erro inesperado:', error)
  }

  // Test 3: Verificar estrutura da view
  console.log('\n3️⃣ Verificando estrutura da view...')
  try {
    const { data, error } = await supabase
      .schema('drive')
      .from('trail_users_from_trips')
      .select('*')
      .limit(1)

    if (error) {
      console.error('❌ Erro:', error)
      return
    }

    if (data && data.length > 0) {
      console.log('✅ Estrutura da view:')
      console.log('   Campos:', Object.keys(data[0]))
      console.log('   Exemplo:', JSON.stringify(data[0], null, 2))
    }
  } catch (error) {
    console.error('❌ Erro:', error)
  }

  // Test 4: Verificar permissões
  console.log('\n4️⃣ Verificando permissões...')
  try {
    const { data, error } = await supabase.rpc('get_trail_users', { user_limit: 10 })
    
    if (error) {
      console.log('⚠️  RPC não disponível (não é crítico):', error.message)
    } else {
      console.log('✅ RPC disponível')
    }
  } catch (error) {
    console.log('⚠️  RPC não disponível (não é crítico)')
  }
}

testView().catch(console.error)

