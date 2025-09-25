#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Carregar variáveis de ambiente
config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkDuplicateCoordinatesQuick() {
  console.log('🔍 Verificação rápida de POIs com múltiplas coordenadas...\n')

  try {
    // Consulta com paginação para lidar com +17k POIs
    console.log('📊 Carregando todas as coordenadas (com paginação)...')
    
    const allCoordinates: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true
    
    while (hasMore) {
      console.log(`   📄 Carregando página ${page + 1}...`)
      
      const { data, error } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select(`
          attraction_id,
          id,
          latitude,
          longitude,
          created_at,
          attractions!inner(
            name,
            city,
            country
          )
        `)
        .order('attraction_id')
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) {
        console.error('❌ Erro na consulta:', error)
        return
      }

      if (!data || data.length === 0) {
        hasMore = false
        break
      }

      allCoordinates.push(...data)
      
      // Se retornou menos que o pageSize, chegamos ao fim
      if (data.length < pageSize) {
        hasMore = false
      }
      
      page++
      console.log(`   ✅ ${allCoordinates.length} coordenadas carregadas...`)
    }

    console.log(`\n📊 Total de coordenadas: ${allCoordinates.length}`)

    if (allCoordinates.length === 0) {
      console.log('✅ Nenhuma coordenada encontrada.')
      return
    }

    // Agrupar por attraction_id
    console.log('🔄 Agrupando coordenadas por POI...')
    const coordinateGroups = new Map<string, any[]>()
    allCoordinates.forEach(coord => {
      const attractionId = coord.attraction_id
      if (!coordinateGroups.has(attractionId)) {
        coordinateGroups.set(attractionId, [])
      }
      coordinateGroups.get(attractionId)!.push(coord)
    })

    // Filtrar apenas grupos com múltiplas coordenadas
    const duplicates = Array.from(coordinateGroups.entries())
      .filter(([_, coords]) => coords.length > 1)
      .map(([attractionId, coords]) => ({
        attraction_id: attractionId,
        name: coords[0].attractions.name,
        city: coords[0].attractions.city,
        country: coords[0].attractions.country,
        coordinate_count: coords.length,
        coordinates: coords
      }))

    // Exibir resultados
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
      console.log(`   📍 Coordenadas:`)
      
      poi.coordinates.forEach((coord, coordIndex) => {
        console.log(`      ${coordIndex + 1}. Lat: ${coord.latitude}, Lng: ${coord.longitude}`)
        console.log(`         🆔 Coord ID: ${coord.id}`)
        console.log(`         📅 Criado em: ${new Date(coord.created_at).toLocaleString('pt-BR')}`)
      })
      
      // Calcular distância entre coordenadas (aproximada)
      if (poi.coordinates.length > 1) {
        const coord1 = poi.coordinates[0]
        const coord2 = poi.coordinates[1]
        const distance = calculateDistance(
          coord1.latitude, coord1.longitude,
          coord2.latitude, coord2.longitude
        )
        console.log(`   📏 Distância aproximada entre coordenadas: ${distance.toFixed(2)} metros`)
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

    // Verificar coordenadas muito próximas
    const closeCoordinates = duplicates.filter(poi => {
      if (poi.coordinates.length < 2) return false
      
      const coord1 = poi.coordinates[0]
      const coord2 = poi.coordinates[1]
      const distance = calculateDistance(
        coord1.latitude, coord1.longitude,
        coord2.latitude, coord2.longitude
      )
      
      return distance < 10 // Menos de 10 metros
    })

    if (closeCoordinates.length > 0) {
      console.log(`\n⚠️  ${closeCoordinates.length} POIs com coordenadas muito próximas (< 10m):`)
      closeCoordinates.forEach(poi => {
        console.log(`   - ${poi.name} (${poi.city})`)
      })
    }

  } catch (error) {
    console.error('💥 Erro ao verificar coordenadas duplicadas:', error)
  }
}

// Função para calcular distância entre duas coordenadas (fórmula de Haversine)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Raio da Terra em metros
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

// Executar verificação
checkDuplicateCoordinatesQuick()
  .then(() => {
    console.log('\n✅ Verificação concluída!')
  })
  .catch((error) => {
    console.error('💥 Erro na verificação:', error)
  })
