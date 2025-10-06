#!/usr/bin/env tsx

/**
 * Script SIMPLES para limpeza de coordenadas duplicadas
 * Processa em lotes pequenos para evitar timeout
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Carregar variáveis de ambiente
config()

interface CleanupResult {
  success: boolean
  message: string
  processed: number
  removed: number
  errors: string[]
}

class SimpleDuplicateCleanup {
  private supabase: any
  private batchSize = 100 // Lotes pequenos para evitar timeout

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
   * Executa limpeza automática até não haver mais duplicatas
   */
  async executeAutoCleanup(): Promise<CleanupResult> {
    console.log('🚀 Iniciando limpeza automática de duplicatas...')
    console.log('🔄 O script irá executar automaticamente até limpar todas as duplicatas')
    
    let totalProcessed = 0
    let totalRemoved = 0
    const errors: string[] = []
    let iteration = 0
    let hasDuplicates = true

    while (hasDuplicates) {
      iteration++
      console.log(`\n🔄 ITERAÇÃO ${iteration}`)
      console.log('=' .repeat(50))

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
            .select('id, attraction_id, created_at')
            .order('attraction_id, created_at')
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

        console.log(`📊 Total de coordenadas: ${allCoordinates.length}`)

        // 2. Agrupar por attraction_id
        const groupedByAttraction = allCoordinates.reduce((acc, coord) => {
          const attractionId = coord.attraction_id
          if (!acc[attractionId]) {
            acc[attractionId] = []
          }
          acc[attractionId].push(coord)
          return acc
        }, {} as Record<string, any[]>)

        // 3. Identificar POIs com duplicatas
        const poisWithDuplicates = Object.entries(groupedByAttraction)
          .filter(([_, coordinates]) => coordinates.length > 1)

        console.log(`📊 POIs com duplicatas encontrados: ${poisWithDuplicates.length}`)

        if (poisWithDuplicates.length === 0) {
          hasDuplicates = false
          console.log('✅ Nenhuma duplicata encontrada! Limpeza concluída.')
          break
        }

        // 4. Processar em lotes de 100 POIs por vez
        const batchSize = 100
        const poisToProcess = poisWithDuplicates.slice(0, batchSize)
        
        console.log(`🔧 Processando ${poisToProcess.length} POIs nesta iteração...`)

        let batchProcessed = 0
        let batchRemoved = 0

        for (const [attractionId, coordinates] of poisToProcess) {
          try {
            console.log(`   🔧 POI ${attractionId} (${coordinates.length} coordenadas)...`)
            
            // Manter apenas a primeira coordenada (mais antiga)
            const sortedCoordinates = coordinates
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            
            const coordinatesToKeep = sortedCoordinates[0]
            const coordinatesToRemove = sortedCoordinates.slice(1).map(coord => coord.id)

            if (coordinatesToRemove.length > 0) {
              // Remover coordenadas duplicadas
              const { error: deleteError } = await this.supabase
                .schema('core')
                .from('attraction_coordinate')
                .delete()
                .in('id', coordinatesToRemove)

              if (deleteError) {
                errors.push(`Erro ao remover coordenadas do POI ${attractionId}: ${deleteError.message}`)
              } else {
                batchRemoved += coordinatesToRemove.length
                console.log(`      ✅ Removidas ${coordinatesToRemove.length} coordenadas`)
              }
            }

            batchProcessed++
            
            // Pausa pequena entre processamentos
            await new Promise(resolve => setTimeout(resolve, 50))

          } catch (error) {
            const errorMsg = `Erro ao processar POI ${attractionId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
            errors.push(errorMsg)
            console.error(`      ❌ ${errorMsg}`)
          }
        }

        totalProcessed += batchProcessed
        totalRemoved += batchRemoved

        console.log(`📊 Iteração ${iteration} concluída:`)
        console.log(`   POIs processados: ${batchProcessed}`)
        console.log(`   Coordenadas removidas: ${batchRemoved}`)
        console.log(`   Total acumulado: ${totalRemoved} coordenadas removidas`)

        // Se não processou nenhum POI, não há mais duplicatas
        if (batchProcessed === 0) {
          hasDuplicates = false
        }

        // Pausa entre iterações
        if (hasDuplicates) {
          console.log('⏳ Aguardando 2 segundos antes da próxima iteração...')
          await new Promise(resolve => setTimeout(resolve, 2000))
        }

      } catch (error) {
        const errorMsg = `Erro na iteração ${iteration}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
        errors.push(errorMsg)
        console.error(`❌ ${errorMsg}`)
        break
      }
    }

    return {
      success: errors.length === 0,
      message: `Limpeza automática concluída! ${iteration} iterações, ${totalProcessed} POIs processados, ${totalRemoved} coordenadas removidas`,
      processed: totalProcessed,
      removed: totalRemoved,
      errors
    }
  }

  /**
   * Gera relatório final
   */
  async generateReport(): Promise<void> {
    const result = await this.executeAutoCleanup()
    
    const reportPath = join(process.cwd(), 'scripts', 'auto-cleanup-report.json')
    writeFileSync(reportPath, JSON.stringify(result, null, 2))
    
    console.log('\n📋 RELATÓRIO FINAL:')
    console.log('=' .repeat(50))
    console.log(`Status: ${result.success ? '✅ SUCESSO' : '❌ FALHA'}`)
    console.log(`Mensagem: ${result.message}`)
    console.log(`POIs processados: ${result.processed}`)
    console.log(`Coordenadas removidas: ${result.removed}`)
    
    if (result.errors.length > 0) {
      console.log('\n❌ ERROS ENCONTRADOS:')
      result.errors.forEach(error => console.log(`   - ${error}`))
    }
    
    console.log(`\n📄 Relatório salvo em: ${reportPath}`)
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const cleanup = new SimpleDuplicateCleanup()
  
  cleanup.generateReport()
    .then(() => {
      console.log('\n✅ Limpeza simples concluída!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro na limpeza:', error)
      process.exit(1)
    })
}

export { SimpleDuplicateCleanup }
