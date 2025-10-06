#!/usr/bin/env tsx

/**
 * Script corrigido para verificar POIs sem coordenadas
 * 
 * Este script corrige a lógica de verificação que estava falhando.
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Carregar variáveis de ambiente
config()

interface POIWithoutCoordinates {
  id: string
  name: string
  city: string
  country: string
  created_at: string
  updated_at: string
}

interface CheckResult {
  success: boolean
  message: string
  totalPOIs: number
  poisWithoutCoordinates: number
  poisWithCoordinates: number
  problematicPOIs: POIWithoutCoordinates[]
  errors: string[]
}

class FixedPOICoordinateChecker {
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
   * Verifica POIs sem coordenadas com lógica corrigida
   */
  async checkPOIsWithoutCoordinates(): Promise<CheckResult> {
    console.log('🔍 Verificando POIs sem coordenadas (lógica corrigida)...')
    
    const errors: string[] = []

    try {
      // 1. Buscar TODAS as coordenadas com paginação
      let allCoordinates: any[] = []
      let from = 0
      const limit = 1000
      let hasMore = true

      console.log('📊 Buscando todas as coordenadas...')
      
      while (hasMore) {
        const { data: batch, error: fetchError } = await this.supabase
          .schema('core')
          .from('attraction_coordinate')
          .select('attraction_id')
          .order('attraction_id')
          .range(from, from + limit - 1)

        if (fetchError) throw fetchError

        if (batch && batch.length > 0) {
          allCoordinates = allCoordinates.concat(batch)
          from += limit
          console.log(`   Processadas ${allCoordinates.length} coordenadas...`)
          
          hasMore = batch.length === limit
        } else {
          hasMore = false
        }
      }

      console.log(`📊 Total de coordenadas encontradas: ${allCoordinates.length}`)

      // 2. Criar conjunto de POIs que têm coordenadas
      const poisWithCoordinates = new Set(
        allCoordinates.map(coord => coord.attraction_id)
      )

      console.log(`📊 POIs únicos com coordenadas: ${poisWithCoordinates.size}`)

      // 3. Buscar TODOS os POIs com paginação
      let allPOIs: any[] = []
      from = 0
      hasMore = true

      console.log('📊 Buscando todos os POIs...')
      
      while (hasMore) {
        const { data: batch, error: fetchError } = await this.supabase
          .schema('core')
          .from('attractions')
          .select('id, name, city, country, created_at, updated_at')
          .order('created_at')
          .range(from, from + limit - 1)

        if (fetchError) throw fetchError

        if (batch && batch.length > 0) {
          allPOIs = allPOIs.concat(batch)
          from += limit
          console.log(`   Processados ${allPOIs.length} POIs...`)
          
          hasMore = batch.length === limit
        } else {
          hasMore = false
        }
      }

      console.log(`📊 Total de POIs encontrados: ${allPOIs.length}`)

      // 4. Identificar POIs sem coordenadas
      const problematicPOIs = allPOIs.filter(poi => 
        !poisWithCoordinates.has(poi.id)
      )

      const totalPOIs = allPOIs.length
      const poisWithCoordsCount = poisWithCoordinates.size
      const poisWithoutCoordsCount = problematicPOIs.length

      console.log(`\n📋 RESULTADO CORRIGIDO:`)
      console.log(`   Total de POIs: ${totalPOIs}`)
      console.log(`   POIs com coordenadas: ${poisWithCoordsCount}`)
      console.log(`   POIs sem coordenadas: ${poisWithoutCoordsCount}`)

      if (poisWithoutCoordsCount > 0) {
        console.log(`\n⚠️  PROBLEMA ENCONTRADO: ${poisWithoutCoordsCount} POIs sem coordenadas!`)
        
        console.log(`\n🔍 Primeiros 10 POIs sem coordenadas:`)
        problematicPOIs.slice(0, 10).forEach((poi, index) => {
          console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.country})`)
        })
        
        if (poisWithoutCoordsCount > 10) {
          console.log(`   ... e mais ${poisWithoutCoordsCount - 10} POIs`)
        }
      } else {
        console.log(`\n✅ SUCESSO: Todos os POIs possuem coordenadas!`)
      }

      return {
        success: poisWithoutCoordsCount === 0,
        message: poisWithoutCoordsCount === 0 
          ? 'Todos os POIs possuem coordenadas' 
          : `${poisWithoutCoordsCount} POIs sem coordenadas encontrados`,
        totalPOIs,
        poisWithoutCoordinates: poisWithoutCoordsCount,
        poisWithCoordinates: poisWithCoordsCount,
        problematicPOIs,
        errors
      }

    } catch (error) {
      const errorMsg = `Erro na verificação: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      errors.push(errorMsg)
      console.error(`❌ ${errorMsg}`)
      
      return {
        success: false,
        message: errorMsg,
        totalPOIs: 0,
        poisWithoutCoordinates: 0,
        poisWithCoordinates: 0,
        problematicPOIs: [],
        errors
      }
    }
  }

  /**
   * Gera relatório detalhado
   */
  async generateReport(): Promise<void> {
    const result = await this.checkPOIsWithoutCoordinates()
    
    const reportPath = join(process.cwd(), 'scripts', 'fixed-pois-without-coordinates-report.json')
    writeFileSync(reportPath, JSON.stringify(result, null, 2))
    
    console.log('\n📋 RELATÓRIO FINAL:')
    console.log('=' .repeat(50))
    console.log(`Status: ${result.success ? '✅ SUCESSO' : '❌ PROBLEMA ENCONTRADO'}`)
    console.log(`Mensagem: ${result.message}`)
    console.log(`Total de POIs: ${result.totalPOIs}`)
    console.log(`POIs com coordenadas: ${result.poisWithCoordinates}`)
    console.log(`POIs sem coordenadas: ${result.poisWithoutCoordinates}`)
    
    if (result.errors.length > 0) {
      console.log('\n❌ ERROS ENCONTRADOS:')
      result.errors.forEach(error => console.log(`   - ${error}`))
    }
    
    console.log(`\n📄 Relatório salvo em: ${reportPath}`)
    
    if (!result.success) {
      console.log('\n🚨 AÇÃO NECESSÁRIA:')
      console.log('   POIs sem coordenadas precisam ser corrigidos!')
      console.log('   Considere:')
      console.log('   1. Verificar se os POIs foram criados corretamente')
      console.log('   2. Adicionar coordenadas manualmente se necessário')
      console.log('   3. Remover POIs órfãos se não forem válidos')
    }
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const checker = new FixedPOICoordinateChecker()
  
  checker.generateReport()
    .then(() => {
      console.log('\n✅ Verificação corrigida concluída!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro na verificação:', error)
      process.exit(1)
    })
}

export { FixedPOICoordinateChecker }
