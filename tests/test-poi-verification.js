require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas')
  console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Definida' : 'Não definida')
  console.log('SUPABASE_SECRET_KEY:', supabaseKey ? 'Definida' : 'Não definida')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testPOIVerification(poiId) {
  console.log(`🔍 Verificando POI: ${poiId}`)
  console.log('=' .repeat(60))

  try {
    // 1. Primeiro buscar descrições para confirmar que o POI existe
    console.log('📝 BUSCANDO DESCRIÇÕES...')
    const { data: descriptions, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id,
        attraction_id,
        language,
        description,
        verification_status,
        audio_url,
        created_at,
        updated_at
      `)
      .eq('attraction_id', poiId)
      .order('created_at', { ascending: false })

    if (descError) {
      console.error('❌ Erro ao buscar descrições:', descError)
    } else if (descriptions && descriptions.length > 0) {
      console.log(`✅ Encontradas ${descriptions.length} descrições`)
      descriptions.forEach((desc, index) => {
        console.log(`   ${index + 1}. Idioma: ${desc.language}`)
        console.log(`      Status: ${desc.verification_status}`)
        console.log(`      Áudio: ${desc.audio_url ? 'Sim' : 'Não'}`)
        console.log(`      Criado: ${new Date(desc.created_at).toLocaleString()}`)
        console.log(`      Descrição: ${desc.description.substring(0, 200)}${desc.description.length > 200 ? '...' : ''}`)
        console.log('')
      })
    } else {
      console.log('❌ Nenhuma descrição encontrada para este POI')
      return
    }

    // 2. Buscar dados básicos da POI
    const { data: pois, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        city,
        state,
        country,
        google_types,
        category,
        approved,
        created_at
      `)
      .eq('id', poiId)

    if (poiError) {
      console.error('❌ Erro ao buscar POI:', poiError)
      return
    }

    if (!pois || pois.length === 0) {
      console.log('❌ POI não encontrada com esse ID')
      console.log('💡 Tentando buscar POIs similares...')
      
      // Buscar por nome similar se o ID não for encontrado
      const { data: similarPois } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, state, country')
        .ilike('name', '%Dom Nery%')
        .limit(5)
      
      if (similarPois && similarPois.length > 0) {
        console.log('🔍 POIs encontradas com "Dom Nery":')
        similarPois.forEach((poi, index) => {
          console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state}) - ID: ${poi.id}`)
        })
      } else {
        console.log('❌ Nenhuma POI encontrada com "Dom Nery"')
      }
      return
    }

    const poi = pois[0]

    console.log('📍 DADOS DA POI:')
    console.log(`   Nome: ${poi.name}`)
    console.log(`   Localização: ${poi.city}, ${poi.state}, ${poi.country}`)
    console.log(`   Categoria: ${poi.category}`)
    console.log(`   Google Types: ${JSON.stringify(poi.google_types)}`)
    console.log(`   Aprovado: ${poi.approved}`)
    console.log('')

    // 1.1. Buscar coordenadas
    const { data: coordinates, error: coordError } = await supabase
      .schema('core')
      .from('attraction_coordinates')
      .select('latitude, longitude')
      .eq('attraction_id', poiId)
      .single()

    if (coordError) {
      console.log('⚠️ Coordenadas não encontradas:', coordError.message)
    } else if (coordinates) {
      console.log(`   Coordenadas: ${coordinates.latitude}, ${coordinates.longitude}`)
    }
    console.log('')

    // Descrições já foram buscadas acima

    // 3. Buscar tokens existentes
    const { data: tokens, error: tokensError } = await supabase
      .schema('core')
      .from('attraction_tokens')
      .select(`
        token,
        weight,
        source,
        created_at
      `)
      .eq('attraction_id', poiId)
      .order('weight', { ascending: false })
      .limit(10)

    if (tokensError) {
      console.error('❌ Erro ao buscar tokens:', tokensError)
    } else {
      console.log('🏷️ TOKENS EXISTENTES (Top 10):')
      if (tokens && tokens.length > 0) {
        tokens.forEach((token, index) => {
          console.log(`   ${index + 1}. "${token.token}" (peso: ${token.weight}, fonte: ${token.source})`)
        })
      } else {
        console.log('   Nenhum token encontrado')
      }
      console.log('')
    }

    // 4. Buscar fontes de verificação da cidade
    const { data: citySources, error: citySourcesError } = await supabase
      .schema('core')
      .from('city_verification_sources')
      .select(`
        source_name,
        source_type,
        base_url,
        search_endpoint,
        priority,
        is_active
      `)
      .eq('city_name', poi.city)
      .eq('is_active', true)
      .order('priority', { ascending: true })

    if (citySourcesError) {
      console.error('❌ Erro ao buscar fontes da cidade:', citySourcesError)
    } else {
      console.log(`🌐 FONTES DE VERIFICAÇÃO PARA ${poi.city}:`)
      if (citySources && citySources.length > 0) {
        citySources.forEach((source, index) => {
          console.log(`   ${index + 1}. ${source.source_name} (${source.source_type})`)
          console.log(`      URL: ${source.base_url}`)
          console.log(`      Busca: ${source.search_endpoint || 'N/A'}`)
          console.log(`      Prioridade: ${source.priority}`)
          console.log('')
        })
      } else {
        console.log('   Nenhuma fonte específica da cidade encontrada')
      }
    }

    // 5. Análise de consistência
    console.log('🔍 ANÁLISE DE CONSISTÊNCIA:')
    
    if (descriptions && descriptions.length > 0) {
      const ptBrDesc = descriptions.find(d => d.language === 'pt-br')
      if (ptBrDesc) {
        console.log('✅ Descrição em português encontrada')
        
        // Verificar se a descrição menciona a cidade
        const mentionsCity = ptBrDesc.description.toLowerCase().includes(poi.city.toLowerCase())
        console.log(`${mentionsCity ? '✅' : '⚠️'} Descrição menciona a cidade (${poi.city}): ${mentionsCity}`)
        
        // Verificar se a descrição menciona elementos do nome da POI
        const poiNameWords = poi.name.toLowerCase().split(' ').filter(word => word.length > 3)
        const mentionsNameElements = poiNameWords.some(word => 
          ptBrDesc.description.toLowerCase().includes(word)
        )
        console.log(`${mentionsNameElements ? '✅' : '⚠️'} Descrição menciona elementos do nome da POI: ${mentionsNameElements}`)
        
        // Verificar comprimento da descrição
        const wordCount = ptBrDesc.description.split(' ').length
        console.log(`${wordCount >= 50 && wordCount <= 200 ? '✅' : '⚠️'} Comprimento adequado (${wordCount} palavras): ${wordCount >= 50 && wordCount <= 200}`)
        
      } else {
        console.log('⚠️ Nenhuma descrição em português encontrada')
      }
    }

    console.log('=' .repeat(60))
    console.log('✅ Verificação concluída')

  } catch (error) {
    console.error('❌ Erro geral:', error)
  }
}

// Executar o teste
const poiId = process.argv[2] || '10719379-c6d3-4f1f-a303-56ba44c51c58'
testPOIVerification(poiId)
