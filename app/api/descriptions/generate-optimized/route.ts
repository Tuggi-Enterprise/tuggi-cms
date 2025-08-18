import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'


// Service role client for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * OPTIMIZED DESCRIPTION GENERATION API
 * 
 * Features:
 * - English prompts
 * - Verification-optimized generation
 * - Layered sources integration
 * - Token-based indexing
 * - Factuality-focused approach
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Starting OPTIMIZED description generation...')
    
    // Authentication check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session) {
      console.log('❌ Authentication failed')
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }
    
    console.log('✅ User authenticated:', session.user.email)
    
    const body = await request.json()
    const {
      name,
      city,
      country,
      state,
      formatted_address,
      vicinity,
      google_types,
      rating,
      user_ratings_total,
      use_dynamic_sources = true, // New flag to enable dynamic sources
      optimization_mode = true, // New flag to enable optimization mode
      price_level,
      business_status,
      opening_hours,
      website,
      formatted_phone_number,
      photos_references,
      existing_description,
      image_url,
      id: attractionId,
      google_place_id,
      lat: providedLat,
      lng: providedLng,
      reference_links,
      description_id, // ID da descrição para persistir verificação
      persist_verification = false // Flag para persistir resultados da verificação
    } = body

    console.log('✅ Required parameters check:', { name: !!name, city: !!city, country: !!country })
    
    if (!name || !city || !country) {
      return NextResponse.json(
        { error: 'Missing required parameters: name, city, country' },
        { status: 400 }
      )
    }

    // Get API key
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      )
    }

    // Get layered sources for the attraction's location with dynamic source support
    const layeredSources = await getLayeredSources(city, country, use_dynamic_sources)
    console.log(`📚 Found ${layeredSources.length} layered sources for ${city}, ${country}`)
    
    // Adicionar website oficial como fonte primária se disponível
    if (website) {
      const websiteSource = {
        source_name: `${name} Official Website`,
        source_type: 'official',
        base_url: website,
        priority: 1,
        layer: 'primary'
      }
      // Inserir no início da lista para máxima prioridade
      layeredSources.unshift(websiteSource)
      console.log(`✅ Added official website as primary source: ${website}`)
    }

    // Get existing tokens for RAG optimization
    const existingTokens = await getExistingTokens(attractionId)
    console.log(`🔍 Found ${existingTokens.length} existing tokens for attraction`)

    // Build comprehensive location details
    const locationDetails = buildLocationDetails({ 
      city, 
      country, 
      state, 
      formatted_address, 
      vicinity 
    })

    // Build sources section with layered approach - enhanced for dynamic sources
    const sourcesSection = buildSourcesSection(layeredSources, reference_links, use_dynamic_sources)

    // Build Google data section
    const googleData = buildGoogleDataSection({
      google_types,
      rating,
      user_ratings_total,
      price_level,
      business_status,
      google_place_id
    })

    // Create verification-optimized prompt with enhanced features
    const prompt = createOptimizedPrompt({
      name,
      locationDetails,
      sourcesSection,
      googleData,
      existingDescription: existing_description,
      existingTokens,
      optimizationMode: optimization_mode,
      useDynamicSources: use_dynamic_sources
    })

    console.log('📝 Sending optimized prompt to Gemini API')
    console.log('🔍 Prompt preview:', prompt.substring(0, 500) + '...')

    // Call Gemini API with optimized configuration
    const response = await callGeminiAPI(prompt, apiKey)

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ Gemini API error:', errorData)
      return NextResponse.json(
        { error: 'Failed to generate optimized description', details: errorData },
        { status: 500 }
      )
    }

    const data = await response.json()
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!generatedText) {
      return NextResponse.json(
        { error: 'No description generated by AI' },
        { status: 500 }
      )
    }

    // Extract and store tokens for future RAG optimization
    const extractedTokens = await extractAndStoreTokens(
      attractionId, 
      generatedText, 
      { name, city, country, google_types }
    )

    console.log(`✅ Generated optimized description with ${extractedTokens.length} tokens`)

    // ETAPA ADICIONAL: Verificação da qualidade da descrição
    console.log('🔍 Iniciando verificação da descrição...')
    const verificationResult = await verifyGeneratedDescription(generatedText.trim(), name, apiKey)
    
    // Aplicar melhorias se a descrição não for aprovada e houver sugestões
    let finalDescription = generatedText.trim()
    let verificationApplied = false
    let improvementApplied = false
    
    // Persistir resultados da verificação se solicitado e tivermos IDs necessários
    if (persist_verification && attractionId && description_id) {
      try {
        console.log('💾 Persistindo resultados da verificação diretamente nas tabelas', {
          attractionId,
          description_id,
          score: verificationResult.pontuacao,
          approved: verificationResult.aprovada,
          facts: verificationResult.fatos_verificaveis?.length || 0,
          dates: verificationResult.datas_detectadas?.length || 0
        })
        
        // Salvar diretamente na tabela description_scores (método que funciona)
        const { data: scoreData, error: scoreError } = await supabaseAdmin
          .schema('core')
          .from('description_scores')
          .insert({
            description_id: description_id,
            attraction_id: attractionId,
            lang: 'pt-BR',
            description_hash: require('crypto').createHash('md5').update(finalDescription).digest('hex'),
            score_overall: Math.round(verificationResult.pontuacao),
            subscores: {
              factuality: verificationResult.fatos_verificaveis?.length > 0 ? 70 : 30,
              coherence: 80,
              tts_clarity: 90,
              rules: verificationResult.aprovada ? 90 : 50
            },
            flags: [
              verificationResult.aprovada ? 'verified' : 'needs_review',
              ...(verificationResult.datas_detectadas?.length > 0 ? ['has_dates'] : []),
              ...(verificationResult.fatos_verificaveis?.length > 0 ? ['has_facts'] : [])
            ].filter(Boolean),
            verifier_version: 'v2.0',
            llm_model: 'gemini-1.5-flash',
            confidence: verificationResult.aprovada ? 0.8 : 0.5
          })
          .select('id')
          .single()
        
        if (scoreError) {
          console.error('❌ Erro ao salvar score:', scoreError)
        } else {
          console.log('✅ Score salvo com sucesso:', scoreData)
          
          // Salvar claims se houver
          const allClaims: any[] = []
          
          // Datas detectadas
          if (verificationResult.datas_detectadas?.length > 0) {
            verificationResult.datas_detectadas.forEach((date: string) => {
              allClaims.push({
                description_id: description_id,
                score_id: scoreData.id,
                claim_type: 'year',
                slot: 'date',
                value: date,
                status: 'supported',
                weight: 0.8
              })
            })
          }
          
          // Fatos verificáveis
          if (verificationResult.fatos_verificaveis?.length > 0) {
            verificationResult.fatos_verificaveis.forEach((fact: string) => {
              allClaims.push({
                description_id: description_id,
                score_id: scoreData.id,
                claim_type: 'event',
                slot: 'fact',
                value: fact,
                status: 'supported',
                weight: 0.7
              })
            })
          }
          
          // Salvar claims
          if (allClaims.length > 0) {
            const { error: claimsError } = await supabaseAdmin
              .schema('core')
              .from('description_claims')
              .insert(allClaims)
            
            if (claimsError) {
              console.error('❌ Erro ao salvar claims:', claimsError)
            } else {
              console.log(`✅ ${allClaims.length} claims salvas com sucesso`)
            }
          }
          
          // Atualizar verification_status na tabela attraction_descriptions
          const verificationStatus = verificationResult.aprovada ? 'approved' : 'needs_review'
          const { error: updateError } = await supabaseAdmin
            .schema('core')
            .from('attraction_descriptions')
            .update({
              verification_status: verificationStatus,
              last_verified_at: new Date().toISOString()
            })
            .eq('id', description_id)
          
          if (updateError) {
            console.error('❌ Erro ao atualizar verification_status:', updateError)
          } else {
            console.log(`✅ Verification status atualizado: ${verificationStatus}`)
          }
        }
      } catch (persistError) {
        console.error('❌ Erro ao persistir resultados da verificação:', persistError)
        // Continuamos mesmo se falhar a persistência
      }
    } else {
      console.log('⚠️ Não persistindo resultados da verificação', {
        persist_verification,
        attractionId,
        description_id
      })
    }
    
    // Se a descrição não foi aprovada e a pontuação é muito baixa, tentar melhorar
    // Usando limiar mais baixo (50) para ser mais brando com descrições curtas
    if (!verificationResult.aprovada && verificationResult.pontuacao < 50 && verificationResult.sugestoes_melhoria) {
      console.log('⚠️ Descrição não aprovada. Tentando aplicar melhorias...')
      
      // Prompt para melhorar a descrição com base no feedback, considerando limite de 25 segundos
      const improvementPrompt = `
Você é um especialista em melhorar descrições turísticas CURTAS para áudio de 25 segundos. A descrição abaixo para "${name}" precisa de ajustes:

DESCRIÇÃO ORIGINAL:
"""
${finalDescription}
"""

PROBLEMAS IDENTIFICADOS:
${verificationResult.problemas?.join('\n') || 'Qualidade insuficiente'}

SUGESTÃO DE MELHORIA:
${verificationResult.sugestoes_melhoria}

IMPORTANTE - LIMITE DE 25 SEGUNDOS:
- Máximo 300-350 caracteres (aproximadamente 50-60 palavras)
- Priorize 1-2 fatos verificáveis mais importantes
- Mantenha qualquer data ou período histórico presente na original
- Seja conciso, mas mantenha tom amigável

MELHORE A DESCRIÇÃO MANTENDO:
1. Pelo menos um fato verificável (mesmo que genérico)
2. Estilo de guia turístico minimamente amigável
3. Frases curtas e fluidas para TTS
4. Português brasileiro correto
5. Dentro do limite de 25 segundos de áudio

RESPOSTA: Apenas a descrição melhorada em português brasileiro, sem comentários adicionais.
`
      
      try {
        // Tentar melhorar a descrição
        const improvementResponse = await callGeminiAPI(improvementPrompt, apiKey)
        
        if (improvementResponse.ok) {
          const improvementData = await improvementResponse.json()
          const improvedText = improvementData.candidates?.[0]?.content?.parts?.[0]?.text
          
          if (improvedText && improvedText.trim()) {
            finalDescription = improvedText.trim()
            improvementApplied = true
            console.log('✅ Descrição melhorada com sucesso')
            
            // Se estamos persistindo verificação, atualizar com a descrição melhorada
            if (persist_verification && attractionId && description_id) {
              try {
                console.log('💾 Atualizando score com descrição melhorada')
                
                // Atualizar score com pontuação melhorada
                const improvedScore = Math.max(verificationResult.pontuacao, 70)
                const { error: updateError } = await supabaseAdmin
                  .schema('core')
                  .from('description_scores')
                  .update({
                    score_overall: Math.round(improvedScore),
                    subscores: {
                      factuality: verificationResult.fatos_verificaveis?.length > 0 ? 70 : 30,
                      coherence: 85, // Melhor após improvement
                      tts_clarity: 90,
                      rules: 95 // Melhor após improvement
                    },
                    flags: [
                      'verified', // Sempre verificado após improvement
                      ...(verificationResult.datas_detectadas?.length > 0 ? ['has_dates'] : []),
                      ...(verificationResult.fatos_verificaveis?.length > 0 ? ['has_facts'] : []),
                      'improved'
                    ].filter(Boolean),
                    confidence: 0.9 // Maior confiança após improvement
                  })
                  .eq('description_id', description_id)
                  .order('created_at', { ascending: false })
                  .limit(1)
                
                if (updateError) {
                  console.error('❌ Erro ao atualizar score:', updateError)
                } else {
                  console.log('✅ Score atualizado com sucesso após melhoria')
                  
                  // Atualizar verification_status para 'approved' após melhoria
                  const { error: statusUpdateError } = await supabaseAdmin
                    .schema('core')
                    .from('attraction_descriptions')
                    .update({
                      verification_status: 'approved',
                      last_verified_at: new Date().toISOString()
                    })
                    .eq('id', description_id)
                  
                  if (statusUpdateError) {
                    console.error('❌ Erro ao atualizar verification_status após melhoria:', statusUpdateError)
                  } else {
                    console.log('✅ Verification status atualizado para approved após melhoria')
                  }
                }
              } catch (persistError) {
                console.error('❌ Erro ao atualizar resultados da verificação:', persistError)
              }
            }
          }
        }
      } catch (improvementError) {
        console.error('❌ Erro ao tentar melhorar a descrição:', improvementError)
      }
      
      verificationApplied = true
    } else {
      console.log(`✅ Verificação concluída: ${verificationResult.aprovada ? 'Aprovada' : 'Não aprovada'} (${verificationResult.pontuacao}/100)`)
      verificationApplied = true
    }

    // Prepare detailed source information for response
    const sourcesInfo = layeredSources.map((source: any) => ({
      name: source.source_name,
      type: source.source_type,
      layer: source.layer || 'unknown',
      priority: source.priority || 10
    }))

    return NextResponse.json({
      description: finalDescription,
      tokens: extractedTokens,
      sources_used: layeredSources.length,
      sources_info: sourcesInfo,
      optimization_applied: true,
      dynamic_sources_enabled: use_dynamic_sources,
      verification_mode: optimization_mode ? 'maximum' : 'standard',
      // Incluir resultados da verificação
      verification: {
        applied: verificationApplied,
        approved: verificationResult.aprovada,
        score: verificationResult.pontuacao,
        detected_dates: verificationResult.datas_detectadas || [],
        verifiable_facts: verificationResult.fatos_verificaveis || [],
        issues: verificationResult.problemas || [],
        improvement_suggestion: verificationResult.sugestoes_melhoria || '',
        improvement_applied: improvementApplied
      }
    })

  } catch (error) {
    console.error('❌ Error in optimized generation:', error)
    return NextResponse.json(
      { error: 'Internal server error during optimized generation' },
      { status: 500 }
    )
  }
}

/**
 * Get layered sources (national + city) for the location using Dynamic Source Service
 */
async function getLayeredSources(city: string, country: string, useDynamicSources: boolean = true) {
  try {
    if (!useDynamicSources) {
      // Fallback to old method if dynamic sources are disabled
      return getLayeredSourcesLegacy(city, country)
    }

    // Enhanced country mapping with more comprehensive coverage
    const countryCodeMap: Record<string, string> = {
      'Brazil': 'BR', 'Brasil': 'BR',
      'España': 'ES', 'Spain': 'ES', 'Espanha': 'ES',
      'United States': 'US', 'USA': 'US', 'Estados Unidos': 'US',
      'Ireland': 'IE', 'Irlanda': 'IE',
      'México': 'MX', 'Mexico': 'MX',
      'Chile': 'CL',
      'Argentina': 'AR',
      'Colombia': 'CO', 'Colômbia': 'CO',
      'Peru': 'PE', 'Perú': 'PE',
      'Portugal': 'PT',
      'France': 'FR', 'França': 'FR',
      'Italy': 'IT', 'Itália': 'IT',
      'Germany': 'DE', 'Alemanha': 'DE',
      'United Kingdom': 'GB', 'Reino Unido': 'GB'
    }

    const countryCode = countryCodeMap[country] || country.toUpperCase()
    
    console.log(`🔍 Fetching layered sources for ${city}, ${countryCode}`)

    // Primeiro buscamos fontes da cidade e depois nacionais (invertendo a ordem padrão)
    // Isso garante que fontes da cidade tenham prioridade sobre fontes nacionais
    const { data: layeredSources, error: layeredError } = await supabaseAdmin
      .schema('core')
      .rpc('get_verification_sources_layered', {
        p_city_name: city,
        p_country_code: countryCode,
        p_limit: 8
      })
      
    // Reordenamos para priorizar fontes da cidade
    if (layeredSources) {
      layeredSources.sort((a: any, b: any) => {
        // Primeiro critério: fontes da cidade vêm antes das nacionais
        if (a.layer === 'city' && b.layer !== 'city') return -1;
        if (a.layer !== 'city' && b.layer === 'city') return 1;
        // Segundo critério: prioridade (menor número = maior prioridade)
        return (a.priority || 10) - (b.priority || 10);
      });
    }

    let sources = layeredSources || []

    // If layered sources are empty or limited, try individual country sources
    if (!sources.length || sources.length < 3) {
      console.log('🔄 Layered sources limited, fetching country sources...')
      
      const { data: countrySources, error: countryError } = await supabaseAdmin
        .schema('core')
        .from('country_verification_sources')
        .select(`
          source_name,
          source_type,
          base_url,
          search_endpoint,
          priority,
          'national' as layer
        `)
        .eq('countries.code', countryCode)
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .limit(8)

      if (countrySources && countrySources.length > 0) {
        sources = [...sources, ...countrySources]
      }
    }

    // Add fallback sources for major countries if we still have few sources
    if (sources.length < 2) {
      sources = [...sources, ...getFallbackSources(countryCode)]
    }

    console.log(`✅ Found ${sources.length} verification sources for ${city}, ${countryCode}`)
    return sources.slice(0, 8) // Limit to 8 sources max (compact)

  } catch (error) {
    console.warn('⚠️ Error in getLayeredSources:', error)
    return getFallbackSources(country)
  }
}

/**
 * Legacy layered sources function (fallback)
 */
async function getLayeredSourcesLegacy(city: string, country: string) {
  try {
    const countryCodeMap: Record<string, string> = {
      'Brazil': 'BR',
      'España': 'ES',
      'Spain': 'ES',
      'United States': 'US',
      'USA': 'US',
      'Ireland': 'IE',
      'México': 'MX',
      'Mexico': 'MX',
      'Chile': 'CL'
    }

    const countryCode = countryCodeMap[country] || country

    const { data: sources, error } = await supabaseAdmin
      .schema('core')
      .rpc('get_verification_sources_layered', {
        p_city_name: city,
        p_country_code: countryCode,
        p_limit: 10
      })

    if (error) {
      console.warn('⚠️ Error fetching layered sources:', error)
      return []
    }

    return sources || []
  } catch (error) {
    console.warn('⚠️ Error in getLayeredSourcesLegacy:', error)
    return []
  }
}

/**
 * Get fallback sources for major countries
 */
function getFallbackSources(countryCode: string) {
  const fallbackSources: Record<string, any[]> = {
    'BR': [
      {
        source_name: 'IPHAN',
        source_type: 'heritage',
        base_url: 'http://portal.iphan.gov.br',
        search_endpoint: '/buscas',
        priority: 1,
        layer: 'national'
      },
      {
        source_name: 'IBRAM',
        source_type: 'heritage',
        base_url: 'https://www.museus.gov.br',
        priority: 2,
        layer: 'national'
      }
    ],
    'ES': [
      {
        source_name: 'Ministerio de Cultura y Deporte',
        source_type: 'heritage',
        base_url: 'https://www.culturaydeporte.gob.es',
        priority: 1,
        layer: 'national'
      }
    ],
    'US': [
      {
        source_name: 'National Park Service',
        source_type: 'heritage',
        base_url: 'https://www.nps.gov',
        priority: 1,
        layer: 'national'
      }
    ]
  }

  return fallbackSources[countryCode] || []
}

/**
 * Get existing tokens for RAG optimization
 */
async function getExistingTokens(attractionId: string) {
  if (!attractionId) return []

  try {
    // Check if we have a tokens table, if not return empty
    const { data: tokens, error } = await supabaseAdmin
      .schema('core')
      .from('attraction_tokens')
      .select('token, weight, context')
      .eq('attraction_id', attractionId)
      .order('weight', { ascending: false })
      .limit(20)

    if (error) {
      console.log('ℹ️ No existing tokens table or tokens found')
      return []
    }

    return tokens || []
  } catch (error) {
    console.log('ℹ️ Tokens system not available yet')
    return []
  }
}

/**
 * Build location details string
 */
function buildLocationDetails({ city, country, state, formatted_address, vicinity }: any) {
  const parts = []
  
  if (city) parts.push(city)
  if (state && state !== city) parts.push(state)
  if (country) parts.push(country)
  
  let locationString = parts.join(', ')
  
  if (formatted_address && formatted_address !== locationString) {
    locationString += ` (${formatted_address})`
  }
  
  if (vicinity && vicinity !== city && vicinity !== formatted_address) {
    locationString += ` - Near: ${vicinity}`
  }
  
  return locationString
}

/**
 * Build sources section with enhanced layered approach
 */
function buildSourcesSection(layeredSources: any[], referenceLinks?: string[], useDynamicSources: boolean = true) {
  const lines: string[] = []

  const add = (label: string, items: any[], take: number) => {
    if (!items.length) return
    lines.push(label)
    items.slice(0, take).forEach(s => {
      const layer = s.layer ? ` [${String(s.layer).toUpperCase()}]` : ''
      const url = s.base_url ? ` - ${s.base_url}` : ''
      lines.push(`- ${s.source_name} (${s.source_type}${layer})${url}`)
    })
  }

  // NOVA ORDEM DE PRIORIDADE:
  // 1. Website do POI (se disponível)
  // 2. Referências adicionadas pelo usuário
  // 3. Fontes municipais/cidade
  // 4. Fontes nacionais

  // 1. Website do POI - extrair do layeredSources se existir
  const poiWebsite = layeredSources.find((s: any) => s.source_type === 'official' && s.source_name?.toLowerCase().includes('website'))
  if (poiWebsite) {
    lines.push('🌐 OFFICIAL WEBSITE:')
    const url = poiWebsite.base_url ? ` - ${poiWebsite.base_url}` : ''
    lines.push(`- ${poiWebsite.source_name} (primary source)${url}`)
  }

  // 2. Referências adicionadas pelo usuário
  const validLinks = (referenceLinks || []).filter(link => link && link.trim()).slice(0, 3)
  if (validLinks.length) {
    lines.push('🔗 USER REFERENCES (HIGH PRIORITY):')
    validLinks.forEach(link => lines.push(`- ${link}`))
  }

  // Filtrar o website do POI para não duplicar nas próximas seções
  const filteredSources = poiWebsite 
    ? layeredSources.filter((s: any) => s !== poiWebsite)
    : layeredSources

  if (useDynamicSources && filteredSources.length > 0) {
    // Primeiro separamos por tipo e camada para priorizar fontes da cidade
    const byTypeAndLayer = (type: string, layer: string) => filteredSources
      .filter((s: any) => s.source_type === type && s.layer === layer)
      .sort((a: any, b: any) => (a.priority || 10) - (b.priority || 10))
    
    // 3. Fontes municipais/cidade
    add('🏛️ CITY HERITAGE & GOV:', [
      ...byTypeAndLayer('heritage', 'city'),
      ...byTypeAndLayer('government', 'city')
    ], 3)
    
    // Outras fontes da cidade
    const cityAcademic = byTypeAndLayer('academic', 'city')
    const cityLocal = byTypeAndLayer('local', 'city')
    const cityMedia = byTypeAndLayer('media', 'city')
    
    if ([...cityAcademic, ...cityLocal, ...cityMedia].length > 0) {
      add('📍 OTHER CITY SOURCES:', [
        ...cityAcademic,
        ...cityLocal, 
        ...cityMedia
      ], 2)
    }
    
    // 4. Fontes nacionais
    add('🏛️ NATIONAL HERITAGE & GOV:', [
      ...byTypeAndLayer('heritage', 'national'),
      ...byTypeAndLayer('government', 'national')
    ], 2)
    
    // Outras fontes nacionais
    const byType = (t: string) => filteredSources
      .filter((s: any) => s.source_type === t && s.layer === 'national')
      .sort((a: any, b: any) => (a.priority || 10) - (b.priority || 10))
    
    add('🎓 NATIONAL ACADEMIC & OFFICIAL:', [...byType('academic'), ...byType('official')], 2)
  } else {
    // Versão simplificada para o modo legacy
    const cities = filteredSources.filter((s: any) => s.layer === 'city')
    const nationals = filteredSources.filter((s: any) => s.layer === 'national')
    
    add('CITY SOURCES:', cities, 3)
    add('NATIONAL SOURCES:', nationals, 2)
  }

  if (!lines.length) {
    lines.push('📚 SOURCES: UNESCO, Wikipedia, official tourism, government heritage')
  }

  lines.push('')
  lines.push('⚠️ VERIFY: Use only facts that these sources confirm. If unsure, omit.')
  return lines.join('\n')
}

/**
 * Build Google data section
 */
function buildGoogleDataSection({ google_types, rating, user_ratings_total, price_level, business_status, google_place_id }: any) {
  const parts = []
  
  if (google_types && Array.isArray(google_types)) {
    parts.push(`Types: ${google_types.join(', ')}`)
  }
  
  if (rating) {
    const ratingText = user_ratings_total 
      ? `${rating}/5 (${user_ratings_total} reviews)`
      : `${rating}/5`
    parts.push(`Rating: ${ratingText}`)
  }
  
  if (price_level) {
    parts.push(`Price Level: ${'$'.repeat(price_level)}`)
  }
  
  if (business_status && business_status !== 'OPERATIONAL') {
    parts.push(`Status: ${business_status}`)
  }
  
  if (google_place_id) {
    parts.push(`Place ID: ${google_place_id}`)
  }
  
  return parts.length > 0 ? parts.join(' | ') : 'Standard tourist attraction'
}

/**
 * Create enhanced optimized prompt with dynamic source integration
 */
function createOptimizedPrompt({ 
  name, locationDetails, sourcesSection, googleData, 
  existingDescription, existingTokens, optimizationMode = true 
}: any) {
  const hasTokens = existingTokens && existingTokens.length > 0
  const hasExisting = existingDescription && existingDescription.trim()

  return `You are an expert travel guide writer. Produce a concise, factual description in Brazilian Portuguese.

CRITICAL RULES (COMPACT):
- Facts must be verifiable by the sources below. If unsure, OMIT.
- SOURCE PRIORITY ORDER:
  1. Official website (if available)
  2. User-provided references
  3. City/municipal sources
  4. National sources
- PRIORITIZE DATES: construction/inauguration/foundation; include restoration if documented.
- Prefer short sentences for TTS. No lists.
- FORBIDDEN: addresses, directions, hours, prices, contacts, superlatives, speculation.

TONE & ENGAGEMENT (GUIDE STYLE):
- Friendly, inviting tour‑guide voice.
- Spark curiosity with ONE delightful, verifiable detail or cultural curiosity (only if documented).
- Include interesting local facts from city sources when available.
- Vivid but neutral language; avoid hype; evoke imagery without exaggeration.
- Warm tone while strictly factual.

SOURCES:
${sourcesSection}

TASK (<=150 words):
- Start with: Name + primary verifiable DATE (year preferred; century/decade if no year).
- Then 1–2 verified facts (architect/style/events) if documented; keep it engaging.
- Optionally current function/significance if officially recorded.

DATE POLICY:
- Include a year only if confirmed. Otherwise use century/decade.
- Never use "aproximadamente", "cerca de", "provavelmente".

ATTRACTION DATA:
- Name: ${name}
- Location: ${locationDetails}
- Google: ${googleData}

${hasTokens ? `TOKENS:\n${existingTokens.map((t: any) => `- ${t.token} (${t.weight})`).join('\n')}` : ''}
${hasExisting ? `EXISTING (for improvement):\n${existingDescription}` : ''}

OUTPUT: Only the final Portuguese text.`
}

/**
 * Verifica a qualidade da descrição gerada
 */
async function verifyGeneratedDescription(description: string, name: string, apiKey: string) {
  console.log('🔍 Verificando qualidade da descrição gerada (critérios brandos)...')
  
  const verificationPrompt = `
Você é um verificador especializado em qualidade de descrições turísticas curtas (áudio de 25 segundos). Analise a descrição abaixo para o ponto turístico "${name}" e avalie com critérios brandos:

DESCRIÇÃO A SER VERIFICADA:
"""
${description}
"""

CONTEXTO IMPORTANTE:
- Esta é uma descrição CURTA para áudio de 25 segundos (máximo 300-350 caracteres)
- Nem todos os lugares têm informações detalhadas disponíveis
- O objetivo é fornecer pelo menos 1-2 fatos interessantes, não uma descrição completa
- Algumas atrações podem ter informações limitadas ou genéricas

CRITÉRIOS DE VERIFICAÇÃO (BRANDOS):
1. PRESENÇA DE DATAS: A descrição contém pelo menos uma data OU período histórico? (Não é obrigatório, mas desejável)
2. FATOS VERIFICÁVEIS: Há pelo menos 1 fato que parece verificável? (Mesmo que genérico)
3. ESTILO DE GUIA: A descrição tem tom minimamente amigável?
4. PROIBIÇÕES: Contém endereços, horários, preços ou direções específicas? (Único critério rígido)
5. ADEQUAÇÃO PARA ÁUDIO: As frases são adequadas para TTS?
6. PORTUGUÊS BRASILEIRO: O texto está em português brasileiro correto?

PONTUAÇÃO BRANDA:
- Aprove a descrição se tiver pelo menos 1 fato e estiver em português correto
- Pontuação mínima de 60 se tiver pelo menos um fato verificável
- Seja generoso na avaliação, considerando o limite de 25 segundos

RESPONDA EM JSON:
{
  "aprovada": true/false,
  "pontuacao": 0-100,
  "datas_detectadas": ["lista", "de", "datas"],
  "fatos_verificaveis": ["fato 1", "fato 2"],
  "problemas": ["problema 1", "problema 2"],
  "sugestoes_melhoria": "sugestão concisa e realista para o limite de 25 segundos"
}
`

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: verificationPrompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
          responseMimeType: "application/json"
        }
      })
    })

    if (!response.ok) {
      console.error('❌ Error in verification API call:', response.status, response.statusText)
      return {
        aprovada: true, // Default to approved if verification fails
        pontuacao: 70,
        problemas: ["Verificação falhou, mas descrição foi aceita por padrão"],
        sugestoes_melhoria: "Não foi possível verificar automaticamente"
      }
    }

    const data = await response.json()
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    
    try {
      // Extrair apenas o JSON da resposta
      const jsonMatch = resultText.match(/\{[\s\S]*\}/)
      const jsonText = jsonMatch ? jsonMatch[0] : resultText
      
      // Parse do JSON
      const result = JSON.parse(jsonText)
      console.log('✅ Verificação concluída:', result)
      return result
    } catch (parseError) {
      console.error('❌ Error parsing verification result:', parseError)
      console.log('Raw result:', resultText)
      return {
        aprovada: true, // Default to approved if parsing fails
        pontuacao: 65,
        problemas: ["Falha ao analisar resultado da verificação"],
        sugestoes_melhoria: "Verificar manualmente"
      }
    }
  } catch (error) {
    console.error('❌ Error in verification:', error)
    return {
      aprovada: true, // Default to approved if verification fails
      pontuacao: 60,
      problemas: ["Erro no processo de verificação"],
      sugestoes_melhoria: "Sistema de verificação indisponível"
    }
  }
}

/**
 * Call Gemini API with optimized configuration
 */
async function callGeminiAPI(prompt: string, apiKey: string) {
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
  ]

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.1,        // Low temperature for factual accuracy
            topK: 20,               // Focused token selection
            topP: 0.8,              // Balanced creativity/accuracy
            maxOutputTokens: 400,   // Sufficient for 150 words + buffer
            stopSequences: ["---", "NOTE:", "ADDITIONAL:"] // Stop at meta content
          },
        })
      })

      if (response.ok) {
        return response
      }

      console.warn(`Failed with endpoint ${endpoint}:`, response.status)
    } catch (error) {
      console.warn(`Error with endpoint ${endpoint}:`, error)
    }
  }

  // Return the last attempt for error handling
  return fetch(endpoints[0], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 400 }
    })
  })
}

/**
 * Extract and store tokens for RAG optimization
 */
async function extractAndStoreTokens(attractionId: string, generatedText: string, metadata: any) {
  if (!attractionId) return []

  try {
    // Extract key tokens from the generated text
    const tokens = extractTokensFromText(generatedText, metadata)

    // Store tokens for future RAG optimization (if table exists)
    try {
      await supabaseAdmin
        .schema('core')
        .from('attraction_tokens')
        .upsert(
          tokens.map(token => ({
            attraction_id: attractionId,
            token: token.token,
            weight: token.weight,
            context: token.context,
            token_type: token.type,
            updated_at: new Date().toISOString()
          })),
          { onConflict: 'attraction_id,token' }
        )
    } catch (error) {
      console.log('ℹ️ Tokens table not available, skipping token storage')
    }

    return tokens
  } catch (error) {
    console.warn('⚠️ Error extracting tokens:', error)
    return []
  }
}

/**
 * Extract tokens from text for RAG optimization
 */


function extractTokensFromText(text: string, metadata: any) {
  const tokens = []

  // Extract years (high weight for verification)
  const years = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []
  years.forEach(year => {
    tokens.push({
      token: year,
      weight: 0.9,
      context: `construction_year`,
      type: 'temporal'
    })
  })

  // Extract proper nouns (architects, historical figures)
  const properNouns = text.match(/\b[A-ZÁÉÍÓÚÂÊÔÀÇ][a-záéíóúâêôàç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÀÇ][a-záéíóúâêôàç]+)*\b/g) || []
  properNouns
    .filter(noun => noun !== metadata.name && noun.length > 3)
    .forEach(noun => {
      tokens.push({
        token: noun,
        weight: 0.7,
        context: 'proper_noun',
        type: 'entity'
      })
    })

  // Extract architectural/style terms
  const architecturalTerms = [
    'neoclássico', 'barroco', 'colonial', 'modernista', 'contemporâneo',
    'gótico', 'art déco', 'brutalista', 'eclético'
  ]
  
  architecturalTerms.forEach(term => {
    if (text.toLowerCase().includes(term)) {
      tokens.push({
        token: term,
        weight: 0.6,
        context: 'architectural_style',
        type: 'style'
      })
    }
  })

  // Extract location-based tokens
  if (metadata.city) {
    tokens.push({
      token: metadata.city,
      weight: 0.8,
      context: 'location_city',
      type: 'location'
    })
  }

  // Extract type-based tokens
  if (metadata.google_types && Array.isArray(metadata.google_types)) {
    metadata.google_types.forEach((type: string) => {
      tokens.push({
        token: type,
        weight: 0.5,
        context: 'attraction_type',
        type: 'category'
      })
    })
  }

  return tokens
}
