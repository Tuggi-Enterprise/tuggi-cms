#!/usr/bin/env tsx

/**
 * Script de teste para verificar a funcionalidade de detecção de POIs duplicados
 */

import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente do Supabase não configuradas')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testDuplicateDetection() {
  console.log('🧪 Testando detecção de POIs duplicados...\n')

  try {
    // 1. Testar função de cálculo de distância
    console.log('1️⃣ Testando função de cálculo de distância...')
    const { data: distanceTest, error: distanceError } = await supabase
      .rpc('calculate_distance_km', {
        lat1: -23.5505,
        lon1: -46.6333,
        lat2: -23.5506,
        lon2: -46.6334
      })

    if (distanceError) {
      console.error('❌ Erro no teste de distância:', distanceError)
    } else {
      console.log(`✅ Distância calculada: ${distanceTest} km`)
    }

    // 2. Verificar se existem POIs nos estados alvo
    console.log('\n2️⃣ Verificando POIs nos estados SP, RJ, MG...')
    const { data: poiCount, error: countError } = await supabase
      .from('attractions')
      .select('state', { count: 'exact' })
      .in('state', ['SP', 'RJ', 'MG'])

    if (countError) {
      console.error('❌ Erro ao contar POIs:', countError)
    } else {
      console.log('✅ POIs encontrados por estado:')
      const stateCounts = poiCount?.reduce((acc: Record<string, number>, item: any) => {
        acc[item.state] = (acc[item.state] || 0) + 1
        return acc
      }, {}) || {}
      
      Object.entries(stateCounts).forEach(([state, count]) => {
        console.log(`   • ${state}: ${count} POIs`)
      })
    }

    // 3. Verificar se existem coordenadas para os POIs
    console.log('\n3️⃣ Verificando coordenadas dos POIs...')
    const { data: coordsCount, error: coordsError } = await supabase
      .from('attraction_coordinate')
      .select('attraction_id', { count: 'exact' })

    if (coordsError) {
      console.error('❌ Erro ao contar coordenadas:', coordsError)
    } else {
      console.log(`✅ Total de coordenadas: ${coordsCount?.length || 0}`)
    }

    // 4. Testar função principal de detecção de duplicatas via API
    console.log('\n4️⃣ Testando detecção de duplicatas via API...')
    try {
      const duplicatesResponse = await fetch('http://localhost:3000/api/duplicate-pois')
      if (!duplicatesResponse.ok) {
        throw new Error(`HTTP ${duplicatesResponse.status}`)
      }
      const duplicatesData = await duplicatesResponse.json()
      const duplicates = duplicatesData.duplicates

      console.log(`✅ Duplicatas encontradas: ${duplicates?.length || 0}`)
      
      if (duplicates && duplicates.length > 0) {
        console.log('\n📋 Primeiras 5 duplicatas:')
        duplicates.slice(0, 5).forEach((dup: any, index: number) => {
          console.log(`\n${index + 1}. ${dup.nomes_dos_pois[0]} (${dup.cidade}, ${dup.estado})`)
          console.log(`   📏 Distância: ${dup.menor_distancia_metros.toFixed(1)}m`)
          console.log(`   📍 POIs: ${dup.total_pois}`)
          console.log(`   🎯 Ação: ${dup.sugestao_acao}`)
        })
      }
    } catch (error) {
      console.error('❌ Erro na detecção de duplicatas via API:', error)
    }

    // 5. Testar função de estatísticas via API
    console.log('\n5️⃣ Testando estatísticas via API...')
    try {
      const statsResponse = await fetch('http://localhost:3000/api/duplicate-pois?action=stats')
      if (!statsResponse.ok) {
        throw new Error(`HTTP ${statsResponse.status}`)
      }
      const statsData = await statsResponse.json()
      const stats = statsData.stats

      console.log('✅ Estatísticas por estado:')
      stats?.forEach((stat: any) => {
        console.log(`\n🏛️  ${stat.estado}:`)
        console.log(`   • Grupos de duplicatas: ${stat.total_grupos_duplicatas}`)
        console.log(`   • POIs envolvidos: ${stat.total_pois_envolvidos}`)
        console.log(`   • Distância média: ${stat.distancia_media_metros.toFixed(1)}m`)
      })
    } catch (error) {
      console.error('❌ Erro nas estatísticas via API:', error)
    }

    // 6. Teste de análise detalhada via API (se houver duplicatas)
    if (duplicates && duplicates.length > 0) {
      console.log('\n6️⃣ Testando análise detalhada via API...')
      const firstDuplicate = duplicates[0]
      try {
        const analysisResponse = await fetch(
          `http://localhost:3000/api/duplicate-pois?action=analyze&poi_name=${encodeURIComponent(firstDuplicate.nomes_dos_pois[0])}&city_name=${encodeURIComponent(firstDuplicate.cidade)}&state_name=${encodeURIComponent(firstDuplicate.estado)}`
        )
        if (!analysisResponse.ok) {
          throw new Error(`HTTP ${analysisResponse.status}`)
        }
        const analysisData = await analysisResponse.json()
        const detailed = analysisData.analysis

        console.log(`✅ Análise detalhada de "${firstDuplicate.nomes_dos_pois[0]}":`)
        detailed?.forEach((poi: any, index: number) => {
          console.log(`\n   ${index + 1}. ${poi.poi_name}`)
          console.log(`      🆔 ID: ${poi.poi_id}`)
          console.log(`      📍 Coordenadas: ${poi.latitude}, ${poi.longitude}`)
          console.log(`      ✅ Aprovado: ${poi.approved ? 'Sim' : 'Não'}`)
          console.log(`      📅 Criado em: ${new Date(poi.created_at).toLocaleDateString('pt-BR')}`)
        })
      } catch (error) {
        console.error('❌ Erro na análise detalhada via API:', error)
      }
    }

    console.log('\n✅ Teste concluído com sucesso!')

  } catch (error) {
    console.error('❌ Erro durante o teste:', error)
  }
}

// Executar teste
testDuplicateDetection()
