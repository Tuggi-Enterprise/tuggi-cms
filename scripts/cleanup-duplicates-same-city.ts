#!/usr/bin/env tsx

/**
 * Script de Limpeza: POIs Duplicados (mesmo nome na mesma cidade)
 * 
 * Objetivo: Remover POIs duplicados mantendo apenas 1 por grupo (nome + cidade)
 * Regra: N POIs com mesmo nome na mesma cidade = Deixar 1, apagar demais
 * Regra: N POIs com mesmo nome em cidades diferentes = Não apagar nada
 * 
 * Uso: 
 *   npm run cleanup:duplicates              # Modo dry-run (padrão)
 *   npm run cleanup:duplicates -- --execute # Executar limpeza real
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { writeFileSync } from 'fs'

// Carregar variáveis de ambiente
dotenv.config({ path: resolve(process.cwd(), '.env.local') })
dotenv.config({ path: resolve(process.cwd(), '.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: Variáveis de ambiente não encontradas')
  console.error('   Necessário: NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL)')
  console.error('   Necessário: SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface CleanupStats {
  total_pois_analyzed: number
  duplicate_groups: number
  pois_to_keep: number
  pois_to_delete: number
  coordinates_deleted: number
  pois_deleted: number
  errors: number
  start_time: Date
  end_time?: Date
}

interface POIToDelete {
  uuid_id: string
  name: string
  city: string
  state: string | null
  created_at: string
}

async function cleanupDuplicates(execute: boolean = false) {
  const mode = execute ? 'EXECUÇÃO REAL' : 'DRY-RUN (simulação)'
  console.log(`🧹 Iniciando limpeza de duplicatas em homolog.pois...`)
  console.log(`📋 Modo: ${mode}\n`)
  
  if (!execute) {
    console.log('⚠️  ATENÇÃO: Modo DRY-RUN - nenhuma alteração será feita no banco')
    console.log('   Use --execute para executar a limpeza real\n')
  }

  const stats: CleanupStats = {
    total_pois_analyzed: 0,
    duplicate_groups: 0,
    pois_to_keep: 0,
    pois_to_delete: 0,
    coordinates_deleted: 0,
    pois_deleted: 0,
    errors: 0,
    start_time: new Date()
  }

  try {
    // 1. Buscar todos os POIs com paginação
    console.log('1️⃣ Buscando todos os POIs com paginação...')
    
    const allPois: Array<{
      uuid_id: string
      name: string
      city: string
      state: string | null
      created_at: string
    }> = []
    
    let offset = 0
    const batchSize = 1000
    let hasMore = true
    
    while (hasMore) {
      const { data: batch, error: batchError } = await supabase
        .schema('homolog')
        .from('pois')
        .select('uuid_id, name, city, state, created_at')
        .not('name', 'is', null)
        .not('city', 'is', null)
        .order('uuid_id')
        .range(offset, offset + batchSize - 1)
      
      if (batchError) {
        throw new Error(`Erro ao buscar POIs (offset ${offset}): ${batchError.message}`)
      }
      
      if (!batch || batch.length === 0) {
        hasMore = false
        break
      }
      
      allPois.push(...batch)
      offset += batchSize
      
      if (allPois.length % 5000 === 0 || batch.length < batchSize) {
        console.log(`   📊 POIs carregados: ${allPois.length.toLocaleString()}...`)
      }
      
      if (batch.length < batchSize) {
        hasMore = false
      }
    }
    
    stats.total_pois_analyzed = allPois.length
    console.log(`   ✅ Total de POIs analisados: ${allPois.length.toLocaleString()}\n`)

    // 2. Identificar duplicatas e POIs para apagar
    console.log('2️⃣ Identificando duplicatas e POIs para apagar...')
    
    // Agrupar por nome + cidade
    const groupsMap = new Map<string, Array<typeof allPois[0]>>()
    
    allPois.forEach(poi => {
      const key = `${poi.name}|${poi.city}`
      if (!groupsMap.has(key)) {
        groupsMap.set(key, [])
      }
      groupsMap.get(key)!.push(poi)
    })

    // Identificar POIs para apagar (todos exceto o mais antigo de cada grupo)
    const poisToDelete: POIToDelete[] = []
    const poisToKeep: Set<string> = new Set()
    
    groupsMap.forEach((pois, key) => {
      if (pois.length > 1) {
        // Ordenar por created_at (mais antigo primeiro)
        const sortedPois = [...pois].sort((a, b) => {
          const dateA = new Date(a.created_at || 0).getTime()
          const dateB = new Date(b.created_at || 0).getTime()
          if (dateA !== dateB) return dateA - dateB
          return (a.uuid_id || '').localeCompare(b.uuid_id || '')
        })

        // Manter o primeiro (mais antigo)
        poisToKeep.add(sortedPois[0].uuid_id)
        stats.duplicate_groups++
        
        // Adicionar os demais à lista de exclusão
        for (let i = 1; i < sortedPois.length; i++) {
          poisToDelete.push({
            uuid_id: sortedPois[i].uuid_id,
            name: sortedPois[i].name,
            city: sortedPois[i].city,
            state: sortedPois[i].state,
            created_at: sortedPois[i].created_at
          })
        }
      }
    })

    stats.pois_to_keep = stats.duplicate_groups
    stats.pois_to_delete = poisToDelete.length

    console.log(`   ✅ Grupos de duplicatas: ${stats.duplicate_groups.toLocaleString()}`)
    console.log(`   ✅ POIs que serão MANTIDOS: ${stats.pois_to_keep.toLocaleString()}`)
    console.log(`   ✅ POIs que serão APAGADOS: ${stats.pois_to_delete.toLocaleString()}\n`)

    if (poisToDelete.length === 0) {
      console.log('✅ Nenhuma duplicata encontrada. Nada a fazer!')
      return
    }

    // 3. Apagar coordenadas relacionadas primeiro
    console.log('3️⃣ Apagando coordenadas relacionadas aos POIs que serão removidos...')
    
    const uuidsToDelete = poisToDelete.map(p => p.uuid_id)
    
    // Processar em batches para evitar query muito grande
    const coordinateBatchSize = 500
    let coordinatesDeleted = 0
    
    for (let i = 0; i < uuidsToDelete.length; i += coordinateBatchSize) {
      const batch = uuidsToDelete.slice(i, i + coordinateBatchSize)
      
      if (execute) {
        const { error: coordError, count } = await supabase
          .schema('homolog')
          .from('coordinates')
          .delete({ count: 'exact' })
          .in('poi_uuid_id', batch)
        
        if (coordError) {
          console.error(`   ❌ Erro ao apagar coordenadas (batch ${Math.floor(i / coordinateBatchSize) + 1}):`, coordError.message)
          stats.errors++
        } else {
          coordinatesDeleted += count || 0
          if ((i + coordinateBatchSize) % 1000 === 0 || i + coordinateBatchSize >= uuidsToDelete.length) {
            console.log(`   📊 Coordenadas apagadas: ${coordinatesDeleted.toLocaleString()}...`)
          }
        }
      } else {
        // Dry-run: apenas contar
        const { count } = await supabase
          .schema('homolog')
          .from('coordinates')
          .select('*', { count: 'exact', head: true })
          .in('poi_uuid_id', batch)
        
        coordinatesDeleted += count || 0
      }
    }
    
    stats.coordinates_deleted = coordinatesDeleted
    console.log(`   ✅ Coordenadas ${execute ? 'apagadas' : 'que seriam apagadas'}: ${coordinatesDeleted.toLocaleString()}\n`)

    // 4. Apagar POIs duplicados
    console.log('4️⃣ Apagando POIs duplicados...')
    
    // Processar em batches para evitar query muito grande
    const poiBatchSize = 500
    let poisDeleted = 0
    
    for (let i = 0; i < uuidsToDelete.length; i += poiBatchSize) {
      const batch = uuidsToDelete.slice(i, i + poiBatchSize)
      
      if (execute) {
        const { error: poiError, count } = await supabase
          .schema('homolog')
          .from('pois')
          .delete({ count: 'exact' })
          .in('uuid_id', batch)
        
        if (poiError) {
          console.error(`   ❌ Erro ao apagar POIs (batch ${Math.floor(i / poiBatchSize) + 1}):`, poiError.message)
          stats.errors++
        } else {
          poisDeleted += count || 0
          if ((i + poiBatchSize) % 1000 === 0 || i + poiBatchSize >= uuidsToDelete.length) {
            console.log(`   📊 POIs apagados: ${poisDeleted.toLocaleString()}...`)
          }
        }
      } else {
        // Dry-run: apenas simular
        poisDeleted += batch.length
      }
    }
    
    stats.pois_deleted = poisDeleted
    console.log(`   ✅ POIs ${execute ? 'apagados' : 'que seriam apagados'}: ${poisDeleted.toLocaleString()}\n`)

    // 5. Gerar relatório
    stats.end_time = new Date()
    const duration = (stats.end_time.getTime() - stats.start_time.getTime()) / 1000
    
    console.log('='.repeat(100))
    console.log('📊 RESUMO DA LIMPEZA')
    console.log('='.repeat(100))
    console.log(`Modo: ${mode}`)
    console.log(`Total de POIs analisados: ${stats.total_pois_analyzed.toLocaleString()}`)
    console.log(`Grupos de duplicatas: ${stats.duplicate_groups.toLocaleString()}`)
    console.log(`POIs mantidos: ${stats.pois_to_keep.toLocaleString()}`)
    console.log(`POIs ${execute ? 'apagados' : 'que seriam apagados'}: ${stats.pois_deleted.toLocaleString()}`)
    console.log(`Coordenadas ${execute ? 'apagadas' : 'que seriam apagadas'}: ${stats.coordinates_deleted.toLocaleString()}`)
    console.log(`Erros: ${stats.errors}`)
    console.log(`Tempo de execução: ${duration.toFixed(2)}s`)
    console.log('='.repeat(100))

    // Salvar relatório JSON
    const report = {
      mode: execute ? 'execution' : 'dry-run',
      execution_date: stats.end_time.toISOString(),
      duration_seconds: duration,
      stats,
      sample_deleted_pois: poisToDelete.slice(0, 20).map(p => ({
        uuid_id: p.uuid_id,
        name: p.name,
        city: p.city,
        state: p.state
      }))
    }

    const reportFile = `cleanup-duplicates-${execute ? 'executed' : 'dry-run'}-${Date.now()}.json`
    writeFileSync(reportFile, JSON.stringify(report, null, 2))
    console.log(`\n📄 Relatório salvo em: ${reportFile}`)

    if (!execute) {
      console.log('\n💡 Para executar a limpeza real, use:')
      console.log('   npm run cleanup:duplicates -- --execute')
    } else {
      console.log('\n✅ Limpeza concluída com sucesso!')
    }

  } catch (error) {
    console.error('\n❌ Erro durante limpeza:', error)
    if (error instanceof Error) {
      console.error('   Mensagem:', error.message)
      console.error('   Stack:', error.stack)
    }
    stats.end_time = new Date()
    stats.errors++
    process.exit(1)
  }
}

// Parse argumentos
const args = process.argv.slice(2)
const execute = args.includes('--execute') || args.includes('-e')

// Executar limpeza
cleanupDuplicates(execute)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erro fatal:', error)
    process.exit(1)
  })








