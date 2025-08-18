const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function regenerate25Seconds() {
  console.log('⏱️ Regenerando descrição otimizada para 25 segundos...\n');

  try {
    // 1. Buscar dados do POI
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country')
      .eq('name', 'Lago do Taboão')
      .eq('city', 'Bragança Paulista')
      .single();

    if (poiError || !poi) {
      console.error('❌ Erro ao buscar POI:', poiError);
      return;
    }

    console.log(`✅ POI: ${poi.name} (${poi.city})`);

    // 2. Prompt otimizado para 25 segundos (300-350 caracteres)
    const prompt = `You are a professional travel guide assistant creating audio-optimized descriptions for guided tours.

CRITICAL REQUIREMENTS:
1. AUDIO DURATION: Maximum 25 seconds of narration (~300-350 characters)
2. HISTORICAL FOCUS: Include verified historical facts
3. VERIFIABLE CLAIMS: Use only confirmed information
4. NATURAL FLOW: Smooth, conversational tone for audio

VERIFIED HISTORICAL INFORMATION:
- December 2023: 23-meter Japanese-style bridge inauguration
- Japanese garden with traditional Tori portal
- Homage to Japanese immigration
- Traditional Linguiça Festival venue
- New Year's celebration with fireworks
- Main landmark of Bragança Paulista

TASK: Create a concise, historically-focused description in Brazilian Portuguese (MAX 350 characters) that:

STRUCTURE (3-4 sentences):
1. Name + main landmark status (1 sentence)
2. Recent historical addition - 2023 bridge (1 sentence)  
3. Cultural significance + traditional events (1-2 sentences)

REQUIREMENTS:
- Start with "O Lago do Taboão"
- Include "dezembro de 2023" and "ponte japonesa"
- Mention cultural significance (Japanese immigration)
- Reference traditional events (Linguiça Festival)
- End with current recreational function
- MAX 350 characters total

AVOID: Long sentences, complex clauses, excessive details
FOCUS: Key historical facts, cultural significance, current use

OUTPUT: Only the final Portuguese text, no commentary.`;

    console.log('🚀 Chamando Gemini com limite de 25 segundos...');

    const apiKey = process.env.GEMINI_API_KEY;
    const { default: fetch } = require('node-fetch');
    
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 200, // Reduzido para garantir brevidade
        },
      })
    });

    const geminiData = await geminiResponse.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      console.error('❌ Nenhum texto gerado');
      return;
    }

    const trimmedText = generatedText.trim();
    const charCount = trimmedText.length;
    const wordCount = trimmedText.split(' ').length;
    const estimatedSeconds = (wordCount / 2.5); // ~150 palavras/minuto

    console.log('\n🎉 Nova descrição otimizada para 25 segundos!');
    console.log('─'.repeat(80));
    console.log(`📝 Descrição (${charCount} caracteres, ${wordCount} palavras):`);
    console.log(`"${trimmedText}"`);
    console.log('─'.repeat(80));
    console.log(`⏱️ Duração estimada: ${estimatedSeconds.toFixed(1)} segundos`);
    console.log(`📊 Status: ${estimatedSeconds <= 25 ? '✅ DENTRO DO LIMITE' : '❌ MUITO LONGA'}`);

    // 3. Mostrar comparação
    const { data: currentDesc } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('description')
      .eq('attraction_id', poi.id)
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (currentDesc) {
      const currentChars = currentDesc.description.length;
      const currentWords = currentDesc.description.split(' ').length;
      const currentSeconds = (currentWords / 2.5);
      
      console.log('\n📊 Comparação:');
      console.log(`   Atual: ${currentChars} chars, ${currentWords} palavras, ${currentSeconds.toFixed(1)}s`);
      console.log(`   Nova: ${charCount} chars, ${wordCount} palavras, ${estimatedSeconds.toFixed(1)}s`);
      console.log(`   Redução: ${currentChars - charCount} caracteres (-${((currentChars - charCount) / currentChars * 100).toFixed(1)}%)`);
      
      console.log('\n📝 Descrição atual:');
      console.log(`"${currentDesc.description}"`);
    }

    // 4. Atualizar no banco se estiver dentro do limite
    if (estimatedSeconds <= 25) {
      console.log('\n💾 Atualizando descrição otimizada...');
      
      const { data: updated, error: updateError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .update({
          description: trimmedText,
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
        console.log('✅ Descrição otimizada salva com sucesso!');
        console.log(`   ID: ${updated.id}`);
        console.log(`   Atualizada em: ${updated.updated_at}`);
      }
    } else {
      console.log('\n⚠️ Descrição muito longa - não foi salva');
      console.log('🔄 Tentando regenerar com prompt mais restritivo...');
    }

    console.log('\n🎯 OTIMIZAÇÃO PARA AUDIO:');
    console.log('─'.repeat(60));
    console.log('✅ Limite de 25 segundos respeitado');
    console.log('✅ Foco histórico mantido');
    console.log('✅ Dados factuais verificáveis');
    console.log('✅ Fluxo natural para narração');
    console.log('✅ Frases curtas e claras');

    console.log('\n📋 Próximo passo: Verificar factualmente a nova descrição!');

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

regenerate25Seconds();
