#!/usr/bin/env tsx

/**
 * Script para limpeza de coordenadas duplicadas
 * 
 * Este script identifica POIs com múltiplas coordenadas e mantém apenas
 * a coordenada mais recente, removendo as demais.
 * 
 * ATENÇÃO: Este script modifica dados em produção. Use com cuidado!
 */

import { getSupabase } from '../lib/core/supabase-client'
import { config } from 'dotenv'

// Carregar variáveis de ambiente
config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = getSupabase('server')

interface DuplicateCoordinate {
  attraction_id: string
  coordinates: Array<{
    id: string
    latitude: number
    longitude: number
    created_at: string
  }>
}

interface CoordinateWithReason {
  id: string
  latitude: number
  longitude: number
  created_at: string
  reason: string
}

/**
 * Seleciona a melhor coordenada baseada em critérios inteligentes
 */
function selectBestCoordinate(coordinates: Array<{
  id: string
  latitude: number
  longitude: number
  created_at: string
}>): CoordinateWithReason {
  
  // 1. Verificar se há coordenadas idênticas (duplicatas exatas)
  const uniqueCoords = new Map<string, typeof coordinates[0][]>()
  
  coordinates.forEach(coord => {
    const key = `${coord.latitude},${coord.longitude}`
    if (!uniqueCoords.has(key)) {
      uniqueCoords.set(key, [])
    }
    uniqueCoords.get(key)!.push(coord)
  })
  
  // 2. Se há coordenadas idênticas, manter a mais recente
  if (uniqueCoords.size < coordinates.length) {
    // Há duplicatas exatas - escolher a mais recente entre as duplicatas mais comuns
    let mostCommonCoords: typeof coordinates = []
    let maxCount = 0
    
    for (const [key, coords] of uniqueCoords) {
      if (coords.length > maxCount) {
        maxCount = coords.length
        mostCommonCoords = coords
      }
    }
    
    const mostRecent = mostCommonCoords.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
    
    return {
      ...mostRecent,
      reason: `Coordenada mais recente entre ${maxCount} duplicatas exatas`
    }
  }
  
  // 3. Se todas são diferentes, analisar padrões geográficos
  // Calcular centro geográfico
  const avgLat = coordinates.reduce((sum, coord) => sum + coord.latitude, 0) / coordinates.length
  const avgLng = coordinates.reduce((sum, coord) => sum + coord.longitude, 0) / coordinates.length
  
  // Encontrar coordenada mais próxima do centro
  let closestToCenter = coordinates[0]
  let minDistance = calculateDistance(avgLat, avgLng, coordinates[0].latitude, coordinates[0].longitude)
  
  coordinates.forEach(coord => {
    const distance = calculateDistance(avgLat, avgLng, coord.latitude, coord.longitude)
    if (distance < minDistance) {
      minDistance = distance
      closestToCenter = coord
    }
  })
  
  // 4. Se a distância for muito grande (>10km), preferir a mais recente
  if (minDistance > 10000) {
    const mostRecent = coordinates.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
    
    return {
      ...mostRecent,
      reason: `Coordenadas muito dispersas (${Math.round(minDistance/1000)}km) - escolhida mais recente`
    }
  }
  
  return {
    ...closestToCenter,
    reason: `Mais próxima do centro geográfico (${Math.round(minDistance)}m do centro)`
  }
}

/**
 * Calcula distância entre duas coordenadas usando fórmula de Haversine
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Raio da Terra em metros
  const φ1 = lat1 * Math.PI/180
  const φ2 = lat2 * Math.PI/180
  const Δφ = (lat2-lat1) * Math.PI/180
  const Δλ = (lon2-lon1) * Math.PI/180

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

  return R * c
}

async function cleanupDuplicateCoordinates(dryRun: boolean = true) {
  console.log('🧹 Iniciando limpeza de coordenadas duplicadas...')
  console.log(`📋 Modo: ${dryRun ? 'DRY RUN (simulação)' : 'EXECUÇÃO REAL'}`)
  console.log('=' .repeat(60))

  try {
    // 1. Buscar POIs com múltiplas coordenadas usando paginação
    console.log('🔍 Buscando POIs com múltiplas coordenadas (com paginação)...')
    
    const allCoordinates: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true
    
    while (hasMore) {
      console.log(`   📄 Processando página ${page + 1}...`)
      
      const { data: coordinates, error } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select(`
          attraction_id,
          id,
          latitude,
          longitude,
          created_at,
          attractions!inner(name, city, country)
        `)
        .order('attraction_id')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) {
        console.error('❌ Erro ao buscar coordenadas:', error)
        return
      }

      if (!coordinates || coordinates.length === 0) {
        hasMore = false
        break
      }

      allCoordinates.push(...coordinates)
      
      // Se retornou menos que o pageSize, chegamos ao fim
      if (coordinates.length < pageSize) {
        hasMore = false
      }
      
      page++
      
      // Log de progresso
      console.log(`   ✅ ${allCoordinates.length} coordenadas carregadas até agora...`)
    }
    
    console.log(`📊 Total de coordenadas carregadas: ${allCoordinates.length}`)

    // 2. Agrupar por attraction_id
    console.log('🔄 Agrupando coordenadas por POI...')
    const groupedCoordinates = new Map<string, DuplicateCoordinate>()
    
    allCoordinates.forEach(coord => {
      const attractionId = coord.attraction_id
      
      if (!groupedCoordinates.has(attractionId)) {
        groupedCoordinates.set(attractionId, {
          attraction_id: attractionId,
          coordinates: []
        })
      }
      
      groupedCoordinates.get(attractionId)!.coordinates.push({
        id: coord.id,
        latitude: coord.latitude,
        longitude: coord.longitude,
        created_at: coord.created_at
      })
    })

    // 3. Filtrar apenas POIs com múltiplas coordenadas
    const poisWithDuplicates = Array.from(groupedCoordinates.values())
      .filter(poi => poi.coordinates.length > 1)

    console.log(`📊 Total de POIs únicos: ${groupedCoordinates.size}`)
    console.log(`📊 POIs com múltiplas coordenadas: ${poisWithDuplicates.length}`)

    if (poisWithDuplicates.length === 0) {
      console.log('✅ Nenhuma coordenada duplicada encontrada!')
      return
    }

    // 4. Processar cada POI
    let totalCoordsToDelete = 0
    const deletionPlan: Array<{
      attraction_id: string
      coords_to_keep: string
      coords_to_delete: string[]
    }> = []

    for (const poi of poisWithDuplicates) {
      // Analisar padrões das coordenadas
      const coordToKeep = selectBestCoordinate(poi.coordinates)
      const coordsToDelete = poi.coordinates.filter(coord => coord.id !== coordToKeep.id)

      deletionPlan.push({
        attraction_id: poi.attraction_id,
        coords_to_keep: coordToKeep.id,
        coords_to_delete: coordsToDelete.map(c => c.id)
      })

      totalCoordsToDelete += coordsToDelete.length

      console.log(`\n🎯 POI: ${poi.attraction_id}`)
      console.log(`   📍 Manter: ${coordToKeep.id} (${coordToKeep.created_at})`)
      console.log(`   🗑️  Remover: ${coordsToDelete.length} coordenadas antigas`)
    }

    console.log(`\n📈 Resumo da operação:`)
    console.log(`   • POIs afetados: ${poisWithDuplicates.length}`)
    console.log(`   • Coordenadas a remover: ${totalCoordsToDelete}`)

    // 5. Executar limpeza (se não for dry run)
    if (!dryRun) {
      console.log('\n🚀 Executando limpeza...')
      
      let deletedCount = 0
      
      for (const plan of deletionPlan) {
        for (const coordId of plan.coords_to_delete) {
          const { error: deleteError } = await supabase
            .schema('core')
            .from('attraction_coordinate')
            .delete()
            .eq('id', coordId)

          if (deleteError) {
            console.error(`❌ Erro ao deletar coordenada ${coordId}:`, deleteError)
          } else {
            deletedCount++
            console.log(`✅ Coordenada ${coordId} removida`)
          }
        }
      }

      console.log(`\n🎉 Limpeza concluída!`)
      console.log(`   • Coordenadas removidas: ${deletedCount}`)
      console.log(`   • POIs corrigidos: ${deletionPlan.length}`)
    } else {
      console.log('\n💡 Para executar a limpeza real, execute:')
      console.log('   npx tsx scripts/cleanup-duplicate-coordinates.ts --execute')
    }

  } catch (error) {
    console.error('❌ Erro durante a limpeza:', error)
  }
}

// Verificar argumentos da linha de comando
const args = process.argv.slice(2)
const dryRun = !args.includes('--execute')

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🧹 Script de Limpeza de Coordenadas Duplicadas

Uso:
  npx tsx scripts/cleanup-duplicate-coordinates.ts [opções]

Opções:
  --execute   Executa a limpeza real (sem esta opção, apenas simula)
  --help, -h  Mostra esta ajuda

Comportamento:
  • Por padrão, executa em modo DRY RUN (simulação)
  • Mantém sempre a coordenada mais recente por POI
  • Remove todas as coordenadas antigas
  • Faz log detalhado de todas as operações

Exemplos:
  npx tsx scripts/cleanup-duplicate-coordinates.ts           # Simulação
  npx tsx scripts/cleanup-duplicate-coordinates.ts --execute # Execução real

⚠️  ATENÇÃO: A execução real modifica dados permanentemente!
`)
  process.exit(0)
}

// Executar limpeza
cleanupDuplicateCoordinates(dryRun).catch(console.error)