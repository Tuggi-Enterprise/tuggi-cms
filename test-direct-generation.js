const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDirectGeneration() {
  console.log('🏛️ Testando geração direta com Gemini API...\n');

  try {
    // 1. Buscar dados do Lago do Taboão
    console.log('📊 1. Buscando dados do POI...');
    
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, name, city, country, google_types, rating, google_place_id,
        attraction_descriptions(id, description, language, is_original, verification_status)
      `)
      .eq('name', 'Lago do Taboão')
      .eq('city', 'Bragança Paulista')
      .single();

    if (poiError || !poi) {
      console.error('❌ Erro ao buscar POI:', poiError);
      return;
    }

    console.log(`✅ POI encontrado: ${poi.name}`);
    console.log(`   📍 Localização: ${poi.city}, ${poi.country}`);
    console.log(`   ⭐ Rating: ${poi.rating}`);
    console.log(`   🏷️ Tipos: ${poi.google_types.join(', ')}`);

    // Mostrar descrição atual
    const currentDesc = poi.attraction_descriptions.find(d => d.language === 'pt-br' && d.is_original);
    if (currentDesc) {
      console.log(`\n📝 Descrição atual (${currentDesc.verification_status || 'não verificada'}):`);
      console.log(`   Texto: "${currentDesc.description.substring(0, 100)}..."`);
    }

    // 2. Buscar fontes em camadas
    console.log('\n🔍 2. Buscando fontes em camadas...');
    
    const { data: sources, error: sourcesError } = await supabase
      .schema('core')
      .rpc('get_verification_sources_layered', {
        p_city_name: poi.city,
        p_country_code: 'BR',
        p_limit: 10
      });

    let sourcesSection = '';
    if (!sourcesError && sources && sources.length > 0) {
      console.log(`✅ Encontradas ${sources.length} fontes em camadas:`);
      const nationalSources = sources.filter(s => s.layer === 'national');
      const citySources = sources.filter(s => s.layer === 'city');
      
      console.log(`   🏛️ Nacionais: ${nationalSources.length}`);
      console.log(`   🏙️ Cidade: ${citySources.length}`);
      
      const sourcesList = sources.map(s => `- ${s.source_name} (${s.source_type})`).join('\n');
      sourcesSection = `\n### AUTHORITATIVE SOURCES\n${sourcesList}\nUse these sources as primary references for facts, dates, and details.\n`;
    } else {
      console.log('⚠️ Nenhuma fonte encontrada');
    }

    // 3. Construir prompt otimizado
    console.log('\n🚀 3. Construindo prompt otimizado...');
    
    const locationDetails = `${poi.city}, ${poi.country}`;
    const name = poi.name;
    
    const prompt = `You are a professional travel guide assistant specializing in factual, verifiable content creation for audio-guided tours.

CRITICAL REQUIREMENTS FOR VERIFICATION ACCEPTANCE:

1. FACTUAL ACCURACY: Use ONLY verifiable facts from authoritative sources listed below
2. VERIFIABLE CLAIMS: Include specific, checkable details (construction years, architects, historical events)  
3. NO SPECULATION: If uncertain about any detail, omit it completely
4. STRUCTURED FACTS: Prioritize facts that can be verified against government databases, heritage sites, or official records
5. AUDIO-OPTIMIZED: Write for text-to-speech with natural rhythm and flow

VERIFICATION CRITERIA (Based on System Analysis):
- Target 2-4 verifiable factual claims per description
- Focus on: construction/inauguration years, architects/designers, historical significance, architectural style
- Avoid: subjective descriptions, unverifiable superlatives, speculative information
- Prefer: official sources over secondary sources, government records over general information

AUTHORITATIVE SOURCES:
${sourcesSection}

TASK: Generate a factual, verification-friendly description in Brazilian Portuguese (max 150 words)

ATTRACTION DATA:
- Name: ${name}
- Location: ${locationDetails}
- Coordinates: Not available

GENERATION INSTRUCTIONS:

1. START FORMAT: Begin with attraction name and primary verifiable fact
   Example: "O Museu de Arte de São Paulo, inaugurado em 1947..."

2. FACTUAL STRUCTURE:
   - Sentence 1: Name + most important verifiable fact (year, architect, etc.)
   - Sentence 2-3: Additional verifiable details (renovations, historical events, architectural features)
   - Sentence 4: Current function/significance (if verifiable)

3. VERIFICATION OPTIMIZATION:
   - Include specific years only if confirmed by sources
   - Name architects/designers only if documented
   - Mention historical events only if officially recorded
   - Reference architectural styles only if architecturally documented

4. AUDIO OPTIMIZATION:
   - Use short, clear sentences (max 25 words each)
   - Natural breathing points between facts
   - Avoid lists, bullet points, or complex clauses
   - Flow naturally after directional audio cues

5. PROHIBITED CONTENT:
   - Neighborhood names, street addresses, directions
   - Opening hours, prices, contact information
   - Subjective superlatives ("most beautiful", "incredible")
   - Unverified claims or speculation

OUTPUT: Only the final Portuguese text, no additional commentary or metadata.`;

    console.log('📝 Prompt preparado (primeiros 200 chars):', prompt.substring(0, 200) + '...');

    // 4. Chamar Gemini API diretamente
    console.log('\n🤖 4. Chamando Gemini API diretamente...');
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY não encontrada');
      return;
    }

    const { default: fetch } = require('node-fetch');
    
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.5,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 320,
        },
      })
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      console.error('❌ Erro na API Gemini:', errorData);
      return;
    }

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      console.error('❌ Nenhum texto gerado');
      return;
    }

    console.log('\n🎉 5. Nova descrição gerada com sucesso!');
    console.log('─'.repeat(80));
    console.log(`📝 Nova descrição (${generatedText.length} caracteres):`);
    console.log(`"${generatedText.trim()}"`);
    console.log('─'.repeat(80));

    // Comparar com a anterior
    if (currentDesc) {
      console.log('\n📊 6. Comparação:');
      console.log(`   Anterior: ${currentDesc.description.length} caracteres`);
      console.log(`   Nova: ${generatedText.length} caracteres`);
      console.log(`   Diferença: ${generatedText.length - currentDesc.description.length} caracteres`);
      
      console.log('\n📝 Descrição anterior:');
      console.log(`"${currentDesc.description}"`);
    }

    // 7. Atualizar descrição no banco
    console.log('\n💾 7. Atualizando descrição no banco...');
    
    const { data: updatedDescription, error: saveError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .update({
        description: generatedText.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('attraction_id', poi.id)
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .select()
      .single();

    if (saveError) {
      console.error('❌ Erro ao salvar:', saveError);
    } else {
      console.log('✅ Nova descrição atualizada com sucesso!');
      console.log(`   ID: ${updatedDescription.id}`);
      console.log(`   Atualizada em: ${updatedDescription.updated_at}`);
    }

    console.log('\n🎯 Regeneração concluída!');
    console.log('📋 Próximos passos:');
    console.log('   1. Verificar factualmente a nova descrição');
    console.log('   2. Comparar score de verificação');
    console.log('   3. Analisar claims extraídas');

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o teste
testDirectGeneration();
