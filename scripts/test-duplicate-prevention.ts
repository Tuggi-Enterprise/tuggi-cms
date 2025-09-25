#!/usr/bin/env npx tsx

/**
 * Script para testar a prevenção de coordenadas duplicadas
 * 
 * Este script testa se:
 * 1. A constraint única está funcionando
 * 2. O trigger de validação está ativo
 * 3. Tentativas de inserir coordenadas duplicadas são bloqueadas
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Carregar variáveis de ambiente
config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente do Supabase não encontradas')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testDuplicatePrevention() {
  console.log('🧪 Testando prevenção de coordenadas duplicadas...\n')

  // Primeiro, vamos encontrar um POI existente para usar no teste
  console.log('1. Buscando um POI existente para teste...')
  
  const { data: existingPoi, error: poiError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name')
    .limit(1)
    .single()

  if (poiError || !existingPoi) {
    console.error('❌ Erro ao buscar POI para teste:', poiError)
    return
  }

  console.log(`✅ POI encontrado: ${existingPoi.name} (${existingPoi.id})`)

  // Verificar se este POI já tem coordenadas
  console.log('\n2. Verificando coordenadas existentes...')
  
  const { data: existingCoords, error: coordsError } = await supabase
    .schema('core')
    .from('attraction_coordinate')
    .select('*')
    .eq('attraction_id', existingPoi.id)

  if (coordsError) {
    console.error('❌ Erro ao verificar coordenadas:', coordsError)
    return
  }

  console.log(`📍 POI possui ${existingCoords?.length || 0} coordenada(s)`)

  // Se o POI não tem coordenadas, vamos adicionar uma primeira
  if (!existingCoords || existingCoords.length === 0) {
    console.log('\n3. Adicionando primeira coordenada...')
    
    const { data: newCoord, error: insertError } = await supabase
      .schema('core')
      .from('attraction_coordinate')
      .insert({
        attraction_id: existingPoi.id,
        latitude: -23.5505,
        longitude: -46.6333
      })
      .select()

    if (insertError) {
      console.error('❌ Erro ao inserir primeira coordenada:', insertError)
      return
    }

    console.log('✅ Primeira coordenada adicionada com sucesso')
  }

  // Agora vamos tentar inserir uma coordenada duplicada (deve falhar)
  console.log('\n4. Testando inserção de coordenada duplicada (deve falhar)...')
  
  const { data: duplicateCoord, error: duplicateError } = await supabase
    .schema('core')
    .from('attraction_coordinate')
    .insert({
      attraction_id: existingPoi.id,
      latitude: -23.5506,  // Coordenada ligeiramente diferente
      longitude: -46.6334
    })
    .select()

  if (duplicateError) {
    console.log('✅ SUCESSO: Inserção de coordenada duplicada foi bloqueada!')
    console.log(`📋 Erro esperado: ${duplicateError.message}`)
    
    // Verificar se é o erro da constraint ou do trigger
    if (duplicateError.message.includes('unique_attraction_coordinate')) {
      console.log('🔒 Bloqueado pela constraint única')
    } else if (duplicateError.message.includes('já possui uma coordenada')) {
      console.log('🔒 Bloqueado pelo trigger de validação')
    } else {
      console.log('⚠️  Bloqueado por outro motivo')
    }
  } else {
    console.log('❌ FALHA: Coordenada duplicada foi inserida (não deveria acontecer!)')
    console.log('Coordenada inserida:', duplicateCoord)
    
    // Limpar a coordenada duplicada se foi inserida
    if (duplicateCoord && duplicateCoord.length > 0) {
      await supabase
        .schema('core')
        .from('attraction_coordinate')
        .delete()
        .eq('id', duplicateCoord[0].id)
      console.log('🧹 Coordenada duplicada removida')
    }
  }

  // Testar UPDATE (deve funcionar)
  console.log('\n5. Testando UPDATE de coordenada existente (deve funcionar)...')
  
  const { data: updatedCoord, error: updateError } = await supabase
    .schema('core')
    .from('attraction_coordinate')
    .update({
      latitude: -23.5507,
      longitude: -46.6335
    })
    .eq('attraction_id', existingPoi.id)
    .select()

  if (updateError) {
    console.log('❌ FALHA: UPDATE de coordenada falhou:', updateError.message)
  } else {
    console.log('✅ SUCESSO: UPDATE de coordenada funcionou corretamente')
  }

  console.log('\n🎉 Teste de prevenção de duplicatas concluído!')
}

// Executar o teste
testDuplicatePrevention().catch(console.error)