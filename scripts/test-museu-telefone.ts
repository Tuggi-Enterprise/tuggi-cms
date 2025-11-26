/**
 * Test Script for Museu do Telefone - Bragança Paulista
 * 
 * Tests description generation with historical curiosity
 * 
 * Usage:
 *   npx tsx scripts/test-museu-telefone.ts
 */

import { GeminiDescriptionService } from '../lib/services/gemini-descriptions/gemini-description.service'
import type { POIData } from '../lib/services/gemini-descriptions/types'

async function testMuseuTelefone() {
  console.log('🧪 Testing Gemini Description Service - Museu do Telefone\n')
  console.log('=' .repeat(60))
  
  // POI Data - Museu do Telefone em Bragança Paulista
  const poiData: POIData = {
    name: 'Museu do Telefone',
    city: 'Bragança Paulista',
    country: 'Brazil',
    state: 'SP',
    google_types: ['museum', 'tourist_attraction', 'point_of_interest']
  }
  
  // Contexto histórico importante
  const additionalContext = `INFORMAÇÃO HISTÓRICA IMPORTANTE:
Dom Pedro Primeiro fez a primeira ligação telefônica do estado de São Paulo neste local.
Esta é uma curiosidade histórica significativa que deve ser incluída na descrição.`
  
  console.log('📍 POI:', poiData.name)
  console.log('📍 Localização:', `${poiData.city}, ${poiData.state}, ${poiData.country}`)
  console.log('📚 Curiosidade histórica:', 'Dom Pedro Primeiro fez a primeira ligação telefônica do estado de São Paulo neste local')
  console.log('⏱️  Duração de áudio: 30 segundos')
  console.log('📝 Palavras máximas: 120\n')
  console.log('=' .repeat(60))
  console.log('\n🚀 Gerando descrição...\n')
  
  try {
    // Teste 1: Estilo turístico (padrão)
    console.log('📌 TESTE 1: Estilo TURÍSTICO\n')
    const resultTouristic = await GeminiDescriptionService.generate(poiData, {
      style: 'touristic',
      language: 'pt-br',
      maxWords: 120,
      audioDuration: '30s',
      additionalContext: additionalContext,
      validate: true
    })
    
    if (resultTouristic.success && resultTouristic.description) {
      const wordCount = resultTouristic.description.split(/\s+/).length
      console.log('✅ Descrição gerada (TURÍSTICO):\n')
      console.log('=' .repeat(60))
      console.log(resultTouristic.description)
      console.log('=' .repeat(60))
      console.log(`\n📊 Estatísticas: ${wordCount} palavras`)
      
      // Verificar se incluiu a curiosidade histórica
      const includesCuriosity = resultTouristic.description.toLowerCase().includes('dom pedro') || 
                                resultTouristic.description.toLowerCase().includes('primeira ligação')
      console.log(`\n🔍 Incluiu curiosidade histórica: ${includesCuriosity ? '✅ SIM' : '❌ NÃO'}`)
    }
    
    console.log('\n\n' + '='.repeat(60) + '\n')
    
    // Teste 2: Estilo histórico
    console.log('📌 TESTE 2: Estilo HISTÓRICO\n')
    const resultHistorical = await GeminiDescriptionService.generate(poiData, {
      style: 'historical',
      language: 'pt-br',
      maxWords: 120,
      audioDuration: '30s',
      additionalContext: additionalContext,
      validate: true
    })
    
    if (resultHistorical.success && resultHistorical.description) {
      const wordCount = resultHistorical.description.split(/\s+/).length
      console.log('✅ Descrição gerada (HISTÓRICO):\n')
      console.log('=' .repeat(60))
      console.log(resultHistorical.description)
      console.log('=' .repeat(60))
      console.log(`\n📊 Estatísticas: ${wordCount} palavras`)
      
      // Verificar se incluiu a curiosidade histórica
      const includesCuriosity = resultHistorical.description.toLowerCase().includes('dom pedro') || 
                                resultHistorical.description.toLowerCase().includes('primeira ligação')
      console.log(`\n🔍 Incluiu curiosidade histórica: ${includesCuriosity ? '✅ SIM' : '❌ NÃO'}`)
    }
    
    console.log('\n\n' + '='.repeat(60))
    console.log('\n📊 COMPARAÇÃO:\n')
    console.log('Viés TURÍSTICO:')
    console.log('  - Tom mais amigável e envolvente')
    console.log('  - Foco em experiência do visitante')
    console.log('  - Pode ser mais genérico\n')
    console.log('Viés HISTÓRICO:')
    console.log('  - Tom mais informativo e factual')
    console.log('  - Foco em fatos históricos e datas')
    console.log('  - Prioriza precisão histórica\n')
    
  } catch (error: any) {
    console.error('❌ Erro:', error.message)
    process.exit(1)
  }
}

// Run test
testMuseuTelefone()
  .then(() => {
    console.log('\n✅ Teste concluído!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Erro no teste:', error)
    process.exit(1)
  })

