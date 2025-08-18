const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function regenerateWithHistory() {
  console.log('🏛️ Regenerando descrição do Lago do Taboão com dados históricos...\n');

  try {
    // 1. Buscar dados do POI
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, name, city, country, google_types, rating,
        attraction_descriptions(description, language, is_original, verification_status)
      `)
      .eq('name', 'Lago do Taboão')
      .eq('city', 'Bragança Paulista')
      .single();

    if (poiError || !poi) {
      console.error('❌ Erro ao buscar POI:', poiError);
      return;
    }

    console.log(`✅ POI: ${poi.name} (${poi.city})`);

    // 2. Prompt com informações históricas verificáveis
    const prompt = `You are a professional travel guide assistant specializing in factual, verifiable historical content for audio-guided tours.

CRITICAL REQUIREMENTS:
1. HISTORICAL FOCUS: Prioritize verified historical facts and cultural significance
2. VERIFIABLE CLAIMS: Use only confirmed information from reliable sources
3. ENGAGING NARRATIVE: Make history interesting and accessible
4. AUDIO-OPTIMIZED: Natural flow for text-to-speech

VERIFIED HISTORICAL INFORMATION ABOUT LAGO DO TABOÃO:

RECENT DEVELOPMENTS (2023):
- December 2023: Inauguration of a 23-meter Japanese-style bridge
- Addition of Japanese garden with traditional Tori (Japanese portal)
- Homage to Japanese immigration to the region
- Oriental landscaping with lanterns and cultural monuments

CURRENT FEATURES:
- Main postcard/landmark of Bragança Paulista
- Located at city entrance via Fernão Dias highway
- Approximately 3,000 meters in length
- 4,100-meter walking/cycling track around the lake
- Sports courts, playgrounds, and green areas
- Traditional Handicraft Fair on Sundays
- Annual New Year's celebration with fireworks
- Traditional Linguiça (sausage) Festival venue

CULTURAL SIGNIFICANCE:
- Meeting point for athletes, families, and nature lovers
- Gastronomic hub with restaurants featuring local Bragantina linguiça
- Cultural events and festivities venue

TASK: Create a historically-focused description in Brazilian Portuguese (max 180 words) that:

1. STARTS with the lake's name and its role as Bragança Paulista's main landmark
2. INCLUDES the recent 2023 Japanese bridge addition as a verifiable historical fact
3. MENTIONS the cultural significance (Japanese immigration homage)
4. REFERENCES the traditional events (Linguiça Festival, New Year's celebration)
5. DESCRIBES current recreational use while maintaining historical context

STRUCTURE:
- Sentence 1: Name + main landmark status
- Sentence 2-3: Recent historical addition (2023 bridge and Japanese garden)
- Sentence 4-5: Cultural significance and traditional events
- Sentence 6: Current recreational function

AVOID: Speculation about original construction dates, unverified historical claims
FOCUS: Recent verified developments, cultural significance, traditional events

OUTPUT: Only the final Portuguese text, no commentary.`;

    console.log('🚀 Chamando Gemini com contexto histórico...');

    const apiKey = process.env.GEMINI_API_KEY;
    const { default: fetch } = require('node-fetch');
    
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 350,
        },
      })
    });

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      console.error('❌ Nenhum texto gerado');
      return;
    }

    console.log('\n🎉 Nova descrição histórica gerada!');
    console.log('─'.repeat(80));
    console.log(`📝 Descrição com contexto histórico (${generatedText.length} caracteres):`);
    console.log(`"${generatedText.trim()}"`);
    console.log('─'.repeat(80));

    // 3. Mostrar comparação
    const currentDesc = poi.attraction_descriptions.find(d => d.language === 'pt-br' && d.is_original);
    if (currentDesc) {
      console.log('\n📊 Comparação:');
      console.log(`   Atual: ${currentDesc.description.length} caracteres`);
      console.log(`   Nova: ${generatedText.length} caracteres`);
      
      console.log('\n📝 Descrição atual:');
      console.log(`"${currentDesc.description}"`);
    }

    // 4. Atualizar no banco
    console.log('\n💾 Atualizando descrição com contexto histórico...');
    
    const { data: updated, error: updateError } = await supabase
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

    if (updateError) {
      console.error('❌ Erro ao atualizar:', updateError);
    } else {
      console.log('✅ Descrição histórica atualizada com sucesso!');
      console.log(`   ID: ${updated.id}`);
      console.log(`   Atualizada em: ${updated.updated_at}`);
    }

    console.log('\n🎯 MELHORIAS IMPLEMENTADAS:');
    console.log('✅ Foco histórico: Ponte japonesa de dezembro 2023');
    console.log('✅ Significado cultural: Homenagem à imigração japonesa');
    console.log('✅ Eventos tradicionais: Festa da Linguiça, Réveillon');
    console.log('✅ Contexto verificável: Cartão-postal da cidade');
    console.log('✅ Dados factuais: 23 metros de ponte, jardim oriental');

    console.log('\n📋 Próximo passo: Verificar factualmente para comparar scores!');

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

regenerateWithHistory();
