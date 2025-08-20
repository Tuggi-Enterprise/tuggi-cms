import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function testFeedbackSystem() {
  console.log('🧪 Testando Sistema de Feedback...\n')

  try {
    // 1. Testar API de sugestões
    console.log('1️⃣ Testando API de sugestões...')
    const suggestionsResponse = await fetch('http://localhost:3000/api/pov-suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        poi_id: '3704c134-946f-41ca-82c8-27db2ebb68af', // Estádio do Morumbi
        poi_name: 'Estádio Cícero Pompeu de Toledo - Morumbis',
        poi_lat: -23.6000811,
        poi_lng: -46.7235916,
        poi_types: ['stadium', 'point_of_interest', 'establishment'],
        limit: 3,
        min_confidence: 70
      })
    })

    const suggestionsResult = await suggestionsResponse.json()
    
    if (!suggestionsResponse.ok) {
      throw new Error(`API Error: ${suggestionsResult.error}`)
    }

    console.log(`✅ ${suggestionsResult.data.suggestions.length} sugestões geradas`)
    
    if (suggestionsResult.data.suggestions.length === 0) {
      console.log('⚠️ Nenhuma sugestão para testar feedback')
      return
    }

    const testSuggestion = suggestionsResult.data.suggestions[0]
    console.log(`📍 Testando com sugestão: ${testSuggestion.id}`)

    // 2. Testar feedback de aceitação
    console.log('\n2️⃣ Testando feedback de aceitação...')
    const acceptResponse = await fetch('http://localhost:3000/api/pov-suggestions/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        suggestionId: testSuggestion.id,
        poiId: '3704c134-946f-41ca-82c8-27db2ebb68af',
        action: 'accept',
        coordinates: {
          lat: testSuggestion.lat,
          lng: testSuggestion.lng
        }
      })
    })

    const acceptResult = await acceptResponse.json()
    
    if (!acceptResponse.ok) {
      throw new Error(`Feedback Error: ${acceptResult.error}`)
    }

    console.log(`✅ Feedback de aceitação salvo: ${acceptResult.feedbackId}`)

    // 3. Testar feedback de rejeição
    console.log('\n3️⃣ Testando feedback de rejeição...')
    const rejectResponse = await fetch('http://localhost:3000/api/pov-suggestions/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        suggestionId: testSuggestion.id + '_reject',
        poiId: '3704c134-946f-41ca-82c8-27db2ebb68af',
        action: 'reject',
        feedback: 'Teste de rejeição - local muito distante',
        coordinates: {
          lat: testSuggestion.lat + 0.001,
          lng: testSuggestion.lng + 0.001
        }
      })
    })

    const rejectResult = await rejectResponse.json()
    
    if (!rejectResponse.ok) {
      throw new Error(`Feedback Error: ${rejectResult.error}`)
    }

    console.log(`✅ Feedback de rejeição salvo: ${rejectResult.feedbackId}`)

    // 4. Verificar dados salvos no banco
    console.log('\n4️⃣ Verificando dados salvos no banco...')
    const { data: feedbackData, error: feedbackError } = await supabase
      .schema('core')
      .from('pov_training_examples')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)

    if (feedbackError) {
      throw new Error(`Database Error: ${feedbackError.message}`)
    }

    console.log(`✅ ${feedbackData.length} registros de feedback encontrados`)
    
    feedbackData.forEach((record, index) => {
      console.log(`   ${index + 1}. ${record.is_positive_example ? '✅ Aceita' : '❌ Rejeitada'} - ${record.context_text?.substring(0, 80)}...`)
    })

    console.log('\n🎉 Sistema de feedback funcionando perfeitamente!')

  } catch (error) {
    console.error('❌ Erro no teste:', error)
    process.exit(1)
  }
}

// Executar teste
testFeedbackSystem()
