/**
 * Test Script for Gemini Description Service - POI by ID
 * 
 * Tests description generation for a specific POI from database
 * 
 * Usage:
 *   npx tsx scripts/test-poi-by-id.ts <POI_ID>
 *   npx tsx scripts/test-poi-by-id.ts 50cd5835-70db-41be-9084-3adcae63c15e
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { GeminiDescriptionService } from '../lib/services/gemini-descriptions/gemini-description.service'
import type { POIData } from '../lib/services/gemini-descriptions/types'
import { createClient } from '@supabase/supabase-js'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })
dotenv.config({ path: resolve(process.cwd(), '.env') })

// Get Supabase client
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: { 
      autoRefreshToken: false, 
      persistSession: false,
      detectSessionInUrl: false
    }
  })
}

async function fetchPOIData(poiId: string): Promise<POIData | null> {
  console.log(`🔍 Buscando POI no banco de dados: ${poiId}\n`)
  
  const supabase = getSupabaseClient()
  
  try {
    const { data: poi, error } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        country,
        state,
        formatted_address,
        vicinity,
        website,
        reference_links,
        google_place_id,
        google_types,
        rating,
        user_ratings_total,
        price_level,
        business_status,
        formatted_phone_number,
        international_phone_number,
        opening_hours,
        image_url,
        photos_references,
        osm_tags,
        osm_wikipedia_url,
        contact_phone,
        contact_email,
        heritage_status,
        unesco_status,
        unesco_inscription_date,
        architectural_style,
        historical_period,
        landmark_type,
        architect,
        construction_status,
        completion_estimated_year,
        landmark_level,
        importance_level,
        cultural_significance,
        osm_category,
        osm_description,
        monument_type,
        commemorated_event,
        commemorated_person,
        building_colour,
        roof_colour,
        building_material,
        attraction_coordinate!inner(latitude, longitude)
      `)
      .eq('id', poiId)
      .single()

    if (error) {
      console.error('❌ Erro ao buscar POI:', error.message)
      return null
    }

    if (!poi) {
      console.error('❌ POI não encontrado')
      return null
    }

    console.log('✅ POI encontrado!')
    console.log(`   Nome: ${poi.name}`)
    console.log(`   Localização: ${poi.city || 'N/A'}, ${poi.state || 'N/A'}, ${poi.country || 'N/A'}`)
    console.log(`   Coordenadas: ${poi.attraction_coordinate?.latitude || 'N/A'}, ${poi.attraction_coordinate?.longitude || 'N/A'}`)
    console.log(`   Google Types: ${poi.google_types?.join(', ') || 'N/A'}`)
    console.log(`   OSM Tags: ${poi.osm_tags ? 'Sim' : 'Não'}`)
    if (poi.osm_tags) {
      console.log(`   OSM Tags detalhados:`, JSON.stringify(poi.osm_tags, null, 2))
    }
    console.log('')

    // Map database data to POIData interface
    const poiData: POIData = {
      id: poi.id,
      name: poi.name || 'Unknown',
      city: poi.city,
      country: poi.country,
      state: poi.state,
      formatted_address: poi.formatted_address,
      vicinity: poi.vicinity,
      website: poi.website,
      reference_links: poi.reference_links || [],
      google_place_id: poi.google_place_id,
      google_types: poi.google_types || [],
      rating: poi.rating,
      user_ratings_total: poi.user_ratings_total,
      price_level: poi.price_level,
      business_status: poi.business_status,
      formatted_phone_number: poi.formatted_phone_number,
      international_phone_number: poi.international_phone_number,
      opening_hours: poi.opening_hours,
      image_url: poi.image_url,
      photos_references: poi.photos_references,
      osm_tags: poi.osm_tags as any,
      lat: poi.attraction_coordinate?.latitude,
      lng: poi.attraction_coordinate?.longitude
    }

    return poiData

  } catch (error: any) {
    console.error('❌ Erro ao buscar POI:', error.message)
    return null
  }
}

async function testPOIDescription(poiId: string) {
  console.log('🧪 Testing Gemini Description Service - POI by ID\n')
  console.log('=' .repeat(60))
  console.log(`POI ID: ${poiId}`)
  console.log('=' .repeat(60))
  console.log('')
  
  // Fetch POI data from database
  const poiData = await fetchPOIData(poiId)
  
  if (!poiData) {
    console.error('❌ Não foi possível buscar os dados do POI')
    process.exit(1)
  }
  
  console.log('⏱️  Duração de áudio: 30 segundos')
  console.log('📝 Palavras máximas: 120\n')
  console.log('=' .repeat(60))
  console.log('\n🚀 Gerando descrição...\n')
  
  try {
    const result = await GeminiDescriptionService.generate(poiData, {
      style: 'touristic',
      language: 'pt-br',
      maxWords: 120,
      audioDuration: '30s',
      validate: true
    })
    
    if (result.success && result.description) {
      const wordCount = result.description.split(/\s+/).length
      const charCount = result.description.length
      
      console.log('✅ Descrição gerada com sucesso!\n')
      console.log('=' .repeat(60))
      console.log('📝 DESCRIÇÃO:')
      console.log('=' .repeat(60))
      console.log(result.description)
      console.log('=' .repeat(60))
      console.log('\n📊 ESTATÍSTICAS:')
      console.log(`   - Palavras: ${wordCount} / 120 (máximo)`)
      console.log(`   - Caracteres: ${charCount}`)
      console.log(`   - Tempo estimado de áudio: ~${Math.round(wordCount / 3)} segundos`)
      console.log(`   - Modelo usado: ${result.metadata.model_used || 'default'}`)
      console.log(`   - Tempo de processamento: ${result.processing_time}ms`)
      
      if (result.validation) {
        console.log('\n✅ VALIDAÇÃO:')
        console.log(`   - Aprovada: ${result.validation.aprovada ? '✅ SIM' : '❌ NÃO'}`)
        console.log(`   - Pontuação: ${result.validation.pontuacao}/100`)
        if (result.validation.problemas.length > 0) {
          console.log(`   - Problemas: ${result.validation.problemas.join(', ')}`)
        }
        if (result.validation.sugestoes_melhoria) {
          console.log(`   - Sugestões: ${result.validation.sugestoes_melhoria}`)
        }
      }
      
      // Verificação de duração
      const estimatedSeconds = wordCount / 3 // 3 palavras por segundo com TTS speed 1.2
      console.log('\n⏱️  VERIFICAÇÃO DE DURAÇÃO:')
      console.log(`   - Palavras: ${wordCount}`)
      console.log(`   - Tempo estimado: ~${estimatedSeconds.toFixed(1)} segundos`)
      console.log(`   - Meta: 30 segundos`)
      if (estimatedSeconds <= 30) {
        console.log(`   ✅ Dentro do limite de 30 segundos`)
      } else {
        console.log(`   ⚠️  Excede 30 segundos (${(estimatedSeconds - 30).toFixed(1)}s a mais)`)
      }
      
    } else {
      console.error('❌ Erro ao gerar descrição:', result.error)
      if (result.metadata) {
        console.error('   Step:', result.metadata.step)
        console.error('   Status:', result.metadata.status)
      }
    }
    
  } catch (error: any) {
    console.error('❌ Erro:', error.message)
    console.error('\n💡 Verifique:')
    console.error('   1. Se GEMINI_API_KEY ou GOOGLE_GEMINI_API_KEY está configurada')
    console.error('   2. Se a API key é válida')
    console.error('   3. Se há conexão com a internet')
    process.exit(1)
  }
}

// Get POI ID from command line arguments
const poiId = process.argv[2] || '50cd5835-70db-41be-9084-3adcae63c15e'

if (!poiId) {
  console.error('❌ Por favor, forneça um ID de POI')
  console.error('   Uso: npx tsx scripts/test-poi-by-id.ts <POI_ID>')
  process.exit(1)
}

// Run test
testPOIDescription(poiId)
  .then(() => {
    console.log('\n✅ Teste concluído!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Erro no teste:', error)
    process.exit(1)
  })

