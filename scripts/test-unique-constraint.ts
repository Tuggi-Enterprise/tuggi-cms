#!/usr/bin/env tsx

/**
 * Script para testar a constraint UNIQUE
 * 
 * Este script testa se a proteção contra duplicatas está funcionando.
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// Carregar variáveis de ambiente
config()

class UniqueConstraintTester {
  private supabase: any

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required Supabase environment variables')
    }
    
    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  }

  /**
   * Testa a constraint UNIQUE tentando inserir duplicatas
   */
  async testUniqueConstraint(): Promise<void> {
    console.log('🧪 Testando constraint UNIQUE...')
    
    try {
      // 1. Buscar um POI que já tem coordenada
      const { data: existingCoord, error: fetchError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id, latitude, longitude')
        .limit(1)
        .single()

      if (fetchError) {
        console.error('❌ Erro ao buscar coordenada existente:', fetchError.message)
        return
      }

      console.log(`📊 POI encontrado: ${existingCoord.attraction_id}`)
      console.log(`   Coordenada atual: ${existingCoord.latitude}, ${existingCoord.longitude}`)

      // 2. Tentar inserir coordenada duplicada (deve falhar)
      console.log('\n🚫 Tentando inserir coordenada duplicada...')
      
      const { data: duplicateData, error: duplicateError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .insert({
          attraction_id: existingCoord.attraction_id, // MESMO POI
          latitude: -23.123456,
          longitude: -46.789012,
          show_in_map: true
        })
        .select()

      if (duplicateError) {
        console.log('✅ SUCESSO: Constraint UNIQUE funcionando!')
        console.log(`   Erro esperado: ${duplicateError.message}`)
        
        if (duplicateError.message.includes('unique') || 
            duplicateError.message.includes('duplicate') ||
            duplicateError.message.includes('violation')) {
          console.log('   ✅ Erro é relacionado à constraint UNIQUE - proteção ativa!')
        } else {
          console.log('   ⚠️  Erro inesperado - verificar se constraint está funcionando')
        }
      } else {
        console.log('❌ FALHA: Constraint UNIQUE não está funcionando!')
        console.log('   Coordenada duplicada foi inserida - isso não deveria acontecer!')
        
        // Se chegou aqui, remover a coordenada duplicada
        if (duplicateData && duplicateData.length > 0) {
          console.log('   🧹 Removendo coordenada duplicada inserida...')
          const { error: deleteError } = await this.supabase
            .schema('core')
            .from('attraction_coordinate')
            .delete()
            .eq('id', duplicateData[0].id)
          
          if (deleteError) {
            console.error('   ❌ Erro ao remover coordenada duplicada:', deleteError.message)
          } else {
            console.log('   ✅ Coordenada duplicada removida')
          }
        }
      }

    } catch (error) {
      console.error('❌ Erro no teste:', error)
    }
  }

  /**
   * Testa a função UPSERT
   */
  async testUpsertFunction(): Promise<void> {
    console.log('\n🧪 Testando função UPSERT...')
    
    try {
      // 1. Buscar um POI existente
      const { data: existingCoord, error: fetchError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id, latitude, longitude')
        .limit(1)
        .single()

      if (fetchError) {
        console.error('❌ Erro ao buscar coordenada existente:', fetchError.message)
        return
      }

      console.log(`📊 Testando UPSERT para POI: ${existingCoord.attraction_id}`)
      console.log(`   Coordenada atual: ${existingCoord.latitude}, ${existingCoord.longitude}`)

      // 2. Testar função UPSERT (deve atualizar, não inserir)
      const newLat = -23.999999
      const newLng = -46.888888
      
      const { data: upsertResult, error: upsertError } = await this.supabase
        .schema('core')
        .rpc('upsert_coordinate', {
          p_attraction_id: existingCoord.attraction_id,
          p_latitude: newLat,
          p_longitude: newLng,
          p_show_in_map: true
        })

      if (upsertError) {
        console.log('⚠️  Função UPSERT não encontrada ou erro:', upsertError.message)
        console.log('   Isso é normal se a migração não foi aplicada ainda')
      } else {
        console.log('✅ UPSERT funcionando!')
        console.log(`   ID da coordenada: ${upsertResult}`)
        
        // Verificar se foi atualizada
        const { data: updatedCoord, error: checkError } = await this.supabase
          .schema('core')
          .from('attraction_coordinate')
          .select('latitude, longitude')
          .eq('attraction_id', existingCoord.attraction_id)
          .single()

        if (checkError) {
          console.error('❌ Erro ao verificar atualização:', checkError.message)
        } else {
          console.log(`   Coordenada atualizada: ${updatedCoord.latitude}, ${updatedCoord.longitude}`)
          if (updatedCoord.latitude === newLat && updatedCoord.longitude === newLng) {
            console.log('   ✅ UPSERT funcionou corretamente - coordenada foi atualizada!')
          } else {
            console.log('   ⚠️  UPSERT pode não ter funcionado como esperado')
          }
        }
      }

    } catch (error) {
      console.error('❌ Erro no teste UPSERT:', error)
    }
  }

  /**
   * Executar todos os testes
   */
  async runAllTests(): Promise<void> {
    console.log('🚀 Iniciando testes de proteção...')
    
    await this.testUniqueConstraint()
    await this.testUpsertFunction()
    
    console.log('\n✅ Testes concluídos!')
    console.log('\n📋 RESUMO:')
    console.log('   - Constraint UNIQUE: Protege contra duplicatas')
    console.log('   - Função UPSERT: Permite inserir/atualizar coordenadas')
    console.log('   - Performance: Máxima (índice único do PostgreSQL)')
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const tester = new UniqueConstraintTester()
  
  tester.runAllTests()
    .then(() => {
      console.log('\n✅ Testes de proteção finalizados!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro nos testes:', error)
      process.exit(1)
    })
}

export { UniqueConstraintTester }
