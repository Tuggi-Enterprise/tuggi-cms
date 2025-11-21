/**
 * Script para simular o frontend e verificar se estamos buscando todos os dados
 * 
 * Este script:
 * 1. Simula as chamadas do frontend (API routes)
 * 2. Verifica quantos dados estão sendo retornados
 * 3. Compara com o que existe no banco
 * 4. Identifica problemas de paginação/limite
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Carregar variáveis de ambiente
dotenv.config()

// Configuração
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Variáveis de ambiente não configuradas!')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', SUPABASE_URL ? '✅' : '❌')
  console.error('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_KEY ? '✅' : '❌')
  console.error('\n💡 Execute com: tsx --env-file=.env scripts/test-trail-visualization-frontend.ts')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

interface TestResult {
  name: string
  success: boolean
  data?: any
  error?: string
  stats?: {
    total_points?: number
    unique_users?: number
    unique_trips?: number
    trips_returned?: number
  }
}

/**
 * Simula a chamada do frontend para /api/trail-visualization/trails
 */
async function simulateFrontendTrailsCall(params: {
  bounds?: { north: number; south: number; east: number; west: number }
  userIds?: string[]
  startDate?: string
  onlyMoving?: boolean
  limit?: number
}): Promise<TestResult> {
  try {
    console.log('\n📡 Simulando chamada do frontend para /api/trail-visualization/trails')
    console.log('   Parâmetros:', JSON.stringify(params, null, 2))

    // Simular o que o service faz (CORRIGIDO: aceitar limite solicitado)
    const fieldsToSelect = 'id,user_id,trip_session_id,latitude,longitude,timestamp,sequence_order,is_moving,speed,accuracy,heading'
    const requestedLimit = params.limit || 1000 // Aceitar limite solicitado (não forçar 1000)
    const chunkSize = 1000

    let allData: any[] = []
    let currentOffset = 0
    let hasMore = true
    let totalFetched = 0
    let chunkCount = 0

    while (hasMore && totalFetched < requestedLimit) {
      chunkCount++
      const chunkLimit = Math.min(chunkSize, requestedLimit - totalFetched)
      
      console.log(`   📦 Buscando chunk ${chunkCount} (offset: ${currentOffset}, limit: ${chunkLimit})...`)

      let query = supabase
        .schema('drive')
        .from('route_trail')
        .select(fieldsToSelect)

      // Aplicar filtros (como no service)
      if (params.bounds) {
        query = query
          .gte('latitude', params.bounds.south)
          .lte('latitude', params.bounds.north)
          .gte('longitude', params.bounds.west)
          .lte('longitude', params.bounds.east)
      }

      if (params.userIds && params.userIds.length > 0) {
        query = query.in('user_id', params.userIds)
      }

      if (params.startDate) {
        query = query.gte('timestamp', params.startDate)
      }

      if (params.onlyMoving) {
        query = query.eq('is_moving', true)
      }

      const { data: chunkData, error: chunkError } = await query
        .range(currentOffset, currentOffset + chunkLimit - 1)

      if (chunkError) {
        return {
          name: 'Frontend Trails Call',
          success: false,
          error: chunkError.message
        }
      }

      if (!chunkData || chunkData.length === 0) {
        hasMore = false
        break
      }

      allData = [...allData, ...chunkData]
      totalFetched += chunkData.length
      currentOffset += chunkData.length

      console.log(`   ✅ Chunk ${chunkCount}: ${chunkData.length} pontos (total: ${totalFetched})`)

      if (chunkData.length < chunkSize) {
        hasMore = false
      }

      if (totalFetched >= requestedLimit) {
        hasMore = false
      }
    }

    // Simular unificação (simplificada)
    const trailsMap = new Map<string, any[]>()
    allData.forEach(point => {
      const key = point.trip_session_id
      if (!trailsMap.has(key)) {
        trailsMap.set(key, [])
      }
      trailsMap.get(key)!.push(point)
    })

    const sessions = Array.from(trailsMap.entries()).map(([trip_session_id, points]) => ({
      trip_session_id,
      user_id: points[0].user_id,
      points: points.sort((a, b) => a.sequence_order - b.sequence_order)
    }))

    // Contar trips únicas
    const uniqueTrips = new Set(sessions.map(s => s.trip_session_id))
    const uniqueUsers = new Set(allData.map(p => p.user_id))

    return {
      name: 'Frontend Trails Call',
      success: true,
      data: {
        total_points: allData.length,
        sessions: sessions.length,
        chunks_fetched: chunkCount
      },
      stats: {
        total_points: allData.length,
        unique_users: uniqueUsers.size,
        unique_trips: uniqueTrips.size,
        trips_returned: sessions.length
      }
    }
  } catch (error) {
    return {
      name: 'Frontend Trails Call',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Busca dados reais do banco para comparação
 */
async function getRealDatabaseStats(params?: {
  bounds?: { north: number; south: number; east: number; west: number }
  userIds?: string[]
  startDate?: string
  onlyMoving?: boolean
}): Promise<TestResult> {
  try {
    console.log('\n📊 Buscando estatísticas reais do banco...')

    let query = supabase
      .schema('drive')
      .from('route_trail')
      .select('user_id,trip_session_id,timestamp,is_moving', { count: 'exact' })

    if (params?.bounds) {
      query = query
        .gte('latitude', params.bounds.south)
        .lte('latitude', params.bounds.north)
        .gte('longitude', params.bounds.west)
        .lte('longitude', params.bounds.east)
    }

    if (params?.userIds && params.userIds.length > 0) {
      query = query.in('user_id', params.userIds)
    }

    if (params?.startDate) {
      query = query.gte('timestamp', params.startDate)
    }

    if (params?.onlyMoving) {
      query = query.eq('is_moving', true)
    }

    // Buscar amostra para contar únicos
    const { data, count, error } = await query.limit(10000)

    if (error) {
      return {
        name: 'Real Database Stats',
        success: false,
        error: error.message
      }
    }

    if (!data) {
      return {
        name: 'Real Database Stats',
        success: false,
        error: 'No data returned'
      }
    }

    const uniqueUsers = new Set(data.map(p => p.user_id))
    const uniqueTrips = new Set(data.map(p => p.trip_session_id))

    return {
      name: 'Real Database Stats',
      success: true,
      data: {
        total_points: count || data.length,
        sample_size: data.length
      },
      stats: {
        total_points: count || data.length,
        unique_users: uniqueUsers.size,
        unique_trips: uniqueTrips.size
      }
    }
  } catch (error) {
    return {
      name: 'Real Database Stats',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Busca estatísticas da view trail_trips_unified
 */
async function getUnifiedTripsStats(): Promise<TestResult> {
  try {
    console.log('\n📈 Buscando estatísticas da view trail_trips_unified...')

    const { data, error } = await supabase
      .schema('drive')
      .from('trail_trips_unified')
      .select('*')

    if (error) {
      return {
        name: 'Unified Trips Stats',
        success: false,
        error: error.message
      }
    }

    if (!data) {
      return {
        name: 'Unified Trips Stats',
        success: false,
        error: 'No data returned'
      }
    }

    const uniqueUsers = new Set(data.map(t => t.user_id))
    const totalPoints = data.reduce((sum, t) => sum + (t.point_count || 0), 0)

    return {
      name: 'Unified Trips Stats',
      success: true,
      data: {
        total_trips: data.length,
        total_points: totalPoints
      },
      stats: {
        unique_trips: data.length,
        unique_users: uniqueUsers.size,
        total_points: totalPoints
      }
    }
  } catch (error) {
    return {
      name: 'Unified Trips Stats',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('🚀 Iniciando teste de simulação do frontend...\n')

  // 1. Estatísticas gerais do banco (sem filtros)
  console.log('='.repeat(80))
  console.log('1️⃣ ESTATÍSTICAS GERAIS DO BANCO (sem filtros)')
  console.log('='.repeat(80))

  const generalStats = await getRealDatabaseStats()
  if (generalStats.success && generalStats.stats) {
    console.log('✅ Estatísticas gerais:')
    console.log(`   Total de pontos: ${generalStats.stats.total_points?.toLocaleString()}`)
    console.log(`   Usuários únicos: ${generalStats.stats.unique_users}`)
    console.log(`   Trip sessions únicas: ${generalStats.stats.unique_trips}`)
  } else {
    console.log('❌ Erro ao buscar estatísticas gerais:', generalStats.error)
  }

  // 2. Estatísticas da view unified
  console.log('\n' + '='.repeat(80))
  console.log('2️⃣ ESTATÍSTICAS DA VIEW trail_trips_unified')
  console.log('='.repeat(80))

  const unifiedStats = await getUnifiedTripsStats()
  if (unifiedStats.success && unifiedStats.stats) {
    console.log('✅ Estatísticas da view:')
    console.log(`   Total de trips unificadas: ${unifiedStats.stats.unique_trips}`)
    console.log(`   Usuários únicos: ${unifiedStats.stats.unique_users}`)
    console.log(`   Total de pontos: ${unifiedStats.stats.total_points?.toLocaleString()}`)
  } else {
    console.log('❌ Erro ao buscar estatísticas da view:', unifiedStats.error)
  }

  // 3. Simular chamada do frontend SEM filtros (limite padrão)
  console.log('\n' + '='.repeat(80))
  console.log('3️⃣ SIMULAÇÃO: Frontend SEM filtros (limite padrão: 1000)')
  console.log('='.repeat(80))

  const frontendCall1 = await simulateFrontendTrailsCall({
    limit: 1000
  })

  if (frontendCall1.success && frontendCall1.stats) {
    console.log('✅ Resultado da simulação:')
    console.log(`   Pontos retornados: ${frontendCall1.stats.total_points?.toLocaleString()}`)
    console.log(`   Usuários únicos: ${frontendCall1.stats.unique_users}`)
    console.log(`   Trip sessions: ${frontendCall1.stats.trips_returned}`)
    console.log(`   Chunks buscados: ${frontendCall1.data?.chunks_fetched || 0}`)
    
    if (generalStats.stats) {
      const coverage = ((frontendCall1.stats.total_points || 0) / (generalStats.stats.total_points || 1) * 100).toFixed(2)
      console.log(`\n   📊 Cobertura: ${coverage}% dos dados totais`)
      
      if (parseFloat(coverage) < 100) {
        console.log(`   ⚠️  ATENÇÃO: Apenas ${coverage}% dos dados estão sendo retornados!`)
        console.log(`   ⚠️  Limite de 1000 pontos está restringindo os resultados`)
      }
    }
  } else {
    console.log('❌ Erro na simulação:', frontendCall1.error)
  }

  // 4. Simular chamada do frontend COM limite maior (5000 como no frontend)
  console.log('\n' + '='.repeat(80))
  console.log('4️⃣ SIMULAÇÃO: Frontend COM limite de 5000 (como configurado no frontend)')
  console.log('='.repeat(80))

  const frontendCall2 = await simulateFrontendTrailsCall({
    limit: 5000
  })

  if (frontendCall2.success && frontendCall2.stats) {
    console.log('✅ Resultado da simulação:')
    console.log(`   Pontos retornados: ${frontendCall2.stats.total_points?.toLocaleString()}`)
    console.log(`   Usuários únicos: ${frontendCall2.stats.unique_users}`)
    console.log(`   Trip sessions: ${frontendCall2.stats.trips_returned}`)
    console.log(`   Chunks buscados: ${frontendCall2.data?.chunks_fetched || 0}`)
    
    if (generalStats.stats) {
      const coverage = ((frontendCall2.stats.total_points || 0) / (generalStats.stats.total_points || 1) * 100).toFixed(2)
      console.log(`\n   📊 Cobertura: ${coverage}% dos dados totais`)
      
      if (parseFloat(coverage) < 100) {
        console.log(`   ⚠️  ATENÇÃO: Apenas ${coverage}% dos dados estão sendo retornados!`)
        console.log(`   ⚠️  O limite de 5000 pontos ainda está restringindo os resultados`)
        console.log(`   💡 SOLUÇÃO: Implementar paginação completa ou aumentar limite`)
      } else {
        console.log(`   ✅ Todos os dados estão sendo retornados!`)
      }
    }
  } else {
    console.log('❌ Erro na simulação:', frontendCall2.error)
  }

  // 5. Simular chamada do frontend COM filtro de data (30 dias)
  console.log('\n' + '='.repeat(80))
  console.log('5️⃣ SIMULAÇÃO: Frontend COM filtro de 30 dias (padrão do frontend)')
  console.log('='.repeat(80))

  const daysAgo = new Date()
  daysAgo.setDate(daysAgo.getDate() - 30)
  const startDate = daysAgo.toISOString()

  const frontendCall3 = await simulateFrontendTrailsCall({
    startDate,
    limit: 5000
  })

  if (frontendCall3.success && frontendCall3.stats) {
    console.log('✅ Resultado da simulação:')
    console.log(`   Pontos retornados: ${frontendCall3.stats.total_points?.toLocaleString()}`)
    console.log(`   Usuários únicos: ${frontendCall3.stats.unique_users}`)
    console.log(`   Trip sessions: ${frontendCall3.stats.trips_returned}`)
    console.log(`   Chunks buscados: ${frontendCall3.data?.chunks_fetched || 0}`)
    
    // Comparar com dados reais do banco com mesmo filtro
    const realStatsWithFilter = await getRealDatabaseStats({ startDate })
    if (realStatsWithFilter.success && realStatsWithFilter.stats) {
      const coverage = ((frontendCall3.stats.total_points || 0) / (realStatsWithFilter.stats.total_points || 1) * 100).toFixed(2)
      console.log(`\n   📊 Cobertura (últimos 30 dias): ${coverage}% dos dados`)
      console.log(`   📊 Dados reais (últimos 30 dias): ${realStatsWithFilter.stats.total_points?.toLocaleString()} pontos`)
      
      if (parseFloat(coverage) < 100) {
        console.log(`   ⚠️  ATENÇÃO: Apenas ${coverage}% dos dados dos últimos 30 dias estão sendo retornados!`)
      }
    }
  } else {
    console.log('❌ Erro na simulação:', frontendCall3.error)
  }

  // 6. Resumo e recomendações
  console.log('\n' + '='.repeat(80))
  console.log('📋 RESUMO E RECOMENDAÇÕES')
  console.log('='.repeat(80))

  if (generalStats.stats && frontendCall2.stats) {
    const totalPoints = generalStats.stats.total_points || 0
    const returnedPoints = frontendCall2.stats.total_points || 0
    const coverage = (returnedPoints / totalPoints * 100).toFixed(2)

    console.log(`\n📊 Comparação:`)
    console.log(`   Total no banco: ${totalPoints.toLocaleString()} pontos`)
    console.log(`   Retornado pelo frontend: ${returnedPoints.toLocaleString()} pontos`)
    console.log(`   Cobertura: ${coverage}%`)

    if (parseFloat(coverage) < 100) {
      console.log(`\n⚠️  PROBLEMA IDENTIFICADO:`)
      console.log(`   O limite de 5000 pontos está restringindo os resultados!`)
      console.log(`   ${(totalPoints - returnedPoints).toLocaleString()} pontos não estão sendo retornados.`)
      
      console.log(`\n💡 RECOMENDAÇÕES:`)
      console.log(`   1. Implementar paginação completa (buscar todos os chunks necessários)`)
      console.log(`   2. Ou aumentar o limite para ${Math.ceil(totalPoints / 1000) * 1000} pontos`)
      console.log(`   3. Ou usar a view trail_trips_unified para buscar trips diretamente`)
    } else {
      console.log(`\n✅ Todos os dados estão sendo retornados corretamente!`)
    }
  }

  console.log('\n✅ Teste concluído!\n')
}

// Executar
main().catch(console.error)

