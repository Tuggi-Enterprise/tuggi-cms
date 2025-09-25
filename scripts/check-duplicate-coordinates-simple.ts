#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkDuplicateCoordinatesSimple() {
  console.log('🔍 Verificando POIs com múltiplas coordenadas (versão simples)...\n')

  try {
    // 1. Obter estatísticas primeiro
    console.log('📊 Obtendo estatísticas...')
    const { data: stats, error: statsError } = await supabase
      .schema('core')
      .rpc('get_duplicate_coordinates_stats')

    if (statsError) {
      console.log('⚠️  Função de estatísticas não encontrada, continuando sem stats...')
    } else if (stats && stats.length > 0) {
      const stat = stats[0]
      console.log(`📊 Estatísticas:`)
      console.log(`   POIs com duplicatas: ${stat.total_pois_with_duplicates}`)
      console.log(`   Total de coordenadas duplicadas: ${stat.total_duplicate_coordinates}`)
      console.log(`   Máximo de coordenadas por POI: ${stat.max_coordinates_per_poi}`)
      console.log(`   Média de coordenadas por POI: ${stat.avg_coordinates_per_poi}`)
      console.log('')
    }

    // 2. Consulta SQL direta para encontrar POIs com múltiplas coordenadas
    const { data, error } = await supabase
      .schema('core')
      .rpc('get_duplicate_coordinates')

    if (error) {
      // Se a função RPC não existir, usar consulta alternativa
      console.log('⚠️  Função RPC não encontrada, usando consulta alternativa...\n')
      
      // Consulta alternativa usando agregação
      const { data: duplicateData, error: queryError } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select(`
          attraction_id,
          attractions!inner(
            id,
            name,
            city,
            country
          )
        `)

      if (queryError) {
        console.error('❌ Erro na consulta:', queryError)
        return
      }

      if (!duplicateData || duplicateData.length === 0) {
        console.log('✅ Nenhuma coordenada encontrada.')
        return
      }

      // Agrupar e contar
      const coordinateCounts = new Map<string, {
        attraction: any
        count: number
        coordinates: any[]
      }>()

      duplicateData.forEach(coord => {
        const attractionId = coord.attraction_id
        if (!coordinateCounts.has(attractionId)) {
          coordinateCounts.set(attractionId, {
            attraction: coord.attractions,
            count: 0,
            coordinates: []
          })
        }
        coordinateCounts.get(attractionId)!.count++
        coordinateCounts.get(attractionId)!.coordinates.push(coord)
      })

      // Filtrar apenas duplicatas
      const duplicates = Array.from(coordinateCounts.entries())
        .filter(([_, data]) => data.count > 1)
        .map(([attractionId, data]) => ({
          attraction_id: attractionId,
          name: data.attraction.name,
          city: data.attraction.city,
          country: data.attraction.country,
          coordinate_count: data.count,
          coordinates: data.coordinates
        }))

      // Exibir resultados
      displayResults(duplicates)
      return
    }

    // Se a função RPC existir, usar os dados retornados
    displayResults(data || [])

    // 3. Verificar coordenadas muito próximas (opcional)
    console.log('\n🔍 Verificando coordenadas muito próximas...')
    const { data: closeCoords, error: closeError } = await supabase
      .schema('core')
      .rpc('get_close_coordinates', { distance_threshold_meters: 10.0 })

    if (closeError) {
      console.log('⚠️  Erro ao verificar coordenadas próximas:', closeError.message)
    } else if (closeCoords && closeCoords.length > 0) {
      console.log(`⚠️  Encontradas ${closeCoords.length} coordenadas muito próximas (< 10m):`)
      closeCoords.slice(0, 5).forEach((coord: any, index: number) => {
        console.log(`   ${index + 1}. ${coord.name} (${coord.city}) - ${coord.min_distance_meters.toFixed(2)}m`)
      })
      if (closeCoords.length > 5) {
        console.log(`   ... e mais ${closeCoords.length - 5} coordenadas próximas`)
      }
    } else {
      console.log('✅ Nenhuma coordenada muito próxima encontrada.')
    }

  } catch (error) {
    console.error('💥 Erro ao verificar coordenadas duplicadas:', error)
  }
}

function displayResults(duplicates: any[]) {
  console.log(`📊 Total de POIs com múltiplas coordenadas: ${duplicates.length}\n`)

  if (duplicates.length === 0) {
    console.log('✅ Nenhum POI encontrado com múltiplas coordenadas.')
    return
  }

  console.log('📍 POIs com múltiplas coordenadas:\n')
  
  duplicates.forEach((poi, index) => {
    console.log(`${index + 1}. ${poi.name}`)
    console.log(`   📍 Localização: ${poi.city}, ${poi.country}`)
    console.log(`   🆔 ID: ${poi.attraction_id}`)
    console.log(`   📊 Total de coordenadas: ${poi.coordinate_count}`)
    
    if (poi.coordinates && poi.coordinates.length > 0) {
      console.log(`   📍 Coordenadas:`)
      poi.coordinates.forEach((coord: any, coordIndex: number) => {
        console.log(`      ${coordIndex + 1}. Lat: ${coord.latitude}, Lng: ${coord.longitude}`)
        if (coord.id) {
          console.log(`         🆔 Coord ID: ${coord.id}`)
        }
        if (coord.created_at) {
          console.log(`         📅 Criado em: ${new Date(coord.created_at).toLocaleString('pt-BR')}`)
        }
      })
    }
    
    console.log('')
  })

  // Estatísticas
  console.log('📊 Estatísticas:')
  console.log(`   Total de POIs com duplicatas: ${duplicates.length}`)
  
  const totalDuplicateCoordinates = duplicates.reduce((sum, poi) => sum + poi.coordinate_count, 0)
  console.log(`   Total de coordenadas duplicadas: ${totalDuplicateCoordinates}`)
  
  if (duplicates.length > 0) {
    const avgCoordinatesPerPOI = totalDuplicateCoordinates / duplicates.length
    console.log(`   Média de coordenadas por POI duplicado: ${avgCoordinatesPerPOI.toFixed(2)}`)
  }
}

// Executar verificação
checkDuplicateCoordinatesSimple()
  .then(() => {
    console.log('\n✅ Verificação concluída!')
  })
  .catch((error) => {
    console.error('💥 Erro na verificação:', error)
  })
