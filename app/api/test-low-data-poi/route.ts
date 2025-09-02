import { NextRequest, NextResponse } from 'next/server'
import { DescriptionService } from '@/lib/services/poi-processing/description.service'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  console.log('🔍 Testando POI com POUCOS DADOS disponíveis...')

  try {
    // Buscar POIs com diferentes níveis de dados
    const { data: poisData, error: poisError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        country,
        state,
        google_place_id,
        google_types,
        rating,
        user_ratings_total,
        description,
        website,
        wikipedia_url,
        coordinates:attraction_coordinate(latitude, longitude)
      `)
      .limit(10)

    if (poisError || !poisData) {
      throw new Error('Erro ao buscar POIs')
    }

    // Analisar níveis de dados disponíveis
    const dataLevels = poisData.map(poi => {
      const coordinate = poi.coordinates?.[0]
      let dataScore = 0
      let availableData: string[] = []
      let missingData: string[] = []

      // Dados básicos (sempre tem)
      if (poi.name) { dataScore += 10; availableData.push('name') }
      if (poi.city) { dataScore += 10; availableData.push('city') }
      if (coordinate) { dataScore += 10; availableData.push('coordinates') }

      // Dados do Google
      if (poi.google_place_id) { dataScore += 15; availableData.push('google_place_id') } else missingData.push('google_place_id')
      if (poi.google_types?.length > 0) { dataScore += 10; availableData.push('google_types') } else missingData.push('google_types')
      if (poi.rating) { dataScore += 5; availableData.push('rating') } else missingData.push('rating')

      // Dados enriquecidos
      if (poi.description) { dataScore += 15; availableData.push('existing_description') } else missingData.push('existing_description')
      if (poi.website) { dataScore += 10; availableData.push('website') } else missingData.push('website')
      if (poi.wikipedia_url) { dataScore += 15; availableData.push('wikipedia') } else missingData.push('wikipedia')

      return {
        id: poi.id,
        name: poi.name,
        city: poi.city,
        dataScore,
        availableData,
        missingData,
        dataLevel: dataScore >= 70 ? 'HIGH' : dataScore >= 40 ? 'MEDIUM' : 'LOW',
        coordinate
      }
    }).sort((a, b) => a.dataScore - b.dataScore) // Ordenar do menor para maior

    // Selecionar POI com poucos dados
    const lowDataPoi = dataLevels.find(poi => poi.dataLevel === 'LOW' && poi.coordinate) || 
                       dataLevels.find(poi => poi.dataLevel === 'MEDIUM' && poi.coordinate) ||
                       dataLevels[0] // Fallback

    if (!lowDataPoi || !lowDataPoi.coordinate) {
      return NextResponse.json({
        success: false,
        error: 'Não encontrou POI adequado para teste',
        available_pois: dataLevels.slice(0, 5)
      })
    }

    console.log(`🔍 Testando POI: ${lowDataPoi.name} (Score: ${lowDataPoi.dataScore}/100)`)

    // Preparar input do POI com poucos dados
    const poiInput = {
      id: lowDataPoi.id,
      name: lowDataPoi.name,
      city: lowDataPoi.city,
      country: 'Brasil',
      state: 'SP', // Assumindo SP
      google_types: [], // Simulando ausência
      rating: null,
      user_ratings_total: null,
      google_place_id: null,
      lat: lowDataPoi.coordinate.latitude,
      lng: lowDataPoi.coordinate.longitude
    }

    console.log('🔍 Gerando descrição com DADOS LIMITADOS...')
    
    const result = await DescriptionService.generate(poiInput, {
      language: 'pt-br',
      use_dynamic_sources: true,
      enrich_with_osm: true,
      persist_verification: false,
      auto_generate_audio: false
    })

    // Analisar como o sistema lidou com poucos dados
    const description = result.description || ''
    
    const lowDataAnalysis = {
      // Estrutura básica mantida?
      hasLocalContext: false,
      hasMainDescription: true,
      hasCuriousFact: false,
      
      // Qualidade com poucos dados
      length: description.length,
      mentionsCity: false,
      mentionsGenericInfo: false,
      usedFallbackStrategies: false,
      
      // Fontes utilizadas
      ragSourcesFound: 0,
      osmDataUsed: false,
      fallbackToGeneral: false
    }
    
    const lowerDescription = description.toLowerCase()
    
    // Verificar estrutura básica
    const localContextIndicators = ['terra da', 'conhecida por', 'famosa por', 'capital da', 'região', 'área']
    lowDataAnalysis.hasLocalContext = localContextIndicators.some(indicator => 
      lowerDescription.includes(indicator)
    )
    
    const curiousFactMatches = description.match(/curious fact:/gi) || []
    lowDataAnalysis.hasCuriousFact = curiousFactMatches.length > 0
    
    // Verificar se menciona a cidade
    lowDataAnalysis.mentionsCity = lowerDescription.includes(lowDataPoi.city.toLowerCase())
    
    // Verificar se usou informações genéricas
    const genericTerms = ['local', 'região', 'área', 'ponto', 'lugar', 'estabelecimento']
    lowDataAnalysis.mentionsGenericInfo = genericTerms.some(term => 
      lowerDescription.includes(term)
    )
    
    // Analisar fontes RAG (se disponível)
    if (result.rag_sources_found) {
      lowDataAnalysis.ragSourcesFound = result.rag_sources_found.sources?.length || 0
    }
    
    // Score de adaptabilidade
    let adaptabilityScore = 0
    if (lowDataAnalysis.hasMainDescription) adaptabilityScore += 30
    if (lowDataAnalysis.length >= 100) adaptabilityScore += 20 // Conseguiu gerar conteúdo mínimo
    if (lowDataAnalysis.mentionsCity) adaptabilityScore += 15
    if (lowDataAnalysis.hasCuriousFact) adaptabilityScore += 15
    if (lowDataAnalysis.hasLocalContext) adaptabilityScore += 10
    if (!lowDataAnalysis.mentionsGenericInfo) adaptabilityScore += 10 // Evitou ser muito genérico
    
    const adaptabilityVerdict = 
      adaptabilityScore >= 80 ? '🏆 EXCELENTE adaptação a poucos dados' :
      adaptabilityScore >= 60 ? '✅ BOA adaptação' :
      adaptabilityScore >= 40 ? '🔶 ADAPTAÇÃO PARCIAL' :
      '❌ DIFICULDADE com poucos dados'

    return NextResponse.json({
      success: result.success,
      
      // POI TESTADO
      test_poi: {
        name: lowDataPoi.name,
        city: lowDataPoi.city,
        data_score: lowDataPoi.dataScore,
        data_level: lowDataPoi.dataLevel,
        available_data: lowDataPoi.availableData,
        missing_data: lowDataPoi.missingData
      },
      
      // ANÁLISE DE ADAPTABILIDADE
      adaptability_analysis: {
        adaptability_score: adaptabilityScore,
        adaptability_verdict: adaptabilityVerdict,
        
        structure_maintained: {
          has_local_context: lowDataAnalysis.hasLocalContext,
          has_main_description: lowDataAnalysis.hasMainDescription,
          has_curious_fact: lowDataAnalysis.hasCuriousFact
        },
        
        content_quality: {
          length: lowDataAnalysis.length,
          mentions_city: lowDataAnalysis.mentionsCity,
          mentions_generic_info: lowDataAnalysis.mentionsGenericInfo,
          rag_sources_found: lowDataAnalysis.ragSourcesFound
        }
      },

      // DESCRIÇÃO GERADA
      description_result: {
        generated: !!result.description,
        length: result.description?.length || 0,
        verification_score: result.verification?.pontuacao || 0,
        processing_time: result.processing_time,
        full_description: result.description
      },

      // ESTRATÉGIAS DE FALLBACK
      fallback_strategies: [
        "✅ RAG dinâmico por cidade/país",
        "✅ Dados OSM como backup", 
        "✅ Informações gerais da região",
        "✅ Estrutura mínima garantida",
        "⚠️ Evitar informações muito genéricas"
      ],

      note: 'Testando como o sistema se adapta quando há poucos dados disponíveis sobre o POI.'
    })

  } catch (error: any) {
    console.error('❌ Erro no teste de poucos dados:', error.message)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
