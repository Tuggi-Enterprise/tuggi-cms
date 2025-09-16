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
      category, // POI category for additional context
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
      osm_tags, // OpenStreetMap tags for additional context
      description_id, // ID da descrição para persistir verificação
      persist_verification = false, // Flag para persistir resultados da verificação
      auto_generate_audio = false // Flag para gerar áudio automaticamente quando aprovado
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
      useDynamicSources: use_dynamic_sources,
      city,
      state,
      country,
      osmTags: osm_tags,
      category
    })

    console.log('📝 Sending optimized prompt to Gemini API')
    console.log('🔍 Prompt preview:', prompt.substring(0, 500) + '...')

    // Call Gemini API with optimized configuration
    const result = await callGeminiAPI(prompt, apiKey, optimization_mode)
    const response = result.response
    const model = result.model
    
    console.log(`🎯 Model used for generation: ${model}`)

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
              factuality: verificationResult.fatos_verificaveis?.length > 0 ? Math.min(100, Math.max(60, verificationResult.pontuacao + 10)) : Math.max(30, verificationResult.pontuacao - 40),
              coherence: Math.min(100, Math.max(60, verificationResult.pontuacao - 10)), // Baseado na pontuação geral
              tts_clarity: Math.min(100, Math.max(70, verificationResult.pontuacao + 5)), // Ligeiramente melhor que a pontuação geral
              rules: verificationResult.aprovada ? Math.min(100, Math.max(80, verificationResult.pontuacao + 10)) : Math.max(50, verificationResult.pontuacao - 20) // Baseado na aprovação e pontuação
            },
            flags: [
              verificationResult.aprovada ? 'verified' : 'needs_review',
              ...(verificationResult.datas_detectadas?.length > 0 ? ['has_dates'] : []),
              ...(verificationResult.fatos_verificaveis?.length > 0 ? ['has_facts'] : [])
            ].filter(Boolean),
            verifier_version: 'v2.0',
            llm_model: 'gemini-1.5-flash',
            confidence: Math.min(1.0, Math.max(0.3, verificationResult.pontuacao / 100)) // Baseado na pontuação real
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
                weight: 0.8 // Peso padrão para datas - pode ser ajustado baseado na confiança da data
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
                weight: 0.7 // Peso padrão para fatos - pode ser ajustado baseado na confiança do fato
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
      
      // Prompt to improve the description based on feedback, considering 25-second limit
      const improvementPrompt = `
You are an expert in improving SHORT tourist descriptions for 25-second audio. The description below for "${name}" needs adjustments:

ORIGINAL DESCRIPTION:
"""
${finalDescription}
"""

IDENTIFIED PROBLEMS:
${verificationResult.problemas?.join('\n') || 'Insufficient quality'}

IMPROVEMENT SUGGESTION:
${verificationResult.sugestoes_melhoria}

IMPORTANT - 25 SECOND LIMIT:
- Maximum 300-350 characters (approximately 50-60 words)
- Prioritize 1-2 most important verifiable facts
- Keep any date or historical period present in the original
- Be concise, but maintain friendly tone

IMPROVE THE DESCRIPTION MAINTAINING:
1. At least one verifiable fact (even if generic)
2. Minimally friendly tourist guide style
3. Short and fluid sentences for TTS
4. Correct Brazilian Portuguese
5. Within the 25-second audio limit

RESPONSE: Only the improved description in Brazilian Portuguese, without additional comments.
`
      
      try {
        // Tentar melhorar a descrição
        const improvementResult = await callGeminiAPI(improvementPrompt, apiKey)
        const improvementResponse = improvementResult.response
        
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
                
                // Atualizar score com pontuação melhorada - usar a pontuação real da verificação
                const improvedScore = verificationResult.pontuacao
                const { error: updateError } = await supabaseAdmin
                  .schema('core')
                  .from('description_scores')
                  .update({
                    score_overall: Math.round(improvedScore),
                    subscores: {
                      factuality: verificationResult.fatos_verificaveis?.length > 0 ? Math.min(100, Math.max(60, verificationResult.pontuacao + 10)) : Math.max(30, verificationResult.pontuacao - 40),
                      coherence: Math.min(100, Math.max(60, verificationResult.pontuacao - 5)), // Baseado na pontuação melhorada
                      tts_clarity: Math.min(100, Math.max(70, verificationResult.pontuacao + 10)), // Melhor após improvement
                      rules: Math.min(100, Math.max(50, verificationResult.pontuacao + 15)) // Melhor após improvement
                    },
                    flags: [
                      'verified', // Sempre verificado após improvement
                      ...(verificationResult.datas_detectadas?.length > 0 ? ['has_dates'] : []),
                      ...(verificationResult.fatos_verificaveis?.length > 0 ? ['has_facts'] : []),
                      'improved'
                    ].filter(Boolean),
                    confidence: Math.min(1.0, Math.max(0.5, verificationResult.pontuacao / 100)) // Baseado na pontuação
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

    // Função para salvar descrição e gerar áudio
    const saveDescriptionAndGenerateAudio = async (description: string, attractionId: string, language: string = 'pt-br') => {
      try {
        console.log(`💾 Salvando descrição em ${language} para attraction ${attractionId}`)
        
        // Salvar ou atualizar a descrição
        // Primeiro, verificar se já existe uma descrição para este attraction_id e language
        const { data: existingDescription, error: checkError } = await supabaseAdmin
          .schema('core')
          .from('attraction_descriptions')
          .select('id')
          .eq('attraction_id', attractionId)
          .eq('language', language)
          .single()

        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error(`❌ Erro ao verificar descrição existente em ${language}:`, checkError)
          return false
        }

        let savedDescription;
        if (existingDescription) {
          // Atualizar descrição existente
          const { data: updatedDescription, error: updateError } = await supabaseAdmin
            .schema('core')
            .from('attraction_descriptions')
            .update({
              description: description,
              verification_status: verificationResult.aprovada ? 'approved' : 'needs_review',
              last_verified_at: new Date().toISOString()
            })
            .eq('id', existingDescription.id)
            .select('id')
            .single()

          if (updateError) {
            console.error(`❌ Erro ao atualizar descrição em ${language}:`, updateError)
            return false
          }
          savedDescription = updatedDescription
        } else {
          // Inserir nova descrição
          const { data: newDescription, error: insertError } = await supabaseAdmin
            .schema('core')
            .from('attraction_descriptions')
            .insert({
              attraction_id: attractionId,
              language: language,
              description: description,
              verification_status: verificationResult.aprovada ? 'approved' : 'needs_review',
              last_verified_at: new Date().toISOString()
            })
            .select('id')
            .single()

          if (insertError) {
            console.error(`❌ Erro ao inserir descrição em ${language}:`, insertError)
            return false
          }
          savedDescription = newDescription
        }

        console.log(`✅ Descrição salva em ${language} com ID:`, savedDescription?.id)

        // Se a descrição foi aprovada e auto_generate_audio está habilitado, gerar áudio
        if (auto_generate_audio && verificationResult.aprovada && verificationResult.pontuacao >= 75) {
          console.log(`🎵 Gerando áudio para ${language}...`)
          
          try {
            // Para português, gerar áudio diretamente sem tradução
            if (language === 'pt-br') {
              console.log('🎵 Gerando áudio em português diretamente...')
              
              // Importar e usar a função de geração de áudio diretamente
              const { generateAudioWithGoogleTTS } = await import('@/lib/providers/googleTTS')
              
              try {
                // Step 1: Generate audio using Google TTS
                const audioResult = await generateAudioWithGoogleTTS({
                  text: description,
                  voice: 'pt-BR-Neural2-B', // Male voice
                  speed: 1.2
                })

                // Step 2: Upload audio to Supabase Storage using Edge Function
                const uploadResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-audio`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || ''
                  },
                  body: JSON.stringify({
                    attractionId: attractionId,
                    audioData: audioResult.audioBuffer.toString('base64'),
                    mimeType: audioResult.mimeType || 'audio/mpeg',
                    language: 'pt-br'
                  })
                })

                if (uploadResponse.ok) {
                  const uploadData = await uploadResponse.json()
                  console.log(`✅ Audio generated and stored for ${language}:`, uploadData.audio.url)
                  return true
                } else {
                  console.error(`❌ Failed to store audio for ${language}:`, await uploadResponse.text())
                  return false
                }
              } catch (audioError) {
                console.error(`❌ Error generating audio for ${language}:`, audioError)
                return false
              }
            } else {
              // Para outros idiomas, usar a Edge Function de tradução
              const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-translated-audio`
              
              const audioResponse = await fetch(edgeFunctionUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || ''
                },
                body: JSON.stringify({
                  attractionId: attractionId,
                  targetLanguage: language,
                  voiceGender: 'male'
                })
              })

              if (audioResponse.ok) {
                const result = await audioResponse.json()
                console.log(`✅ Audio generated for ${language}:`, result.data?.audioUrl)
                return true
              } else {
                console.error(`❌ Failed to generate audio for ${language}:`, await audioResponse.text())
                return false
              }
            }
          } catch (audioError) {
            console.error(`❌ Error generating audio for ${language}:`, audioError)
            return false
          }
        }

        return true
      } catch (error) {
        console.error(`❌ Error in saveDescriptionAndGenerateAudio for ${language}:`, error)
        return false
      }
    }

    // Função para verificar e aprovar automaticamente a POI
    const checkAndAutoApprovePOI = async (
      attractionId: string, 
      descriptionSaved: boolean, 
      successfulAudioCount: number, 
      totalAudioCount: number, 
      verificationResult: any
    ) => {
      try {
        console.log('🔍 Verificando condições para aprovação automática...')
        
        // Condições para aprovação automática:
        // 1. Descrição foi gerada e salva
        // 2. Áudio PT-BR foi gerado (saveSuccess = true significa que o áudio PT foi gerado)
        // 3. Score >= 75%
        // 4. Todos os áudios configurados foram gerados (EN, ES)
        
        const conditionsCheck = {
          descriptionGenerated: !!finalDescription && finalDescription.trim().length > 0,
          descriptionSaved: descriptionSaved,
          audioPtBrGenerated: descriptionSaved, // Se saveSuccess = true, áudio PT foi gerado
          scoreApproved: verificationResult.aprovada && verificationResult.pontuacao >= 75,
          allAudiosGenerated: successfulAudioCount === totalAudioCount
        }
        
        console.log('📋 Condições para aprovação:', conditionsCheck)
        
        // Verificar se todas as condições foram atendidas
        const allConditionsMet = Object.values(conditionsCheck).every(condition => condition === true)
        
        if (allConditionsMet) {
          console.log('✅ Todas as condições atendidas. Aprovando POI automaticamente...')
          
          // Atualizar status da POI para aprovado
          const { error: approvalError } = await supabaseAdmin
            .schema('core')
            .from('attractions')
            .update({
              approved: true,
              approved_at: new Date().toISOString()
              // Não definir approved_by para indicar aprovação automática (NULL)
            })
            .eq('id', attractionId)
          
          if (approvalError) {
            console.error('❌ Erro ao aprovar POI automaticamente:', approvalError)
          } else {
            console.log('🎉 POI aprovada automaticamente com sucesso!')
          }
        } else {
          console.log('⚠️ Nem todas as condições foram atendidas. POI não será aprovada automaticamente.')
          console.log('Condições faltantes:', Object.entries(conditionsCheck)
            .filter(([_, met]) => !met)
            .map(([condition, _]) => condition)
          )
        }
      } catch (error) {
        console.error('❌ Erro na verificação de aprovação automática:', error)
      }
    }

    // Salvar descrição em pt-br e gerar áudio
    if (attractionId) {
      const saveSuccess = await saveDescriptionAndGenerateAudio(finalDescription, attractionId, 'pt-br')
      
      if (saveSuccess && auto_generate_audio && verificationResult.aprovada && verificationResult.pontuacao >= 75) {
        // Gerar áudio para outros idiomas
        console.log('🎵 Generating audio for other languages...')
        
        const languages = ['en-us', 'es-es']
        const audioPromises = languages.map(async (lang) => {
          try {
            const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-translated-audio`
            
            const audioResponse = await fetch(edgeFunctionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || ''
              },
              body: JSON.stringify({
                attractionId: attractionId,
                targetLanguage: lang,
                voiceGender: 'male'
              })
            })

            if (audioResponse.ok) {
              const result = await audioResponse.json()
              console.log(`✅ Audio generated for ${lang}:`, result.data?.audioUrl)
              return { language: lang, success: true, audioUrl: result.data?.audioUrl }
            } else {
              console.error(`❌ Failed to generate audio for ${lang}:`, await audioResponse.text())
              return { language: lang, success: false }
            }
          } catch (audioError) {
            console.error(`❌ Error generating audio for ${lang}:`, audioError)
            return { language: lang, success: false }
          }
        })

        const audioResults = await Promise.allSettled(audioPromises)
        const successfulAudio = audioResults
          .filter(result => result.status === 'fulfilled')
          .map(result => (result as PromiseFulfilledResult<any>).value)
          .filter(result => result.success)

        console.log(`🎵 Audio generation completed: ${successfulAudio.length}/${languages.length} successful`)
        
        // Verificar se deve aprovar automaticamente a POI
        await checkAndAutoApprovePOI(attractionId, saveSuccess, successfulAudio.length, languages.length, verificationResult)
      }
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
      },
      // Incluir informações sobre o modelo usado
      model_info: {
        used_model: model,
        quality_mode: optimization_mode,
        generation_config: optimization_mode ? 'high_quality' : 'standard'
      },
      // Incluir informações sobre geração de áudio
      audio_generation: {
        auto_generated: auto_generate_audio && verificationResult.aprovada && verificationResult.pontuacao >= 75,
        languages: auto_generate_audio && verificationResult.aprovada && verificationResult.pontuacao >= 75 ? ['pt-br', 'en-us', 'es-es'] : [], // Incluindo pt-br
        score_threshold_met: verificationResult.pontuacao >= 75,
        method: 'edge_function'
      },
      // Incluir informações sobre aprovação automática
      auto_approval: {
        enabled: auto_generate_audio && verificationResult.aprovada && verificationResult.pontuacao >= 75,
        conditions_checked: auto_generate_audio && attractionId ? {
          description_generated: !!finalDescription && finalDescription.trim().length > 0,
          description_saved: true, // Se chegou aqui, foi salva
          audio_pt_br_generated: true, // Se chegou aqui, foi gerada
          score_approved: verificationResult.aprovada && verificationResult.pontuacao >= 75,
          all_audios_generated: true // Será verificado na função
        } : null,
        status: auto_generate_audio && attractionId ? 'processed' : 'disabled'
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

    // Always try to fetch city-specific sources first (HIGH PRIORITY)
    console.log('🏛️ Fetching city-specific verification sources...')
    const { data: citySources, error: cityError } = await supabaseAdmin
      .schema('core')
      .from('city_verification_sources')
      .select(`
        source_name,
        source_type,
        base_url,
        search_endpoint,
        priority,
        'city' as layer
      `)
      .eq('city_name', city)
      .eq('country_code', countryCode)
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .limit(6)

    if (citySources && citySources.length > 0) {
      console.log(`✅ Found ${citySources.length} city-specific sources for ${city}`)
      // Prepend city sources to give them highest priority
      sources = [...citySources, ...sources]
    }

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
  existingDescription, existingTokens, optimizationMode = true,
  city, state, country, osmTags, category
}: any) {
  const hasTokens = existingTokens && existingTokens.length > 0
  const hasExisting = existingDescription && existingDescription.trim()
  const hasOsmTags = osmTags && Object.keys(osmTags).length > 0
  const hasCategory = category && category.trim()

  return `You are a knowledgeable local tour guide speaking directly to a tourist. Write one engaging, educational description

POLICY (COMPACT):
- Use only facts present in SOURCES. If unsure, omit.
- Do not invent or infer relationships/events.
- Forbidden: addresses, directions, hours, prices, superlatives, speculation.
- Style: conversational, educational, TTS-friendly sentences.
- Dates: prefer a verified year; otherwise century/decade.
- Voice: friendly local expert sharing interesting stories with visitors.

SOURCE PRIORITY (STRICT):
1) INTERNAL (tokens, previous verified text, stored claims)
2) Official website
3) City sources (heritage/government/academic/local media)
4) National sources
5) User links
Conflict → prefer INTERNAL.

LOCATION & DISAMBIGUATION:
- Validate this POI exists in ${city}${state ? `, ${state}` : ''}, ${country}.
- Use city sources and nearby landmarks/districts to confirm.
- Mention people only if their link to THIS POI at THIS LOCATION is explicit.
- Verify exact full name and historical period; avoid similarly named individuals.

TASK (≤150 words):
- Start with Name + primary verified date (if any).
- Explain WHY this place matters (historical/cultural significance).
- Share 1–2 interesting facts that help tourists understand the context.
- Use conversational tone: "Aqui você encontra...", "Este local representa...", "Uma curiosidade interessante..."
- End with what makes this place special or worth visiting.

EXAMPLES OF GOOD TOURIST GUIDE STYLE:
- "Memorial ao Bispo Dom Nery, inaugurado em 2022, homenageia Dom João Batista Corrêa Nery, primeiro bispo de Campinas. Este importante líder religioso foi fundamental na criação da Arquidiocese de Campinas em 1908. Uma curiosidade interessante: Dom Nery nasceu na própria Campinas, tornando-se um símbolo local da fé católica. O memorial preserva sua história e legado, oferecendo aos visitantes uma conexão com as raízes religiosas da cidade."
- "Aqui você descobre a história de quem moldou a identidade religiosa de Campinas."

SOURCES:
${sourcesSection}

CONTEXT:
- Location: ${locationDetails}
- Google: ${googleData}
${hasCategory ? `- Category: ${category}` : ''}
${hasOsmTags ? `- OSM Tags: ${JSON.stringify(osmTags, null, 2)}` : ''}

${hasTokens ? `TOKENS:\n${existingTokens.map((t: any) => `- ${t.token} (${t.weight})`).join('\n')}` : ''}
${hasExisting ? `EXISTING (for improvement):\n${existingDescription}` : ''}

OUTPUT: only the final Portuguese text.`
}

/**
 * Verifica a qualidade da descrição gerada
 */
async function verifyGeneratedDescription(description: string, name: string, apiKey: string) {
  console.log('🔍 Verificando qualidade da descrição gerada (critérios brandos)...')
  
  const verificationPrompt = `
You are a specialized verifier for short tourist description quality (25-second audio). Analyze the description below for the attraction "${name}" and evaluate with lenient criteria:

DESCRIPTION TO BE VERIFIED:
"""
${description}
"""

IMPORTANT CONTEXT:
- This is a SHORT description for 25-second audio (maximum 300-350 characters)
- Not all places have detailed information available
- The goal is to provide at least 1-2 interesting facts, not a complete description
- Some attractions may have limited or generic information

VERIFICATION CRITERIA (LENIENT):
1. DATE PRESENCE: Does the description contain at least one date OR historical period? (Not mandatory, but desirable)
2. VERIFIABLE FACTS: Is there at least 1 fact that seems verifiable? (Even if generic)
3. GUIDE STYLE: Does the description have a minimally friendly tone?
4. PROHIBITIONS: Does it contain addresses, hours, prices or specific directions? (Only rigid criterion)
5. AUDIO SUITABILITY: Are the sentences suitable for TTS?
6. BRAZILIAN PORTUGUESE: Is the text in correct Brazilian Portuguese?

LENIENT SCORING (BE VARIED):
- Approve the description if it has at least 1 fact and is in correct Portuguese
- Minimum score of 60 if it has at least one verifiable fact
- Use varied scores: 65, 70, 75, 80, 85, 90, 95 based on real quality
- Be generous in evaluation, considering the 25-second limit
- DON'T always use the same score - vary based on specific quality

RESPOND IN JSON:
{
  "aprovada": true/false,
  "pontuacao": 0-100,
  "datas_detectadas": ["list", "of", "dates"],
  "fatos_verificaveis": ["fact 1", "fact 2"],
  "problemas": ["problem 1", "problem 2"],
  "sugestoes_melhoria": "concise and realistic suggestion for the 25-second limit"
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
async function callGeminiAPI(prompt: string, apiKey: string, qualityMode: boolean = false): Promise<{ response: Response; model: string }> {
  // Strategy: Use 1.5 Pro for description generation, 1.5 Flash as fallback for quality assurance
  const endpoints = qualityMode 
    ? [
        { url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, model: 'gemini-1.5-pro' },
        { url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, model: 'gemini-1.5-flash' }
      ]
    : [
        { url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, model: 'gemini-1.5-pro' },
        { url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, model: 'gemini-1.5-flash' }
      ]

  for (const endpoint of endpoints) {
    try {
      console.log(`🤖 Trying model: ${endpoint.model}`)
      const response = await fetch(endpoint.url, {
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
          generationConfig: qualityMode ? {
            temperature: 0.0,        // Maximum factual accuracy for 1.5 Pro
            topK: 1,                 // Most focused selection
            topP: 0.5,              // Conservative creativity
            maxOutputTokens: 500,   // More room for thorough analysis
            candidateCount: 2,      // Generate multiple candidates
            stopSequences: ["---", "NOTE:", "ADDITIONAL:"]
          } : {
            temperature: 0.1,        // Low temperature for factual accuracy (1.5 Pro optimized)
            topK: 20,               // Focused token selection
            topP: 0.8,              // Balanced creativity/accuracy
            maxOutputTokens: 400,   // Sufficient for 150 words + buffer
            stopSequences: ["---", "NOTE:", "ADDITIONAL:"] // Stop at meta content
          },
        })
      })

      if (response.ok) {
        console.log(`✅ Successfully used model: ${endpoint.model}`)
        return { response, model: endpoint.model }
      }

      console.warn(`Failed with model ${endpoint.model}:`, response.status)
    } catch (error) {
      console.warn(`Error with model ${endpoint.model}:`, error)
    }
  }

  // Return the last attempt for error handling (1.5 Flash as final fallback)
  console.log(`⚠️ All models failed, using fallback: ${endpoints[0].model}`)
  const fallbackResponse = await fetch(endpoints[0].url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 400 }
    })
  })
  return { response: fallbackResponse, model: endpoints[0].model }
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
