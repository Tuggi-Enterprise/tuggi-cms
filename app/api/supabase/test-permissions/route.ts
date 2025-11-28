import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Cliente sem configuração de schema
const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 [TEST] Testando permissões do Supabase...')

    // Teste 1: Verificar se consegue acessar o schema homolog
    console.log('📊 [TEST] Testando acesso ao schema homolog...')
    
    const { data: schemaTest, error: schemaError } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id')
      .limit(1)

    if (schemaError) {
      console.error('❌ [TEST] Erro ao acessar schema homolog:', schemaError)
      return NextResponse.json({
        success: false,
        error: 'Schema access error',
        details: schemaError.message,
        code: schemaError.code
      }, { status: 500 })
    }

    console.log('✅ [TEST] Schema homolog acessível!')

    // Teste 2: Verificar se consegue executar a função
    console.log('📊 [TEST] Testando função get_pois_paginated...')
    
    const { data: functionTest, error: functionError } = await supabase
      .schema('homolog')
      .rpc('get_pois_paginated', {
        page_limit: 1,
        page_offset: 0,
        search_term: null,
        city_filter: null,
        state_filter: null,
        category_filter: null,
        only_complete: null
      })

    if (functionError) {
      console.error('❌ [TEST] Erro ao executar função:', functionError)
      return NextResponse.json({
        success: false,
        error: 'Function execution error',
        details: functionError.message,
        code: functionError.code
      }, { status: 500 })
    }

    console.log('✅ [TEST] Função executada com sucesso!')

    // Teste 3: Verificar permissões do usuário atual
    console.log('📊 [TEST] Verificando permissões do usuário...')
    
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    console.log('📊 [TEST] Usuário atual:', user ? 'Autenticado' : 'Anônimo')
    console.log('📊 [TEST] Erro de usuário:', userError)

    return NextResponse.json({
      success: true,
      message: 'Todas as permissões estão funcionando!',
      tests: {
        schemaAccess: true,
        functionExecution: true,
        user: user ? 'authenticated' : 'anonymous'
      },
      data: {
        schemaTest: schemaTest?.length || 0,
        functionTest: functionTest?.length || 0
      }
    })

  } catch (error) {
    console.error('❌ [TEST] Erro geral:', error)
    return NextResponse.json({
      success: false,
      error: 'General error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
