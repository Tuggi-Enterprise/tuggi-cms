#!/usr/bin/env tsx

/**
 * Script para verificar os dados do Parque Ibirapuera no banco
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const IBIRAPUERA_ID = '66e082b7-744a-4c93-8fbb-f039d3f34e64'

async function checkIbirapueraData() {
  try {
    console.log('🔍 Verificando dados do Parque Ibirapuera...')
    console.log(`📋 ID: ${IBIRAPUERA_ID}`)

    // Buscar dados completos do POI
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        country,
        google_place_id,
        google_types,
        rating,
        description,
        image_url,
        business_status,
        vicinity,
        coordinates:attraction_coordinate(latitude, longitude)
      `)
      .eq('id', IBIRAPUERA_ID)
      .single()

    if (error) {
      console.error('❌ Erro ao buscar POI:', error)
      return
    }

    if (!data) {
      console.log('❌ POI não encontrado')
      return
    }

    console.log('\n✅ DADOS DO PARQUE IBIRAPUERA:')
    console.log('=' * 40)
    console.log(`📍 Nome: ${data.name}`)
    console.log(`🏙️ Cidade: ${data.city}`)
    console.log(`🌍 País: ${data.country}`)
    console.log(`⭐ Rating: ${data.rating}`)
    console.log(`🆔 Google Place ID: ${data.google_place_id || 'Não disponível'}`)
    
    if (data.coordinates && data.coordinates.length > 0) {
      const coord = data.coordinates[0]
      console.log(`📍 Coordenadas: ${coord.latitude}, ${coord.longitude}`)
    } else {
      console.log('❌ Coordenadas não encontradas')
    }

    if (data.google_types && data.google_types.length > 0) {
      console.log(`🏷️ Tipos Google: ${data.google_types.join(', ')}`)
    }

    console.log(`📄 Descrição: ${data.description ? 'Disponível' : 'Não disponível'}`)
    console.log(`🖼️ Imagem: ${data.image_url ? 'Disponível' : 'Não disponível'}`)

    // Verificar trigger points existentes
    const { data: triggerPoints, error: triggerError } = await supabase
      .schema('core')
      .from('attraction_trigger_points')
      .select('*')
      .eq('attraction_id', IBIRAPUERA_ID)

    if (!triggerError && triggerPoints) {
      console.log(`\n🎯 TRIGGER POINTS EXISTENTES: ${triggerPoints.length}`)
      
      if (triggerPoints.length > 0) {
        console.log('Tipos de trigger points:')
        const typeCounts = triggerPoints.reduce((acc: any, tp: any) => {
          acc[tp.type] = (acc[tp.type] || 0) + 1
          return acc
        }, {})
        
        Object.entries(typeCounts).forEach(([type, count]) => {
          console.log(`  - ${type}: ${count}`)
        })
      }
    }

    console.log('\n🧪 PRONTO PARA TESTE!')
    console.log('=' * 25)
    console.log('1. Acesse: http://localhost:3000/test-poi-boundaries')
    console.log(`2. Cole este ID: ${IBIRAPUERA_ID}`)
    console.log('3. Clique em "Carregar" e depois "Testar Todas as Estratégias"')
    console.log('\n💡 Este é um ótimo POI para teste porque:')
    console.log('   - É um parque grande com forma irregular')
    console.log('   - Tem fronteiras bem definidas')
    console.log('   - Está em área urbana com muitas ruas ao redor')
    console.log('   - Ideal para validar a detecção de fronteiras')

  } catch (error) {
    console.error('❌ Erro:', error)
  }
}

// Run the script
checkIbirapueraData().catch(console.error)
