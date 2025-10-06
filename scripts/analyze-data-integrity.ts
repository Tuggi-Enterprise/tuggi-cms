#!/usr/bin/env tsx

/**
 * Script para analisar integridade dos dados
 * 
 * Este script analisa a relação entre POIs e coordenadas
 * para identificar problemas de integridade.
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Carregar variáveis de ambiente
config()

interface IntegrityAnalysis {
  success: boolean
  message: string
  totalPOIs: number
  totalCoordinates: number
  uniquePOIsWithCoordinates: number
  orphanedCoordinates: number
  duplicatePOIs: number
  errors: string[]
}

class DataIntegrityAnalyzer {
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
   * Analisa integridade dos dados
   */
  async analyzeIntegrity(): Promise<IntegrityAnalysis> {
    console.log('🔍 Analisando integridade dos dados...')
    
    const errors: string[] = []

    try {
      // 1. Contar total de POIs
      const { count: totalPOIs, error: poisCountError } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })

      if (poisCountError) throw poisCountError

      // 2. Contar total de coordenadas
      const { count: totalCoordinates, error: coordsCountError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('*', { count: 'exact', head: true })

      if (coordsCountError) throw coordsCountError

      // 3. Buscar POIs únicos que têm coordenadas
      const { data: poisWithCoords, error: coordsError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('attraction_id')
        .order('attraction_id')

      if (coordsError) throw coordsError

      // 4. Contar POIs únicos com coordenadas
      const uniquePOIsWithCoordinates = new Set(
        poisWithCoords?.map(coord => coord.attraction_id) || []
      ).size

      // 5. Verificar coordenadas órfãs (que referenciam POIs inexistentes)
      const { data: orphanedCoords, error: orphanedError } = await this.supabase
        .schema('core')
        .rpc('check_orphaned_coordinates')

      let orphanedCoordinates = 0
      if (orphanedError) {
        console.log('⚠️  Função RPC não encontrada, usando método alternativo...')
        // Método alternativo: buscar coordenadas que não têm POI correspondente
        const { data: allCoords, error: allCoordsError } = await this.supabase
          .schema('core')
          .from('attraction_coordinate')
          .select('attraction_id')
          .order('attraction_id')

        if (allCoordsError) throw allCoordsError

        const { data: allPOIs, error: allPOIsError } = await this.supabase
          .schema('core')
          .from('attractions')
          .select('id')
          .order('id')

        if (allPOIsError) throw allPOIsError

        const existingPOIs = new Set(allPOIs?.map(poi => poi.id) || [])
        orphanedCoordinates = allCoords?.filter(coord => 
          !existingPOIs.has(coord.attraction_id)
        ).length || 0
      } else {
        orphanedCoordinates = orphanedCoords?.length || 0
      }

      // 6. Verificar POIs duplicados
      const { data: duplicatePOIs, error: duplicateError } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('name, city, country')
        .order('name, city, country')

      if (duplicateError) throw duplicateError

      // Contar duplicatas por nome + cidade + país
      const nameCityCountryMap = new Map<string, number>()
      duplicatePOIs?.forEach(poi => {
        const key = `${poi.name}|${poi.city}|${poi.country}`
        nameCityCountryMap.set(key, (nameCityCountryMap.get(key) || 0) + 1)
      })

      const duplicatePOIsCount = Array.from(nameCityCountryMap.values())
        .filter(count => count > 1)
        .reduce((sum, count) => sum + count - 1, 0)

      console.log(`\n📊 ANÁLISE DE INTEGRIDADE:`)
      console.log(`   Total de POIs: ${totalPOIs}`)
      console.log(`   Total de coordenadas: ${totalCoordinates}`)
      console.log(`   POIs únicos com coordenadas: ${uniquePOIsWithCoordinates}`)
      console.log(`   Coordenadas órfãs: ${orphanedCoordinates}`)
      console.log(`   POIs duplicados: ${duplicatePOIsCount}`)

      // 7. Calcular estatísticas
      const poisWithoutCoords = totalPOIs - uniquePOIsWithCoordinates
      const coordsWithoutPOIs = orphanedCoordinates

      console.log(`\n📋 PROBLEMAS IDENTIFICADOS:`)
      console.log(`   POIs sem coordenadas: ${poisWithoutCoords}`)
      console.log(`   Coordenadas órfãs: ${coordsWithoutPOIs}`)
      console.log(`   POIs duplicados: ${duplicatePOIsCount}`)

      return {
        success: poisWithoutCoords === 0 && coordsWithoutPOIs === 0 && duplicatePOIsCount === 0,
        message: `Análise concluída: ${poisWithoutCoords} POIs sem coordenadas, ${coordsWithoutPOIs} coordenadas órfãs, ${duplicatePOIsCount} POIs duplicados`,
        totalPOIs: totalPOIs || 0,
        totalCoordinates: totalCoordinates || 0,
        uniquePOIsWithCoordinates,
        orphanedCoordinates,
        duplicatePOIs: duplicatePOIsCount,
        errors
      }

    } catch (error) {
      const errorMsg = `Erro na análise: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      errors.push(errorMsg)
      console.error(`❌ ${errorMsg}`)
      
      return {
        success: false,
        message: errorMsg,
        totalPOIs: 0,
        totalCoordinates: 0,
        uniquePOIsWithCoordinates: 0,
        orphanedCoordinates: 0,
        duplicatePOIs: 0,
        errors
      }
    }
  }

  /**
   * Gera relatório detalhado
   */
  async generateReport(): Promise<void> {
    const result = await this.analyzeIntegrity()
    
    const reportPath = join(process.cwd(), 'scripts', 'data-integrity-report.json')
    writeFileSync(reportPath, JSON.stringify(result, null, 2))
    
    console.log('\n📋 RELATÓRIO FINAL:')
    console.log('=' .repeat(50))
    console.log(`Status: ${result.success ? '✅ DADOS ÍNTEGROS' : '❌ PROBLEMAS ENCONTRADOS'}`)
    console.log(`Mensagem: ${result.message}`)
    
    if (result.errors.length > 0) {
      console.log('\n❌ ERROS ENCONTRADOS:')
      result.errors.forEach(error => console.log(`   - ${error}`))
    }
    
    console.log(`\n📄 Relatório salvo em: ${reportPath}`)
    
    if (!result.success) {
      console.log('\n🚨 AÇÕES RECOMENDADAS:')
      console.log('   1. Corrigir POIs sem coordenadas')
      console.log('   2. Remover coordenadas órfãs')
      console.log('   3. Consolidar POIs duplicados')
      console.log('   4. Implementar validações de integridade')
    }
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const analyzer = new DataIntegrityAnalyzer()
  
  analyzer.generateReport()
    .then(() => {
      console.log('\n✅ Análise de integridade concluída!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro na análise:', error)
      process.exit(1)
    })
}

export { DataIntegrityAnalyzer }
