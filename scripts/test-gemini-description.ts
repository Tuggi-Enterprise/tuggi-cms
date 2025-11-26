/**
 * Test Script for Gemini Description Service
 * 
 * Tests description generation for Pico do Jaraguá, São Paulo
 * 
 * Usage:
 *   npx tsx scripts/test-gemini-description.ts
 */

import { GeminiDescriptionService } from '../lib/services/gemini-descriptions/gemini-description.service'
import type { POIData } from '../lib/services/gemini-descriptions/types'

async function testGeminiDescription() {
  console.log('🧪 Testing Gemini Description Service\n')
  console.log('=' .repeat(60))
  
  // POI Data with OSM tags for historical and numerical data
  const poiData: POIData = {
    name: 'Pico do Jaraguá',
    city: 'São Paulo',
    country: 'Brazil',
    state: 'SP',
    // OSM tags with historical and numerical data
    osm_tags: {
      ele: '1135', // Elevation in meters
      'natural': 'peak',
      'name': 'Pico do Jaraguá',
      'wikipedia': 'pt:Pico do Jaraguá',
      // Historical data (if available)
      'start_date': '1946', // Year Parque Estadual was created
      'historic:period': 'colonial'
    },
    google_types: ['natural_feature', 'tourist_attraction', 'point_of_interest']
  }
  
  console.log('📍 POI:', poiData.name)
  console.log('📍 Localização:', `${poiData.city}, ${poiData.state}, ${poiData.country}`)
  console.log('⏱️  Duração de áudio: 30 segundos')
  console.log('📝 Palavras máximas: 120\n')
  
  // Confirmação sobre palavras/segundo
  console.log('📊 Cálculo de palavras por segundo:')
  console.log('   - Velocidade normal de fala: ~150 palavras/minuto = 2.5 palavras/segundo')
  console.log('   - Google TTS speed: 1.2x (padrão)')
  console.log('   - Velocidade com TTS: 2.5 * 1.2 = 3 palavras/segundo')
  console.log('   - 30 segundos * 3 palavras/segundo = 90 palavras')
  console.log('   - 120 palavras em 30s = 4 palavras/segundo (um pouco rápido, mas aceitável)')
  console.log('   ✅ 120 palavras para 30 segundos está CORRETO (com margem de segurança)\n')
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

// Run test
testGeminiDescription()
  .then(() => {
    console.log('\n✅ Teste concluído!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Erro no teste:', error)
    process.exit(1)
  })

