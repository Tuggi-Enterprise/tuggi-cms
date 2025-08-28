#!/usr/bin/env tsx

/**
 * Script para buscar POIs de exemplo do banco para testar a detecção de fronteiras
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface SamplePOI {
  id: string
  name: string
  city: string
  country: string
  google_place_id: string | null
  latitude: number
  longitude: number
  google_types: string[]
  rating: number
}

async function getSamplePOIs() {
  try {
    console.log('🔍 Buscando POIs de exemplo no banco...')

    // Buscar POIs com diferentes tipos para testar
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
        coordinates:attraction_coordinate(latitude, longitude)
      `)
      .not('google_place_id', 'is', null)
      .not('coordinates', 'is', null)
      .gte('rating', 4.0)
      .limit(20)

    if (error) {
      throw error
    }

    if (!data || data.length === 0) {
      console.log('❌ Nenhum POI encontrado')
      return
    }

    console.log(`✅ Encontrados ${data.length} POIs`)

    // Organizar por tipo
    const organizedPOIs: { [key: string]: SamplePOI[] } = {}

    data.forEach((poi: any) => {
      if (!poi.coordinates || poi.coordinates.length === 0) return

      const coordinate = poi.coordinates[0]
      const samplePOI: SamplePOI = {
        id: poi.id,
        name: poi.name,
        city: poi.city,
        country: poi.country,
        google_place_id: poi.google_place_id,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        google_types: poi.google_types || [],
        rating: poi.rating
      }

      // Categorizar por tipo principal
      const mainType = getMainPOIType(poi.google_types || [])
      if (!organizedPOIs[mainType]) {
        organizedPOIs[mainType] = []
      }
      organizedPOIs[mainType].push(samplePOI)
    })

    // Exibir resultados organizados
    console.log('\n📋 POIs Organizados por Tipo:')
    console.log('=' * 50)

    Object.entries(organizedPOIs).forEach(([type, pois]) => {
      console.log(`\n🏷️  ${type.toUpperCase()} (${pois.length} POIs):`)
      
      pois.slice(0, 3).forEach((poi, index) => {
        console.log(`   ${index + 1}. ${poi.name}`)
        console.log(`      📍 ${poi.city}, ${poi.country}`)
        console.log(`      🆔 ID: ${poi.id}`)
        console.log(`      ⭐ Rating: ${poi.rating}`)
        console.log(`      🌍 ${poi.latitude.toFixed(6)}, ${poi.longitude.toFixed(6)}`)
        if (poi.google_place_id) {
          console.log(`      🔗 Google Place ID: ${poi.google_place_id}`)
        }
        console.log('')
      })
    })

    // Sugerir POIs ideais para teste
    console.log('\n🎯 SUGESTÕES PARA TESTE:')
    console.log('=' * 30)

    const testSuggestions = [
      { type: 'park', reason: 'Parques têm fronteiras bem definidas' },
      { type: 'lake', reason: 'Lagos têm contornos naturais visíveis' },
      { type: 'museum', reason: 'Museus são prédios com geometria clara' },
      { type: 'shopping_mall', reason: 'Shopping centers têm áreas grandes e definidas' }
    ]

    testSuggestions.forEach(suggestion => {
      const pois = organizedPOIs[suggestion.type] || []
      if (pois.length > 0) {
        const poi = pois[0]
        console.log(`\n🧪 ${suggestion.type.toUpperCase()}: ${poi.name}`)
        console.log(`   ID: ${poi.id}`)
        console.log(`   Razão: ${suggestion.reason}`)
        console.log(`   Comando de teste: Copie este ID na página de teste`)
      }
    })

    console.log('\n🔗 Para testar, acesse: http://localhost:3000/test-poi-boundaries')
    console.log('💡 Cole qualquer um dos IDs acima na página de teste!')

  } catch (error) {
    console.error('❌ Erro ao buscar POIs:', error)
  }
}

function getMainPOIType(types: string[]): string {
  // Priorizar tipos mais específicos
  if (types.includes('natural_feature') || types.includes('lake')) return 'lake'
  if (types.includes('park')) return 'park'
  if (types.includes('museum')) return 'museum'
  if (types.includes('shopping_mall')) return 'shopping_mall'
  if (types.includes('tourist_attraction')) return 'tourist_attraction'
  if (types.includes('church')) return 'church'
  if (types.includes('stadium')) return 'stadium'
  if (types.includes('university')) return 'university'
  if (types.includes('hospital')) return 'hospital'
  if (types.includes('restaurant')) return 'restaurant'
  if (types.includes('establishment')) return 'establishment'
  
  return 'other'
}

// Run the script
getSamplePOIs().catch(console.error)
