#!/usr/bin/env tsx

/**
 * Script final para executar limpeza e aplicar prevenção
 * 
 * Este script:
 * 1. Executa a limpeza das duplicatas existentes
 * 2. Aplica as migrações de prevenção
 * 3. Valida o resultado final
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Carregar variáveis de ambiente
config()

interface FinalCleanupResult {
  success: boolean
  message: string
  beforeStats: {
    totalCoordinates: number
    poisWithMultipleCoordinates: number
  }
  afterStats: {
    totalCoordinates: number
    poisWithMultipleCoordinates: number
    coordinatesRemoved: number
  }
  preventionApplied: boolean
}

class FinalCleanupExecutor {
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
   * Executa limpeza final e aplica prevenção
   */
  async executeFinalCleanup(): Promise<FinalCleanupResult> {
    console.log('🚀 Iniciando limpeza final e aplicação de prevenção...')

    try {
      // 1. Obter estatísticas ANTES
      const beforeStats = await this.getCurrentStats()
      console.log('\n📊 ESTATÍSTICAS ANTES:')
      console.log(`   Total de coordenadas: ${beforeStats.totalCoordinates}`)
      console.log(`   POIs com múltiplas coordenadas: ${beforeStats.poisWithMultipleCoordinates}`)

      // 2. Executar limpeza usando função SQL
      console.log('\n🧹 Executando limpeza de duplicatas...')
      const { data: cleanupResult, error: cleanupError } = await this.supabase
        .schema('core')
        .rpc('cleanup_existing_duplicates')

      if (cleanupError) {
        console.log('⚠️  Função de limpeza não encontrada, usando método alternativo...')
        await this.alternativeCleanup()
      } else {
        console.log(`✅ Limpeza concluída: ${cleanupResult?.length || 0} POIs processados`)
      }

      // 3. Aplicar migrações de prevenção
      console.log('\n🛡️  Aplicando prevenção de duplicatas...')
      const preventionApplied = await this.applyPreventionMigrations()

      // 4. Obter estatísticas APÓS
      const afterStats = await this.getCurrentStats()
      console.log('\n📊 ESTATÍSTICAS APÓS:')
      console.log(`   Total de coordenadas: ${afterStats.totalCoordinates}`)
      console.log(`   POIs com múltiplas coordenadas: ${afterStats.poisWithMultipleCoordinates}`)

      const coordinatesRemoved = beforeStats.totalCoordinates - afterStats.totalCoordinates

      return {
        success: true,
        message: 'Limpeza e prevenção aplicadas com sucesso',
        beforeStats,
        afterStats,
        preventionApplied,
        coordinatesRemoved
      }

    } catch (error) {
      console.error('❌ Erro durante execução:', error)
      return {
        success: false,
        message: `Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        beforeStats: { totalCoordinates: 0, poisWithMultipleCoordinates: 0 },
        afterStats: { totalCoordinates: 0, poisWithMultipleCoordinates: 0 },
        preventionApplied: false,
        coordinatesRemoved: 0
      }
    }
  }

  /**
   * Método alternativo de limpeza usando o script existente
   */
  private async alternativeCleanup(): Promise<void> {
    console.log('📋 Usando método alternativo de limpeza...')
    
    // Importar e usar o script de limpeza existente
    const { SafeDuplicateCleanup } = await import('./safe-cleanup-duplicates')
    const cleanup = new SafeDuplicateCleanup(false) // false = execução real
    
    // Executar limpeza
    await cleanup.executeSafeCleanup()
  }

  /**
   * Aplica migrações de prevenção
   */
  private async applyPreventionMigrations(): Promise<boolean> {
    try {
      // Verificar se as funções já existem
      const { data: functions, error } = await this.supabase
        .schema('core')
        .rpc('check_existing_coordinate', { p_attraction_id: '00000000-0000-0000-0000-000000000000' })
        .limit(1)

      if (!error) {
        console.log('✅ Funções de prevenção já aplicadas')
        return true
      }

      console.log('⚠️  Funções de prevenção não encontradas')
      console.log('📋 Execute a migração: supabase/migrations/20250106_prevent_duplicate_coordinates.sql')
      return false

    } catch (error) {
      console.log('⚠️  Erro ao verificar funções de prevenção:', error)
      return false
    }
  }

  /**
   * Obtém estatísticas atuais
   */
  private async getCurrentStats() {
    // Total de coordenadas
    const { count: totalCoordinates } = await this.supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('*', { count: 'exact', head: true })

    // POIs com múltiplas coordenadas
    const { data: poisWithMultiple } = await this.supabase
      .schema('core')
      .from('attraction_coordinate')
      .select('attraction_id')
      .order('attraction_id')

    if (!poisWithMultiple) {
      return {
        totalCoordinates: totalCoordinates || 0,
        poisWithMultipleCoordinates: 0
      }
    }

    // Contar POIs com múltiplas coordenadas
    const groupedByAttraction = poisWithMultiple.reduce((acc, coord) => {
      const attractionId = coord.attraction_id
      acc[attractionId] = (acc[attractionId] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const poisWithMultipleCoordinates = Object.values(groupedByAttraction)
      .filter(count => count > 1).length

    return {
      totalCoordinates: totalCoordinates || 0,
      poisWithMultipleCoordinates
    }
  }

  /**
   * Gera relatório final
   */
  async generateFinalReport(): Promise<void> {
    const result = await this.executeFinalCleanup()
    
    const reportPath = join(process.cwd(), 'scripts', 'final-cleanup-report.json')
    writeFileSync(reportPath, JSON.stringify(result, null, 2))
    
    console.log('\n📋 RELATÓRIO FINAL:')
    console.log('=' .repeat(50))
    console.log(`Status: ${result.success ? '✅ SUCESSO' : '❌ FALHA'}`)
    console.log(`Mensagem: ${result.message}`)
    console.log(`Coordenadas removidas: ${result.coordinatesRemoved}`)
    console.log(`Prevenção aplicada: ${result.preventionApplied ? '✅ SIM' : '❌ NÃO'}`)
    
    if (!result.preventionApplied) {
      console.log('\n⚠️  IMPORTANTE: Execute a migração de prevenção manualmente!')
      console.log('   Arquivo: supabase/migrations/20250106_prevent_duplicate_coordinates.sql')
    }
    
    console.log(`\n📄 Relatório salvo em: ${reportPath}`)
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const executor = new FinalCleanupExecutor()
  
  executor.generateFinalReport()
    .then(() => {
      console.log('\n✅ Processo final concluído!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro no processo final:', error)
      process.exit(1)
    })
}

export { FinalCleanupExecutor }

