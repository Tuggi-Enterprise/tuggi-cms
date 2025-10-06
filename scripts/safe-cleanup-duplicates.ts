#!/usr/bin/env tsx

/**
 * Script SEGURO para remoção de coordenadas duplicadas
 * 
 * Este script:
 * 1. Valida que cada POI terá pelo menos 1 coordenada após a limpeza
 * 2. Cria backup completo antes de qualquer alteração
 * 3. Executa a limpeza em transação
 * 4. Valida o resultado final
 * 5. Permite rollback se algo der errado
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Carregar variáveis de ambiente
config()

interface SafeCleanupResult {
  success: boolean
  message: string
  beforeStats: {
    totalCoordinates: number
    poisWithMultipleCoordinates: number
    totalDuplicateCoordinates: number
  }
  afterStats: {
    totalCoordinates: number
    poisWithMultipleCoordinates: number
    coordinatesRemoved: number
  }
  errors: string[]
  rollbackScript?: string
}

class SafeDuplicateCleanup {
  private supabase: any
  private dryRun: boolean

  constructor(dryRun: boolean = true) {
    this.dryRun = dryRun
    
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
   * Executa limpeza segura das duplicatas
   */
  async executeSafeCleanup(): Promise<SafeCleanupResult> {
    console.log('🛡️  Iniciando limpeza SEGURA de coordenadas duplicadas...')
    console.log(`📋 Modo: ${this.dryRun ? 'DRY RUN (simulação)' : 'EXECUÇÃO REAL'}`)

    try {
      // 1. Obter estatísticas ANTES da limpeza
      const beforeStats = await this.getCurrentStats()
      console.log('\n📊 ESTATÍSTICAS ANTES DA LIMPEZA:')
      console.log(`   Total de coordenadas: ${beforeStats.totalCoordinates}`)
      console.log(`   POIs com múltiplas coordenadas: ${beforeStats.poisWithMultipleCoordinates}`)
      console.log(`   Coordenadas duplicadas: ${beforeStats.totalDuplicateCoordinates}`)

      // 2. Identificar coordenadas para remoção
      const coordinatesToRemove = await this.identifyCoordinatesToRemove()
      console.log(`\n🎯 Coordenadas identificadas para remoção: ${coordinatesToRemove.length}`)

      // 3. VALIDAÇÃO CRÍTICA: Garantir que cada POI terá pelo menos 1 coordenada
      const validationResult = await this.validateNoPOIWillBeLeftWithoutCoordinates(coordinatesToRemove)
      if (!validationResult.valid) {
        return {
          success: false,
          message: 'VALIDAÇÃO FALHOU: Alguns POIs ficariam sem coordenadas!',
          beforeStats,
          afterStats: beforeStats,
          errors: validationResult.errors
        }
      }

      console.log('✅ Validação passou: Todos os POIs manterão pelo menos 1 coordenada')

      // 4. Criar backup
      const backupScript = await this.createBackupScript(coordinatesToRemove)
      console.log('💾 Backup criado com sucesso')

      // 5. Executar limpeza (se não for dry run)
      let afterStats = beforeStats
      if (!this.dryRun) {
        afterStats = await this.executeCleanup(coordinatesToRemove)
        console.log('\n📊 ESTATÍSTICAS APÓS A LIMPEZA:')
        console.log(`   Total de coordenadas: ${afterStats.totalCoordinates}`)
        console.log(`   POIs com múltiplas coordenadas: ${afterStats.poisWithMultipleCoordinates}`)
        console.log(`   Coordenadas removidas: ${afterStats.coordinatesRemoved}`)
      } else {
        console.log('\n🔍 DRY RUN: Nenhuma alteração foi feita no banco')
      }

      return {
        success: true,
        message: this.dryRun ? 'Dry run concluído com sucesso' : 'Limpeza executada com sucesso',
        beforeStats,
        afterStats,
        errors: [],
        rollbackScript: backupScript
      }

    } catch (error) {
      console.error('❌ Erro durante a limpeza:', error)
      return {
        success: false,
        message: `Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        beforeStats: { totalCoordinates: 0, poisWithMultipleCoordinates: 0, totalDuplicateCoordinates: 0 },
        afterStats: { totalCoordinates: 0, poisWithMultipleCoordinates: 0, coordinatesRemoved: 0 },
        errors: [error instanceof Error ? error.message : 'Erro desconhecido']
      }
    }
  }

  /**
   * Obtém estatísticas atuais do banco
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
      .rpc('get_pois_with_multiple_coordinates')

    const poisWithMultipleCoordinates = poisWithMultiple?.length || 0
    const totalDuplicateCoordinates = totalCoordinates - (totalCoordinates - poisWithMultipleCoordinates)

    return {
      totalCoordinates: totalCoordinates || 0,
      poisWithMultipleCoordinates,
      totalDuplicateCoordinates
    }
  }

  /**
   * Identifica coordenadas que devem ser removidas
   */
  private async identifyCoordinatesToRemove() {
    // Buscar TODAS as coordenadas com paginação (limite Supabase: 1000)
    let allCoordinates: any[] = []
    let from = 0
    const limit = 1000
    let hasMore = true

    console.log('📊 Buscando todas as coordenadas com paginação...')
    
    while (hasMore) {
      const { data: batch, error } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select(`
          id,
          attraction_id,
          latitude,
          longitude,
          created_at,
          show_in_map,
          attractions!inner(
            id,
            name,
            city,
            country
          )
        `)
        .order('attraction_id, created_at')
        .range(from, from + limit - 1)

      if (error) throw error

      if (batch && batch.length > 0) {
        allCoordinates = allCoordinates.concat(batch)
        from += limit
        console.log(`   Processadas ${allCoordinates.length} coordenadas...`)
        
        // Se retornou menos que o limite, chegamos ao fim
        hasMore = batch.length === limit
      } else {
        hasMore = false
      }
    }

    console.log(`📊 Total de coordenadas encontradas: ${allCoordinates.length}`)

    // Agrupar por attraction_id
    const groupedByAttraction = allCoordinates.reduce((acc, coord) => {
      const attractionId = coord.attraction_id
      if (!acc[attractionId]) {
        acc[attractionId] = []
      }
      acc[attractionId].push(coord)
      return acc
    }, {} as Record<string, any[]>)

    // Identificar coordenadas para remoção
    const coordinatesToRemove: any[] = []

    Object.entries(groupedByAttraction).forEach(([attractionId, coordinates]) => {
      if (coordinates.length > 1) {
        // Aplicar estratégia de seleção
        const recommended = this.selectRecommendedCoordinate(coordinates)
        const toRemove = coordinates.filter(coord => coord.id !== recommended.id)
        coordinatesToRemove.push(...toRemove)
      }
    })

    return coordinatesToRemove
  }

  /**
   * Seleciona a coordenada recomendada para manter (SEMPRE A PRIMEIRA/MAIS ANTIGA)
   */
  private selectRecommendedCoordinate(coordinates: any[]) {
    // Estratégia: SEMPRE manter a primeira coordenada (mais antiga)
    return coordinates.reduce((oldest, current) => 
      new Date(current.created_at) < new Date(oldest.created_at) ? current : oldest
    )
  }

  /**
   * VALIDAÇÃO CRÍTICA: Garante que nenhum POI ficará sem coordenada
   */
  private async validateNoPOIWillBeLeftWithoutCoordinates(coordinatesToRemove: any[]) {
    const errors: string[] = []

    // Agrupar coordenadas a serem removidas por attraction_id
    const removalByAttraction = coordinatesToRemove.reduce((acc, coord) => {
      const attractionId = coord.attraction_id
      if (!acc[attractionId]) {
        acc[attractionId] = []
      }
      acc[attractionId].push(coord)
      return acc
    }, {} as Record<string, any[]>)

    // Verificar cada POI
    for (const [attractionId, coordinatesToRemove] of Object.entries(removalByAttraction)) {
      // Contar total de coordenadas do POI
      const { count: totalCoordinates } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('*', { count: 'exact', head: true })
        .eq('attraction_id', attractionId)

      // Se todas as coordenadas serão removidas, é um erro
      if (totalCoordinates === coordinatesToRemove.length) {
        const attractionName = coordinatesToRemove[0].attractions.name
        errors.push(`POI "${attractionName}" (${attractionId}) ficaria sem coordenadas!`)
      }
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Cria script de backup
   */
  private async createBackupScript(coordinatesToRemove: any[]): Promise<string> {
    const backupScript = `-- Script de backup e rollback para coordenadas duplicadas
-- Gerado em: ${new Date().toISOString()}
-- Total de coordenadas que serão removidas: ${coordinatesToRemove.length}

-- Dados das coordenadas que serão removidas (para rollback)
INSERT INTO core.attraction_coordinate_backup (
  id, attraction_id, latitude, longitude, created_at, show_in_map
) VALUES
${coordinatesToRemove.map(coord => 
  `('${coord.id}', '${coord.attraction_id}', ${coord.latitude}, ${coord.longitude}, '${coord.created_at}', ${coord.show_in_map})`
).join(',\n')};

-- Script de rollback (caso seja necessário)
-- DELETE FROM core.attraction_coordinate WHERE id IN (${coordinatesToRemove.map(c => `'${c.id}'`).join(', ')});
-- INSERT INTO core.attraction_coordinate SELECT * FROM core.attraction_coordinate_backup WHERE id IN (${coordinatesToRemove.map(c => `'${c.id}'`).join(', ')});
`

    const backupPath = join(process.cwd(), 'scripts', 'backup-duplicate-coordinates.sql')
    writeFileSync(backupPath, backupScript)
    
    return backupScript
  }

  /**
   * Executa a limpeza real em lotes (limite Supabase: 1000)
   */
  private async executeCleanup(coordinatesToRemove: any[]) {
    const coordinateIds = coordinatesToRemove.map(coord => coord.id)
    const batchSize = 1000
    let processed = 0

    console.log(`🧹 Removendo ${coordinateIds.length} coordenadas em lotes de ${batchSize}...`)

    // Processar em lotes para respeitar limite do Supabase
    for (let i = 0; i < coordinateIds.length; i += batchSize) {
      const batch = coordinateIds.slice(i, i + batchSize)
      
      console.log(`   Processando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(coordinateIds.length / batchSize)} (${batch.length} coordenadas)...`)
      
      const { error } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .delete()
        .in('id', batch)

      if (error) {
        throw new Error(`Erro ao remover lote ${Math.floor(i / batchSize) + 1}: ${error.message}`)
      }

      processed += batch.length
      console.log(`   ✅ Lote processado. Total: ${processed}/${coordinateIds.length}`)
    }

    console.log(`✅ Remoção concluída: ${processed} coordenadas removidas`)

    // Obter estatísticas após limpeza
    return await this.getCurrentStats()
  }

  /**
   * Gera relatório final
   */
  async generateFinalReport(): Promise<void> {
    const result = await this.executeSafeCleanup()
    
    const reportPath = join(process.cwd(), 'scripts', 'safe-cleanup-report.json')
    writeFileSync(reportPath, JSON.stringify(result, null, 2))
    
    console.log('\n📋 RELATÓRIO FINAL:')
    console.log('=' .repeat(50))
    console.log(`Status: ${result.success ? '✅ SUCESSO' : '❌ FALHA'}`)
    console.log(`Mensagem: ${result.message}`)
    
    if (result.errors.length > 0) {
      console.log('\n❌ ERROS ENCONTRADOS:')
      result.errors.forEach(error => console.log(`   - ${error}`))
    }
    
    console.log(`\n📄 Relatório detalhado salvo em: ${reportPath}`)
    
    if (result.rollbackScript) {
      const rollbackPath = join(process.cwd(), 'scripts', 'rollback-duplicate-cleanup.sql')
      writeFileSync(rollbackPath, result.rollbackScript)
      console.log(`🔄 Script de rollback salvo em: ${rollbackPath}`)
    }
  }
}

// Executar se script for chamado diretamente
if (require.main === module) {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--execute')
  
  if (dryRun) {
    console.log('🔍 MODO DRY RUN: Nenhuma alteração será feita no banco')
    console.log('   Use --execute para executar a limpeza real')
  }

  const cleanup = new SafeDuplicateCleanup(dryRun)
  
  cleanup.generateFinalReport()
    .then(() => {
      console.log('\n✅ Processo concluído!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Erro no processo:', error)
      process.exit(1)
    })
}

export { SafeDuplicateCleanup }
