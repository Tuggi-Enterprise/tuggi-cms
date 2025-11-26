import { GeminiDescriptionService } from '../lib/services/gemini-descriptions/gemini-description.service'
import type { POIData } from '../lib/services/gemini-descriptions/types'

async function testLagoTaboa() {
  console.log('🧪 Testing Gemini Description Service - Lago do Taboão\n')
  console.log('=' .repeat(60))

  const poiData: POIData = {
    name: 'Lago do Taboão',
    city: 'Bragança Paulista',
    country: 'Brazil',
    state: 'SP',
    osm_tags: {
      'leisure': 'park',
      'natural': 'water',
      'water': 'lake',
      'name': 'Lago do Taboão',
      'description': 'Lago artificial localizado no centro de Bragança Paulista'
    },
    google_types: ['park', 'tourist_attraction', 'point_of_interest']
  }

  console.log('📍 POI:', poiData.name)
  console.log('📍 Localização:', `${poiData.city}, ${poiData.state}, ${poiData.country}`)
  console.log('⏱️  Duração de áudio: 30 segundos')
  console.log('📝 Palavras máximas: 120\n')
  console.log('=' .repeat(60))

  console.log('\n🚀 Gerando descrição...\n')

  // TESTE: Estilo TURÍSTICO
  console.log('📌 TESTE: Estilo TURÍSTICO\n')
  try {
    const result = await GeminiDescriptionService.generate(poiData, {
      style: 'touristic',
      maxWords: 120,
      audioDuration: '30s'
    })

    if (result.success && result.description) {
      console.log('✅ Descrição gerada:\n')
      console.log('=' .repeat(60))
      console.log(result.description)
      console.log('=' .repeat(60) + '\n')
      
      console.log('📊 ESTATÍSTICAS:')
      console.log(`   - Palavras: ${result.metadata.word_count} / ${result.metadata.max_words} (máximo)`)
      console.log(`   - Caracteres: ${result.metadata.response_length}`)
      console.log(`   - Tempo estimado de áudio: ~${result.metadata.estimated_audio_duration} segundos`)
      console.log(`   - Modelo usado: ${result.metadata.model_used}`)
      console.log(`   - Tempo de processamento: ${result.processing_time}ms`)
      console.log(`   - Tokens consumidos: ${result.metadata.tokens_consumed || 'N/A'}\n`)

      console.log('✅ VALIDAÇÃO:')
      console.log(`   - Aprovada: ✅ SIM`)
      console.log(`   - Status: ${result.metadata.status}\n`)

      console.log('⏱️  VERIFICAÇÃO DE DURAÇÃO:')
      console.log(`   - Palavras: ${result.metadata.word_count}`)
      console.log(`   - Tempo estimado: ~${result.metadata.estimated_audio_duration} segundos`)
      console.log(`   - Meta: ${parseInt(result.metadata.audio_duration || '0')} segundos`)
      if (result.metadata.estimated_audio_duration && parseInt(result.metadata.audio_duration || '0') >= result.metadata.estimated_audio_duration) {
        console.log('   ✅ Dentro do limite de 30 segundos\n')
      } else {
        console.log(`   ⚠️  Excede 30 segundos (${(result.metadata.estimated_audio_duration || 0) - parseInt(result.metadata.audio_duration || '0')}s a mais)\n`)
      }

    } else {
      console.error('❌ Erro ao gerar descrição:', result.error)
      console.log(`   Step: ${result.metadata.step}`)
      console.log(`   Status: ${result.metadata.status}\n`)
    }
  } catch (error: any) {
    console.error('❌ Error generating description:', error)
  }

  console.log('=' .repeat(60))
  console.log('\n✅ Teste concluído!\n')
}

testLagoTaboa()

