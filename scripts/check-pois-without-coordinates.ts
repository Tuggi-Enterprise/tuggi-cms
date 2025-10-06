#!/usr/bin/env tsx

/**
 * Script para verificar POIs sem coordenadas
 * 
 * Este script identifica POIs que não possuem nenhuma coordenada,
 * o que seria um problema grave no sistema.
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

class POICoordinateChecker {
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
   * Verifica POIs sem coordenadas
   */
  async checkPOIsWithoutCoordinates(): Promise<CheckResult> {
    console.log('🔍 Verificando POIs sem coordenadas...')
    
    const errors: string[] = []

    try {
      // 1. Buscar todos os POIs
      const { data: allPOIs, error: poisError } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, country, created_at, updated_at')
        .order('created_at')

      if (poisError) throw poisError

      console.log(`📊 Total de POIs encontrados: ${allPOIs?.length || 0}`)

      // 2. Buscar todas as coordenadas
      const { data: allCoordinates, error: coordsError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id')
        .order('attraction_id')

      if (coordsError) throw coordsError

      console.log(`📊 Total de coordenadas encontradas: ${allCoordinates?.length || 0}`)

      // 3. Criar conjunto de POIs que têm coordenadas
      const poisWithCoordinates = new Set(
        allCoordinates?.map(coord => coord.attraction_id) || []
      )

      // 4. Identificar POIs sem coordenadas
      const problematicPOIs = allPOIs?.filter(poi => 
        !poisWithCoordinates.has(poi.id)
      ) || []

      const totalPOIs = allPOIs?.length || 0
      const poisWithCoordsCount = poisWithCoordinates.size
      const poisWithoutCoordsCount = problematicPOIs.length

      console.log(`\n📋 RESULTADO DA VERIFICAÇÃO:`)
      console.log(`   Total de POIs: ${totalPOIs}`)
      console.log(`   POIs com coordenadas: ${poisWithCoordsCount}`)
      console.log(`   POIs sem coordenadas: ${poisWithoutCoordsCount}`)

      if (poisWithoutCoordsCount > 0) {
        console.log(`\n⚠️  PROBLEMA ENCONTRADO: ${poisWithoutCoordsCount} POIs sem coordenadas!`)
        
        console.log(`\n🔍 POIs sem coordenadas:`)
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
    
    const reportPath = join(process.cwd(), 'scripts', 'pois-without-coordinates-report.json')
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
  const checker = new POICoordinateChecker()
  
  checker.generateReport()
    .then(() => {
      console.log('\n✅ Verificação concluída!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro na verificação:', error)
      process.exit(1)
    })
}

export { POICoordinateChecker }
